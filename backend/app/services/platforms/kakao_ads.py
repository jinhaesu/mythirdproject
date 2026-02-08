"""Kakao Moment API integration service."""
from datetime import date
from typing import List, Dict, Any, Optional
import httpx

from app.services.platforms.base import BasePlatformService
from app.core.config import get_settings

settings = get_settings()


class KakaoAdsService(BasePlatformService):
    """Kakao Moment (Ads) API integration.

    Uses Kakao Moment API for campaign and performance data.
    https://developers.kakao.com/docs/latest/ko/moment/rest-api
    """

    BASE_URL = "https://apis.moment.kakao.com"

    async def validate_connection(self) -> bool:
        """Validate Kakao Moment API connection."""
        try:
            account_info = await self.get_account_info()
            return account_info is not None
        except Exception:
            return False

    async def get_account_info(self) -> Dict[str, Any]:
        """Get Kakao Moment account information."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.BASE_URL}/openapi/v4/adAccounts/{self.account_id}",
                headers=self._get_headers()
            )
            if response.status_code == 200:
                return response.json()
            return {}

    async def get_campaigns(self) -> List[Dict[str, Any]]:
        """Get list of Kakao Moment campaigns."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.BASE_URL}/openapi/v4/adAccounts/{self.account_id}/campaigns",
                headers=self._get_headers()
            )
            if response.status_code == 200:
                data = response.json()
                return data.get("content", [])
            return []

    async def get_daily_stats(
        self,
        date_from: date,
        date_to: date,
        campaign_ids: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """Get daily performance statistics from Kakao Moment."""
        params = {
            "start": date_from.strftime("%Y%m%d"),
            "end": date_to.strftime("%Y%m%d"),
            "metricsGroup": "BASIC",
            "dimension": "CAMPAIGN",
            "datePreset": "CUSTOM",
        }

        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.BASE_URL}/openapi/v4/adAccounts/{self.account_id}/reports",
                headers=self._get_headers(),
                params=params
            )
            if response.status_code == 200:
                data = response.json()
                return self._transform_stats(data)
            return []

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

    def _transform_stats(self, data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Transform Kakao stats response to standard format."""
        results = []
        for row in data.get("data", []):
            metrics = row.get("metrics", {})
            dimensions = row.get("dimensions", {})

            stat = {
                "date": dimensions.get("date"),
                "campaign_id": dimensions.get("campaignId"),
                "campaign_name": dimensions.get("campaignName", ""),
                "impressions": int(metrics.get("imp", 0)),
                "clicks": int(metrics.get("click", 0)),
                "spend": float(metrics.get("cost", 0)),
                "conversions": int(metrics.get("conversion", 0)),
                "revenue": float(metrics.get("conversionValue", 0)),
            }
            results.append(self.calculate_metrics(stat))
        return results

    def _get_headers(self) -> Dict[str, str]:
        """Get API request headers."""
        return {
            "Authorization": f"Bearer {self.access_token}",
            "adAccountId": self.account_id,
            "Content-Type": "application/json",
        }
