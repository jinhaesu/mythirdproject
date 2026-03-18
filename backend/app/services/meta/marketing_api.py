"""Meta Marketing API integration for ad management."""
from typing import Optional, List, Dict, Any
from datetime import datetime
import json as json_module
import logging
import httpx

from app.core.config import get_settings
from app.schemas.campaign import CampaignObjective

settings = get_settings()
logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────
# Objective & Optimization Goal Mappings
# ──────────────────────────────────────────────
OBJECTIVE_MAP: Dict[str, str] = {
    "TRAFFIC": "OUTCOME_TRAFFIC",
    "CONVERSIONS": "OUTCOME_SALES",
    "PURCHASE": "OUTCOME_SALES",
    "LEAD_GENERATION": "OUTCOME_LEADS",
    "AWARENESS": "OUTCOME_AWARENESS",
    "ENGAGEMENT": "OUTCOME_ENGAGEMENT",
    "APP_PROMOTION": "OUTCOME_APP_PROMOTION",
}

OPTIMIZATION_GOAL_MAP: Dict[str, str] = {
    "OUTCOME_TRAFFIC": "LINK_CLICKS",
    "OUTCOME_SALES": "OFFSITE_CONVERSIONS",
    "OUTCOME_LEADS": "LEAD_GENERATION",
    "OUTCOME_AWARENESS": "REACH",
    "OUTCOME_ENGAGEMENT": "POST_ENGAGEMENT",
    "OUTCOME_APP_PROMOTION": "APP_INSTALLS",
}

# Currencies that have no sub-unit (1 = 1 smallest unit)
# For these currencies, budget value is sent as-is.
# For others (e.g. USD, EUR), multiply by 100 to convert to cents.
NO_CENTS_CURRENCIES = frozenset({
    "KRW", "JPY", "VND", "CLP", "ISK", "HUF", "TWD", "COP",
    "IDR", "PYG", "UGX", "RWF",
})


def convert_budget_to_api_units(amount: float, currency: str = "KRW") -> int:
    """Convert a human-readable budget amount to Meta API units.

    Meta API expects the smallest currency unit:
    - KRW 200,000 -> 200000  (KRW has no sub-unit)
    - USD 50.00   -> 5000    (50 * 100 cents)
    """
    if currency.upper() in NO_CENTS_CURRENCIES:
        return int(amount)
    return int(amount * 100)


class MetaMarketingAPI:
    """Client for Meta Marketing API (Ads management)."""

    def __init__(self, access_token: str, ad_account_id: str):
        self.access_token = access_token
        # act_ 접두사 정규화 — 이중 접두사 방지
        raw = ad_account_id or ""
        self.ad_account_id = raw if raw.startswith("act_") else f"act_{raw}"
        self.base_url = f"{settings.META_GRAPH_API_BASE}/{settings.META_API_VERSION}"

    # ──────────────────────────────────────────────
    # Internal helpers
    # ──────────────────────────────────────────────

    async def _request(
        self,
        method: str,
        endpoint: str,
        params: Optional[Dict] = None,
        data: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """Make API request to Meta Marketing API."""
        params = params or {}
        params["access_token"] = self.access_token

        async with httpx.AsyncClient(timeout=30.0) as client:
            url = f"{self.base_url}/{endpoint}"
            logger.info(f"Meta API {method} {endpoint} data_keys={list((data or {}).keys())}")
            if method == "GET":
                response = await client.get(url, params=params)
            else:
                # nested dict는 JSON 문자열로 변환해서 form data로 전송
                if data:
                    flat_data = {}
                    for k, v in data.items():
                        if isinstance(v, (dict, list)):
                            flat_data[k] = json_module.dumps(v)
                        else:
                            flat_data[k] = v
                    data = flat_data
                response = await client.request(method, url, params=params, data=data)

            if response.status_code >= 400:
                error_body = response.text
                logger.error(f"Meta API error {response.status_code} [{method} {endpoint}]: {error_body}")
                try:
                    error_json = response.json()
                    error_obj = error_json.get("error", {})
                    error_msg = error_obj.get("error_user_msg") or error_obj.get("message", error_body)
                    error_code = error_obj.get("code", "")
                    error_subcode = error_obj.get("error_subcode", "")
                    detail = f"{error_msg}"
                    if error_subcode:
                        detail += f" (code={error_code}, subcode={error_subcode})"
                except Exception:
                    detail = error_body
                raise Exception(f"Meta API 오류 ({response.status_code}): {detail}")

            return response.json()

    def _map_objective(self, objective) -> str:
        """Map our objective to Meta's objective.

        Accepts CampaignObjective enum or plain string.
        """
        key = objective.value if hasattr(objective, "value") else str(objective)
        return OBJECTIVE_MAP.get(key, "OUTCOME_TRAFFIC")

    def _map_optimization_goal(self, meta_objective: str) -> str:
        """캠페인 목표에 맞는 광고세트 최적화 목표 매핑."""
        return OPTIMIZATION_GOAL_MAP.get(meta_objective, "LINK_CLICKS")

    def _build_targeting_spec(
        self,
        targeting: Any,
        *,
        segment_type: Optional[str] = None,
        custom_audiences: Optional[List[str]] = None,
        excluded_audiences: Optional[List[str]] = None,
        advantage_plus_audience: bool = False,
    ) -> Dict[str, Any]:
        """Build Meta targeting specification.

        segment_type: "broad" | "retarget" | "interest" | None
        custom_audiences: list of custom audience IDs for retargeting
        excluded_audiences: list of audience IDs to exclude (e.g. purchasers)
        advantage_plus_audience: enable Advantage+ audience (targeting_automation)
        """
        spec: Dict[str, Any] = {
            "age_min": targeting.age_range.min_age,
            "age_max": targeting.age_range.max_age,
            "geo_locations": {
                "countries": targeting.geo.countries,
            },
        }

        # Gender filtering
        if targeting.genders != ["all"]:
            gender_map = {"male": 1, "female": 2}
            spec["genders"] = [gender_map[g] for g in targeting.genders if g in gender_map]

        # Geo: cities
        if targeting.geo.cities:
            spec["geo_locations"]["cities"] = [
                {"key": city} for city in targeting.geo.cities
            ]

        # ── Segment-type specific logic ──
        seg = (segment_type or "").lower()

        if seg == "broad":
            # Broad (브로드): No interest targeting, no custom audiences
            # Enable Advantage+ audience for optimal reach
            spec["targeting_automation"] = {"advantage_audience": 1}
            # Meta requires age_max=65 when using Advantage+ audience
            spec["age_max"] = 65

        elif seg == "retarget":
            # Retarget (리타겟): Custom audiences (website visitors etc.)
            spec["targeting_automation"] = {"advantage_audience": 0}
            if custom_audiences:
                spec["custom_audiences"] = [{"id": ca_id} for ca_id in custom_audiences]
            elif targeting.custom_audiences:
                spec["custom_audiences"] = [{"id": ca_id} for ca_id in targeting.custom_audiences]
            # Exclude purchasers
            if excluded_audiences:
                spec["excluded_custom_audiences"] = [{"id": ea_id} for ea_id in excluded_audiences]

        elif seg == "interest":
            # Interest (관심사): Specific interest IDs, detailed targeting
            spec["targeting_automation"] = {"advantage_audience": 0}
            if targeting.interests and targeting.interests.interests:
                valid_interests = [
                    {"id": i} for i in targeting.interests.interests
                    if str(i).isdigit()
                ]
                if valid_interests:
                    spec["flexible_spec"] = [{"interests": valid_interests}]
            if targeting.interests and targeting.interests.behaviors:
                valid_behaviors = [
                    {"id": b} for b in targeting.interests.behaviors
                    if str(b).isdigit()
                ]
                if valid_behaviors:
                    if "flexible_spec" not in spec:
                        spec["flexible_spec"] = [{}]
                    spec["flexible_spec"][0]["behaviors"] = valid_behaviors

        else:
            # Default / unspecified segment
            if advantage_plus_audience:
                spec["targeting_automation"] = {"advantage_audience": 1}
                # Meta requires age_max=65 when using Advantage+ audience
                spec["age_max"] = 65
            else:
                spec["targeting_automation"] = {"advantage_audience": 0}

            # Apply interests if available
            if targeting.interests and targeting.interests.interests:
                valid_interests = [
                    {"id": i} for i in targeting.interests.interests
                    if str(i).isdigit()
                ]
                if valid_interests:
                    spec["flexible_spec"] = [{"interests": valid_interests}]

            # Apply custom audiences if available
            if targeting.custom_audiences:
                spec["custom_audiences"] = [{"id": ca_id} for ca_id in targeting.custom_audiences]

        return spec

    # ──────────────────────────────────────────────
    # Account & Asset helpers
    # ──────────────────────────────────────────────

    async def get_ad_account(self) -> Dict[str, Any]:
        """Get ad account information."""
        return await self._request(
            "GET",
            f"{self.ad_account_id}",
            params={"fields": "id,name,currency,timezone_name,amount_spent"}
        )

    async def get_pages(self) -> List[Dict]:
        """광고 계정에 연결된 Facebook 페이지 조회."""
        try:
            result = await self._request("GET", "me/accounts", params={"fields": "id,name"})
            return result.get("data", [])
        except Exception:
            return []

    async def get_pixels(self) -> List[Dict]:
        """광고 계정의 Pixel 목록 조회."""
        try:
            result = await self._request("GET", f"{self.ad_account_id}/adspixels", params={"fields": "id,name"})
            return result.get("data", [])
        except Exception:
            return []

    # ──────────────────────────────────────────────
    # Campaign CRUD
    # ──────────────────────────────────────────────

    async def create_campaign(
        self,
        name: str,
        objective,
        status: str = "PAUSED",
        *,
        daily_budget: Optional[int] = None,
        lifetime_budget: Optional[int] = None,
        special_ad_categories: Optional[List[str]] = None,
        smart_promotion_type: Optional[str] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        use_cbo: bool = False,
        bid_strategy: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a new ad campaign.

        When use_cbo=True (Campaign Budget Optimization), budget is set at
        campaign level and Meta auto-distributes across ad sets.

        Args:
            daily_budget: Campaign-level daily budget in API units (only with CBO).
            lifetime_budget: Campaign-level lifetime budget in API units (only with CBO).
            special_ad_categories: e.g. ["NONE"], ["HOUSING"], ["EMPLOYMENT"].
            smart_promotion_type: For Advantage+ Shopping campaigns, e.g. "GUIDED_CREATION".
            start_time: Campaign start time (required when using lifetime_budget).
            end_time: Campaign end time (required when using lifetime_budget).
            use_cbo: Enable Campaign Budget Optimization.
            bid_strategy: Bid strategy override at campaign level (overrides account default).
        """
        meta_objective = self._map_objective(objective)

        data: Dict[str, Any] = {
            "name": name,
            "objective": meta_objective,
            "status": status,
            "special_ad_categories": special_ad_categories or ["NONE"],
        }

        # Campaign Budget Optimization
        if use_cbo:
            if lifetime_budget is not None:
                data["lifetime_budget"] = lifetime_budget
            elif daily_budget is not None:
                data["daily_budget"] = daily_budget
        else:
            # No CBO — budget at ad set level, enable budget sharing for optimization
            data["is_adset_budget_sharing_enabled"] = True

        # Bid strategy at campaign level (overrides account default)
        # Always set explicitly to prevent account-level LOWEST_COST_WITH_BID_CAP from propagating
        if bid_strategy and bid_strategy not in ("", "LOWEST_COST_WITHOUT_CAP"):
            data["bid_strategy"] = bid_strategy
        else:
            data["bid_strategy"] = "LOWEST_COST_WITHOUT_CAP"

        # Advantage+ Shopping campaigns
        if smart_promotion_type:
            data["smart_promotion_type"] = smart_promotion_type

        # Schedule (needed for lifetime_budget)
        if start_time:
            data["start_time"] = start_time.isoformat()
        if end_time:
            data["end_time"] = end_time.isoformat()

        return await self._request(
            "POST",
            f"{self.ad_account_id}/campaigns",
            data=data,
        )

    async def update_campaign_status(
        self,
        campaign_id: str,
        status: str
    ) -> Dict[str, Any]:
        """Update campaign status.

        Valid statuses: ACTIVE, PAUSED, DELETED, ARCHIVED.
        """
        if status not in ("ACTIVE", "PAUSED", "DELETED", "ARCHIVED"):
            raise ValueError(f"Invalid campaign status: {status}")
        return await self._request(
            "POST",
            campaign_id,
            data={"status": status}
        )

    # ──────────────────────────────────────────────
    # Ad Set CRUD
    # ──────────────────────────────────────────────

    def _build_promoted_object(
        self,
        objective: str,
        page_id: Optional[str] = None,
        pixel_id: Optional[str] = None,
        custom_event_type: Optional[str] = None,
    ) -> Optional[Dict]:
        """캠페인 목표에 맞는 promoted_object 생성."""
        if objective == "OUTCOME_SALES":
            if pixel_id:
                return {
                    "pixel_id": pixel_id,
                    "custom_event_type": custom_event_type or "PURCHASE",
                }
            elif page_id:
                return {"page_id": page_id}
        elif objective == "OUTCOME_LEADS":
            if pixel_id:
                return {
                    "pixel_id": pixel_id,
                    "custom_event_type": custom_event_type or "LEAD",
                }
            elif page_id:
                return {"page_id": page_id}
        elif objective in ("OUTCOME_TRAFFIC", "OUTCOME_ENGAGEMENT"):
            if page_id:
                return {"page_id": page_id}
        return None

    async def create_adset(
        self,
        campaign_id: str,
        name: str,
        targeting: Any,
        objective: Optional[str] = None,
        *,
        daily_budget: Optional[int] = None,
        lifetime_budget: Optional[int] = None,
        use_cbo: bool = False,
        page_id: Optional[str] = None,
        pixel_id: Optional[str] = None,
        custom_event_type: Optional[str] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        segment_type: Optional[str] = None,
        custom_audiences: Optional[List[str]] = None,
        excluded_audiences: Optional[List[str]] = None,
        advantage_plus_audience: bool = False,
        targeting_optimization: Optional[str] = None,
        bid_strategy: Optional[str] = None,
        bid_amount: Optional[int] = None,
        status: str = "PAUSED",
    ) -> Dict[str, Any]:
        """Create an ad set within a campaign.

        When use_cbo=True, do NOT set budget at ad set level — Meta
        auto-distributes from the campaign-level budget.

        Args:
            daily_budget: Ad-set daily budget in API units (ignored when CBO).
            lifetime_budget: Ad-set lifetime budget in API units (ignored when CBO).
            use_cbo: If True, skip budget at ad-set level.
            segment_type: "broad", "retarget", "interest" for targeting differentiation.
            custom_audiences: Custom audience IDs for retargeting.
            excluded_audiences: Audience IDs to exclude.
            advantage_plus_audience: Enable Advantage+ audience.
            targeting_optimization: "NONE" or "EXPANSION_ALL" for Advantage+ audience.
            status: Initial status for the ad set.
        """
        obj = objective or "OUTCOME_TRAFFIC"
        optimization_goal = self._map_optimization_goal(obj)

        targeting_spec = self._build_targeting_spec(
            targeting,
            segment_type=segment_type,
            custom_audiences=custom_audiences,
            excluded_audiences=excluded_audiences,
            advantage_plus_audience=advantage_plus_audience,
        )

        data: Dict[str, Any] = {
            "name": name,
            "campaign_id": campaign_id,
            "billing_event": "IMPRESSIONS",
            "optimization_goal": optimization_goal,
            "targeting": targeting_spec,
            "status": status,
        }

        # Bid strategy at adset level — only set if user explicitly chose a cap strategy with bid_amount
        # For auto-bid (LOWEST_COST_WITHOUT_CAP), do NOT set at adset level; campaign level handles it
        logger.info(f"[AdSet] bid_strategy={bid_strategy!r}, bid_amount={bid_amount!r}, use_cbo={use_cbo}")
        if bid_strategy and bid_amount and bid_strategy not in ("", "LOWEST_COST_WITHOUT_CAP"):
            data["bid_strategy"] = bid_strategy
            if bid_strategy in ("LOWEST_COST_WITH_BID_CAP", "COST_CAP"):
                data["bid_amount"] = bid_amount
            elif bid_strategy == "MINIMUM_ROAS":
                data["roas_average_floor"] = bid_amount
        # Do NOT set bid_strategy at adset level for auto-bid — campaign level already sets LOWEST_COST_WITHOUT_CAP

        # Budget — skip when CBO is enabled
        if not use_cbo:
            if lifetime_budget is not None:
                data["lifetime_budget"] = lifetime_budget
            elif daily_budget is not None:
                data["daily_budget"] = daily_budget

        # Advantage+ audience targeting optimization
        if targeting_optimization:
            data["targeting_optimization"] = targeting_optimization

        # promoted_object — 목표별 필수
        promoted_object = self._build_promoted_object(
            obj, page_id, pixel_id, custom_event_type
        )
        if promoted_object:
            data["promoted_object"] = promoted_object

        # Schedule
        if start_time:
            data["start_time"] = start_time.isoformat()
        if end_time:
            data["end_time"] = end_time.isoformat()

        logger.info(f"[AdSet] Meta API 요청 data keys: {list(data.keys())}, bid 관련: bid_strategy={'bid_strategy' in data}, bid_amount={'bid_amount' in data}")
        return await self._request(
            "POST",
            f"{self.ad_account_id}/adsets",
            data=data,
        )

    async def update_adset_status(
        self,
        adset_id: str,
        status: str,
    ) -> Dict[str, Any]:
        """Update ad set status (ACTIVE, PAUSED, DELETED, ARCHIVED)."""
        if status not in ("ACTIVE", "PAUSED", "DELETED", "ARCHIVED"):
            raise ValueError(f"Invalid ad set status: {status}")
        return await self._request(
            "POST",
            adset_id,
            data={"status": status},
        )

    async def update_adset_budget(
        self,
        adset_id: str,
        daily_budget: Optional[int] = None,
        lifetime_budget: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Update ad set budget in API units."""
        data: Dict[str, Any] = {}
        if daily_budget is not None:
            data["daily_budget"] = daily_budget
        if lifetime_budget is not None:
            data["lifetime_budget"] = lifetime_budget
        if not data:
            raise ValueError("daily_budget or lifetime_budget must be provided")
        return await self._request("POST", adset_id, data=data)

    # ──────────────────────────────────────────────
    # Ad Creative & Ad CRUD
    # ──────────────────────────────────────────────

    async def create_ad_creative(
        self,
        name: str,
        page_id: str,
        image_url: Optional[str] = None,
        image_hash: Optional[str] = None,
        video_id: Optional[str] = None,
        message: str = "",
        link: Optional[str] = None,
        call_to_action: str = "LEARN_MORE",
        degrees_of_freedom_spec: Optional[Dict] = None,
        headline: Optional[str] = None,
        description: Optional[str] = None,
        display_link: Optional[str] = None,
        url_params: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create an ad creative.

        Args:
            headline: Ad headline (Meta link_data.name / video_data.title).
            description: Ad description (Meta link_data.description).
            display_link: Display URL shown instead of full URL (Meta link_data.caption).
            url_params: URL parameters appended to the link (e.g. UTM tags).
            degrees_of_freedom_spec: For Advantage+ creative, e.g.
                {"creative_features_spec": {"standard_enhancements": {"enroll_status": "OPT_IN"}}}
        """
        # Append url_params to link if provided
        final_link = link
        if final_link and url_params:
            separator = "&" if "?" in final_link else "?"
            final_link = f"{final_link}{separator}{url_params}"

        object_story_spec: Dict[str, Any] = {
            "page_id": page_id,
        }

        if video_id:
            video_data: Dict[str, Any] = {
                "video_id": video_id,
                "message": message,
                "call_to_action": {
                    "type": call_to_action,
                    "value": {"link": final_link} if final_link else {}
                }
            }
            if headline:
                video_data["title"] = headline
            if description:
                video_data["link_description"] = description
            object_story_spec["video_data"] = video_data
        else:
            link_data: Dict[str, Any] = {
                "message": message,
                "link": final_link or "https://example.com",
                "call_to_action": {"type": call_to_action}
            }
            if image_hash:
                link_data["image_hash"] = image_hash
            elif image_url:
                link_data["image_url"] = image_url
            if headline:
                link_data["name"] = headline
            if description:
                link_data["description"] = description
            if display_link:
                link_data["caption"] = display_link
            object_story_spec["link_data"] = link_data

        data: Dict[str, Any] = {
            "name": name,
            "object_story_spec": object_story_spec,
        }

        # Advantage+ creative enhancements
        if degrees_of_freedom_spec:
            data["degrees_of_freedom_spec"] = degrees_of_freedom_spec

        return await self._request(
            "POST",
            f"{self.ad_account_id}/adcreatives",
            data=data,
        )

    async def create_ad(
        self,
        name: str,
        adset_id: str,
        creative_id: str,
        status: str = "PAUSED"
    ) -> Dict[str, Any]:
        """Create an ad using existing adset and creative."""
        return await self._request(
            "POST",
            f"{self.ad_account_id}/ads",
            data={
                "name": name,
                "adset_id": adset_id,
                "creative": {"creative_id": creative_id},
                "status": status,
            }
        )

    async def update_ad_status(
        self,
        ad_id: str,
        status: str,
    ) -> Dict[str, Any]:
        """Update ad status (ACTIVE, PAUSED, DELETED, ARCHIVED)."""
        if status not in ("ACTIVE", "PAUSED", "DELETED", "ARCHIVED"):
            raise ValueError(f"Invalid ad status: {status}")
        return await self._request(
            "POST",
            ad_id,
            data={"status": status},
        )

    # ──────────────────────────────────────────────
    # Insights / Reporting
    # ──────────────────────────────────────────────

    async def get_campaign_insights(
        self,
        campaign_id: str,
        date_preset: str = "last_7d",
        fields: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """Get campaign performance insights."""
        fields = fields or [
            "impressions", "clicks", "spend", "reach",
            "cpc", "cpm", "ctr", "conversions", "cost_per_conversion"
        ]
        return await self._request(
            "GET",
            f"{campaign_id}/insights",
            params={
                "date_preset": date_preset,
                "fields": ",".join(fields)
            }
        )

    async def get_ad_insights(
        self,
        ad_id: str,
        date_preset: str = "last_7d",
        time_increment: int = 1
    ) -> Dict[str, Any]:
        """Get individual ad performance insights with daily breakdown."""
        return await self._request(
            "GET",
            f"{ad_id}/insights",
            params={
                "date_preset": date_preset,
                "time_increment": time_increment,
                "fields": "impressions,clicks,spend,cpc,ctr,conversions,actions"
            }
        )

    # ──────────────────────────────────────────────
    # Custom Audiences
    # ──────────────────────────────────────────────

    async def get_custom_audiences(self, limit: int = 100) -> List[Dict]:
        """광고 계정의 커스텀 오디언스 목록 조회.

        Returns list of custom audiences with id, name, subtype, approximate_count.
        Used for retargeting segment audience selection.
        """
        try:
            result = await self._request(
                "GET",
                f"{self.ad_account_id}/customaudiences",
                params={
                    "fields": "id,name,subtype,approximate_count,delivery_status,operation_status",
                    "limit": limit,
                },
            )
            audiences = result.get("data", [])
            # Filter to usable audiences (exclude deleted/error states)
            return [
                a for a in audiences
                if a.get("operation_status", {}).get("status", 0) != 400  # not error
            ]
        except Exception as e:
            logger.error(f"Failed to fetch custom audiences: {e}")
            return []

    # ──────────────────────────────────────────────
    # Discovery / Suggestions
    # ──────────────────────────────────────────────

    async def get_interest_suggestions(
        self,
        query: str,
        limit: int = 10
    ) -> Dict[str, Any]:
        """Get interest targeting suggestions."""
        return await self._request(
            "GET",
            "search",
            params={
                "type": "adinterest",
                "q": query,
                "limit": limit
            }
        )

    # ──────────────────────────────────────────────
    # Media upload
    # ──────────────────────────────────────────────

    async def upload_image(self, image_url: str) -> Dict[str, Any]:
        """Upload image from URL for ad creative."""
        return await self._request(
            "POST",
            f"{self.ad_account_id}/adimages",
            data={"url": image_url}
        )

    async def upload_video(self, video_url: str, title: str = "") -> Dict[str, Any]:
        """Upload video from URL for ad creative."""
        return await self._request(
            "POST",
            f"{self.ad_account_id}/advideos",
            data={
                "file_url": video_url,
                "title": title
            }
        )

    # ──────────────────────────────────────────────
    # Duplicate check helpers
    # ──────────────────────────────────────────────

    async def find_campaigns_by_name(self, name: str) -> List[Dict]:
        """Search for existing campaigns by name to prevent duplicates."""
        try:
            result = await self._request(
                "GET",
                f"{self.ad_account_id}/campaigns",
                params={
                    "fields": "id,name,status,created_time",
                    "filtering": json_module.dumps([{
                        "field": "name",
                        "operator": "CONTAIN",
                        "value": name,
                    }]),
                    "limit": 25,
                },
            )
            return result.get("data", [])
        except Exception:
            return []

    async def get_campaign_by_id(self, campaign_id: str) -> Optional[Dict]:
        """Fetch a single campaign by its Meta campaign ID."""
        try:
            return await self._request(
                "GET",
                campaign_id,
                params={"fields": "id,name,status,created_time"},
            )
        except Exception:
            return None
