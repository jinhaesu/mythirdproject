"""마케팅 활동 기록 — 팀이 스프레드시트로 관리하던 집행 데이터의 시스템 이관.

원본: 구글시트 "메타 데이터 정리"의 콘텐츠/인플루언서/체험단/서포터즈 시트.
콘텐츠(오가닉 게시물)와 시딩류(인플루언서/체험단/서포터즈)를 한 테이블로 통합 —
공통 축은 (유형, 제품, 채널, 시기, 수량, 조회수, 비용)이고 참여 지표는 콘텐츠만 채운다.
"""
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, Float, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class MarketingActivity(Base):
    __tablename__ = "marketing_activities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)

    # 분류 축
    activity_type: Mapped[str] = mapped_column(String(30), index=True)  # content|influencer|experience|supporters|etc
    product: Mapped[Optional[str]] = mapped_column(String(200), nullable=True, index=True)  # 제품명
    product_category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)  # 제품류
    channel: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, index=True)  # 인스타그램|유튜브|블로그|틱톡…
    purpose: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)  # 정보성|신제품홍보|브랜딩…
    status: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # 계획|진행중|완료 등 자유 텍스트

    # 시기 — 콘텐츠는 일 단위, 시딩류는 월 단위 기입이 많아 둘 다 허용
    period_month: Mapped[str] = mapped_column(String(7), index=True)  # "YYYY-MM" (필수 집계 축)
    activity_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # 실적 지표
    quantity: Mapped[int] = mapped_column(Integer, default=0)  # 집행 건수(게시물/시딩 수)
    views: Mapped[int] = mapped_column(Integer, default=0)
    reach: Mapped[int] = mapped_column(Integer, default=0)
    likes: Mapped[int] = mapped_column(Integer, default=0)
    comments: Mapped[int] = mapped_column(Integer, default=0)
    saves: Mapped[int] = mapped_column(Integer, default=0)
    shares: Mapped[int] = mapped_column(Integer, default=0)
    follows: Mapped[int] = mapped_column(Integer, default=0)
    cost: Mapped[float] = mapped_column(Float, default=0)  # KRW

    link: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)  # 콘텐츠/게시물 URL
    # 조회수 등 지표의 스냅샷 기준일 — 조회수는 계속 오르므로 "언제 시점 값인지" 기록
    metrics_as_of: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    notes: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    source: Mapped[str] = mapped_column(String(20), default="manual")  # manual | sheet_import

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        Index("ix_marketing_activities_type_month", "activity_type", "period_month"),
    )
