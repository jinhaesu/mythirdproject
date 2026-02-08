"""Google Ads API integration service."""
from datetime import date
from typing import List, Dict, Any, Optional
import httpx

from app.services.platforms.base import BasePlatformService
from app.core.config import get_settings

settings = get_settings()


class GoogleAdsService(BasePlatformService):
    """Google Ads API integration.

    Uses Google Ads API v15 for campaign and performance data.
    https://developers.google.com/google-ads/api/docs/start
    """

    API_VERSION = "v15"
    BASE_URL = f"https://googleads.googleapis.com/{API_VERSION}"

    async def validate_connection(self) -> bool:
        """Validate Google Ads API connection."""
        try:
            account_info = await self.get_account_info()
            return account_info is not None
        except Exception:
            return False

    async def get_account_info(self) -> Dict[str, Any]:
        """Get Google Ads account information."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.BASE_URL}/customers/{self.account_id}",
                headers=self._get_headers()
            )
            if response.status_code == 200:
                return response.json()
            return {}

    async def get_campaigns(self) -> List[Dict[str, Any]]:
        """Get list of Google Ads campaigns."""
        query = """
            SELECT
                campaign.id,
                campaign.name,
                campaign.status,
                campaign.advertising_channel_type,
                campaign_budget.amount_micros
            FROM campaign
            WHERE campaign.status != 'REMOVED'
        """
        return await self._execute_query(query)

    async def get_daily_stats(
        self,
        date_from: date,
        date_to: date,
        campaign_ids: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """Get daily performance statistics from Google Ads."""
        campaign_filter = ""
        if campaign_ids:
            ids = ", ".join(f"'{id}'" for id in campaign_ids)
            campaign_filter = f"AND campaign.id IN ({ids})"

        query = f"""
            SELECT
                segments.date,
                campaign.id,
                campaign.name,
                metrics.impressions,
                metrics.clicks,
                metrics.cost_micros,
                metrics.conversions,
                metrics.conversions_value
            FROM campaign
            WHERE segments.date BETWEEN '{date_from}' AND '{date_to}'
            {campaign_filter}
        """

        raw_data = await self._execute_query(query)

        # Transform to standard format
        results = []
        for row in raw_data:
            metrics = row.get("metrics", {})
            campaign = row.get("campaign", {})
            segments = row.get("segments", {})

            data = {
                "date": segments.get("date"),
                "campaign_id": campaign.get("id"),
                "campaign_name": campaign.get("name"),
                "impressions": int(metrics.get("impressions", 0)),
                "clicks": int(metrics.get("clicks", 0)),
                "spend": float(metrics.get("costMicros", 0)) / 1_000_000,  # Convert micros to currency
                "conversions": int(float(metrics.get("conversions", 0))),
                "revenue": float(metrics.get("conversionsValue", 0)),
            }
            results.append(self.calculate_metrics(data))

        return results

    async def get_realtime_stats(self) -> Dict[str, Any]:
        """Get today's real-time statistics."""
        today = date.today()
        stats = await self.get_daily_stats(today, today)

        # Aggregate all campaigns
        total = {
            "date": str(today),
            "impressions": sum(s.get("impressions", 0) for s in stats),
            "clicks": sum(s.get("clicks", 0) for s in stats),
            "spend": sum(s.get("spend", 0) for s in stats),
            "conversions": sum(s.get("conversions", 0) for s in stats),
            "revenue": sum(s.get("revenue", 0) for s in stats),
        }
        return self.calculate_metrics(total)

    async def _execute_query(self, query: str) -> List[Dict[str, Any]]:
        """Execute a GAQL query against Google Ads API."""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.BASE_URL}/customers/{self.account_id}/googleAds:searchStream",
                headers=self._get_headers(),
                json={"query": query}
            )
            if response.status_code == 200:
                data = response.json()
                results = []
                for batch in data:
                    results.extend(batch.get("results", []))
                return results
            return []

    def _get_headers(self) -> Dict[str, str]:
        """Get API request headers."""
        return {
            "Authorization": f"Bearer {self.access_token}",
            "developer-token": settings.GOOGLE_ADS_DEVELOPER_TOKEN or "",
            "login-customer-id": self.account_id,
            "Content-Type": "application/json",
        }
