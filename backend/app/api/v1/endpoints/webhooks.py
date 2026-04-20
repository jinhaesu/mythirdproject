"""Webhook endpoints — Cafe24 주문 이벤트 수신."""
import base64
import hashlib
import hmac
import json
import logging
import re
from datetime import datetime, timedelta

from fastapi import APIRouter, Request, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.database import get_db
from app.models.affiliate import (
    AffiliateCampaign,
    AffiliatePartner,
    ReferralClick,
    ReferralConversion,
)

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter()


def _verify_hmac(raw: bytes, signature: str) -> bool:
    """Cafe24 웹훅 HMAC-SHA256 서명 검증. 시크릿 미설정이면 거부."""
    secret = settings.CAFE24_WEBHOOK_SECRET
    if not secret:
        # 보안상 시크릿 없이 통과시키지 않음 — 위조된 전환 방지
        logger.error("[Webhook] CAFE24_WEBHOOK_SECRET 미설정 — 웹훅 거부")
        return False
    if not signature:
        return False
    computed = base64.b64encode(
        hmac.new(secret.encode(), raw, hashlib.sha256).digest()
    ).decode()
    return hmac.compare_digest(computed, signature)


def _extract_ref_code(text: str) -> str | None:
    """URL 또는 텍스트에서 ref= 파라미터 추출."""
    if not text:
        return None
    m = re.search(r"ref=([A-Za-z0-9_-]+)", text)
    return m.group(1) if m else None


@router.post("/cafe24/orders")
async def cafe24_order_webhook(request: Request):
    """
    Cafe24 주문 완료 웹훅.

    헤더 X-Cafe24-Hmac-Sha256 검증 후 쿠폰 코드로 파트너/캠페인 매칭,
    커미션을 ReferralConversion에 기록합니다.
    """
    raw = await request.body()
    signature = request.headers.get("X-Cafe24-Hmac-Sha256", "")

    if not _verify_hmac(raw, signature):
        raise HTTPException(status_code=401, detail="HMAC 서명 불일치")

    try:
        data = json.loads(raw)
    except Exception:
        raise HTTPException(status_code=400, detail="JSON 파싱 실패")

    resource = data.get("resource", {})
    order_id = resource.get("order_id")
    mall_id = resource.get("mall_id")
    used_coupons = resource.get("coupons") or resource.get("order_coupons") or []
    total_price = float(
        resource.get("order_price_amount") or resource.get("payment_amount") or 0
    )
    buyer_id = resource.get("buyer_id") or resource.get("member_id")
    order_memo = resource.get("order_memo") or ""
    landing_url_in_payload = resource.get("landing_url") or ""

    if not order_id:
        return {"status": "skipped", "reason": "order_id 없음"}

    # DB 세션은 직접 생성 (Depends 미사용 — 인증 없는 엔드포인트)
    from app.db.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        # 중복 체크
        dup = await db.execute(
            select(ReferralConversion).where(ReferralConversion.cafe24_order_id == order_id)
        )
        if dup.scalar_one_or_none():
            return {"status": "duplicate"}

        # ── Attribution 우선순위 ─────────────────────────────
        # 1) ref= 파라미터 먼저 (PartnerCampaign → AffiliatePartner → AffiliateCampaign)
        # 2) 쿠폰 코드로 캠페인 매칭
        # 3) 양쪽 다 없으면 스킵
        # ─────────────────────────────────────────────────────
        from app.models.partner_campaign import PartnerCampaign as PC

        campaign = None
        partner = None
        click_id = None

        ref_code = _extract_ref_code(order_memo) or _extract_ref_code(landing_url_in_payload)

        if ref_code:
            # PartnerCampaign 우선
            pc_result = await db.execute(
                select(PC).where(PC.referral_code == ref_code)
            )
            pc = pc_result.scalar_one_or_none()
            if pc:
                partner_id_ref = pc.partner_id
                p_result = await db.execute(
                    select(AffiliatePartner).where(AffiliatePartner.id == partner_id_ref)
                )
                partner = p_result.scalar_one_or_none()
                camp_result = await db.execute(
                    select(AffiliateCampaign).where(AffiliateCampaign.id == pc.campaign_id)
                )
                campaign = camp_result.scalar_one_or_none()
            else:
                # AffiliatePartner 코드
                p_result = await db.execute(
                    select(AffiliatePartner).where(AffiliatePartner.referral_code == ref_code)
                )
                partner = p_result.scalar_one_or_none()
                # 캠페인은 쿠폰으로 보완 매칭
                if partner and partner.campaign_id:
                    camp_result = await db.execute(
                        select(AffiliateCampaign).where(AffiliateCampaign.id == partner.campaign_id)
                    )
                    campaign = camp_result.scalar_one_or_none()
                else:
                    # AffiliateCampaign 자체 코드
                    camp_result = await db.execute(
                        select(AffiliateCampaign).where(AffiliateCampaign.referral_code == ref_code)
                    )
                    campaign = camp_result.scalar_one_or_none()

        # 쿠폰 코드로 캠페인 보완/덮어쓰기
        coupon_codes = [c.get("coupon_code") or c.get("code") for c in used_coupons if c.get("coupon_code") or c.get("code")]
        if not campaign:
            for coupon_code in coupon_codes:
                camp_result = await db.execute(
                    select(AffiliateCampaign).where(AffiliateCampaign.cafe24_coupon_code == coupon_code)
                )
                campaign = camp_result.scalar_one_or_none()
                if campaign:
                    break

        if not campaign and not partner:
            logger.info(
                f"[Webhook] order={order_id} — 매칭 없음 (coupons={coupon_codes}, ref={ref_code})"
            )
            return {"status": "no_match"}

        # 파트너 미확정 시 최근 클릭으로 보완
        if not partner and campaign:
            since = datetime.utcnow() - timedelta(days=7)
            click_result = await db.execute(
                select(ReferralClick)
                .where(
                    ReferralClick.campaign_id == campaign.id,
                    ReferralClick.clicked_at >= since,
                )
                .order_by(ReferralClick.clicked_at.desc())
                .limit(1)
            )
            click = click_result.scalar_one_or_none()
            if click:
                click_id = click.id
                p_result = await db.execute(
                    select(AffiliatePartner).where(AffiliatePartner.id == click.partner_id)
                )
                partner = p_result.scalar_one_or_none()

        if not partner:
            logger.info(f"[Webhook] order={order_id} — 파트너 attribution 실패")
            return {"status": "no_partner_match"}

        # 커미션 계산
        commission_amount = 0.0
        if campaign.commission_type == "percentage":
            commission_amount = total_price * (campaign.commission_rate / 100)
        else:
            commission_amount = campaign.commission_rate

        conversion = ReferralConversion(
            click_id=click_id,
            partner_id=partner.id,
            campaign_id=campaign.id,
            order_id=order_id,
            cafe24_order_id=order_id,
            order_amount=total_price,
            commission_amount=round(commission_amount, 2),
        )
        db.add(conversion)
        await db.commit()
        await db.refresh(conversion)

        logger.info(
            f"[Webhook] Conversion recorded: order={order_id} "
            f"partner={partner.id} campaign={campaign.id} commission={commission_amount}"
        )
        return {"status": "recorded", "conversion_id": conversion.id}
