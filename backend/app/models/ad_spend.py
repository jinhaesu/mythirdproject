"""광고비 일보 — 매체 단위 일별 광고비 기입/예산 관리.

원본: 구글시트 "26년 N월 영업 광고비 일보_관리" — 행=매체(메타 광고,
토스 쿠폰광고, 파워링크, 데이터라이즈, GFA…), 열=일별 금액 + 월 Limit·
사용율·사업계획. 금액은 원 단위 저장(VAT 포함 — 시트 관행 유지).
meta/naver_sa처럼 자동 수집 가능한 매체는 auto_source로 연동한다.
"""
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, Float, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class AdMedia(Base):
    """광고 매체(집행처) 마스터 — 일보의 행."""
    __tablename__ = "ad_media"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200))  # 예: "자사몰 토스 쿠폰광고"
    group_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)  # 메타|네이버|CRM|카카오|고정광고…
    inflow: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)  # 유입: 자사몰|네이버스토어|토스…
    auto_source: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # meta|naver_sa → 일별 자동 채움
    owner: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # 판매 담당자 (10월 포맷 축)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    memo: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AdMediaBudget(Base):
    """매체×월 예산 — Limit(한도)·사업계획 금액."""
    __tablename__ = "ad_media_budgets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    media_id: Mapped[int] = mapped_column(Integer, index=True)
    month: Mapped[str] = mapped_column(String(7), index=True)  # "YYYY-MM"
    limit_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    plan_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # 사업계획

    __table_args__ = (UniqueConstraint("media_id", "month", name="uq_ad_media_budget"),)


class ChannelRevenue(Base):
    """유입채널(inflow)×월 매출 기입 — ROAS 분석용.

    광고비는 일보(ad_media_spend_daily)에서 자동 합산되므로 매출만 기입하면
    채널 ROAS가 계산된다. 자사몰은 mall_orders에서 자동 집계(기입 불필요).
    """
    __tablename__ = "channel_revenues"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    month: Mapped[str] = mapped_column(String(7), index=True)  # "YYYY-MM"
    inflow: Mapped[str] = mapped_column(String(100), index=True)  # ad_media.inflow와 동일 축
    revenue: Mapped[float] = mapped_column(Float, default=0)
    memo: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)

    __table_args__ = (UniqueConstraint("month", "inflow", name="uq_channel_revenue_month_inflow"),)


class AdMediaSpendDaily(Base):
    """매체×일 광고비 (수동 기입; auto_source 매체는 조회 시 자동 계산)."""
    __tablename__ = "ad_media_spend_daily"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    media_id: Mapped[int] = mapped_column(Integer, index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    amount: Mapped[float] = mapped_column(Float, default=0)

    __table_args__ = (UniqueConstraint("media_id", "date", name="uq_ad_media_spend_daily"),)
