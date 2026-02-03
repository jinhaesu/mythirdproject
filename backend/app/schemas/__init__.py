"""Schemas module initialization."""
from app.schemas.user import (
    UserBase, UserCreate, UserUpdate, UserResponse,
    MetaConnectionRequest, Token, TokenPayload, BrandSettings
)
from app.schemas.benchmark import (
    BenchmarkQuery, FilterPeriod, SortOption,
    CollectedPostResponse, PostMetrics,
    SentimentAnalysis, SentimentKeyword,
    StyleExtraction, StyleExtractionRequest, StyleExtractionResponse,
    AISummaryResponse, BenchmarkResponse
)
from app.schemas.creative import (
    CreativeType, CreativeFormat, VoiceStyle,
    ImageGenerationRequest, VideoGenerationRequest,
    TextRewriteRequest, BackgroundExtendRequest,
    CreativeBase, CreativeCreate, CreativeUpdate, CreativeResponse,
    GenerationJobResponse
)
from app.schemas.campaign import (
    CampaignObjective, CampaignStatus,
    AgeRange, GeoTargeting, InterestTargeting, TargetingConfig,
    BudgetAllocation, StrategyRecommendation,
    CampaignCreate, CampaignUpdate, CampaignResponse,
    AdCreate, AdResponse,
    PublishRequest, PublishResponse
)
from app.schemas.analytics import (
    KPIMetrics, DailyMetrics, CreativePerformance,
    PerformanceComparison, AIInsight,
    BudgetReallocationRequest, BudgetReallocationResponse,
    PerformanceDashboardResponse,
    LearnFromPerformanceRequest, LearnFromPerformanceResponse
)

__all__ = [
    # User
    "UserBase", "UserCreate", "UserUpdate", "UserResponse",
    "MetaConnectionRequest", "Token", "TokenPayload", "BrandSettings",
    # Benchmark
    "BenchmarkQuery", "FilterPeriod", "SortOption",
    "CollectedPostResponse", "PostMetrics",
    "SentimentAnalysis", "SentimentKeyword",
    "StyleExtraction", "StyleExtractionRequest", "StyleExtractionResponse",
    "AISummaryResponse", "BenchmarkResponse",
    # Creative
    "CreativeType", "CreativeFormat", "VoiceStyle",
    "ImageGenerationRequest", "VideoGenerationRequest",
    "TextRewriteRequest", "BackgroundExtendRequest",
    "CreativeBase", "CreativeCreate", "CreativeUpdate", "CreativeResponse",
    "GenerationJobResponse",
    # Campaign
    "CampaignObjective", "CampaignStatus",
    "AgeRange", "GeoTargeting", "InterestTargeting", "TargetingConfig",
    "BudgetAllocation", "StrategyRecommendation",
    "CampaignCreate", "CampaignUpdate", "CampaignResponse",
    "AdCreate", "AdResponse",
    "PublishRequest", "PublishResponse",
    # Analytics
    "KPIMetrics", "DailyMetrics", "CreativePerformance",
    "PerformanceComparison", "AIInsight",
    "BudgetReallocationRequest", "BudgetReallocationResponse",
    "PerformanceDashboardResponse",
    "LearnFromPerformanceRequest", "LearnFromPerformanceResponse",
]
