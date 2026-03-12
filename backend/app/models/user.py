"""User model."""
from datetime import datetime
from typing import Optional

from sqlalchemy import String, Boolean, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class User(Base):
    """User account model."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    full_name: Mapped[Optional[str]] = mapped_column(String(255))
    company_name: Mapped[Optional[str]] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_superuser: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    # Meta account connection
    meta_access_token: Mapped[Optional[str]] = mapped_column(Text)
    meta_user_id: Mapped[Optional[str]] = mapped_column(String(255))
    meta_ad_account_id: Mapped[Optional[str]] = mapped_column(String(255))
    meta_ig_account_id: Mapped[Optional[str]] = mapped_column(String(255))
    meta_page_id: Mapped[Optional[str]] = mapped_column(String(255))  # Facebook Page ID
    meta_pixel_id: Mapped[Optional[str]] = mapped_column(String(255))  # Meta Conversion Pixel ID
    meta_dataset_id: Mapped[Optional[str]] = mapped_column(String(255))  # Default dataset ID (Cafe24, Smart Store, etc.)
    default_currency: Mapped[str] = mapped_column(String(10), default="KRW")  # Default currency

    # Naver advertising connections
    naver_search_ads_connected: Mapped[bool] = mapped_column(Boolean, default=False)
    naver_gfa_connected: Mapped[bool] = mapped_column(Boolean, default=False)
    naver_ads_customer_id: Mapped[Optional[str]] = mapped_column(String(255))

    # Brand settings (JSON stored as text for simplicity)
    brand_settings: Mapped[Optional[str]] = mapped_column(Text)  # JSON: logo, colors, etc.

    # Relationships
    campaigns = relationship("Campaign", back_populates="user")
    creatives = relationship("Creative", back_populates="user")
    benchmarks = relationship("Benchmark", back_populates="user")
    platform_connections = relationship("PlatformConnection", back_populates="user")
    reports = relationship("Report", back_populates="user")
    ai_insights = relationship("AIInsightLog", back_populates="user")
