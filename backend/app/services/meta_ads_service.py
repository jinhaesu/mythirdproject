"""Optimized Meta Ads data service using field expansion for minimal API calls."""
import logging
import asyncio
from typing import Dict, Any, List, Optional

import httpx

from app.core.config import get_settings
from app.models.user import User

logger = logging.getLogger(__name__)
settings = get_settings()

# Currencies where Meta API returns amounts in actual units (no division needed)
# Most currencies use a "cents" format (divide by 100), but KRW/JPY/VND etc. are 1:1.
_ZERO_DECIMAL_CURRENCIES = {"KRW", "JPY", "VND", "CLP", "ISK", "BIF", "DJF",
                             "GNF", "KMF", "MGA", "PYG", "RWF", "UGX", "VUV", "XAF", "XOF", "XPF"}

# Exchange rates to KRW (원화) — used when Meta account currency is not KRW.
# Update periodically or fetch from API for production accuracy.
_EXCHANGE_RATES_TO_KRW = {
    "USD": 1380,
    "EUR": 1500,
    "GBP": 1750,
    "JPY": 9.2,
    "CNY": 190,
    "HKD": 177,
    "SGD": 1030,
    "AUD": 890,
    "CAD": 1000,
}


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
        # Account currency - will be fetched lazily
        self._currency: Optional[str] = None

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
            async with httpx.AsyncClient(timeout=30.0) as client:
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

    async def _fetch_account_currency(self) -> str:
        """Fetch account currency from Meta API. Cached after first call."""
        if self._currency:
            return self._currency
        if not self.connected:
            return "KRW"  # default
        resp = await self._get(self.ad_account_id, {"fields": "currency"})
        self._currency = resp.get("currency", "KRW")
        return self._currency

    @staticmethod
    def _normalize_spend(spend_value, currency: str) -> float:
        """Normalize spend from Meta API based on currency.
        Meta API returns spend as a string in the account's currency unit.
        For KRW/JPY (zero-decimal currencies): value is the actual amount (no conversion).
        For USD and most others: value is already in standard units (dollars, not cents).
        Meta's insights API returns spend in standard currency units as a string.
        """
        raw = float(spend_value or 0)
        # Meta insights API returns spend as a string in standard currency units.
        # No division needed for any currency from the insights endpoint.
        # The budget fields (daily_budget, lifetime_budget) are in cents for USD
        # but in actual units for KRW.
        return raw

    @staticmethod
    def _normalize_budget(budget_value, currency: str) -> Optional[float]:
        """Normalize budget from Meta API based on currency.
        Meta API returns daily_budget and lifetime_budget in the smallest currency unit:
        - For USD: in cents (divide by 100)
        - For KRW: in won (no division needed, it's already the smallest unit)
        """
        if budget_value is None:
            return None
        raw = float(budget_value)
        if currency in _ZERO_DECIMAL_CURRENCIES:
            return raw  # KRW: already in won
        return raw / 100  # USD: cents -> dollars

    @staticmethod
    def _to_krw(value, currency: str) -> float:
        """Convert a monetary value from the given currency to KRW.
        If currency is already KRW, returns as-is.
        """
        if value is None:
            return 0.0
        val = float(value)
        if currency == "KRW":
            return val
        rate = _EXCHANGE_RATES_TO_KRW.get(currency)
        if rate:
            return round(val * rate)
        return val  # Unknown currency — return as-is

    @staticmethod
    def _to_krw_optional(value, currency: str) -> Optional[float]:
        """Convert optional monetary value to KRW."""
        if value is None:
            return None
        return MetaAdsService._to_krw(value, currency)

    # ──────────────────────────────────────────────
    # Step 1: Overview (campaigns + account insights, lightweight)
    # Step 2: Adsets/ads loaded on-demand per campaign
    # ──────────────────────────────────────────────

    async def get_account_overview(self, date_preset: str = "last_30d",
                                    since: Optional[str] = None, until: Optional[str] = None,
                                    status_filter: Optional[str] = None,
                                    force_refresh: bool = True) -> Dict[str, Any]:
        """Get account overview: account insights + campaigns with campaign-level insights.
        Adsets/ads are NOT included here to avoid Meta API data limit errors.
        Use get_campaign_adsets() to load them on-demand when a campaign is expanded.

        Args:
            status_filter: Optional filter for campaign status (ACTIVE, PAUSED, etc.)
                          Use "ALL" or None for all statuses.
            force_refresh: Always fetch fresh data from Meta (default True).
        """
        if not self.connected:
            return {"connected": False, "error": "Meta 계정이 연동되지 않았습니다."}

        # Fetch currency first
        currency = await self._fetch_account_currency()

        insight_fields = ("spend,impressions,reach,clicks,ctr,cpc,cpm,"
                          "actions,action_values,cost_per_action_type,"
                          "frequency,purchase_roas,website_purchase_roas")

        # Build date params
        account_params: Dict[str, Any] = {"fields": insight_fields}
        if since and until:
            account_params["time_range"] = f'{{"since":"{since}","until":"{until}"}}'
        else:
            account_params["date_preset"] = date_preset

        # Two lightweight parallel calls
        account_task = self._get(f"{self.ad_account_id}/insights", account_params)

        # Campaigns with their own insights only (no nested adsets/ads)
        # Fetch ALL campaigns (limit=500) to avoid missing any
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

        # Build campaign filter for effective_status
        campaign_params: Dict[str, Any] = {"fields": campaigns_fields, "limit": 500}
        # Include all relevant statuses to ensure no campaigns are missed
        campaign_params["effective_status"] = '["ACTIVE","PAUSED","PENDING_REVIEW","ARCHIVED","CAMPAIGN_PAUSED","IN_PROCESS","WITH_ISSUES"]'

        campaigns_task = self._get(
            f"{self.ad_account_id}/campaigns",
            campaign_params
        )

        account_resp, campaigns_resp = await asyncio.gather(account_task, campaigns_task)

        # Handle pagination for campaigns if there are more pages
        all_campaign_data = campaigns_resp.get("data", [])
        paging = campaigns_resp.get("paging", {})
        while paging.get("next"):
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    next_resp = await client.get(paging["next"])
                    if next_resp.status_code == 200:
                        next_data = next_resp.json()
                        all_campaign_data.extend(next_data.get("data", []))
                        paging = next_data.get("paging", {})
                    else:
                        break
            except Exception:
                break

        result = {
            "connected": True,
            "ad_account_id": self.ad_account_id,
            "account_currency": currency,   # Meta 계정의 원래 통화
            "currency": "KRW",               # 표시 통화 (항상 원화)
            "exchange_rate": _EXCHANGE_RATES_TO_KRW.get(currency, 1) if currency != "KRW" else 1,
            "campaigns": [],
            "account_insights": {},
            "totals": {},
        }

        # Account insights — convert monetary fields to KRW
        if account_resp.get("data"):
            acct_ins = account_resp["data"][0]
            acct_ins["roas"] = self._calc_roas(acct_ins)
            self._enrich_insights(acct_ins, currency)
            # Convert spend/cpc/cpm to KRW
            self._convert_insights_to_krw(acct_ins, currency)
            result["account_insights"] = acct_ins

        # Process campaigns (lightweight: no adsets/ads)
        for camp in all_campaign_data:
            # Apply status filter if specified
            camp_status = camp.get("effective_status") or camp.get("status", "")
            if status_filter and status_filter != "ALL":
                if camp_status != status_filter:
                    continue

            # Normalize budget from Meta API units, then convert to KRW
            raw_daily = self._normalize_budget(camp.get("daily_budget"), currency)
            raw_lifetime = self._normalize_budget(camp.get("lifetime_budget"), currency)

            camp_data = {
                "id": camp.get("id"),
                "name": camp.get("name"),
                "status": camp.get("status"),
                "effective_status": camp.get("effective_status"),
                "objective": camp.get("objective"),
                "daily_budget": self._to_krw_optional(raw_daily, currency),
                "lifetime_budget": self._to_krw_optional(raw_lifetime, currency),
                "budget": self._to_krw_optional(raw_daily, currency) or self._to_krw_optional(raw_lifetime, currency),
                "budget_type": "daily" if camp.get("daily_budget") else ("lifetime" if camp.get("lifetime_budget") else None),
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
                self._enrich_insights(ins, currency)
                self._convert_insights_to_krw(ins, currency)
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
        """Load adsets + ads for a single campaign (on-demand when user expands).
        Handles deleted/archived adsets gracefully and returns empty list on error."""
        if not self.connected:
            return []

        currency = await self._fetch_account_currency()

        try:
            adset_fields = (
                f"id,name,status,effective_status,targeting,daily_budget,lifetime_budget,"
                f"insights.date_preset({date_preset}){{spend,impressions,clicks,ctr,cpc,cpm,actions,action_values,cost_per_action_type,purchase_roas,website_purchase_roas,frequency}},"
                f"ads{{id,name,status,effective_status,creative{{id,name,thumbnail_url}},"
                f"insights.date_preset({date_preset}){{spend,impressions,clicks,ctr,cpc,actions,action_values,cost_per_action_type,purchase_roas,website_purchase_roas,frequency}}}}"
            )

            # Ensure campaign_id doesn't have wrong format
            clean_campaign_id = str(campaign_id).strip()

            resp = await self._get(
                f"{clean_campaign_id}/adsets",
                {"fields": adset_fields, "limit": 200,
                 "effective_status": '["ACTIVE","PAUSED","PENDING_REVIEW","ARCHIVED","CAMPAIGN_PAUSED","IN_PROCESS","WITH_ISSUES"]'}
            )

            logger.info(f"Adsets response for campaign {campaign_id}: "
                        f"data_count={len(resp.get('data', []))}, "
                        f"has_error={bool(resp.get('error'))}, "
                        f"keys={list(resp.keys())}")

            if resp.get("error"):
                logger.warning(f"Failed to fetch adsets for campaign {campaign_id}: {resp.get('error')}")
                # Try simpler fields as fallback (nested insight expansion may fail)
                simple_fields = "id,name,status,effective_status,targeting,daily_budget,lifetime_budget"
                resp = await self._get(
                    f"{clean_campaign_id}/adsets",
                    {"fields": simple_fields, "limit": 200,
                     "effective_status": '["ACTIVE","PAUSED","PENDING_REVIEW","CAMPAIGN_PAUSED"]'}
                )
                logger.info(f"Adsets fallback response for campaign {campaign_id}: "
                            f"data_count={len(resp.get('data', []))}")
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
                    "daily_budget": self._to_krw_optional(self._normalize_budget(adset.get("daily_budget"), currency), currency),
                    "lifetime_budget": self._to_krw_optional(self._normalize_budget(adset.get("lifetime_budget"), currency), currency),
                    "insights": None,
                    "ads": [],
                }
                adset_insights = adset.get("insights", {}).get("data", [])
                if adset_insights:
                    ains = adset_insights[0]
                    ains["roas"] = self._calc_roas(ains)
                    self._enrich_insights(ains, currency)
                    self._convert_insights_to_krw(ains, currency)
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
                        self._enrich_insights(ad_ins, currency)
                        self._convert_insights_to_krw(ad_ins, currency)
                        ad_data["insights"] = ad_ins
                    adset_data["ads"].append(ad_data)

                adsets.append(adset_data)

            # Handle pagination for adsets
            paging = resp.get("paging", {})
            while paging.get("next"):
                try:
                    async with httpx.AsyncClient(timeout=30.0) as client:
                        next_resp = await client.get(paging["next"])
                        if next_resp.status_code == 200:
                            next_data = next_resp.json()
                            for adset in next_data.get("data", []):
                                adset_data = {
                                    "id": adset.get("id"),
                                    "name": adset.get("name"),
                                    "status": adset.get("status"),
                                    "effective_status": adset.get("effective_status"),
                                    "targeting": adset.get("targeting"),
                                    "daily_budget": self._to_krw_optional(self._normalize_budget(adset.get("daily_budget"), currency), currency),
                                    "lifetime_budget": self._to_krw_optional(self._normalize_budget(adset.get("lifetime_budget"), currency), currency),
                                    "insights": None,
                                    "ads": [],
                                }
                                adset_insights = adset.get("insights", {}).get("data", [])
                                if adset_insights:
                                    ains = adset_insights[0]
                                    ains["roas"] = self._calc_roas(ains)
                                    self._enrich_insights(ains, currency)
                                    self._convert_insights_to_krw(ains, currency)
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
                                        self._enrich_insights(ad_ins, currency)
                                        self._convert_insights_to_krw(ad_ins, currency)
                                        ad_data["insights"] = ad_ins
                                    adset_data["ads"].append(ad_data)
                                adsets.append(adset_data)
                            paging = next_data.get("paging", {})
                        else:
                            break
                except Exception:
                    break

            return adsets
        except Exception as e:
            logger.error(f"Error fetching adsets for campaign {campaign_id}: {e}")
            return []

    async def get_campaign_deep_insights(self, campaign_id: str, date_preset: str = "last_7d") -> Dict[str, Any]:
        """Deep analysis with demographics and placements - 3 parallel calls."""
        daily_task = self._get(f"{campaign_id}/insights", {
            "fields": "spend,impressions,reach,clicks,ctr,cpc,cpm,frequency,actions,action_values,cost_per_action_type",
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
        """Update campaign status on Meta. Returns result with new status."""
        # Validate status
        valid_statuses = {"ACTIVE", "PAUSED", "DELETED", "ARCHIVED"}
        if status not in valid_statuses:
            return {"error": f"Invalid status '{status}'. Must be one of: {', '.join(valid_statuses)}"}

        result = await self._post(campaign_id, data={"status": status})
        if "error" not in result:
            # Fetch updated status to confirm
            verify = await self._get(campaign_id, {"fields": "status,effective_status"})
            result["updated_status"] = verify.get("status", status)
            result["effective_status"] = verify.get("effective_status", status)
        return result

    async def update_adset_status(self, adset_id: str, status: str) -> Dict:
        """Update adset status on Meta. Returns result with new status."""
        valid_statuses = {"ACTIVE", "PAUSED", "DELETED", "ARCHIVED"}
        if status not in valid_statuses:
            return {"error": f"Invalid status '{status}'. Must be one of: {', '.join(valid_statuses)}"}

        result = await self._post(adset_id, data={"status": status})
        if "error" not in result:
            verify = await self._get(adset_id, {"fields": "status,effective_status"})
            result["updated_status"] = verify.get("status", status)
            result["effective_status"] = verify.get("effective_status", status)
        return result

    async def update_ad_status(self, ad_id: str, status: str) -> Dict:
        """Update ad status on Meta. Returns result with new status."""
        valid_statuses = {"ACTIVE", "PAUSED", "DELETED", "ARCHIVED"}
        if status not in valid_statuses:
            return {"error": f"Invalid status '{status}'. Must be one of: {', '.join(valid_statuses)}"}

        result = await self._post(ad_id, data={"status": status})
        if "error" not in result:
            verify = await self._get(ad_id, {"fields": "status,effective_status"})
            result["updated_status"] = verify.get("status", status)
            result["effective_status"] = verify.get("effective_status", status)
        return result

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
    # Performance Feedback Analysis
    # ──────────────────────────────────────────────

    async def get_performance_feedback(self, campaign_id: str, date_preset: str = "last_7d") -> Dict[str, Any]:
        """Advanced performance feedback analysis based on marketing expert rules.
        Compares current period vs previous period and generates structured feedback."""
        if not self.connected:
            return {"error": "Meta 계정이 연동되지 않았습니다."}

        currency = await self._fetch_account_currency()

        # Map date_preset to days for period comparison
        preset_days = {
            "last_7d": 7, "last_14d": 14, "last_30d": 30,
            "last_90d": 90, "this_month": 30, "last_month": 30,
        }
        days = preset_days.get(date_preset, 7)

        # Fetch current and previous period insights in parallel
        current_fields = ("spend,impressions,reach,clicks,ctr,cpc,cpm,frequency,"
                          "actions,action_values,cost_per_action_type,"
                          "purchase_roas,website_purchase_roas")

        current_task = self._get(f"{campaign_id}/insights", {
            "fields": current_fields,
            "date_preset": date_preset,
        })

        # Previous period: use time_range for comparison
        from datetime import datetime, timedelta
        now = datetime.utcnow().date()
        current_end = now - timedelta(days=1)
        current_start = current_end - timedelta(days=days - 1)
        prev_end = current_start - timedelta(days=1)
        prev_start = prev_end - timedelta(days=days - 1)

        prev_task = self._get(f"{campaign_id}/insights", {
            "fields": current_fields,
            "time_range": f'{{"since":"{prev_start.isoformat()}","until":"{prev_end.isoformat()}"}}',
        })

        # Daily trend for the last 30 days (weekly aggregated for trend analysis)
        trend_task = self._get(f"{campaign_id}/insights", {
            "fields": "spend,impressions,clicks,ctr,cpc,cpm,frequency,actions,action_values,purchase_roas,website_purchase_roas",
            "date_preset": "last_30d",
            "time_increment": 7,
        })

        # Fetch active ads count for creative fatigue analysis
        ads_task = self._get(f"{campaign_id}/ads", {
            "fields": "id,name,status,effective_status,creative{id,name,thumbnail_url},"
                      f"insights.date_preset({date_preset}){{spend,impressions,clicks,ctr,cpc,frequency,actions,action_values,purchase_roas,website_purchase_roas}}",
            "effective_status": '["ACTIVE"]',
            "limit": 100,
        })

        current_resp, prev_resp, trend_resp, ads_resp = await asyncio.gather(
            current_task, prev_task, trend_task, ads_task
        )

        # Parse current period data
        current_data = current_resp.get("data", [{}])[0] if current_resp.get("data") else {}
        prev_data = prev_resp.get("data", [{}])[0] if prev_resp.get("data") else {}
        trend_data = trend_resp.get("data", [])
        ads_data = ads_resp.get("data", [])

        # Extract key metrics
        def _safe_float(val):
            try:
                return float(val or 0)
            except (ValueError, TypeError):
                return 0.0

        cur = {
            "spend": _safe_float(current_data.get("spend")),
            "impressions": _safe_float(current_data.get("impressions")),
            "clicks": _safe_float(current_data.get("clicks")),
            "reach": _safe_float(current_data.get("reach")),
            "ctr": _safe_float(current_data.get("ctr")),
            "cpc": _safe_float(current_data.get("cpc")),
            "cpm": _safe_float(current_data.get("cpm")),
            "frequency": _safe_float(current_data.get("frequency")),
            "roas": self._calc_roas(current_data),
        }
        prev = {
            "spend": _safe_float(prev_data.get("spend")),
            "impressions": _safe_float(prev_data.get("impressions")),
            "clicks": _safe_float(prev_data.get("clicks")),
            "reach": _safe_float(prev_data.get("reach")),
            "ctr": _safe_float(prev_data.get("ctr")),
            "cpc": _safe_float(prev_data.get("cpc")),
            "cpm": _safe_float(prev_data.get("cpm")),
            "frequency": _safe_float(prev_data.get("frequency")),
            "roas": self._calc_roas(prev_data),
        }

        # Extract action-based metrics
        cur["purchase_count"] = self._extract_action_value(current_data.get("actions"), "offsite_conversion.fb_pixel_purchase")
        cur["content_views"] = self._extract_action_value(current_data.get("actions"), "offsite_conversion.fb_pixel_view_content")
        cur["link_clicks"] = self._extract_action_value(current_data.get("actions"), "link_click")
        cur["purchase_value"] = self._extract_action_value(current_data.get("action_values"), "offsite_conversion.fb_pixel_purchase")
        cur["cost_per_purchase"] = self._extract_cost_per_action(current_data.get("cost_per_action_type"), "offsite_conversion.fb_pixel_purchase")

        prev["purchase_count"] = self._extract_action_value(prev_data.get("actions"), "offsite_conversion.fb_pixel_purchase")
        prev["purchase_value"] = self._extract_action_value(prev_data.get("action_values"), "offsite_conversion.fb_pixel_purchase")
        prev["cost_per_purchase"] = self._extract_cost_per_action(prev_data.get("cost_per_action_type"), "offsite_conversion.fb_pixel_purchase")

        # Calculate percentage changes
        def _pct_change(current_val, prev_val):
            if not prev_val:
                return None
            return round(((current_val - prev_val) / prev_val) * 100, 1)

        changes = {
            "spend": _pct_change(cur["spend"], prev["spend"]),
            "cpm": _pct_change(cur["cpm"], prev["cpm"]),
            "ctr": _pct_change(cur["ctr"], prev["ctr"]),
            "cpc": _pct_change(cur["cpc"], prev["cpc"]),
            "roas": _pct_change(cur["roas"] or 0, prev["roas"] or 0),
            "frequency": _pct_change(cur["frequency"], prev["frequency"]),
        }

        # ── 1. Conversion Analysis (전환 측정) ──
        conversion_feedback = self._analyze_conversion(cur, prev, changes)

        # ── 2. Click Analysis (클릭 측정) ──
        click_feedback = self._analyze_clicks(cur, prev, changes, current_data)

        # ── 3. Impression Analysis (노출 측정) ──
        impression_feedback = self._analyze_impressions(cur, prev, changes, trend_data)

        # ── 4. Creative Fatigue Analysis (소재 피로도) ──
        creative_feedback = self._analyze_creative_fatigue(ads_data, cur, currency)

        return {
            "campaign_id": campaign_id,
            "currency": currency,
            "period": {
                "current": f"{current_start.isoformat()} ~ {current_end.isoformat()}",
                "previous": f"{prev_start.isoformat()} ~ {prev_end.isoformat()}",
            },
            "current_metrics": cur,
            "previous_metrics": prev,
            "changes": changes,
            "conversion_analysis": conversion_feedback,
            "click_analysis": click_feedback,
            "impression_analysis": impression_feedback,
            "creative_fatigue_analysis": creative_feedback,
        }

    def _analyze_conversion(self, cur: Dict, prev: Dict, changes: Dict) -> Dict:
        """Conversion Analysis (전환 측정) - ROAS & Efficiency."""
        feedback = {"status": "neutral", "messages": [], "recommendation": ""}
        cur_roas = cur.get("roas") or 0
        prev_roas = prev.get("roas") or 0
        cpm_change = changes.get("cpm")
        roas_change = changes.get("roas")

        if cpm_change is not None and roas_change is not None:
            if cpm_change < 0 and roas_change > 0:
                feedback["status"] = "excellent"
                feedback["messages"].append("CPM 하락 + ROAS 상승 → 적극 증액 추천")
                feedback["recommendation"] = "광고비를 20-30% 증액하여 효율적인 성과 확대를 권장합니다."
            elif cpm_change > 0 and cur_roas >= prev_roas * 0.9:
                feedback["status"] = "good"
                feedback["messages"].append("타겟 경쟁 심화, 소재 경쟁력 양호 → 소재 유지, 타겟 확장 고려")
                feedback["recommendation"] = "현재 소재를 유지하되, 유사 타겟 또는 더 넓은 타겟으로 확장을 고려하세요."
            elif roas_change < -10:
                # Distinguish between CPA increase vs lower average order value
                cur_cpa = cur.get("cost_per_purchase") or 0
                prev_cpa = prev.get("cost_per_purchase") or 0
                cur_aov = (cur.get("purchase_value") / cur.get("purchase_count")) if cur.get("purchase_count") else 0
                prev_aov = (prev.get("purchase_value") / prev.get("purchase_count")) if prev.get("purchase_count") else 0

                if cur_cpa > prev_cpa * 1.1:
                    feedback["status"] = "warning"
                    feedback["messages"].append(f"ROAS 하락 원인: CPA 증가 (₩{cur_cpa:,.0f} → 이전 ₩{prev_cpa:,.0f})")
                    feedback["recommendation"] = "전환 최적화 타겟팅을 재설정하거나, 랜딩 페이지 전환율을 개선하세요."
                elif cur_aov < prev_aov * 0.9:
                    feedback["status"] = "warning"
                    feedback["messages"].append(f"ROAS 하락 원인: 평균 주문 금액 감소 (₩{cur_aov:,.0f} → 이전 ₩{prev_aov:,.0f})")
                    feedback["recommendation"] = "상향 판매(업셀링) 또는 교차 판매(크로스셀링) 전략을 도입하세요."
                else:
                    feedback["status"] = "warning"
                    feedback["messages"].append(f"ROAS 하락: {cur_roas:.2f} → 이전 {prev_roas:.2f}")
                    feedback["recommendation"] = "전환 퍼널 전체를 점검하고, 효율이 낮은 타겟/소재를 정리하세요."
        elif cur_roas and cur_roas > 0:
            feedback["status"] = "neutral"
            feedback["messages"].append(f"현재 ROAS: {cur_roas:.2f} (이전 기간 비교 데이터 부족)")

        feedback["roas_current"] = cur_roas
        feedback["roas_previous"] = prev_roas
        return feedback

    def _analyze_clicks(self, cur: Dict, prev: Dict, changes: Dict, raw_data: Dict) -> Dict:
        """Click Analysis (클릭 측정) - CTR & CPC."""
        feedback = {"status": "neutral", "messages": [], "recommendation": ""}

        cpc_change = changes.get("cpc")
        cur_roas = cur.get("roas") or 0

        # CPC up but ROAS above target
        if cpc_change is not None and cpc_change > 0 and cur_roas >= 1.0:
            feedback["messages"].append("CPC 상승 중이나 ROAS가 목표 이상 → 유지")
            feedback["status"] = "good"
        elif cpc_change is not None and cpc_change > 20:
            feedback["messages"].append(f"CPC가 {cpc_change:.1f}% 급등 → 타겟 또는 소재 점검 필요")
            feedback["status"] = "warning"

        # Link click CTR vs overall CTR comparison
        link_clicks = cur.get("link_clicks") or 0
        total_clicks = cur.get("clicks") or 0
        impressions = cur.get("impressions") or 0

        if impressions > 0 and total_clicks > 0:
            overall_ctr = (total_clicks / impressions) * 100
            link_ctr = (link_clicks / impressions) * 100 if link_clicks else 0

            if link_ctr > 0 and overall_ctr > 0:
                if link_ctr < overall_ctr * 0.5:
                    feedback["messages"].append(f"링크 클릭 CTR({link_ctr:.2f}%)이 전체 CTR({overall_ctr:.2f}%)에 비해 매우 낮음 → 콘텐츠 낚시성 점검 필요")
                    feedback["status"] = "warning"

        # Landing page view rate check
        actions = raw_data.get("actions") or []
        landing_views = 0
        for action in actions:
            if action.get("action_type") == "landing_page_view":
                landing_views = float(action.get("value", 0))
                break

        if link_clicks > 0 and landing_views > 0:
            landing_rate = (landing_views / link_clicks) * 100
            if landing_rate < 65:
                feedback["messages"].append(f"랜딩 페이지 도달률 {landing_rate:.0f}% (기준 65-70%) → 웹사이트 속도/랜딩 점검 필요")
                feedback["status"] = "warning"
                feedback["recommendation"] = "웹사이트 로딩 속도를 개선하고, 모바일 최적화를 확인하세요."
            feedback["landing_page_view_rate"] = round(landing_rate, 1)

        if not feedback["recommendation"]:
            feedback["recommendation"] = "현재 클릭 성과를 유지하면서 랜딩 페이지 최적화에 집중하세요."

        return feedback

    def _analyze_impressions(self, cur: Dict, prev: Dict, changes: Dict, trend_data: List) -> Dict:
        """Impression Analysis (노출 측정) - CPM & Fatigue."""
        feedback = {"status": "neutral", "messages": [], "recommendation": ""}

        frequency = cur.get("frequency") or 0
        cpm_change = changes.get("cpm")
        ctr_change = changes.get("ctr")

        # Frequency > 2.3 + CPM up + CTR down → Fatigue
        if frequency > 2.3:
            if cpm_change is not None and cpm_change > 0 and ctr_change is not None and ctr_change < 0:
                feedback["status"] = "critical"
                feedback["messages"].append(
                    f"빈도 {frequency:.1f} + CPM 상승({cpm_change:+.1f}%) + CTR 하락({ctr_change:+.1f}%) → 타겟 피로도 높음 → 소재 교체 또는 타겟 변경"
                )
                feedback["recommendation"] = "새로운 크리에이티브를 투입하고, 기존 타겟을 제외한 유사 타겟을 테스트하세요."
            else:
                feedback["status"] = "warning"
                feedback["messages"].append(f"빈도 {frequency:.1f}로 높음 → 타겟 피로도 모니터링 필요")

        # 30-day weekly CPC trend analysis
        if len(trend_data) >= 3:
            weekly_cpcs = []
            for week in trend_data:
                cpc_val = float(week.get("cpc", 0) or 0)
                if cpc_val > 0:
                    weekly_cpcs.append(cpc_val)

            if len(weekly_cpcs) >= 3:
                # Check if CPC is consistently increasing
                increasing_weeks = sum(1 for i in range(1, len(weekly_cpcs)) if weekly_cpcs[i] > weekly_cpcs[i-1])
                if increasing_weeks >= len(weekly_cpcs) - 1:
                    feedback["status"] = "warning"
                    feedback["messages"].append("30일간 주별 CPC 지속 상승 → 소재 신선도 하락 → 새 광고소재 투입 필요")
                    feedback["recommendation"] = "새로운 크리에이티브를 준비하고, A/B 테스트를 진행하세요."

        if not feedback["recommendation"]:
            feedback["recommendation"] = "현재 노출 효율을 모니터링하면서 빈도 관리에 주의하세요."

        feedback["frequency"] = round(frequency, 2)
        return feedback

    def _analyze_creative_fatigue(self, ads_data: List, cur: Dict, currency: str) -> Dict:
        """Creative Fatigue Analysis (소재 피로도)."""
        feedback = {
            "status": "neutral",
            "messages": [],
            "recommendation": "",
            "active_ads_count": 0,
            "ad_performances": [],
        }

        active_ads = [ad for ad in ads_data if ad.get("effective_status") == "ACTIVE"]
        feedback["active_ads_count"] = len(active_ads)

        if len(active_ads) == 0:
            feedback["messages"].append("활성 광고가 없습니다.")
            return feedback

        if len(active_ads) == 1:
            feedback["status"] = "warning"
            feedback["messages"].append("활성 광고가 1개뿐입니다 → 소재 다양성 부족. A/B 테스트용 소재를 추가하세요.")

        # Per-creative performance
        for ad in active_ads:
            ad_perf = {
                "id": ad.get("id"),
                "name": ad.get("name"),
                "creative": ad.get("creative"),
            }
            ad_insights = ad.get("insights", {}).get("data", [])
            if ad_insights:
                ins = ad_insights[0]
                ad_perf["spend"] = float(ins.get("spend", 0) or 0)
                ad_perf["impressions"] = int(float(ins.get("impressions", 0) or 0))
                ad_perf["clicks"] = int(float(ins.get("clicks", 0) or 0))
                ad_perf["ctr"] = float(ins.get("ctr", 0) or 0)
                ad_perf["cpc"] = float(ins.get("cpc", 0) or 0)
                ad_perf["frequency"] = float(ins.get("frequency", 0) or 0)
                ad_perf["roas"] = self._calc_roas(ins)

                if ad_perf["frequency"] > 3.0:
                    feedback["messages"].append(f"광고 '{ad.get('name', '')}' 빈도 {ad_perf['frequency']:.1f} → 소재 피로도 높음")
                    feedback["status"] = "warning"

            feedback["ad_performances"].append(ad_perf)

        # Creative diversity check
        if len(active_ads) >= 3:
            feedback["messages"].append(f"활성 소재 {len(active_ads)}개 → 소재 다양성 양호")
        elif len(active_ads) == 2:
            feedback["messages"].append("활성 소재 2개 → 추가 소재 테스트를 권장합니다.")

        if not feedback["recommendation"]:
            feedback["recommendation"] = "소재별 성과를 비교하고, 효율이 낮은 소재를 교체하세요."

        return feedback

    # ──────────────────────────────────────────────
    # AI Context (from cached overview, NOT re-fetching)
    # ──────────────────────────────────────────────

    def build_context_from_overview(self, overview: Dict[str, Any]) -> str:
        """Build AI context text from already-fetched overview data. No extra API calls."""
        if not overview.get("connected"):
            return "Meta 광고 계정이 연결되지 않았습니다."

        currency_symbol = "₩" if overview.get("currency", "KRW") == "KRW" else "$"
        lines = [f"=== Meta 광고 계정 ({overview.get('ad_account_id', '')}) [통화: {overview.get('currency', 'KRW')}] ==="]

        acct = overview.get("account_insights", {})
        if acct:
            lines.append(f"\n[계정 전체 성과]")
            lines.append(f"- 총 지출: {currency_symbol}{acct.get('spend', '0')}, 노출: {acct.get('impressions', '0')}, 도달: {acct.get('reach', '0')}")
            lines.append(f"- 클릭: {acct.get('clicks', '0')}, CTR: {acct.get('ctr', '0')}%, CPC: {currency_symbol}{acct.get('cpc', '0')}, ROAS: {acct.get('roas', 'N/A')}")
            for action in (acct.get("actions") or [])[:5]:
                lines.append(f"- {action.get('action_type', '')}: {action.get('value', 0)}")

        for camp in overview.get("campaigns", [])[:15]:
            es = camp.get("effective_status") or camp.get("status", "")
            lines.append(f"\n--- 캠페인: {camp.get('name', '')} [{es}] ---")
            lines.append(f"  목적: {camp.get('objective', 'N/A')}")
            budget = camp.get("budget")
            if budget:
                lines.append(f"  예산: {currency_symbol}{budget:,.0f} ({camp.get('budget_type', 'daily')})")

            ins = camp.get("insights")
            if ins:
                lines.append(f"  지출: {currency_symbol}{ins.get('spend', '0')}, 노출: {ins.get('impressions', '0')}, 클릭: {ins.get('clicks', '0')}, CTR: {ins.get('ctr', '0')}%, ROAS: {ins.get('roas', 'N/A')}")

            for adset in camp.get("adsets", [])[:5]:
                lines.append(f"  [광고세트] {adset.get('name', '')} ({adset.get('effective_status', '')})")
                t = adset.get("targeting", {})
                if t:
                    lines.append(f"    타겟: {t.get('age_min','?')}-{t.get('age_max','?')}세")
                adset_ins = adset.get("insights")
                if adset_ins:
                    lines.append(f"    지출: {currency_symbol}{adset_ins.get('spend','0')}, CTR: {adset_ins.get('ctr','0')}%, ROAS: {adset_ins.get('roas', 'N/A')}")

                for ad in adset.get("ads", [])[:5]:
                    ad_ins = ad.get("insights")
                    if ad_ins:
                        lines.append(f"    [광고] {ad.get('name','')} - 지출: {currency_symbol}{ad_ins.get('spend','0')}, CTR: {ad_ins.get('ctr','0')}%, ROAS: {ad_ins.get('roas', 'N/A')}")

        return "\n".join(lines)

    # Meta API valid date_preset values
    _VALID_DATE_PRESETS = {3, 7, 14, 28, 30, 90}

    async def get_account_daily_trend(self, days: int = 30,
                                      since: Optional[str] = None, until: Optional[str] = None,
                                      time_increment: int = 1) -> List[Dict]:
        """Get account-level metrics for trend charts. time_increment=1 daily, 7 weekly."""
        if not self.connected:
            return []
        from datetime import datetime, timedelta
        params: Dict[str, Any] = {
            "fields": "spend,impressions,clicks,ctr,cpc,cpm,reach,actions,action_values,purchase_roas,website_purchase_roas,frequency",
            "time_increment": time_increment,
        }
        if since and until:
            params["time_range"] = f'{{"since":"{since}","until":"{until}"}}'
        elif days in self._VALID_DATE_PRESETS:
            params["date_preset"] = f"last_{days}d"
        else:
            # Non-standard day count: use explicit time_range
            end = datetime.now().strftime("%Y-%m-%d")
            start = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
            params["time_range"] = f'{{"since":"{start}","until":"{end}"}}'
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

    # ──────────────────────────────────────────────
    # Insight enrichment & parsing helpers
    # ──────────────────────────────────────────────

    @staticmethod
    def _enrich_insights(insights: Dict, currency: str) -> None:
        """Enrich insights dict with parsed action metrics.
        Adds: website_purchase_conversion_value, website_content_views,
              link_clicks, cost_per_result, frequency (already present from API).
        """
        actions = insights.get("actions") or []
        action_values = insights.get("action_values") or []
        cost_per_action = insights.get("cost_per_action_type") or []

        # Parse actions for specific metrics
        purchase_count = 0
        content_views = 0
        link_clicks = 0
        for action in actions:
            atype = action.get("action_type", "")
            val = float(action.get("value", 0))
            if atype == "offsite_conversion.fb_pixel_purchase":
                purchase_count += val
            elif atype == "offsite_conversion.fb_pixel_view_content":
                content_views += val
            elif atype == "link_click":
                link_clicks += val

        # Parse action_values for purchase conversion value
        purchase_value = 0.0
        for av in action_values:
            if av.get("action_type") == "offsite_conversion.fb_pixel_purchase":
                purchase_value += float(av.get("value", 0))

        # Parse cost_per_action_type for cost_per_result
        cost_per_result = None
        # Priority: purchase cost > link_click cost > any first cost
        for cpa in cost_per_action:
            if cpa.get("action_type") == "offsite_conversion.fb_pixel_purchase":
                cost_per_result = float(cpa.get("value", 0))
                break
        if cost_per_result is None:
            for cpa in cost_per_action:
                if cpa.get("action_type") == "link_click":
                    cost_per_result = float(cpa.get("value", 0))
                    break
        if cost_per_result is None and cost_per_action:
            cost_per_result = float(cost_per_action[0].get("value", 0))

        # Add enriched fields
        insights["website_purchase_conversion_value"] = purchase_value
        insights["website_content_views"] = int(content_views)
        insights["link_clicks"] = int(link_clicks)
        insights["purchase_count"] = int(purchase_count)
        insights["cost_per_result"] = cost_per_result
        insights["currency"] = currency

    @staticmethod
    def _convert_insights_to_krw(insights: Dict, account_currency: str) -> None:
        """Convert all monetary fields in insights from account currency to KRW.
        Modifies the dict in place. ROAS and percentages are NOT converted.
        """
        if account_currency == "KRW":
            insights["currency"] = "KRW"
            return
        # Monetary fields from Meta insights API that need conversion
        money_fields = ["spend", "cpc", "cpm",
                        "website_purchase_conversion_value", "cost_per_result"]
        for field in money_fields:
            val = insights.get(field)
            if val is not None:
                insights[field] = str(MetaAdsService._to_krw(val, account_currency))
        # action_values contain monetary amounts too
        for av in (insights.get("action_values") or []):
            if av.get("value"):
                av["value"] = str(MetaAdsService._to_krw(av["value"], account_currency))
        # cost_per_action_type too
        for cpa in (insights.get("cost_per_action_type") or []):
            if cpa.get("value"):
                cpa["value"] = str(MetaAdsService._to_krw(cpa["value"], account_currency))
        insights["currency"] = "KRW"

    @staticmethod
    def _extract_action_value(actions: Optional[List], action_type: str) -> float:
        """Extract a specific action value from actions or action_values list."""
        if not actions:
            return 0.0
        for action in actions:
            if action.get("action_type") == action_type:
                return float(action.get("value", 0))
        return 0.0

    @staticmethod
    def _extract_cost_per_action(cost_per_actions: Optional[List], action_type: str) -> float:
        """Extract cost per specific action type."""
        if not cost_per_actions:
            return 0.0
        for cpa in cost_per_actions:
            if cpa.get("action_type") == action_type:
                return float(cpa.get("value", 0))
        return 0.0

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
        if not insights:
            return None

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

        # 3) Try purchase-specific action_values
        purchase_value = 0.0
        for av in action_values:
            if av.get("action_type") in (
                "purchase", "offsite_conversion.fb_pixel_purchase", "omni_purchase",
            ):
                purchase_value += float(av.get("value", 0))
        if purchase_value > 0:
            return round(purchase_value / spend, 2)

        # 4) Fallback: sum ALL action_values as total conversion revenue
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
