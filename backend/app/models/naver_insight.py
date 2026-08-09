"""네이버 인사이트 — 블로그/카페 언급량 일별 스냅샷.

검색 API는 시점 총량만 주므로, 매일 저장해 추이를 만든다.
upsert 기준: (keyword, date)
"""
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class NaverMentionDaily(Base):
    __tablename__ = "naver_mention_daily"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    keyword: Mapped[str] = mapped_column(String(100), index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    blog_total: Mapped[int] = mapped_column(Integer, default=0)
    cafe_total: Mapped[int] = mapped_column(Integer, default=0)
    collected_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
