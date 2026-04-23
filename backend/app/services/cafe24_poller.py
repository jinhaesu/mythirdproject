"""
Cafe24 주문 폴링 서비스.

Cafe24 앱이 Under Review 상태에서 실이벤트 웹훅을 발사하지 않는 경우의
fallback. 주기적으로 /api/v2/admin/orders 를 조회해 ReferralConversion에
기록한다. 웹훅이 정상화되면 이 폴러를 끄거나 이중 체크용으로 둘 수 있다.
"""
import logging
import re
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select

from app.db.database import AsyncSessionLocal
from app.models.affiliate import (
    AffiliateCampaign,
    AffiliatePartner,
    ReferralClick,
    ReferralConversion,
)
from app.models.partner_campaign import PartnerCampaign
from app.models.user import User
from app.services import cafe24 as cafe24_svc

logger = logging.getLogger(__name__)

_REF_RE = re.compile(r"ref=([A-Za-z0-9_-]+)")


def _extract_ref(text: str) -> Optional[str]:
    if not text:
        return None
    m = _REF_RE.search(text)
    return m.group(1) if m else None


async def _get_shared_cafe24_user(db) -> Optional[User]:
    result = await db.execute(
        select(User).where(
            User.cafe24_access_token.isnot(None),
            User.cafe24_access_token != "",
        ).limit(1)
    )
    return result.scalar_one_or_none()


async def _process_order(db, order: dict) -> dict:
    """
    주문 하나를 처리. 웹훅 핸들러와 동일한 attribution 로직.

    1. order_id로 기존 conversion 조회
    2. 환불/취소 상태면 status 업데이트
    3. 신규 주문이면 coupon/ref/최근클릭 순으로 매칭
    """
    order_id = order.get("order_id")
    if not order_id:
        return {"status": "skipped", "reason": "no_order_id"}

    # 주문 상태 판별
    order_status = str(order.get("order_status") or "").upper()
    cancel_date = order.get("cancel_date")
    refund_amount = float(order.get("refund_amount") or 0)
    # Cafe24 orders API:
    # - initial_order_amount는 중첩 객체: {order_price_amount, payment_amount, ...}
    #   initial_order_amount.payment_amount = 최초 결제 금액 (취소 후에도 보존)
    # - top-level payment_amount / actual_payment_amount는 취소 시 0이 됨
    def _f(v) -> float:
        try:
            return float(v) if v is not None else 0.0
        except (TypeError, ValueError):
            return 0.0

    initial_obj = order.get("initial_order_amount") or {}
    actual_obj = order.get("actual_order_amount") or {}
    # dict인 경우 내부 필드 추출, 과거 flat 필드 케이스는 0
    if isinstance(initial_obj, dict):
        initial_payment = _f(initial_obj.get("payment_amount")) or _f(initial_obj.get("order_price_amount"))
    else:
        initial_payment = _f(initial_obj)
    if isinstance(actual_obj, dict):
        actual_now = _f(actual_obj.get("payment_amount")) or _f(actual_obj.get("order_price_amount"))
    else:
        actual_now = _f(actual_obj)

    actual_payment = (
        initial_payment
        or actual_now
        or _f(order.get("payment_amount"))
        or _f(order.get("actual_payment_amount"))
        or _f(order.get("order_price_amount"))
        or 0.0
    )
    paid_flag = str(order.get("paid") or "").upper() == "T"

    # 기존 conversion 조회
    existing_r = await db.execute(
        select(ReferralConversion).where(ReferralConversion.cafe24_order_id == order_id)
    )
    existing = existing_r.scalar_one_or_none()

    # 환불/취소 처리
    is_refund = refund_amount > 0 or order_status.startswith("R")  # R40/R50 등
    is_cancel = bool(cancel_date) or order_status.startswith("C")  # C40/C50 등

    if existing:
        new_status = None
        if is_refund and existing.status != "refunded":
            new_status = "refunded"
        elif is_cancel and existing.status not in ("refunded", "cancelled"):
            new_status = "cancelled"
        if new_status:
            existing.status = new_status
            existing.refunded_amount = refund_amount if refund_amount > 0 else existing.order_amount
            existing.refunded_at = datetime.utcnow()
            await db.commit()
            logger.info(
                f"[Poller] order={order_id} status -> {new_status} (refund={refund_amount})"
            )
            return {"status": f"{new_status}_updated", "conversion_id": existing.id}
        return {"status": "already_recorded", "conversion_id": existing.id}

    # 신규 주문: paid 또는 취소/환불 상태여도 attribution 가능하면 기록
    # (취소/환불로 이미 들어온 주문도 attribution 성공 시 cancelled/refunded 상태로 생성)
    if not paid_flag and actual_payment <= 0 and not is_cancel and not is_refund:
        return {"status": "skipped", "reason": "not_paid"}

    # Attribution 매칭
    used_coupons = order.get("coupons") or order.get("order_coupons") or []
    coupon_codes = [
        c.get("coupon_code") or c.get("code")
        for c in used_coupons
        if c.get("coupon_code") or c.get("code")
    ]
    order_memo = order.get("order_memo") or ""
    # Cafe24 주문에서 ref는 보통 order_memo 또는 별도 utm 필드에 없음
    ref_code = _extract_ref(order_memo)

    campaign: Optional[AffiliateCampaign] = None
    partner: Optional[AffiliatePartner] = None

    # 1) ref 코드로 매칭
    if ref_code:
        pc_r = await db.execute(
            select(PartnerCampaign).where(PartnerCampaign.referral_code == ref_code)
        )
        pc = pc_r.scalar_one_or_none()
        if pc:
            p_r = await db.execute(
                select(AffiliatePartner).where(AffiliatePartner.id == pc.partner_id)
            )
            partner = p_r.scalar_one_or_none()
            c_r = await db.execute(
                select(AffiliateCampaign).where(AffiliateCampaign.id == pc.campaign_id)
            )
            campaign = c_r.scalar_one_or_none()

    # 2) 쿠폰 코드로 캠페인 매칭
    if not campaign:
        for code in coupon_codes:
            c_r = await db.execute(
                select(AffiliateCampaign).where(AffiliateCampaign.cafe24_coupon_code == code)
            )
            campaign = c_r.scalar_one_or_none()
            if campaign:
                break

    click_id = None

    # 3) 상품 기반 매칭 — 주문 상품이 어떤 캠페인의 cafe24_product_no와 일치하면
    #    그 캠페인의 "주문 시점 기준 이전 2시간 내" 클릭의 파트너로 귀속.
    #    (쿠폰 안 써도 동작. 반드시 click ≤ order_date 여야 함 —
    #     폴러 지연 실행 시 주문 이후의 클릭이 잘못 귀속되는 것 방지.)
    if not campaign:
        # 주문 상품 번호 수집
        product_nos = set()
        # ordering_product_code는 문자열 코드일 수 있으므로 items embed 우선
        items = order.get("items") or []
        for it in items:
            pn = it.get("product_no")
            if pn:
                try:
                    product_nos.add(int(pn))
                except (ValueError, TypeError):
                    pass
        # items embed가 없거나 product_no 없으면 ordering_product_no 필드 시도
        if not product_nos:
            opn = order.get("ordering_product_no") or order.get("product_no")
            if opn:
                try:
                    product_nos.add(int(opn))
                except (ValueError, TypeError):
                    pass

        # 주문 시각 파싱 (Cafe24: ISO8601 with timezone, 예: 2026-04-23T00:46:43+09:00)
        # → naive UTC datetime으로 변환 (ReferralClick.clicked_at이 naive UTC)
        from datetime import timezone as _tz
        order_dt_utc = None
        order_date_str = order.get("order_date") or order.get("payment_date")
        if order_date_str:
            try:
                parsed = datetime.fromisoformat(str(order_date_str).replace("Z", "+00:00"))
                if parsed.tzinfo is not None:
                    order_dt_utc = parsed.astimezone(_tz.utc).replace(tzinfo=None)
                else:
                    order_dt_utc = parsed
            except Exception:
                order_dt_utc = None

        if product_nos:
            # 매칭 캠페인 찾기
            camp_r = await db.execute(
                select(AffiliateCampaign).where(
                    AffiliateCampaign.cafe24_product_no.in_(list(product_nos))
                )
            )
            candidates = list(camp_r.scalars().all())
            # 주문 시각 ± 2시간 — 시각을 모르면 매칭 스킵 (잘못된 귀속 방지)
            best_click = None
            if order_dt_utc is None:
                logger.warning(
                    f"[Poller] order={order_id} order_date 파싱 실패 — 상품매칭 스킵"
                )
            else:
                window_start = order_dt_utc - timedelta(hours=2)
                window_end = order_dt_utc + timedelta(minutes=10)
                for cand in candidates:
                    click_r = await db.execute(
                        select(ReferralClick)
                        .where(
                            ReferralClick.campaign_id == cand.id,
                            ReferralClick.clicked_at >= window_start,
                            ReferralClick.clicked_at <= window_end,
                        )
                        .order_by(ReferralClick.clicked_at.desc())
                        .limit(1)
                    )
                    rc = click_r.scalar_one_or_none()
                    if rc and (best_click is None or rc.clicked_at > best_click.clicked_at):
                        best_click = rc
                        campaign = cand
            if best_click:
                click_id = best_click.id
                p_r = await db.execute(
                    select(AffiliatePartner).where(AffiliatePartner.id == best_click.partner_id)
                )
                partner = p_r.scalar_one_or_none()
                logger.info(
                    f"[Poller] order={order_id} 상품 기반 매칭: "
                    f"products={product_nos} campaign={campaign.id} "
                    f"partner={partner.id if partner else None} "
                    f"order_at={order_dt_utc} click_at={best_click.clicked_at}"
                )

    # 쿠폰으로 캠페인만 매칭된 경우: 같은 캠페인의 최근 클릭으로 파트너 보완
    if not partner and campaign:
        since_recent = datetime.utcnow() - timedelta(days=7)
        click_r = await db.execute(
            select(ReferralClick)
            .where(
                ReferralClick.campaign_id == campaign.id,
                ReferralClick.clicked_at >= since_recent,
            )
            .order_by(ReferralClick.clicked_at.desc())
            .limit(1)
        )
        rc = click_r.scalar_one_or_none()
        if rc:
            click_id = rc.id
            p_r = await db.execute(
                select(AffiliatePartner).where(AffiliatePartner.id == rc.partner_id)
            )
            partner = p_r.scalar_one_or_none()

    if not campaign and not partner:
        return {"status": "no_match_strict", "order_id": order_id}

    if not partner:
        return {"status": "no_partner", "order_id": order_id, "campaign_id": campaign.id if campaign else None}

    # 커미션 계산
    commission = 0.0
    if campaign:
        if campaign.commission_type == "percentage":
            commission = actual_payment * (campaign.commission_rate / 100)
        else:
            commission = campaign.commission_rate

    # 이미 취소/환불 상태로 처음 들어온 주문도 적절한 status로 기록
    initial_status = "refunded" if is_refund else ("cancelled" if is_cancel else "paid")
    refunded_at_value = datetime.utcnow() if initial_status in ("refunded", "cancelled") else None
    refunded_amount_value = refund_amount if initial_status == "refunded" else (actual_payment if initial_status == "cancelled" else 0.0)

    conv = ReferralConversion(
        click_id=click_id,
        partner_id=partner.id,
        campaign_id=campaign.id if campaign else None,
        order_id=order_id,
        cafe24_order_id=order_id,
        order_amount=actual_payment,
        commission_amount=round(commission, 2),
        status=initial_status,
        refunded_amount=refunded_amount_value,
        refunded_at=refunded_at_value,
    )
    db.add(conv)
    await db.commit()
    await db.refresh(conv)
    logger.info(
        f"[Poller] conversion recorded: order={order_id} partner={partner.id} "
        f"campaign={campaign.id if campaign else None} amount={actual_payment} "
        f"commission={commission} status={initial_status}"
    )
    return {"status": "recorded", "conversion_id": conv.id}


async def poll_cafe24_orders(lookback_hours: int = 24) -> dict:
    """
    Cafe24 주문 조회 → ReferralConversion에 반영.

    lookback_hours: 몇 시간 전까지 주문을 조회할지. 기본 24시간.
    """
    async with AsyncSessionLocal() as db:
        shared = await _get_shared_cafe24_user(db)
        if not shared:
            return {"status": "skipped", "reason": "no_cafe24_user"}

        end = datetime.utcnow()
        start = end - timedelta(hours=lookback_hours)
        try:
            orders = await cafe24_svc.list_orders(shared, db, start, end, limit=500)
        except Exception as e:
            logger.error(f"[Poller] list_orders failed: {e}")
            return {"status": "error", "error": str(e)}

        counts = {"recorded": 0, "already_recorded": 0, "no_match": 0, "skipped": 0, "error": 0, "updated": 0}
        for o in orders:
            try:
                r = await _process_order(db, o)
                st = r.get("status", "skipped")
                if "recorded" == st:
                    counts["recorded"] += 1
                elif "updated" in st:
                    counts["updated"] += 1
                elif st == "already_recorded":
                    counts["already_recorded"] += 1
                elif st == "no_match":
                    counts["no_match"] += 1
                else:
                    counts["skipped"] += 1
            except Exception as e:
                counts["error"] += 1
                logger.error(f"[Poller] order {o.get('order_id')} process error: {e}")

        logger.info(f"[Poller] done — total={len(orders)} {counts}")
        return {"status": "ok", "total": len(orders), **counts}
