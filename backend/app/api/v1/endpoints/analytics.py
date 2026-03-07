"""Performance Dashboard endpoints (TAB 4) - Real Meta data analysis."""
import json
import logging
import uuid
from typing import List, Optional
from datetime import date, datetime, timedelta, timezone

import httpx
import resend
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import get_settings
from app.db.database import get_db
from app.models.user import User
from app.models.campaign import Campaign, Ad, CampaignPerformance, CampaignStatus
from app.models.creative import Creative
from app.models.auto_rule import AutoRule, AutoRuleLog
from app.models.scheduled_report import ScheduledReport
from app.schemas.analytics import (
    KPIMetrics, DailyMetrics, CreativePerformance,
    PerformanceComparison, AIInsight,
    BudgetReallocationRequest, BudgetReallocationResponse,
    PerformanceDashboardResponse,
    LearnFromPerformanceRequest, LearnFromPerformanceResponse
)
from app.api.v1.endpoints.auth import get_current_user
from app.services.ai import ClaudeService
from app.services.meta_ads_service import MetaAdsService
from app.services.rule_engine import run_rules

logger = logging.getLogger(__name__)
router = APIRouter()
settings = get_settings()

# Throttle for background rule runs
_last_auto_run: dict[str, datetime] = {}


# ──────────────────────────────────────────────
# Full Account Overview (NEW - core endpoint)
# ──────────────────────────────────────────────

@router.get("/account-overview")
async def get_account_overview(
    date_preset: str = Query(default="last_7d"),
    since: Optional[str] = Query(default=None),
    until: Optional[str] = Query(default=None),
    current_user: User = Depends(get_current_user),
):
    """Get complete ad account overview: all campaigns, ad sets, ads with insights."""
    svc = MetaAdsService(current_user)
    if not svc.connected:
        return {"connected": False, "error": "Meta 계정을 먼저 연동해주세요."}

    overview = await svc.get_account_overview(date_preset, since=since, until=until)
    return overview


# ──────────────────────────────────────────────
# Campaign Adsets (on-demand loading)
# ──────────────────────────────────────────────

@router.get("/campaign/{campaign_id}/adsets")
async def get_campaign_adsets(
    campaign_id: str,
    date_preset: str = Query(default="last_7d"),
    current_user: User = Depends(get_current_user),
):
    """Load adsets + ads for a single campaign (on-demand when user expands)."""
    svc = MetaAdsService(current_user)
    if not svc.connected:
        raise HTTPException(status_code=400, detail="Meta 계정이 연동되지 않았습니다.")
    adsets = await svc.get_campaign_adsets(campaign_id, date_preset)
    return {"adsets": adsets}


# ──────────────────────────────────────────────
# Campaign Deep Analysis
# ──────────────────────────────────────────────

@router.get("/campaign/{campaign_id}/deep")
async def get_campaign_deep_analysis(
    campaign_id: str,
    date_preset: str = Query(default="last_7d"),
    current_user: User = Depends(get_current_user),
):
    """Deep analysis of a single campaign: daily trend, demographics, placements."""
    svc = MetaAdsService(current_user)
    if not svc.connected:
        raise HTTPException(status_code=400, detail="Meta 계정이 연동되지 않았습니다.")

    return await svc.get_campaign_deep_insights(campaign_id, date_preset)


# ──────────────────────────────────────────────
# AI Analysis with Action Items
# ──────────────────────────────────────────────

class AIAnalysisRequest(BaseModel):
    overview_data: Optional[dict] = None  # Pass cached overview to avoid re-fetching

@router.post("/ai-analysis")
async def get_ai_analysis(
    request: AIAnalysisRequest = AIAnalysisRequest(),
    date_preset: str = Query(default="last_7d"),
    current_user: User = Depends(get_current_user),
):
    """
    AI-powered analysis. Accepts cached overview data to avoid double-fetching.
    """
    svc = MetaAdsService(current_user)
    if not svc.connected:
        return {"connected": False, "recommendations": [], "error": "Meta 계정을 연동해주세요."}

    # Use cached overview if provided, otherwise fetch
    if request.overview_data and request.overview_data.get("connected"):
        context_text = svc.build_context_from_overview(request.overview_data)
    else:
        context_text = await svc.build_full_context_for_ai(date_preset)

    claude = ClaudeService()
    try:
        response = claude.client.messages.create(
            model=claude.model,
            max_tokens=2048,
            messages=[{
                "role": "user",
                "content": f"""Meta 광고 계정 데이터를 분석해 JSON으로 반환. 간결하게.

{context_text}

JSON 형식:
{{"account_health":"good|warning|critical","health_summary":"요약 2문장","action_items":[{{"priority":"high|medium|low","type":"pause_ad|increase_budget|decrease_budget|change_creative","target_id":"ID","target_name":"이름","action":"액션","reason":"이유","expected_impact":"효과"}}],"creative_fatigue":[{{"ad_name":"이름","frequency":"수치","recommendation":"교체|수정|유지"}}],"budget_recommendations":[{{"campaign_name":"이름","campaign_id":"ID","current_budget":"₩현재금액(원화)","recommended_budget":"₩추천금액(원화)","reason":"이유"}}],"next_steps":["실행사항 3개"]}}

JSON만 반환."""
            }],
        )

        raw = response.content[0].text.strip()
        # Parse JSON from response
        if "```json" in raw:
            raw = raw.split("```json")[1].split("```")[0].strip()
        elif "```" in raw:
            raw = raw.split("```")[1].split("```")[0].strip()

        analysis = json.loads(raw)
        return {"connected": True, "analysis": analysis}

    except json.JSONDecodeError:
        return {"connected": True, "analysis": {"raw_text": response.content[0].text, "parse_error": True}}
    except Exception as e:
        logger.error(f"AI analysis failed: {e}")
        return {"connected": True, "analysis": None, "error": str(e)}


# ──────────────────────────────────────────────
# Management Actions (execute on Meta)
# ──────────────────────────────────────────────

class StatusUpdateRequest(BaseModel):
    object_id: str
    object_type: str  # campaign, adset, ad
    status: str  # ACTIVE, PAUSED

class BudgetUpdateRequest(BaseModel):
    object_id: str
    object_type: str  # campaign, adset
    daily_budget: Optional[int] = None  # in cents
    lifetime_budget: Optional[int] = None


@router.post("/manage/status")
async def update_status(
    request: StatusUpdateRequest,
    current_user: User = Depends(get_current_user),
):
    """Toggle campaign/adset/ad status on Meta."""
    svc = MetaAdsService(current_user)
    if not svc.connected:
        raise HTTPException(status_code=400, detail="Meta 계정이 연동되지 않았습니다.")

    if request.object_type == "campaign":
        result = await svc.update_campaign_status(request.object_id, request.status)
    elif request.object_type == "adset":
        result = await svc.update_adset_status(request.object_id, request.status)
    elif request.object_type == "ad":
        result = await svc.update_ad_status(request.object_id, request.status)
    else:
        raise HTTPException(status_code=400, detail="Invalid object_type")

    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    return {"success": True, "message": f"{request.object_type} {request.object_id} 상태가 {request.status}로 변경되었습니다."}


@router.post("/manage/budget")
async def update_budget(
    request: BudgetUpdateRequest,
    current_user: User = Depends(get_current_user),
):
    """Update budget for campaign or ad set on Meta."""
    svc = MetaAdsService(current_user)
    if not svc.connected:
        raise HTTPException(status_code=400, detail="Meta 계정이 연동되지 않았습니다.")

    if request.object_type == "campaign":
        result = await svc.update_campaign_budget(request.object_id, request.daily_budget)
    elif request.object_type == "adset":
        result = await svc.update_adset_budget(request.object_id, request.daily_budget, request.lifetime_budget)
    else:
        raise HTTPException(status_code=400, detail="Invalid object_type")

    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    return {"success": True, "message": "예산이 업데이트되었습니다."}


# ──────────────────────────────────────────────
# Daily Trend
# ──────────────────────────────────────────────

@router.get("/account-trend")
async def get_account_trend(
    days: int = Query(default=30, le=90),
    since: Optional[str] = Query(default=None),
    until: Optional[str] = Query(default=None),
    current_user: User = Depends(get_current_user),
):
    """Get daily account-level trend for charts."""
    svc = MetaAdsService(current_user)
    if not svc.connected:
        return {"connected": False, "data": []}

    data = await svc.get_account_daily_trend(days, since=since, until=until)
    return {"connected": True, "data": data}


# ──────────────────────────────────────────────
# CSV Upload Analysis
# ──────────────────────────────────────────────

@router.post("/analyze-csv")
async def analyze_uploaded_csv(
    current_user: User = Depends(get_current_user),
):
    """Placeholder - CSV analysis is handled in campaign_planner/analyze-csv."""
    return {"message": "CSV 분석은 /campaign-planner/analyze-csv 엔드포인트를 사용하세요."}


# ──────────────────────────────────────────────
# Existing endpoints (kept for backwards compat)
# ──────────────────────────────────────────────

@router.get("/dashboard/{campaign_id}", response_model=PerformanceDashboardResponse)
async def get_campaign_dashboard(
    campaign_id: int,
    days: int = Query(default=7, le=90),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get performance dashboard for a local campaign."""
    result = await db.execute(
        select(Campaign)
        .where(Campaign.id == campaign_id, Campaign.user_id == current_user.id)
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    period_end = date.today()
    period_start = period_end - timedelta(days=days)

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

    daily_trend = [
        DailyMetrics(
            date=p.date.date(), spend=p.spend, impressions=p.impressions,
            clicks=p.clicks, conversions=p.conversions, revenue=p.revenue,
            ctr=p.ctr, cpc=p.cpc, roas=p.roas
        )
        for p in performance_records
    ]

    return PerformanceDashboardResponse(
        period_start=period_start, period_end=period_end,
        kpi_summary=kpi, daily_trend=daily_trend,
        creative_performance=[], comparison=None, ai_insights=[]
    )


@router.post("/reallocate-budget", response_model=BudgetReallocationResponse)
async def reallocate_budget(
    request: BudgetReallocationRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Reallocate budget based on performance."""
    result = await db.execute(
        select(Campaign)
        .where(Campaign.id == request.campaign_id, Campaign.user_id == current_user.id)
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    ads_result = await db.execute(select(Ad).where(Ad.campaign_id == campaign.id))
    ads = ads_result.scalars().all()
    if len(ads) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 ads for reallocation")

    changes_made = []
    if request.pause_underperforming and len(ads) >= 2:
        worst_ad = ads[-1]
        best_ad = ads[0]
        worst_budget = worst_ad.budget_percentage
        worst_ad.budget_percentage = 0
        worst_ad.status = "PAUSED"
        if request.reallocate_to_winner:
            best_ad.budget_percentage += worst_budget
        changes_made.append(f"Paused ad: {worst_ad.name}")
        changes_made.append(f"Increased {best_ad.name} budget by {worst_budget}%")

    await db.commit()

    new_allocations = [
        {"ad_id": ad.id, "ad_name": ad.name, "new_percentage": ad.budget_percentage, "status": ad.status}
        for ad in ads
    ]

    return BudgetReallocationResponse(
        success=True, changes_made=changes_made,
        new_allocations=new_allocations, estimated_improvement=15.0
    )


@router.post("/learn-from-performance", response_model=LearnFromPerformanceResponse)
async def learn_from_performance(
    request: LearnFromPerformanceRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Learn from successful campaign."""
    result = await db.execute(
        select(Campaign)
        .where(Campaign.id == request.campaign_id, Campaign.user_id == current_user.id)
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    ads_result = await db.execute(select(Ad).where(Ad.campaign_id == campaign.id))
    ads = ads_result.scalars().all()
    if not ads:
        raise HTTPException(status_code=400, detail="No ads in campaign")

    winning_ad = ads[0]
    creative_result = await db.execute(select(Creative).where(Creative.id == winning_ad.creative_id))
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
        "이 캠페인의 성공 스타일을 기본값으로 설정합니다.",
        "다음 캠페인에서 유사한 크리에이티브 스타일 사용을 권장합니다."
    ]

    if request.apply_to_future and winning_creative:
        user_settings = {
            "default_style": winning_style,
            "default_targeting": winning_targeting,
            "learned_from_campaign": campaign.id
        }
        current_user.brand_settings = json.dumps(user_settings, ensure_ascii=False)
        await db.commit()

    return LearnFromPerformanceResponse(
        winning_style=winning_style, winning_targeting=winning_targeting,
        recommendations=recommendations, applied=request.apply_to_future
    )


@router.get("/summary")
async def get_overall_summary(
    days: int = Query(default=30, le=90),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get overall performance summary."""
    # If Meta connected, use real data
    svc = MetaAdsService(current_user)
    if svc.connected:
        overview = await svc.get_account_overview(f"last_{days}d")
        return {
            "source": "meta",
            "connected": True,
            **overview.get("totals", {}),
            "account_insights": overview.get("account_insights", {}),
            "period_days": days,
        }

    # Fallback to local DB
    period_start = datetime.utcnow() - timedelta(days=days)
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

    return {
        "source": "local",
        "connected": False,
        "total_campaigns": len(campaigns),
        "active_campaigns": len([c for c in campaigns if c.status == CampaignStatus.ACTIVE]),
        "total_budget": total_budget,
        "total_spend": total_spend,
        "budget_utilization": total_spend / total_budget * 100 if total_budget > 0 else 0,
        "period_days": days
    }


# ──────────────────────────────────────────────
# Meta campaigns list (kept, improved)
# ──────────────────────────────────────────────

@router.get("/meta-campaigns")
async def get_meta_campaigns(
    date_preset: str = Query(default="last_7d"),
    current_user: User = Depends(get_current_user),
):
    """Meta API에서 실제 캠페인 목록 직접 조회."""
    svc = MetaAdsService(current_user)
    if not svc.connected:
        return {"connected": False, "campaigns": [], "message": "Meta 계정을 연동해주세요."}

    overview = await svc.get_account_overview(date_preset)
    return {
        "connected": True,
        "campaigns": overview.get("campaigns", []),
        "totals": overview.get("totals", {}),
        "account_insights": overview.get("account_insights", {}),
    }


# ──────────────────────────────────────────────
# Report generation + email
# ──────────────────────────────────────────────

class ReportRequest(BaseModel):
    campaign_id: Optional[int] = None
    meta_campaign_id: Optional[str] = None
    start_date: str
    end_date: str

class ReportEmailRequest(BaseModel):
    campaign_id: Optional[int] = None
    meta_campaign_id: Optional[str] = None
    start_date: str
    end_date: str
    email: EmailStr
    report_data: Optional[dict] = None  # Pre-generated report data from frontend


def _fmt_num(v) -> str:
    """Format number with comma separators."""
    try:
        n = int(float(v or 0))
        return f"{n:,}"
    except (ValueError, TypeError):
        return "0"

def _fmt_spend(v) -> str:
    """Format currency value."""
    try:
        n = float(v or 0)
        return f"₩{n:,.0f}"
    except (ValueError, TypeError):
        return "₩0"

def _fmt_roas(v) -> str:
    """Format ROAS value."""
    if v is None:
        return "-"
    try:
        n = float(v)
        return f"{n:.2f}" if n > 0 else "-"
    except (ValueError, TypeError):
        return "-"

def _build_report_html(report: dict) -> str:
    """Build full newsletter-style HTML matching the frontend ReportNewsletter component."""
    ai_report = report.get("ai_report")
    totals = report.get("totals", {})
    daily = report.get("daily_data", [])
    campaign = report.get("campaign_info")
    period = report.get("period", {})
    ai = ai_report if isinstance(ai_report, dict) else None
    ai_text = ai_report if isinstance(ai_report, str) else None

    grade = ai.get("overall_grade", "B") if ai else "B"
    grade_colors = {"A": "#10b981", "B": "#3b82f6", "C": "#f59e0b", "D": "#f97316", "F": "#ef4444"}
    grade_color = grade_colors.get(grade, "#3b82f6")

    parts = []

    # ── Hero Header ──
    headline = ai.get("headline", "성과 분석 리포트") if ai else "성과 분석 리포트"
    period_text = f'{period.get("start", "")} ~ {period.get("end", "")}'
    campaign_badge = f'<span style="margin-left:8px;padding:2px 8px;background:rgba(255,255,255,0.15);border-radius:4px;font-size:11px">{campaign["name"]}</span>' if campaign and campaign.get("name") else ""
    grade_html = ""
    if ai and ai.get("overall_grade"):
        grade_html = f'''
        <div style="position:absolute;top:24px;right:32px;text-align:center">
            <div style="width:56px;height:56px;border-radius:16px;background:{grade_color};display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,0.2)">
                <span style="font-size:28px;font-weight:900;color:white">{grade}</span>
            </div>
            <span style="font-size:11px;color:#93c5fd;margin-top:4px;display:block">{ai.get("grade_reason", "종합 등급")}</span>
        </div>'''

    parts.append(f'''
    <div style="background:linear-gradient(135deg,#0f172a,#1e3a5f,#312e81);padding:28px 32px;position:relative;border-radius:16px 16px 0 0">
        {grade_html}
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <div style="width:28px;height:28px;background:rgba(255,255,255,0.2);border-radius:8px;display:flex;align-items:center;justify-content:center">
                <span style="color:white;font-size:14px">📊</span>
            </div>
            <span style="color:#93c5fd;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase">Performance Report</span>
        </div>
        <h2 style="color:white;font-size:20px;font-weight:700;margin:0 0 8px;padding-right:80px;line-height:1.4">{headline}</h2>
        <p style="color:#93c5fd;font-size:12px;margin:0">{period_text}{campaign_badge}</p>
    </div>''')

    # ── Period Summary ──
    if ai and ai.get("period_summary"):
        parts.append(f'''
        <div style="margin:20px 24px 0;padding:14px 16px;background:#eff6ff;border:1px solid #dbeafe;border-radius:12px">
            <p style="color:#4b5563;font-size:13px;line-height:1.7;margin:0">{ai["period_summary"]}</p>
        </div>''')

    # ── KPI Cards ──
    if totals:
        roas_val = totals.get("roas")
        roas_color = "#10b981" if roas_val and float(roas_val) >= 1 else "#ef4444" if roas_val else "#6b7280"
        kpi_cards = [
            ("💰", "총 지출", _fmt_spend(totals.get("spend")), "#3b82f6", None),
            ("👁", "노출", _fmt_num(totals.get("impressions")), "#8b5cf6", f"도달 {_fmt_num(totals.get('reach'))}"),
            ("🖱", "클릭", _fmt_num(totals.get("clicks")), "#10b981", f"CTR {totals.get('ctr', 0):.2f}%"),
            ("🎯", "CPC", _fmt_spend(totals.get("cpc")), "#f97316", None),
            ("📈", "ROAS", _fmt_roas(roas_val), roas_color, f"전환매출 {_fmt_spend(totals.get('conversion_value'))}" if totals.get("conversion_value") else None),
        ]
        parts.append('<div style="margin:20px 24px 0">')
        parts.append('<table style="width:100%;border-collapse:separate;border-spacing:8px 0"><tr>')
        for icon, label, value, color, sub in kpi_cards:
            sub_html = f'<div style="font-size:10px;color:#9ca3af;margin-top:2px">{sub}</div>' if sub else ""
            parts.append(f'''
            <td style="width:20%;background:#f9fafb;border:1px solid #f3f4f6;border-radius:12px;padding:12px 10px;text-align:center;vertical-align:top">
                <div style="font-size:14px;margin-bottom:4px">{icon}</div>
                <div style="font-size:10px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">{label}</div>
                <div style="font-size:18px;font-weight:700;color:{color};margin-top:4px">{value}</div>
                {sub_html}
            </td>''')
        parts.append('</tr></table></div>')

    # ── AI KPI Highlights ──
    if ai and ai.get("kpi_highlights"):
        parts.append('<div style="margin:24px 24px 0">')
        parts.append('<h4 style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px">KPI 하이라이트</h4>')
        parts.append('<table style="width:100%;border-collapse:separate;border-spacing:0 6px">')
        for kpi in ai["kpi_highlights"]:
            change = kpi.get("change", "")
            if change.startswith("+"):
                badge_bg, badge_color, arrow = "#dcfce7", "#15803d", "↑"
            elif change.startswith("-"):
                badge_bg, badge_color, arrow = "#fef2f2", "#dc2626", "↓"
            else:
                badge_bg, badge_color, arrow = "#dbeafe", "#2563eb", "→"
            change_badge = f'<span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;background:{badge_bg};color:{badge_color}">{change}</span>' if change else ""
            parts.append(f'''
            <tr><td style="background:#f9fafb;border:1px solid #f3f4f6;border-radius:8px;padding:10px 12px">
                <div style="display:flex;align-items:center;gap:8px">
                    <span style="font-size:16px">{arrow}</span>
                    <div>
                        <div style="font-size:12px;font-weight:700;color:#111827">{kpi.get("metric","")} {kpi.get("value","")} {change_badge}</div>
                        <div style="font-size:11px;color:#6b7280;margin-top:2px">{kpi.get("insight","")}</div>
                    </div>
                </div>
            </td></tr>''')
        parts.append('</table></div>')

    # ── Daily Data Table ──
    if daily:
        parts.append('<div style="margin:24px 24px 0">')
        parts.append('<h4 style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px">일별 데이터</h4>')
        parts.append('<div style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">')
        parts.append('''<table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr style="background:#f9fafb;border-bottom:1px solid #e5e7eb">
                <th style="text-align:left;padding:10px 12px;color:#6b7280;font-weight:600">날짜</th>
                <th style="text-align:right;padding:10px 8px;color:#6b7280;font-weight:600">지출</th>
                <th style="text-align:right;padding:10px 8px;color:#6b7280;font-weight:600">노출</th>
                <th style="text-align:right;padding:10px 8px;color:#6b7280;font-weight:600">도달</th>
                <th style="text-align:right;padding:10px 8px;color:#6b7280;font-weight:600">클릭</th>
                <th style="text-align:right;padding:10px 8px;color:#6b7280;font-weight:600">CTR</th>
                <th style="text-align:right;padding:10px 8px;color:#6b7280;font-weight:600">CPC</th>
                <th style="text-align:right;padding:10px 8px;color:#6b7280;font-weight:600">ROAS</th>
            </tr></thead><tbody>''')
        for i, row in enumerate(daily):
            bg = "#ffffff" if i % 2 == 0 else "#fafbfc"
            roas_v = float(row.get("roas", 0) or 0)
            roas_c = "#10b981" if roas_v >= 1 else "#ef4444" if roas_v > 0 else "#9ca3af"
            date_val = row.get("date_stop") or row.get("date") or "-"
            ctr_val = float(row.get("ctr", 0) or 0)
            parts.append(f'''<tr style="background:{bg};border-bottom:1px solid #f3f4f6">
                <td style="padding:8px 12px;color:#374151;font-weight:500">{date_val}</td>
                <td style="padding:8px;text-align:right;color:#111827;font-weight:600">{_fmt_spend(row.get("spend"))}</td>
                <td style="padding:8px;text-align:right;color:#4b5563">{_fmt_num(row.get("impressions"))}</td>
                <td style="padding:8px;text-align:right;color:#4b5563">{_fmt_num(row.get("reach"))}</td>
                <td style="padding:8px;text-align:right;color:#4b5563">{_fmt_num(row.get("clicks"))}</td>
                <td style="padding:8px;text-align:right;color:#4b5563">{ctr_val:.2f}%</td>
                <td style="padding:8px;text-align:right;color:#4b5563">{_fmt_spend(row.get("cpc"))}</td>
                <td style="padding:8px;text-align:right;font-weight:700;color:{roas_c}">{_fmt_roas(row.get("roas"))}</td>
            </tr>''')
        # Totals footer
        parts.append(f'''</tbody><tfoot><tr style="background:#1e293b">
            <td style="padding:10px 12px;color:white;font-weight:700;font-size:12px">합계</td>
            <td style="padding:10px 8px;text-align:right;color:white;font-weight:700;font-size:12px">{_fmt_spend(totals.get("spend"))}</td>
            <td style="padding:10px 8px;text-align:right;color:white;font-size:12px">{_fmt_num(totals.get("impressions"))}</td>
            <td style="padding:10px 8px;text-align:right;color:white;font-size:12px">{_fmt_num(totals.get("reach"))}</td>
            <td style="padding:10px 8px;text-align:right;color:white;font-size:12px">{_fmt_num(totals.get("clicks"))}</td>
            <td style="padding:10px 8px;text-align:right;color:white;font-size:12px">{totals.get("ctr", 0):.2f}%</td>
            <td style="padding:10px 8px;text-align:right;color:white;font-size:12px">{_fmt_spend(totals.get("cpc"))}</td>
            <td style="padding:10px 8px;text-align:right;color:white;font-weight:700;font-size:12px">{_fmt_roas(totals.get("roas"))}</td>
        </tr></tfoot></table></div></div>''')

    # ── AI Daily Trend Insight ──
    if ai and ai.get("daily_trend_insight"):
        parts.append(f'''
        <div style="margin:16px 24px 0;padding:12px 14px;background:#eff6ff;border:1px solid #dbeafe;border-radius:10px">
            <p style="font-size:12px;color:#1e40af;line-height:1.6;margin:0">{ai["daily_trend_insight"]}</p>
        </div>''')

    # ── Key Insights ──
    if ai and ai.get("key_insights"):
        parts.append('<div style="margin:24px 24px 0">')
        parts.append('<h4 style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px">핵심 인사이트</h4>')
        for i, insight in enumerate(ai["key_insights"]):
            parts.append(f'''
            <div style="display:flex;align-items:flex-start;gap:10px;background:linear-gradient(135deg,#fffbeb,#fff7ed);border:1px solid #fde68a;border-radius:10px;padding:12px;margin-bottom:8px">
                <div style="width:24px;height:24px;background:#f59e0b;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">
                    <span style="color:white;font-size:11px;font-weight:900">{i+1}</span>
                </div>
                <p style="font-size:12px;color:#1f2937;line-height:1.6;margin:0">{insight}</p>
            </div>''')
        parts.append('</div>')

    # ── Recommendations ──
    if ai and ai.get("recommendations"):
        parts.append('<div style="margin:24px 24px 0">')
        parts.append('<h4 style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px">실행 추천</h4>')
        for rec in ai["recommendations"]:
            priority = rec.get("priority", "low")
            if priority == "high":
                border_c, bg_c, badge_bg, badge_label = "#fecaca", "#fef2f2", "#dc2626", "긴급"
            elif priority == "medium":
                border_c, bg_c, badge_bg, badge_label = "#fde68a", "#fffbeb", "#d97706", "중요"
            else:
                border_c, bg_c, badge_bg, badge_label = "#e5e7eb", "#f9fafb", "#6b7280", "참고"
            impact_html = f'<div style="margin-top:6px;font-size:11px;color:#2563eb">🏆 예상 효과: {rec.get("expected_impact","")}</div>' if rec.get("expected_impact") else ""
            parts.append(f'''
            <div style="border:1px solid {border_c};background:{bg_c};border-radius:10px;padding:14px;margin-bottom:8px">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                    <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:{badge_bg};color:white">{badge_label}</span>
                    <span style="font-size:12px;font-weight:700;color:#111827">{rec.get("title","")}</span>
                </div>
                <p style="font-size:12px;color:#4b5563;line-height:1.6;margin:0">{rec.get("description","")}</p>
                {impact_html}
            </div>''')
        parts.append('</div>')

    # ── Fallback AI text ──
    if not ai and ai_text:
        parts.append(f'''
        <div style="margin:24px;padding:20px;background:#f9fafb;border:1px solid #f3f4f6;border-radius:12px">
            <h4 style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px">AI 분석</h4>
            <div style="font-size:12px;color:#374151;white-space:pre-wrap;line-height:1.7">{ai_text}</div>
        </div>''')

    if not ai and not ai_text and not totals:
        parts.append('<div style="padding:24px;text-align:center"><p style="color:#9ca3af">리포트 데이터가 없습니다.</p></div>')

    return "\n".join(parts)


@router.post("/report")
async def generate_report(
    request: ReportRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """기간 지정 리포트 생성."""
    report_data = {"period": {"start": request.start_date, "end": request.end_date}}
    base_url = f"{settings.META_GRAPH_API_BASE}/{settings.META_API_VERSION}"

    if current_user.meta_access_token and current_user.meta_ad_account_id:
        ad_account_id = current_user.meta_ad_account_id
        if not ad_account_id.startswith("act_"):
            ad_account_id = f"act_{ad_account_id}"
        # Use campaign-level or account-level endpoint
        insights_endpoint = f"{request.meta_campaign_id}/insights" if request.meta_campaign_id else f"{ad_account_id}/insights"
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.get(
                    f"{base_url}/{insights_endpoint}",
                    params={
                        "access_token": current_user.meta_access_token,
                        "fields": "spend,impressions,reach,clicks,ctr,cpc,cpm,actions,cost_per_action_type,action_values,purchase_roas,website_purchase_roas",
                        "time_range": json.dumps({"since": request.start_date, "until": request.end_date}),
                        "time_increment": 1,
                    }
                )
                if resp.status_code == 200:
                    daily = resp.json().get("data", [])
                    # Compute ROAS for each daily row + period totals
                    total_spend = 0.0
                    total_impressions = 0
                    total_clicks = 0
                    total_reach = 0
                    total_purchase_value = 0.0
                    for row in daily:
                        row["roas"] = MetaAdsService._calc_roas(row)
                        total_spend += float(row.get("spend", 0) or 0)
                        total_impressions += int(row.get("impressions", 0) or 0)
                        total_clicks += int(row.get("clicks", 0) or 0)
                        total_reach += int(row.get("reach", 0) or 0)
                        # ROAS = purchase revenue / spend (only purchase-related values)
                        roas_val = MetaAdsService._extract_roas_value(row.get("website_purchase_roas"))
                        if roas_val and float(row.get("spend", 0) or 0) > 0:
                            total_purchase_value += roas_val * float(row.get("spend", 0))
                        else:
                            roas_val = MetaAdsService._extract_roas_value(row.get("purchase_roas"))
                            if roas_val and float(row.get("spend", 0) or 0) > 0:
                                total_purchase_value += roas_val * float(row.get("spend", 0))
                            else:
                                # Fallback: sum purchase action_values
                                purchase_types = {"offsite_conversion.fb_pixel_purchase", "purchase", "omni_purchase", "onsite_web_purchase"}
                                for av in (row.get("action_values") or []):
                                    if av.get("action_type") in purchase_types:
                                        total_purchase_value += float(av.get("value", 0))
                    report_data["daily_data"] = daily
                    report_data["totals"] = {
                        "spend": total_spend,
                        "impressions": total_impressions,
                        "clicks": total_clicks,
                        "reach": total_reach,
                        "ctr": round(total_clicks / total_impressions * 100, 2) if total_impressions > 0 else 0,
                        "cpc": round(total_spend / total_clicks, 0) if total_clicks > 0 else 0,
                        "conversion_value": total_purchase_value,
                        "roas": round(total_purchase_value / total_spend, 2) if total_spend > 0 and total_purchase_value > 0 else None,
                    }
                else:
                    logger.error(f"Meta report insights {resp.status_code}: {resp.text[:200]}")

                if request.meta_campaign_id:
                    camp_resp = await client.get(
                        f"{base_url}/{request.meta_campaign_id}",
                        params={
                            "access_token": current_user.meta_access_token,
                            "fields": "name,status,objective",
                        }
                    )
                    if camp_resp.status_code == 200:
                        report_data["campaign_info"] = camp_resp.json()
        except Exception as e:
            logger.error(f"Failed to fetch Meta report: {e}")
    elif request.campaign_id:
        result = await db.execute(
            select(CampaignPerformance)
            .where(
                CampaignPerformance.campaign_id == request.campaign_id,
                CampaignPerformance.date >= datetime.strptime(request.start_date, "%Y-%m-%d"),
                CampaignPerformance.date <= datetime.strptime(request.end_date, "%Y-%m-%d"),
            )
            .order_by(CampaignPerformance.date)
        )
        records = result.scalars().all()
        report_data["daily_data"] = [
            {"date": r.date.isoformat(), "spend": r.spend, "impressions": r.impressions,
             "clicks": r.clicks, "conversions": r.conversions, "revenue": r.revenue}
            for r in records
        ]

    # AI summary
    claude = ClaudeService()
    try:
        ai_resp = claude.client.messages.create(
            model=claude.model, max_tokens=2048,
            messages=[{"role": "user", "content": f"""다음 캠페인 성과 데이터를 분석하여 한국어 리포트를 작성해주세요.

{json.dumps(report_data, ensure_ascii=False, indent=2)}

리포트 형식 (JSON으로 응답해주세요):
{{
  "headline": "한 줄 핵심 분석 제목 (예: 'ROAS 1.8x 달성, 전환 효율 개선 필요')",
  "period_summary": "2-3문장 기간 요약",
  "kpi_highlights": [
    {{"metric": "지표명", "value": "값", "change": "+15%", "insight": "한 줄 해석"}}
  ],
  "daily_trend_insight": "일별 트렌드에서 발견한 핵심 패턴 2-3문장",
  "key_insights": ["핵심 인사이트 1", "핵심 인사이트 2", "핵심 인사이트 3"],
  "recommendations": [
    {{"title": "추천 제목", "description": "상세 설명", "priority": "high/medium/low", "expected_impact": "예상 효과"}}
  ],
  "overall_grade": "A/B/C/D/F",
  "grade_reason": "등급 사유 1문장"
}}

ROAS(광고비 대비 매출)는 특히 중요하게 분석해주세요. JSON만 응답해주세요."""}],
        )
        ai_text = ai_resp.content[0].text
        # Try to parse structured JSON
        try:
            import re as _re
            json_match = _re.search(r'\{[\s\S]+\}', ai_text)
            if json_match:
                report_data["ai_report"] = json.loads(json_match.group())
            else:
                report_data["ai_report"] = ai_text
        except (json.JSONDecodeError, Exception):
            report_data["ai_report"] = ai_text
    except Exception as e:
        logger.error(f"AI report generation failed: {e}", exc_info=True)
        report_data["ai_report"] = f"AI 리포트 생성에 실패했습니다. ({type(e).__name__}: {str(e)[:100]})"

    return report_data


@router.post("/report/email")
async def send_report_email(
    request: ReportEmailRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """리포트를 이메일로 발송. 프론트엔드에서 이미 생성된 리포트 데이터를 받아 전송."""
    # Use pre-generated report data from frontend if available
    if request.report_data:
        report = request.report_data
    else:
        try:
            report_request = ReportRequest(
                campaign_id=request.campaign_id, meta_campaign_id=request.meta_campaign_id,
                start_date=request.start_date, end_date=request.end_date,
            )
            report = await generate_report(report_request, current_user, db)
        except Exception as e:
            logger.error(f"Report generation failed for email: {e}")
            raise HTTPException(status_code=500, detail=f"리포트 생성 실패: {str(e)}")

    # Build email HTML from report data
    report_body = _build_report_html(report)

    html_content = f"""
    <div style="font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', 'Segoe UI', Arial, sans-serif; max-width: 680px; margin: 0 auto; padding: 16px;">
        <div style="border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;box-shadow:0 4px 12px rgba(0,0,0,0.08);background:white">
            {report_body}
            <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:10px 24px;display:flex;justify-content:space-between">
                <span style="font-size:11px;color:#9ca3af">Meta-Commander 자동 생성 리포트</span>
                <span style="font-size:11px;color:#9ca3af">{datetime.now().strftime('%Y-%m-%d')}</span>
            </div>
        </div>
    </div>"""

    if not settings.RESEND_API_KEY:
        raise HTTPException(
            status_code=400,
            detail="이메일 발송을 위해 RESEND_API_KEY 환경변수를 설정해주세요."
        )

    try:
        resend.api_key = settings.RESEND_API_KEY
        from_email = settings.RESEND_FROM_EMAIL or "onboarding@resend.dev"
        # Resend requires "Name <email>" format for custom domains
        if "<" not in from_email:
            from_email = f"Meta-Commander <{from_email}>"
        logger.info(f"Sending email: from={from_email}, to={request.email}, api_key_prefix={settings.RESEND_API_KEY[:8]}...")

        params = {
            "from": from_email,
            "to": [request.email],
            "subject": f"[Meta-Commander] 성과 리포트 ({request.start_date} ~ {request.end_date})",
            "html": html_content,
        }
        logger.info(f"Resend params: from={params['from']}, to={params['to']}, subject={params['subject']}")

        result = resend.Emails.send(params)
        logger.info(f"Resend result: {result}")

        # resend v2.0 returns dict with 'id' on success, or may return error info
        if isinstance(result, dict) and result.get("id"):
            return {"success": True, "message": f"리포트가 {request.email}로 발송되었습니다.", "email_id": result["id"]}

        # If result doesn't have 'id', it might be an error
        logger.warning(f"Resend unexpected result: {result}")
        return {"success": True, "message": f"리포트가 {request.email}로 발송 요청되었습니다."}

    except Exception as e:
        error_detail = str(e)
        error_type = type(e).__name__
        logger.error(f"Email send error: {error_type}: {error_detail}")

        # Try to extract more details from the exception
        if hasattr(e, 'status_code'):
            logger.error(f"Resend HTTP status: {getattr(e, 'status_code', 'unknown')}")
        if hasattr(e, 'message'):
            logger.error(f"Resend message: {getattr(e, 'message', 'unknown')}")
        if hasattr(e, 'body'):
            logger.error(f"Resend body: {getattr(e, 'body', 'unknown')}")

        hint = ""
        from_addr = settings.RESEND_FROM_EMAIL or "onboarding@resend.dev"
        if "validation" in error_detail.lower() or "from" in error_detail.lower() or "403" in error_detail:
            hint = f" 현재 RESEND_FROM_EMAIL='{from_addr}'. 이 이메일의 도메인이 Resend에 등록/인증되었는지 확인하세요."
        elif "401" in error_detail or "unauthorized" in error_detail.lower():
            hint = " RESEND_API_KEY가 올바른지 확인하세요."
        elif "missing" in error_detail.lower():
            hint = f" RESEND_FROM_EMAIL='{from_addr}' 설정을 확인하세요."

        raise HTTPException(
            status_code=500,
            detail=f"이메일 발송 실패 ({error_type}): {error_detail}{hint}"
        )


@router.post("/report/email/test")
async def test_email(
    current_user: User = Depends(get_current_user),
):
    """Send a test email to diagnose Resend configuration."""
    diag = {
        "resend_api_key_set": bool(settings.RESEND_API_KEY),
        "resend_api_key_prefix": settings.RESEND_API_KEY[:8] + "..." if settings.RESEND_API_KEY else "NOT SET",
        "resend_from_email": settings.RESEND_FROM_EMAIL,
    }

    if not settings.RESEND_API_KEY:
        return {"success": False, "diagnostics": diag, "error": "RESEND_API_KEY가 설정되지 않았습니다."}

    from_email = settings.RESEND_FROM_EMAIL or "onboarding@resend.dev"
    if "<" not in from_email:
        from_email = f"Meta-Commander <{from_email}>"
    diag["from_email_formatted"] = from_email

    try:
        resend.api_key = settings.RESEND_API_KEY

        # Try listing domains to verify API key works
        try:
            domains = resend.Domains.list()
            diag["domains"] = str(domains)
        except Exception as de:
            diag["domains_error"] = f"{type(de).__name__}: {de}"

        # Send test email to the user
        result = resend.Emails.send({
            "from": from_email,
            "to": [current_user.email],
            "subject": "[Meta-Commander] 테스트 이메일",
            "html": "<h2>테스트 이메일</h2><p>이 이메일이 보이면 이메일 발송이 정상 작동합니다.</p>",
        })
        diag["send_result"] = str(result)

        if isinstance(result, dict) and result.get("id"):
            return {"success": True, "diagnostics": diag, "message": f"테스트 이메일이 {current_user.email}로 발송되었습니다."}

        return {"success": False, "diagnostics": diag, "error": f"예상치 못한 응답: {result}"}
    except Exception as e:
        diag["error_type"] = type(e).__name__
        diag["error_detail"] = str(e)
        if hasattr(e, 'status_code'):
            diag["error_status"] = getattr(e, 'status_code', None)
        if hasattr(e, 'body'):
            diag["error_body"] = str(getattr(e, 'body', None))
        return {"success": False, "diagnostics": diag, "error": str(e)}


# ══════════════════════════════════════════════════
#  자동 관리 룰 CRUD + 실행
# ══════════════════════════════════════════════════

class RuleCreate(BaseModel):
    name: str
    metric: str
    operator: str
    threshold: float
    duration_type: str = "any"
    duration_value: Optional[int] = None
    secondary_metric: Optional[str] = None
    secondary_operator: Optional[str] = None
    secondary_threshold: Optional[float] = None
    action: str
    action_value: Optional[float] = None
    target_type: str = "campaign"
    target_id: Optional[str] = None
    target_name: Optional[str] = None

class RuleUpdate(BaseModel):
    name: Optional[str] = None
    enabled: Optional[bool] = None
    metric: Optional[str] = None
    operator: Optional[str] = None
    threshold: Optional[float] = None
    action: Optional[str] = None
    action_value: Optional[float] = None


def _rule_dict(r):
    return {
        "id": r.id, "name": r.name, "metric": r.metric,
        "operator": r.operator, "threshold": r.threshold,
        "duration_type": r.duration_type, "duration_value": r.duration_value,
        "secondary_metric": r.secondary_metric, "secondary_operator": r.secondary_operator,
        "secondary_threshold": r.secondary_threshold,
        "action": r.action, "action_value": r.action_value,
        "target_type": r.target_type, "target_id": r.target_id, "target_name": r.target_name,
        "enabled": r.enabled, "times_triggered": r.times_triggered,
        "last_checked_at": r.last_checked_at.isoformat() if r.last_checked_at else None,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


@router.get("/rules")
async def list_rules(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AutoRule).where(AutoRule.user_id == str(current_user.id)).order_by(AutoRule.created_at.desc())
    )
    return [_rule_dict(r) for r in result.scalars().all()]


@router.post("/rules")
async def create_rule(
    data: RuleCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rule = AutoRule(id=str(uuid.uuid4()), user_id=str(current_user.id), **data.model_dump())
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return _rule_dict(rule)


@router.put("/rules/{rule_id}")
async def update_rule(
    rule_id: str,
    data: RuleUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(AutoRule).where(AutoRule.id == rule_id, AutoRule.user_id == str(current_user.id)))
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(404, "룰을 찾을 수 없습니다")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(rule, k, v)
    await db.commit()
    await db.refresh(rule)
    return _rule_dict(rule)


@router.delete("/rules/{rule_id}")
async def delete_rule(
    rule_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(AutoRule).where(AutoRule.id == rule_id, AutoRule.user_id == str(current_user.id)))
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(404, "룰을 찾을 수 없습니다")
    await db.delete(rule)
    await db.commit()
    return {"message": "삭제되었습니다"}


@router.post("/rules/execute")
async def execute_rules(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = MetaAdsService(current_user)
    if not svc.connected:
        raise HTTPException(400, "Meta 계정을 먼저 연동해주세요.")
    results = await run_rules(db, str(current_user.id), svc)
    return {"executed": len(results), "logs": results}


@router.get("/rules/logs")
async def get_rule_logs(
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AutoRuleLog)
        .where(AutoRuleLog.user_id == str(current_user.id))
        .order_by(AutoRuleLog.triggered_at.desc())
        .limit(limit)
    )
    logs = result.scalars().all()
    return [{
        "id": l.id, "rule_id": l.rule_id, "action_taken": l.action_taken,
        "target_type": l.target_type, "target_id": l.target_id, "target_name": l.target_name,
        "metric_name": l.metric_name, "metric_value": l.metric_value,
        "threshold_value": l.threshold_value, "details": l.details,
        "triggered_at": l.triggered_at.isoformat() if l.triggered_at else None,
    } for l in logs]


@router.post("/rules/ai-recommend")
async def ai_recommend_rules(
    request: AIAnalysisRequest = AIAnalysisRequest(),
    current_user: User = Depends(get_current_user),
):
    """AI 기반 자동 관리 룰 추천."""
    svc = MetaAdsService(current_user)
    if not svc.connected:
        raise HTTPException(400, "Meta 계정을 먼저 연동해주세요.")

    if request.overview_data and request.overview_data.get("connected"):
        context = svc.build_context_from_overview(request.overview_data)
    else:
        context = await svc.build_full_context_for_ai("last_7d")

    claude = ClaudeService()
    try:
        resp = claude.client.messages.create(
            model=claude.model, max_tokens=1024,
            messages=[{"role": "user", "content": f"""Meta 광고 계정 데이터를 분석하여 자동 관리 룰 3~5개를 JSON 배열로 추천.

{context}

각 룰 형식:
- name: 룰 이름 (한국어)
- metric: cpc|ctr|roas|cvr|cpm|spend|frequency
- operator: gt|lt|gte|lte
- threshold: 숫자
- duration_type: any|consecutive_days|total_days
- duration_value: 일수 (any면 null)
- action: pause|decrease_budget|increase_budget
- action_value: 예산변경%(pause면 null)
- target_type: campaign|adset|ad
- reason: 추천이유 (한국어 1문장)

JSON 배열만 반환. 마크다운 코드블록 없이."""}],
        )
        raw = resp.content[0].text.strip()
        if "```" in raw:
            raw = raw.split("```json")[-1].split("```")[0] if "```json" in raw else raw.split("```")[1].split("```")[0]
        return {"recommendations": json.loads(raw.strip())}
    except Exception as e:
        raise HTTPException(500, f"AI 추천 실패: {e}")


# ══════════════════════════════════════════════════
#  스케줄 리포트 CRUD
# ══════════════════════════════════════════════════

class ScheduleCreate(BaseModel):
    name: str
    schedule_type: str
    day_of_week: Optional[int] = None
    day_of_month: Optional[int] = None
    meta_campaign_id: Optional[str] = None
    lookback_days: int = 7
    email_to: Optional[str] = None

class ScheduleUpdate(BaseModel):
    name: Optional[str] = None
    enabled: Optional[bool] = None
    schedule_type: Optional[str] = None
    day_of_week: Optional[int] = None
    day_of_month: Optional[int] = None
    lookback_days: Optional[int] = None
    email_to: Optional[str] = None


def _calc_next_run(sched):
    now = datetime.utcnow()
    if sched.schedule_type == "weekly":
        days_ahead = (sched.day_of_week or 0) - now.weekday()
        if days_ahead <= 0:
            days_ahead += 7
        return now.replace(hour=9, minute=0, second=0, microsecond=0) + timedelta(days=days_ahead)
    else:
        dom = sched.day_of_month or 1
        m = now.month + 1 if now.day >= dom else now.month
        y = now.year + (1 if m > 12 else 0)
        m = m if m <= 12 else m - 12
        return datetime(y, m, dom, 9, 0, 0)


def _sched_dict(s):
    return {
        "id": s.id, "name": s.name, "schedule_type": s.schedule_type,
        "day_of_week": s.day_of_week, "day_of_month": s.day_of_month,
        "meta_campaign_id": s.meta_campaign_id, "lookback_days": s.lookback_days,
        "email_to": s.email_to, "enabled": s.enabled,
        "last_run_at": s.last_run_at.isoformat() if s.last_run_at else None,
        "next_run_at": s.next_run_at.isoformat() if s.next_run_at else None,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


@router.get("/schedules")
async def list_schedules(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ScheduledReport).where(ScheduledReport.user_id == str(current_user.id)).order_by(ScheduledReport.created_at.desc())
    )
    return [_sched_dict(s) for s in result.scalars().all()]


@router.post("/schedules")
async def create_schedule(
    data: ScheduleCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        sched = ScheduledReport(id=str(uuid.uuid4()), user_id=str(current_user.id), **data.model_dump())
        sched.next_run_at = _calc_next_run(sched)
        db.add(sched)
        await db.commit()
        await db.refresh(sched)
        return _sched_dict(sched)
    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to create schedule: {e}")
        raise HTTPException(500, detail=f"스케줄 생성 중 오류: {str(e)}")


@router.put("/schedules/{schedule_id}")
async def update_schedule(
    schedule_id: str,
    data: ScheduleUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ScheduledReport).where(
        ScheduledReport.id == schedule_id, ScheduledReport.user_id == str(current_user.id)
    ))
    sched = result.scalar_one_or_none()
    if not sched:
        raise HTTPException(404, "스케줄을 찾을 수 없습니다")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(sched, k, v)
    sched.next_run_at = _calc_next_run(sched)
    await db.commit()
    await db.refresh(sched)
    return _sched_dict(sched)


@router.delete("/schedules/{schedule_id}")
async def delete_schedule(
    schedule_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ScheduledReport).where(
        ScheduledReport.id == schedule_id, ScheduledReport.user_id == str(current_user.id)
    ))
    sched = result.scalar_one_or_none()
    if not sched:
        raise HTTPException(404, "스케줄을 찾을 수 없습니다")
    await db.delete(sched)
    await db.commit()
    return {"message": "삭제되었습니다"}
