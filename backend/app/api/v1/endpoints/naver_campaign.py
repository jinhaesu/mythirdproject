"""Naver campaign management endpoints.

Wizards for creating complete campaign structures:
  - Search Ads: campaign -> adgroup -> keywords -> ad
  - GFA: campaign -> adgroup -> creative
  - Keyword bid optimization
  - Ad preview
"""
import json
import logging
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_user
from app.api.v1.endpoints.naver_analytics import _get_naver_search_api, _get_naver_gfa_api
from app.core.config import get_settings
from app.db.database import get_db
from app.models.user import User
from app.services.naver import NaverSearchAdsAPI, NaverGFAAPI

logger = logging.getLogger(__name__)
router = APIRouter()
settings = get_settings()


# ─── Request Models ──────────────────────────────────────────


class SearchAdWizardRequest(BaseModel):
    """검색광고 캠페인 위자드: 한번에 캠페인+광고그룹+키워드+소재 생성."""

    # Campaign
    campaign_name: str
    campaign_tp: str = "WEB_SITE"
    daily_budget: int = 10000
    delivery_method: str = "STANDARD"

    # AdGroup
    adgroup_name: str
    bid_amt: int = 70
    adgroup_daily_budget: Optional[int] = None
    targets: Optional[Dict[str, Any]] = None

    # Keywords
    keywords: List[Dict[str, Any]]  # [{"keyword": "검색어", "bidAmt": 100}, ...]

    # Ad (optional)
    ad: Optional[Dict[str, Any]] = None
    # ad = {
    #   "type": "TEXT_45",
    #   "pc": {"subject": "제목", "description": "설명"},
    #   "mobile": {"subject": "모바일제목", "description": "모바일설명"},
    # }


class GFAWizardRequest(BaseModel):
    """GFA 캠페인 위자드: 한번에 캠페인+광고그룹+소재 생성."""

    # Campaign
    campaign_name: str
    objective: str = "TRAFFIC"
    daily_budget: int = 10000
    start_date: Optional[str] = None
    end_date: Optional[str] = None

    # AdGroup
    adgroup_name: str
    bid_strategy: str = "MANUAL_CPC"
    bid_amount: Optional[int] = None
    adgroup_daily_budget: Optional[int] = None
    targeting: Optional[Dict[str, Any]] = None
    placements: Optional[List[str]] = None

    # Creative (optional)
    creative: Optional[Dict[str, Any]] = None
    # creative = {
    #   "creative_type": "IMAGE",
    #   "title": "소재 제목",
    #   "description": "소재 설명",
    #   "image_url": "https://...",
    #   "landing_url": "https://...",
    #   "call_to_action": "LEARN_MORE",
    # }


class KeywordBidOptimizeRequest(BaseModel):
    """키워드 입찰가 최적화 요청."""
    adgroup_id: str
    strategy: str = "target_position"  # target_position | maximize_clicks | target_roas
    target_position: Optional[int] = None  # 1-5 (1=최상위)
    max_bid: Optional[int] = None  # 최대 입찰가 (KRW)
    target_roas: Optional[float] = None  # 목표 ROAS (%)


class AdPreviewRequest(BaseModel):
    """광고 미리보기 요청."""
    ad_type: str = "TEXT_45"
    pc_subject: str
    pc_description: str
    mobile_subject: Optional[str] = None
    mobile_description: Optional[str] = None
    display_url: Optional[str] = None
    landing_url: Optional[str] = None


# ═══════════════════════════════════════════════════════════════
#  SEARCH ADS WIZARD
# ═══════════════════════════════════════════════════════════════


@router.post("/search-ads/wizard")
async def search_ads_wizard(
    request: SearchAdWizardRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """검색광고 캠페인 위자드 - 한 번에 전체 구조 생성.

    1. 캠페인 생성
    2. 광고그룹 생성
    3. 키워드 등록
    4. 소재 등록 (선택)
    """
    api = await _get_naver_search_api(current_user, db)
    created = {"campaign": None, "adgroup": None, "keywords": None, "ad": None}

    # Step 1: Create campaign
    try:
        campaign = await api.create_campaign(
            name=request.campaign_name,
            campaign_tp=request.campaign_tp,
            daily_budget=request.daily_budget,
            delivery_method=request.delivery_method,
        )
        created["campaign"] = campaign
        campaign_id = campaign.get("nccCampaignId")
        if not campaign_id:
            raise HTTPException(status_code=500, detail="캠페인 생성 실패: ID를 받지 못했습니다.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"캠페인 생성 실패: {str(e)}")

    # Step 2: Create adgroup
    try:
        adgroup = await api.create_adgroup(
            campaign_id=campaign_id,
            name=request.adgroup_name,
            bid_amt=request.bid_amt,
            daily_budget=request.adgroup_daily_budget,
            targets=request.targets,
        )
        created["adgroup"] = adgroup
        adgroup_id = adgroup.get("nccAdgroupId")
        if not adgroup_id:
            raise HTTPException(status_code=500, detail="광고그룹 생성 실패: ID를 받지 못했습니다.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"광고그룹 생성 실패: {str(e)}. 캠페인은 생성됨 (ID: {campaign_id})",
        )

    # Step 3: Create keywords
    try:
        keywords = await api.create_keywords(
            adgroup_id=adgroup_id,
            keywords=request.keywords,
        )
        created["keywords"] = keywords
    except Exception as e:
        logger.error("Keyword creation failed: %s", e)
        created["keywords_error"] = str(e)

    # Step 4: Create ad (optional)
    if request.ad:
        try:
            ad = await api.create_ad(
                adgroup_id=adgroup_id,
                ad_data=request.ad,
            )
            created["ad"] = ad
        except Exception as e:
            logger.error("Ad creation failed: %s", e)
            created["ad_error"] = str(e)

    return {
        "success": True,
        "message": "검색광고 캠페인 구조가 생성되었습니다.",
        "created": created,
    }


# ═══════════════════════════════════════════════════════════════
#  GFA WIZARD
# ═══════════════════════════════════════════════════════════════


@router.post("/gfa/wizard")
async def gfa_wizard(
    request: GFAWizardRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """GFA 캠페인 위자드 - 한 번에 전체 구조 생성.

    1. 캠페인 생성
    2. 광고그룹 생성 (타겟팅 포함)
    3. 소재 등록 (선택)
    """
    api = await _get_naver_gfa_api(current_user, db)
    created = {"campaign": None, "adgroup": None, "creative": None}

    # Step 1: Create campaign
    try:
        campaign = await api.create_campaign(
            name=request.campaign_name,
            objective=request.objective,
            daily_budget=request.daily_budget,
            start_date=request.start_date,
            end_date=request.end_date,
        )
        created["campaign"] = campaign
        campaign_id = campaign.get("id")
        if not campaign_id:
            raise HTTPException(status_code=500, detail="GFA 캠페인 생성 실패: ID를 받지 못했습니다.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"GFA 캠페인 생성 실패: {str(e)}")

    # Step 2: Create adgroup with targeting
    try:
        adgroup = await api.create_adgroup(
            campaign_id=campaign_id,
            name=request.adgroup_name,
            bid_strategy=request.bid_strategy,
            bid_amount=request.bid_amount,
            daily_budget=request.adgroup_daily_budget,
            targeting=request.targeting,
            placements=request.placements,
        )
        created["adgroup"] = adgroup
        adgroup_id = adgroup.get("id")
        if not adgroup_id:
            raise HTTPException(status_code=500, detail="GFA 광고그룹 생성 실패: ID를 받지 못했습니다.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"GFA 광고그룹 생성 실패: {str(e)}. 캠페인은 생성됨 (ID: {campaign_id})",
        )

    # Step 3: Create creative (optional)
    if request.creative:
        try:
            cr = request.creative
            creative = await api.create_creative(
                adgroup_id=adgroup_id,
                creative_type=cr.get("creative_type", "IMAGE"),
                title=cr.get("title", ""),
                description=cr.get("description"),
                image_url=cr.get("image_url"),
                video_url=cr.get("video_url"),
                landing_url=cr.get("landing_url"),
                call_to_action=cr.get("call_to_action", "LEARN_MORE"),
            )
            created["creative"] = creative
        except Exception as e:
            logger.error("GFA creative creation failed: %s", e)
            created["creative_error"] = str(e)

    return {
        "success": True,
        "message": "GFA 캠페인 구조가 생성되었습니다.",
        "created": created,
    }


# ═══════════════════════════════════════════════════════════════
#  KEYWORD BID OPTIMIZATION
# ═══════════════════════════════════════════════════════════════


@router.post("/search-ads/keyword-bid-optimize")
async def keyword_bid_optimize(
    request: KeywordBidOptimizeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """키워드 입찰가 최적화.

    전략에 따라 키워드별 최적 입찰가를 추천하고 선택적으로 적용합니다.
    """
    api = await _get_naver_search_api(current_user, db)

    # Get current keywords
    keywords = await api.get_keywords(request.adgroup_id)
    if not keywords:
        return {"success": False, "message": "해당 광고그룹에 키워드가 없습니다."}

    # Get keyword stats
    keyword_ids = [kw.get("nccKeywordId") for kw in keywords if kw.get("nccKeywordId")]
    today = date.today()
    start = (today - timedelta(days=7)).isoformat()
    end = today.isoformat()

    stats = []
    if keyword_ids:
        stats = await api.get_stat_report(
            ids=keyword_ids,
            date_preset="custom",
            start_date=start,
            end_date=end,
            time_increment="allDays",
        )

    stats_map = {}
    for s in stats:
        stats_map[s.get("id")] = s

    # Get bid estimates
    estimate_input = [
        {"keyword": kw.get("keyword"), "device": "PC"}
        for kw in keywords if kw.get("keyword")
    ]
    estimates = []
    if estimate_input:
        try:
            estimates = await api.get_estimate(estimate_input)
        except Exception as e:
            logger.warning("Bid estimation failed: %s", e)

    estimate_map = {}
    for est in estimates:
        estimate_map[est.get("keyword", "")] = est

    # Calculate recommended bids
    recommendations = []
    for kw in keywords:
        kw_id = kw.get("nccKeywordId")
        kw_text = kw.get("keyword", "")
        current_bid = kw.get("bidAmt", 0)
        stat = stats_map.get(kw_id, {})
        est = estimate_map.get(kw_text, {})

        imp = int(stat.get("impCnt", 0))
        clk = int(stat.get("clkCnt", 0))
        spend = float(stat.get("salesAmt", 0))
        conv = int(stat.get("ccnt", 0))
        rev = float(stat.get("convAmt", 0))
        ctr = (clk / imp * 100) if imp > 0 else 0
        cpc = (spend / clk) if clk > 0 else 0
        roas = (rev / spend * 100) if spend > 0 else 0

        recommended_bid = current_bid
        reason = ""

        if request.strategy == "target_position":
            # Use estimation data for target position bid
            position = request.target_position or 3
            position_key = f"position{position}Bid"
            est_bid = est.get(position_key, est.get("avgBid", current_bid))
            if est_bid:
                recommended_bid = int(est_bid)
                reason = f"목표 순위 {position}위 기준 추정 입찰가"

        elif request.strategy == "maximize_clicks":
            # Increase bid for high CTR keywords, decrease for low
            if ctr > 5:
                recommended_bid = int(current_bid * 1.2)
                reason = "CTR 우수 -> 입찰가 20% 상향"
            elif ctr > 2:
                recommended_bid = current_bid
                reason = "CTR 양호 -> 현 유지"
            elif imp > 100 and ctr < 1:
                recommended_bid = max(70, int(current_bid * 0.8))
                reason = "CTR 저조 -> 입찰가 20% 하향"
            else:
                reason = "데이터 부족 -> 현 유지"

        elif request.strategy == "target_roas":
            target = request.target_roas or 300
            if spend > 0 and rev > 0:
                if roas >= target:
                    recommended_bid = int(current_bid * 1.15)
                    reason = f"ROAS {roas:.0f}% >= 목표 {target}% -> 입찰가 15% 상향"
                elif roas >= target * 0.7:
                    recommended_bid = current_bid
                    reason = f"ROAS {roas:.0f}% 근접 -> 현 유지"
                else:
                    recommended_bid = max(70, int(current_bid * 0.7))
                    reason = f"ROAS {roas:.0f}% 미달 -> 입찰가 30% 하향"
            else:
                reason = "전환 데이터 부족 -> 현 유지"

        # Apply max bid cap
        if request.max_bid and recommended_bid > request.max_bid:
            recommended_bid = request.max_bid
            reason += f" (최대 입찰가 {request.max_bid}원 적용)"

        recommendations.append({
            "keyword_id": kw_id,
            "keyword": kw_text,
            "current_bid": current_bid,
            "recommended_bid": recommended_bid,
            "change": recommended_bid - current_bid,
            "change_pct": ((recommended_bid - current_bid) / current_bid * 100) if current_bid > 0 else 0,
            "reason": reason,
            "stats": {
                "impressions": imp,
                "clicks": clk,
                "ctr": round(ctr, 2),
                "cpc": round(cpc, 0),
                "conversions": conv,
                "roas": round(roas, 0),
            },
            "quality_index": kw.get("qualityIndex"),
        })

    return {
        "success": True,
        "strategy": request.strategy,
        "adgroup_id": request.adgroup_id,
        "total_keywords": len(recommendations),
        "recommendations": recommendations,
    }


@router.post("/search-ads/keyword-bid-apply")
async def apply_keyword_bids(
    bids: List[Dict[str, Any]],
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """키워드 입찰가 일괄 적용.

    bids: [{"keyword_id": "...", "bid_amt": 150}, ...]
    """
    api = await _get_naver_search_api(current_user, db)

    results = []
    for bid_item in bids:
        kid = bid_item.get("keyword_id")
        bid_amt = bid_item.get("bid_amt")
        if not kid or not bid_amt:
            results.append({"keyword_id": kid, "success": False, "error": "keyword_id or bid_amt missing"})
            continue

        try:
            result = await api.update_keyword_bid(kid, int(bid_amt))
            results.append({"keyword_id": kid, "success": True, "new_bid": int(bid_amt)})
        except Exception as e:
            results.append({"keyword_id": kid, "success": False, "error": str(e)})

    success_count = sum(1 for r in results if r.get("success"))
    return {
        "success": True,
        "total": len(bids),
        "applied": success_count,
        "failed": len(bids) - success_count,
        "results": results,
    }


# ═══════════════════════════════════════════════════════════════
#  AD PREVIEW
# ═══════════════════════════════════════════════════════════════


@router.post("/search-ads/ad-preview")
async def ad_preview(
    request: AdPreviewRequest,
    current_user: User = Depends(get_current_user),
):
    """검색광고 소재 미리보기.

    실제 등록 전에 광고가 어떻게 보일지 미리 확인합니다.
    """
    mobile_subject = request.mobile_subject or request.pc_subject
    mobile_description = request.mobile_description or request.pc_description

    pc_preview = {
        "device": "PC",
        "ad_type": request.ad_type,
        "subject": request.pc_subject,
        "description": request.pc_description,
        "display_url": request.display_url or "",
        "landing_url": request.landing_url or "",
        "preview_html": (
            f'<div style="font-family:sans-serif;max-width:600px;padding:16px;border:1px solid #e0e0e0;border-radius:8px;">'
            f'<div style="color:#1a0dab;font-size:18px;font-weight:bold;margin-bottom:4px;">'
            f'{request.pc_subject}'
            f'</div>'
            f'<div style="color:#006621;font-size:13px;margin-bottom:4px;">'
            f'{request.display_url or request.landing_url or "www.example.com"}'
            f'</div>'
            f'<div style="color:#545454;font-size:14px;">'
            f'{request.pc_description}'
            f'</div>'
            f'<div style="color:#999;font-size:11px;margin-top:4px;">광고</div>'
            f'</div>'
        ),
    }

    mobile_preview = {
        "device": "MOBILE",
        "ad_type": request.ad_type,
        "subject": mobile_subject,
        "description": mobile_description,
        "display_url": request.display_url or "",
        "landing_url": request.landing_url or "",
        "preview_html": (
            f'<div style="font-family:sans-serif;max-width:360px;padding:12px;border:1px solid #e0e0e0;border-radius:8px;">'
            f'<div style="color:#1a0dab;font-size:16px;font-weight:bold;margin-bottom:4px;">'
            f'{mobile_subject}'
            f'</div>'
            f'<div style="color:#006621;font-size:12px;margin-bottom:4px;">'
            f'{request.display_url or request.landing_url or "www.example.com"}'
            f'</div>'
            f'<div style="color:#545454;font-size:13px;">'
            f'{mobile_description}'
            f'</div>'
            f'<div style="color:#999;font-size:10px;margin-top:4px;">광고</div>'
            f'</div>'
        ),
    }

    # Validation checks
    warnings = []
    if len(request.pc_subject) > 15:
        warnings.append(f"PC 제목이 15자를 초과합니다 ({len(request.pc_subject)}자)")
    if len(request.pc_description) > 45:
        warnings.append(f"PC 설명이 45자를 초과합니다 ({len(request.pc_description)}자)")
    if mobile_subject and len(mobile_subject) > 15:
        warnings.append(f"모바일 제목이 15자를 초과합니다 ({len(mobile_subject)}자)")
    if mobile_description and len(mobile_description) > 45:
        warnings.append(f"모바일 설명이 45자를 초과합니다 ({len(mobile_description)}자)")

    return {
        "pc": pc_preview,
        "mobile": mobile_preview,
        "warnings": warnings,
        "valid": len(warnings) == 0,
    }


# ═══════════════════════════════════════════════════════════════
#  GFA CREATIVE MANAGEMENT
# ═══════════════════════════════════════════════════════════════


@router.get("/gfa/campaign/{campaign_id}/creatives")
async def gfa_campaign_creatives(
    campaign_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """GFA 캠페인 내 소재 목록 조회."""
    api = await _get_naver_gfa_api(current_user, db)

    # Get adgroups first, then creatives
    adgroups = await api.get_adgroups(campaign_id=campaign_id)
    all_creatives = []
    for ag in adgroups:
        ag_id = ag.get("id")
        if not ag_id:
            continue
        creatives = await api.get_creatives(adgroup_id=ag_id)
        for cr in creatives:
            cr["adgroupName"] = ag.get("name")
            cr["adgroupId"] = ag_id
        all_creatives.extend(creatives)

    return {
        "campaign_id": campaign_id,
        "total_creatives": len(all_creatives),
        "creatives": all_creatives,
    }


@router.get("/gfa/audiences")
async def gfa_audiences(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """GFA 맞춤 타겟 목록 조회."""
    api = await _get_naver_gfa_api(current_user, db)
    audiences = await api.get_audiences()
    return {"audiences": audiences}


@router.get("/gfa/placements")
async def gfa_placements(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """GFA 사용 가능한 게재위치 목록."""
    api = await _get_naver_gfa_api(current_user, db)
    try:
        placements = await api.get_available_placements()
    except Exception:
        # Fallback to static list
        placements = [
            {"id": p, "name": p.replace("NAVER_", "네이버 ").replace("_", " ")}
            for p in NaverGFAAPI.PLACEMENTS
        ]
    return {"placements": placements}
