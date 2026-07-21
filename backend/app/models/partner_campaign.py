"""Partner-Campaign M:N join table model."""
from datetime import datetime
from typing import Optional

from sqlalchemy import Integer, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class PartnerCampaign(Base):
    """파트너별 캠페인 전용 레퍼럴 코드/링크 (M:N)."""

    __tablename__ = "partner_campaigns"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    partner_id: Mapped[int] = mapped_column(Integer, ForeignKey("affiliate_partners.id"), index=True)
    campaign_id: Mapped[int] = mapped_column(Integer, ForeignKey("affiliate_campaigns.id"), index=True)
    referral_code: Mapped[str] = mapped_column(String(50), unique=True)
    referral_link: Mapped[Optional[str]] = mapped_column(String(500))
    # 파트너 전용 카페24 쿠폰 코드 — 이 쿠폰을 쓴 주문은 해당 파트너에 확정 귀속
    cafe24_coupon_code: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("partner_id", "campaign_id", name="uq_partner_campaign"),
    )
