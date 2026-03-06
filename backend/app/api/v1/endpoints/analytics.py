"""Performance Dashboard endpoints (TAB 4) - Real Meta data analysis."""
import json
import logging
from typing import List, Optional
from datetime import date, datetime, timedelta

import httpx
import resend
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import get_settings
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
from app.services.meta_ads_service import MetaAdsService

logger = logging.getLogger(__name__)
router = APIRouter()
settings = get_settings()


# ──────────────────────────────────────────────
# Full Account Overview (NEW - core endpoint)
# ──────────────────────────────────────────────

@router.get("/account-overview")
async def get_account_overview(
    date_preset: str = Query(default="last_7d"),
    current_user: User = Depends(get_current_user),
):
    """Get complete ad account overview: all campaigns, ad sets, ads with insights."""
    svc = MetaAdsService(current_user)
    if not svc.connected:
        return {"connected": False, "error": "Meta 계정을 먼저 연동해주세요."}

    overview = await svc.get_account_overview(date_preset)
    return overview


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

@router.get("/ai-analysis")
async def get_ai_analysis(
    date_preset: str = Query(default="last_7d"),
    current_user: User = Depends(get_current_user),
):
    """
    AI-powered analysis of entire ad account.
    Returns actionable recommendations: pause this ad, increase budget there, creative fatigue alerts.
    """
    svc = MetaAdsService(current_user)
    if not svc.connected:
        return {"connected": False, "recommendations": [], "error": "Meta 계정을 연동해주세요."}

    # Get full context
    context_text = await svc.build_full_context_for_ai(date_preset)

    claude = ClaudeService()
    try:
        response = claude.client.messages.create(
            model=claude.model,
            max_tokens=4096,
            messages=[{
                "role": "user",
                "content": f"""당신은 Meta 광고 전문 분석가입니다. 아래 광고 계정 데이터를 분석하고 실행 가능한 액션 아이템을 JSON으로 반환하세요.

{context_text}

다음 JSON 형식으로 반환하세요:
{{
  "account_health": "good|warning|critical",
  "health_summary": "계정 전체 건강도 요약 (2-3문장)",
  "kpi_analysis": {{
    "total_spend": "총 지출 분석",
    "ctr_assessment": "CTR 분석 (업종 평균 대비)",
    "cpc_assessment": "CPC 분석",
    "roas_assessment": "ROAS 분석 (있는 경우)",
    "frequency_warning": "빈도 분석 (소재 피로도)"
  }},
  "action_items": [
    {{
      "priority": "high|medium|low",
      "type": "pause_ad|increase_budget|decrease_budget|change_creative|change_targeting|create_campaign",
      "target_id": "관련 캠페인/광고세트/광고 ID",
      "target_name": "관련 이름",
      "action": "구체적 액션 설명",
      "reason": "이유",
      "expected_impact": "예상 효과"
    }}
  ],
  "creative_fatigue": [
    {{
      "ad_name": "광고 이름",
      "ad_id": "ID",
      "frequency": "빈도 수치",
      "recommendation": "교체/수정/유지"
    }}
  ],
  "budget_recommendations": [
    {{
      "campaign_name": "캠페인 이름",
      "campaign_id": "ID",
      "current_budget": "현재 예산",
      "recommended_budget": "추천 예산",
      "reason": "이유"
    }}
  ],
  "targeting_insights": [
    {{
      "adset_name": "광고세트 이름",
      "insight": "타겟팅 인사이트",
      "recommendation": "추천 사항"
    }}
  ],
  "next_steps": ["다음 3가지 우선 실행 사항"]
}}

반드시 JSON만 반환하세요. 마크다운이나 설명 없이 JSON만."""
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
    current_user: User = Depends(get_current_user),
):
    """Get daily account-level trend for charts."""
    svc = MetaAdsService(current_user)
    if not svc.connected:
        return {"connected": False, "data": []}

    data = await svc.get_account_daily_trend(days)
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


@router.post("/report")
async def generate_report(
    request: ReportRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """기간 지정 리포트 생성."""
    report_data = {"period": {"start": request.start_date, "end": request.end_date}}
    base_url = f"{settings.META_GRAPH_API_BASE}/{settings.META_API_VERSION}"

    if request.meta_campaign_id and current_user.meta_access_token:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(
                    f"{base_url}/{request.meta_campaign_id}/insights",
                    params={
                        "access_token": current_user.meta_access_token,
                        "fields": "spend,impressions,reach,clicks,ctr,cpc,cpm,actions,cost_per_action_type",
                        "time_range": json.dumps({"since": request.start_date, "until": request.end_date}),
                        "time_increment": 1,
                    }
                )
                if resp.status_code == 200:
                    report_data["daily_data"] = resp.json().get("data", [])

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

리포트 형식:
1. 기간 요약
2. 주요 KPI 분석
3. 일별 트렌드 분석
4. 핵심 인사이트 (3-5개)
5. 실행 가능한 추천 사항 (3-5개)

마크다운 형식으로 작성해주세요."""}],
        )
        report_data["ai_report"] = ai_resp.content[0].text
    except Exception:
        report_data["ai_report"] = "AI 리포트 생성에 실패했습니다."

    return report_data


@router.post("/report/email")
async def send_report_email(
    request: ReportEmailRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """리포트를 이메일로 발송."""
    report_request = ReportRequest(
        campaign_id=request.campaign_id, meta_campaign_id=request.meta_campaign_id,
        start_date=request.start_date, end_date=request.end_date,
    )
    report = await generate_report(report_request, current_user, db)

    ai_report = report.get("ai_report", "리포트 데이터가 없습니다.")
    html_content = ai_report.replace("\n", "<br>")
    html_content = f"""
    <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #1877F2, #E1306C); padding: 20px; border-radius: 12px; margin-bottom: 20px;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Meta-Commander 성과 리포트</h1>
            <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0;">기간: {request.start_date} ~ {request.end_date}</p>
        </div>
        <div style="padding: 20px; background: #f9fafb; border-radius: 8px; line-height: 1.8;">{html_content}</div>
        <p style="color: #999; font-size: 12px; margin-top: 20px; text-align: center;">Meta-Commander에서 자동 생성된 리포트입니다.</p>
    </div>"""

    try:
        resend.api_key = settings.RESEND_API_KEY
        resend.Emails.send({
            "from": settings.RESEND_FROM_EMAIL,
            "to": [request.email],
            "subject": f"[Meta-Commander] 성과 리포트 ({request.start_date} ~ {request.end_date})",
            "html": html_content,
        })
        return {"success": True, "message": f"리포트가 {request.email}로 발송되었습니다."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"이메일 발송 실패: {str(e)}")
