"""마케팅 KPI 모듈 모델 — 몰 전체 주문 스냅샷, 채널별 월 광고비, 월간 목표."""
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, Float, Integer, String, UniqueConstraint
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
    """채널별 월 예산(목표) / 실적(수동 입력). meta는 actual_amount=None이면 자동 계산값 사용.

    scope: "mall"(자사몰 카페24로 연결되는 채널) | "external"(그 외 — naver_sa 등
    자사몰로 연결되지 않는 채널). (month, channel, scope) 유니크.
    """
    __tablename__ = "monthly_channel_spends"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    month: Mapped[str] = mapped_column(String(7), index=True)  # "YYYY-MM"
    channel: Mapped[str] = mapped_column(String(30))  # meta | naver_sa | naver_gfa | kakao | google | etc
    scope: Mapped[str] = mapped_column(String(20), default="mall", server_default="mall", index=True)  # mall | external
    planned_amount: Mapped[float] = mapped_column(Float, default=0)
    actual_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    memo: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    revenue_linked: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")  # 매출 관여 여부
    revenue: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # 관여 시 해당 채널 매출
    channel_label: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)  # channel='etc'일 때 표시명

    __table_args__ = (
        UniqueConstraint("month", "channel", "scope", name="uq_monthly_channel_spend_month_channel_scope"),
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


class ExternalMarketingGoal(Base):
    """월별 '그 외(외부)' 마케팅 KPI 목표 — 자사몰로 연결되지 않는 채널(네이버 검색광고 등)
    광고비 목표 + 어필리에이트 공동구매 등 매출 목표/수동 보정."""
    __tablename__ = "external_marketing_goals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    month: Mapped[str] = mapped_column(String(7), unique=True, index=True)  # "YYYY-MM"
    target_spend: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # 광고비 목표
    target_revenue: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # 공동구매 등 매출 목표
    actual_revenue_manual: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # 자동 집계 외 판매채널 매출 수동 보정
    memo: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)


class ChannelSpendDaily(Base):
    """채널별 일별 광고비 자동 수집 스냅샷 (네이버 검색광고 등). 월 합산은 kpi.py에서 계산."""
    __tablename__ = "channel_spend_daily"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    channel: Mapped[str] = mapped_column(String(30))  # naver_sa | naver_gfa | kakao | google | etc
    spend: Mapped[float] = mapped_column(Float, default=0)

    __table_args__ = (
        UniqueConstraint("date", "channel", name="uq_channel_spend_daily_date_channel"),
    )


class MallVisitorsDaily(Base):
    """카페24 Analytics API 일별 방문자수 자동 수집 스냅샷."""
    __tablename__ = "mall_visitors_daily"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    date: Mapped[date] = mapped_column(Date, unique=True, index=True)
    visit_count: Mapped[int] = mapped_column(Integer, default=0)
    first_visit_count: Mapped[int] = mapped_column(Integer, default=0)
    re_visit_count: Mapped[int] = mapped_column(Integer, default=0)
