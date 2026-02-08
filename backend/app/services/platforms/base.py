"""Base platform service interface."""
from abc import ABC, abstractmethod
from datetime import date
from typing import List, Dict, Any, Optional


class BasePlatformService(ABC):
    """Abstract base class for ad platform integrations."""

    def __init__(self, access_token: str, account_id: str):
        self.access_token = access_token
        self.account_id = account_id

    @abstractmethod
    async def validate_connection(self) -> bool:
        """Validate that the connection is working."""
        pass

    @abstractmethod
    async def get_account_info(self) -> Dict[str, Any]:
        """Get account information."""
        pass

    @abstractmethod
    async def get_campaigns(self) -> List[Dict[str, Any]]:
        """Get list of campaigns."""
        pass

    @abstractmethod
    async def get_daily_stats(
        self,
        date_from: date,
        date_to: date,
        campaign_ids: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """Get daily performance statistics."""
        pass

    @abstractmethod
    async def get_realtime_stats(self) -> Dict[str, Any]:
        """Get real-time (today's) statistics."""
        pass

    def calculate_metrics(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Calculate derived metrics (CTR, CPC, ROAS, etc.)."""
        impressions = data.get("impressions", 0)
        clicks = data.get("clicks", 0)
        spend = data.get("spend", 0.0)
        revenue = data.get("revenue", 0.0)
        conversions = data.get("conversions", 0)

        return {
            **data,
            "ctr": (clicks / impressions * 100) if impressions > 0 else 0,
            "cpc": (spend / clicks) if clicks > 0 else 0,
            "cpm": (spend / impressions * 1000) if impressions > 0 else 0,
            "roas": (revenue / spend * 100) if spend > 0 else 0,
            "conversion_rate": (conversions / clicks * 100) if clicks > 0 else 0,
        }
