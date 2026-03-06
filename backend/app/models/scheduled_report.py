"""스케줄 리포트 모델."""
from sqlalchemy import Column, String, Integer, Boolean, DateTime, Text
from sqlalchemy.sql import func
from app.db.database import Base


class ScheduledReport(Base):
    """스케줄 리포트"""
    __tablename__ = "scheduled_reports"

    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)

    schedule_type = Column(String, nullable=False)  # weekly, monthly
    day_of_week = Column(Integer, nullable=True)  # 0-6
    day_of_month = Column(Integer, nullable=True)  # 1-28

    meta_campaign_id = Column(String, nullable=True)
    lookback_days = Column(Integer, default=7)
    email_to = Column(Text, nullable=True)

    enabled = Column(Boolean, default=True)
    last_run_at = Column(DateTime, nullable=True)
    next_run_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
