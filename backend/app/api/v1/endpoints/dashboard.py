"""Dashboard and Revenue Analytics endpoints."""
from datetime import date, datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.db.database import get_db
from app.models.user import User
from app.models.ad_platform import PlatformConnection, RevenueData, Report, AIInsightLog
from app.schemas.ad_platform import (
    PlatformConnectionCreate, PlatformConnectionResponse,
    DashboardResponse, KPICard, PlatformPerformance,
    RevenueSummary, AIAnalysisRequest, AIAnalysisResponse,
    ReportCreate, ReportResponse, SyncRequest, SyncStatus,
    AdPlatform
)
from app.api.v1.endpoints.auth import get_current_user
from app.services.ai import ClaudeService
from app.services.platforms import GoogleAdsService, NaverAdsService, KakaoAdsService
from app.services.meta import MetaMarketingAPI

router = APIRouter()


@router.get("/overview", response_model=DashboardResponse)
async def get_dashboard_overview(
    days: int = Query(default=7, le=90),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get dashboard overview with KPIs and performance data.

    Aggregates data from all connected platforms.
    """
    period_end = date.today()
    period_start = period_end - timedelta(days=days)
    prev_period_start = period_start - timedelta(days=days)
    prev_period_end = period_start - timedelta(days=1)

    # Get connected platforms
    connections_result = await db.execute(
        select(PlatformConnection)
        .where(PlatformConnection.user_id == current_user.id, PlatformConnection.is_active == True)
    )
    connections = connections_result.scalars().all()

    # Get revenue data for current period
    current_data = await db.execute(
        select(RevenueData)
        .join(PlatformConnection)
        .where(
            PlatformConnection.user_id == current_user.id,
            RevenueData.date >= period_start,
            RevenueData.date <= period_end
        )
    )
    current_records = current_data.scalars().all()

    # Get revenue data for previous period (for comparison)
    prev_data = await db.execute(
        select(RevenueData)
        .join(PlatformConnection)
        .where(
            PlatformConnection.user_id == current_user.id,
            RevenueData.date >= prev_period_start,
            RevenueData.date <= prev_period_end
        )
    )
    prev_records = prev_data.scalars().all()

    # Calculate current period totals
    total_spend = sum(r.spend for r in current_records)
    total_revenue = sum(r.revenue for r in current_records)
    total_impressions = sum(r.impressions for r in current_records)
    total_clicks = sum(r.clicks for r in current_records)
    total_conversions = sum(r.conversions for r in current_records)

    # Calculate previous period totals
    prev_spend = sum(r.spend for r in prev_records) or 1
    prev_revenue = sum(r.revenue for r in prev_records) or 1
    prev_impressions = sum(r.impressions for r in prev_records) or 1
    prev_clicks = sum(r.clicks for r in prev_records) or 1

    # Create KPI cards
    kpi_cards = [
        KPICard(
            title="총 광고비",
            value=total_spend,
            unit="원",
            change=((total_spend - prev_spend) / prev_spend * 100),
            change_direction="up" if total_spend > prev_spend else "down",
            trend_data=_get_daily_values(current_records, "spend", days)
        ),
        KPICard(
            title="총 매출",
            value=total_revenue,
            unit="원",
            change=((total_revenue - prev_revenue) / prev_revenue * 100),
            change_direction="up" if total_revenue > prev_revenue else "down",
            trend_data=_get_daily_values(current_records, "revenue", days)
        ),
        KPICard(
            title="ROAS",
            value=(total_revenue / total_spend * 100) if total_spend > 0 else 0,
            unit="%",
            change=0,  # Calculate properly
            change_direction="neutral",
            trend_data=[]
        ),
        KPICard(
            title="전환수",
            value=total_conversions,
            unit="회",
            change=0,
            change_direction="neutral",
            trend_data=_get_daily_values(current_records, "conversions", days)
        ),
        KPICard(
            title="클릭수",
            value=total_clicks,
            unit="회",
            change=((total_clicks - prev_clicks) / prev_clicks * 100),
            change_direction="up" if total_clicks > prev_clicks else "down",
            trend_data=_get_daily_values(current_records, "clicks", days)
        ),
        KPICard(
            title="노출수",
            value=total_impressions,
            unit="회",
            change=((total_impressions - prev_impressions) / prev_impressions * 100),
            change_direction="up" if total_impressions > prev_impressions else "down",
            trend_data=_get_daily_values(current_records, "impressions", days)
        ),
    ]

    # Group by platform
    platform_perf = _aggregate_by_platform(current_records, prev_records, connections)

    # Daily trend
    daily_trend = _get_daily_trend(current_records, period_start, period_end)

    # Get AI insights
    ai_insights = await _generate_ai_insights(current_records, prev_records, db, current_user.id)

    # Top campaigns
    top_campaigns = _get_top_campaigns(current_records)

    return DashboardResponse(
        period_start=period_start,
        period_end=period_end,
        kpi_cards=kpi_cards,
        platform_performance=platform_perf,
        daily_trend=daily_trend,
        top_campaigns=top_campaigns,
        ai_insights=ai_insights
    )


@router.post("/connect-platform", response_model=PlatformConnectionResponse)
async def connect_platform(
    request: PlatformConnectionCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Connect a new advertising platform."""
    # Check if already connected
    existing = await db.execute(
        select(PlatformConnection).where(
            PlatformConnection.user_id == current_user.id,
            PlatformConnection.platform == request.platform.value,
            PlatformConnection.is_active == True
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Platform already connected")

    # Create connection
    connection = PlatformConnection(
        user_id=current_user.id,
        platform=request.platform.value,
        account_id=request.account_id or "",
        access_token=request.access_token,
        is_active=True
    )
    db.add(connection)
    await db.commit()
    await db.refresh(connection)

    return connection


@router.get("/platforms", response_model=List[PlatformConnectionResponse])
async def get_connected_platforms(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get list of connected platforms."""
    result = await db.execute(
        select(PlatformConnection)
        .where(PlatformConnection.user_id == current_user.id, PlatformConnection.is_active == True)
    )
    return result.scalars().all()


@router.post("/sync")
async def sync_platform_data(
    request: SyncRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Manually trigger data sync from platforms."""
    # Get platforms to sync
    query = select(PlatformConnection).where(
        PlatformConnection.user_id == current_user.id,
        PlatformConnection.is_active == True
    )
    if request.platform_ids:
        query = query.where(PlatformConnection.id.in_(request.platform_ids))

    result = await db.execute(query)
    connections = result.scalars().all()

    sync_results = []
    date_from = request.date_from or (date.today() - timedelta(days=7))
    date_to = request.date_to or date.today()

    for conn in connections:
        try:
            service = _get_platform_service(conn)
            if service:
                stats = await service.get_daily_stats(date_from, date_to)
                records_synced = await _save_revenue_data(db, conn.id, stats)
                conn.last_sync_at = datetime.utcnow()

                sync_results.append({
                    "platform_id": conn.id,
                    "platform": conn.platform,
                    "status": "completed",
                    "records_synced": records_synced
                })
        except Exception as e:
            sync_results.append({
                "platform_id": conn.id,
                "platform": conn.platform,
                "status": "failed",
                "error_message": str(e)
            })

    await db.commit()
    return {"sync_results": sync_results}


@router.post("/ai-analysis", response_model=AIAnalysisResponse)
async def get_ai_analysis(
    request: AIAnalysisRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get AI-powered analysis of marketing performance."""
    period_end = date.today()
    period_start = period_end - timedelta(days=request.period_days)

    # Get data
    query = select(RevenueData).join(PlatformConnection).where(
        PlatformConnection.user_id == current_user.id,
        RevenueData.date >= period_start,
        RevenueData.date <= period_end
    )
    if request.platforms:
        query = query.where(PlatformConnection.platform.in_([p.value for p in request.platforms]))

    result = await db.execute(query)
    records = result.scalars().all()

    # Prepare data for AI
    data_summary = {
        "period_days": request.period_days,
        "total_spend": sum(r.spend for r in records),
        "total_revenue": sum(r.revenue for r in records),
        "total_impressions": sum(r.impressions for r in records),
        "total_clicks": sum(r.clicks for r in records),
        "total_conversions": sum(r.conversions for r in records),
        "by_date": _get_daily_trend(records, period_start, period_end),
        "focus_area": request.focus_area
    }

    # Call AI service
    claude = ClaudeService()
    analysis = await claude.analyze_marketing_performance(data_summary)

    return AIAnalysisResponse(
        summary=analysis.get("summary", ""),
        insights=analysis.get("insights", []),
        recommendations=analysis.get("recommendations", []),
        predicted_trends=analysis.get("predicted_trends", {})
    )


@router.post("/reports", response_model=ReportResponse)
async def generate_report(
    request: ReportCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Generate a performance report."""
    # Get data for the period
    query = select(RevenueData).join(PlatformConnection).where(
        PlatformConnection.user_id == current_user.id,
        RevenueData.date >= request.period_start,
        RevenueData.date <= request.period_end
    )
    if request.platforms:
        query = query.where(PlatformConnection.platform.in_([p.value for p in request.platforms]))

    result = await db.execute(query)
    records = result.scalars().all()

    # Calculate KPIs
    kpi_data = {
        "total_spend": sum(r.spend for r in records),
        "total_revenue": sum(r.revenue for r in records),
        "total_impressions": sum(r.impressions for r in records),
        "total_clicks": sum(r.clicks for r in records),
        "total_conversions": sum(r.conversions for r in records),
        "roas": 0,
        "ctr": 0,
        "cpc": 0,
    }
    if kpi_data["total_spend"] > 0:
        kpi_data["roas"] = kpi_data["total_revenue"] / kpi_data["total_spend"] * 100
    if kpi_data["total_impressions"] > 0:
        kpi_data["ctr"] = kpi_data["total_clicks"] / kpi_data["total_impressions"] * 100
    if kpi_data["total_clicks"] > 0:
        kpi_data["cpc"] = kpi_data["total_spend"] / kpi_data["total_clicks"]

    # Generate AI insights if requested
    insights = []
    recommendations = []
    summary = f"{request.period_start} ~ {request.period_end} 기간 마케팅 성과 리포트"

    if request.include_ai_insights:
        claude = ClaudeService()
        ai_result = await claude.generate_report_summary(kpi_data, request.report_type.value)
        summary = ai_result.get("summary", summary)
        insights = ai_result.get("insights", [])
        recommendations = ai_result.get("recommendations", [])

    # Create report
    report = Report(
        user_id=current_user.id,
        report_type=request.report_type.value,
        title=f"{request.report_type.value} 리포트 - {request.period_end}",
        period_start=request.period_start,
        period_end=request.period_end,
        summary=summary,
        kpi_data=kpi_data,
        insights=insights,
        recommendations=recommendations
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)

    return report


@router.get("/reports", response_model=List[ReportResponse])
async def list_reports(
    limit: int = Query(default=20, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """List generated reports."""
    result = await db.execute(
        select(Report)
        .where(Report.user_id == current_user.id)
        .order_by(Report.created_at.desc())
        .limit(limit)
    )
    return result.scalars().all()


# Helper functions
def _get_daily_values(records: List[RevenueData], field: str, days: int) -> List[float]:
    """Get daily values for sparkline charts."""
    by_date = {}
    for r in records:
        date_str = str(r.date)
        if date_str not in by_date:
            by_date[date_str] = 0
        by_date[date_str] += getattr(r, field, 0)

    # Sort by date and return values
    sorted_dates = sorted(by_date.keys())[-days:]
    return [by_date.get(d, 0) for d in sorted_dates]


def _aggregate_by_platform(current: List, prev: List, connections: List) -> List[PlatformPerformance]:
    """Aggregate performance by platform."""
    current_by_platform = {}
    prev_by_platform = {}

    for r in current:
        conn = next((c for c in connections if c.id == r.platform_connection_id), None)
        if conn:
            platform = conn.platform
            if platform not in current_by_platform:
                current_by_platform[platform] = {"spend": 0, "revenue": 0, "impressions": 0, "clicks": 0, "conversions": 0}
            current_by_platform[platform]["spend"] += r.spend
            current_by_platform[platform]["revenue"] += r.revenue
            current_by_platform[platform]["impressions"] += r.impressions
            current_by_platform[platform]["clicks"] += r.clicks
            current_by_platform[platform]["conversions"] += r.conversions

    for r in prev:
        conn = next((c for c in connections if c.id == r.platform_connection_id), None)
        if conn:
            platform = conn.platform
            if platform not in prev_by_platform:
                prev_by_platform[platform] = {"spend": 0}
            prev_by_platform[platform]["spend"] += r.spend

    result = []
    for platform, data in current_by_platform.items():
        prev_spend = prev_by_platform.get(platform, {}).get("spend", 1)
        result.append(PlatformPerformance(
            platform=AdPlatform(platform),
            spend=data["spend"],
            revenue=data["revenue"],
            roas=(data["revenue"] / data["spend"] * 100) if data["spend"] > 0 else 0,
            impressions=data["impressions"],
            clicks=data["clicks"],
            conversions=data["conversions"],
            ctr=(data["clicks"] / data["impressions"] * 100) if data["impressions"] > 0 else 0,
            change_from_previous=((data["spend"] - prev_spend) / prev_spend * 100)
        ))
    return result


def _get_daily_trend(records: List, start: date, end: date) -> List[dict]:
    """Get daily aggregated trend data."""
    by_date = {}
    for r in records:
        date_str = str(r.date)
        if date_str not in by_date:
            by_date[date_str] = {"spend": 0, "revenue": 0, "impressions": 0, "clicks": 0, "conversions": 0}
        by_date[date_str]["spend"] += r.spend
        by_date[date_str]["revenue"] += r.revenue
        by_date[date_str]["impressions"] += r.impressions
        by_date[date_str]["clicks"] += r.clicks
        by_date[date_str]["conversions"] += r.conversions

    result = []
    current = start
    while current <= end:
        date_str = str(current)
        data = by_date.get(date_str, {"spend": 0, "revenue": 0, "impressions": 0, "clicks": 0, "conversions": 0})
        result.append({"date": date_str, **data})
        current += timedelta(days=1)
    return result


def _get_top_campaigns(records: List) -> List[dict]:
    """Get top performing campaigns."""
    by_campaign = {}
    for r in records:
        if r.campaign_id:
            if r.campaign_id not in by_campaign:
                by_campaign[r.campaign_id] = {"name": r.campaign_name, "spend": 0, "revenue": 0, "conversions": 0}
            by_campaign[r.campaign_id]["spend"] += r.spend
            by_campaign[r.campaign_id]["revenue"] += r.revenue
            by_campaign[r.campaign_id]["conversions"] += r.conversions

    # Sort by revenue
    sorted_campaigns = sorted(by_campaign.items(), key=lambda x: x[1]["revenue"], reverse=True)
    return [{"campaign_id": k, **v} for k, v in sorted_campaigns[:10]]


async def _generate_ai_insights(current: List, prev: List, db: AsyncSession, user_id: int) -> List[dict]:
    """Generate AI insights based on performance data."""
    insights = []

    total_current = sum(r.spend for r in current)
    total_prev = sum(r.spend for r in prev) or 1
    change = (total_current - total_prev) / total_prev * 100

    if abs(change) > 20:
        insights.append({
            "type": "TREND",
            "title": "광고비 급변동 감지",
            "description": f"광고비가 전 기간 대비 {change:.1f}% {'증가' if change > 0 else '감소'}했습니다.",
            "severity": "WARNING" if abs(change) > 50 else "INFO"
        })

    # ROAS check
    current_roas = (sum(r.revenue for r in current) / total_current * 100) if total_current > 0 else 0
    if current_roas < 100:
        insights.append({
            "type": "ALERT",
            "title": "ROAS 개선 필요",
            "description": f"현재 ROAS가 {current_roas:.1f}%로, 광고비 대비 수익이 낮습니다.",
            "severity": "WARNING"
        })

    return insights


def _get_platform_service(connection: PlatformConnection):
    """Get the appropriate platform service based on connection type."""
    if connection.platform == "META":
        return MetaMarketingAPI(connection.access_token, connection.account_id)
    elif connection.platform == "GOOGLE":
        return GoogleAdsService(connection.access_token, connection.account_id)
    elif connection.platform == "NAVER":
        return NaverAdsService(connection.access_token, connection.account_id)
    elif connection.platform == "KAKAO":
        return KakaoAdsService(connection.access_token, connection.account_id)
    return None


async def _save_revenue_data(db: AsyncSession, connection_id: int, stats: List[dict]) -> int:
    """Save revenue data to database."""
    count = 0
    for stat in stats:
        revenue_data = RevenueData(
            platform_connection_id=connection_id,
            date=stat.get("date"),
            impressions=stat.get("impressions", 0),
            clicks=stat.get("clicks", 0),
            spend=stat.get("spend", 0),
            revenue=stat.get("revenue", 0),
            conversions=stat.get("conversions", 0),
            ctr=stat.get("ctr", 0),
            cpc=stat.get("cpc", 0),
            cpm=stat.get("cpm", 0),
            roas=stat.get("roas", 0),
            campaign_id=stat.get("campaign_id"),
            campaign_name=stat.get("campaign_name")
        )
        db.add(revenue_data)
        count += 1
    return count
