"""Meta 광고 인사이트 일별 스냅샷 모델."""
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, Float, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class MetaInsightDaily(Base):
    """Meta 광고 campaign 레벨 일별 인사이트 스냅샷.

    파생 지표(roas/cpa/ctr)는 저장하지 않고 API 응답에서 계산한다.
    """

    __tablename__ = "meta_insights_daily"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    # 계정 / 오브젝트 식별
    ad_account_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    level: Mapped[str] = mapped_column(String(20), nullable=False)  # 'campaign'
    object_id: Mapped[str] = mapped_column(String(100), nullable=False)
    object_name: Mapped[str] = mapped_column(String(500), nullable=False, default="")

    # 캠페인 정보 (campaign 레벨이면 object_id 와 동일)
    campaign_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    campaign_name: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # 날짜
    date: Mapped[date] = mapped_column(Date, nullable=False)

    # 원본 지표
    spend: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    impressions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    clicks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reach: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    frequency: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    conversions: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)  # 구매수
    revenue: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)  # 구매전환값

    # 수집 타임스탬프
    collected_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("ad_account_id", "level", "object_id", "date", name="uq_meta_insight_daily"),
        Index("ix_meta_insight_daily_date", "date"),
        Index("ix_meta_insight_daily_account_date", "ad_account_id", "date"),
    )
