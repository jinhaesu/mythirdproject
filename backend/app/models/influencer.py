"""인플루언서 시딩 관리 모듈 모델 — 시딩 비용/대상 기록 + AI 타겟 고객층 분석."""
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class InfluencerSeeding(Base):
    """인플루언서 시딩 1건 (제품/현금 협찬) — 링크만 넣으면 AI가 타겟 고객층을 분석."""
    __tablename__ = "influencer_seedings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100))  # 인플루언서명/핸들
    channel: Mapped[str] = mapped_column(String(30), index=True)  # instagram|youtube|blog|tiktok|etc
    url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    follower_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    cost: Mapped[float] = mapped_column(Float, default=0)  # 시딩 비용 (제품+현금 합계, KRW)
    seeded_at: Mapped[date] = mapped_column(Date, index=True)  # 시딩 일자
    product: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)  # 시딩 제품
    notes: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    ai_target_segment: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)  # AI: 주요 타겟 요약
    ai_audience_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # AI: 상세 고객 분석
    ai_analyzed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
