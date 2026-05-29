"""리뷰 모니터링 제품 등록 + 리포트 스케줄 모델."""
from sqlalchemy import Column, String, Integer, Boolean, DateTime, Text
from sqlalchemy.sql import func
from app.db.database import Base


class MonitoredProduct(Base):
    """리뷰 모니터링 대상 제품"""
    __tablename__ = "monitored_products"

    id = Column(String, primary_key=True, index=True)
    user_id = Column(Integer, nullable=False, index=True)
    product_name = Column(String, nullable=False)
    product_url = Column(Text, nullable=False)
    product_id = Column(String, nullable=True)
    mall_name = Column(String, nullable=True)
    image_url = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class ReviewReportSchedule(Base):
    """리뷰 리포트 정기 발송 스케줄"""
    __tablename__ = "review_report_schedules"

    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False, default="리뷰 리포트")
    star_threshold = Column(Integer, default=3)
    days_of_week = Column(String, nullable=True)  # JSON "[1,2,3,4,5]"
    send_hour = Column(Integer, default=9)
    send_minute = Column(Integer, default=0)
    email_to = Column(Text, nullable=True)
    enabled = Column(Boolean, default=True)
    last_run_at = Column(DateTime, nullable=True)
    next_run_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
