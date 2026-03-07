"""Ads Controller endpoints (TAB 3)."""
from typing import List, Optional
import json

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.database import get_db
from app.models.user import User
from app.models.campaign import Campaign, Ad, CampaignStatus, CampaignObjective
from app.models.creative import Creative
from app.schemas.campaign import (
    CampaignCreate, CampaignUpdate, CampaignResponse,
    AdCreate, AdResponse,
    StrategyRecommendation, TargetingConfig,
    PublishRequest, PublishResponse
)
from app.api.v1.endpoints.auth import get_current_user
from app.services.meta import MetaMarketingAPI
from app.services.ai import ClaudeService

router = APIRouter()


@router.post("/strategy", response_model=StrategyRecommendation)
async def get_strategy_recommendation(
    budget: float,
    creative_ids: List[int] = [],
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get AI-powered campaign strategy recommendation.

    Based on budget and available creatives.
    """
    # Get creatives
    result = await db.execute(
        select(Creative)
        .where(Creative.id.in_(creative_ids), Creative.user_id == current_user.id)
    )
    creatives = result.scalars().all()

    # Prepare creative data for AI
    creative_data = [
        {
            "id": c.id,
            "name": c.name,
            "type": c.creative_type.value,
            "format": c.format.value
        }
        for c in creatives
    ]

    # Get AI recommendation
    claude = ClaudeService()
    recommendation = await claude.generate_strategy_recommendation(
        budget=budget,
        creatives=creative_data,
        historical_data=None  # Can add past performance data
    )

    # Build allocations
    allocations = []
    for alloc in recommendation.get("allocations", []):
        # Find matching creative
        matching = next((c for c in creatives if c.name == alloc.get("creative_name")), None)
        if matching:
            allocations.append({
                "creative_id": matching.id,
                "creative_name": matching.name,
                "allocation_percentage": alloc.get("allocation_percentage", 0),
                "recommended_placement": alloc.get("recommended_placement", "feed")
            })

    return StrategyRecommendation(
        total_budget=budget,
        recommended_duration_days=recommendation.get("recommended_duration_days", 7),
        allocations=allocations,
        target_audience_summary=recommendation.get("target_audience_summary", ""),
        expected_reach=recommendation.get("expected_reach", 0),
        expected_ctr=recommendation.get("expected_ctr", 0),
        reasoning=recommendation.get("overall_reasoning", "")
    )


@router.post("", response_model=CampaignResponse)
async def create_campaign(
    campaign_data: CampaignCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Create a new campaign (draft mode).
    """
    # Validate creatives exist
    result = await db.execute(
        select(Creative)
        .where(Creative.id.in_(campaign_data.creative_ids), Creative.user_id == current_user.id)
    )
    creatives = result.scalars().all()

    if len(creatives) != len(campaign_data.creative_ids):
        raise HTTPException(status_code=400, detail="Some creatives not found")

    # Create campaign
    targeting_json = None
    if campaign_data.targeting:
        targeting_json = campaign_data.targeting.model_dump_json()

    campaign = Campaign(
        user_id=current_user.id,
        name=campaign_data.name,
        objective=CampaignObjective(campaign_data.objective.value),
        status=CampaignStatus.DRAFT,
        total_budget=campaign_data.total_budget,
        daily_budget=campaign_data.daily_budget,
        targeting=targeting_json,
        start_date=campaign_data.start_date,
        end_date=campaign_data.end_date
    )
    db.add(campaign)
    await db.commit()
    await db.refresh(campaign)

    # Create ads for each creative
    ads = []
    if not creatives:
        targeting_response = None
        if campaign.targeting:
            targeting_response = TargetingConfig.model_validate_json(campaign.targeting)
        return CampaignResponse(
            id=campaign.id, user_id=campaign.user_id, name=campaign.name,
            objective=campaign.objective, status=campaign.status,
            total_budget=campaign.total_budget, daily_budget=campaign.daily_budget,
            spent_amount=campaign.spent_amount, targeting=targeting_response,
            start_date=campaign.start_date, end_date=campaign.end_date,
            ads=[], meta_campaign_id=campaign.meta_campaign_id,
            created_at=campaign.created_at, updated_at=campaign.updated_at,
        )
    budget_per_ad = 100.0 / len(creatives)
    for creative in creatives:
        ad = Ad(
            campaign_id=campaign.id,
            creative_id=creative.id,
            name=f"{campaign.name} - {creative.name}",
            budget_percentage=budget_per_ad
        )
        db.add(ad)
        ads.append(ad)

    await db.commit()

    # Build response
    targeting_response = None
    if campaign.targeting:
        targeting_response = TargetingConfig.model_validate_json(campaign.targeting)

    return CampaignResponse(
        id=campaign.id,
        user_id=campaign.user_id,
        name=campaign.name,
        objective=campaign.objective,
        status=campaign.status,
        total_budget=campaign.total_budget,
        daily_budget=campaign.daily_budget,
        spent_amount=campaign.spent_amount,
        targeting=targeting_response,
        start_date=campaign.start_date,
        end_date=campaign.end_date,
        ads=[
            AdResponse(
                id=ad.id,
                campaign_id=ad.campaign_id,
                creative_id=ad.creative_id,
                name=ad.name,
                status=ad.status,
                budget_percentage=ad.budget_percentage,
                meta_ad_id=ad.meta_ad_id,
                created_at=ad.created_at
            )
            for ad in ads
        ],
        created_at=campaign.created_at,
        updated_at=campaign.updated_at
    )


@router.post("/publish", response_model=PublishResponse)
async def publish_campaign(
    request: PublishRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Publish campaign to Meta Ads.

    Uploads campaign, adset, and ads to Meta Marketing API.
    """
    if not current_user.meta_access_token or not current_user.meta_ad_account_id:
        raise HTTPException(
            status_code=400,
            detail="Meta account not fully connected. Need access token and ad account ID."
        )

    # Get campaign
    result = await db.execute(
        select(Campaign)
        .where(Campaign.id == request.campaign_id, Campaign.user_id == current_user.id)
    )
    campaign = result.scalar_one_or_none()

    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    if campaign.status not in [CampaignStatus.DRAFT, CampaignStatus.PAUSED]:
        raise HTTPException(status_code=400, detail="Campaign cannot be published in current status")

    # Get ads
    ads_result = await db.execute(
        select(Ad).where(Ad.campaign_id == campaign.id)
    )
    ads = ads_result.scalars().all()

    meta_api = MetaMarketingAPI(
        current_user.meta_access_token,
        current_user.meta_ad_account_id
    )

    try:
        # 1. Create Campaign on Meta
        campaign_result = await meta_api.create_campaign(
            name=campaign.name,
            objective=campaign.objective,
            status="PAUSED"
        )
        meta_campaign_id = campaign_result.get("id")
        campaign.meta_campaign_id = meta_campaign_id

        # 2. Create AdSet
        targeting = TargetingConfig()
        if campaign.targeting:
            targeting = TargetingConfig.model_validate_json(campaign.targeting)

        daily_budget_cents = int((campaign.daily_budget or campaign.total_budget / 7) * 100)

        adset_result = await meta_api.create_adset(
            campaign_id=meta_campaign_id,
            name=f"{campaign.name} - AdSet",
            daily_budget=daily_budget_cents,
            targeting=targeting,
            start_time=campaign.start_date,
            end_time=campaign.end_date
        )
        meta_adset_id = adset_result.get("id")
        campaign.meta_adset_id = meta_adset_id

        # 3. Create Ads for each creative
        for ad in ads:
            # Get creative
            creative_result = await db.execute(
                select(Creative).where(Creative.id == ad.creative_id)
            )
            creative = creative_result.scalar_one_or_none()

            if creative and creative.file_url:
                # Upload image/video to Meta
                if creative.creative_type.value == "VIDEO":
                    media_result = await meta_api.upload_video(creative.file_url)
                    video_id = media_result.get("id")
                    creative_result = await meta_api.create_ad_creative(
                        name=creative.name,
                        page_id=current_user.meta_user_id,  # Simplified
                        video_id=video_id,
                        message=creative.primary_text or ""
                    )
                else:
                    creative_result = await meta_api.create_ad_creative(
                        name=creative.name,
                        page_id=current_user.meta_user_id,
                        image_url=creative.file_url,
                        message=creative.primary_text or ""
                    )

                meta_creative_id = creative_result.get("id")

                # Create ad
                ad_result = await meta_api.create_ad(
                    name=ad.name,
                    adset_id=meta_adset_id,
                    creative_id=meta_creative_id
                )
                ad.meta_ad_id = ad_result.get("id")
                ad.meta_creative_id = meta_creative_id
                ad.status = "PENDING_REVIEW"

        campaign.status = CampaignStatus.PENDING_REVIEW
        await db.commit()

        return PublishResponse(
            success=True,
            meta_campaign_id=meta_campaign_id,
            meta_adset_id=meta_adset_id,
            status="PENDING_REVIEW",
            message=f"Campaign published successfully. Meta Campaign ID: {meta_campaign_id}"
        )

    except Exception as e:
        return PublishResponse(
            success=False,
            status="FAILED",
            message=f"Failed to publish: {str(e)}"
        )


@router.get("", response_model=List[CampaignResponse])
async def list_campaigns(
    status: Optional[str] = None,
    limit: int = 20,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """List user's campaigns."""
    query = select(Campaign).where(Campaign.user_id == current_user.id)

    if status:
        query = query.where(Campaign.status == CampaignStatus(status))

    query = query.order_by(Campaign.created_at.desc()).limit(limit)

    result = await db.execute(query)
    campaigns = result.scalars().all()

    responses = []
    for campaign in campaigns:
        # Get ads
        ads_result = await db.execute(
            select(Ad).where(Ad.campaign_id == campaign.id)
        )
        ads = ads_result.scalars().all()

        targeting = None
        if campaign.targeting:
            targeting = TargetingConfig.model_validate_json(campaign.targeting)

        responses.append(CampaignResponse(
            id=campaign.id,
            user_id=campaign.user_id,
            name=campaign.name,
            objective=campaign.objective,
            status=campaign.status,
            total_budget=campaign.total_budget,
            daily_budget=campaign.daily_budget,
            spent_amount=campaign.spent_amount,
            targeting=targeting,
            meta_campaign_id=campaign.meta_campaign_id,
            start_date=campaign.start_date,
            end_date=campaign.end_date,
            ads=[
                AdResponse(
                    id=ad.id,
                    campaign_id=ad.campaign_id,
                    creative_id=ad.creative_id,
                    name=ad.name,
                    status=ad.status,
                    budget_percentage=ad.budget_percentage,
                    meta_ad_id=ad.meta_ad_id,
                    created_at=ad.created_at
                )
                for ad in ads
            ],
            created_at=campaign.created_at,
            updated_at=campaign.updated_at
        ))

    return responses


@router.patch("/{campaign_id}", response_model=CampaignResponse)
async def update_campaign(
    campaign_id: int,
    update_data: CampaignUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Update campaign settings."""
    result = await db.execute(
        select(Campaign)
        .where(Campaign.id == campaign_id, Campaign.user_id == current_user.id)
    )
    campaign = result.scalar_one_or_none()

    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    if update_data.name:
        campaign.name = update_data.name
    if update_data.total_budget:
        campaign.total_budget = update_data.total_budget
    if update_data.daily_budget:
        campaign.daily_budget = update_data.daily_budget
    if update_data.targeting:
        campaign.targeting = update_data.targeting.model_dump_json()
    if update_data.status:
        campaign.status = CampaignStatus(update_data.status.value)

    await db.commit()
    await db.refresh(campaign)

    # Get ads
    ads_result = await db.execute(
        select(Ad).where(Ad.campaign_id == campaign.id)
    )
    ads = ads_result.scalars().all()

    targeting = None
    if campaign.targeting:
        targeting = TargetingConfig.model_validate_json(campaign.targeting)

    return CampaignResponse(
        id=campaign.id,
        user_id=campaign.user_id,
        name=campaign.name,
        objective=campaign.objective,
        status=campaign.status,
        total_budget=campaign.total_budget,
        daily_budget=campaign.daily_budget,
        spent_amount=campaign.spent_amount,
        targeting=targeting,
        meta_campaign_id=campaign.meta_campaign_id,
        start_date=campaign.start_date,
        end_date=campaign.end_date,
        ads=[
            AdResponse(
                id=ad.id,
                campaign_id=ad.campaign_id,
                creative_id=ad.creative_id,
                name=ad.name,
                status=ad.status,
                budget_percentage=ad.budget_percentage,
                meta_ad_id=ad.meta_ad_id,
                created_at=ad.created_at
            )
            for ad in ads
        ],
        created_at=campaign.created_at,
        updated_at=campaign.updated_at
    )


@router.get("/interests/suggest")
async def suggest_interests(
    query: str,
    current_user: User = Depends(get_current_user)
):
    """Get interest targeting suggestions from Meta."""
    if not current_user.meta_access_token or not current_user.meta_ad_account_id:
        raise HTTPException(status_code=400, detail="Meta account not connected")

    meta_api = MetaMarketingAPI(
        current_user.meta_access_token,
        current_user.meta_ad_account_id
    )

    try:
        suggestions = await meta_api.get_interest_suggestions(query)
        return suggestions
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
# Campaign Execution: Status, Budget, On/Off
# ──────────────────────────────────────────────

@router.post("/{campaign_id}/activate")
async def activate_campaign(
    campaign_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """캠페인 활성화 (Meta 연동 시 Meta에도 반영)."""
    result = await db.execute(
        select(Campaign)
        .where(Campaign.id == campaign_id, Campaign.user_id == current_user.id)
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="캠페인을 찾을 수 없습니다.")

    if campaign.status not in [CampaignStatus.PAUSED, CampaignStatus.PENDING_REVIEW]:
        raise HTTPException(status_code=400, detail=f"현재 상태({campaign.status.value})에서는 활성화할 수 없습니다.")

    # Update Meta if connected
    if campaign.meta_campaign_id and current_user.meta_access_token:
        meta_api = MetaMarketingAPI(
            current_user.meta_access_token,
            current_user.meta_ad_account_id
        )
        try:
            await meta_api.update_campaign_status(campaign.meta_campaign_id, "ACTIVE")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Meta 캠페인 활성화 실패: {str(e)}")

    campaign.status = CampaignStatus.ACTIVE
    await db.commit()

    return {"success": True, "campaign_id": campaign_id, "status": "ACTIVE", "message": "캠페인이 활성화되었습니다."}


@router.post("/{campaign_id}/pause")
async def pause_campaign(
    campaign_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """캠페인 일시정지 (Meta 연동 시 Meta에도 반영)."""
    result = await db.execute(
        select(Campaign)
        .where(Campaign.id == campaign_id, Campaign.user_id == current_user.id)
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="캠페인을 찾을 수 없습니다.")

    if campaign.status != CampaignStatus.ACTIVE:
        raise HTTPException(status_code=400, detail=f"현재 상태({campaign.status.value})에서는 일시정지할 수 없습니다.")

    if campaign.meta_campaign_id and current_user.meta_access_token:
        meta_api = MetaMarketingAPI(
            current_user.meta_access_token,
            current_user.meta_ad_account_id
        )
        try:
            await meta_api.update_campaign_status(campaign.meta_campaign_id, "PAUSED")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Meta 캠페인 일시정지 실패: {str(e)}")

    campaign.status = CampaignStatus.PAUSED
    await db.commit()

    return {"success": True, "campaign_id": campaign_id, "status": "PAUSED", "message": "캠페인이 일시정지되었습니다."}


@router.post("/{campaign_id}/budget")
async def update_campaign_budget(
    campaign_id: int,
    daily_budget: Optional[float] = None,
    total_budget: Optional[float] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """캠페인 예산 변경 (Meta 연동 시 AdSet 예산도 반영)."""
    if not daily_budget and not total_budget:
        raise HTTPException(status_code=400, detail="daily_budget 또는 total_budget을 입력하세요.")

    result = await db.execute(
        select(Campaign)
        .where(Campaign.id == campaign_id, Campaign.user_id == current_user.id)
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="캠페인을 찾을 수 없습니다.")

    changes = []

    if daily_budget is not None:
        old_budget = campaign.daily_budget
        campaign.daily_budget = daily_budget
        changes.append(f"일일예산: {old_budget:,.0f}원 → {daily_budget:,.0f}원")

        # Update Meta AdSet budget if connected
        if campaign.meta_adset_id and current_user.meta_access_token:
            meta_api = MetaMarketingAPI(
                current_user.meta_access_token,
                current_user.meta_ad_account_id
            )
            try:
                await meta_api.update_adset_budget(
                    campaign.meta_adset_id,
                    int(daily_budget * 100)  # Convert to cents
                )
                changes.append("Meta AdSet 예산 반영 완료")
            except Exception as e:
                changes.append(f"Meta AdSet 예산 반영 실패: {str(e)}")

    if total_budget is not None:
        old_budget = campaign.total_budget
        campaign.total_budget = total_budget
        changes.append(f"총예산: {old_budget:,.0f}원 → {total_budget:,.0f}원")

    await db.commit()

    return {
        "success": True,
        "campaign_id": campaign_id,
        "daily_budget": campaign.daily_budget,
        "total_budget": campaign.total_budget,
        "changes": changes,
        "message": "예산이 변경되었습니다."
    }


@router.post("/{campaign_id}/ads/{ad_id}/toggle")
async def toggle_ad_status(
    campaign_id: int,
    ad_id: int,
    action: str,  # "activate" or "pause"
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """개별 광고 ON/OFF (Meta 연동 시 Meta 광고도 반영)."""
    if action not in ("activate", "pause"):
        raise HTTPException(status_code=400, detail="action은 'activate' 또는 'pause'만 가능합니다.")

    result = await db.execute(
        select(Ad)
        .where(Ad.id == ad_id, Ad.campaign_id == campaign_id)
    )
    ad = result.scalar_one_or_none()
    if not ad:
        raise HTTPException(status_code=404, detail="광고를 찾을 수 없습니다.")

    # Verify campaign ownership
    campaign_result = await db.execute(
        select(Campaign)
        .where(Campaign.id == campaign_id, Campaign.user_id == current_user.id)
    )
    campaign = campaign_result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="캠페인을 찾을 수 없습니다.")

    new_status = "ACTIVE" if action == "activate" else "PAUSED"

    # Update Meta ad status if connected
    if ad.meta_ad_id and current_user.meta_access_token:
        meta_api = MetaMarketingAPI(
            current_user.meta_access_token,
            current_user.meta_ad_account_id
        )
        try:
            await meta_api.update_campaign_status(ad.meta_ad_id, new_status)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Meta 광고 상태 변경 실패: {str(e)}")

    ad.status = new_status
    await db.commit()

    status_kr = "활성화" if action == "activate" else "일시정지"
    return {
        "success": True,
        "ad_id": ad_id,
        "status": new_status,
        "message": f"광고가 {status_kr}되었습니다."
    }


@router.post("/{campaign_id}/sync-insights")
async def sync_campaign_insights(
    campaign_id: int,
    date_preset: str = "last_7d",
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Meta에서 캠페인 실시간 성과 데이터를 동기화합니다."""
    result = await db.execute(
        select(Campaign)
        .where(Campaign.id == campaign_id, Campaign.user_id == current_user.id)
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="캠페인을 찾을 수 없습니다.")

    if not campaign.meta_campaign_id or not current_user.meta_access_token:
        raise HTTPException(status_code=400, detail="Meta 캠페인이 연결되지 않았습니다.")

    meta_api = MetaMarketingAPI(
        current_user.meta_access_token,
        current_user.meta_ad_account_id
    )

    try:
        insights = await meta_api.get_campaign_insights(
            campaign.meta_campaign_id,
            date_preset=date_preset
        )

        # Also get individual ad insights
        ads_result = await db.execute(
            select(Ad).where(Ad.campaign_id == campaign_id)
        )
        ads = ads_result.scalars().all()

        ad_insights = []
        for ad in ads:
            if ad.meta_ad_id:
                try:
                    ad_data = await meta_api.get_ad_insights(
                        ad.meta_ad_id,
                        date_preset=date_preset
                    )
                    ad_insights.append({
                        "ad_id": ad.id,
                        "ad_name": ad.name,
                        "meta_ad_id": ad.meta_ad_id,
                        "insights": ad_data
                    })
                except Exception:
                    continue

        return {
            "success": True,
            "campaign_id": campaign_id,
            "campaign_insights": insights,
            "ad_insights": ad_insights,
            "date_preset": date_preset
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Meta 성과 동기화 실패: {str(e)}")
