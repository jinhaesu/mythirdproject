"""Database models initialization."""
from app.models.user import User
from app.models.campaign import Campaign, Ad, CampaignPerformance, CampaignObjective, CampaignStatus
from app.models.creative import Creative, CreativeType, CreativeFormat
from app.models.benchmark import Benchmark, CollectedPost, BenchmarkType
from app.models.ad_platform import PlatformConnection, RevenueData, Report, AIInsightLog, AdPlatform
from app.models.auto_rule import AutoRule, AutoRuleLog
from app.models.scheduled_report import ScheduledReport
from app.models.market_keyword import MarketKeyword
from app.models.keyword_rank_schedule import KeywordRankSchedule
from app.models.review_monitor import MonitoredProduct, ReviewReportSchedule
from app.models.affiliate import (
    AffiliateCampaign,
    AffiliatePartner,
    ReferralClick,
    ReferralConversion,
    AffiliateSettlement,
    ReferralProgram,
)
from app.models.points import PointTransaction
from app.models.partner_campaign import PartnerCampaign
from app.models.meta_insight import MetaInsightDaily

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
    "AutoRule",
    "AutoRuleLog",
    "ScheduledReport",
    "MarketKeyword",
    "KeywordRankSchedule",
    "MonitoredProduct",
    "ReviewReportSchedule",
    "AffiliateCampaign",
    "AffiliatePartner",
    "ReferralClick",
    "ReferralConversion",
    "AffiliateSettlement",
    "ReferralProgram",
    "PointTransaction",
    "PartnerCampaign",
    "MetaInsightDaily",
]
