"""Point transaction model for referral reward ledger."""
from datetime import datetime
from typing import Optional

from sqlalchemy import Integer, String, Float, DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class PointTransaction(Base):
    """포인트 원장 — 양수=적립, 음수=차감."""

    __tablename__ = "point_transactions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    amount: Mapped[float] = mapped_column(Float)
    reason: Mapped[str] = mapped_column(String(50))  # referral_bonus_referrer, referral_bonus_referee, manual, ...
    related_user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    program_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("referral_programs.id"), nullable=True)
    memo: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
