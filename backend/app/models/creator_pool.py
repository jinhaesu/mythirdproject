"""크리에이터 풀 — 인스타 크리에이터 잠재풀·유상구좌 집행풀 관리.

business_discovery API로 공개 지표(팔로워·평균 좋아요/댓글·참여율)를 스냅샷하고,
상태(후보→컨택→협업중→완료/제외)와 유상 여부·단가를 관리한다.
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class CreatorPool(Base):
    __tablename__ = "creator_pool"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, index=True)  # @ 제외
    name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    followers: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    media_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    avg_likes: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # 최근 12개 평균
    avg_comments: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    engagement_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # %, (likes+comments)/followers
    biography: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    picture_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)  # 푸드|운동|육아|뷰티…
    status: Mapped[str] = mapped_column(String(20), default="candidate", index=True)
    # candidate(후보) | contacted(컨택중) | working(협업중) | done(완료) | excluded(제외)
    is_paid: Mapped[bool] = mapped_column(Boolean, default=False, index=True)  # 유상구좌 여부
    fee: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # 집행 단가(원)
    source: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)  # 발굴 경로(해시태그/추천/DM…)
    memo: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    last_checked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)  # 지표 스냅샷 시각
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
