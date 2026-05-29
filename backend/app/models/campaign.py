"""Campaign and ads models."""
from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy import String, Boolean, DateTime, Text, Integer, Float, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class CampaignObjective(str, Enum):
    """Campaign objective types."""
    TRAFFIC = "TRAFFIC"
    CONVERSIONS = "CONVERSIONS"
    PURCHASE = "PURCHASE"
    LEAD_GENERATION = "LEAD_GENERATION"
    AWARENESS = "AWARENESS"
    ENGAGEMENT = "ENGAGEMENT"
    APP_PROMOTION = "APP_PROMOTION"


class CampaignStatus(str, Enum):
    """Campaign status types."""
    DRAFT = "DRAFT"
    PENDING_REVIEW = "PENDING_REVIEW"
    ACTIVE = "ACTIVE"
    PAUSED = "PAUSED"
    COMPLETED = "COMPLETED"
    REJECTED = "REJECTED"


class Campaign(Base):
    """Meta advertising campaign model."""

    __tablename__ = "campaigns"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    objective: Mapped[CampaignObjective] = mapped_column(
        SQLEnum(CampaignObjective), nullable=False
    )
    status: Mapped[CampaignStatus] = mapped_column(
        SQLEnum(CampaignStatus), default=CampaignStatus.DRAFT
    )

    # Budget settings
    total_budget: Mapped[float] = mapped_column(Float, default=0.0)
    daily_budget: Mapped[Optional[float]] = mapped_column(Float)
    spent_amount: Mapped[float] = mapped_column(Float, default=0.0)
    budget_type: Mapped[str] = mapped_column(String(20), default="DAILY")  # "DAILY" or "LIFETIME"
    currency: Mapped[str] = mapped_column(String(10), default="KRW")  # "KRW" or "USD"

    # Targeting (JSON stored as text)
    targeting: Mapped[Optional[str]] = mapped_column(Text)  # JSON: age, gender, interests
    targeting_segments: Mapped[Optional[str]] = mapped_column(Text)  # JSON array of targeting segments from planner

    # Meta integration
    meta_campaign_id: Mapped[Optional[str]] = mapped_column(String(255))
    meta_adset_id: Mapped[Optional[str]] = mapped_column(String(255))
    meta_adset_ids: Mapped[Optional[str]] = mapped_column(Text)  # JSON array of adset IDs
    advantage_plus: Mapped[bool] = mapped_column(Boolean, default=False)  # Whether Advantage+ is enabled

    # Dataset/Pixel
    dataset_id: Mapped[Optional[str]] = mapped_column(String(255))  # Custom dataset ID (e.g., Cafe24 pixel)
    pixel_id: Mapped[Optional[str]] = mapped_column(String(255))  # Custom pixel ID override

    # Schedule
    start_date: Mapped[Optional[datetime]] = mapped_column(DateTime)
    end_date: Mapped[Optional[datetime]] = mapped_column(DateTime)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    # Relationships
    user = relationship("User", back_populates="campaigns")
    ads = relationship("Ad", back_populates="campaign")
    performance_data = relationship("CampaignPerformance", back_populates="campaign")


class Ad(Base):
    """Individual ad within a campaign."""

    __tablename__ = "ads"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("campaigns.id"), nullable=False)
    creative_id: Mapped[int] = mapped_column(ForeignKey("creatives.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="PENDING")

    # Meta integration
    meta_ad_id: Mapped[Optional[str]] = mapped_column(String(255))
    meta_creative_id: Mapped[Optional[str]] = mapped_column(String(255))

    # Budget allocation
    budget_percentage: Mapped[float] = mapped_column(Float, default=100.0)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    campaign = relationship("Campaign", back_populates="ads")
    creative = relationship("Creative", back_populates="ads")


class CampaignPerformance(Base):
    """Campaign performance metrics (daily snapshots)."""

    __tablename__ = "campaign_performance"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("campaigns.id"), nullable=False)
    date: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    # Key metrics
    impressions: Mapped[int] = mapped_column(Integer, default=0)
    clicks: Mapped[int] = mapped_column(Integer, default=0)
    spend: Mapped[float] = mapped_column(Float, default=0.0)
    conversions: Mapped[int] = mapped_column(Integer, default=0)
    revenue: Mapped[float] = mapped_column(Float, default=0.0)

    # Calculated metrics
    ctr: Mapped[float] = mapped_column(Float, default=0.0)  # Click-through rate
    cpc: Mapped[float] = mapped_column(Float, default=0.0)  # Cost per click
    cpm: Mapped[float] = mapped_column(Float, default=0.0)  # Cost per mille
    roas: Mapped[float] = mapped_column(Float, default=0.0)  # Return on ad spend

    # Relationships
    campaign = relationship("Campaign", back_populates="performance_data")
