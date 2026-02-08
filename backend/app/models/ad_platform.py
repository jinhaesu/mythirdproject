"""Ad Platform connection and revenue data models."""
from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Text, ForeignKey, Date, JSON
from sqlalchemy.orm import relationship

from app.db.database import Base


class AdPlatform(str, Enum):
    """Supported advertising platforms."""
    META = "META"
    GOOGLE = "GOOGLE"
    NAVER = "NAVER"
    KAKAO = "KAKAO"


class PlatformConnection(Base):
    """User's connected ad platform accounts."""
    __tablename__ = "platform_connections"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    platform = Column(String(20), nullable=False)  # META, GOOGLE, NAVER, KAKAO
    account_id = Column(String(255), nullable=False)
    account_name = Column(String(255))
    access_token = Column(Text)
    refresh_token = Column(Text)
    token_expires_at = Column(DateTime)
    is_active = Column(Boolean, default=True)
    last_sync_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="platform_connections")
    revenue_data = relationship("RevenueData", back_populates="platform_connection")


class RevenueData(Base):
    """Daily revenue and performance data from ad platforms."""
    __tablename__ = "revenue_data"

    id = Column(Integer, primary_key=True, index=True)
    platform_connection_id = Column(Integer, ForeignKey("platform_connections.id"), nullable=False)
    date = Column(Date, nullable=False)

    # Common metrics across platforms
    impressions = Column(Integer, default=0)
    clicks = Column(Integer, default=0)
    spend = Column(Float, default=0.0)  # 광고비
    revenue = Column(Float, default=0.0)  # 매출
    conversions = Column(Integer, default=0)

    # Calculated metrics
    ctr = Column(Float, default=0.0)  # Click-through rate
    cpc = Column(Float, default=0.0)  # Cost per click
    cpm = Column(Float, default=0.0)  # Cost per mille
    roas = Column(Float, default=0.0)  # Return on ad spend
    conversion_rate = Column(Float, default=0.0)

    # Platform-specific data stored as JSON
    platform_data = Column(JSON)

    # Campaign breakdown
    campaign_id = Column(String(255))
    campaign_name = Column(String(255))

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    platform_connection = relationship("PlatformConnection", back_populates="revenue_data")


class Report(Base):
    """Generated reports (daily, weekly, monthly)."""
    __tablename__ = "reports"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    report_type = Column(String(20), nullable=False)  # DAILY, WEEKLY, MONTHLY
    title = Column(String(255), nullable=False)
    period_start = Column(Date, nullable=False)
    period_end = Column(Date, nullable=False)

    # Report content
    summary = Column(Text)  # AI-generated summary
    kpi_data = Column(JSON)  # KPI metrics
    insights = Column(JSON)  # AI insights
    recommendations = Column(JSON)  # AI recommendations

    # File export
    pdf_url = Column(Text)
    excel_url = Column(Text)

    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="reports")


class AIInsightLog(Base):
    """Log of AI-generated insights and actions taken."""
    __tablename__ = "ai_insight_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    insight_type = Column(String(50), nullable=False)  # TREND, ANOMALY, RECOMMENDATION, ALERT
    title = Column(String(255), nullable=False)
    description = Column(Text)
    severity = Column(String(20))  # INFO, WARNING, CRITICAL

    # Related data
    platform = Column(String(20))
    campaign_id = Column(String(255))
    metric_name = Column(String(100))
    metric_value = Column(Float)
    metric_change = Column(Float)  # Percentage change

    # Action
    action_type = Column(String(50))  # BUDGET_ADJUST, PAUSE_CAMPAIGN, etc.
    action_params = Column(JSON)
    action_taken = Column(Boolean, default=False)
    action_taken_at = Column(DateTime)

    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="ai_insights")
