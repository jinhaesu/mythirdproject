"""데이터라이즈(CRM) 구글시트 연동분 — 매일 시트에서 다시 읽어 날짜 단위로 교체 저장 (2026-11-03 마케팅 연다은 건의).

시트 "[Datarize] 널담몰(11846) 데이터 연동"은 데이터라이즈가 매일 오전 9시에 갱신한다.
시트 탭은 최근 N일만 담는 경우가 많아(메시지 캠페인 통계 ≈ 90일, 세그먼트 ≈ 30일) DB에 쌓아 두면
시트보다 긴 기간 추이를 볼 수 있다. 같은 날짜는 새로 읽은 시트 값이 통째로 대체한다(늦게 들어온
기여 구매 반영). 회원·주문 단위 탭(캠페인별 구매 정보 등)은 가져오지 않는다 — 집계 탭만.
"""
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, Float, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class DatarizeMessageDaily(Base):
    """'메시지 캠페인 통계' 한 줄 = 날짜×채널×캠페인×오디언스(같은 키 두 줄이면 seq로 구분)."""
    __tablename__ = "datarize_message_daily"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    channel: Mapped[str] = mapped_column(String(50), default="")
    campaign_id: Mapped[str] = mapped_column(String(64), default="")
    campaign_name: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    audience_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    audience_name: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    seq: Mapped[int] = mapped_column(Integer, default=0)
    attempts: Mapped[float] = mapped_column(Float, default=0)   # 발송시도수 → 화면 '발송'
    sent: Mapped[float] = mapped_column(Float, default=0)       # 발송수(성공) → 화면 '도달'
    cost: Mapped[float] = mapped_column(Float, default=0)       # 발송 비용(원) — 성공 건 기준 과금
    visitors: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    visit_conv_users: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    visit_orders: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    visit_revenue: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    clickers: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    click_conv_users: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    click_orders: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    click_revenue: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (Index("ix_datarize_message_daily_channel_date", "channel", "date"),)


class DatarizeCostDaily(Base):
    """'충전금 차감 내역' 한 줄 — kind=차감(채널·캠페인 있음)|충전(채널 비어 있음)."""
    __tablename__ = "datarize_cost_daily"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    charged_at: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    kind: Mapped[str] = mapped_column(String(20), default="")
    amount: Mapped[float] = mapped_column(Float, default=0)
    channel: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    campaign_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DatarizeMemberDaily(Base):
    """'이메일, 문자 수신 동의 여부별 일별 회원수' — 날짜×이메일 동의×문자 동의 회원 수."""
    __tablename__ = "datarize_member_daily"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    email_opt_in: Mapped[bool] = mapped_column(Boolean, default=False)
    sms_opt_in: Mapped[bool] = mapped_column(Boolean, default=False)
    members: Mapped[float] = mapped_column(Float, default=0)
    synced_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DatarizeSegmentDaily(Base):
    """'[방문, 구매 세그먼트] 일별 세그먼트별 지표' — 날짜×세그먼트 회원 수·비중 등."""
    __tablename__ = "datarize_segment_daily"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    segment: Mapped[str] = mapped_column(String(100), default="")
    classification: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # 상세|간단
    members: Mapped[float] = mapped_column(Float, default=0)
    ratio: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # 0~1
    median_days_no_visit: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    median_days_no_purchase: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    avg_order_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DatarizeSyncLog(Base):
    """시트 불러오기 한 번 기록 — 언제·무엇을·몇 줄."""
    __tablename__ = "datarize_sync_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="running")  # running|ok|partial|failed
    trigger: Mapped[str] = mapped_column(String(50), default="schedule")  # schedule|startup|manual:<email>
    detail: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # 탭별 결과 JSON
