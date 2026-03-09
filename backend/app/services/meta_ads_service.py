"""Optimized Meta Ads data service using field expansion for minimal API calls."""
import logging
import asyncio
from typing import Dict, Any, List, Optional

import httpx

from app.core.config import get_settings
from app.models.user import User

logger = logging.getLogger(__name__)
settings = get_settings()


class MetaAdsService:
    """Fetch Meta ad account data with minimal API calls using field expansion."""

    def __init__(self, user: User, shared_meta_user: User = None):
        self.user = user
        # Meta 인증은 전체 계정 공유: 현재 유저에게 없으면 공유 유저에서 가져옴
        meta_source = user if user.meta_access_token else shared_meta_user
        self.access_token = meta_source.meta_access_token if meta_source else None
        self.ad_account_id = (meta_source.meta_ad_account_id if meta_source else None) or ""
        if self.ad_account_id and not self.ad_account_id.startswith("act_"):
            self.ad_account_id = f"act_{self.ad_account_id}"
        self.base_url = f"{settings.META_GRAPH_API_BASE}/{settings.META_API_VERSION}"

    @classmethod
    async def create(cls, user: User, db=None) -> "MetaAdsService":
        """Meta 인증 전체 계정 공유 방식으로 인스턴스 생성 (async factory)."""
        shared = None
        if not user.meta_access_token and db is not None:
            from sqlalchemy import select as sa_select
            result = await db.execute(
                sa_select(User).where(User.meta_access_token.isnot(None), User.meta_access_token != "").limit(1)
            )
            shared = result.scalar_one_or_none()
        return cls(user, shared_meta_user=shared)

    @property
    def connected(self) -> bool:
        return bool(self.access_token and self.ad_account_id)

    async def _get(self, endpoint: str, params: Dict[str, Any] = None) -> Dict:
        params = params or {}
        params["access_token"] = self.access_token
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.get(f"{self.base_url}/{endpoint}", params=params)
                if resp.status_code != 200:
                    logger.error(f"Meta API {resp.status_code}: {endpoint} -> {resp.text[:300]}")
                    return {"data": [], "error": resp.text[:200]}
                return resp.json()
        except Exception as e:
            logger.error(f"Meta API request failed: {endpoint} -> {e}")
            return {"data": [], "error": str(e)}

    async def _post(self, endpoint: str, data: Dict[str, Any] = None, params: Dict[str, Any] = None) -> Dict:
        params = params or {}
        params["access_token"] = self.access_token
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.post(f"{self.base_url}/{endpoint}", params=params, data=data)
                if resp.status_code != 200:
                    logger.error(f"Meta API POST {resp.status_code}: {resp.text[:300]}")
                    return {"error": resp.text[:200]}
                return resp.json()
        except Exception as e:
            return {"error": str(e)}

    # ──────────────────────────────────────────────
    # Step 1: Overview (campaigns + account insights, lightweight)
    # Step 2: Adsets/ads loaded on-demand per campaign
    # ──────────────────────────────────────────────

    async def get_account_overview(self, date_preset: str = "last_30d",
                                    since: Optional[str] = None, until: Optional[str] = None) -> Dict[str, Any]:
        """Get account overview: account insights + campaigns with campaign-level insights.
        Adsets/ads are NOT included here to avoid Meta API data limit errors.
        Use get_campaign_adsets() to load them on-demand when a campaign is expanded."""
        if not self.connected:
            return {"connected": False, "error": "Meta 계정이 연동되지 않았습니다."}

        insight_fields = "spend,impressions,reach,clicks,ctr,cpc,cpm,actions,action_values,cost_per_action_type,frequency,purchase_roas,website_purchase_roas"

        # Build date params
        account_params: Dict[str, Any] = {"fields": insight_fields}
        if since and until:
            account_params["time_range"] = f'{{"since":"{since}","until":"{until}"}}'
        else:
            account_params["date_preset"] = date_preset

        # Two lightweight parallel calls
        account_task = self._get(f"{self.ad_account_id}/insights", account_params)

        # Campaigns with their own insights only (no nested adsets/ads)
        if since and until:
            campaigns_fields = (
                f"id,name,status,objective,daily_budget,lifetime_budget,"
                f"start_time,stop_time,effective_status,"
                f"insights.time_range({{'since':'{since}','until':'{until}'}}){{{insight_fields}}}"
            )
        else:
            campaigns_fields = (
                f"id,name,status,objective,daily_budget,lifetime_budget,"
                f"start_time,stop_time,effective_status,"
                f"insights.date_preset({date_preset}){{{insight_fields}}}"
            )
        campaigns_task = self._get(
            f"{self.ad_account_id}/campaigns",
            {"fields": campaigns_fields, "limit": 50}
        )

        account_resp, campaigns_resp = await asyncio.gather(account_task, campaigns_task)

        result = {
            "connected": True,
            "ad_account_id": self.ad_account_id,
            "campaigns": [],
            "account_insights": {},
            "totals": {},
        }

        # Account insights
        if account_resp.get("data"):
            acct_ins = account_resp["data"][0]
            acct_ins["roas"] = self._calc_roas(acct_ins)
            result["account_insights"] = acct_ins

        # Process campaigns (lightweight: no adsets/ads)
        raw_campaigns = campaigns_resp.get("data", [])

        for camp in raw_campaigns:
            camp_data = {
                "id": camp.get("id"),
                "name": camp.get("name"),
                "status": camp.get("status"),
                "effective_status": camp.get("effective_status"),
                "objective": camp.get("objective"),
                "daily_budget": camp.get("daily_budget"),
                "lifetime_budget": camp.get("lifetime_budget"),
                "start_time": camp.get("start_time"),
                "stop_time": camp.get("stop_time"),
                "insights": None,
                "adsets": [],
            }

            # Campaign insights (inline from field expansion)
            camp_insights = camp.get("insights", {}).get("data", [])
            if camp_insights:
                ins = camp_insights[0]
                ins["roas"] = self._calc_roas(ins)
                camp_data["insights"] = ins

            result["campaigns"].append(camp_data)

        # Propagate any Meta API errors to the frontend
        if campaigns_resp.get("error"):
            result["campaigns_error"] = campaigns_resp["error"]
        if account_resp.get("error"):
            result["account_error"] = account_resp["error"]

        result["totals"] = self._calculate_totals(result["campaigns"])
        return result

    async def get_campaign_adsets(self, campaign_id: str, date_preset: str = "last_7d") -> List[Dict]:
        """Load adsets + ads for a single campaign (on-demand when user expands)."""
        adset_fields = (
            f"id,name,status,effective_status,targeting,daily_budget,lifetime_budget,"
            f"insights.date_preset({date_preset}){{spend,impressions,clicks,ctr,cpc,cpm,actions,action_values,purchase_roas,website_purchase_roas,frequency}},"
            f"ads{{id,name,status,effective_status,creative{{id,name,thumbnail_url}},"
            f"insights.date_preset({date_preset}){{spend,impressions,clicks,ctr,cpc,actions,action_values,purchase_roas,website_purchase_roas,frequency}}}}"
        )
        resp = await self._get(
            f"{campaign_id}/adsets",
            {"fields": adset_fields, "limit": 50}
        )
        if resp.get("error"):
            return []

        adsets = []
        for adset in resp.get("data", []):
            adset_data = {
                "id": adset.get("id"),
                "name": adset.get("name"),
                "status": adset.get("status"),
                "effective_status": adset.get("effective_status"),
                "targeting": adset.get("targeting"),
                "daily_budget": adset.get("daily_budget"),
                "lifetime_budget": adset.get("lifetime_budget"),
                "insights": None,
                "ads": [],
            }
            adset_insights = adset.get("insights", {}).get("data", [])
            if adset_insights:
                ains = adset_insights[0]
                ains["roas"] = self._calc_roas(ains)
                adset_data["insights"] = ains

            for ad in adset.get("ads", {}).get("data", []):
                ad_data = {
                    "id": ad.get("id"),
                    "name": ad.get("name"),
                    "status": ad.get("status"),
                    "effective_status": ad.get("effective_status"),
                    "creative": ad.get("creative"),
                    "insights": None,
                }
                ad_insights = ad.get("insights", {}).get("data", [])
                if ad_insights:
                    ad_ins = ad_insights[0]
                    ad_ins["roas"] = self._calc_roas(ad_ins)
                    ad_data["insights"] = ad_ins
                adset_data["ads"].append(ad_data)

            adsets.append(adset_data)
        return adsets

    async def get_campaign_deep_insights(self, campaign_id: str, date_preset: str = "last_7d") -> Dict[str, Any]:
        """Deep analysis with demographics and placements - 3 parallel calls."""
        daily_task = self._get(f"{campaign_id}/insights", {
            "fields": "spend,impressions,reach,clicks,ctr,cpc,cpm,frequency",
            "date_preset": date_preset, "time_increment": 1,
        })
        demo_task = self._get(f"{campaign_id}/insights", {
            "fields": "spend,impressions,clicks,ctr",
            "date_preset": date_preset, "breakdowns": "age,gender",
        })
        placement_task = self._get(f"{campaign_id}/insights", {
            "fields": "spend,impressions,clicks,ctr",
            "date_preset": date_preset, "breakdowns": "publisher_platform,platform_position",
        })

        daily, demo, placement = await asyncio.gather(daily_task, demo_task, placement_task)

        return {
            "campaign_id": campaign_id,
            "daily_data": daily.get("data", []),
            "demographics": demo.get("data", []),
            "placements": placement.get("data", []),
        }

    # ──────────────────────────────────────────────
    # Management Actions
    # ──────────────────────────────────────────────

    async def update_campaign_status(self, campaign_id: str, status: str) -> Dict:
        return await self._post(campaign_id, data={"status": status})

    async def update_adset_status(self, adset_id: str, status: str) -> Dict:
        return await self._post(adset_id, data={"status": status})

    async def update_ad_status(self, ad_id: str, status: str) -> Dict:
        return await self._post(ad_id, data={"status": status})

    async def update_adset_budget(self, adset_id: str, daily_budget: Optional[int] = None, lifetime_budget: Optional[int] = None) -> Dict:
        data = {}
        if daily_budget is not None:
            data["daily_budget"] = daily_budget
        if lifetime_budget is not None:
            data["lifetime_budget"] = lifetime_budget
        return await self._post(adset_id, data=data)

    async def update_campaign_budget(self, campaign_id: str, daily_budget: Optional[int] = None) -> Dict:
        data = {}
        if daily_budget is not None:
            data["daily_budget"] = daily_budget
        return await self._post(campaign_id, data=data)

    # ──────────────────────────────────────────────
    # AI Context (from cached overview, NOT re-fetching)
    # ──────────────────────────────────────────────

    def build_context_from_overview(self, overview: Dict[str, Any]) -> str:
        """Build AI context text from already-fetched overview data. No extra API calls."""
        if not overview.get("connected"):
            return "Meta 광고 계정이 연결되지 않았습니다."

        lines = [f"=== Meta 광고 계정 ({overview.get('ad_account_id', '')}) ==="]

        acct = overview.get("account_insights", {})
        if acct:
            lines.append(f"\n[계정 전체 성과]")
            lines.append(f"- 총 지출: ₩{acct.get('spend', '0')}, 노출: {acct.get('impressions', '0')}, 도달: {acct.get('reach', '0')}")
            lines.append(f"- 클릭: {acct.get('clicks', '0')}, CTR: {acct.get('ctr', '0')}%, CPC: ₩{acct.get('cpc', '0')}, ROAS: {acct.get('roas', 'N/A')}")
            for action in (acct.get("actions") or [])[:5]:
                lines.append(f"- {action.get('action_type', '')}: {action.get('value', 0)}")

        for camp in overview.get("campaigns", [])[:15]:
            es = camp.get("effective_status") or camp.get("status", "")
            lines.append(f"\n--- 캠페인: {camp.get('name', '')} [{es}] ---")
            lines.append(f"  목적: {camp.get('objective', 'N/A')}")
            budget = camp.get("daily_budget")
            if budget:
                lines.append(f"  일예산: ₩{int(budget)/100:.0f}")

            ins = camp.get("insights")
            if ins:
                lines.append(f"  지출: ₩{ins.get('spend', '0')}, 노출: {ins.get('impressions', '0')}, 클릭: {ins.get('clicks', '0')}, CTR: {ins.get('ctr', '0')}%, ROAS: {ins.get('roas', 'N/A')}")

            for adset in camp.get("adsets", [])[:5]:
                lines.append(f"  [광고세트] {adset.get('name', '')} ({adset.get('effective_status', '')})")
                t = adset.get("targeting", {})
                if t:
                    lines.append(f"    타겟: {t.get('age_min','?')}-{t.get('age_max','?')}세")
                adset_ins = adset.get("insights")
                if adset_ins:
                    lines.append(f"    지출: ₩{adset_ins.get('spend','0')}, CTR: {adset_ins.get('ctr','0')}%, ROAS: {adset_ins.get('roas', 'N/A')}")

                for ad in adset.get("ads", [])[:5]:
                    ad_ins = ad.get("insights")
                    if ad_ins:
                        lines.append(f"    [광고] {ad.get('name','')} - 지출: ₩{ad_ins.get('spend','0')}, CTR: {ad_ins.get('ctr','0')}%, ROAS: {ad_ins.get('roas', 'N/A')}")

        return "\n".join(lines)

    async def get_account_daily_trend(self, days: int = 30,
                                      since: Optional[str] = None, until: Optional[str] = None,
                                      time_increment: int = 1) -> List[Dict]:
        """Get account-level metrics for trend charts. time_increment=1 daily, 7 weekly."""
        if not self.connected:
            return []
        params: Dict[str, Any] = {
            "fields": "spend,impressions,clicks,ctr,cpc,cpm,reach,actions,action_values,purchase_roas,website_purchase_roas",
            "time_increment": time_increment,
        }
        if since and until:
            params["time_range"] = f'{{"since":"{since}","until":"{until}"}}'
        else:
            params["date_preset"] = f"last_{days}d"
        resp = await self._get(f"{self.ad_account_id}/insights", params)
        data = resp.get("data", [])
        for row in data:
            row["roas"] = self._calc_roas(row)
        return data

    async def build_full_context_for_ai(self, date_preset: str = "last_7d") -> str:
        """Convenience: fetch overview and build context."""
        if not self.connected:
            return "Meta 광고 계정이 연결되지 않았습니다."
        overview = await self.get_account_overview(date_preset)
        return self.build_context_from_overview(overview)

    @staticmethod
    def _extract_roas_value(field_data) -> Optional[float]:
        """Extract ROAS value from Meta's purchase_roas/website_purchase_roas field."""
        if not field_data:
            return None
        if isinstance(field_data, list) and field_data:
            val = float(field_data[0].get("value", 0))
            return val if val > 0 else None
        if isinstance(field_data, (int, float)) and float(field_data) > 0:
            return float(field_data)
        return None

    @staticmethod
    def _calc_roas(insights: Dict) -> Optional[float]:
        """Calculate ROAS from insights data.
        Priority: website_purchase_roas > purchase_roas > purchase action_values > all action_values.
        """
        # 1) Try Meta's website_purchase_roas field (웹사이트 구매 ROAS)
        val = MetaAdsService._extract_roas_value(insights.get("website_purchase_roas"))
        if val:
            return round(val, 2)

        # 2) Try generic purchase_roas field
        val = MetaAdsService._extract_roas_value(insights.get("purchase_roas"))
        if val:
            return round(val, 2)

        spend = float(insights.get("spend", 0) or 0)
        if spend <= 0:
            return None

        action_values = insights.get("action_values") or []
        if not action_values:
            return None

        # 2) Try purchase-specific action_values
        purchase_value = 0.0
        for av in action_values:
            if av.get("action_type") in (
                "purchase", "offsite_conversion.fb_pixel_purchase", "omni_purchase",
            ):
                purchase_value += float(av.get("value", 0))
        if purchase_value > 0:
            return round(purchase_value / spend, 2)

        # 3) Fallback: sum ALL action_values as total conversion revenue
        total_value = 0.0
        for av in action_values:
            total_value += float(av.get("value", 0))

        return round(total_value / spend, 2) if total_value > 0 else None

    def _calculate_totals(self, campaigns: List[Dict]) -> Dict[str, Any]:
        total_spend = 0.0
        total_impressions = 0
        total_clicks = 0
        active_count = 0
        paused_count = 0

        for camp in campaigns:
            status = camp.get("effective_status") or camp.get("status", "")
            if status == "ACTIVE":
                active_count += 1
            elif status in ("PAUSED", "CAMPAIGN_PAUSED"):
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
