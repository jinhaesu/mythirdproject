"""Benchmark and market intelligence schemas."""
from datetime import datetime
from typing import Optional, List
from enum import Enum

from pydantic import BaseModel, Field


class FilterPeriod(str, Enum):
    """Time period filter options."""
    LAST_7_DAYS = "7d"
    LAST_30_DAYS = "30d"
    LAST_90_DAYS = "90d"


class SortOption(str, Enum):
    """Sort options for content."""
    POPULAR = "popular"
    RECENT = "recent"
    MOST_COMMENTS = "most_comments"


class BenchmarkQuery(BaseModel):
    """Query for benchmark analysis."""
    query: str = Field(..., description="@account, #hashtag, or URL to analyze")
    period: FilterPeriod = FilterPeriod.LAST_30_DAYS
    sort_by: SortOption = SortOption.POPULAR
    limit: int = Field(default=20, le=100)


class PostMetrics(BaseModel):
    """Metrics for a single post."""
    likes: int = 0
    comments: int = 0
    shares: int = 0
    estimated_reach: int = 0
    engagement_rate: float = 0.0


class CollectedPostResponse(BaseModel):
    """Response schema for collected posts."""
    id: int
    post_id: str
    post_url: Optional[str]
    media_url: Optional[str]
    media_type: str
    caption: Optional[str]
    hashtags: List[str] = []
    metrics: PostMetrics
    posted_at: Optional[datetime]
    visual_style: Optional[dict] = None

    class Config:
        from_attributes = True


class SentimentKeyword(BaseModel):
    """Keyword with sentiment score."""
    keyword: str
    count: int
    sentiment: str  # positive, negative, neutral


class SentimentAnalysis(BaseModel):
    """Sentiment analysis results."""
    overall_sentiment: str
    positive_keywords: List[SentimentKeyword]
    negative_keywords: List[SentimentKeyword]
    word_cloud_data: List[dict]  # {word, weight, sentiment}


class StyleExtraction(BaseModel):
    """Extracted style from content."""
    visual_style: str  # minimalist, vibrant, dark, etc.
    color_palette: List[str]  # Hex colors
    composition: str  # centered, rule-of-thirds, etc.
    text_overlay: bool
    tone_and_manner: str  # humorous, serious, emotional, etc.
    appeal_type: str  # rational, emotional, social-proof
    key_elements: List[str]


class AISummaryResponse(BaseModel):
    """AI-generated summary of benchmark analysis."""
    summary: str
    key_insights: List[str]
    recommendations: List[str]
    trending_topics: List[str]


class BenchmarkResponse(BaseModel):
    """Full benchmark analysis response."""
    id: int
    query: str
    benchmark_type: str
    total_posts_analyzed: int
    avg_engagement_rate: float
    posts: List[CollectedPostResponse]
    ai_summary: Optional[AISummaryResponse] = None
    sentiment_analysis: Optional[SentimentAnalysis] = None
    style_extraction: Optional[StyleExtraction] = None
    data_source: str = "ai"  # "meta_api" or "ai"
    ai_report: Optional[MarketIntelligenceReport] = None
    created_at: datetime

    class Config:
        from_attributes = True


class ContentTrend(BaseModel):
    """A single content trend."""
    topic: str
    description: str
    engagement_level: str  # high, medium, low
    examples: List[str] = []


class HashtagGroup(BaseModel):
    """A group of related hashtags."""
    theme: str
    hashtags: List[str]
    avg_engagement: float = 0.0
    recommendation: str = ""


class ContentPillar(BaseModel):
    """A content pillar recommendation."""
    pillar_name: str
    description: str
    content_ratio: int  # percentage
    example_topics: List[str] = []


class MarketIntelligenceReport(BaseModel):
    """AI-generated market intelligence report (for non-Meta-connected users)."""
    market_overview: str
    content_trends: List[ContentTrend] = []
    hashtag_groups: List[HashtagGroup] = []
    content_pillars: List[ContentPillar] = []
    competitor_insights: List[str] = []
    recommendations: List[str] = []


class StyleExtractionRequest(BaseModel):
    """Request to extract style from URL."""
    url: str = Field(..., description="URL of content to analyze")


class StyleExtractionResponse(BaseModel):
    """Response with extracted style."""
    style: StyleExtraction
    prompt_template: str  # Ready-to-use prompt for generation
    preview_description: str
