"""Meta 전일 성과 아침 알림 발송 기록 — 같은 날짜를 두 번 보내지 않게 하는 잠금 겸 이력.

인스턴스가 둘 떠 있어도(배포 겹침·자동 확장) 먼저 (day) 행을 넣은 쪽만 보낸다.
"""
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class MetaDailyAlertLog(Base):
    __tablename__ = "meta_daily_alert_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    day: Mapped[date] = mapped_column(Date, nullable=False, unique=True)  # 알림에 담은 날(전일, KST)
    status: Mapped[str] = mapped_column(String(20), default="sending")  # sending|sent|failed|no_data
    channel: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # kakao|lms
    recipients: Mapped[int] = mapped_column(Integer, default=0)  # 받는 사람 수(번호는 남기지 않음)
    message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    detail: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
