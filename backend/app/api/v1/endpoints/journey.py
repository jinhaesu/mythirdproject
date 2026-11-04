"""자사몰 여정·상세 스크롤 분석 API (2026-11-04 대표 요청).

  POST /journey/collect   tracker.js가 보내는 페이지·클릭·스크롤 기록 (인증 없음, 스토어프론트 발신)
  GET  /journey/status    수집 현황(최근 24시간 줄 수·첫 기록일)
  GET  /journey/funnel    여정 깔때기·흐름도·이탈 지점·신규/재구매 (?start&end=YYYY-MM-DD KST, entry, device)
  GET  /journey/scroll    상품별 상세 스크롤 이탈 (?start&end, product_no)

수집 스크립트는 affiliate.py의 tracker.js 안에 같이 들어 있다(이미 카페24 전 페이지에 설치돼 있음).
"""
import json
import logging
import time
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import func, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_user
from app.db.database import get_db
from app.models.journey import MallJourneyEvent as J
from app.models.user import User
from app.services import journey as jn

logger = logging.getLogger(__name__)
router = APIRouter()

KST = timedelta(hours=9)
MAX_ROWS = 600_000

# ─── 수집 ───

_hits: dict[str, list] = {}  # ip → [분, 횟수] (인스턴스별 간단 제한)
_RATE_PER_MIN = 240


def _limited(ip: str) -> bool:
    now = int(time.time() // 60)
    b = _hits.get(ip)
    if not b or b[0] != now:
        if len(_hits) > 20000:
            _hits.clear()
        _hits[ip] = [now, 1]
        return False
    b[1] += 1
    return b[1] > _RATE_PER_MIN


def _int(v, lo, hi) -> Optional[int]:
    try:
        x = int(float(v))
    except (TypeError, ValueError):
        return None
    return max(lo, min(hi, x))


_NO = Response(status_code=204)


@router.post("/collect")
async def collect(request: Request, db: AsyncSession = Depends(get_db)):
    """sendBeacon(text/plain) 수신. 무엇이 와도 204 — 쇼핑몰 화면에 영향 없게."""
    try:
        ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "")).split(",")[0].strip()
        if _limited(ip) or jn.is_bot(request.headers.get("user-agent", "")):
            return _NO
        raw = await request.body()
        if len(raw) > 4000:
            return _NO
        d = json.loads(raw.decode("utf-8", errors="replace") or "{}")
        t, pv, vid, sid = d.get("t"), d.get("pv"), d.get("v"), d.get("s")
        if not (jn.is_id(pv) and jn.is_id(vid) and jn.is_id(sid)):
            return _NO

        if t in ("pv", "ev"):
            url = jn.clean_url(str(d.get("u") or ""))
            page_type, prod, _cate, order = jn.classify(url)
            kind = "pv"
            if t == "ev":
                kind = d.get("k") if d.get("k") in ("cart_click", "buy_click") else None
                if not kind or not jn.is_id(d.get("rp")):
                    return _NO
            if t == "pv" and page_type == "done" and not order:
                o = str(d.get("o") or "")
                order = o if jn._RE_ORDER.match(o) else None
            utm = None
            if "utm_source=" in url:
                utm = url.split("utm_source=", 1)[1].split("&", 1)[0][:80] or None
            row = dict(
                pvid=pv, kind=kind, ref_pv=d.get("rp") if t == "ev" else None, vid=vid, sid=sid,
                sn=_int(d.get("sn"), 1, 100000) or 1, ts=datetime.utcnow(),
                host=str(d.get("h") or "")[:60], path=url[:300], page_type=page_type, product_no=prod,
                product_name=(str(d.get("n") or "").strip()[:120] or None) if page_type == "detail" else None,
                order_id=order, referrer=(str(d.get("r") or "")[:120] or None) if t == "pv" else None,
                utm_source=utm, device="pc" if d.get("d") == "pc" else "m",
            )
            await db.execute(pg_insert(J).values(**row).on_conflict_do_nothing(index_elements=["pvid"]))
            await db.commit()
        elif t == "sc":
            vals = {}
            for key, col, lo, hi in (("dp", J.desc_pct, -1, 100), ("pp", J.page_pct, -1, 100), ("sec", J.section, -1, 4)):
                if d.get(key) is not None:
                    x = _int(d.get(key), lo, hi)
                    if x is not None:
                        vals[col.key] = func.greatest(func.coalesce(col, -1), x)
            if d.get("ex") == 1:
                vals["expanded"] = True
            elif d.get("ex") == 0:
                vals["expanded"] = func.coalesce(J.expanded, False)
            dw = _int(d.get("dw"), 0, 6 * 3600 * 1000)
            if dw:
                vals["dwell_ms"] = func.greatest(func.coalesce(J.dwell_ms, 0), dw)
            if vals:
                await db.execute(update(J).where(J.pvid == pv, J.vid == vid).values(**vals))
                await db.commit()
    except Exception as e:  # 수집 실패는 조용히 (로그만)
        logger.debug(f"[journey] collect skip: {e}")
        try:
            await db.rollback()
        except Exception:
            pass
    return _NO


# ─── 조회 ───

def _range(start: Optional[str], end: Optional[str], default_days: int = 7):
    today = (datetime.utcnow() + KST).date()
    try:
        e = date.fromisoformat(end) if end else today
        s = date.fromisoformat(start) if start else e - timedelta(days=default_days - 1)
    except ValueError:
        raise HTTPException(status_code=400, detail="날짜는 YYYY-MM-DD 로 넣어 주세요")
    if s > e:
        s, e = e, s
    if (e - s).days > 92:
        raise HTTPException(status_code=400, detail="한 번에 최대 93일까지 볼 수 있어요")
    # KST 날짜 → UTC 범위
    return s, e, datetime.combine(s, datetime.min.time()) - KST, datetime.combine(e + timedelta(days=1), datetime.min.time()) - KST


_HOST_OK = J.host.like("%nuldam.com")


@router.get("/status")
async def status(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    since = datetime.utcnow() - timedelta(hours=24)
    r = await db.execute(select(J.kind, func.count()).where(J.ts >= since, _HOST_OK).group_by(J.kind))
    last24 = {k: c for k, c in r.all()}
    first = (await db.execute(select(func.min(J.ts)).where(_HOST_OK))).scalar()
    last = (await db.execute(select(func.max(J.ts)).where(_HOST_OK))).scalar()
    sc = (await db.execute(select(func.count()).where(J.ts >= since, J.desc_pct.isnot(None), _HOST_OK))).scalar()
    return {
        "last24h": last24, "scroll_measured_24h": sc,
        "first_kst": (first + KST).isoformat(timespec="minutes") if first else None,
        "last_kst": (last + KST).isoformat(timespec="minutes") if last else None,
    }


async def _order_mix(db: AsyncSession, where_sql: str, params: dict) -> list[tuple]:
    """mall_orders로 신규/재구매 판단: 같은 회원의 더 이른 결제 주문이 있으면 재구매."""
    q = text(f"""
        SELECT o.cafe24_order_id, o.member_id,
               EXISTS (SELECT 1 FROM mall_orders p
                       WHERE p.member_id = o.member_id AND p.status = 'paid'
                         AND (p.order_date < o.order_date
                              OR (p.order_date = o.order_date AND p.cafe24_order_id < o.cafe24_order_id))) AS rep
        FROM mall_orders o WHERE {where_sql}
    """)
    return [(a, b, c) for a, b, c in (await db.execute(q, params)).all()]


@router.get("/funnel")
async def funnel(
    start: Optional[str] = Query(None), end: Optional[str] = Query(None),
    entry: str = Query("all", description="all | main | list | detail | brand | other"),
    device: str = Query("all", description="all | m | pc"),
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    s, e, us, ue = _range(start, end)
    q = (select(J.sid, J.vid, J.ts, J.kind, J.page_type, J.sn, J.device, J.order_id, J.referrer, J.utm_source)
         .where(J.ts >= us, J.ts < ue, _HOST_OK).limit(MAX_ROWS + 1))
    rows = (await db.execute(q)).all()
    truncated = len(rows) > MAX_ROWS
    evs = [jn.Ev(sid=r[0], vid=r[1], ts=r[2], kind=r[3], page_type=r[4], sn=r[5] or 1, device=r[6] or "m",
                 order_id=r[7], referrer=r[8], utm_source=r[9]) for r in rows[:MAX_ROWS]]
    sessions = jn.build_sessions(evs)
    if entry != "all":
        sessions = [x for x in sessions if (x.entry == entry if entry != "other" else x.entry not in ("main", "list", "detail", "brand"))]
    if device in ("m", "pc"):
        sessions = [x for x in sessions if (x.device == "pc") == (device == "pc")]
    rep = jn.funnel_report(sessions)

    # 결제 완료 방문의 주문 → 신규/재구매 (mall_orders 수집이 늦으면 '확인 대기')
    tracked = sorted({o for x in sessions for o in x.orders})
    found = []
    if tracked:
        found = await _order_mix(db, "o.cafe24_order_id = ANY(:ids)", {"ids": tracked})
    found_ids = {r[0] for r in found}
    tracked_mix = jn.purchase_mix(found)
    tracked_mix["pending"] = len([o for o in tracked if o not in found_ids])

    # 기간 전체 주문(추적과 무관한 mall_orders 기준) — 비교용
    all_mix = jn.purchase_mix(await _order_mix(
        db, "o.status = 'paid' AND o.order_date BETWEEN :s AND :e", {"s": s, "e": e}))

    # 재구매 고객이 낀 방문의 전환율: 이 방문자가 기간 안 이전 방문에서 산 적이 있나는 알 수 없으므로
    # '첫 방문/다시 온 방문자' 구분(segments.visitor)으로 대신 보여 준다.
    rep.update({
        "start": s.isoformat(), "end": e.isoformat(), "entry": entry, "device": device,
        "truncated": truncated, "purchase_tracked": tracked_mix, "purchase_all": all_mix,
        "page_labels": jn.PAGE_LABEL,
    })
    return rep


@router.get("/scroll")
async def scroll(
    start: Optional[str] = Query(None), end: Optional[str] = Query(None),
    min_views: int = Query(30, ge=1, le=1000),
    device: str = Query("all", description="all | m | pc"),
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    s, e, us, ue = _range(start, end, default_days=14)
    base = (J.ts >= us, J.ts < ue, _HOST_OK)
    dev_f = (J.device == "pc",) if device == "pc" else (J.device != "pc",) if device == "m" else ()
    rows = (await db.execute(
        select(J.pvid, J.product_no, J.page_pct, J.section, J.expanded, J.desc_pct, J.dwell_ms)
        .where(*base, *dev_f, J.kind == "pv", J.page_type == "detail", J.product_no.isnot(None), J.page_pct.isnot(None))
        .limit(MAX_ROWS)
    )).all()
    clicked = set((await db.execute(
        select(J.ref_pv).where(*base, J.kind.in_(("cart_click", "buy_click")), J.ref_pv.isnot(None))
    )).scalars().all())
    views = [jn.View(product_no=r[1], page_pct=max(0, r[2]), section=max(0, r[3] if r[3] is not None else 0),
                     expanded=bool(r[4]), desc_pct=r[5] if r[4] else None, dwell_ms=r[6], clicked=r[0] in clicked)
             for r in rows]

    # 상품 이름: 기간 안 가장 최근에 받은 이름
    nm = (await db.execute(
        select(J.product_no, J.product_name, J.ts)
        .where(*base, J.page_type == "detail", J.product_name.isnot(None))
        .order_by(J.ts.desc()).limit(50000)
    )).all()
    names: dict[int, str] = {}
    for no, name, _ in nm:
        names.setdefault(no, name)
    # 떠날 때 기록이 안 온 상세 조회 수(앱 강제 종료 등) — 화면 안내용
    unmeasured = (await db.execute(
        select(func.count()).where(*base, *dev_f, J.kind == "pv", J.page_type == "detail", J.page_pct.is_(None))
    )).scalar()
    rep = jn.scroll_report(views, names, min_views=min_views)
    rep.update({"start": s.isoformat(), "end": e.isoformat(), "unmeasured": unmeasured})
    return rep
