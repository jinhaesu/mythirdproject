"""Benchmark and market intelligence models."""
from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy import String, DateTime, Text, Integer, Float, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class BenchmarkType(str, Enum):
    """Type of benchmark analysis."""
    COMPETITOR_ACCOUNT = "COMPETITOR_ACCOUNT"
    HASHTAG_RESEARCH = "HASHTAG_RESEARCH"
    URL_ANALYSIS = "URL_ANALYSIS"


class Benchmark(Base):
    """Market intelligence and benchmark analysis model."""

    __tablename__ = "benchmarks"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    benchmark_type: Mapped[BenchmarkType] = mapped_column(
        SQLEnum(BenchmarkType), nullable=False
    )
    query: Mapped[str] = mapped_column(String(500), nullable=False)  # @account or #hashtag or URL

    # Analysis results (JSON stored as text)
    analysis_summary: Mapped[Optional[str]] = mapped_column(Text)  # AI-generated summary
    style_extraction: Mapped[Optional[str]] = mapped_column(Text)  # JSON: visual style, tone
    sentiment_analysis: Mapped[Optional[str]] = mapped_column(Text)  # JSON: positive/negative keywords
    trending_topics: Mapped[Optional[str]] = mapped_column(Text)  # JSON: trending themes

    # Metrics
    total_posts_analyzed: Mapped[int] = mapped_column(Integer, default=0)
    avg_engagement_rate: Mapped[float] = mapped_column(Float, default=0.0)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime)  # Cache expiry

    # Relationships
    user = relationship("User", back_populates="benchmarks")
    collected_posts = relationship("CollectedPost", back_populates="benchmark")
    creatives = relationship("Creative", back_populates="benchmark")


class CollectedPost(Base):
    """Individual posts collected during benchmark analysis."""

    __tablename__ = "collected_posts"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    benchmark_id: Mapped[int] = mapped_column(ForeignKey("benchmarks.id"), nullable=False)

    # Post metadata
    platform: Mapped[str] = mapped_column(String(50), default="instagram")
    post_id: Mapped[str] = mapped_column(String(255))
    post_url: Mapped[Optional[str]] = mapped_column(Text)
    media_url: Mapped[Optional[str]] = mapped_column(Text)
    media_type: Mapped[str] = mapped_column(String(50))  # IMAGE, VIDEO, CAROUSEL

    # Content
    caption: Mapped[Optional[str]] = mapped_column(Text)
    hashtags: Mapped[Optional[str]] = mapped_column(Text)  # JSON array

    # Engagement metrics
    likes: Mapped[int] = mapped_column(Integer, default=0)
    comments: Mapped[int] = mapped_column(Integer, default=0)
    shares: Mapped[int] = mapped_column(Integer, default=0)
    estimated_reach: Mapped[int] = mapped_column(Integer, default=0)

    # Analysis
    visual_style: Mapped[Optional[str]] = mapped_column(Text)  # JSON: AI-analyzed style
    sentiment_score: Mapped[float] = mapped_column(Float, default=0.0)

    # Timestamps
    posted_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    collected_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    benchmark = relationship("Benchmark", back_populates="collected_posts")
