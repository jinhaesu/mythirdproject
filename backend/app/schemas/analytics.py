"""Analytics and performance schemas."""
from datetime import datetime, date
from typing import Optional, List

from pydantic import BaseModel


class KPIMetrics(BaseModel):
    """Key performance indicators."""
    total_spend: float
    total_impressions: int
    total_clicks: int
    total_conversions: int
    total_revenue: float
    roas: float  # Return on ad spend
    ctr: float  # Click-through rate
    cpc: float  # Cost per click
    cpm: float  # Cost per mille
    conversion_rate: float


class DailyMetrics(BaseModel):
    """Daily performance metrics."""
    date: date
    spend: float
    impressions: int
    clicks: int
    conversions: int
    revenue: float
    ctr: float
    cpc: float
    roas: float


class CreativePerformance(BaseModel):
    """Performance metrics for individual creative."""
    creative_id: int
    creative_name: str
    creative_type: str
    thumbnail_url: Optional[str]
    spend: float
    impressions: int
    clicks: int
    conversions: int
    ctr: float
    conversion_rate: float
    roas: float
    is_winner: bool = False


class PerformanceComparison(BaseModel):
    """A/B test performance comparison."""
    winner: CreativePerformance
    loser: CreativePerformance
    performance_difference: float  # Percentage difference
    statistical_significance: float  # Confidence level
    recommendation: str


class AIInsight(BaseModel):
    """AI-generated insight."""
    insight_type: str  # performance, optimization, trend
    title: str
    description: str
    action_available: bool = False
    action_type: Optional[str] = None  # reallocate_budget, pause_ad, etc.
    action_params: Optional[dict] = None


class BudgetReallocationRequest(BaseModel):
    """Request to reallocate budget based on performance."""
    campaign_id: int
    pause_underperforming: bool = True
    reallocate_to_winner: bool = True


class BudgetReallocationResponse(BaseModel):
    """Response after budget reallocation."""
    success: bool
    changes_made: List[str]
    new_allocations: List[dict]
    estimated_improvement: float  # Percentage


class PerformanceDashboardResponse(BaseModel):
    """Full performance dashboard data."""
    period_start: date
    period_end: date
    kpi_summary: KPIMetrics
    daily_trend: List[DailyMetrics]
    creative_performance: List[CreativePerformance]
    comparison: Optional[PerformanceComparison] = None
    ai_insights: List[AIInsight] = []


class LearnFromPerformanceRequest(BaseModel):
    """Request to learn from successful campaign."""
    campaign_id: int
    apply_to_future: bool = True


class LearnFromPerformanceResponse(BaseModel):
    """Response with learned patterns."""
    winning_style: dict  # Style extraction from winning creative
    winning_targeting: dict  # Successful targeting params
    recommendations: List[str]
    applied: bool


class CampaignMetrics(BaseModel):
    """Detailed campaign metrics from Meta API."""
    campaign_id: str
    campaign_name: str
    status: str
    objective: str

    # Budget
    daily_budget: Optional[float] = None
    lifetime_budget: Optional[float] = None
    currency: str = "KRW"

    # Basic metrics
    impressions: int = 0
    clicks: int = 0
    spend: float = 0
    reach: int = 0

    # Cost metrics
    cpm: float = 0  # Cost per 1000 impressions
    cpc: float = 0  # Cost per click
    ctr: float = 0  # Click-through rate
    frequency: float = 0  # Average ad frequency

    # Conversion metrics
    website_purchase_conversions: int = 0
    website_purchase_value: float = 0  # Currency amount
    website_content_views: int = 0
    cost_per_result: float = 0  # Currency amount
    roas: float = 0  # Return on ad spend

    # Feedback
    active_ad_count: int = 0  # Number of active ads (for creative fatigue)


class PerformanceFeedback(BaseModel):
    """AI-generated performance feedback and analysis."""
    campaign_id: str
    campaign_name: str

    # Conversion Analysis
    conversion_analysis: dict  # ROAS trends, CPA analysis

    # Click Analysis
    click_analysis: dict  # CTR, CPC trends, landing rate

    # Impression Analysis
    impression_analysis: dict  # CPM, frequency, fatigue

    # Creative Analysis
    creative_analysis: dict  # Active ad count, diversity, trends

    # Recommendations
    recommendations: List[str]
    risk_level: str  # "LOW", "MEDIUM", "HIGH"
