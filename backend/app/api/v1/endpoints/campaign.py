"""Ads Controller endpoints (TAB 3)."""
from typing import List, Optional
from datetime import datetime, timezone, timedelta
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
    StrategyRecommendation, TargetingConfig, InterestTargeting,
    PublishRequest, PublishResponse
)
from app.api.v1.endpoints.auth import get_current_user, get_shared_meta_credentials
from app.services.meta import MetaMarketingAPI, convert_budget_to_api_units
from app.services.ai import ClaudeService

import logging
logger = logging.getLogger(__name__)

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
    try:
        return await _create_campaign_impl(campaign_data, current_user, db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Campaign creation error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"캠페인 생성 중 오류: {str(e)}")


async def _create_campaign_impl(
    campaign_data: CampaignCreate,
    current_user: User,
    db: AsyncSession
):
    # Validate creatives exist
    creatives = []
    if campaign_data.creative_ids:
        result = await db.execute(
            select(Creative)
            .where(Creative.id.in_(campaign_data.creative_ids), Creative.user_id == current_user.id)
        )
        creatives = list(result.scalars().all())

        if len(creatives) != len(campaign_data.creative_ids):
            raise HTTPException(status_code=400, detail="Some creatives not found")

    # Create campaign
    targeting_json = None
    if campaign_data.targeting:
        targeting_json = campaign_data.targeting.model_dump_json()

    targeting_segments_json = None
    if campaign_data.targeting_segments:
        targeting_segments_json = json.dumps(campaign_data.targeting_segments, ensure_ascii=False)

    campaign = Campaign(
        user_id=current_user.id,
        name=campaign_data.name,
        objective=CampaignObjective(campaign_data.objective.value),
        status=CampaignStatus.DRAFT,
        total_budget=campaign_data.total_budget,
        daily_budget=campaign_data.daily_budget,
        budget_type=campaign_data.budget_type,
        targeting=targeting_json,
        targeting_segments=targeting_segments_json,
        start_date=campaign_data.start_date,
        end_date=campaign_data.end_date,
        advantage_plus=campaign_data.advantage_plus,
        dataset_id=campaign_data.dataset_id,
        pixel_id=campaign_data.pixel_id,
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
            budget_type=campaign.budget_type,
            advantage_plus=campaign.advantage_plus,
            dataset_id=campaign.dataset_id,
            pixel_id=campaign.pixel_id,
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
        budget_type=campaign.budget_type,
        advantage_plus=campaign.advantage_plus,
        dataset_id=campaign.dataset_id,
        pixel_id=campaign.pixel_id,
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

    Features:
    - Duplicate campaign prevention (checks meta_campaign_id and searches by name)
    - Campaign Budget Optimization (CBO): budget at campaign level, not adset
    - Currency-aware budget conversion (KRW sent as-is, USD * 100)
    - Proper promoted_object for conversion/lead campaigns
    - Rollback cleanup on partial failure
    """
    # 공유 Meta 인증 사용
    meta_user = current_user
    logger.info(f"[Publish] user={current_user.id}, has_token={bool(current_user.meta_access_token)}, ad_account={current_user.meta_ad_account_id}")
    if not meta_user.meta_access_token:
        shared = await get_shared_meta_credentials(db)
        if shared:
            meta_user = shared
            logger.info(f"[Publish] Using shared credentials from user={shared.id}, ad_account={shared.meta_ad_account_id}")
        else:
            logger.warning("[Publish] No shared credentials found")

    if not meta_user.meta_access_token or not meta_user.meta_ad_account_id:
        logger.error(f"[Publish] Missing credentials: token={bool(meta_user.meta_access_token)}, ad_account={meta_user.meta_ad_account_id}")
        return PublishResponse(
            success=False,
            meta_campaign_id=None,
            meta_adset_id=None,
            status="FAILED",
            message="Meta 계정이 연동되지 않았습니다. 설정에서 Meta를 연동해주세요."
        )

    # Get campaign
    result = await db.execute(
        select(Campaign)
        .where(Campaign.id == request.campaign_id, Campaign.user_id == current_user.id)
    )
    campaign = result.scalar_one_or_none()

    if not campaign:
        return PublishResponse(
            success=False, meta_campaign_id=None, meta_adset_id=None,
            status="FAILED", message="캠페인을 찾을 수 없습니다."
        )

    if campaign.status not in [CampaignStatus.DRAFT, CampaignStatus.PAUSED]:
        return PublishResponse(
            success=False, meta_campaign_id=None, meta_adset_id=None,
            status="FAILED", message=f"현재 상태({campaign.status.value})에서는 발행할 수 없습니다."
        )

    # Get ads
    ads_result = await db.execute(
        select(Ad).where(Ad.campaign_id == campaign.id)
    )
    ads = ads_result.scalars().all()

    meta_api = MetaMarketingAPI(
        meta_user.meta_access_token,
        meta_user.meta_ad_account_id
    )
    logger.info(f"[Publish] Meta API init: ad_account={meta_api.ad_account_id}, campaign='{campaign.name}', ads={len(ads)}")

    # Determine currency from request (default KRW)
    currency = request.currency or campaign.currency or "KRW"
    use_cbo = request.use_cbo
    budget_type = request.budget_type  # "DAILY" or "LIFETIME"
    advantage_plus = request.advantage_plus or campaign.advantage_plus
    advantage_plus_creative = request.advantage_plus_creative or advantage_plus
    bid_strategy = request.bid_strategy  # None = auto (lowest cost)
    bid_amount = request.bid_amount  # Required for BID_CAP/COST_CAP

    # Track created Meta resources for cleanup on failure
    created_meta_campaign_id = None
    created_adset_ids = []
    created_ad_ids = []

    try:
        # 0. Page ID / Pixel ID 확보
        page_id = meta_user.meta_page_id
        # Pixel: prefer user-specified in request, then campaign-level, then auto-fetch
        pixel_id = request.pixel_id or campaign.pixel_id or meta_user.meta_pixel_id
        dataset_id = request.dataset_id or campaign.dataset_id

        if not page_id:
            pages = await meta_api.get_pages()
            if pages:
                page_id = pages[0].get("id")
                meta_user.meta_page_id = page_id
                logger.info(f"[Publish] Fetched page_id: {page_id}")

        if not pixel_id:
            pixels = await meta_api.get_pixels()
            if pixels:
                pixel_id = pixels[0].get("id")
                meta_user.meta_pixel_id = pixel_id
                logger.info(f"[Publish] Fetched pixel_id: {pixel_id}")

        if not page_id:
            return PublishResponse(
                success=False, meta_campaign_id=None, meta_adset_id=None,
                status="FAILED",
                message="Facebook 페이지가 없습니다. Meta Business Suite에서 페이지를 생성한 후 다시 시도해주세요."
            )

        # Store pixel/dataset on campaign for future reference
        if pixel_id and not campaign.pixel_id:
            campaign.pixel_id = pixel_id
        if dataset_id and not campaign.dataset_id:
            campaign.dataset_id = dataset_id

        await db.commit()  # page_id, pixel_id 저장
        logger.info(f"[Publish] page_id={page_id}, pixel_id={pixel_id}, dataset_id={dataset_id}, currency={currency}, use_cbo={use_cbo}, budget_type={budget_type}")

        # ──────────────────────────────────────────────
        # 1. Duplicate Campaign Prevention
        # ──────────────────────────────────────────────
        meta_campaign_id = None

        if campaign.meta_campaign_id:
            # Already published before -- check if the Meta campaign still exists
            existing = await meta_api.get_campaign_by_id(campaign.meta_campaign_id)
            if existing and existing.get("id"):
                meta_campaign_id = existing["id"]
                logger.info(f"[Publish] Reusing existing Meta campaign: {meta_campaign_id}")
            else:
                # Meta campaign was deleted/archived; clear stale reference
                logger.warning(f"[Publish] Stale meta_campaign_id={campaign.meta_campaign_id}, will create new")
                campaign.meta_campaign_id = None

        if not meta_campaign_id and not request.force_create:
            # Check for duplicate campaigns by name on Meta (last 24 hours)
            duplicates = await meta_api.find_campaigns_by_name(campaign.name)
            if duplicates:
                now = datetime.now(timezone.utc)
                recent_dupes = []
                for dupe in duplicates:
                    # Exact name match only
                    if dupe.get("name") != campaign.name:
                        continue
                    created_time_str = dupe.get("created_time", "")
                    try:
                        created_time = datetime.fromisoformat(created_time_str.replace("+0000", "+00:00"))
                        if (now - created_time) < timedelta(hours=24):
                            recent_dupes.append(dupe)
                    except (ValueError, TypeError):
                        continue

                if recent_dupes:
                    dupe_ids = ", ".join(d["id"] for d in recent_dupes)
                    logger.warning(f"[Publish] Duplicate campaigns found: {dupe_ids}")
                    return PublishResponse(
                        success=False,
                        meta_campaign_id=None,
                        meta_adset_id=None,
                        status="FAILED",
                        message=(
                            f"동일한 이름의 캠페인이 최근 24시간 내에 이미 존재합니다 "
                            f"(Meta ID: {dupe_ids}). "
                            f"강제 생성하려면 force_create=true를 사용하세요."
                        )
                    )

        # ──────────────────────────────────────────────
        # 2. Budget Calculation (currency-aware)
        # ──────────────────────────────────────────────
        # Calculate daily budget from total_budget if not explicitly set.
        # Example: 200,000 KRW for 3 days -> daily_budget = 66,667 KRW
        if campaign.daily_budget:
            raw_daily_budget = campaign.daily_budget
        elif campaign.total_budget and campaign.start_date and campaign.end_date:
            duration_days = max((campaign.end_date - campaign.start_date).days, 1)
            raw_daily_budget = campaign.total_budget / duration_days
        elif campaign.total_budget:
            raw_daily_budget = campaign.total_budget / 7  # default 7 days
        else:
            raw_daily_budget = 10000  # fallback minimum

        # Convert to Meta API units using currency-aware function
        # KRW 66,667 -> 66667 (no cents), USD 50.00 -> 5000 (cents)
        api_daily_budget = convert_budget_to_api_units(raw_daily_budget, currency)
        api_lifetime_budget = convert_budget_to_api_units(campaign.total_budget, currency) if campaign.total_budget else None

        logger.info(
            f"[Publish] Budget: raw_daily={raw_daily_budget}, api_daily={api_daily_budget}, "
            f"total={campaign.total_budget}, api_lifetime={api_lifetime_budget}, currency={currency}"
        )

        meta_objective = meta_api._map_objective(campaign.objective)

        # ──────────────────────────────────────────────
        # 3. Create or Update Campaign on Meta (with CBO support)
        # ──────────────────────────────────────────────
        if not meta_campaign_id:
            logger.info(f"[Publish] Creating new campaign '{campaign.name}' on Meta...")

            # Build campaign creation kwargs
            campaign_kwargs = {
                "name": campaign.name,
                "objective": campaign.objective,
                "status": "PAUSED",
                "use_cbo": use_cbo,
                "special_ad_categories": request.special_ad_categories,
                "start_time": campaign.start_date,
                "end_time": campaign.end_date,
            }

            # CBO: set budget at campaign level
            if use_cbo:
                if budget_type == "LIFETIME" and api_lifetime_budget:
                    campaign_kwargs["lifetime_budget"] = api_lifetime_budget
                else:
                    campaign_kwargs["daily_budget"] = api_daily_budget

            campaign_result = await meta_api.create_campaign(**campaign_kwargs)
            meta_campaign_id = campaign_result.get("id")
            if not meta_campaign_id:
                raise Exception(f"Meta 캠페인 생성 실패: {campaign_result}")
            created_meta_campaign_id = meta_campaign_id
            logger.info(f"[Publish] Meta campaign created: {meta_campaign_id}, objective={meta_objective}, cbo={use_cbo}")
        else:
            logger.info(f"[Publish] Using existing Meta campaign: {meta_campaign_id}")

        campaign.meta_campaign_id = meta_campaign_id

        # ──────────────────────────────────────────────
        # 4. Create AdSets (with CBO-aware budget handling)
        # ──────────────────────────────────────────────
        adset_ids = []
        segments = []
        if campaign.targeting_segments:
            try:
                segments = json.loads(campaign.targeting_segments)
            except Exception:
                pass

        if segments and len(segments) > 0:
            # ── Segment-based ad sets (Broad / Retarget / Interest) ──
            for seg in segments:
                seg_targeting = TargetingConfig()
                if seg.get('age_range'):
                    ages = seg['age_range'].replace('세', '').split('-')
                    if len(ages) == 2:
                        seg_targeting.age_range.min_age = max(int(ages[0].strip()), 13)
                        seg_targeting.age_range.max_age = min(int(ages[1].strip()), 65)
                if seg.get('targeting') and isinstance(seg['targeting'], dict):
                    try:
                        seg_targeting = TargetingConfig.model_validate(seg['targeting'])
                    except Exception:
                        pass
                if seg.get('interests'):
                    seg_targeting.interests = InterestTargeting(
                        interests=seg['interests'] if isinstance(seg['interests'], list) else []
                    )
                if seg.get('custom_audiences'):
                    seg_targeting.custom_audiences = (
                        seg['custom_audiences'] if isinstance(seg['custom_audiences'], list) else []
                    )
                if seg.get('excluded_audiences'):
                    seg_targeting.excluded_audiences = (
                        seg['excluded_audiences'] if isinstance(seg['excluded_audiences'], list) else []
                    )

                # Segment type determines targeting strategy
                seg_type_raw = seg.get('type', seg.get('name', f'세그먼트 {len(adset_ids) + 1}'))
                seg_name = seg.get('name', seg_type_raw)

                # Normalize segment type for targeting differentiation
                seg_type_lower = seg_type_raw.lower()
                if seg_type_lower in ('broad', '브로드'):
                    segment_type = 'broad'
                elif seg_type_lower in ('retarget', '리타겟', '리타겟팅', 'retargeting'):
                    segment_type = 'retarget'
                elif seg_type_lower in ('interest', '관심사'):
                    segment_type = 'interest'
                else:
                    segment_type = seg_type_lower if seg_type_lower else None

                # Build adset kwargs
                adset_kwargs = {
                    "campaign_id": meta_campaign_id,
                    "name": f"{campaign.name} - {seg_name}",
                    "targeting": seg_targeting,
                    "objective": meta_objective,
                    "use_cbo": use_cbo,
                    "page_id": page_id,
                    "pixel_id": pixel_id,
                    "segment_type": segment_type,
                    "custom_audiences": seg_targeting.custom_audiences,
                    "excluded_audiences": seg_targeting.excluded_audiences,
                    "advantage_plus_audience": (
                        advantage_plus or seg_targeting.advantage_plus_audience
                    ),
                    "start_time": campaign.start_date,
                    "end_time": campaign.end_date,
                    "bid_strategy": bid_strategy,
                    "bid_amount": bid_amount,
                }

                # Advantage+ targeting optimization
                if advantage_plus or (segment_type == 'broad'):
                    adset_kwargs["targeting_optimization"] = "EXPANSION_ALL"
                else:
                    adset_kwargs["targeting_optimization"] = "NONE"

                # When NOT using CBO, set budget at adset level
                if not use_cbo:
                    seg_ratio = float(seg.get('ratio', 100 / len(segments))) / 100
                    seg_budget = raw_daily_budget * seg_ratio
                    api_seg_budget = max(convert_budget_to_api_units(seg_budget, currency), 1)
                    if budget_type == "LIFETIME" and api_lifetime_budget:
                        adset_kwargs["lifetime_budget"] = max(
                            convert_budget_to_api_units(campaign.total_budget * seg_ratio, currency), 1
                        )
                    else:
                        adset_kwargs["daily_budget"] = api_seg_budget

                try:
                    adset_result = await meta_api.create_adset(**adset_kwargs)
                    adset_id = adset_result.get("id")
                    if adset_id:
                        adset_ids.append(adset_id)
                        created_adset_ids.append(adset_id)
                        logger.info(f"[Publish] AdSet created: {seg_name} ({adset_id}) segment_type={segment_type}")
                    else:
                        raise Exception(f"AdSet 생성 실패 ({seg_name}): {adset_result}")
                except Exception as adset_err:
                    logger.error(f"[Publish] AdSet creation failed for {seg_name}: {adset_err}")
                    raise Exception(f"광고세트 '{seg_name}' 생성 실패: {adset_err}")
        else:
            # Single adset
            targeting = TargetingConfig()
            if campaign.targeting:
                try:
                    targeting = TargetingConfig.model_validate_json(campaign.targeting)
                except Exception:
                    pass

            adset_kwargs = {
                "campaign_id": meta_campaign_id,
                "name": f"{campaign.name} - AdSet",
                "targeting": targeting,
                "objective": meta_objective,
                "use_cbo": use_cbo,
                "page_id": page_id,
                "pixel_id": pixel_id,
                "advantage_plus_audience": advantage_plus or targeting.advantage_plus_audience,
                "start_time": campaign.start_date,
                "end_time": campaign.end_date,
                "bid_strategy": bid_strategy,
                "bid_amount": bid_amount,
            }

            if advantage_plus:
                adset_kwargs["targeting_optimization"] = "EXPANSION_ALL"

            # When NOT using CBO, set budget at adset level
            if not use_cbo:
                if budget_type == "LIFETIME" and api_lifetime_budget:
                    adset_kwargs["lifetime_budget"] = api_lifetime_budget
                else:
                    adset_kwargs["daily_budget"] = api_daily_budget

            adset_result = await meta_api.create_adset(**adset_kwargs)
            adset_id = adset_result.get("id")
            if not adset_id:
                raise Exception(f"광고세트 생성 실패: {adset_result}")
            adset_ids.append(adset_id)
            created_adset_ids.append(adset_id)

        meta_adset_id = adset_ids[0] if adset_ids else None
        campaign.meta_adset_id = meta_adset_id
        campaign.meta_adset_ids = json.dumps(adset_ids) if len(adset_ids) > 1 else None
        campaign.budget_type = budget_type
        campaign.currency = currency
        logger.info(f"[Publish] Created {len(adset_ids)} ad set(s): {adset_ids}")

        # ──────────────────────────────────────────────
        # 5. Create Ads (per-adset creative assignments or round-robin fallback)
        # ──────────────────────────────────────────────

        # Helper: create a single Meta ad from creative + settings
        async def _create_meta_ad(
            creative: Creative,
            target_adset_id: str,
            ad_name: str,
            primary_text: Optional[str] = None,
            headline: Optional[str] = None,
            description: Optional[str] = None,
            call_to_action: Optional[str] = None,
            link_url: Optional[str] = None,
            display_link: Optional[str] = None,
            url_params: Optional[str] = None,
        ) -> Optional[str]:
            """Create Meta creative + ad, return meta_ad_id or None."""
            degrees_of_freedom_spec = None
            if advantage_plus_creative:
                degrees_of_freedom_spec = {
                    "creative_features_spec": {
                        "standard_enhancements": {
                            "enroll_status": "OPT_IN"
                        }
                    }
                }

            message = primary_text or creative.primary_text or ""
            cta = call_to_action or "LEARN_MORE"
            link = link_url or None

            if creative.creative_type.value == "VIDEO":
                media_result = await meta_api.upload_video(creative.file_url)
                video_id = media_result.get("id")
                if not video_id:
                    raise Exception(f"비디오 업로드 실패: {media_result}")
                cr_result = await meta_api.create_ad_creative(
                    name=ad_name,
                    page_id=page_id,
                    video_id=video_id,
                    message=message,
                    link=link,
                    call_to_action=cta,
                    degrees_of_freedom_spec=degrees_of_freedom_spec,
                    headline=headline,
                    description=description,
                    display_link=display_link,
                    url_params=url_params,
                )
            else:
                cr_result = await meta_api.create_ad_creative(
                    name=ad_name,
                    page_id=page_id,
                    image_url=creative.file_url,
                    message=message,
                    link=link,
                    call_to_action=cta,
                    degrees_of_freedom_spec=degrees_of_freedom_spec,
                    headline=headline,
                    description=description,
                    display_link=display_link,
                    url_params=url_params,
                )

            meta_creative_id = cr_result.get("id")
            if not meta_creative_id:
                raise Exception(f"크리에이티브 생성 실패: {cr_result}")

            ad_result = await meta_api.create_ad(
                name=ad_name,
                adset_id=target_adset_id,
                creative_id=meta_creative_id,
            )
            meta_ad_id = ad_result.get("id")
            if not meta_ad_id:
                raise Exception(f"광고 생성 실패: {ad_result}")

            created_ad_ids.append(meta_ad_id)
            logger.info(f"[Publish] Ad created: {ad_name} ({meta_ad_id}) -> adset {target_adset_id}")
            return meta_ad_id

        # Check if segments have per-adset creative assignments
        has_per_adset_ads = False
        if segments and adset_ids:
            for seg in segments:
                if seg.get("ads") and len(seg["ads"]) > 0:
                    has_per_adset_ads = True
                    break

        if has_per_adset_ads and segments and adset_ids:
            # ── Per-adset creative assignments from segment['ads'] ──
            for seg_idx, seg in enumerate(segments):
                if seg_idx >= len(adset_ids):
                    break
                target_adset_id = adset_ids[seg_idx]
                seg_ads = seg.get("ads", [])
                seg_name = seg.get("name", f"Segment {seg_idx + 1}")

                for ad_setting in seg_ads:
                    creative_id = ad_setting.get("creative_id")
                    if not creative_id:
                        continue

                    creative_result = await db.execute(
                        select(Creative).where(Creative.id == creative_id)
                    )
                    creative = creative_result.scalar_one_or_none()
                    if not creative or not creative.file_url:
                        logger.warning(f"[Publish] Creative {creative_id} not found or no file_url, skipping")
                        continue

                    ad_name = ad_setting.get("ad_name") or f"{seg_name} - {creative.name}"
                    try:
                        await _create_meta_ad(
                            creative=creative,
                            target_adset_id=target_adset_id,
                            ad_name=ad_name,
                            primary_text=ad_setting.get("primary_text"),
                            headline=ad_setting.get("headline"),
                            description=ad_setting.get("description"),
                            call_to_action=ad_setting.get("call_to_action"),
                            link_url=ad_setting.get("link_url"),
                            display_link=ad_setting.get("display_link"),
                            url_params=ad_setting.get("url_params"),
                        )
                    except Exception as ad_err:
                        logger.error(f"[Publish] Ad creation failed for {ad_name}: {ad_err}")

        elif ads and adset_ids:
            # ── Fallback: round-robin distribution of campaign ads ──
            for ad in ads:
                creative_result = await db.execute(
                    select(Creative).where(Creative.id == ad.creative_id)
                )
                creative = creative_result.scalar_one_or_none()

                if creative and creative.file_url:
                    ad_index = list(ads).index(ad) if hasattr(ads, 'index') else 0
                    target_adset_id = adset_ids[ad_index % len(adset_ids)]

                    try:
                        meta_ad_id = await _create_meta_ad(
                            creative=creative,
                            target_adset_id=target_adset_id,
                            ad_name=ad.name,
                        )
                        if meta_ad_id:
                            ad.meta_ad_id = meta_ad_id
                            ad.status = "PENDING_REVIEW"
                    except Exception as ad_err:
                        logger.error(f"[Publish] Ad creation failed for {ad.name}: {ad_err}")
                        ad.status = "FAILED"

        # ──────────────────────────────────────────────
        # 6. Activate if launch_immediately
        # ──────────────────────────────────────────────
        if request.launch_immediately:
            try:
                await meta_api.update_campaign_status(meta_campaign_id, "ACTIVE")
                # Also activate all ad sets
                for asid in adset_ids:
                    try:
                        await meta_api.update_adset_status(asid, "ACTIVE")
                    except Exception as e:
                        logger.warning(f"[Publish] Failed to activate adset {asid}: {e}")
                campaign.status = CampaignStatus.ACTIVE
                logger.info(f"[Publish] Campaign {meta_campaign_id} activated immediately")
            except Exception as e:
                logger.warning(f"[Publish] Failed to activate campaign immediately: {e}")
                campaign.status = CampaignStatus.PENDING_REVIEW
        else:
            campaign.status = CampaignStatus.PENDING_REVIEW

        # Store advantage_plus flag
        if advantage_plus:
            campaign.advantage_plus = True

        await db.commit()

        # Build success message
        adset_msg = f"{len(adset_ids)}개 광고세트" if len(adset_ids) > 1 else "1개 광고세트"
        ad_success_count = len(created_ad_ids)
        budget_msg = (
            f"일일예산: {raw_daily_budget:,.0f}{currency}"
            if budget_type == "DAILY"
            else f"총예산: {campaign.total_budget:,.0f}{currency}"
        )
        cbo_msg = " (CBO 적용)" if use_cbo else ""
        status_msg = "ACTIVE" if (request.launch_immediately and campaign.status == CampaignStatus.ACTIVE) else "PENDING_REVIEW"

        return PublishResponse(
            success=True,
            meta_campaign_id=meta_campaign_id,
            meta_adset_id=meta_adset_id,
            meta_adset_ids=adset_ids if len(adset_ids) > 1 else None,
            status=status_msg,
            message=(
                f"Meta 발행 완료! 캠페인 ID: {meta_campaign_id} "
                f"({adset_msg}, 광고 {ad_success_count}개 생성, {budget_msg}{cbo_msg})"
            )
        )

    except Exception as e:
        logger.error(f"[Publish] Campaign publish failed: {e}", exc_info=True)
        error_msg = str(e)

        # ──────────────────────────────────────────────
        # 6. Cleanup on failure: delete created Meta resources
        # ──────────────────────────────────────────────
        cleanup_errors = []

        # Clean up ads
        for ad_id in created_ad_ids:
            try:
                await meta_api.update_ad_status(ad_id, "DELETED")
                logger.info(f"[Publish] Cleanup: deleted ad {ad_id}")
            except Exception as cleanup_err:
                cleanup_errors.append(f"ad {ad_id}: {cleanup_err}")

        # Clean up adsets
        for adset_id in created_adset_ids:
            try:
                await meta_api.update_adset_status(adset_id, "DELETED")
                logger.info(f"[Publish] Cleanup: deleted adset {adset_id}")
            except Exception as cleanup_err:
                cleanup_errors.append(f"adset {adset_id}: {cleanup_err}")

        # Clean up campaign (only if we created it in this run)
        if created_meta_campaign_id:
            try:
                await meta_api.update_campaign_status(created_meta_campaign_id, "DELETED")
                logger.info(f"[Publish] Cleanup: deleted campaign {created_meta_campaign_id}")
                campaign.meta_campaign_id = None
            except Exception as cleanup_err:
                cleanup_errors.append(f"campaign {created_meta_campaign_id}: {cleanup_err}")

        if cleanup_errors:
            logger.warning(f"[Publish] Cleanup errors: {cleanup_errors}")

        # Reset campaign status to DRAFT so user can retry
        campaign.status = CampaignStatus.DRAFT
        campaign.meta_adset_id = None
        campaign.meta_adset_ids = None
        await db.commit()

        return PublishResponse(
            success=False,
            meta_campaign_id=campaign.meta_campaign_id,
            meta_adset_id=None,
            status="FAILED",
            message=f"발행 실패: {error_msg}"
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
            budget_type=campaign.budget_type,
            currency=campaign.currency,
            targeting=targeting,
            meta_campaign_id=campaign.meta_campaign_id,
            meta_adset_ids=campaign.meta_adset_ids,
            advantage_plus=campaign.advantage_plus,
            dataset_id=campaign.dataset_id,
            pixel_id=campaign.pixel_id,
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


@router.delete("/{campaign_id}")
async def delete_campaign(
    campaign_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """캠페인 삭제 (DRAFT/COMPLETED 상태만 가능)."""
    result = await db.execute(
        select(Campaign)
        .where(Campaign.id == campaign_id, Campaign.user_id == current_user.id)
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="캠페인을 찾을 수 없습니다.")

    if campaign.status not in [CampaignStatus.DRAFT, CampaignStatus.COMPLETED]:
        raise HTTPException(
            status_code=400,
            detail=f"현재 상태({campaign.status.value})에서는 삭제할 수 없습니다. 초안 또는 완료 상태에서만 삭제 가능합니다."
        )

    # Delete associated ads first
    ads_result = await db.execute(
        select(Ad).where(Ad.campaign_id == campaign.id)
    )
    ads = ads_result.scalars().all()
    for ad in ads:
        await db.delete(ad)

    await db.delete(campaign)
    await db.commit()

    return {"success": True, "message": "캠페인이 삭제되었습니다."}


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
        budget_type=campaign.budget_type,
        currency=campaign.currency,
        targeting=targeting,
        meta_campaign_id=campaign.meta_campaign_id,
        meta_adset_ids=campaign.meta_adset_ids,
        advantage_plus=campaign.advantage_plus,
        dataset_id=campaign.dataset_id,
        pixel_id=campaign.pixel_id,
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
            # Also activate all ad sets
            if campaign.meta_adset_ids:
                try:
                    asids = json.loads(campaign.meta_adset_ids)
                    for asid in asids:
                        await meta_api.update_adset_status(asid, "ACTIVE")
                except Exception as e:
                    logger.warning(f"Failed to activate some adsets: {e}")
            elif campaign.meta_adset_id:
                try:
                    await meta_api.update_adset_status(campaign.meta_adset_id, "ACTIVE")
                except Exception as e:
                    logger.warning(f"Failed to activate adset: {e}")
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
            # Also pause all ad sets
            if campaign.meta_adset_ids:
                try:
                    asids = json.loads(campaign.meta_adset_ids)
                    for asid in asids:
                        await meta_api.update_adset_status(asid, "PAUSED")
                except Exception as e:
                    logger.warning(f"Failed to pause some adsets: {e}")
            elif campaign.meta_adset_id:
                try:
                    await meta_api.update_adset_status(campaign.meta_adset_id, "PAUSED")
                except Exception as e:
                    logger.warning(f"Failed to pause adset: {e}")
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
                currency = campaign.currency or "KRW"
                await meta_api.update_adset_budget(
                    campaign.meta_adset_id,
                    daily_budget=convert_budget_to_api_units(daily_budget, currency),
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

    # Update Meta ad status if connected -- use dedicated update_ad_status method
    if ad.meta_ad_id and current_user.meta_access_token:
        meta_api = MetaMarketingAPI(
            current_user.meta_access_token,
            current_user.meta_ad_account_id
        )
        try:
            await meta_api.update_ad_status(ad.meta_ad_id, new_status)
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
