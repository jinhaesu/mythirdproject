"""Market keyword model for keyword registration and monitoring."""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import String, DateTime, Text, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class MarketKeyword(Base):
    """Registered market keyword for monitoring."""

    __tablename__ = "market_keywords"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    keyword: Mapped[str] = mapped_column(String(255), nullable=False, index=True)

    # JSON fields stored as Text
    platform_data: Mapped[Optional[str]] = mapped_column(Text)  # JSON: youtube, instagram, naver metrics
    sentiment_data: Mapped[Optional[str]] = mapped_column(Text)  # JSON: positive/negative ratio, emotion keywords
    hashtags: Mapped[Optional[str]] = mapped_column(Text)  # JSON: list of related hashtags

    last_analyzed_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
