"""Naver Search Ads API integration service."""
from datetime import date
from typing import List, Dict, Any, Optional
import httpx
import hashlib
import hmac
import time

from app.services.platforms.base import BasePlatformService
from app.core.config import get_settings

settings = get_settings()


class NaverAdsService(BasePlatformService):
    """Naver Search Ads API integration.

    Uses Naver Search Ads API for campaign and performance data.
    https://naver.github.io/searchad-apidoc/
    """

    BASE_URL = "https://api.searchad.naver.com"

    def __init__(self, access_token: str, account_id: str, secret_key: str = None):
        super().__init__(access_token, account_id)
        self.secret_key = secret_key or settings.NAVER_ADS_SECRET_KEY

    async def validate_connection(self) -> bool:
        """Validate Naver Ads API connection."""
        try:
            account_info = await self.get_account_info()
            return account_info is not None
        except Exception:
            return False

    async def get_account_info(self) -> Dict[str, Any]:
        """Get Naver Ads account information."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.BASE_URL}/ncc/customers",
                headers=self._get_headers("/ncc/customers", "GET")
            )
            if response.status_code == 200:
                customers = response.json()
                for customer in customers:
                    if customer.get("customerId") == self.account_id:
                        return customer
            return {}

    async def get_campaigns(self) -> List[Dict[str, Any]]:
        """Get list of Naver Ads campaigns."""
        path = f"/ncc/campaigns"
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.BASE_URL}{path}",
                headers=self._get_headers(path, "GET")
            )
            if response.status_code == 200:
                return response.json()
            return []

    async def get_daily_stats(
        self,
        date_from: date,
        date_to: date,
        campaign_ids: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """Get daily performance statistics from Naver Ads."""
        path = "/stats"
        params = {
            "id": self.account_id,
            "fields": '["impCnt","clkCnt","salesAmt","convCnt","convAmt"]',
            "timeRange": f'{{"since":"{date_from}","until":"{date_to}"}}',
            "datePreset": "custom",
            "timeIncrement": "1"  # Daily breakdown
        }

        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.BASE_URL}{path}",
                headers=self._get_headers(path, "GET"),
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

        if stats:
            return stats[0]
        return self.calculate_metrics({
            "date": str(today),
            "impressions": 0,
            "clicks": 0,
            "spend": 0,
            "conversions": 0,
            "revenue": 0,
        })

    def _transform_stats(self, data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Transform Naver stats response to standard format."""
        results = []
        for row in data.get("data", []):
            stat = {
                "date": row.get("statDt"),
                "campaign_id": row.get("id"),
                "campaign_name": row.get("name", ""),
                "impressions": int(row.get("impCnt", 0)),
                "clicks": int(row.get("clkCnt", 0)),
                "spend": float(row.get("salesAmt", 0)),
                "conversions": int(row.get("convCnt", 0)),
                "revenue": float(row.get("convAmt", 0)),
            }
            results.append(self.calculate_metrics(stat))
        return results

    def _get_headers(self, path: str, method: str) -> Dict[str, str]:
        """Get API request headers with signature."""
        timestamp = str(int(time.time() * 1000))
        signature = self._generate_signature(timestamp, method, path)

        return {
            "X-API-KEY": self.access_token,
            "X-Customer": self.account_id,
            "X-Timestamp": timestamp,
            "X-Signature": signature,
            "Content-Type": "application/json",
        }

    def _generate_signature(self, timestamp: str, method: str, path: str) -> str:
        """Generate HMAC signature for Naver API."""
        message = f"{timestamp}.{method}.{path}"
        signature = hmac.new(
            self.secret_key.encode("utf-8"),
            message.encode("utf-8"),
            hashlib.sha256
        ).hexdigest()
        return signature
