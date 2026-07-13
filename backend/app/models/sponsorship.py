"""협찬(스폰서십) 관리 모듈 모델 — 대학축제/동아리/마라톤/학회 등 행사 제품 협찬 기록."""
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class Sponsorship(Base):
    """협찬 1건 — 행사 제품 협찬 기록 및 집계."""
    __tablename__ = "sponsorships"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    target_name: Mapped[str] = mapped_column(String(200))  # 협찬 대상 정확한 명칭
    event_type: Mapped[str] = mapped_column(String(30), index=True)  # festival|club|marathon|conference|etc
    sponsored_at: Mapped[date] = mapped_column(Date, index=True)  # 협찬 일자
    product: Mapped[str] = mapped_column(String(200))  # 협찬 제품명
    quantity: Mapped[int] = mapped_column(Integer, default=0)  # 수량 (개)
    estimated_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # 제품 환산 금액(원)
    reason: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)  # 협찬 사유
    expected_effect: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)  # 기대효과
    conditions: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)  # 협찬 조건 (쉼표 구분)
    notes: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
