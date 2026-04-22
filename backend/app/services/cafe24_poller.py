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
    actual_payment = float(
        order.get("actual_payment_amount")
        or order.get("order_price_amount")
        or order.get("payment_amount")
        or 0
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

    # 결제완료 상태 아니면 신규 생성 안 함
    if not paid_flag and actual_payment <= 0:
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

    # 3) 전역 최근 클릭 fallback (2시간 내)
    click_id = None
    if not campaign and not partner:
        since_recent = datetime.utcnow() - timedelta(hours=2)
        click_r = await db.execute(
            select(ReferralClick)
            .where(ReferralClick.clicked_at >= since_recent)
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
            if rc.campaign_id:
                c_r = await db.execute(
                    select(AffiliateCampaign).where(AffiliateCampaign.id == rc.campaign_id)
                )
                campaign = c_r.scalar_one_or_none()

    if not campaign and not partner:
        return {"status": "no_match", "order_id": order_id}

    # 파트너 보완: 같은 캠페인 최근 클릭
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

    if not partner:
        return {"status": "no_partner", "order_id": order_id, "campaign_id": campaign.id if campaign else None}

    # 커미션 계산
    commission = 0.0
    if campaign:
        if campaign.commission_type == "percentage":
            commission = actual_payment * (campaign.commission_rate / 100)
        else:
            commission = campaign.commission_rate

    conv = ReferralConversion(
        click_id=click_id,
        partner_id=partner.id,
        campaign_id=campaign.id if campaign else None,
        order_id=order_id,
        cafe24_order_id=order_id,
        order_amount=actual_payment,
        commission_amount=round(commission, 2),
        status="paid",
    )
    db.add(conv)
    await db.commit()
    await db.refresh(conv)
    logger.info(
        f"[Poller] conversion recorded: order={order_id} partner={partner.id} "
        f"campaign={campaign.id if campaign else None} amount={actual_payment} commission={commission}"
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
