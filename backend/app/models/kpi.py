"""마케팅 KPI 모듈 모델 — 몰 전체 주문 스냅샷, 채널별 월 광고비, 월간 목표."""
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, Float, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class MallOrder(Base):
    """카페24 몰 전체 주문 스냅샷 (어필리에이트 귀속 여부와 무관하게 전부 저장).

    웹훅이 최초 적립(source=webhook, 금액 모를 수 있음 → 0) →
    폴러/백필이 실금액/상태로 보강(source=poller/backfill).
    """
    __tablename__ = "mall_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    cafe24_order_id: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    order_date: Mapped[date] = mapped_column(Date, index=True)
    member_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)  # 비회원은 None
    amount: Mapped[float] = mapped_column(Float, default=0)  # 실결제 금액
    status: Mapped[str] = mapped_column(String(30), default="paid")  # paid | cancelled | refunded
    source: Mapped[str] = mapped_column(String(20), default="webhook")  # webhook | poller | backfill
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class MonthlyChannelSpend(Base):
    """채널별 월 예산(목표) / 실적(수동 입력). meta는 actual_amount=None이면 자동 계산값 사용."""
    __tablename__ = "monthly_channel_spends"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    month: Mapped[str] = mapped_column(String(7), index=True)  # "YYYY-MM"
    channel: Mapped[str] = mapped_column(String(30))  # meta | naver_sa | naver_gfa | kakao | google | etc
    planned_amount: Mapped[float] = mapped_column(Float, default=0)
    actual_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    memo: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)

    __table_args__ = (
        UniqueConstraint("month", "channel", name="uq_monthly_channel_spend_month_channel"),
    )


class MarketingGoal(Base):
    """월별 마케팅 KPI 목표."""
    __tablename__ = "marketing_goals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    month: Mapped[str] = mapped_column(String(7), unique=True, index=True)  # "YYYY-MM"
    target_cac: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    target_ltv: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    target_ltv_cac: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    target_conversion_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # %
    target_aov: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    target_new_customers: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    actual_conversion_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # 수동 입력
    memo: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
