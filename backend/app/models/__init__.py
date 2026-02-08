"""Database models initialization."""
from app.models.user import User
from app.models.campaign import Campaign, Ad, CampaignPerformance, CampaignObjective, CampaignStatus
from app.models.creative import Creative, CreativeType, CreativeFormat
from app.models.benchmark import Benchmark, CollectedPost, BenchmarkType
from app.models.ad_platform import PlatformConnection, RevenueData, Report, AIInsightLog, AdPlatform

__all__ = [
    "User",
    "Campaign",
    "Ad",
    "CampaignPerformance",
    "CampaignObjective",
    "CampaignStatus",
    "Creative",
    "CreativeType",
    "CreativeFormat",
    "Benchmark",
    "CollectedPost",
    "BenchmarkType",
    "PlatformConnection",
    "RevenueData",
    "Report",
    "AIInsightLog",
    "AdPlatform",
]
