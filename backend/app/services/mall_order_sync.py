"""몰 전체 주문(MallOrder) 적립 공용 헬퍼.

웹훅(app/api/v1/endpoints/webhooks.py), 폴러(app/services/cafe24_poller.py),
백필 API(app/api/v1/endpoints/kpi.py)가 공통으로 사용한다.
어필리에이트 귀속(ReferralConversion) 로직과는 완전히 분리된 별도 적립 경로.
"""
import logging
from datetime import date as _date, datetime as _dt
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.kpi import MallOrder

logger = logging.getLogger(__name__)


def _to_float(v) -> float:
    try:
        return float(v) if v is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def extract_order_amount(order: dict) -> float:
    """Cafe24 주문 payload에서 실결제 금액 추출.

    cafe24_poller._process_order 와 동일 로직 —
    initial_order_amount.payment_amount(최초 결제, 취소 후에도 보존) 우선.
    """
    initial_obj = order.get("initial_order_amount") or {}
    actual_obj = order.get("actual_order_amount") or {}
    if isinstance(initial_obj, dict):
        initial_payment = _to_float(initial_obj.get("payment_amount")) or _to_float(
            initial_obj.get("order_price_amount")
        )
    else:
        initial_payment = _to_float(initial_obj)
    if isinstance(actual_obj, dict):
        actual_now = _to_float(actual_obj.get("payment_amount")) or _to_float(
            actual_obj.get("order_price_amount")
        )
    else:
        actual_now = _to_float(actual_obj)
    return (
        initial_payment
        or actual_now
        or _to_float(order.get("payment_amount"))
        or _to_float(order.get("actual_payment_amount"))
        or _to_float(order.get("order_price_amount"))
        or 0.0
    )


def extract_order_status(order: dict) -> str:
    """paid | cancelled | refunded 판별. cafe24_poller의 is_refund/is_cancel 로직과 동일."""
    order_status = str(order.get("order_status") or "").upper()
    cancel_date = order.get("cancel_date")
    refund_amount = _to_float(order.get("refund_amount"))
    is_refund = refund_amount > 0 or order_status.startswith("R")
    is_cancel = bool(cancel_date) or order_status.startswith("C")
    if is_refund:
        return "refunded"
    if is_cancel:
        return "cancelled"
    return "paid"


def extract_order_date(order: dict) -> _date:
    """order_date/payment_date → date. 파싱 실패 시 오늘(UTC) 날짜로 폴백."""
    raw = order.get("order_date") or order.get("payment_date")
    if raw:
        try:
            parsed = _dt.fromisoformat(str(raw).replace("Z", "+00:00"))
            return parsed.date()
        except Exception:
            pass
    return _dt.utcnow().date()


def extract_member_id_or_none(order: dict) -> Optional[str]:
    member_id = str(order.get("member_id") or order.get("buyer_id") or "").strip()
    return member_id or None


async def upsert_mall_order(
    db: AsyncSession,
    *,
    cafe24_order_id: str,
    order_date: _date,
    member_id: Optional[str],
    amount: float,
    status: str,
    source: str,
) -> MallOrder:
    """MallOrder upsert.

    - amount: 기존에 이미 확보된(0보다 큰) 금액을 0으로 덮어쓰지 않음
      (웹훅이 amount=0으로 먼저 적립 → 폴러/백필이 실금액으로 보강하는 구조 보호).
    - status: 항상 최신값으로 갱신 (취소/환불 반영).
    - source: poller/backfill이 더 신뢰도 높은 원천이므로 webhook이 이를 덮어쓰지 않음.
    """
    result = await db.execute(
        select(MallOrder).where(MallOrder.cafe24_order_id == str(cafe24_order_id))
    )
    existing = result.scalar_one_or_none()

    if existing is None:
        row = MallOrder(
            cafe24_order_id=str(cafe24_order_id),
            order_date=order_date,
            member_id=member_id,
            amount=amount or 0.0,
            status=status or "paid",
            source=source,
        )
        db.add(row)
        await db.commit()
        await db.refresh(row)
        return row

    # order_date는 최초값 유지가 원칙이나, 누락돼 있었다면 보강
    if order_date:
        existing.order_date = order_date
    if member_id:
        existing.member_id = member_id
    if amount and amount > 0:
        existing.amount = amount
    elif existing.amount is None:
        existing.amount = 0.0
    if status:
        existing.status = status
    if source in ("poller", "backfill"):
        existing.source = source
    elif existing.source is None:
        existing.source = source

    await db.commit()
    await db.refresh(existing)
    return existing
