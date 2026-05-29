"""API endpoints initialization."""
from app.api.v1.endpoints import (
    auth, benchmark, creative, campaign, analytics,
    naver_analytics, naver_campaign,
)

__all__ = [
    "auth", "benchmark", "creative", "campaign", "analytics",
    "naver_analytics", "naver_campaign",
]
