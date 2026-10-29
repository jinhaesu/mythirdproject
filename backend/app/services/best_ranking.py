"""공식몰 베스트 TOP 10 — 우리 판매 데이터(카페24 주문 품목 수량) 기준 순위.

- 기간: KST 오늘을 뺀 최근 7일(D-7 ~ D-1). 7일치가 부족하거나 적재가 늦으면 30일로 넓힘,
  그것도 없거나 카페24 조회가 실패하면 basis='cafe24_popular'(빈 목록)로 내보내 화면이 카페24 인기순을 씀.
- 수량: 결제 완료(paid=T)·미취소 주문의 품목 중 order_status가 N10~N50(입금 후 정상 진행)인 것만.
  취소(C*)·반품(R*)·교환(E*)·입금 전(N00)은 제외.
- 공구·이벤트·링크 전용 상품번호는 app/data/best_ranking_map.json(작업자 Q 상품명 체계)으로
  같은 제품의 대표 진열 상품 하나에 합산. 매핑에 없는 상품번호(숨김·적립금·공구 전용 세트 등)는 순위에서 뺌.
- 내보내는 값: 순위·대표 상품번호·집계 기간·갱신 시각·기준. 수량·매출·회원정보는 내보내지 않음.
- 캐시: 프로세스 메모리 1시간(min-instances=1). 갱신 중엔 직전 값을 그대로 냄.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from collections import Counter
from datetime import date, datetime, timedelta

logger = logging.getLogger(__name__)

TTL = timedelta(hours=1)
TOP_N = 10
MIN_REPS = 10            # 이보다 적은 제품만 팔렸으면 기간을 넓힘
_MAP_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "best_ranking_map.json")

_cache: dict = {"data": None, "at": None}
_lock = asyncio.Lock()
_map: dict | None = None


def _kst_now() -> datetime:
    return datetime.utcnow() + timedelta(hours=9)


def product_map() -> dict[int, int]:
    global _map
    if _map is None:
        with open(_MAP_PATH, encoding="utf-8") as f:
            raw = json.load(f)
        _map = {int(k): int(v) for k, v in raw["product_to_rep"].items()}
    return _map


def item_counts(item: dict) -> bool:
    st = str(item.get("order_status") or "").upper()
    return st.startswith("N") and st != "N00"


def tally(orders: list[dict], pmap: dict[int, int]) -> tuple[Counter, set]:
    """주문 목록 → 대표 상품번호별 수량, 주문이 있었던 날짜 집합."""
    qty: Counter = Counter()
    days: set = set()
    for o in orders:
        if str(o.get("paid") or "").upper() != "T" or str(o.get("canceled") or "").upper() == "T":
            continue
        od = str(o.get("order_date") or "")[:10]
        if od:
            days.add(od)
        for it in o.get("items") or []:
            if not item_counts(it):
                continue
            try:
                pno = int(it.get("product_no") or 0)
                q = int(it.get("quantity") or 0)
            except (TypeError, ValueError):
                continue
            rep = pmap.get(pno)
            if rep and q > 0:
                qty[rep] += q
    return qty, days


async def _fetch_day(user, db, d: date) -> list[dict]:
    from app.services import cafe24 as cafe24_svc
    out: list[dict] = []
    offset = 0
    while True:
        data = await cafe24_svc.api_request(user, db, "GET", "/api/v2/admin/orders", params={
            "start_date": d.isoformat(), "end_date": d.isoformat(),
            "limit": 1000, "offset": offset, "embed": "items",
        })
        rows = data.get("orders") or []
        out.extend(rows)
        if len(rows) < 1000 or offset >= 14000:
            break
        offset += 1000
        await asyncio.sleep(0.3)
    return out


def _result(basis: str, frm: date | None, to: date | None, qty: Counter | None) -> dict:
    labels = {"sales_7d": "최근 7일 판매량 기준", "sales_30d": "최근 30일 판매량 기준",
              "cafe24_popular": "널담 공식몰 인기순"}
    items = []
    if qty:
        ranked = sorted(qty.items(), key=lambda kv: (-kv[1], kv[0]))[:TOP_N]
        items = [{"rank": i + 1, "product_no": p} for i, (p, _) in enumerate(ranked)]
    return {
        "basis": basis,
        "label": labels[basis],
        "from": frm.isoformat() if frm else None,
        "to": to.isoformat() if to else None,
        "updated_at": _kst_now().replace(microsecond=0).isoformat() + "+09:00",
        "items": items,
    }


async def compute(db) -> dict:
    from app.services.cafe24_promo import main_cafe24_user
    pmap = product_map()
    user = await main_cafe24_user(db)
    if user is None:
        return _result("cafe24_popular", None, None, None)
    today = _kst_now().date()
    to = today - timedelta(days=1)
    orders: list[dict] = []
    try:
        for n in range(1, 8):
            orders.extend(await _fetch_day(user, db, today - timedelta(days=n)))
            await asyncio.sleep(0.2)
        qty, days = tally(orders, pmap)
        fresh = to.isoformat() in days or (to - timedelta(days=1)).isoformat() in days
        if len(qty) >= MIN_REPS and fresh:
            return _result("sales_7d", today - timedelta(days=7), to, qty)
        for n in range(8, 31):
            orders.extend(await _fetch_day(user, db, today - timedelta(days=n)))
            await asyncio.sleep(0.2)
        qty, days = tally(orders, pmap)
        if len(qty) >= MIN_REPS:
            return _result("sales_30d", today - timedelta(days=30), to, qty)
    except Exception as e:  # 카페24 조회 실패 → 화면이 카페24 인기순 사용
        logger.warning(f"[best_ranking] 주문 조회 실패: {e}")
    return _result("cafe24_popular", None, None, None)


async def get_ranking(db, force: bool = False) -> dict:
    now = datetime.utcnow()
    if not force and _cache["data"] is not None and now - _cache["at"] < TTL:
        return _cache["data"]
    if _lock.locked() and _cache["data"] is not None:
        return _cache["data"]
    async with _lock:
        if not force and _cache["data"] is not None and datetime.utcnow() - _cache["at"] < TTL:
            return _cache["data"]
        data = await compute(db)
        # 실패 결과는 10분만 캐시 — 곧 다시 시도
        _cache["data"] = data
        _cache["at"] = datetime.utcnow() - (TTL - timedelta(minutes=10) if data["basis"] == "cafe24_popular" else timedelta(0))
        return data
