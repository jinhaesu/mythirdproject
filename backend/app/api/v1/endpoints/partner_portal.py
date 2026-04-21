"""파트너 포털 API — 내 정보, 대시보드 KPI, 캠페인 성과."""
import json
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.partner_auth import get_current_partner
from app.db.database import get_db
from app.models.affiliate import (
    AffiliateCampaign,
    AffiliatePartner,
    AffiliateSettlement,
    ReferralClick,
    ReferralConversion,
)
from app.models.partner_campaign import PartnerCampaign

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# 내부 헬퍼
# ---------------------------------------------------------------------------

def _parse_channels(channels_str: Optional[str]) -> Optional[List[str]]:
    """JSON 문자열로 저장된 channels 컬럼을 list로 파싱."""
    if not channels_str:
        return None
    try:
        parsed = json.loads(channels_str)
        if isinstance(parsed, list):
            return parsed
    except (json.JSONDecodeError, ValueError):
        pass
    return [c.strip() for c in channels_str.split(",") if c.strip()]


def _build_referral_link_simple(
    campaign: Optional[AffiliateCampaign],
    code: str,
) -> str:
    """
    파트너 포털용 레퍼럴 링크 빌드 (user 컨텍스트 없이).

    Cafe24 상품 연결 여부와 캠페인 landing_url을 순서대로 확인한다.
    """
    from app.core.config import get_settings as _gs
    _s = _gs()
    if campaign and campaign.cafe24_product_no and _s.CAFE24_PUBLIC_DOMAIN:
        domain = _s.CAFE24_PUBLIC_DOMAIN.replace("https://", "").replace("http://", "").rstrip("/")
        url = f"https://{domain}/product/detail.html?product_no={campaign.cafe24_product_no}"
        if campaign.cafe24_coupon_code:
            url += f"&coupon={campaign.cafe24_coupon_code}"
        url += f"&ref={code}"
        return url
    if campaign and campaign.landing_url:
        sep = "&" if "?" in campaign.landing_url else "?"
        return f"{campaign.landing_url}{sep}ref={code}"
    fallback = f"https://{_s.CAFE24_PUBLIC_DOMAIN}" if _s.CAFE24_PUBLIC_DOMAIN else "https://nuldam.com"
    return f"{fallback}?ref={code}"


# ---------------------------------------------------------------------------
# 엔드포인트
# ---------------------------------------------------------------------------

@router.get("/me")
async def get_partner_me(
    partner: AffiliatePartner = Depends(get_current_partner),
):
    """로그인한 파트너의 자기 정보 반환."""
    return {
        "id": partner.id,
        "name": partner.name,
        "email": partner.email,
        "phone": partner.phone,
        "channel": partner.channel,
        "channels": _parse_channels(partner.channels),
        "followers": partner.followers,
        "status": partner.status,
        "referral_code": partner.referral_code,
        "referral_link": partner.referral_link,
        "memo": partner.memo,
        "created_at": partner.created_at,
    }


@router.get("/dashboard")
async def get_partner_dashboard(
    partner: AffiliatePartner = Depends(get_current_partner),
    db: AsyncSession = Depends(get_db),
):
    """
    파트너 대시보드 KPI 집계.

    - total_products: 연결된 캠페인(상품) 수 (PartnerCampaign + legacy)
    - total_clicks / total_conversions / conversion_rate
    - total_sales / avg_order_value
    - total_commission / unpaid_commission / paid_commission
    """
    partner_id = partner.id

    # PartnerCampaign 목록
    pc_result = await db.execute(
        select(PartnerCampaign).where(PartnerCampaign.partner_id == partner_id)
    )
    pcs = list(pc_result.scalars().all())
    pc_campaign_ids = {pc.campaign_id for pc in pcs}

    # legacy campaign_id 처리 (PartnerCampaign에 없는 경우 +1)
    legacy_extra = (
        1
        if (partner.campaign_id and partner.campaign_id not in pc_campaign_ids)
        else 0
    )
    total_products = len(pcs) + legacy_extra

    # 전체 클릭
    clicks_result = await db.execute(
        select(func.count(ReferralClick.id)).where(
            ReferralClick.partner_id == partner_id
        )
    )
    total_clicks = clicks_result.scalar() or 0

    # 전환 / 매출 / 커미션
    conv_result = await db.execute(
        select(
            func.count(ReferralConversion.id),
            func.coalesce(func.sum(ReferralConversion.order_amount), 0),
            func.coalesce(func.sum(ReferralConversion.commission_amount), 0),
        ).where(ReferralConversion.partner_id == partner_id)
    )
    conv_row = conv_result.one()
    total_conversions = conv_row[0] or 0
    total_sales = float(conv_row[1])
    total_commission = float(conv_row[2])

    # 전환율 / 객단가
    conversion_rate = round((total_conversions / total_clicks * 100), 2) if total_clicks > 0 else 0.0
    avg_order_value = round(total_sales / total_conversions, 2) if total_conversions > 0 else 0.0

    # 지급 완료 커미션
    paid_result = await db.execute(
        select(func.coalesce(func.sum(AffiliateSettlement.amount), 0)).where(
            AffiliateSettlement.partner_id == partner_id,
            AffiliateSettlement.status == "paid",
        )
    )
    paid_commission = float(paid_result.scalar() or 0)
    unpaid_commission = round(total_commission - paid_commission, 2)

    return {
        "total_products": total_products,
        "total_clicks": total_clicks,
        "total_conversions": total_conversions,
        "conversion_rate": conversion_rate,
        "total_sales": total_sales,
        "avg_order_value": avg_order_value,
        "total_commission": total_commission,
        "unpaid_commission": unpaid_commission,
        "paid_commission": paid_commission,
    }


@router.get("/campaigns")
async def get_partner_campaigns(
    partner: AffiliatePartner = Depends(get_current_partner),
    db: AsyncSession = Depends(get_db),
):
    """
    파트너에 연결된 캠페인별 성과 + 레퍼럴 링크 목록.

    PartnerCampaign 행을 순회하며 집계하고,
    PartnerCampaign에 없는 legacy campaign_id도 가상 row로 포함한다.
    """
    partner_id = partner.id

    # PartnerCampaign 목록
    pc_result = await db.execute(
        select(PartnerCampaign).where(PartnerCampaign.partner_id == partner_id)
    )
    pcs = list(pc_result.scalars().all())
    pc_campaign_ids = {pc.campaign_id for pc in pcs}

    # legacy 가상 row
    if partner.campaign_id and partner.campaign_id not in pc_campaign_ids:
        class _VirtualPC:
            id = -1
            partner_id = partner_id
            campaign_id = partner.campaign_id
            referral_code = partner.referral_code
            referral_link = partner.referral_link
        pcs.append(_VirtualPC())  # type: ignore[arg-type]

    result_rows = []
    for pc in pcs:
        # 캠페인 조회
        camp_result = await db.execute(
            select(AffiliateCampaign).where(AffiliateCampaign.id == pc.campaign_id)
        )
        campaign = camp_result.scalar_one_or_none()

        # 클릭 수
        clicks_result = await db.execute(
            select(func.count(ReferralClick.id)).where(
                ReferralClick.partner_id == partner_id,
                ReferralClick.campaign_id == pc.campaign_id,
            )
        )
        clicks = clicks_result.scalar() or 0

        # 전환 / 매출 / 커미션
        conv_result = await db.execute(
            select(
                func.count(ReferralConversion.id),
                func.coalesce(func.sum(ReferralConversion.order_amount), 0),
                func.coalesce(func.sum(ReferralConversion.commission_amount), 0),
            ).where(
                ReferralConversion.partner_id == partner_id,
                ReferralConversion.campaign_id == pc.campaign_id,
            )
        )
        conv_row = conv_result.one()

        # 레퍼럴 링크 — 항상 최신 캠페인 상태로 재계산
        fresh_link = (
            _build_referral_link_simple(campaign, pc.referral_code)
            if campaign
            else (pc.referral_link or "")
        )

        result_rows.append({
            "campaign_id": pc.campaign_id,
            "campaign_name": campaign.name if campaign else "",
            "product_name": campaign.cafe24_product_name if campaign else None,
            "product_image": campaign.cafe24_product_image if campaign else None,
            "referral_link": fresh_link,
            "clicks": clicks,
            "conversions": conv_row[0] or 0,
            "sales": float(conv_row[1]),
            "commission": float(conv_row[2]),
            "commission_type": campaign.commission_type if campaign else "",
            "commission_rate": campaign.commission_rate if campaign else 0.0,
        })

    return result_rows
