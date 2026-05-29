"""Creative content models."""
from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy import String, DateTime, Text, Integer, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class CreativeType(str, Enum):
    """Type of creative content."""
    IMAGE = "IMAGE"
    VIDEO = "VIDEO"
    CAROUSEL = "CAROUSEL"


class CreativeFormat(str, Enum):
    """Format/aspect ratio of creative."""
    SQUARE = "1:1"  # Feed
    PORTRAIT = "4:5"  # Feed optimized
    STORY = "9:16"  # Stories/Reels
    LANDSCAPE = "16:9"  # Video


class Creative(Base):
    """AI-generated creative content model."""

    __tablename__ = "creatives"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    creative_type: Mapped[CreativeType] = mapped_column(
        SQLEnum(CreativeType), nullable=False
    )
    format: Mapped[CreativeFormat] = mapped_column(
        SQLEnum(CreativeFormat), nullable=False
    )

    # Content
    file_url: Mapped[Optional[str]] = mapped_column(Text)  # S3/storage URL
    thumbnail_url: Mapped[Optional[str]] = mapped_column(Text)
    width: Mapped[Optional[int]] = mapped_column(Integer)
    height: Mapped[Optional[int]] = mapped_column(Integer)
    headline: Mapped[Optional[str]] = mapped_column(String(255))
    primary_text: Mapped[Optional[str]] = mapped_column(Text)
    call_to_action: Mapped[Optional[str]] = mapped_column(String(50))

    # AI Generation metadata
    prompt_used: Mapped[Optional[str]] = mapped_column(Text)
    style_reference: Mapped[Optional[str]] = mapped_column(Text)  # JSON: extracted style
    generation_model: Mapped[Optional[str]] = mapped_column(String(100))

    # Performance tracking
    benchmark_id: Mapped[Optional[int]] = mapped_column(ForeignKey("benchmarks.id"))

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    # Relationships
    user = relationship("User", back_populates="creatives")
    benchmark = relationship("Benchmark", back_populates="creatives")
    ads = relationship("Ad", back_populates="creative")
