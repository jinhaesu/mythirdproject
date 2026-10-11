"""인스타 계정 일일 스냅샷 — 팔로워·도달·게시물 수를 매일 축적해 월별 변화 분석.

Meta 인사이트 API는 팔로워 일별 증감을 최근 30일만 제공 → 자체 축적이 정본.
content_metrics 데일리 루프(03:10 KST)에서 함께 수집한다 (2026-10-11).
"""
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class IgAccountSnapshot(Base):
    __tablename__ = "ig_account_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    ig_account_id: Mapped[str] = mapped_column(String(64), index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    username: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    followers: Mapped[int] = mapped_column(Integer, default=0)
    follows: Mapped[int] = mapped_column(Integer, default=0)
    media_count: Mapped[int] = mapped_column(Integer, default=0)
    reach_day: Mapped[int] = mapped_column(Integer, default=0)  # 전일 도달 (period=day)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("ig_account_id", "date", name="uq_ig_account_snapshot"),)
