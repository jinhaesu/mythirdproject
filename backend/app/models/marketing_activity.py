"""마케팅 활동 기록 — 팀이 스프레드시트로 관리하던 집행 데이터의 시스템 이관.

원본: 구글시트 "메타 데이터 정리"의 콘텐츠/인플루언서/체험단/서포터즈 시트.
콘텐츠(오가닉 게시물)와 시딩류(인플루언서/체험단/서포터즈)를 한 테이블로 통합 —
공통 축은 (유형, 제품, 채널, 시기, 수량, 조회수, 비용)이고 참여 지표는 콘텐츠만 채운다.
"""
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, Float, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class MarketingActivity(Base):
    __tablename__ = "marketing_activities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)

    # 분류 축
    activity_type: Mapped[str] = mapped_column(String(30), index=True)  # content|influencer|experience|supporters|etc
    # 실적(actual) vs 향후 계획(plan) — 계획은 실적 집계에서 제외, 나중에 실적 전환
    entry_kind: Mapped[str] = mapped_column(String(10), default="actual", server_default="actual", index=True)
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
    # 크리에이터 "이름/인스타핸들" — 크리에이터 풀과 핸들 매칭해 협업 이력 집계 (2026-10-11)
    creator: Mapped[Optional[str]] = mapped_column(String(200), nullable=True, index=True)
    # 조회수 등 지표의 스냅샷 기준일 — 조회수는 계속 오르므로 "언제 시점 값인지" 기록
    metrics_as_of: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # 공동구매 분석 항목 (2026-10-26 개선 건의 — 구 시트 '공동구매' 탭 분류 그대로).
    # 콘텐츠 수=quantity, 콘텐츠 링크=link, 특이사항=notes, 진행 일정=period_month/activity_date 재사용.
    # 건별 AOV는 저장하지 않고 revenue ÷ order_count 로 계산한다.
    revenue: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # 매출액(원)
    order_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # 주문건수
    sales_platform: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)  # 플랫폼: 자사몰|네이버|ZVZO…
    deal_type: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # 구분: 공동구매|할인링크
    is_first: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)  # 첫 진행 여부 (None=미기재)
    vendor: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)  # 개인/벤더사 ("개인" 또는 벤더사명)
    creator_gender: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)  # 크리에이터 성별
    creator_category: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # 크리에이터 카테고리(요리·운동…)
    follower_age: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # 주요 팔로워 연령대 "25-34세"
    follower_gender: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)  # 주요 팔로워 성별

    notes: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    source: Mapped[str] = mapped_column(String(20), default="manual")  # manual | sheet_import

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        Index("ix_marketing_activities_type_month", "activity_type", "period_month"),
    )


class ContentMetricSnapshot(Base):
    """콘텐츠 지표 일일 스냅샷 — 활동 기록(링크 보유)의 조회수·좋아요·댓글을
    매일 저장해 누적/증가 추이를 분석한다 (2026-10-11).

    수집: 유튜브 링크=Data API(자동), 인스타 자사 게시물=Graph API(연동 시),
    데일리 루프 + 수동 갱신 버튼 양쪽에서 upsert.
    """
    __tablename__ = "content_metric_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    activity_id: Mapped[int] = mapped_column(Integer, index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    views: Mapped[int] = mapped_column(Integer, default=0)
    likes: Mapped[int] = mapped_column(Integer, default=0)
    comments: Mapped[int] = mapped_column(Integer, default=0)

    __table_args__ = (UniqueConstraint("activity_id", "date", name="uq_content_snapshot"),)
