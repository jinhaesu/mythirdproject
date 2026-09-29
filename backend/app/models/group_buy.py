"""공구(그룹 구매 행사) 보드 — 여러 어필리에이트 캠페인(대학별 등)을 하나의
행사로 묶어 일정·목표를 기입하고 실적을 자동 합산한다.

예: "2026 9월 총학생회 연합 공구" = 부경대/선문대/… 캠페인 40여 개의 묶음.
기존 affiliate_campaigns 테이블은 건드리지 않고 매핑 테이블로 연결한다
(startup create_all은 기존 테이블을 ALTER 하지 않으므로).
"""
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, Float, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class GroupBuy(Base):
    __tablename__ = "group_buys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="planned", index=True)  # planned|active|done
    start_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    end_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    target_revenue: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # 확정 매출 목표 (KRW)
    memo: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class GroupBuyCampaign(Base):
    """공구 ↔ 어필리에이트 캠페인 매핑."""
    __tablename__ = "group_buy_campaigns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    group_buy_id: Mapped[int] = mapped_column(Integer, index=True)
    campaign_id: Mapped[int] = mapped_column(Integer, index=True)

    __table_args__ = (
        UniqueConstraint("group_buy_id", "campaign_id", name="uq_group_buy_campaign"),
    )
