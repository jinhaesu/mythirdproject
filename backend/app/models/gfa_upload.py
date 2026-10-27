"""네이버 GFA 성과 파일 업로드 — GFA 광고 관리자에서 내려받은 일별 성과를 올려 둔 값.

GFA 오픈API가 연결돼 있지 않아도 성과 대시보드와 보고·계획 GFA ROAS가 이 값으로 돈다
(2026-10-27 마케팅 연다은 건의). 같은 (계정 이름, 날짜)는 새로 올린 파일이 통째로 대체해
두 번 세지 않는다. 금액은 파일 값 그대로(원) — VAT 기준은 업로드 기록(spend_vat)에 남긴다.
"""
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, Float, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class GfaUploadBatch(Base):
    """업로드 한 번(파일 하나) 기록 — 이력·삭제 단위."""
    __tablename__ = "gfa_upload_batches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    account_label: Mapped[str] = mapped_column(String(300), default="")  # 파일 안 계정 이름들(쉼표로)
    filename: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    sheet: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    granularity: Mapped[str] = mapped_column(String(20), default="campaign")  # creative|adgroup|campaign|account
    date_from: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    date_to: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    replaced_rows: Mapped[int] = mapped_column(Integer, default=0)  # 이 업로드로 지운 예전 행
    spend_total: Mapped[float] = mapped_column(Float, default=0)
    conv_sales_total: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    spend_vat: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)  # incl|excl|None(표시 없음)
    columns: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # 칸 연결 요약 JSON
    uploaded_by: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class GfaUploadDaily(Base):
    """계정×날짜×캠페인×광고그룹×소재 하루 성과 (파일에 없는 단위 칸은 비어 있음)."""
    __tablename__ = "gfa_upload_daily"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    batch_id: Mapped[int] = mapped_column(Integer, index=True)
    account_label: Mapped[str] = mapped_column(String(200), default="")
    date: Mapped[date] = mapped_column(Date, index=True)
    campaign_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    campaign_name: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    adgroup_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    adgroup_name: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    creative_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    creative_name: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    creative_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    product: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    promotion: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    impressions: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    clicks: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    spend: Mapped[float] = mapped_column(Float, default=0)
    conversions: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    conv_sales: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    budget: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    __table_args__ = (Index("ix_gfa_upload_daily_account_date", "account_label", "date"),)
