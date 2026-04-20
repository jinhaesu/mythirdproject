"""Affiliate managing endpoints."""
import json
import logging
import uuid
from datetime import datetime, timedelta
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_user
from app.core.config import get_settings
from app.db.database import get_db
from app.models.affiliate import (
    AffiliateCampaign,
    AffiliatePartner,
    AffiliateSettlement,
    ReferralClick,
    ReferralConversion,
    ReferralProgram,
)
from app.models.partner_campaign import PartnerCampaign
from app.models.points import PointTransaction
from app.models.user import User

_settings = get_settings()

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class CampaignCreate(BaseModel):
    name: str
    product: str = ""
    description: Optional[str] = None
    commission_type: str = "percentage"
    commission_rate: float = 10.0
    status: str = "active"
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    landing_url: Optional[str] = None
    # Cafe24 상품/쿠폰 연결 (Phase 2)
    cafe24_product_no: Optional[int] = None
    discount_type: Optional[str] = None   # percentage | fixed | shipping
    discount_value: Optional[float] = None


class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    product: Optional[str] = None
    description: Optional[str] = None
    commission_type: Optional[str] = None
    commission_rate: Optional[float] = None
    status: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    landing_url: Optional[str] = None


class PartnerCreate(BaseModel):
    campaign_id: Optional[int] = None
    campaign_ids: List[int] = []  # Phase 5 M:N
    name: str
    email: Optional[str] = None
    channel: str = "instagram"
    channels: Optional[List[str]] = None  # multi-channel support
    followers: int = 0
    memo: Optional[str] = None


class PartnerUpdate(BaseModel):
    campaign_id: Optional[int] = None
    name: Optional[str] = None
    email: Optional[str] = None
    channel: Optional[str] = None
    channels: Optional[List[str]] = None  # multi-channel support
    followers: Optional[int] = None
    memo: Optional[str] = None
    referral_link: Optional[str] = None


class SettlementCreate(BaseModel):
    partner_id: int
    amount: float
    period_start: Optional[datetime] = None
    period_end: Optional[datetime] = None


class ReferralProgramCreate(BaseModel):
    name: str
    reward_type: str = "points"
    referrer_reward: float = 0
    referee_reward: float = 0
    max_rewards_per_user: Optional[int] = None
    status: str = "active"


class ReferralProgramUpdate(BaseModel):
    name: Optional[str] = None
    reward_type: Optional[str] = None
    referrer_reward: Optional[float] = None
    referee_reward: Optional[float] = None
    max_rewards_per_user: Optional[int] = None
    status: Optional[str] = None


class ConversionCreate(BaseModel):
    referral_code: str
    order_id: Optional[str] = None
    order_amount: float = 0
    cookie_id: Optional[str] = None


class PartnerCampaignAdd(BaseModel):
    campaign_id: int


class PointAwardRequest(BaseModel):
    user_id: int
    amount: float
    reason: str = "manual"
    memo: Optional[str] = None


# ---------------------------------------------------------------------------
# Campaign CRUD
# ---------------------------------------------------------------------------

@router.post("/campaigns", status_code=status.HTTP_201_CREATED)
async def create_campaign(
    payload: CampaignCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new affiliate campaign. Cafe24 상품 연결 시 쿠폰 자동 발급."""
    import app.services.cafe24 as cafe24_svc

    data = payload.model_dump()
    cafe24_product_no = data.pop("cafe24_product_no", None)
    discount_type = data.pop("discount_type", None)
    discount_value = data.pop("discount_value", None)

    # timezone-aware → naive 변환
    for key in ('start_date', 'end_date'):
        if data.get(key) and hasattr(data[key], 'replace'):
            data[key] = data[key].replace(tzinfo=None)

    coupon_warning: Optional[str] = None

    if cafe24_product_no:
        # Cafe24 연결 확인
        if not current_user.cafe24_access_token:
            raise HTTPException(status_code=400, detail="Cafe24 스토어 연결이 필요합니다.")

        mall_id = current_user.cafe24_mall_id

        # 상품 정보 조회
        try:
            product = await cafe24_svc.get_product(current_user, db, cafe24_product_no)
        except Exception as e:
            logger.warning(f"[Campaign] 상품 조회 실패: {e}")
            product = {}

        data["cafe24_product_no"] = cafe24_product_no
        data["cafe24_product_name"] = product.get("product_name", "")
        data["cafe24_product_image"] = product.get("list_image", "")
        data["discount_type"] = discount_type
        data["discount_value"] = discount_value

        base_url = f"https://{mall_id}.cafe24.com/product/detail.html?product_no={cafe24_product_no}"
        data["base_product_url"] = base_url

        if not data.get("landing_url"):
            data["landing_url"] = base_url

        # 쿠폰 발급
        try:
            benefit_type_map = {"percentage": "A", "fixed": "B", "shipping": "D"}
            benefit_type = benefit_type_map.get(discount_type or "percentage", "A")
            coupon_result = await cafe24_svc.create_coupon(
                current_user, db,
                coupon_name=f"[{payload.name}] 할인쿠폰",
                benefit_type=benefit_type,
                benefit_percentage=discount_value if discount_type == "percentage" else None,
                benefit_price=discount_value if discount_type == "fixed" else None,
                product_no=cafe24_product_no,
            )
            data["cafe24_coupon_code"] = coupon_result.get("coupon_code")
            data["cafe24_coupon_no"] = coupon_result.get("coupon_no")
        except Exception as e:
            logger.warning(f"[Campaign] 쿠폰 발급 실패: {e}")
            data["cafe24_coupon_code"] = None
            data["cafe24_coupon_no"] = None
            coupon_warning = f"쿠폰 발급 실패: {str(e)}"

    campaign = AffiliateCampaign(user_id=current_user.id, **data)
    db.add(campaign)
    await db.commit()
    await db.refresh(campaign)

    resp = {k: getattr(campaign, k) for k in campaign.__table__.columns.keys()}
    if coupon_warning:
        resp["warning"] = coupon_warning
    return resp


@router.get("/campaigns")
async def list_campaigns(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all campaigns for the current user."""
    result = await db.execute(
        select(AffiliateCampaign).where(AffiliateCampaign.user_id == current_user.id)
    )
    return result.scalars().all()


@router.get("/campaigns/{campaign_id}")
async def get_campaign(
    campaign_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a single campaign by ID."""
    result = await db.execute(
        select(AffiliateCampaign).where(
            AffiliateCampaign.id == campaign_id,
            AffiliateCampaign.user_id == current_user.id,
        )
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return campaign


@router.put("/campaigns/{campaign_id}")
async def update_campaign(
    campaign_id: int,
    payload: CampaignUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update an existing campaign."""
    result = await db.execute(
        select(AffiliateCampaign).where(
            AffiliateCampaign.id == campaign_id,
            AffiliateCampaign.user_id == current_user.id,
        )
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(campaign, field, value)

    campaign.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(campaign)
    return campaign


@router.delete("/campaigns/{campaign_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_campaign(
    campaign_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a campaign."""
    result = await db.execute(
        select(AffiliateCampaign).where(
            AffiliateCampaign.id == campaign_id,
            AffiliateCampaign.user_id == current_user.id,
        )
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    await db.delete(campaign)
    await db.commit()


# ---------------------------------------------------------------------------
# Partner CRUD
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
    # comma-separated fallback
    return [c.strip() for c in channels_str.split(",") if c.strip()]


def _partner_to_dict(partner) -> dict:
    """AffiliatePartner ORM 객체를 dict로 변환하며 channels list 포함."""
    data = {k: getattr(partner, k) for k in partner.__table__.columns.keys()}
    data["channels"] = _parse_channels(partner.channels)
    return data


def _generate_referral_code() -> str:
    return uuid.uuid4().hex[:10].upper()


async def _unique_partner_code(db: AsyncSession) -> str:
    """충돌 없는 AffiliatePartner 레퍼럴 코드 생성."""
    for _ in range(10):
        code = _generate_referral_code()
        existing = await db.execute(
            select(AffiliatePartner).where(AffiliatePartner.referral_code == code)
        )
        if not existing.scalar_one_or_none():
            return code
    return _generate_referral_code()


async def _unique_pc_code(db: AsyncSession) -> str:
    """충돌 없는 PartnerCampaign 레퍼럴 코드 생성."""
    for _ in range(10):
        code = _generate_referral_code()
        existing = await db.execute(
            select(PartnerCampaign).where(PartnerCampaign.referral_code == code)
        )
        if not existing.scalar_one_or_none():
            return code
    return _generate_referral_code()


def _build_referral_link(campaign: Optional[AffiliateCampaign], code: str) -> str:
    """캠페인 상황에 맞는 레퍼럴 링크 생성."""
    if campaign and campaign.cafe24_coupon_code and campaign.base_product_url:
        base = campaign.base_product_url
        sep = "&" if "?" in base else "?"
        return f"{base}{sep}coupon={campaign.cafe24_coupon_code}&ref={code}"

    landing_url = "https://nuldam.com"
    if campaign and campaign.landing_url:
        landing_url = campaign.landing_url
    sep = "&" if "?" in landing_url else "?"
    return f"{landing_url}{sep}ref={code}"


@router.post("/partners", status_code=status.HTTP_201_CREATED)
async def create_partner(
    payload: PartnerCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Register a new affiliate partner and generate referral link."""
    code = await _unique_partner_code(db)

    # 첫 번째 캠페인 결정 (campaign_ids 우선)
    primary_campaign_id = payload.campaign_id
    if payload.campaign_ids:
        primary_campaign_id = payload.campaign_ids[0]

    # 기본 캠페인 조회
    campaign = None
    if primary_campaign_id:
        camp_result = await db.execute(
            select(AffiliateCampaign).where(AffiliateCampaign.id == primary_campaign_id)
        )
        campaign = camp_result.scalar_one_or_none()

    referral_link = _build_referral_link(campaign, code)

    partner_data = payload.model_dump(exclude={"campaign_ids", "channels"})
    partner_data["campaign_id"] = primary_campaign_id

    # channels 다중 선택 처리
    if payload.channels:
        partner_data["channels"] = json.dumps(payload.channels)
        # 기존 channel 컬럼은 channels[0] 으로 채움 (하위 호환)
        partner_data["channel"] = payload.channels[0]
    # channel은 payload에서 이미 설정됨 (default "instagram")

    partner = AffiliatePartner(
        user_id=current_user.id,
        referral_code=code,
        referral_link=referral_link,
        **partner_data,
    )
    db.add(partner)
    await db.flush()  # partner.id 확보

    # Phase 5: campaign_ids 각각에 대해 PartnerCampaign 생성
    all_campaign_ids = list(dict.fromkeys(
        ([primary_campaign_id] if primary_campaign_id else []) + payload.campaign_ids
    ))
    for cid in all_campaign_ids:
        camp_result = await db.execute(
            select(AffiliateCampaign).where(AffiliateCampaign.id == cid)
        )
        c = camp_result.scalar_one_or_none()
        if not c:
            continue
        pc_code = await _unique_pc_code(db)
        pc_link = _build_referral_link(c, pc_code)
        pc = PartnerCampaign(
            partner_id=partner.id,
            campaign_id=cid,
            referral_code=pc_code,
            referral_link=pc_link,
        )
        db.add(pc)

    await db.commit()
    await db.refresh(partner)

    # 이메일 발송 (Resend)
    if partner.email:
        try:
            if _settings.RESEND_API_KEY:
                import httpx
                async with httpx.AsyncClient(timeout=10) as hclient:
                    await hclient.post(
                        "https://api.resend.com/emails",
                        headers={"Authorization": f"Bearer {_settings.RESEND_API_KEY}"},
                        json={
                            "from": _settings.RESEND_FROM_EMAIL or "noreply@joinandjoin.com",
                            "to": [partner.email],
                            "subject": "[널담] 어필리에이트 파트너 초대",
                            "html": (
                                f"<h2>안녕하세요, {partner.name}님!</h2>"
                                f"<p>널담 어필리에이트 파트너로 초대되었습니다.</p>"
                                f"<p>아래 전용 링크를 통해 상품을 홍보하고 커미션을 받으세요:</p>"
                                f"<p><a href='{referral_link}' style='font-size:18px;font-weight:bold;'>{referral_link}</a></p>"
                                f"<p>레퍼럴 코드: <b>{code}</b></p>"
                                f"<br><p>감사합니다,<br>널담은디저트</p>"
                            ),
                        },
                    )
                logger.info(f"[Affiliate] Invite email sent to {partner.email}")
        except Exception as e:
            logger.warning(f"[Affiliate] Email send failed: {e}")

    return _partner_to_dict(partner)


@router.get("/partners")
async def list_partners(
    campaign_id: Optional[int] = None,
    status: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List partners, optionally filtered by campaign or status."""
    query = select(AffiliatePartner).where(AffiliatePartner.user_id == current_user.id)
    if campaign_id is not None:
        query = query.where(AffiliatePartner.campaign_id == campaign_id)
    if status is not None:
        query = query.where(AffiliatePartner.status == status)

    result = await db.execute(query)
    return [_partner_to_dict(p) for p in result.scalars().all()]


@router.put("/partners/{partner_id}")
async def update_partner(
    partner_id: int,
    payload: PartnerUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update partner information."""
    result = await db.execute(
        select(AffiliatePartner).where(
            AffiliatePartner.id == partner_id,
            AffiliatePartner.user_id == current_user.id,
        )
    )
    partner = result.scalar_one_or_none()
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")

    update_data = payload.model_dump(exclude_none=True, exclude={"channels"})
    for field, value in update_data.items():
        setattr(partner, field, value)

    # channels 다중 선택 처리
    if payload.channels is not None:
        partner.channels = json.dumps(payload.channels)
        # 기존 channel 컬럼도 갱신 (하위 호환)
        partner.channel = payload.channels[0] if payload.channels else partner.channel

    await db.commit()
    await db.refresh(partner)
    return _partner_to_dict(partner)


@router.post("/partners/{partner_id}/approve")
async def approve_partner(
    partner_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Approve a pending partner."""
    result = await db.execute(
        select(AffiliatePartner).where(
            AffiliatePartner.id == partner_id,
            AffiliatePartner.user_id == current_user.id,
        )
    )
    partner = result.scalar_one_or_none()
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")

    partner.status = "approved"
    await db.commit()
    await db.refresh(partner)
    return {"success": True, "partner_id": partner_id, "status": partner.status}


@router.post("/partners/{partner_id}/reject")
async def reject_partner(
    partner_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Reject a pending partner."""
    result = await db.execute(
        select(AffiliatePartner).where(
            AffiliatePartner.id == partner_id,
            AffiliatePartner.user_id == current_user.id,
        )
    )
    partner = result.scalar_one_or_none()
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")

    partner.status = "rejected"
    await db.commit()
    await db.refresh(partner)
    return {"success": True, "partner_id": partner_id, "status": partner.status}


# ---------------------------------------------------------------------------
# Dashboard stats
# ---------------------------------------------------------------------------

@router.get("/dashboard")
async def get_dashboard(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return aggregated affiliate KPIs for the current user."""

    # Total partners by status
    partners_result = await db.execute(
        select(AffiliatePartner.status, func.count(AffiliatePartner.id))
        .where(AffiliatePartner.user_id == current_user.id)
        .group_by(AffiliatePartner.status)
    )
    partners_by_status = {row[0]: row[1] for row in partners_result.all()}

    # Partner IDs for this user
    partner_ids_result = await db.execute(
        select(AffiliatePartner.id).where(AffiliatePartner.user_id == current_user.id)
    )
    partner_ids = [row[0] for row in partner_ids_result.all()]

    # Total clicks
    total_clicks = 0
    if partner_ids:
        clicks_result = await db.execute(
            select(func.count(ReferralClick.id)).where(
                ReferralClick.partner_id.in_(partner_ids)
            )
        )
        total_clicks = clicks_result.scalar() or 0

    # Total conversions + revenue + commission
    total_conversions = 0
    total_revenue = 0.0
    total_commission = 0.0
    if partner_ids:
        conv_result = await db.execute(
            select(
                func.count(ReferralConversion.id),
                func.coalesce(func.sum(ReferralConversion.order_amount), 0),
                func.coalesce(func.sum(ReferralConversion.commission_amount), 0),
            ).where(ReferralConversion.partner_id.in_(partner_ids))
        )
        row = conv_result.one()
        total_conversions = row[0] or 0
        total_revenue = float(row[1])
        total_commission = float(row[2])

    # Conversion rate
    conversion_rate = (total_conversions / total_clicks * 100) if total_clicks > 0 else 0.0

    # Total campaigns
    campaigns_result = await db.execute(
        select(func.count(AffiliateCampaign.id)).where(
            AffiliateCampaign.user_id == current_user.id
        )
    )
    total_campaigns = campaigns_result.scalar() or 0

    # Pending settlements
    pending_settlement_result = await db.execute(
        select(func.coalesce(func.sum(AffiliateSettlement.amount), 0)).where(
            AffiliateSettlement.user_id == current_user.id,
            AffiliateSettlement.status == "pending",
        )
    )
    pending_settlement_amount = float(pending_settlement_result.scalar() or 0)

    # Active campaigns
    active_campaigns_result = await db.execute(
        select(AffiliateCampaign).where(
            AffiliateCampaign.user_id == current_user.id,
            AffiliateCampaign.status == "active",
        ).limit(5)
    )
    active_campaigns = [
        {"id": c.id, "name": c.name, "product": c.product, "commission_rate": c.commission_rate}
        for c in active_campaigns_result.scalars().all()
    ]

    # Top partners by conversion count
    top_partners = []
    if partner_ids:
        top_result = await db.execute(
            select(
                AffiliatePartner.id, AffiliatePartner.name, AffiliatePartner.channel,
                AffiliatePartner.followers,
                func.count(ReferralConversion.id).label("conversions"),
                func.coalesce(func.sum(ReferralConversion.order_amount), 0).label("sales"),
            )
            .outerjoin(ReferralConversion, ReferralConversion.partner_id == AffiliatePartner.id)
            .where(AffiliatePartner.user_id == current_user.id, AffiliatePartner.status == "approved")
            .group_by(AffiliatePartner.id)
            .order_by(func.coalesce(func.sum(ReferralConversion.order_amount), 0).desc())
            .limit(5)
        )
        for row in top_result.all():
            top_partners.append({
                "id": row[0], "name": row[1], "channel": row[2], "followers": row[3],
                "conversion_count": row[4], "total_sales": float(row[5]),
            })

    return {
        "total_campaigns": total_campaigns,
        "total_sales": total_revenue,
        "total_commission": total_commission,
        "active_partners": partners_by_status.get("approved", 0),
        "total_partners": sum(partners_by_status.values()),
        "partners_by_status": partners_by_status,
        "total_clicks": total_clicks,
        "total_conversions": total_conversions,
        "conversion_rate": round(conversion_rate, 2),
        "pending_settlement_amount": pending_settlement_amount,
        "active_campaigns": active_campaigns,
        "top_partners": top_partners,
    }


@router.get("/dashboard/timeseries")
async def get_dashboard_timeseries(
    days: int = Query(default=30, ge=1, le=365),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    현재 유저의 최근 N일간 일별 매출/커미션/클릭/전환 시계열 데이터.

    데이터가 있는 날짜만 반환하며 날짜 gap은 프론트엔드에서 채웁니다.
    """
    # 현재 유저의 파트너 ID 목록
    pid_result = await db.execute(
        select(AffiliatePartner.id).where(AffiliatePartner.user_id == current_user.id)
    )
    partner_ids = [row[0] for row in pid_result.all()]

    since = datetime.utcnow() - timedelta(days=days)

    # 일별 클릭 집계 — ORM으로 작성 (asyncpg의 ANY 바인딩 이슈 회피)
    clicks_by_date: dict = {}
    if partner_ids:
        day_col = func.date(ReferralClick.clicked_at).label("day")
        click_rows = await db.execute(
            select(day_col, func.count(ReferralClick.id))
            .where(
                ReferralClick.partner_id.in_(partner_ids),
                ReferralClick.clicked_at >= since,
            )
            .group_by(day_col)
            .order_by(day_col)
        )
        for row in click_rows.all():
            clicks_by_date[str(row[0])] = int(row[1])

    # 일별 전환/매출/커미션 집계
    conv_by_date: dict = {}
    if partner_ids:
        day_col2 = func.date(ReferralConversion.converted_at).label("day")
        conv_rows = await db.execute(
            select(
                day_col2,
                func.count(ReferralConversion.id),
                func.coalesce(func.sum(ReferralConversion.order_amount), 0),
                func.coalesce(func.sum(ReferralConversion.commission_amount), 0),
            )
            .where(
                ReferralConversion.partner_id.in_(partner_ids),
                ReferralConversion.converted_at >= since,
            )
            .group_by(day_col2)
            .order_by(day_col2)
        )
        for row in conv_rows.all():
            conv_by_date[str(row[0])] = {
                "conversions": int(row[1]),
                "revenue": float(row[2]),
                "commission": float(row[3]),
            }

    # 날짜 합치기
    all_dates = sorted(set(list(clicks_by_date.keys()) + list(conv_by_date.keys())))
    result_list = []
    for date_str in all_dates:
        conv = conv_by_date.get(date_str, {"conversions": 0, "revenue": 0.0, "commission": 0.0})
        result_list.append({
            "date": date_str,
            "revenue": conv["revenue"],
            "commission": conv["commission"],
            "clicks": clicks_by_date.get(date_str, 0),
            "conversions": conv["conversions"],
        })

    return result_list


@router.get("/dashboard/by-campaign")
async def get_dashboard_by_campaign(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    캠페인별 성과 집계: 매출/커미션/클릭/전환/파트너 수.
    """
    # 현재 유저의 파트너 ID 목록
    pid_result = await db.execute(
        select(AffiliatePartner.id).where(AffiliatePartner.user_id == current_user.id)
    )
    partner_ids = [row[0] for row in pid_result.all()]

    # 현재 유저의 캠페인 목록
    camp_result = await db.execute(
        select(AffiliateCampaign).where(AffiliateCampaign.user_id == current_user.id)
    )
    campaigns = camp_result.scalars().all()

    result_list = []
    for campaign in campaigns:
        # 이 캠페인에 연결된 파트너 수 (현재 유저 파트너 중)
        if partner_ids:
            pcount_result = await db.execute(
                select(func.count(AffiliatePartner.id)).where(
                    AffiliatePartner.campaign_id == campaign.id,
                    AffiliatePartner.id.in_(partner_ids),
                )
            )
        else:
            pcount_result = await db.execute(
                select(func.count(AffiliatePartner.id)).where(
                    AffiliatePartner.campaign_id == campaign.id
                )
            )
        partner_count = pcount_result.scalar() or 0

        # 클릭 수
        clicks = 0
        if partner_ids:
            click_result = await db.execute(
                select(func.count(ReferralClick.id)).where(
                    ReferralClick.campaign_id == campaign.id,
                    ReferralClick.partner_id.in_(partner_ids),
                )
            )
            clicks = click_result.scalar() or 0

        # 전환/매출/커미션
        conversions = 0
        revenue = 0.0
        commission = 0.0
        if partner_ids:
            conv_result = await db.execute(
                select(
                    func.count(ReferralConversion.id),
                    func.coalesce(func.sum(ReferralConversion.order_amount), 0),
                    func.coalesce(func.sum(ReferralConversion.commission_amount), 0),
                ).where(
                    ReferralConversion.campaign_id == campaign.id,
                    ReferralConversion.partner_id.in_(partner_ids),
                )
            )
            conv_row = conv_result.one()
            conversions = conv_row[0] or 0
            revenue = float(conv_row[1])
            commission = float(conv_row[2])

        result_list.append({
            "campaign_id": campaign.id,
            "campaign_name": campaign.name,
            "revenue": revenue,
            "commission": commission,
            "clicks": clicks,
            "conversions": conversions,
            "partners": partner_count,
        })

    return result_list


# ---------------------------------------------------------------------------
# Settlements
# ---------------------------------------------------------------------------

@router.get("/settlements")
async def list_settlements(
    partner_id: Optional[int] = None,
    status: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List settlements for the current user."""
    query = select(AffiliateSettlement).where(AffiliateSettlement.user_id == current_user.id)
    if partner_id is not None:
        query = query.where(AffiliateSettlement.partner_id == partner_id)
    if status is not None:
        query = query.where(AffiliateSettlement.status == status)

    result = await db.execute(query)
    return result.scalars().all()


@router.post("/settlements", status_code=status.HTTP_201_CREATED)
async def create_settlement(
    payload: SettlementCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a settlement record for a partner."""
    # Verify partner belongs to current user
    partner_result = await db.execute(
        select(AffiliatePartner).where(
            AffiliatePartner.id == payload.partner_id,
            AffiliatePartner.user_id == current_user.id,
        )
    )
    if not partner_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Partner not found")

    settlement = AffiliateSettlement(
        user_id=current_user.id,
        partner_id=payload.partner_id,
        amount=payload.amount,
        period_start=payload.period_start,
        period_end=payload.period_end,
        status="pending",
    )
    db.add(settlement)
    await db.commit()
    await db.refresh(settlement)
    return settlement


@router.post("/settlements/{settlement_id}/pay")
async def pay_settlement(
    settlement_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark a settlement as paid."""
    result = await db.execute(
        select(AffiliateSettlement).where(
            AffiliateSettlement.id == settlement_id,
            AffiliateSettlement.user_id == current_user.id,
        )
    )
    settlement = result.scalar_one_or_none()
    if not settlement:
        raise HTTPException(status_code=404, detail="Settlement not found")
    if settlement.status == "paid":
        raise HTTPException(status_code=400, detail="Settlement is already paid")

    settlement.status = "paid"
    settlement.paid_at = datetime.utcnow()
    await db.commit()
    await db.refresh(settlement)
    return {"success": True, "settlement_id": settlement_id, "paid_at": settlement.paid_at}


# ---------------------------------------------------------------------------
# Referral Programs
# ---------------------------------------------------------------------------

@router.post("/referral-programs", status_code=status.HTTP_201_CREATED)
async def create_referral_program(
    payload: ReferralProgramCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new referral reward program."""
    program = ReferralProgram(
        user_id=current_user.id,
        **payload.model_dump(),
    )
    db.add(program)
    await db.commit()
    await db.refresh(program)
    return program


@router.get("/referral-programs")
async def list_referral_programs(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List referral programs for the current user."""
    result = await db.execute(
        select(ReferralProgram).where(ReferralProgram.user_id == current_user.id)
    )
    return result.scalars().all()


@router.put("/referral-programs/{program_id}")
async def update_referral_program(
    program_id: int,
    payload: ReferralProgramUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update an existing referral program."""
    result = await db.execute(
        select(ReferralProgram).where(
            ReferralProgram.id == program_id,
            ReferralProgram.user_id == current_user.id,
        )
    )
    program = result.scalar_one_or_none()
    if not program:
        raise HTTPException(status_code=404, detail="Referral program not found")

    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(program, field, value)

    await db.commit()
    await db.refresh(program)
    return program


# ---------------------------------------------------------------------------
# Click tracking
# ---------------------------------------------------------------------------

@router.get("/track/{referral_code}")
async def track_referral_click(
    referral_code: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Record a referral click and redirect to the campaign landing URL.

    PartnerCampaign 코드 우선 조회, 없으면 AffiliatePartner 코드로 fallback.
    """
    # Phase 5: PartnerCampaign 우선
    partner_id: int
    campaign_id: Optional[int] = None
    redirect_url = "/"

    pc_result = await db.execute(
        select(PartnerCampaign).where(PartnerCampaign.referral_code == referral_code)
    )
    pc = pc_result.scalar_one_or_none()

    if pc:
        partner_id = pc.partner_id
        campaign_id = pc.campaign_id
        redirect_url = pc.referral_link or "/"
    else:
        result = await db.execute(
            select(AffiliatePartner).where(AffiliatePartner.referral_code == referral_code)
        )
        partner = result.scalar_one_or_none()
        if not partner:
            raise HTTPException(status_code=404, detail="Invalid referral code")
        partner_id = partner.id
        campaign_id = partner.campaign_id
        if partner.referral_link:
            redirect_url = partner.referral_link
        elif partner.campaign_id:
            camp_result = await db.execute(
                select(AffiliateCampaign).where(AffiliateCampaign.id == partner.campaign_id)
            )
            campaign_obj = camp_result.scalar_one_or_none()
            if campaign_obj and campaign_obj.landing_url:
                redirect_url = campaign_obj.landing_url

    cookie_id = request.cookies.get("ref_id") or uuid.uuid4().hex
    ip_address = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")

    click = ReferralClick(
        partner_id=partner_id,
        campaign_id=campaign_id,
        ip_address=ip_address,
        user_agent=user_agent,
        cookie_id=cookie_id,
    )
    db.add(click)
    await db.commit()

    response = RedirectResponse(url=redirect_url, status_code=302)
    response.set_cookie(
        key="ref_id",
        value=cookie_id,
        max_age=60 * 60 * 24 * 30,
        httponly=True,
        samesite="lax",
    )
    return response


# ---------------------------------------------------------------------------
# Conversions (webhook)
# ---------------------------------------------------------------------------

@router.post("/conversions", status_code=status.HTTP_201_CREATED)
async def record_conversion(
    payload: ConversionCreate,
    db: AsyncSession = Depends(get_db),
):
    """
    Record a referral conversion.

    Intended as a webhook endpoint called by e-commerce platforms (e.g. Cafe24).
    No user auth required — validated by referral_code.
    """
    partner_result = await db.execute(
        select(AffiliatePartner).where(AffiliatePartner.referral_code == payload.referral_code)
    )
    partner = partner_result.scalar_one_or_none()
    if not partner:
        raise HTTPException(status_code=404, detail="Invalid referral code")

    # Find the most recent click matching the cookie_id if provided
    click_id: Optional[int] = None
    if payload.cookie_id:
        click_result = await db.execute(
            select(ReferralClick)
            .where(
                ReferralClick.partner_id == partner.id,
                ReferralClick.cookie_id == payload.cookie_id,
            )
            .order_by(ReferralClick.clicked_at.desc())
            .limit(1)
        )
        click = click_result.scalar_one_or_none()
        if click:
            click_id = click.id

    # Calculate commission
    commission_amount = 0.0
    if partner.campaign_id:
        camp_result = await db.execute(
            select(AffiliateCampaign).where(AffiliateCampaign.id == partner.campaign_id)
        )
        campaign = camp_result.scalar_one_or_none()
        if campaign:
            if campaign.commission_type == "percentage":
                commission_amount = payload.order_amount * (campaign.commission_rate / 100)
            else:
                commission_amount = campaign.commission_rate

    conversion = ReferralConversion(
        click_id=click_id,
        partner_id=partner.id,
        campaign_id=partner.campaign_id,
        order_id=payload.order_id,
        order_amount=payload.order_amount,
        commission_amount=round(commission_amount, 2),
    )
    db.add(conversion)
    await db.commit()
    await db.refresh(conversion)
    return {
        "success": True,
        "conversion_id": conversion.id,
        "commission_amount": conversion.commission_amount,
    }


# ---------------------------------------------------------------------------
# Phase 4 — 포인트 원장 & 내 추천 코드
# ---------------------------------------------------------------------------

@router.get("/my-points")
async def get_my_points(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """현재 유저의 포인트 잔액 + 최근 거래 50건."""
    balance_result = await db.execute(
        select(func.coalesce(func.sum(PointTransaction.amount), 0.0)).where(
            PointTransaction.user_id == current_user.id
        )
    )
    balance = float(balance_result.scalar())

    txn_result = await db.execute(
        select(PointTransaction)
        .where(PointTransaction.user_id == current_user.id)
        .order_by(PointTransaction.created_at.desc())
        .limit(50)
    )
    transactions = txn_result.scalars().all()
    return {
        "balance": balance,
        "transactions": [
            {
                "id": t.id,
                "amount": t.amount,
                "reason": t.reason,
                "memo": t.memo,
                "created_at": t.created_at,
            }
            for t in transactions
        ],
    }


@router.get("/my-referral-code")
async def get_my_referral_code(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """내 추천 코드 조회. 없으면 자동 생성."""
    if not current_user.referral_code:
        for _ in range(3):
            code = uuid.uuid4().hex[:8].upper()
            dup = await db.execute(select(User).where(User.referral_code == code))
            if not dup.scalar_one_or_none():
                current_user.referral_code = code
                await db.commit()
                break

    return {
        "referral_code": current_user.referral_code,
        "referral_link": f"{_settings.FRONTEND_URL}?ref={current_user.referral_code}",
    }


@router.post("/my-points/award", status_code=status.HTTP_201_CREATED)
async def award_points(
    payload: PointAwardRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """(관리자) 수동 포인트 지급."""
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="관리자 권한이 필요합니다.")

    txn = PointTransaction(
        user_id=payload.user_id,
        amount=payload.amount,
        reason=payload.reason,
        memo=payload.memo,
    )
    db.add(txn)
    await db.commit()
    await db.refresh(txn)
    return {"success": True, "transaction_id": txn.id}


# ---------------------------------------------------------------------------
# Phase 5 — 파트너 다캠페인 M:N 엔드포인트
# ---------------------------------------------------------------------------

@router.post("/partners/{partner_id}/campaigns", status_code=status.HTTP_201_CREATED)
async def add_partner_campaign(
    partner_id: int,
    payload: PartnerCampaignAdd,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """파트너에 캠페인 연결 추가."""
    p_result = await db.execute(
        select(AffiliatePartner).where(
            AffiliatePartner.id == partner_id,
            AffiliatePartner.user_id == current_user.id,
        )
    )
    partner = p_result.scalar_one_or_none()
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")

    c_result = await db.execute(
        select(AffiliateCampaign).where(AffiliateCampaign.id == payload.campaign_id)
    )
    campaign = c_result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    # 중복 체크
    dup = await db.execute(
        select(PartnerCampaign).where(
            PartnerCampaign.partner_id == partner_id,
            PartnerCampaign.campaign_id == payload.campaign_id,
        )
    )
    if dup.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="이미 연결된 캠페인입니다.")

    pc_code = await _unique_pc_code(db)
    pc_link = _build_referral_link(campaign, pc_code)
    pc = PartnerCampaign(
        partner_id=partner_id,
        campaign_id=payload.campaign_id,
        referral_code=pc_code,
        referral_link=pc_link,
    )
    db.add(pc)
    await db.commit()
    await db.refresh(pc)
    return {
        "id": pc.id,
        "partner_id": pc.partner_id,
        "campaign_id": pc.campaign_id,
        "referral_code": pc.referral_code,
        "referral_link": pc.referral_link,
        "created_at": pc.created_at,
    }


@router.delete("/partners/{partner_id}/campaigns/{pc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_partner_campaign(
    partner_id: int,
    pc_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """파트너-캠페인 연결 해제."""
    p_result = await db.execute(
        select(AffiliatePartner).where(
            AffiliatePartner.id == partner_id,
            AffiliatePartner.user_id == current_user.id,
        )
    )
    if not p_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Partner not found")

    pc_result = await db.execute(
        select(PartnerCampaign).where(
            PartnerCampaign.id == pc_id,
            PartnerCampaign.partner_id == partner_id,
        )
    )
    pc = pc_result.scalar_one_or_none()
    if not pc:
        raise HTTPException(status_code=404, detail="PartnerCampaign not found")

    await db.delete(pc)
    await db.commit()


@router.get("/partners/{partner_id}/performance")
async def get_partner_performance(
    partner_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """파트너별 캠페인 성과 집계."""
    p_result = await db.execute(
        select(AffiliatePartner).where(
            AffiliatePartner.id == partner_id,
            AffiliatePartner.user_id == current_user.id,
        )
    )
    if not p_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Partner not found")

    # PartnerCampaign 목록
    pc_result = await db.execute(
        select(PartnerCampaign).where(PartnerCampaign.partner_id == partner_id)
    )
    pcs = pc_result.scalars().all()

    result_rows = []
    for pc in pcs:
        camp_result = await db.execute(
            select(AffiliateCampaign).where(AffiliateCampaign.id == pc.campaign_id)
        )
        campaign = camp_result.scalar_one_or_none()

        clicks_result = await db.execute(
            select(func.count(ReferralClick.id)).where(
                ReferralClick.partner_id == partner_id,
                ReferralClick.campaign_id == pc.campaign_id,
            )
        )
        clicks = clicks_result.scalar() or 0

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

        result_rows.append({
            "campaign_id": pc.campaign_id,
            "campaign_name": campaign.name if campaign else "",
            "referral_code": pc.referral_code,
            "referral_link": pc.referral_link,
            "clicks": clicks,
            "conversions": conv_row[0] or 0,
            "sales": float(conv_row[1]),
            "commission": float(conv_row[2]),
        })

    return result_rows
