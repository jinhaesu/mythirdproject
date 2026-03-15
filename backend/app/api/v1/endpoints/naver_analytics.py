"""Naver advertising analytics and management endpoints.

Covers:
  - Search Ads (검색광고): overview, campaigns, adgroups, keywords, trends, AI analysis
  - GFA (성과형 디스플레이): overview, campaigns, adgroups, trends, AI analysis
  - Campaign/keyword management: create, update, bid changes
  - Reports: generate, email
  - Auto-rules: CRUD + execution
"""
import asyncio
import json
import logging
import uuid
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

import httpx

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_user
from app.core.config import get_settings
from app.db.database import get_db
from app.models.ad_platform import PlatformConnection
from app.models.auto_rule import AutoRule, AutoRuleLog
from app.models.user import User
from app.services.naver import NaverSearchAdsAPI, NaverGFAAPI

logger = logging.getLogger(__name__)
router = APIRouter()
settings = get_settings()


# ─── Pydantic request/response models ───────────────────────


class NaverCampaignCreate(BaseModel):
    name: str
    campaign_tp: str = "WEB_SITE"
    daily_budget: int = 10000
    delivery_method: str = "STANDARD"


class NaverCampaignUpdate(BaseModel):
    name: Optional[str] = None
    daily_budget: Optional[int] = None
    user_lock: Optional[bool] = None
    delivery_method: Optional[str] = None


class NaverAdGroupCreate(BaseModel):
    name: str
    bid_amt: int = 70
    daily_budget: Optional[int] = None
    targets: Optional[dict] = None


class NaverKeywordCreate(BaseModel):
    adgroup_id: str
    keywords: List[dict]  # [{"keyword": "...", "bidAmt": 100}, ...]


class NaverKeywordBidUpdate(BaseModel):
    bid_amt: int


class GFACampaignCreate(BaseModel):
    name: str
    objective: str = "TRAFFIC"
    daily_budget: int = 10000
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class GFACampaignUpdate(BaseModel):
    name: Optional[str] = None
    daily_budget: Optional[int] = None
    status: Optional[str] = None


class AIAnalysisRequest(BaseModel):
    date_range: Optional[str] = "last_7_days"
    focus: Optional[str] = None  # "cost", "conversion", "keyword", etc.
    custom_prompt: Optional[str] = None


class AutoRuleCreate(BaseModel):
    name: str
    platform: str = "NAVER_SEARCH"  # NAVER_SEARCH | NAVER_GFA
    metric: str  # cpc, ctr, roas, spend, etc.
    operator: str  # gt, lt, gte, lte
    threshold: float
    action: str  # pause, increase_budget, decrease_budget, increase_bid, decrease_bid
    action_value: Optional[float] = None
    target_type: str = "campaign"
    target_id: Optional[str] = None
    target_name: Optional[str] = None
    duration_type: str = "any"
    duration_value: Optional[int] = None
    secondary_metric: Optional[str] = None
    secondary_operator: Optional[str] = None
    secondary_threshold: Optional[float] = None


class AutoRuleUpdate(BaseModel):
    name: Optional[str] = None
    enabled: Optional[bool] = None
    metric: Optional[str] = None
    operator: Optional[str] = None
    threshold: Optional[float] = None
    action: Optional[str] = None
    action_value: Optional[float] = None


class ReportEmailRequest(BaseModel):
    recipient_email: str
    report_type: str = "weekly"  # daily, weekly, monthly
    platforms: List[str] = ["NAVER_SEARCH", "NAVER_GFA"]
    date_range: Optional[str] = "last_7_days"


# ─── Helpers ─────────────────────────────────────────────────


async def _get_naver_search_api(
    current_user: User,
    db: AsyncSession,
) -> NaverSearchAdsAPI:
    """Resolve Naver Search Ads credentials and return API client."""
    # 1) Try PlatformConnection
    result = await db.execute(
        select(PlatformConnection).where(
            PlatformConnection.user_id == current_user.id,
            PlatformConnection.platform == "NAVER",
            PlatformConnection.is_active == True,  # noqa: E712
        )
    )
    conn = result.scalar_one_or_none()

    if conn and conn.access_token and conn.account_id:
        # access_token = api_key, refresh_token = secret_key
        return NaverSearchAdsAPI(
            api_key=conn.access_token,
            secret_key=conn.refresh_token or settings.NAVER_ADS_SECRET_KEY,
            customer_id=conn.account_id,
        )

    # 2) Fallback to global settings
    if settings.NAVER_ADS_API_KEY and settings.NAVER_ADS_CUSTOMER_ID:
        return NaverSearchAdsAPI(
            api_key=settings.NAVER_ADS_API_KEY,
            secret_key=settings.NAVER_ADS_SECRET_KEY,
            customer_id=settings.NAVER_ADS_CUSTOMER_ID,
        )

    raise HTTPException(
        status_code=400,
        detail="네이버 검색광고 계정이 연결되지 않았습니다. 설정에서 연결해주세요.",
    )


async def _get_naver_gfa_api(
    current_user: User,
    db: AsyncSession,
) -> NaverGFAAPI:
    """Resolve Naver GFA credentials and return API client."""
    result = await db.execute(
        select(PlatformConnection).where(
            PlatformConnection.user_id == current_user.id,
            PlatformConnection.platform == "NAVER",
            PlatformConnection.is_active == True,  # noqa: E712
        )
    )
    conn = result.scalar_one_or_none()

    # Check for GFA-specific settings first, then fallback
    gfa_api_key = settings.NAVER_GFA_API_KEY
    gfa_secret = settings.NAVER_GFA_SECRET_KEY
    gfa_customer = settings.NAVER_GFA_CUSTOMER_ID

    if gfa_api_key and gfa_customer:
        return NaverGFAAPI(
            api_key=gfa_api_key,
            secret_key=gfa_secret,
            customer_id=gfa_customer,
        )

    if conn and conn.access_token and conn.account_id:
        return NaverGFAAPI(
            api_key=conn.access_token,
            secret_key=conn.refresh_token or "",
            customer_id=conn.account_id,
        )

    raise HTTPException(
        status_code=400,
        detail="네이버 GFA 계정이 연결되지 않았습니다. 설정에서 연결해주세요.",
    )


def _date_range_to_dates(date_range: str):
    """Convert date range preset to (start_date, end_date) strings."""
    today = date.today()
    presets = {
        "today": (today, today),
        "yesterday": (today - timedelta(days=1), today - timedelta(days=1)),
        "last_7_days": (today - timedelta(days=7), today),
        "last_14_days": (today - timedelta(days=14), today),
        "last_30_days": (today - timedelta(days=30), today),
        "this_month": (today.replace(day=1), today),
    }
    start, end = presets.get(date_range, (today - timedelta(days=7), today))
    return start.isoformat(), end.isoformat()


# ═══════════════════════════════════════════════════════════════
#  SEARCH ADS ENDPOINTS (검색광고)
# ═══════════════════════════════════════════════════════════════


@router.get("/search-ads/debug")
async def search_ads_debug(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """검색광고 API 연결 디버그 (인증 정보 확인)."""
    api = await _get_naver_search_api(current_user, db)
    debug_info = {
        "api_key_length": len(api.api_key) if api.api_key else 0,
        "secret_key_length": len(api.secret_key) if api.secret_key else 0,
        "customer_id": api.customer_id,
        "api_key_prefix": api.api_key[:8] + "..." if api.api_key else "",
    }
    try:
        result = await api.get_campaigns()
        debug_info["status"] = "OK"
        debug_info["campaigns_count"] = len(result)
        debug_info["sample"] = result[:2] if result else []
    except Exception as e:
        debug_info["status"] = "ERROR"
        debug_info["error"] = str(e)
    return debug_info


@router.get("/search-ads/overview")
async def search_ads_overview(
    date_range: str = Query(default="last_7_days"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """검색광고 계정 전체 성과 개요."""
    api = await _get_naver_search_api(current_user, db)
    start_date, end_date = _date_range_to_dates(date_range)

    # Fetch campaigns + stats
    try:
        campaigns = await api.get_campaigns()
    except Exception as e:
        logger.error("Naver Search Ads get_campaigns failed: %s", e)
        raise HTTPException(status_code=502, detail=f"네이버 검색광고 API 연결 실패: {str(e)}")
    campaign_ids = [c.get("nccCampaignId") for c in campaigns if c.get("nccCampaignId")]

    stats = []
    if campaign_ids:
        try:
            stats = await api.get_stat_report(
                ids=campaign_ids,
                date_preset="custom",
                start_date=start_date,
                end_date=end_date,
                time_increment="allDays",
            )
        except Exception as e:
            logger.warning("Naver Search Ads get_stat_report failed: %s", e)

    # Aggregate totals
    totals = {
        "impressions": 0,
        "clicks": 0,
        "spend": 0,
        "conversions": 0,
        "revenue": 0,
    }
    for s in stats:
        totals["impressions"] += int(s.get("impCnt", 0))
        totals["clicks"] += int(s.get("clkCnt", 0))
        totals["spend"] += float(s.get("salesAmt", 0))
        totals["conversions"] += int(s.get("ccnt", 0))
        totals["revenue"] += float(s.get("convAmt", 0))

    imp = totals["impressions"]
    clk = totals["clicks"]
    spend = totals["spend"]
    rev = totals["revenue"]

    totals["ctr"] = (clk / imp * 100) if imp > 0 else 0
    totals["cpc"] = (spend / clk) if clk > 0 else 0
    totals["roas"] = (rev / spend * 100) if spend > 0 else 0

    return {
        "platform": "NAVER_SEARCH",
        "date_range": date_range,
        "start_date": start_date,
        "end_date": end_date,
        "total_campaigns": len(campaigns),
        "active_campaigns": len([c for c in campaigns if not c.get("userLock")]),
        "totals": totals,
        "currency": "KRW",
    }


@router.get("/search-ads/campaigns")
async def search_ads_campaigns(
    date_range: str = Query(default="last_7_days"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """캠페인 목록 + 성과 데이터."""
    api = await _get_naver_search_api(current_user, db)
    start_date, end_date = _date_range_to_dates(date_range)

    campaigns = await api.get_campaigns()
    campaign_ids = [c.get("nccCampaignId") for c in campaigns if c.get("nccCampaignId")]

    stats_map = {}
    if campaign_ids:
        stats = await api.get_stat_report(
            ids=campaign_ids,
            date_preset="custom",
            start_date=start_date,
            end_date=end_date,
            time_increment="allDays",
        )
        for s in stats:
            stats_map[s.get("id")] = s

    result = []
    for c in campaigns:
        cid = c.get("nccCampaignId")
        s = stats_map.get(cid, {})
        imp = int(s.get("impCnt", 0))
        clk = int(s.get("clkCnt", 0))
        spend = float(s.get("salesAmt", 0))
        conv = int(s.get("ccnt", 0))
        rev = float(s.get("convAmt", 0))

        result.append({
            "campaign_id": cid,
            "name": c.get("name"),
            "campaign_tp": c.get("campaignTp"),
            "status": "PAUSED" if c.get("userLock") else "ACTIVE",
            "daily_budget": c.get("dailyBudget"),
            "delivery_method": c.get("deliveryMethod"),
            "impressions": imp,
            "clicks": clk,
            "spend": spend,
            "conversions": conv,
            "revenue": rev,
            "ctr": (clk / imp * 100) if imp > 0 else 0,
            "cpc": (spend / clk) if clk > 0 else 0,
            "roas": (rev / spend * 100) if spend > 0 else 0,
        })

    return {
        "platform": "NAVER_SEARCH",
        "date_range": date_range,
        "campaigns": result,
    }


@router.get("/search-ads/campaign/{campaign_id}/adgroups")
async def search_ads_adgroups(
    campaign_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """캠페인 내 광고그룹 목록."""
    api = await _get_naver_search_api(current_user, db)
    adgroups = await api.get_adgroups(campaign_id=campaign_id)
    return {"campaign_id": campaign_id, "adgroups": adgroups}


@router.get("/search-ads/campaign/{campaign_id}/keywords")
async def search_ads_keywords(
    campaign_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """캠페인 내 키워드 목록 + 입찰가."""
    api = await _get_naver_search_api(current_user, db)
    adgroups = await api.get_adgroups(campaign_id=campaign_id)

    all_keywords = []
    for ag in adgroups:
        ag_id = ag.get("nccAdgroupId")
        if not ag_id:
            continue
        keywords = await api.get_keywords(ag_id)
        for kw in keywords:
            kw["adgroupName"] = ag.get("name")
        all_keywords.extend(keywords)

    return {
        "campaign_id": campaign_id,
        "total_keywords": len(all_keywords),
        "keywords": all_keywords,
    }


@router.get("/search-ads/trend")
async def search_ads_trend(
    date_range: str = Query(default="last_7_days"),
    campaign_id: Optional[str] = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """일별 성과 추이."""
    api = await _get_naver_search_api(current_user, db)
    start_date, end_date = _date_range_to_dates(date_range)

    if campaign_id:
        ids = [campaign_id]
    else:
        ids = await api.get_campaign_ids()

    if not ids:
        return {"trend": [], "date_range": date_range}

    daily_stats = await api.get_stat_report(
        ids=ids,
        date_preset="custom",
        start_date=start_date,
        end_date=end_date,
        time_increment="1",  # daily
    )

    # Group by date
    date_map: dict = {}
    for s in daily_stats:
        dt = s.get("statDt", "")
        if dt not in date_map:
            date_map[dt] = {
                "date": dt,
                "impressions": 0,
                "clicks": 0,
                "spend": 0,
                "conversions": 0,
                "revenue": 0,
            }
        date_map[dt]["impressions"] += int(s.get("impCnt", 0))
        date_map[dt]["clicks"] += int(s.get("clkCnt", 0))
        date_map[dt]["spend"] += float(s.get("salesAmt", 0))
        date_map[dt]["conversions"] += int(s.get("ccnt", 0))
        date_map[dt]["revenue"] += float(s.get("convAmt", 0))

    trend = []
    for dt_data in sorted(date_map.values(), key=lambda x: x["date"]):
        imp = dt_data["impressions"]
        clk = dt_data["clicks"]
        sp = dt_data["spend"]
        rv = dt_data["revenue"]
        dt_data["ctr"] = (clk / imp * 100) if imp > 0 else 0
        dt_data["cpc"] = (sp / clk) if clk > 0 else 0
        dt_data["roas"] = (rv / sp * 100) if sp > 0 else 0
        trend.append(dt_data)

    return {"date_range": date_range, "trend": trend}


@router.post("/search-ads/ai-analysis")
async def search_ads_ai_analysis(
    request: AIAnalysisRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """검색광고 AI 분석 (Claude)."""
    from app.services.ai import ClaudeService

    api = await _get_naver_search_api(current_user, db)
    start_date, end_date = _date_range_to_dates(request.date_range or "last_7_days")

    campaigns = await api.get_campaigns()
    campaign_ids = [c.get("nccCampaignId") for c in campaigns if c.get("nccCampaignId")]

    stats = []
    if campaign_ids:
        stats = await api.get_stat_report(
            ids=campaign_ids,
            date_preset="custom",
            start_date=start_date,
            end_date=end_date,
            time_increment="1",
        )

    # Build context for AI
    context = {
        "platform": "Naver Search Ads (네이버 검색광고)",
        "date_range": f"{start_date} ~ {end_date}",
        "total_campaigns": len(campaigns),
        "campaigns": [
            {"name": c.get("name"), "type": c.get("campaignTp"), "budget": c.get("dailyBudget")}
            for c in campaigns[:20]
        ],
        "daily_stats_sample": stats[:30],
    }

    focus_prompt = ""
    if request.focus:
        focus_prompt = f"\n특히 '{request.focus}' 관점에서 분석해주세요."
    if request.custom_prompt:
        focus_prompt += f"\n{request.custom_prompt}"

    prompt = f"""네이버 검색광고 성과 데이터를 분석해주세요.
{focus_prompt}

데이터:
{json.dumps(context, ensure_ascii=False, default=str)}

다음 형식으로 한국어로 답변해주세요:
1. 핵심 성과 요약 (KPI 수치 포함)
2. 주요 인사이트 (3-5개)
3. 개선 제안 (구체적인 액션 아이템)
4. 주의 필요 사항 (이상 징후, 예산 소진 등)
"""

    claude = ClaudeService()
    response = claude.client.messages.create(
        model=claude.model,
        max_tokens=3000,
        messages=[{"role": "user", "content": prompt}],
    )
    analysis = response.content[0].text

    return {
        "platform": "NAVER_SEARCH",
        "date_range": request.date_range,
        "analysis": analysis,
        "data_summary": {
            "total_campaigns": len(campaigns),
            "stats_records": len(stats),
        },
    }


# ═══════════════════════════════════════════════════════════════
#  GFA ENDPOINTS (성과형 디스플레이 광고)
# ═══════════════════════════════════════════════════════════════


@router.get("/gfa/overview")
async def gfa_overview(
    date_range: str = Query(default="last_7_days"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """GFA 계정 전체 성과 개요."""
    api = await _get_naver_gfa_api(current_user, db)
    start_date, end_date = _date_range_to_dates(date_range)

    campaigns = await api.get_campaigns()
    campaign_ids = [c.get("id") for c in campaigns if c.get("id")]

    report = []
    if campaign_ids:
        report = await api.get_performance_report(
            campaign_ids=campaign_ids,
            start_date=start_date,
            end_date=end_date,
            time_increment="TOTAL",
        )

    totals = {
        "impressions": 0,
        "clicks": 0,
        "spend": 0,
        "conversions": 0,
        "revenue": 0,
    }
    for r in report:
        totals["impressions"] += int(r.get("impressions", 0))
        totals["clicks"] += int(r.get("clicks", 0))
        totals["spend"] += float(r.get("spend", 0))
        totals["conversions"] += int(r.get("conversions", 0))
        totals["revenue"] += float(r.get("revenue", 0))

    imp = totals["impressions"]
    clk = totals["clicks"]
    spend = totals["spend"]
    rev = totals["revenue"]

    totals["ctr"] = (clk / imp * 100) if imp > 0 else 0
    totals["cpc"] = (spend / clk) if clk > 0 else 0
    totals["roas"] = (rev / spend * 100) if spend > 0 else 0

    return {
        "platform": "NAVER_GFA",
        "date_range": date_range,
        "start_date": start_date,
        "end_date": end_date,
        "total_campaigns": len(campaigns),
        "active_campaigns": len([c for c in campaigns if c.get("status") == "ACTIVE"]),
        "totals": totals,
        "currency": "KRW",
    }


@router.get("/gfa/campaigns")
async def gfa_campaigns(
    date_range: str = Query(default="last_7_days"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """GFA 캠페인 목록 + 성과."""
    api = await _get_naver_gfa_api(current_user, db)
    start_date, end_date = _date_range_to_dates(date_range)

    campaigns = await api.get_campaigns()

    campaign_ids = [c.get("id") for c in campaigns if c.get("id")]
    stats_map = {}
    if campaign_ids:
        report = await api.get_performance_report(
            campaign_ids=campaign_ids,
            start_date=start_date,
            end_date=end_date,
            time_increment="TOTAL",
        )
        for r in report:
            stats_map[r.get("campaignId")] = r

    result = []
    for c in campaigns:
        cid = c.get("id")
        s = stats_map.get(cid, {})
        imp = int(s.get("impressions", 0))
        clk = int(s.get("clicks", 0))
        spend = float(s.get("spend", 0))
        conv = int(s.get("conversions", 0))
        rev = float(s.get("revenue", 0))

        result.append({
            "campaign_id": cid,
            "name": c.get("name"),
            "objective": c.get("objective"),
            "status": c.get("status"),
            "daily_budget": c.get("dailyBudget"),
            "impressions": imp,
            "clicks": clk,
            "spend": spend,
            "conversions": conv,
            "revenue": rev,
            "ctr": (clk / imp * 100) if imp > 0 else 0,
            "cpc": (spend / clk) if clk > 0 else 0,
            "roas": (rev / spend * 100) if spend > 0 else 0,
        })

    return {
        "platform": "NAVER_GFA",
        "date_range": date_range,
        "campaigns": result,
    }


@router.get("/gfa/campaign/{campaign_id}/adgroups")
async def gfa_adgroups(
    campaign_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """GFA 캠페인 내 광고그룹 목록."""
    api = await _get_naver_gfa_api(current_user, db)
    adgroups = await api.get_adgroups(campaign_id=campaign_id)
    return {"campaign_id": campaign_id, "adgroups": adgroups}


@router.get("/gfa/trend")
async def gfa_trend(
    date_range: str = Query(default="last_7_days"),
    campaign_id: Optional[str] = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """GFA 일별 성과 추이."""
    api = await _get_naver_gfa_api(current_user, db)
    start_date, end_date = _date_range_to_dates(date_range)

    campaign_ids = [campaign_id] if campaign_id else None
    if not campaign_ids:
        campaigns = await api.get_campaigns()
        campaign_ids = [c.get("id") for c in campaigns if c.get("id")]

    if not campaign_ids:
        return {"trend": [], "date_range": date_range}

    daily_report = await api.get_performance_report(
        campaign_ids=campaign_ids,
        start_date=start_date,
        end_date=end_date,
        time_increment="DAILY",
    )

    date_map: dict = {}
    for r in daily_report:
        dt = r.get("date", "")
        if dt not in date_map:
            date_map[dt] = {
                "date": dt,
                "impressions": 0,
                "clicks": 0,
                "spend": 0,
                "conversions": 0,
                "revenue": 0,
            }
        date_map[dt]["impressions"] += int(r.get("impressions", 0))
        date_map[dt]["clicks"] += int(r.get("clicks", 0))
        date_map[dt]["spend"] += float(r.get("spend", 0))
        date_map[dt]["conversions"] += int(r.get("conversions", 0))
        date_map[dt]["revenue"] += float(r.get("revenue", 0))

    trend = []
    for dt_data in sorted(date_map.values(), key=lambda x: x["date"]):
        imp = dt_data["impressions"]
        clk = dt_data["clicks"]
        sp = dt_data["spend"]
        rv = dt_data["revenue"]
        dt_data["ctr"] = (clk / imp * 100) if imp > 0 else 0
        dt_data["cpc"] = (sp / clk) if clk > 0 else 0
        dt_data["roas"] = (rv / sp * 100) if sp > 0 else 0
        trend.append(dt_data)

    return {"date_range": date_range, "trend": trend}


@router.post("/gfa/ai-analysis")
async def gfa_ai_analysis(
    request: AIAnalysisRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """GFA AI 분석 (Claude)."""
    from app.services.ai import ClaudeService

    api = await _get_naver_gfa_api(current_user, db)
    start_date, end_date = _date_range_to_dates(request.date_range or "last_7_days")

    campaigns = await api.get_campaigns()
    campaign_ids = [c.get("id") for c in campaigns if c.get("id")]

    report = []
    if campaign_ids:
        report = await api.get_performance_report(
            campaign_ids=campaign_ids,
            start_date=start_date,
            end_date=end_date,
            time_increment="DAILY",
        )

    context = {
        "platform": "Naver GFA (네이버 성과형 디스플레이 광고)",
        "date_range": f"{start_date} ~ {end_date}",
        "total_campaigns": len(campaigns),
        "campaigns": [
            {"name": c.get("name"), "objective": c.get("objective"), "budget": c.get("dailyBudget")}
            for c in campaigns[:20]
        ],
        "daily_stats_sample": report[:30],
    }

    focus_prompt = ""
    if request.focus:
        focus_prompt = f"\n특히 '{request.focus}' 관점에서 분석해주세요."
    if request.custom_prompt:
        focus_prompt += f"\n{request.custom_prompt}"

    prompt = f"""네이버 GFA(성과형 디스플레이 광고) 성과 데이터를 분석해주세요.
{focus_prompt}

데이터:
{json.dumps(context, ensure_ascii=False, default=str)}

다음 형식으로 한국어로 답변해주세요:
1. 핵심 성과 요약 (KPI 수치 포함)
2. 주요 인사이트 (3-5개)
3. 개선 제안 (타겟팅, 소재, 게재위치 등 구체적인 액션 아이템)
4. 주의 필요 사항
"""

    claude = ClaudeService()
    response = claude.client.messages.create(
        model=claude.model,
        max_tokens=3000,
        messages=[{"role": "user", "content": prompt}],
    )
    analysis = response.content[0].text

    return {
        "platform": "NAVER_GFA",
        "date_range": request.date_range,
        "analysis": analysis,
        "data_summary": {
            "total_campaigns": len(campaigns),
            "stats_records": len(report),
        },
    }


# ═══════════════════════════════════════════════════════════════
#  CAMPAIGN MANAGEMENT (검색광고)
# ═══════════════════════════════════════════════════════════════


@router.post("/search-ads/campaign")
async def create_search_campaign(
    request: NaverCampaignCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """검색광고 캠페인 생성."""
    api = await _get_naver_search_api(current_user, db)
    result = await api.create_campaign(
        name=request.name,
        campaign_tp=request.campaign_tp,
        daily_budget=request.daily_budget,
        delivery_method=request.delivery_method,
    )
    return {"success": True, "campaign": result}


@router.put("/search-ads/campaign/{campaign_id}")
async def update_search_campaign(
    campaign_id: str,
    request: NaverCampaignUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """검색광고 캠페인 수정."""
    api = await _get_naver_search_api(current_user, db)
    fields = {k: v for k, v in request.model_dump().items() if v is not None}
    # Convert snake_case to camelCase for API
    field_map = {
        "name": "name",
        "daily_budget": "dailyBudget",
        "user_lock": "userLock",
        "delivery_method": "deliveryMethod",
    }
    api_fields = {}
    for k, v in fields.items():
        api_key = field_map.get(k, k)
        api_fields[api_key] = v

    result = await api.update_campaign(campaign_id, api_fields)
    return {"success": True, "campaign": result}


@router.post("/search-ads/campaign/{campaign_id}/adgroup")
async def create_search_adgroup(
    campaign_id: str,
    request: NaverAdGroupCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """검색광고 광고그룹 생성."""
    api = await _get_naver_search_api(current_user, db)
    result = await api.create_adgroup(
        campaign_id=campaign_id,
        name=request.name,
        bid_amt=request.bid_amt,
        daily_budget=request.daily_budget,
        targets=request.targets,
    )
    return {"success": True, "adgroup": result}


@router.post("/search-ads/keywords")
async def add_search_keywords(
    request: NaverKeywordCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """키워드 추가."""
    api = await _get_naver_search_api(current_user, db)
    result = await api.create_keywords(
        adgroup_id=request.adgroup_id,
        keywords=request.keywords,
    )
    return {"success": True, "keywords": result}


@router.put("/search-ads/keyword/{keyword_id}/bid")
async def update_keyword_bid(
    keyword_id: str,
    request: NaverKeywordBidUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """키워드 입찰가 변경."""
    api = await _get_naver_search_api(current_user, db)
    result = await api.update_keyword_bid(keyword_id, request.bid_amt)
    return {"success": True, "keyword": result}


# ═══════════════════════════════════════════════════════════════
#  GFA CAMPAIGN MANAGEMENT
# ═══════════════════════════════════════════════════════════════


@router.post("/gfa/campaign")
async def create_gfa_campaign(
    request: GFACampaignCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """GFA 캠페인 생성."""
    api = await _get_naver_gfa_api(current_user, db)
    result = await api.create_campaign(
        name=request.name,
        objective=request.objective,
        daily_budget=request.daily_budget,
        start_date=request.start_date,
        end_date=request.end_date,
    )
    return {"success": True, "campaign": result}


@router.put("/gfa/campaign/{campaign_id}")
async def update_gfa_campaign(
    campaign_id: str,
    request: GFACampaignUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """GFA 캠페인 수정."""
    api = await _get_naver_gfa_api(current_user, db)
    fields = {k: v for k, v in request.model_dump().items() if v is not None}
    field_map = {
        "name": "name",
        "daily_budget": "dailyBudget",
        "status": "status",
    }
    api_fields = {}
    for k, v in fields.items():
        api_key = field_map.get(k, k)
        api_fields[api_key] = v

    result = await api.update_campaign(campaign_id, api_fields)
    return {"success": True, "campaign": result}


# ═══════════════════════════════════════════════════════════════
#  REPORTS
# ═══════════════════════════════════════════════════════════════


@router.get("/report/generate")
async def generate_report(
    report_type: str = Query(default="weekly"),
    platforms: str = Query(default="NAVER_SEARCH,NAVER_GFA"),
    date_range: str = Query(default="last_7_days"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """네이버 광고 리포트 생성."""
    start_date, end_date = _date_range_to_dates(date_range)
    platform_list = [p.strip() for p in platforms.split(",")]

    report_data: dict = {
        "report_type": report_type,
        "date_range": date_range,
        "start_date": start_date,
        "end_date": end_date,
        "generated_at": datetime.utcnow().isoformat(),
        "platforms": {},
    }

    if "NAVER_SEARCH" in platform_list:
        try:
            api = await _get_naver_search_api(current_user, db)
            campaigns = await api.get_campaigns()
            cids = [c.get("nccCampaignId") for c in campaigns if c.get("nccCampaignId")]
            stats = []
            if cids:
                stats = await api.get_stat_report(
                    ids=cids,
                    date_preset="custom",
                    start_date=start_date,
                    end_date=end_date,
                    time_increment="1",
                )
            report_data["platforms"]["NAVER_SEARCH"] = {
                "total_campaigns": len(campaigns),
                "daily_stats": stats,
            }
        except HTTPException:
            report_data["platforms"]["NAVER_SEARCH"] = {"error": "계정 미연결"}

    if "NAVER_GFA" in platform_list:
        try:
            api = await _get_naver_gfa_api(current_user, db)
            campaigns = await api.get_campaigns()
            cids = [c.get("id") for c in campaigns if c.get("id")]
            report = []
            if cids:
                report = await api.get_performance_report(
                    campaign_ids=cids,
                    start_date=start_date,
                    end_date=end_date,
                    time_increment="DAILY",
                )
            report_data["platforms"]["NAVER_GFA"] = {
                "total_campaigns": len(campaigns),
                "daily_stats": report,
            }
        except HTTPException:
            report_data["platforms"]["NAVER_GFA"] = {"error": "계정 미연결"}

    return report_data


@router.post("/report/email")
async def email_report(
    request: ReportEmailRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """리포트 이메일 발송."""
    import resend

    # Generate report first
    start_date, end_date = _date_range_to_dates(request.date_range or "last_7_days")

    report_sections = []
    for platform in request.platforms:
        if platform == "NAVER_SEARCH":
            try:
                api = await _get_naver_search_api(current_user, db)
                campaigns = await api.get_campaigns()
                cids = [c.get("nccCampaignId") for c in campaigns if c.get("nccCampaignId")]
                stats = []
                if cids:
                    stats = await api.get_stat_report(
                        ids=cids, date_preset="custom",
                        start_date=start_date, end_date=end_date,
                        time_increment="allDays",
                    )
                total_spend = sum(float(s.get("salesAmt", 0)) for s in stats)
                total_clicks = sum(int(s.get("clkCnt", 0)) for s in stats)
                total_imp = sum(int(s.get("impCnt", 0)) for s in stats)
                report_sections.append(
                    f"<h3>네이버 검색광고</h3>"
                    f"<p>캠페인 수: {len(campaigns)} | "
                    f"노출: {total_imp:,} | "
                    f"클릭: {total_clicks:,} | "
                    f"비용: {total_spend:,.0f}원</p>"
                )
            except Exception:
                report_sections.append("<h3>네이버 검색광고</h3><p>데이터 조회 실패</p>")

        elif platform == "NAVER_GFA":
            try:
                api = await _get_naver_gfa_api(current_user, db)
                campaigns = await api.get_campaigns()
                cids = [c.get("id") for c in campaigns if c.get("id")]
                report = []
                if cids:
                    report = await api.get_performance_report(
                        campaign_ids=cids, start_date=start_date,
                        end_date=end_date, time_increment="TOTAL",
                    )
                total_spend = sum(float(r.get("spend", 0)) for r in report)
                total_clicks = sum(int(r.get("clicks", 0)) for r in report)
                total_imp = sum(int(r.get("impressions", 0)) for r in report)
                report_sections.append(
                    f"<h3>네이버 GFA</h3>"
                    f"<p>캠페인 수: {len(campaigns)} | "
                    f"노출: {total_imp:,} | "
                    f"클릭: {total_clicks:,} | "
                    f"비용: {total_spend:,.0f}원</p>"
                )
            except Exception:
                report_sections.append("<h3>네이버 GFA</h3><p>데이터 조회 실패</p>")

    html_body = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2>네이버 광고 성과 리포트</h2>
        <p>기간: {start_date} ~ {end_date}</p>
        <hr>
        {"".join(report_sections)}
        <hr>
        <p style="color: #999; font-size: 12px;">Meta-Commander에서 자동 발송된 리포트입니다.</p>
    </div>
    """

    try:
        resend.api_key = settings.RESEND_API_KEY
        from_email = settings.RESEND_FROM_EMAIL or "onboarding@resend.dev"
        if "<" not in from_email:
            from_email = f"Meta-Commander <{from_email}>"

        resend.Emails.send({
            "from": from_email,
            "to": [request.recipient_email],
            "subject": f"네이버 광고 {request.report_type} 리포트 ({start_date} ~ {end_date})",
            "html": html_body,
        })
        return {"success": True, "message": f"리포트가 {request.recipient_email}로 발송되었습니다."}
    except Exception as e:
        logger.error("Failed to send report email: %s", e)
        raise HTTPException(status_code=500, detail=f"이메일 발송 실패: {str(e)}")


# ═══════════════════════════════════════════════════════════════
#  AUTO-RULES (자동관리 룰)
# ═══════════════════════════════════════════════════════════════


@router.post("/auto-rules")
async def create_auto_rule(
    request: AutoRuleCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """자동관리 룰 생성."""
    rule = AutoRule(
        id=str(uuid.uuid4()),
        user_id=str(current_user.id),
        name=request.name,
        metric=request.metric,
        operator=request.operator,
        threshold=request.threshold,
        action=request.action,
        action_value=request.action_value,
        target_type=request.target_type,
        target_id=request.target_id,
        target_name=request.target_name,
        duration_type=request.duration_type,
        duration_value=request.duration_value,
        secondary_metric=request.secondary_metric,
        secondary_operator=request.secondary_operator,
        secondary_threshold=request.secondary_threshold,
        enabled=True,
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)

    return {
        "success": True,
        "rule": {
            "id": rule.id,
            "name": rule.name,
            "metric": rule.metric,
            "operator": rule.operator,
            "threshold": rule.threshold,
            "action": rule.action,
            "enabled": rule.enabled,
        },
    }


@router.get("/auto-rules")
async def list_auto_rules(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """자동관리 룰 목록 조회."""
    result = await db.execute(
        select(AutoRule).where(AutoRule.user_id == str(current_user.id))
    )
    rules = result.scalars().all()
    return {
        "rules": [
            {
                "id": r.id,
                "name": r.name,
                "metric": r.metric,
                "operator": r.operator,
                "threshold": r.threshold,
                "action": r.action,
                "action_value": r.action_value,
                "target_type": r.target_type,
                "target_id": r.target_id,
                "target_name": r.target_name,
                "enabled": r.enabled,
                "times_triggered": r.times_triggered,
                "last_checked_at": r.last_checked_at.isoformat() if r.last_checked_at else None,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rules
        ],
    }


@router.put("/auto-rules/{rule_id}")
async def update_auto_rule(
    rule_id: str,
    request: AutoRuleUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """자동관리 룰 수정."""
    result = await db.execute(
        select(AutoRule).where(
            AutoRule.id == rule_id,
            AutoRule.user_id == str(current_user.id),
        )
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="룰을 찾을 수 없습니다.")

    updates = {k: v for k, v in request.model_dump().items() if v is not None}
    for k, v in updates.items():
        setattr(rule, k, v)

    await db.commit()
    await db.refresh(rule)

    return {"success": True, "rule_id": rule.id}


@router.delete("/auto-rules/{rule_id}")
async def delete_auto_rule(
    rule_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """자동관리 룰 삭제."""
    result = await db.execute(
        select(AutoRule).where(
            AutoRule.id == rule_id,
            AutoRule.user_id == str(current_user.id),
        )
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="룰을 찾을 수 없습니다.")

    await db.delete(rule)
    await db.commit()

    return {"success": True, "message": "룰이 삭제되었습니다."}


@router.post("/auto-rules/execute")
async def execute_auto_rules(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """활성화된 자동관리 룰 실행.

    각 룰의 조건을 평가하고, 조건 충족 시 액션을 수행합니다.
    """
    result = await db.execute(
        select(AutoRule).where(
            AutoRule.user_id == str(current_user.id),
            AutoRule.enabled == True,  # noqa: E712
        )
    )
    rules = result.scalars().all()

    if not rules:
        return {"success": True, "message": "활성화된 룰이 없습니다.", "executed": 0, "triggered": 0}

    # Attempt to get Search Ads API (may fail if not connected)
    search_api = None
    try:
        search_api = await _get_naver_search_api(current_user, db)
    except HTTPException:
        pass

    executed = 0
    triggered = 0
    logs = []

    for rule in rules:
        executed += 1
        rule.last_checked_at = datetime.utcnow()

        if not search_api:
            continue

        try:
            # Get campaign stats for evaluation
            campaign_ids = await search_api.get_campaign_ids()
            if not campaign_ids:
                continue

            today = date.today()
            start = (today - timedelta(days=7)).isoformat()
            end = today.isoformat()

            stats = await search_api.get_stat_report(
                ids=campaign_ids,
                date_preset="custom",
                start_date=start,
                end_date=end,
                time_increment="allDays",
            )

            for s in stats:
                metric_value = _extract_naver_metric(s, rule.metric)
                if metric_value is None:
                    continue

                if _compare(metric_value, rule.operator, rule.threshold):
                    # Check secondary condition if present
                    if rule.secondary_metric:
                        sec_val = _extract_naver_metric(s, rule.secondary_metric)
                        if sec_val is None or not _compare(
                            sec_val, rule.secondary_operator or "gt", rule.secondary_threshold or 0
                        ):
                            continue

                    triggered += 1
                    rule.times_triggered = (rule.times_triggered or 0) + 1

                    target_id = rule.target_id or s.get("id", "")
                    action_log = {
                        "rule_id": rule.id,
                        "rule_name": rule.name,
                        "target_id": target_id,
                        "metric": rule.metric,
                        "metric_value": metric_value,
                        "threshold": rule.threshold,
                        "action": rule.action,
                    }

                    # Execute action
                    try:
                        if rule.action == "pause" and target_id:
                            await search_api.pause_campaign(target_id)
                            action_log["result"] = "캠페인 중지됨"
                        elif rule.action == "increase_budget" and target_id and rule.action_value:
                            campaign = await search_api.get_campaign(target_id)
                            current_budget = campaign.get("dailyBudget", 0)
                            new_budget = int(current_budget * (1 + rule.action_value / 100))
                            await search_api.update_campaign(target_id, {"dailyBudget": new_budget})
                            action_log["result"] = f"예산 {current_budget} -> {new_budget}"
                        elif rule.action == "decrease_budget" and target_id and rule.action_value:
                            campaign = await search_api.get_campaign(target_id)
                            current_budget = campaign.get("dailyBudget", 0)
                            new_budget = max(1000, int(current_budget * (1 - rule.action_value / 100)))
                            await search_api.update_campaign(target_id, {"dailyBudget": new_budget})
                            action_log["result"] = f"예산 {current_budget} -> {new_budget}"
                    except Exception as e:
                        action_log["error"] = str(e)

                    logs.append(action_log)

                    # Save log to DB
                    log_entry = AutoRuleLog(
                        id=str(uuid.uuid4()),
                        rule_id=rule.id,
                        user_id=str(current_user.id),
                        action_taken=rule.action,
                        target_type=rule.target_type,
                        target_id=target_id,
                        target_name=rule.target_name or "",
                        metric_name=rule.metric,
                        metric_value=metric_value,
                        threshold_value=rule.threshold,
                        details=action_log,
                    )
                    db.add(log_entry)
                    break  # One trigger per rule per execution

        except Exception as e:
            logger.error("Error evaluating rule %s: %s", rule.id, e)

    await db.commit()

    return {
        "success": True,
        "executed": executed,
        "triggered": triggered,
        "logs": logs,
    }


# ─── Helper functions for rule engine ────────────────────────


def _extract_naver_metric(stat: dict, metric: str):
    """Extract a metric value from a Naver stat record."""
    mapping = {
        "impressions": "impCnt",
        "clicks": "clkCnt",
        "spend": "salesAmt",
        "ctr": "ctr",
        "cpc": "cpc",
        "conversions": "ccnt",
        "revenue": "convAmt",
    }
    key = mapping.get(metric, metric)
    val = stat.get(key)
    if val is not None:
        try:
            return float(val)
        except (ValueError, TypeError):
            return None

    # Compute derived metrics
    imp = float(stat.get("impCnt", 0) or 0)
    clk = float(stat.get("clkCnt", 0) or 0)
    spend = float(stat.get("salesAmt", 0) or 0)
    rev = float(stat.get("convAmt", 0) or 0)
    conv = float(stat.get("ccnt", 0) or 0)

    if metric == "roas":
        return (rev / spend * 100) if spend > 0 else None
    if metric == "cvr":
        return (conv / clk * 100) if clk > 0 else None
    if metric == "cpm":
        return (spend / imp * 1000) if imp > 0 else None
    return None


def _compare(value: float, operator: str, threshold: float) -> bool:
    """Compare a value against a threshold with the given operator."""
    ops = {
        "gt": value > threshold,
        "lt": value < threshold,
        "gte": value >= threshold,
        "lte": value <= threshold,
    }
    return ops.get(operator, False)


# ─── Keyword Research / Shopping Ranking ─────────────────────


class ShoppingItem(BaseModel):
    title: str
    link: str
    image: str
    lprice: str
    hprice: str
    mall_name: str
    product_id: str
    brand: str
    maker: str
    category1: str
    category2: str
    category3: str
    category4: str


class ShoppingSearchResponse(BaseModel):
    keyword: str
    total: int
    items: List[ShoppingItem]


class TrendPoint(BaseModel):
    period: str
    ratio: float


class KeywordTrendResponse(BaseModel):
    keyword: str
    time_unit: str
    data: List[TrendPoint]


class KeywordAnalysisResponse(BaseModel):
    keyword: str
    shopping: ShoppingSearchResponse
    trend: KeywordTrendResponse


class ShoppingRankingItem(BaseModel):
    rank: int
    title: str
    price: Optional[int] = None
    mallName: Optional[str] = None


class RankingAIAnalysisRequest(BaseModel):
    keyword: str
    brand: str = "널담"
    shopping_results: List[ShoppingRankingItem]


def _calc_start_date(period: str) -> str:
    """Return ISO start date string from period shorthand (6m/1y/3y)."""
    today = date.today()
    if period == "6m":
        start = today - timedelta(days=183)
    elif period == "3y":
        start = today - timedelta(days=1095)
    else:  # default 1y
        start = today - timedelta(days=365)
    return start.strftime("%Y-%m-%d")


def _naver_openapi_headers() -> Dict[str, str]:
    return {
        "X-Naver-Client-Id": settings.NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": settings.NAVER_CLIENT_SECRET,
    }


async def _fetch_shopping(keyword: str, display: int) -> ShoppingSearchResponse:
    url = "https://openapi.naver.com/v1/search/shop.json"
    params = {"query": keyword, "display": min(display, 100)}
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(url, headers=_naver_openapi_headers(), params=params)
    if resp.status_code != 200:
        raise HTTPException(
            status_code=resp.status_code,
            detail=f"Naver Shopping API error: {resp.text}",
        )
    body = resp.json()
    items: List[ShoppingItem] = []
    for raw in body.get("items", []):
        items.append(
            ShoppingItem(
                title=raw.get("title", "").replace("<b>", "").replace("</b>", ""),
                link=raw.get("link", ""),
                image=raw.get("image", ""),
                lprice=raw.get("lprice", ""),
                hprice=raw.get("hprice", ""),
                mall_name=raw.get("mallName", ""),
                product_id=raw.get("productId", ""),
                brand=raw.get("brand", ""),
                maker=raw.get("maker", ""),
                category1=raw.get("category1", ""),
                category2=raw.get("category2", ""),
                category3=raw.get("category3", ""),
                category4=raw.get("category4", ""),
            )
        )
    return ShoppingSearchResponse(
        keyword=keyword,
        total=body.get("total", 0),
        items=items,
    )


async def _fetch_trend(keyword: str, time_unit: str, period: str) -> KeywordTrendResponse:
    url = "https://openapi.naver.com/v1/datalab/search"
    start_date = _calc_start_date(period)
    end_date = date.today().strftime("%Y-%m-%d")
    payload = {
        "startDate": start_date,
        "endDate": end_date,
        "timeUnit": time_unit,
        "keywordGroups": [
            {"groupName": keyword, "keywords": [keyword]}
        ],
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            url,
            headers={**_naver_openapi_headers(), "Content-Type": "application/json"},
            json=payload,
        )
    if resp.status_code != 200:
        raise HTTPException(
            status_code=resp.status_code,
            detail=f"Naver DataLab API error: {resp.text}",
        )
    body = resp.json()
    data: List[TrendPoint] = []
    results = body.get("results", [])
    if results:
        for point in results[0].get("data", []):
            data.append(TrendPoint(period=point.get("period", ""), ratio=float(point.get("ratio", 0))))
    return KeywordTrendResponse(keyword=keyword, time_unit=time_unit, data=data)


@router.get("/keyword-research/shopping", response_model=ShoppingSearchResponse)
async def keyword_research_shopping(
    keyword: str = Query(..., description="검색할 키워드"),
    display: int = Query(40, ge=1, le=100, description="반환할 상품 수 (최대 100)"),
    current_user: User = Depends(get_current_user),
):
    """Naver 쇼핑 검색 API를 사용해 키워드에 대한 쇼핑 랭킹 데이터를 반환합니다."""
    try:
        return await _fetch_shopping(keyword, display)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("keyword_research_shopping error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/keyword-research/trend", response_model=KeywordTrendResponse)
async def keyword_research_trend(
    keyword: str = Query(..., description="검색할 키워드"),
    time_unit: str = Query("month", description="시간 단위: date / week / month"),
    period: str = Query("1y", description="조회 기간: 6m / 1y / 3y"),
    current_user: User = Depends(get_current_user),
):
    """Naver DataLab 검색어 트렌드 API를 사용해 키워드 검색량 추이를 반환합니다."""
    if time_unit not in ("date", "week", "month"):
        raise HTTPException(status_code=422, detail="time_unit must be one of: date, week, month")
    if period not in ("6m", "1y", "3y"):
        raise HTTPException(status_code=422, detail="period must be one of: 6m, 1y, 3y")
    try:
        return await _fetch_trend(keyword, time_unit, period)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("keyword_research_trend error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/keyword-research/analysis", response_model=KeywordAnalysisResponse)
async def keyword_research_analysis(
    keyword: str = Query(..., description="분석할 키워드"),
    current_user: User = Depends(get_current_user),
):
    """쇼핑 검색 결과와 검색 트렌드를 동시에 조회해 종합 키워드 분석 데이터를 반환합니다."""
    try:
        shopping, trend = await asyncio.gather(
            _fetch_shopping(keyword, display=40),
            _fetch_trend(keyword, time_unit="month", period="1y"),
        )
        return KeywordAnalysisResponse(keyword=keyword, shopping=shopping, trend=trend)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("keyword_research_analysis error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/keyword-research/ai-analysis")
async def keyword_research_ai_analysis(
    request: RankingAIAnalysisRequest,
    current_user: User = Depends(get_current_user),
):
    """브랜드 쇼핑 랭킹 AI 분석 (Claude). 상위 10개 상품을 분석해 브랜드 순위 개선 전략을 제안합니다."""
    from app.services.ai import ClaudeService

    ranking_text = "\n".join(
        f"{item.rank}위: {item.title} | 판매처: {item.mallName or '알 수 없음'} | 가격: {f'₩{item.price:,}' if item.price else '가격 미정'}"
        for item in request.shopping_results
    )

    brand_found = any(request.brand in (item.title + (item.mallName or "")) for item in request.shopping_results)
    brand_status = "랭킹에 등장함" if brand_found else "랭킹 상위 10위 내에 미등장"

    prompt = f"""당신은 네이버 쇼핑 랭킹 전문 마케팅 컨설턴트입니다.

키워드: "{request.keyword}"
분석 브랜드: "{request.brand}"
브랜드 현황: {brand_status}

현재 네이버 쇼핑 상위 랭킹 (상위 {len(request.shopping_results)}개):
{ranking_text}

위 데이터를 바탕으로 "{request.brand}" 브랜드에 대해 다음을 한국어로 분석해주세요:

1. **현재 랭킹 위치 분석**: 브랜드가 랭킹에 있는지, 있다면 몇 위인지, 없다면 왜 상위에 없는지
2. **경쟁 구도 파악**: 상위 랭킹 상품들의 가격대, 판매처 특징, 제품명 패턴 분석
3. **랭킹 상승/유지 전략**:
   - 가격 전략 (경쟁사 대비 적정 가격대)
   - 상품명 최적화 (검색 노출을 위한 키워드 포함 방법)
   - 리뷰 관리 전략 (리뷰 수/평점 개선)
   - 광고 전략 (네이버 쇼핑 광고 활용법)
4. **즉시 실행 가능한 액션 아이템** (우선순위 순으로 3~5개)

실용적이고 구체적인 조언을 제공해주세요."""

    claude = ClaudeService()
    response = claude.client.messages.create(
        model=claude.model,
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}],
    )
    analysis = response.content[0].text

    return {"analysis": analysis}
