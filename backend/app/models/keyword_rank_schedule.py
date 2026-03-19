"""키워드 순위 모니터링 스케줄 모델."""
from sqlalchemy import Column, String, Integer, Boolean, DateTime, Text
from sqlalchemy.sql import func
from app.db.database import Base


class KeywordRankSchedule(Base):
    """키워드 순위 체크 스케줄"""
    __tablename__ = "keyword_rank_schedules"

    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)

    # 모니터링 대상
    brand_name = Column(String, nullable=False, default="널담")  # 순위 추적할 브랜드명
    keyword_filter = Column(String, nullable=True)  # 특정 키워드 필터 (없으면 전체)

    # 스케줄
    schedule_type = Column(String, nullable=False)  # daily, weekly, monthly
    day_of_week = Column(Integer, nullable=True)  # 0=일, 1=월, ..., 6=토
    day_of_month = Column(Integer, nullable=True)  # 1-28
    send_hour = Column(Integer, default=9)  # 0-23 (KST)
    send_minute = Column(Integer, default=0)  # 0-59

    # 이메일
    email_to = Column(Text, nullable=True)

    # 상태
    enabled = Column(Boolean, default=True)
    last_run_at = Column(DateTime, nullable=True)
    next_run_at = Column(DateTime, nullable=True)
    last_result = Column(Text, nullable=True)  # JSON: 마지막 실행 결과
    created_at = Column(DateTime, server_default=func.now())
