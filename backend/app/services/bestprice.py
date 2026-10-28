"""회원 최저가 쿠폰(bestprice) 야간 배치 — 구간 계산 → 상한 안에서 발급 계획 → (LIVE면) 발급.

- BESTPRICE_LIVE=false(기본): 카페24 호출 0회. 계획·로그·dry-run 행(bestprice_assignments mode='dry')만 기록.
- BESTPRICE_LIVE=true: 월·구간별 쿠폰 생성(없으면) → 회원 발급 → 매일 주문에서 실사용 확인
  → 월 누적 실사용 ≥ 상한이면 그 달 쿠폰 발급 중지 + 미사용 발급분 회수(조기 종료), ≥70%면 경고.
- 쿠폰 쓰기는 cafe24_promo.promo_request(LIVE 아니면 차단), 주문 쿠폰 조회는 기존 연동(read_order).
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import date, datetime, timedelta

from sqlalchemy import delete, func, insert, select, text

from app.core.config import get_settings
from app.services import bestprice_logic as L
from app.services.cafe24_coupon_spec import (
    bestprice_coupon_name, build_bestprice_coupon_request, build_issue_request, build_pause_request,
)

logger = logging.getLogger(__name__)
_run_lock = asyncio.Lock()


def kst_today() -> date:
    return (datetime.utcnow() + timedelta(hours=9)).date()


def period_key(d: date) -> str:
    """쿠폰 묶음 기간(YYYY-MM). 25일 이후는 다음 달 — 전체 발급이 여러 밤 걸려도 월 경계에서 2장 안 받게."""
    if d.day >= 25:
        d = (d.replace(day=1) + timedelta(days=32)).replace(day=1)
    return d.strftime("%Y-%m")


_FEATURE_SQL = text("""
with o as (
  select member_id, order_date, amount from mall_orders
  where status = 'paid' and member_id is not null and order_date < CAST(:asof AS date)
), h as (
  select member_id, count(*) n, max(order_date) last_order,
         coalesce(sum(amount) filter (where order_date >= CAST(:asof AS date) - 365), 0) amt365
  from o group by 1
)
select m.member_id,
       (CAST(:asof AS date) - CAST(m.joined_at AS date)) as dj,
       coalesce(h.n, 0) as n,
       (CAST(:asof AS date) - h.last_order) as dl,
       coalesce(h.amt365, 0) as amt
from mall_members m left join h using (member_id)
where m.joined_at is null or m.joined_at < CAST(:asof AS date)
""")

_BUYERS_SQL = text("""
select distinct member_id from mall_orders
where status = 'paid' and member_id is not null
  and order_date >= CAST(:a AS date) and order_date < CAST(:b AS date)
""")


async def _classify_all(db, asof: date) -> dict[str, list[tuple[str, int, int, int, float]]]:
    rows = (await db.execute(_FEATURE_SQL, {"asof": asof})).all()
    out: dict[str, list] = {t: [] for t in L.TIER_ORDER}
    for mid, dj, n, dl, amt in rows:
        t = L.classify(days_since_join=dj, n_orders=int(n or 0), days_since_last=dl, amount_365=float(amt or 0))
        out[t].append((mid, dj if dj is not None else 10 ** 6, int(n or 0), dl if dl is not None else 10 ** 6, float(amt or 0)))
    return out


def _priority_sort(tier: str, rows: list) -> list[str]:
    """구간 안 우선순위. (member_id, dj, n, dl, amt)"""
    if tier in ("new", "nopurchase", "longinactive"):
        # 최근 가입 순(로그인 기록 동기화 전 임시 대용 — 최근 로그인 순이 생기면 교체)
        rows = sorted(rows, key=lambda r: r[1])
    elif tier == "vip":
        rows = sorted(rows, key=lambda r: -r[4])
    elif tier == "active":
        rows = sorted(rows, key=lambda r: -r[3])  # 이탈 직전(60일 가까운) 회원 먼저
    else:
        rows = sorted(rows, key=lambda r: r[3])   # 최근 구매 순
    return [r[0] for r in rows]


async def observed_rates(db, today: date) -> tuple[dict, dict]:
    """30일 전 시점 구간 → 그 뒤 30일 구매 회원 비율(회원당 월 1장이라 '주문'이 아닌 '구매 회원' 비율)."""
    asof = today - timedelta(days=30)
    tiers = await _classify_all(db, asof)
    buyers = {r[0] for r in (await db.execute(_BUYERS_SQL, {"a": asof, "b": today})).all()}
    observed = {t: (len(rows), sum(1 for r in rows if r[0] in buyers)) for t, rows in tiers.items()}
    return L.blended_rates(observed), observed


async def _redeemed_mtd(db, month: str) -> float:
    from app.models.bestprice import BestpriceRedemption
    v = (await db.execute(select(func.coalesce(func.sum(BestpriceRedemption.amount), 0))
                          .where(BestpriceRedemption.month == month))).scalar()
    return float(v or 0)


async def check_redemptions(db, month: str) -> dict:
    """LIVE 발급 회원의 이번 달 새 주문만 골라 카페24 주문 쿠폰(read_order)을 조회해 실사용액 기록."""
    from app.models.bestprice import BestpriceAssignment, BestpriceCoupon, BestpriceRedemption
    from app.models.kpi import MallOrder
    from app.services import cafe24 as cafe24_svc
    from app.services.cafe24_promo import main_cafe24_user

    coupon_nos = {c for (c,) in (await db.execute(
        select(BestpriceCoupon.coupon_no).where(BestpriceCoupon.month == month, BestpriceCoupon.mode == "live",
                                                BestpriceCoupon.coupon_no.isnot(None)))).all()}
    checked = 0
    if coupon_nos:
        # 발급일(UTC→KST 날짜) 이후 주문만
        q = (select(MallOrder.cafe24_order_id, MallOrder.member_id)
             .join(BestpriceAssignment, (BestpriceAssignment.member_id == MallOrder.member_id)
                   & (BestpriceAssignment.month == month) & (BestpriceAssignment.mode == "live")
                   & (BestpriceAssignment.status.in_(["issued", "revoked"])))
             .where(MallOrder.status == "paid",
                    MallOrder.order_date >= func.date(BestpriceAssignment.issued_at + timedelta(hours=9)),
                    ~MallOrder.cafe24_order_id.in_(select(BestpriceRedemption.order_id))))
        orders = (await db.execute(q)).all()
        user = await main_cafe24_user(db)
        for order_id, member_id in orders:
            try:
                data = await cafe24_svc.api_request(user, db, "GET", "/api/v2/admin/orders/coupons",
                                                    params={"order_id": order_id})
            except Exception as e:
                logger.warning(f"[bestprice] 주문 쿠폰 조회 실패 {order_id}: {e}")
                continue
            amt, cno = 0.0, None
            for c in data.get("coupons", []) or []:
                code = str(c.get("coupon_code") or "")
                if code in coupon_nos:
                    amt += float(c.get("coupon_value_final") or c.get("coupon_value") or 0)
                    cno = code
            db.add(BestpriceRedemption(order_id=order_id, month=month, member_id=member_id, coupon_no=cno, amount=amt))
            checked += 1
            await asyncio.sleep(0.05)
        await db.commit()
    return {"orders_checked": checked, "redeemed_mtd": await _redeemed_mtd(db, month)}


async def end_month_early(db, month: str) -> dict:
    """상한 도달: 이번 달 쿠폰 발급 중지 + 미사용 발급분 회수. LIVE에서만 호출."""
    from app.models.bestprice import BestpriceAssignment, BestpriceCoupon, BestpriceRedemption
    from app.services.cafe24_promo import promo_request
    s = get_settings()
    paused = revoked = 0
    coupons = (await db.execute(select(BestpriceCoupon).where(
        BestpriceCoupon.month == month, BestpriceCoupon.mode == "live", BestpriceCoupon.status == "active"))).scalars().all()
    for c in coupons:
        try:
            await promo_request(db, "PUT", f"/api/v2/admin/coupons/{c.coupon_no}", json=build_pause_request())
            c.status, c.paused_at = "paused", datetime.utcnow()
            paused += 1
        except Exception as e:
            logger.error(f"[bestprice] 쿠폰 중지 실패 {c.coupon_no}: {e}")
    await db.commit()
    used = select(BestpriceRedemption.member_id).where(BestpriceRedemption.month == month, BestpriceRedemption.amount > 0)
    rows = (await db.execute(select(BestpriceAssignment).where(
        BestpriceAssignment.month == month, BestpriceAssignment.mode == "live",
        BestpriceAssignment.status == "issued", ~BestpriceAssignment.member_id.in_(used)))).scalars().all()
    for a in rows:
        try:
            await promo_request(db, "DELETE", f"/api/v2/admin/customers/{a.member_id}/coupons/{a.coupon_no}")
            a.status = "revoked"
            revoked += 1
        except Exception as e:
            a.error = f"revoke: {str(e)[:250]}"
        await asyncio.sleep(s.BESTPRICE_REQ_INTERVAL_SEC)
        if revoked % 200 == 0:
            await db.commit()
    await db.commit()
    logger.warning(f"[bestprice] {month} 상한 도달 → 쿠폰 {paused}개 중지, 미사용 {revoked}장 회수")
    return {"paused": paused, "revoked": revoked}


async def _ensure_live_coupon(db, month: str, tier: str, max_count: int):
    from app.models.bestprice import BestpriceCoupon
    from app.services.cafe24_promo import promo_request
    s = get_settings()
    row = (await db.execute(select(BestpriceCoupon).where(
        BestpriceCoupon.month == month, BestpriceCoupon.tier == tier, BestpriceCoupon.mode == "live"))).scalar_one_or_none()
    if row and row.coupon_no:
        return row
    amount = L.TIER_AMOUNT[tier]
    body = build_bestprice_coupon_request(amount=amount, month=month, issue_max_count=max_count,
                                          min_order_price=s.BESTPRICE_MIN_ORDER_KRW, valid_days=s.BESTPRICE_VALID_DAYS)
    data = await promo_request(db, "POST", "/api/v2/admin/coupons", json=body)
    cno = str((data.get("coupon") or {}).get("coupon_no") or "")
    if not cno:
        raise RuntimeError(f"쿠폰 생성 응답에 coupon_no 없음: {str(data)[:200]}")
    if row is None:
        row = BestpriceCoupon(month=month, tier=tier, mode="live", amount=amount)
        db.add(row)
    row.coupon_name, row.coupon_no, row.issue_max_count, row.status = body["request"]["coupon_name"], cno, max_count, "active"
    await db.commit()
    return row


async def run_bestprice(db, *, live: bool | None = None) -> dict:
    """1회 실행. live=None이면 settings.BESTPRICE_LIVE를 따른다(false면 강제 dry)."""
    from app.models.bestprice import BestpriceAssignment, BestpriceCoupon, BestpriceRun
    s = get_settings()
    live = bool(s.BESTPRICE_LIVE) if live is None else (bool(live) and bool(s.BESTPRICE_LIVE))
    mode = "live" if live else "dry"
    today = kst_today()
    month = period_key(today)

    async with _run_lock:
        run = BestpriceRun(month=month, mode=mode)
        db.add(run)
        await db.commit()
        try:
            summary = await _run_inner(db, run.id, mode, today, month)
            run.status, run.summary_json = "done", json.dumps(summary, ensure_ascii=False, default=str)
        except Exception as e:
            logger.error(f"[bestprice] 실행 오류: {e}", exc_info=True)
            await db.rollback()
            run.status, run.error = "error", str(e)[:2000]
            summary = {"error": str(e)[:500]}
        run.finished_at = datetime.utcnow()
        await db.commit()
        return {"run_id": run.id, "mode": mode, **summary}


async def _run_inner(db, run_id: int, mode: str, today: date, month: str) -> dict:
    from app.models.bestprice import BestpriceAssignment, BestpriceCoupon
    s = get_settings()
    cap, safety = float(s.BESTPRICE_MONTHLY_CAP_KRW), float(s.BESTPRICE_SAFETY_FACTOR)

    # 1) 실사용 확인(LIVE만 카페24 조회) → 상한 판정
    if mode == "live":
        red = await check_redemptions(db, month)
    else:
        red = {"orders_checked": 0, "redeemed_mtd": await _redeemed_mtd(db, month)}
    status = L.cap_status(red["redeemed_mtd"], cap, s.BESTPRICE_WARN_RATIO)
    if status == "warn":
        logger.warning(f"[bestprice] {month} 실사용 {red['redeemed_mtd']:,.0f}원 — 상한의 "
                       f"{s.BESTPRICE_WARN_RATIO:.0%} 넘음(조기 경고)")
    ended = None
    if status == "reached" and mode == "live":
        ended = await end_month_early(db, month)

    # 2) 구간·사용률
    rates, observed = await observed_rates(db, today)
    tiers = await _classify_all(db, today)

    # 3) 이번 달 이미 받은 회원 제외 + 기발급 기대비용
    have = {m for (m,) in (await db.execute(select(BestpriceAssignment.member_id).where(
        BestpriceAssignment.month == month, BestpriceAssignment.mode == "live",
        BestpriceAssignment.status.in_(["issued", "revoked"])))).all()}
    committed = float((await db.execute(select(func.coalesce(func.sum(BestpriceAssignment.expected_cost), 0)).where(
        BestpriceAssignment.month == month, BestpriceAssignment.mode == "live",
        BestpriceAssignment.status == "issued"))).scalar() or 0)
    # 실사용이 기대보다 크면 실사용을 기준으로(보수적)
    committed = max(committed, red["redeemed_mtd"])
    candidates = {t: [m for m in _priority_sort(t, rows) if m not in have] for t, rows in tiers.items()}

    plan = L.plan_issuance(candidates, rates=rates, safety=safety,
                           cap=cap if status != "reached" else 0.0,
                           committed_expected=committed, max_issue=s.BESTPRICE_MAX_ISSUE_PER_NIGHT)

    # 4) 기록 / 발급
    tier_sizes = {t: len(rows) for t, rows in tiers.items()}
    issued = failed = 0
    if mode == "dry":
        await db.execute(delete(BestpriceAssignment).where(BestpriceAssignment.month == month,
                                                           BestpriceAssignment.mode == "dry"))
        await db.execute(delete(BestpriceCoupon).where(BestpriceCoupon.month == month, BestpriceCoupon.mode == "dry"))
        for t in L.TIER_ORDER:
            db.add(BestpriceCoupon(month=month, tier=t, mode="dry", amount=L.TIER_AMOUNT[t],
                                   coupon_name=bestprice_coupon_name(L.TIER_AMOUNT[t], month),
                                   issue_max_count=int(tier_sizes[t] * 1.2) + 100, status="planned"))
        now = datetime.utcnow()
        rows = [{"month": month, "member_id": m, "mode": "dry", "tier": t, "amount": L.TIER_AMOUNT[t],
                 "expected_cost": L.expected_cost(t, rates, safety), "status": "planned",
                 "run_id": run_id, "created_at": now} for m, t in plan.issue]
        for i in range(0, len(rows), 5000):
            await db.execute(insert(BestpriceAssignment), rows[i:i + 5000])
        await db.commit()
    else:
        by_tier: dict[str, list[str]] = {}
        for m, t in plan.issue:
            by_tier.setdefault(t, []).append(m)
        batch = max(1, int(s.BESTPRICE_ISSUE_BATCH))
        from app.services.cafe24_promo import promo_request
        for t in L.TIER_ORDER:
            members = by_tier.get(t) or []
            if not members:
                continue
            coupon = await _ensure_live_coupon(db, month, t, int(tier_sizes[t] * 1.2) + 100)
            for i in range(0, len(members), batch):
                chunk = members[i:i + batch]
                err = None
                try:
                    await promo_request(db, "POST", f"/api/v2/admin/coupons/{coupon.coupon_no}/issues",
                                        json=build_issue_request(chunk))
                except Exception as e:
                    err = str(e)[:250]
                now = datetime.utcnow()
                for m in chunk:
                    db.add(BestpriceAssignment(month=month, member_id=m, mode="live", tier=t,
                                               amount=L.TIER_AMOUNT[t], expected_cost=L.expected_cost(t, rates, safety),
                                               coupon_no=coupon.coupon_no, status="failed" if err else "issued",
                                               run_id=run_id, error=err, issued_at=None if err else now))
                if err:
                    failed += len(chunk)
                else:
                    issued += len(chunk)
                if (i // batch) % 100 == 0:
                    await db.commit()
                await asyncio.sleep(s.BESTPRICE_REQ_INTERVAL_SEC)
            await db.commit()

    eligible_total = sum(tier_sizes.values())
    summary = {
        "month": month, "as_of_kst": today.isoformat(), "mode": mode,
        "cap": cap, "safety_factor": safety, "warn_ratio": s.BESTPRICE_WARN_RATIO,
        "redeemed_mtd": red["redeemed_mtd"], "redeemed_ratio": round(red["redeemed_mtd"] / cap, 4) if cap else None,
        "cap_status": status, "ended_early": ended, "orders_checked": red["orders_checked"],
        "committed_expected_before": round(committed),
        "planned_members": len(plan.issue), "planned_expected_cost": plan.planned_expected,
        "planned_worst_case_cost": sum(v["worst_case_cost"] for v in plan.per_tier.values()),
        "expected_total_after": round(committed + plan.planned_expected),
        "deferred_budget": plan.deferred_budget, "deferred_batch": plan.deferred_batch,
        "members_total": eligible_total, "already_have_coupon": len(have),
        "issued": issued, "failed": failed,
        "tiers": {t: {**plan.per_tier[t], "members": tier_sizes[t],
                      "backtest_members": observed.get(t, (0, 0))[0],
                      "backtest_buyers": observed.get(t, (0, 0))[1]} for t in L.TIER_ORDER},
        "notes": ["주문 이력은 mall_orders(2026-01~) 기준 — 그 전 구매는 무구매로 보임",
                  "장기 무구매·신규 우선순위는 최근 가입 순(로그인 기록 미동기화)"],
    }
    logger.info(f"[bestprice] {mode} {month}: 계획 {len(plan.issue):,}명 기대 {plan.planned_expected:,}원 "
                f"(기발급 {committed:,.0f}원, 상한 {cap:,.0f}원, 예산보류 {plan.deferred_budget:,}·"
                f"다음밤 {plan.deferred_batch:,}, 실사용 {red['redeemed_mtd']:,.0f}원 {status})")
    return summary


async def latest_summary(db, mode: str | None = None) -> dict | None:
    from app.models.bestprice import BestpriceRun
    q = select(BestpriceRun).where(BestpriceRun.status.in_(["done", "error"]))
    if mode:
        q = q.where(BestpriceRun.mode == mode)
    run = (await db.execute(q.order_by(BestpriceRun.id.desc()).limit(1))).scalar_one_or_none()
    if run is None:
        return None
    return {"run_id": run.id, "mode": run.mode, "status": run.status, "started_at": run.started_at,
            "finished_at": run.finished_at, "error": run.error,
            "summary": json.loads(run.summary_json) if run.summary_json else None}


async def run_bestprice_loop():
    """매일 18:30 UTC(03:30 KST). LIVE=false면 dry-run만."""
    from app.db.database import AsyncSessionLocal
    while True:
        now = datetime.utcnow()
        target = now.replace(hour=18, minute=30, second=0, microsecond=0)
        if target <= now:
            target += timedelta(days=1)
        await asyncio.sleep((target - now).total_seconds())
        if not get_settings().BESTPRICE_SCHEDULER:
            continue
        try:
            async with AsyncSessionLocal() as db:
                await run_bestprice(db)
        except Exception as e:
            logger.error(f"[bestprice] loop 오류: {e}", exc_info=True)


# ── 쿠폰 카탈로그(공개, 읽기 전용) — 스킨 ndBestPrice가 회원 쿠폰함의 쿠폰 규칙을 알아내는 용도 ──
# 회원 정보 없음(쇼핑몰 쿠폰 정의만). 발급·생성 기능 없음. 10분 캐시.
_catalog_cache: dict = {"at": None, "data": None}


def _catalog_entry(c: dict) -> dict | None:
    # A=정액 B=정률 E=기본배송비 전액(무료배송)
    if c.get("deleted") == "T" or c.get("benefit_type") not in ("A", "B", "E"):
        return None
    if c.get("available_period_type") == "F":
        end = (c.get("available_end_datetime") or "")[:19]
        if end and end < (datetime.utcnow() + timedelta(hours=9)).strftime("%Y-%m-%dT%H:%M:%S"):
            return None

    def num(v):
        try:
            return float(v) if v not in (None, "") else 0.0
        except (TypeError, ValueError):
            return 0.0
    return {
        "no": str(c.get("coupon_no")), "name": c.get("coupon_name") or "",
        "scope": c.get("available_scope") or "O",                 # P=상품 O=주문서
        "type": c.get("benefit_type"),                             # A=정액 B=정률
        "price": num(c.get("benefit_price")), "pct": num(c.get("benefit_percentage")),
        "max": num(c.get("benefit_percentage_max_price")),
        "min": num(c.get("available_min_price")) if c.get("available_price_type") not in (None, "U") else 0.0,
        "amt": c.get("available_amount_type") or "E",              # E=할인 전 I=할인 후 금액 기준
        "prod": c.get("available_product") or "U",
        "plist": [int(x) for x in (c.get("available_product_list") or []) if str(x).isdigit()],
        "cat": c.get("available_category") or "U",
    }


async def coupon_catalog(db) -> dict:
    """{coupons, groups, points, shipping} — 회원 정보 없는 쇼핑몰 규칙만. 권한 없는 항목은 null."""
    from app.services.cafe24_promo import promo_request
    at = _catalog_cache["at"]
    if at and datetime.utcnow() - at < timedelta(minutes=10) and _catalog_cache["data"] is not None:
        return _catalog_cache["data"]
    coupons, offset = [], 0
    while offset < 2000:
        data = await promo_request(db, "GET", "/api/v2/admin/coupons",
                                   params={"limit": 100, "offset": offset, "deleted": "F"})
        rows = data.get("coupons") or []
        for c in rows:
            e = _catalog_entry(c)
            if e:
                coupons.append(e)
        if len(rows) < 100:
            break
        offset += 100

    async def _try(path):
        try:
            return await promo_request(db, "GET", path)
        except Exception:
            return None
    groups = []
    g = await _try("/api/v2/admin/customergroups")
    for x in (g or {}).get("customergroups") or []:
        di = x.get("discount_information") or {}
        try:
            disc = float(di.get("amount_discount") or 0)
        except (TypeError, ValueError):
            disc = 0.0
        groups.append({"no": x.get("group_no"), "name": x.get("group_name"),
                       "benefit": x.get("buy_benefits"),           # 구매 혜택 유형
                       "min": float(di.get("amount_product") or 0), "disc": disc,
                       "unit": di.get("discount_unit"),            # P=% W=원
                       "max": float(di.get("max_discount") or 0)})
    pt = await _try("/api/v2/admin/points/setting")
    points = None
    if pt and isinstance(pt.get("point"), dict):
        p_ = pt["point"]
        points = {k: v for k, v in p_.items() if k.startswith("available_") or "max" in k or "limit" in k}
    sh = await _try("/api/v2/admin/shipping")
    shipping = None
    if sh and isinstance(sh.get("shipping"), dict):
        x = sh["shipping"]
        shipping = {k: x.get(k) for k in ("shipping_fee_type", "shipping_fee", "free_shipping_price",
                                          "shipping_fee_criteria")}
    out = {"coupons": coupons, "groups": groups, "points": points, "shipping": shipping}
    _catalog_cache.update(at=datetime.utcnow(), data=out)
    return out

# ── LIVE 단계 실행(관리자 API에서 호출) ─────────────────────────────────────────

_COUPON_CHECK = {
    "benefit_type": "A", "available_scope": "O", "available_period_type": "R",
    "send_sms_for_issue": "F", "send_email_for_issue": "F", "use_notification_when_login": "F",
    "issue_type": "M", "issue_limit": "F",
}


def verify_coupon_fields(c: dict, amount: int, min_price: int, days: int, max_count: int) -> list[str]:
    """GET으로 다시 읽은 쿠폰이 설계값과 같은지. 다른 항목 목록(빈 목록=통과)."""
    bad = []
    for k, v in _COUPON_CHECK.items():
        if str(c.get(k) or "") != v:
            bad.append(f"{k}={c.get(k)}(기대 {v})")

    def eqnum(k, v):
        try:
            return float(c.get(k) or 0) == float(v)
        except (TypeError, ValueError):
            return False
    for k, v in (("benefit_price", amount), ("available_min_price", min_price),
                 ("available_day_from_issued", days)):
        if not eqnum(k, v):
            bad.append(f"{k}={c.get(k)}(기대 {v})")
    if not str(c.get("coupon_name") or "").startswith("널담 회원 최저가"):
        bad.append(f"coupon_name={c.get('coupon_name')}")
    if c.get("deleted") == "T":
        bad.append("deleted=T")
    return bad


async def _get_coupon(db, coupon_no: str) -> dict | None:
    from app.services.cafe24_promo import promo_request
    data = await promo_request(db, "GET", "/api/v2/admin/coupons", params={"coupon_no": coupon_no})
    return next((x for x in (data.get("coupons") or []) if str(x.get("coupon_no")) == str(coupon_no)), None)


async def live_create_and_verify(db) -> dict:
    """이번 기간 구간별 쿠폰 생성(이미 있으면 재사용) → GET 재확인 → 틀리면 즉시 발급 중지."""
    from app.services.cafe24_promo import promo_request
    s = get_settings()
    if not s.BESTPRICE_LIVE:
        raise RuntimeError("BESTPRICE_LIVE=false")
    month = period_key(kst_today())
    sizes = {t: len(rows) for t, rows in (await _classify_all(db, kst_today())).items()}
    out = {}
    for t in L.TIER_ORDER:
        row = await _ensure_live_coupon(db, month, t, int(sizes[t] * 1.2) + 100)
        c = await _get_coupon(db, row.coupon_no)
        bad = ["GET 결과 없음"] if c is None else verify_coupon_fields(
            c, L.TIER_AMOUNT[t], s.BESTPRICE_MIN_ORDER_KRW, s.BESTPRICE_VALID_DAYS, row.issue_max_count)
        if bad and row.status == "active":
            try:
                await promo_request(db, "PUT", f"/api/v2/admin/coupons/{row.coupon_no}", json=build_pause_request())
            except Exception as e:
                bad.append(f"중지 실패: {e}")
            row.status, row.paused_at = "paused", datetime.utcnow()
            await db.commit()
        out[t] = {"coupon_no": row.coupon_no, "name": row.coupon_name, "amount": row.amount,
                  "issue_max_count": row.issue_max_count, "status": row.status, "ok": not bad, "mismatch": bad,
                  "fields": None if c is None else {k: c.get(k) for k in (
                      "coupon_name", "benefit_type", "benefit_price", "available_scope", "available_min_price",
                      "available_price_type", "available_period_type", "available_day_from_issued",
                      "issue_type", "issue_limit", "issue_max_count", "send_sms_for_issue",
                      "send_email_for_issue", "use_notification_when_login", "show_product_detail",
                      "available_coupon_count_by_order", "available_product", "available_category",
                      "issued_count", "issue_status")}}
    return {"month": month, "coupons": out}


async def live_pilot(db, *, limit: int = 500, extra_member_ids: list[str] | None = None) -> dict:
    """최근 구매(없으면 최근 가입) 순으로 구간 섞어 limit명 + 지정 회원에게만 발급."""
    from app.models.bestprice import BestpriceAssignment, BestpriceCoupon, BestpriceRun
    from app.services.cafe24_promo import promo_request
    s = get_settings()
    if not s.BESTPRICE_LIVE:
        raise RuntimeError("BESTPRICE_LIVE=false")
    today = kst_today()
    month = period_key(today)
    coupons = {c.tier: c for c in (await db.execute(select(BestpriceCoupon).where(
        BestpriceCoupon.month == month, BestpriceCoupon.mode == "live",
        BestpriceCoupon.status == "active"))).scalars().all()}
    if len(coupons) != len(L.TIER_ORDER):
        raise RuntimeError(f"활성 쿠폰 {len(coupons)}/{len(L.TIER_ORDER)} — 생성·검증 먼저")
    tiers = await _classify_all(db, today)
    have = {m for (m,) in (await db.execute(select(BestpriceAssignment.member_id).where(
        BestpriceAssignment.month == month, BestpriceAssignment.mode == "live"))).all()}
    rates, _ = await observed_rates(db, today)
    allrows = [(r, t) for t, rows in tiers.items() for r in rows if r[0] not in have]
    tier_of = {r[0]: t for r, t in allrows}
    allrows.sort(key=lambda x: (x[0][3], x[0][1]))
    picked = [r[0] for r, _ in allrows[:max(0, int(limit))]]
    for m in extra_member_ids or []:
        if m in tier_of and m not in picked:
            picked.append(m)
    run = BestpriceRun(month=month, mode="live")
    db.add(run)
    await db.commit()
    issued = failed = 0
    errors: list[str] = []
    done: list[str] = []
    for m in picked:
        t = tier_of[m]
        c = coupons[t]
        err = None
        try:
            await promo_request(db, "POST", f"/api/v2/admin/coupons/{c.coupon_no}/issues",
                                json=build_issue_request([m]))
        except Exception as e:
            err = str(e)[:250]
            errors.append(err)
        db.add(BestpriceAssignment(month=month, member_id=m, mode="live", tier=t, amount=L.TIER_AMOUNT[t],
                                   expected_cost=L.expected_cost(t, rates, s.BESTPRICE_SAFETY_FACTOR),
                                   coupon_no=c.coupon_no, status="failed" if err else "issued",
                                   run_id=run.id, error=err, issued_at=None if err else datetime.utcnow()))
        done.append(m)
        if err:
            failed += 1
        else:
            issued += 1
        if len(done) % 50 == 0:
            await db.commit()
        if failed >= 10 and issued == 0:
            break  # 처음부터 계속 실패하면 중단
        await asyncio.sleep(s.BESTPRICE_REQ_INTERVAL_SEC)
    by_tier: dict = {}
    for m in done:
        by_tier[tier_of[m]] = by_tier.get(tier_of[m], 0) + 1
    summary = {"month": month, "pilot": True, "picked": len(picked), "issued": issued, "failed": failed,
               "by_tier": by_tier, "errors_sample": errors[:5],
               "extra_found": [m for m in (extra_member_ids or []) if m in tier_of],
               "extra_missing": [m for m in (extra_member_ids or []) if m not in tier_of]}
    run.status, run.summary_json, run.finished_at = "done", json.dumps(summary, ensure_ascii=False), datetime.utcnow()
    await db.commit()
    return summary


async def live_issued_counts(db) -> dict:
    """카페24에서 각 쿠폰 issued_count를 다시 읽어 DB 발급 기록과 비교."""
    from app.models.bestprice import BestpriceAssignment, BestpriceCoupon
    month = period_key(kst_today())
    out = {}
    for c in (await db.execute(select(BestpriceCoupon).where(
            BestpriceCoupon.month == month, BestpriceCoupon.mode == "live"))).scalars().all():
        x = await _get_coupon(db, c.coupon_no) or {}
        db_n = (await db.execute(select(func.count()).select_from(BestpriceAssignment).where(
            BestpriceAssignment.coupon_no == c.coupon_no, BestpriceAssignment.status == "issued"))).scalar()
        out[c.tier] = {"coupon_no": c.coupon_no, "cafe24_issued_count": x.get("issued_count"),
                       "db_issued": db_n, "status": c.status, "issue_status": x.get("issue_status")}
    return {"month": month, "coupons": out}
