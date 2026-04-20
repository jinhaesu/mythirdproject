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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("partner_id", "campaign_id", name="uq_partner_campaign"),
    )
