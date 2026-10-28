"""회원 최저가 쿠폰(bestprice) 테이블. create_all로 생성(기존 테이블은 건드리지 않음)."""
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Float, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class BestpriceRun(Base):
    """배치 1회 실행 기록 + 요약(JSON)."""
    __tablename__ = "bestprice_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    month: Mapped[str] = mapped_column(String(7), index=True)          # YYYY-MM
    mode: Mapped[str] = mapped_column(String(10), default="dry")       # dry | live
    status: Mapped[str] = mapped_column(String(20), default="running")  # running | done | error
    summary_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class BestpriceCoupon(Base):
    """월·구간별 카페24 쿠폰 1개."""
    __tablename__ = "bestprice_coupons"
    __table_args__ = (UniqueConstraint("month", "tier", "mode", name="uq_bestprice_coupon_month_tier_mode"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    month: Mapped[str] = mapped_column(String(7), index=True)
    tier: Mapped[str] = mapped_column(String(20))
    mode: Mapped[str] = mapped_column(String(10), default="dry")
    amount: Mapped[int] = mapped_column(Integer)
    coupon_name: Mapped[str] = mapped_column(String(100))
    coupon_no: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)  # dry면 None
    issue_max_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="planned")  # planned | active | paused
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    paused_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class BestpriceAssignment(Base):
    """회원별 배정. live는 (month, member_id) 1건 = 회원당 월 1장 보장. dry 행은 실행마다 교체."""
    __tablename__ = "bestprice_assignments"
    __table_args__ = (UniqueConstraint("month", "member_id", "mode", name="uq_bestprice_assign_month_member_mode"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    month: Mapped[str] = mapped_column(String(7), index=True)
    member_id: Mapped[str] = mapped_column(String(100), index=True)
    mode: Mapped[str] = mapped_column(String(10), default="dry")
    tier: Mapped[str] = mapped_column(String(20))
    amount: Mapped[int] = mapped_column(Integer)
    expected_cost: Mapped[float] = mapped_column(Float, default=0)   # 사용률×안전계수×금액
    coupon_no: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="planned")  # planned | issued | failed | revoked
    run_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    error: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    issued_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class BestpriceRedemption(Base):
    """주문별 실사용 확인 결과(주문 1건 1행 — 0원이어도 기록해 재조회 안 함)."""
    __tablename__ = "bestprice_redemptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    order_id: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    month: Mapped[str] = mapped_column(String(7), index=True)
    member_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    coupon_no: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    amount: Mapped[float] = mapped_column(Float, default=0)
    checked_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

