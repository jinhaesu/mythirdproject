"""Performance Dashboard endpoints (TAB 4)."""
from typing import List, Optional
from datetime import date, datetime, timedelta
import json

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.db.database import get_db
from app.models.user import User
from app.models.campaign import Campaign, Ad, CampaignPerformance, CampaignStatus
from app.models.creative import Creative
from app.schemas.analytics import (
    KPIMetrics, DailyMetrics, CreativePerformance,
    PerformanceComparison, AIInsight,
    BudgetReallocationRequest, BudgetReallocationResponse,
    PerformanceDashboardResponse,
    LearnFromPerformanceRequest, LearnFromPerformanceResponse
)
from app.api.v1.endpoints.auth import get_current_user
from app.services.meta import MetaMarketingAPI
from app.services.ai import ClaudeService

router = APIRouter()


@router.get("/dashboard/{campaign_id}", response_model=PerformanceDashboardResponse)
async def get_campaign_dashboard(
    campaign_id: int,
    days: int = Query(default=7, le=90),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get full performance dashboard for a campaign.

    Includes KPIs, daily trends, creative comparison, and AI insights.
    """
    # Get campaign
    result = await db.execute(
        select(Campaign)
        .where(Campaign.id == campaign_id, Campaign.user_id == current_user.id)
    )
    campaign = result.scalar_one_or_none()

    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    period_end = date.today()
    period_start = period_end - timedelta(days=days)

    # Get performance data from DB
    perf_result = await db.execute(
        select(CampaignPerformance)
        .where(
            CampaignPerformance.campaign_id == campaign_id,
            CampaignPerformance.date >= datetime.combine(period_start, datetime.min.time()),
            CampaignPerformance.date <= datetime.combine(period_end, datetime.max.time())
        )
        .order_by(CampaignPerformance.date)
    )
    performance_records = perf_result.scalars().all()

    # If we have Meta integration, fetch fresh data
    if campaign.meta_campaign_id and current_user.meta_access_token:
        try:
            meta_api = MetaMarketingAPI(
                current_user.meta_access_token,
                current_user.meta_ad_account_id
            )
            insights = await meta_api.get_campaign_insights(
                campaign.meta_campaign_id,
                f"last_{days}d"
            )
            # Process and save insights to DB (simplified)
        except Exception:
            pass  # Use cached data

    # Calculate KPIs
    total_spend = sum(p.spend for p in performance_records)
    total_impressions = sum(p.impressions for p in performance_records)
    total_clicks = sum(p.clicks for p in performance_records)
    total_conversions = sum(p.conversions for p in performance_records)
    total_revenue = sum(p.revenue for p in performance_records)

    kpi = KPIMetrics(
        total_spend=total_spend,
        total_impressions=total_impressions,
        total_clicks=total_clicks,
        total_conversions=total_conversions,
        total_revenue=total_revenue,
        roas=total_revenue / total_spend if total_spend > 0 else 0,
        ctr=total_clicks / total_impressions * 100 if total_impressions > 0 else 0,
        cpc=total_spend / total_clicks if total_clicks > 0 else 0,
        cpm=total_spend / total_impressions * 1000 if total_impressions > 0 else 0,
        conversion_rate=total_conversions / total_clicks * 100 if total_clicks > 0 else 0
    )

    # Daily trends
    daily_trend = [
        DailyMetrics(
            date=p.date.date(),
            spend=p.spend,
            impressions=p.impressions,
            clicks=p.clicks,
            conversions=p.conversions,
            revenue=p.revenue,
            ctr=p.ctr,
            cpc=p.cpc,
            roas=p.roas
        )
        for p in performance_records
    ]

    # Get creative performance (mock for demo)
    ads_result = await db.execute(
        select(Ad).where(Ad.campaign_id == campaign_id)
    )
    ads = ads_result.scalars().all()

    creative_performance = []
    winner_idx = 0
    best_roas = 0

    for i, ad in enumerate(ads):
        creative_result = await db.execute(
            select(Creative).where(Creative.id == ad.creative_id)
        )
        creative = creative_result.scalar_one_or_none()

        if creative:
            # Mock performance data (in production, aggregate from actual metrics)
            mock_spend = total_spend * (ad.budget_percentage / 100)
            mock_impressions = int(total_impressions * (ad.budget_percentage / 100))
            mock_clicks = int(total_clicks * (ad.budget_percentage / 100))
            mock_conversions = int(total_conversions * (ad.budget_percentage / 100))
            mock_roas = (1 + i * 0.5) if total_conversions > 0 else 0  # Vary for demo

            if mock_roas > best_roas:
                best_roas = mock_roas
                winner_idx = i

            creative_performance.append(CreativePerformance(
                creative_id=creative.id,
                creative_name=creative.name,
                creative_type=creative.creative_type.value,
                thumbnail_url=creative.thumbnail_url,
                spend=mock_spend,
                impressions=mock_impressions,
                clicks=mock_clicks,
                conversions=mock_conversions,
                ctr=mock_clicks / mock_impressions * 100 if mock_impressions > 0 else 0,
                conversion_rate=mock_conversions / mock_clicks * 100 if mock_clicks > 0 else 0,
                roas=mock_roas,
                is_winner=False
            ))

    # Mark winner
    if creative_performance:
        creative_performance[winner_idx].is_winner = True

    # Generate comparison if A/B test
    comparison = None
    if len(creative_performance) >= 2:
        sorted_perf = sorted(creative_performance, key=lambda x: x.roas, reverse=True)
        winner = sorted_perf[0]
        loser = sorted_perf[-1]

        diff = ((winner.roas - loser.roas) / loser.roas * 100) if loser.roas > 0 else 100

        comparison = PerformanceComparison(
            winner=winner,
            loser=loser,
            performance_difference=diff,
            statistical_significance=0.95,  # Mock
            recommendation=f"🏆 Winner: {winner.creative_name}이 {loser.creative_name}보다 ROAS가 {diff:.1f}% 높습니다."
        )

    # Generate AI insights
    claude = ClaudeService()
    performance_data = {
        "kpi": kpi.model_dump(),
        "creative_comparison": [p.model_dump() for p in creative_performance],
        "trend": "improving" if len(daily_trend) > 1 and daily_trend[-1].roas > daily_trend[0].roas else "declining"
    }

    ai_insights_raw = await claude.analyze_performance(performance_data)
    ai_insights = [
        AIInsight(
            insight_type=i.get("insight_type", "performance"),
            title=i.get("title", ""),
            description=i.get("description", ""),
            action_available=i.get("action_available", False),
            action_type=i.get("action_type"),
            action_params=i.get("action_params")
        )
        for i in ai_insights_raw
    ]

    return PerformanceDashboardResponse(
        period_start=period_start,
        period_end=period_end,
        kpi_summary=kpi,
        daily_trend=daily_trend,
        creative_performance=creative_performance,
        comparison=comparison,
        ai_insights=ai_insights
    )


@router.post("/reallocate-budget", response_model=BudgetReallocationResponse)
async def reallocate_budget(
    request: BudgetReallocationRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Reallocate budget based on performance.

    Pauses underperforming ads and reallocates to winners.
    """
    result = await db.execute(
        select(Campaign)
        .where(Campaign.id == request.campaign_id, Campaign.user_id == current_user.id)
    )
    campaign = result.scalar_one_or_none()

    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    # Get ads
    ads_result = await db.execute(
        select(Ad).where(Ad.campaign_id == campaign.id)
    )
    ads = ads_result.scalars().all()

    if len(ads) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 ads for reallocation")

    changes_made = []
    new_allocations = []

    # Simple logic: pause worst performer, give budget to best
    # In production, use actual performance metrics
    if request.pause_underperforming and len(ads) >= 2:
        worst_ad = ads[-1]  # Simplified
        best_ad = ads[0]

        worst_budget = worst_ad.budget_percentage
        worst_ad.budget_percentage = 0
        worst_ad.status = "PAUSED"

        if request.reallocate_to_winner:
            best_ad.budget_percentage += worst_budget

        changes_made.append(f"Paused ad: {worst_ad.name}")
        changes_made.append(f"Increased {best_ad.name} budget by {worst_budget}%")

        # Update in Meta if connected
        if campaign.meta_campaign_id and current_user.meta_access_token:
            try:
                meta_api = MetaMarketingAPI(
                    current_user.meta_access_token,
                    current_user.meta_ad_account_id
                )
                if worst_ad.meta_ad_id:
                    await meta_api.update_campaign_status(worst_ad.meta_ad_id, "PAUSED")
            except Exception:
                pass

    await db.commit()

    # Build new allocations
    for ad in ads:
        new_allocations.append({
            "ad_id": ad.id,
            "ad_name": ad.name,
            "new_percentage": ad.budget_percentage,
            "status": ad.status
        })

    return BudgetReallocationResponse(
        success=True,
        changes_made=changes_made,
        new_allocations=new_allocations,
        estimated_improvement=15.0  # Mock estimate
    )


@router.post("/learn-from-performance", response_model=LearnFromPerformanceResponse)
async def learn_from_performance(
    request: LearnFromPerformanceRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Learn from successful campaign and apply to future.

    Extracts winning patterns for TAB 1 (Market Intelligence) and TAB 2 (Creative Studio).
    """
    result = await db.execute(
        select(Campaign)
        .where(Campaign.id == request.campaign_id, Campaign.user_id == current_user.id)
    )
    campaign = result.scalar_one_or_none()

    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    # Get best performing ad
    ads_result = await db.execute(
        select(Ad).where(Ad.campaign_id == campaign.id)
    )
    ads = ads_result.scalars().all()

    if not ads:
        raise HTTPException(status_code=400, detail="No ads in campaign")

    # Get winning creative
    winning_ad = ads[0]  # Simplified - should be based on actual metrics
    creative_result = await db.execute(
        select(Creative).where(Creative.id == winning_ad.creative_id)
    )
    winning_creative = creative_result.scalar_one_or_none()

    winning_style = {}
    if winning_creative and winning_creative.style_reference:
        try:
            winning_style = json.loads(winning_creative.style_reference)
        except json.JSONDecodeError:
            winning_style = {"style": winning_creative.style_reference}

    winning_targeting = {}
    if campaign.targeting:
        try:
            winning_targeting = json.loads(campaign.targeting)
        except json.JSONDecodeError:
            pass

    recommendations = [
        f"이 캠페인의 성공 스타일을 기본값으로 설정합니다.",
        f"추천 타겟: {winning_targeting.get('age_range', {}).get('min_age', 18)}-{winning_targeting.get('age_range', {}).get('max_age', 65)}세",
        "다음 캠페인에서 유사한 크리에이티브 스타일 사용을 권장합니다."
    ]

    # If apply_to_future, save as user's default settings
    if request.apply_to_future and winning_creative:
        user_settings = {
            "default_style": winning_style,
            "default_targeting": winning_targeting,
            "learned_from_campaign": campaign.id
        }
        current_user.brand_settings = json.dumps(user_settings, ensure_ascii=False)
        await db.commit()

    return LearnFromPerformanceResponse(
        winning_style=winning_style,
        winning_targeting=winning_targeting,
        recommendations=recommendations,
        applied=request.apply_to_future
    )


@router.get("/summary")
async def get_overall_summary(
    days: int = Query(default=30, le=90),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get overall performance summary across all campaigns."""
    period_start = datetime.utcnow() - timedelta(days=days)

    # Get all user's campaigns
    result = await db.execute(
        select(Campaign)
        .where(
            Campaign.user_id == current_user.id,
            Campaign.status.in_([CampaignStatus.ACTIVE, CampaignStatus.COMPLETED])
        )
    )
    campaigns = result.scalars().all()

    total_spend = sum(c.spent_amount for c in campaigns)
    total_budget = sum(c.total_budget for c in campaigns)
    active_campaigns = len([c for c in campaigns if c.status == CampaignStatus.ACTIVE])

    return {
        "total_campaigns": len(campaigns),
        "active_campaigns": active_campaigns,
        "total_budget": total_budget,
        "total_spend": total_spend,
        "budget_utilization": total_spend / total_budget * 100 if total_budget > 0 else 0,
        "period_days": days
    }
