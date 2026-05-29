"""자동 관리 룰 + 실행 기록 모델."""
from datetime import datetime
from sqlalchemy import Column, String, Integer, Float, Boolean, DateTime, JSON, ForeignKey
from sqlalchemy.sql import func
from app.db.database import Base


class AutoRule(Base):
    """자동 관리 룰"""
    __tablename__ = "auto_rules"

    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)

    metric = Column(String, nullable=False)  # cpc, ctr, roas, cvr, cpm, spend, frequency
    operator = Column(String, nullable=False)  # gt, lt, gte, lte
    threshold = Column(Float, nullable=False)

    duration_type = Column(String, nullable=False, default="any")  # consecutive_days, total_days, any
    duration_value = Column(Integer, nullable=True)

    secondary_metric = Column(String, nullable=True)
    secondary_operator = Column(String, nullable=True)
    secondary_threshold = Column(Float, nullable=True)

    action = Column(String, nullable=False)  # pause, decrease_budget, increase_budget
    action_value = Column(Float, nullable=True)

    target_type = Column(String, nullable=False, default="campaign")
    target_id = Column(String, nullable=True)
    target_name = Column(String, nullable=True)

    enabled = Column(Boolean, default=True)
    last_checked_at = Column(DateTime, nullable=True)
    times_triggered = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())


class AutoRuleLog(Base):
    """자동 관리 룰 실행 기록"""
    __tablename__ = "auto_rule_logs"

    id = Column(String, primary_key=True, index=True)
    rule_id = Column(String, nullable=False, index=True)
    user_id = Column(String, nullable=False, index=True)

    action_taken = Column(String, nullable=False)
    target_type = Column(String, nullable=False)
    target_id = Column(String, nullable=False)
    target_name = Column(String, nullable=True)

    metric_name = Column(String, nullable=False)
    metric_value = Column(Float, nullable=False)
    threshold_value = Column(Float, nullable=False)
    details = Column(JSON, nullable=True)

    triggered_at = Column(DateTime, server_default=func.now())
