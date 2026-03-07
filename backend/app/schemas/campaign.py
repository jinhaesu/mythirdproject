"""Campaign and ads schemas."""
from datetime import datetime
from typing import Optional, List
from enum import Enum

from pydantic import BaseModel, Field


class CampaignObjective(str, Enum):
    """Campaign objective types."""
    TRAFFIC = "TRAFFIC"
    CONVERSIONS = "CONVERSIONS"
    LEAD_GENERATION = "LEAD_GENERATION"


class CampaignStatus(str, Enum):
    """Campaign status types."""
    DRAFT = "DRAFT"
    PENDING_REVIEW = "PENDING_REVIEW"
    ACTIVE = "ACTIVE"
    PAUSED = "PAUSED"
    COMPLETED = "COMPLETED"


class AgeRange(BaseModel):
    """Age range for targeting."""
    min_age: int = Field(default=18, ge=13, le=65)
    max_age: int = Field(default=65, ge=13, le=65)


class GeoTargeting(BaseModel):
    """Geographic targeting."""
    countries: List[str] = ["KR"]  # ISO country codes
    cities: Optional[List[str]] = None


class InterestTargeting(BaseModel):
    """Interest-based targeting."""
    interests: List[str] = []  # Meta interest IDs
    behaviors: Optional[List[str]] = None


class TargetingConfig(BaseModel):
    """Full targeting configuration."""
    age_range: AgeRange = AgeRange()
    genders: List[str] = ["all"]  # male, female, all
    geo: GeoTargeting = GeoTargeting()
    interests: InterestTargeting = InterestTargeting()
    custom_audiences: Optional[List[str]] = None
    lookalike_audiences: Optional[List[str]] = None


class BudgetAllocation(BaseModel):
    """Budget allocation recommendation."""
    creative_id: int
    creative_name: str
    allocation_percentage: float
    recommended_placement: str  # feed, story, reels


class StrategyRecommendation(BaseModel):
    """AI-generated strategy recommendation."""
    total_budget: float
    recommended_duration_days: int
    allocations: List[BudgetAllocation]
    target_audience_summary: str
    expected_reach: int
    expected_ctr: float
    reasoning: str


class CampaignCreate(BaseModel):
    """Schema for creating campaign."""
    name: str
    objective: CampaignObjective
    total_budget: float = Field(..., gt=0)
    daily_budget: Optional[float] = None
    targeting: Optional[TargetingConfig] = None
    creative_ids: List[int] = Field(default=[])
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None


class CampaignUpdate(BaseModel):
    """Schema for updating campaign."""
    name: Optional[str] = None
    total_budget: Optional[float] = None
    daily_budget: Optional[float] = None
    targeting: Optional[TargetingConfig] = None
    status: Optional[CampaignStatus] = None


class AdCreate(BaseModel):
    """Schema for creating ad within campaign."""
    creative_id: int
    name: str
    budget_percentage: float = Field(default=100.0, ge=0, le=100)


class AdResponse(BaseModel):
    """Response schema for ad."""
    id: int
    campaign_id: int
    creative_id: int
    name: str
    status: str
    budget_percentage: float
    meta_ad_id: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class CampaignResponse(BaseModel):
    """Response schema for campaign."""
    id: int
    user_id: int
    name: str
    objective: CampaignObjective
    status: CampaignStatus
    total_budget: float
    daily_budget: Optional[float]
    spent_amount: float
    targeting: Optional[TargetingConfig]
    meta_campaign_id: Optional[str]
    start_date: Optional[datetime]
    end_date: Optional[datetime]
    ads: List[AdResponse] = []
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class PublishRequest(BaseModel):
    """Request to publish campaign to Meta."""
    campaign_id: int


class PublishResponse(BaseModel):
    """Response from publishing to Meta."""
    success: bool
    meta_campaign_id: Optional[str]
    meta_adset_id: Optional[str]
    status: str
    message: str
