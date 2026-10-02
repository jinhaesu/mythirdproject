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


class SponsorshipItem(Base):
    """협찬 품목 — 협찬 1건에 복수 품목·수량 (product/quantity 레거시 컬럼은
    합계 요약으로만 유지)."""
    __tablename__ = "sponsorship_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    sponsorship_id: Mapped[int] = mapped_column(Integer, index=True)
    product: Mapped[str] = mapped_column(String(200))  # 품목명
    quantity: Mapped[int] = mapped_column(Integer, default=0)
    estimated_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # 품목 환산 금액(원)
    note: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)


class SponsorshipOutcome(Base):
    """협찬 결과물 — 사진/영상/포스팅/보도 등 산출물 링크·지표 기록."""
    __tablename__ = "sponsorship_outcomes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    sponsorship_id: Mapped[int] = mapped_column(Integer, index=True)
    kind: Mapped[str] = mapped_column(String(50))  # 사진|영상|SNS 포스팅|보도|후기|기타
    link: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    views: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # 조회/노출수
    note: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    occurred_at: Mapped[Optional[date]] = mapped_column(Date, nullable=True)  # 게시/보도일
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
