"""Ad Platform schemas for request/response validation."""
from datetime import date, datetime
from typing import Optional, List, Dict, Any
from enum import Enum

from pydantic import BaseModel, Field


class AdPlatform(str, Enum):
    """Supported advertising platforms."""
    META = "META"
    GOOGLE = "GOOGLE"
    NAVER = "NAVER"
    KAKAO = "KAKAO"


class ReportType(str, Enum):
    """Report period types."""
    DAILY = "DAILY"
    WEEKLY = "WEEKLY"
    MONTHLY = "MONTHLY"


# Platform Connection Schemas
class PlatformConnectionBase(BaseModel):
    """Base platform connection schema."""
    platform: AdPlatform
    account_id: str
    account_name: Optional[str] = None


class PlatformConnectionCreate(BaseModel):
    """Request to connect a new ad platform."""
    platform: AdPlatform
    auth_code: Optional[str] = None  # OAuth authorization code
    access_token: Optional[str] = None  # Direct token (for testing)
    account_id: Optional[str] = None


class PlatformConnectionResponse(PlatformConnectionBase):
    """Platform connection response."""
    id: int
    is_active: bool
    last_sync_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


# Revenue Data Schemas
class RevenueDataBase(BaseModel):
    """Base revenue data schema."""
    date: date
    impressions: int = 0
    clicks: int = 0
    spend: float = 0.0
    revenue: float = 0.0
    conversions: int = 0
    ctr: float = 0.0
    cpc: float = 0.0
    roas: float = 0.0


class RevenueDataResponse(RevenueDataBase):
    """Revenue data response with platform info."""
    id: int
    platform: AdPlatform
    campaign_id: Optional[str] = None
    campaign_name: Optional[str] = None

    class Config:
        from_attributes = True


class RevenueSummary(BaseModel):
    """Aggregated revenue summary across platforms."""
    period_start: date
    period_end: date
    total_spend: float
    total_revenue: float
    total_impressions: int
    total_clicks: int
    total_conversions: int
    overall_roas: float
    overall_ctr: float
    overall_cpc: float

    # By platform breakdown
    by_platform: Dict[str, Dict[str, float]]


# Dashboard Schemas
class KPICard(BaseModel):
    """Single KPI card for dashboard."""
    title: str
    value: float
    unit: str  # "원", "%", "회" etc.
    change: float  # Percentage change from previous period
    change_direction: str  # "up", "down", "neutral"
    trend_data: List[float] = []  # Last 7 days for sparkline


class PlatformPerformance(BaseModel):
    """Performance data for a single platform."""
    platform: AdPlatform
    spend: float
    revenue: float
    roas: float
    impressions: int
    clicks: int
    conversions: int
    ctr: float
    change_from_previous: float  # Percentage


class DashboardResponse(BaseModel):
    """Full dashboard data response."""
    period_start: date
    period_end: date
    kpi_cards: List[KPICard]
    platform_performance: List[PlatformPerformance]
    daily_trend: List[Dict[str, Any]]  # Date -> metrics
    top_campaigns: List[Dict[str, Any]]
    ai_insights: List[Dict[str, Any]]


# AI Insight Schemas
class AIInsightType(str, Enum):
    """Types of AI insights."""
    TREND = "TREND"
    ANOMALY = "ANOMALY"
    RECOMMENDATION = "RECOMMENDATION"
    ALERT = "ALERT"


class AIInsight(BaseModel):
    """AI-generated insight."""
    insight_type: AIInsightType
    title: str
    description: str
    severity: str = "INFO"  # INFO, WARNING, CRITICAL
    platform: Optional[AdPlatform] = None
    metric_name: Optional[str] = None
    metric_value: Optional[float] = None
    metric_change: Optional[float] = None
    action_type: Optional[str] = None
    action_params: Optional[Dict[str, Any]] = None


class AIAnalysisRequest(BaseModel):
    """Request for AI analysis."""
    period_days: int = 7
    platforms: Optional[List[AdPlatform]] = None
    focus_area: Optional[str] = None  # "spend", "revenue", "roas", etc.


class AIAnalysisResponse(BaseModel):
    """AI analysis response."""
    summary: str
    insights: List[AIInsight]
    recommendations: List[str]
    predicted_trends: Dict[str, Any]


# Report Schemas
class ReportCreate(BaseModel):
    """Request to generate a report."""
    report_type: ReportType
    period_start: date
    period_end: date
    platforms: Optional[List[AdPlatform]] = None
    include_ai_insights: bool = True


class ReportResponse(BaseModel):
    """Generated report response."""
    id: int
    report_type: ReportType
    title: str
    period_start: date
    period_end: date
    summary: str
    kpi_data: Dict[str, Any]
    insights: List[Dict[str, Any]]
    recommendations: List[str]
    pdf_url: Optional[str] = None
    excel_url: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


# Data Sync Schemas
class SyncRequest(BaseModel):
    """Request to sync data from platforms."""
    platform_ids: Optional[List[int]] = None  # None = sync all
    date_from: Optional[date] = None
    date_to: Optional[date] = None


class SyncStatus(BaseModel):
    """Sync operation status."""
    platform_id: int
    platform: AdPlatform
    status: str  # "pending", "syncing", "completed", "failed"
    last_sync_at: Optional[datetime] = None
    records_synced: int = 0
    error_message: Optional[str] = None
