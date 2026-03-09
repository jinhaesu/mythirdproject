"""Meta Marketing API integration for ad management."""
from typing import Optional, List, Dict, Any
from datetime import datetime
import json as json_module
import logging
import httpx

from app.core.config import get_settings
from app.schemas.campaign import TargetingConfig, CampaignObjective

settings = get_settings()
logger = logging.getLogger(__name__)


class MetaMarketingAPI:
    """Client for Meta Marketing API (Ads management)."""

    def __init__(self, access_token: str, ad_account_id: str):
        self.access_token = access_token
        # act_ 접두사 정규화 — 이중 접두사 방지
        raw = ad_account_id or ""
        self.ad_account_id = raw if raw.startswith("act_") else f"act_{raw}"
        self.base_url = f"{settings.META_GRAPH_API_BASE}/{settings.META_API_VERSION}"

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
                    # Meta provides error_user_msg for more detail
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

    def _map_objective(self, objective: CampaignObjective) -> str:
        """Map our objective to Meta's objective."""
        mapping = {
            CampaignObjective.TRAFFIC: "OUTCOME_TRAFFIC",
            CampaignObjective.CONVERSIONS: "OUTCOME_SALES",
            CampaignObjective.LEAD_GENERATION: "OUTCOME_LEADS",
        }
        return mapping.get(objective, "OUTCOME_TRAFFIC")

    def _build_targeting_spec(self, targeting: TargetingConfig) -> Dict[str, Any]:
        """Build Meta targeting specification."""
        spec = {
            "age_min": targeting.age_range.min_age,
            "age_max": targeting.age_range.max_age,
            "geo_locations": {
                "countries": targeting.geo.countries
            }
        }

        if targeting.genders != ["all"]:
            gender_map = {"male": 1, "female": 2}
            spec["genders"] = [gender_map[g] for g in targeting.genders if g in gender_map]

        if targeting.interests.interests:
            spec["flexible_spec"] = [{
                "interests": [{"id": i} for i in targeting.interests.interests]
            }]

        if targeting.geo.cities:
            spec["geo_locations"]["cities"] = [
                {"key": city} for city in targeting.geo.cities
            ]

        return spec

    async def get_ad_account(self) -> Dict[str, Any]:
        """Get ad account information."""
        return await self._request(
            "GET",
            f"{self.ad_account_id}",
            params={"fields": "id,name,currency,timezone_name,amount_spent"}
        )

    async def create_campaign(
        self,
        name: str,
        objective: CampaignObjective,
        status: str = "PAUSED"
    ) -> Dict[str, Any]:
        """
        Create a new ad campaign.

        Returns campaign ID on success.
        """
        return await self._request(
            "POST",
            f"{self.ad_account_id}/campaigns",
            data={
                "name": name,
                "objective": self._map_objective(objective),
                "status": status,
                "special_ad_categories": ["NONE"]
            }
        )

    async def create_adset(
        self,
        campaign_id: str,
        name: str,
        daily_budget: int,  # In cents
        targeting: TargetingConfig,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        optimization_goal: str = "LINK_CLICKS"
    ) -> Dict[str, Any]:
        """
        Create an ad set within a campaign.

        Returns adset ID on success.
        """
        data = {
            "name": name,
            "campaign_id": campaign_id,
            "daily_budget": daily_budget,
            "billing_event": "IMPRESSIONS",
            "optimization_goal": optimization_goal,
            "targeting": self._build_targeting_spec(targeting),
            "status": "PAUSED"
        }

        if start_time:
            data["start_time"] = start_time.isoformat()
        if end_time:
            data["end_time"] = end_time.isoformat()

        return await self._request(
            "POST",
            f"{self.ad_account_id}/adsets",
            data=data
        )

    async def create_ad_creative(
        self,
        name: str,
        page_id: str,
        image_url: Optional[str] = None,
        video_id: Optional[str] = None,
        message: str = "",
        link: Optional[str] = None,
        call_to_action: str = "LEARN_MORE"
    ) -> Dict[str, Any]:
        """
        Create an ad creative.

        Returns creative ID on success.
        """
        object_story_spec = {
            "page_id": page_id,
        }

        if video_id:
            object_story_spec["video_data"] = {
                "video_id": video_id,
                "message": message,
                "call_to_action": {
                    "type": call_to_action,
                    "value": {"link": link} if link else {}
                }
            }
        else:
            object_story_spec["link_data"] = {
                "image_url": image_url,
                "message": message,
                "link": link or "https://example.com",
                "call_to_action": {"type": call_to_action}
            }

        return await self._request(
            "POST",
            f"{self.ad_account_id}/adcreatives",
            data={
                "name": name,
                "object_story_spec": object_story_spec
            }
        )

    async def create_ad(
        self,
        name: str,
        adset_id: str,
        creative_id: str,
        status: str = "PAUSED"
    ) -> Dict[str, Any]:
        """
        Create an ad using existing adset and creative.

        Returns ad ID on success.
        """
        return await self._request(
            "POST",
            f"{self.ad_account_id}/ads",
            data={
                "name": name,
                "adset_id": adset_id,
                "creative": {"creative_id": creative_id},
                "status": status
            }
        )

    async def update_campaign_status(
        self,
        campaign_id: str,
        status: str
    ) -> Dict[str, Any]:
        """Update campaign status (ACTIVE, PAUSED, etc.)."""
        return await self._request(
            "POST",
            campaign_id,
            data={"status": status}
        )

    async def update_adset_budget(
        self,
        adset_id: str,
        daily_budget: int
    ) -> Dict[str, Any]:
        """Update adset daily budget (in cents)."""
        return await self._request(
            "POST",
            adset_id,
            data={"daily_budget": daily_budget}
        )

    async def get_campaign_insights(
        self,
        campaign_id: str,
        date_preset: str = "last_7d",
        fields: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Get campaign performance insights.

        date_preset options: today, yesterday, last_7d, last_30d, etc.
        """
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
        time_increment: int = 1  # Daily breakdown
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

    async def upload_image(
        self,
        image_url: str
    ) -> Dict[str, Any]:
        """Upload image from URL for ad creative."""
        return await self._request(
            "POST",
            f"{self.ad_account_id}/adimages",
            data={"url": image_url}
        )

    async def upload_video(
        self,
        video_url: str,
        title: str = ""
    ) -> Dict[str, Any]:
        """Upload video from URL for ad creative."""
        return await self._request(
            "POST",
            f"{self.ad_account_id}/advideos",
            data={
                "file_url": video_url,
                "title": title
            }
        )
