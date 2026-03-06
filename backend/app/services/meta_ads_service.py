"""Comprehensive Meta Ads data fetching and analysis service.

Fetches all campaigns, ad sets, ads with full insights from the user's
connected Meta ad account. Provides deep analysis with actionable recommendations.
"""
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta

import httpx

from app.core.config import get_settings
from app.models.user import User

logger = logging.getLogger(__name__)
settings = get_settings()


class MetaAdsService:
    """Fetch and analyze real Meta ad account data."""

    def __init__(self, user: User):
        self.user = user
        self.access_token = user.meta_access_token
        self.ad_account_id = user.meta_ad_account_id or ""
        if self.ad_account_id and not self.ad_account_id.startswith("act_"):
            self.ad_account_id = f"act_{self.ad_account_id}"
        self.base_url = f"{settings.META_GRAPH_API_BASE}/{settings.META_API_VERSION}"

    @property
    def connected(self) -> bool:
        return bool(self.access_token and self.ad_account_id)

    async def _get(self, endpoint: str, params: Dict[str, Any] = None) -> Dict:
        params = params or {}
        params["access_token"] = self.access_token
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(f"{self.base_url}/{endpoint}", params=params)
            if resp.status_code != 200:
                logger.error(f"Meta API error {resp.status_code}: {resp.text[:500]}")
                return {"data": [], "error": resp.text[:200]}
            return resp.json()

    async def _post(self, endpoint: str, data: Dict[str, Any] = None, params: Dict[str, Any] = None) -> Dict:
        params = params or {}
        params["access_token"] = self.access_token
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(f"{self.base_url}/{endpoint}", params=params, data=data)
            if resp.status_code != 200:
                logger.error(f"Meta API error {resp.status_code}: {resp.text[:500]}")
                return {"error": resp.text[:200]}
            return resp.json()

    # ──────────────────────────────────────────────
    # Full Account Overview
    # ──────────────────────────────────────────────

    async def get_account_overview(self, date_preset: str = "last_30d") -> Dict[str, Any]:
        """Get full account overview with all campaigns, ad sets, ads, and insights."""
        if not self.connected:
            return {"connected": False, "error": "Meta 계정이 연동되지 않았습니다."}

        result = {
            "connected": True,
            "ad_account_id": self.ad_account_id,
            "campaigns": [],
            "account_insights": {},
            "totals": {},
        }

        # 1) Account-level insights
        account_insights = await self._get(
            f"{self.ad_account_id}/insights",
            {
                "fields": "spend,impressions,reach,clicks,ctr,cpc,cpm,actions,cost_per_action_type,conversions,conversion_values,frequency",
                "date_preset": date_preset,
            }
        )
        if account_insights.get("data"):
            result["account_insights"] = account_insights["data"][0]

        # 2) All campaigns with insights
        campaigns_resp = await self._get(
            f"{self.ad_account_id}/campaigns",
            {
                "fields": "id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time,updated_time,effective_status,configured_status",
                "limit": 50,
            }
        )
        campaigns = campaigns_resp.get("data", [])

        for camp in campaigns:
            camp_id = camp["id"]
            camp_data = {**camp, "insights": None, "adsets": []}

            # Campaign-level insights
            if camp.get("effective_status") in ("ACTIVE", "PAUSED", "CAMPAIGN_PAUSED"):
                insights = await self._get(
                    f"{camp_id}/insights",
                    {
                        "fields": "spend,impressions,reach,clicks,ctr,cpc,cpm,actions,cost_per_action_type,conversions,conversion_values,frequency",
                        "date_preset": date_preset,
                    }
                )
                if insights.get("data"):
                    camp_data["insights"] = insights["data"][0]

            # Ad sets under this campaign
            adsets_resp = await self._get(
                f"{camp_id}/adsets",
                {
                    "fields": "id,name,status,effective_status,targeting,daily_budget,lifetime_budget,bid_strategy,optimization_goal,billing_event,start_time,end_time",
                    "limit": 50,
                }
            )
            adsets = adsets_resp.get("data", [])

            for adset in adsets:
                adset_id = adset["id"]
                adset_data = {**adset, "insights": None, "ads": []}

                # AdSet-level insights
                if adset.get("effective_status") in ("ACTIVE", "PAUSED", "CAMPAIGN_PAUSED"):
                    adset_insights = await self._get(
                        f"{adset_id}/insights",
                        {
                            "fields": "spend,impressions,reach,clicks,ctr,cpc,cpm,actions,cost_per_action_type,frequency",
                            "date_preset": date_preset,
                        }
                    )
                    if adset_insights.get("data"):
                        adset_data["insights"] = adset_insights["data"][0]

                # Ads under this ad set
                ads_resp = await self._get(
                    f"{adset_id}/ads",
                    {
                        "fields": "id,name,status,effective_status,creative{id,name,title,body,image_url,thumbnail_url,object_story_spec},created_time",
                        "limit": 50,
                    }
                )
                ads = ads_resp.get("data", [])

                for ad in ads:
                    ad_id = ad["id"]
                    ad_data = {**ad, "insights": None}

                    # Ad-level insights
                    if ad.get("effective_status") in ("ACTIVE", "PAUSED", "CAMPAIGN_PAUSED"):
                        ad_insights = await self._get(
                            f"{ad_id}/insights",
                            {
                                "fields": "spend,impressions,reach,clicks,ctr,cpc,cpm,actions,cost_per_action_type,frequency",
                                "date_preset": date_preset,
                            }
                        )
                        if ad_insights.get("data"):
                            ad_data["insights"] = ad_insights["data"][0]

                    adset_data["ads"].append(ad_data)

                camp_data["adsets"].append(adset_data)

            result["campaigns"].append(camp_data)

        # 3) Calculate totals
        result["totals"] = self._calculate_totals(result["campaigns"])

        return result

    async def get_campaign_deep_insights(
        self, campaign_id: str, date_preset: str = "last_7d"
    ) -> Dict[str, Any]:
        """Get deep insights for a specific campaign with daily breakdown."""
        result = {"campaign_id": campaign_id, "daily_data": [], "adset_breakdown": [], "ad_breakdown": []}

        # Daily trend
        daily = await self._get(
            f"{campaign_id}/insights",
            {
                "fields": "spend,impressions,reach,clicks,ctr,cpc,cpm,actions,cost_per_action_type,frequency",
                "date_preset": date_preset,
                "time_increment": 1,
            }
        )
        result["daily_data"] = daily.get("data", [])

        # Ad set breakdown
        adsets = await self._get(
            f"{campaign_id}/insights",
            {
                "fields": "spend,impressions,clicks,ctr,cpc,actions,cost_per_action_type",
                "date_preset": date_preset,
                "level": "adset",
            }
        )
        result["adset_breakdown"] = adsets.get("data", [])

        # Ad breakdown
        ads = await self._get(
            f"{campaign_id}/insights",
            {
                "fields": "spend,impressions,clicks,ctr,cpc,actions,cost_per_action_type",
                "date_preset": date_preset,
                "level": "ad",
            }
        )
        result["ad_breakdown"] = ads.get("data", [])

        # Age/gender breakdown
        demo = await self._get(
            f"{campaign_id}/insights",
            {
                "fields": "spend,impressions,clicks,ctr,actions",
                "date_preset": date_preset,
                "breakdowns": "age,gender",
            }
        )
        result["demographics"] = demo.get("data", [])

        # Placement breakdown
        placement = await self._get(
            f"{campaign_id}/insights",
            {
                "fields": "spend,impressions,clicks,ctr,actions",
                "date_preset": date_preset,
                "breakdowns": "publisher_platform,platform_position",
            }
        )
        result["placements"] = placement.get("data", [])

        return result

    async def get_account_daily_trend(self, days: int = 30) -> List[Dict]:
        """Get daily account-level insights for trend analysis."""
        if not self.connected:
            return []

        data = await self._get(
            f"{self.ad_account_id}/insights",
            {
                "fields": "spend,impressions,reach,clicks,ctr,cpc,cpm,actions,cost_per_action_type,frequency",
                "date_preset": f"last_{days}d",
                "time_increment": 1,
            }
        )
        return data.get("data", [])

    # ──────────────────────────────────────────────
    # Management Actions
    # ──────────────────────────────────────────────

    async def update_campaign_status(self, campaign_id: str, status: str) -> Dict:
        """Update campaign status (ACTIVE / PAUSED)."""
        return await self._post(campaign_id, data={"status": status})

    async def update_adset_status(self, adset_id: str, status: str) -> Dict:
        """Update ad set status."""
        return await self._post(adset_id, data={"status": status})

    async def update_ad_status(self, ad_id: str, status: str) -> Dict:
        """Update ad status."""
        return await self._post(ad_id, data={"status": status})

    async def update_adset_budget(self, adset_id: str, daily_budget: Optional[int] = None, lifetime_budget: Optional[int] = None) -> Dict:
        """Update ad set budget (in cents)."""
        data = {}
        if daily_budget is not None:
            data["daily_budget"] = daily_budget
        if lifetime_budget is not None:
            data["lifetime_budget"] = lifetime_budget
        return await self._post(adset_id, data=data)

    async def update_campaign_budget(self, campaign_id: str, daily_budget: Optional[int] = None) -> Dict:
        """Update campaign daily budget (in cents)."""
        data = {}
        if daily_budget is not None:
            data["daily_budget"] = daily_budget
        return await self._post(campaign_id, data=data)

    # ──────────────────────────────────────────────
    # Deep Context for AI
    # ──────────────────────────────────────────────

    async def build_full_context_for_ai(self, date_preset: str = "last_7d") -> str:
        """Build comprehensive account summary text for AI system prompts."""
        if not self.connected:
            return "Meta 광고 계정이 연결되지 않았습니다."

        overview = await self.get_account_overview(date_preset)
        if not overview.get("connected"):
            return "Meta 광고 계정 데이터를 가져올 수 없습니다."

        lines = []
        lines.append(f"=== Meta 광고 계정 ({self.ad_account_id}) ===")

        # Account totals
        acct = overview.get("account_insights", {})
        if acct:
            lines.append(f"\n[계정 전체 성과 ({date_preset})]")
            lines.append(f"- 총 지출: ${acct.get('spend', '0')}")
            lines.append(f"- 노출: {acct.get('impressions', '0')}")
            lines.append(f"- 도달: {acct.get('reach', '0')}")
            lines.append(f"- 클릭: {acct.get('clicks', '0')}")
            lines.append(f"- CTR: {acct.get('ctr', '0')}%")
            lines.append(f"- CPC: ${acct.get('cpc', '0')}")
            actions = acct.get("actions", [])
            for action in actions:
                lines.append(f"- {action.get('action_type', 'unknown')}: {action.get('value', 0)}")

        # Campaign details
        for camp in overview.get("campaigns", []):
            status_emoji = {"ACTIVE": "[활성]", "PAUSED": "[일시중지]"}.get(camp.get("status", ""), f"[{camp.get('status', '')}]")
            lines.append(f"\n--- 캠페인: {camp.get('name', '')} {status_emoji} ---")
            lines.append(f"  목적: {camp.get('objective', 'N/A')}")

            budget = camp.get("daily_budget")
            if budget:
                lines.append(f"  일예산: ${int(budget)/100:.0f}")

            ins = camp.get("insights")
            if ins:
                lines.append(f"  지출: ${ins.get('spend', '0')}, 노출: {ins.get('impressions', '0')}, 클릭: {ins.get('clicks', '0')}, CTR: {ins.get('ctr', '0')}%")
                camp_actions = ins.get("actions", [])
                for a in camp_actions[:5]:
                    lines.append(f"  {a.get('action_type', '')}: {a.get('value', 0)}")

            # Ad sets
            for adset in camp.get("adsets", []):
                lines.append(f"  [광고세트] {adset.get('name', '')} ({adset.get('effective_status', '')})")
                targeting = adset.get("targeting", {})
                if targeting:
                    age_min = targeting.get("age_min", "")
                    age_max = targeting.get("age_max", "")
                    genders = targeting.get("genders", [])
                    gender_str = {1: "남", 2: "여"}.get(genders[0], "전체") if genders else "전체"
                    lines.append(f"    타겟: {age_min}-{age_max}세, {gender_str}")
                    interests = targeting.get("flexible_spec", [{}])
                    if interests and interests[0].get("interests"):
                        interest_names = [i.get("name", "") for i in interests[0]["interests"][:5]]
                        lines.append(f"    관심사: {', '.join(interest_names)}")

                adset_ins = adset.get("insights")
                if adset_ins:
                    lines.append(f"    지출: ${adset_ins.get('spend', '0')}, 클릭: {adset_ins.get('clicks', '0')}, CTR: {adset_ins.get('ctr', '0')}%")

                # Ads
                for ad in adset.get("ads", []):
                    lines.append(f"    [광고] {ad.get('name', '')} ({ad.get('effective_status', '')})")
                    ad_ins = ad.get("insights")
                    if ad_ins:
                        lines.append(f"      지출: ${ad_ins.get('spend', '0')}, 클릭: {ad_ins.get('clicks', '0')}, CTR: {ad_ins.get('ctr', '0')}%")

        return "\n".join(lines)

    def _calculate_totals(self, campaigns: List[Dict]) -> Dict[str, Any]:
        """Calculate aggregate totals from campaign data."""
        total_spend = 0.0
        total_impressions = 0
        total_clicks = 0
        active_count = 0
        paused_count = 0

        for camp in campaigns:
            status = camp.get("effective_status") or camp.get("status", "")
            if status == "ACTIVE":
                active_count += 1
            elif status == "PAUSED":
                paused_count += 1

            ins = camp.get("insights")
            if ins:
                total_spend += float(ins.get("spend", 0))
                total_impressions += int(ins.get("impressions", 0))
                total_clicks += int(ins.get("clicks", 0))

        return {
            "total_campaigns": len(campaigns),
            "active_campaigns": active_count,
            "paused_campaigns": paused_count,
            "total_spend": total_spend,
            "total_impressions": total_impressions,
            "total_clicks": total_clicks,
            "avg_ctr": (total_clicks / total_impressions * 100) if total_impressions > 0 else 0,
            "avg_cpc": (total_spend / total_clicks) if total_clicks > 0 else 0,
        }
