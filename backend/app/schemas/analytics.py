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
