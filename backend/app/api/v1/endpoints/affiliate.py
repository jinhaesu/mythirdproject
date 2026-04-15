"""Affiliate managing endpoints."""
import logging
import uuid
from datetime import datetime
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_user
from app.db.database import get_db
from app.models.affiliate import (
    AffiliateCampaign,
    AffiliatePartner,
    AffiliateSettlement,
    ReferralClick,
    ReferralConversion,
    ReferralProgram,
)
from app.models.user import User

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
    name: str
    email: Optional[str] = None
    channel: str = "instagram"
    followers: int = 0
    memo: Optional[str] = None


class PartnerUpdate(BaseModel):
    campaign_id: Optional[int] = None
    name: Optional[str] = None
    email: Optional[str] = None
    channel: Optional[str] = None
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


# ---------------------------------------------------------------------------
# Campaign CRUD
# ---------------------------------------------------------------------------

@router.post("/campaigns", status_code=status.HTTP_201_CREATED)
async def create_campaign(
    payload: CampaignCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new affiliate campaign."""
    data = payload.model_dump()
    # timezone-aware → naive 변환 (PostgreSQL TIMESTAMP WITHOUT TIME ZONE 호환)
    for key in ('start_date', 'end_date'):
        if data.get(key) and hasattr(data[key], 'replace'):
            data[key] = data[key].replace(tzinfo=None)
    campaign = AffiliateCampaign(
        user_id=current_user.id,
        **data,
    )
    db.add(campaign)
    await db.commit()
    await db.refresh(campaign)
    return campaign


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

def _generate_referral_code() -> str:
    return uuid.uuid4().hex[:10].upper()


@router.post("/partners", status_code=status.HTTP_201_CREATED)
async def create_partner(
    payload: PartnerCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Register a new affiliate partner and generate referral link."""
    # Ensure referral_code is unique
    code = _generate_referral_code()
    while True:
        existing = await db.execute(
            select(AffiliatePartner).where(AffiliatePartner.referral_code == code)
        )
        if not existing.scalar_one_or_none():
            break
        code = _generate_referral_code()

    # 캠페인의 landing_url 기반으로 레퍼럴 링크 생성
    landing_url = "https://nuldam.com"
    if payload.campaign_id:
        campaign_result = await db.execute(
            select(AffiliateCampaign).where(AffiliateCampaign.id == payload.campaign_id)
        )
        campaign = campaign_result.scalar_one_or_none()
        if campaign and campaign.landing_url:
            landing_url = campaign.landing_url

    separator = "&" if "?" in landing_url else "?"
    referral_link = f"{landing_url}{separator}ref={code}"

    partner = AffiliatePartner(
        user_id=current_user.id,
        referral_code=code,
        referral_link=referral_link,
        **payload.model_dump(),
    )
    db.add(partner)
    await db.commit()
    await db.refresh(partner)

    # 이메일 발송 (Resend)
    if partner.email:
        try:
            from app.core.config import get_settings
            settings = get_settings()
            if settings.RESEND_API_KEY:
                import httpx
                await httpx.AsyncClient().post(
                    "https://api.resend.com/emails",
                    headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
                    json={
                        "from": settings.RESEND_FROM_EMAIL or "noreply@joinandjoin.com",
                        "to": [partner.email],
                        "subject": f"[널담] 어필리에이트 파트너 초대",
                        "html": (
                            f"<h2>안녕하세요, {partner.name}님!</h2>"
                            f"<p>널담 어필리에이트 파트너로 초대되었습니다.</p>"
                            f"<p>아래 전용 링크를 통해 상품을 홍보하고 커미션을 받으세요:</p>"
                            f"<p><a href='{referral_link}' style='font-size:18px;font-weight:bold;'>{referral_link}</a></p>"
                            f"<p>레퍼럴 코드: <b>{code}</b></p>"
                            f"<br><p>감사합니다,<br>널담은디저트</p>"
                        ),
                    },
                    timeout=10.0,
                )
                logger.info(f"[Affiliate] Invite email sent to {partner.email}")
        except Exception as e:
            logger.warning(f"[Affiliate] Email send failed: {e}")

    return partner


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
    return result.scalars().all()


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

    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(partner, field, value)

    await db.commit()
    await db.refresh(partner)
    return partner


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

    Sets a cookie (ref_id) so the conversion can be attributed later.
    """
    result = await db.execute(
        select(AffiliatePartner).where(AffiliatePartner.referral_code == referral_code)
    )
    partner = result.scalar_one_or_none()
    if not partner:
        raise HTTPException(status_code=404, detail="Invalid referral code")

    # Determine redirect target
    redirect_url = "/"
    if partner.referral_link:
        redirect_url = partner.referral_link
    elif partner.campaign_id:
        camp_result = await db.execute(
            select(AffiliateCampaign).where(AffiliateCampaign.id == partner.campaign_id)
        )
        campaign = camp_result.scalar_one_or_none()
        if campaign and campaign.landing_url:
            redirect_url = campaign.landing_url

    # Generate cookie id for conversion attribution
    cookie_id = request.cookies.get("ref_id") or uuid.uuid4().hex

    ip_address = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")

    click = ReferralClick(
        partner_id=partner.id,
        campaign_id=partner.campaign_id,
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
        max_age=60 * 60 * 24 * 30,  # 30 days
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
