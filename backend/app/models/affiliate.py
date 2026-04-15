"""Affiliate marketing models."""
from datetime import datetime
from typing import Optional
from sqlalchemy import Integer, String, Float, Boolean, DateTime, Text, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum

from app.db.database import Base


class CommissionType(str, enum.Enum):
    PERCENTAGE = "percentage"
    FIXED = "fixed"

class CampaignStatus(str, enum.Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    ENDED = "ended"

class PartnerStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"

class SettlementStatus(str, enum.Enum):
    PENDING = "pending"
    PAID = "paid"


class AffiliateCampaign(Base):
    __tablename__ = "affiliate_campaigns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(200))
    product: Mapped[str] = mapped_column(String(200), default="")
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    commission_type: Mapped[str] = mapped_column(String(20), default="percentage")
    commission_rate: Mapped[float] = mapped_column(Float, default=10.0)
    status: Mapped[str] = mapped_column(String(20), default="active")
    start_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    end_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    landing_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AffiliatePartner(Base):
    __tablename__ = "affiliate_partners"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"))
    campaign_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("affiliate_campaigns.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(100))
    email: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    channel: Mapped[str] = mapped_column(String(50), default="instagram")
    followers: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    referral_code: Mapped[str] = mapped_column(String(50), unique=True)
    referral_link: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    memo: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ReferralClick(Base):
    __tablename__ = "referral_clicks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    partner_id: Mapped[int] = mapped_column(Integer, ForeignKey("affiliate_partners.id"))
    campaign_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("affiliate_campaigns.id"), nullable=True)
    ip_address: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    cookie_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    clicked_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ReferralConversion(Base):
    __tablename__ = "referral_conversions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    click_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("referral_clicks.id"), nullable=True)
    partner_id: Mapped[int] = mapped_column(Integer, ForeignKey("affiliate_partners.id"))
    campaign_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("affiliate_campaigns.id"), nullable=True)
    order_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    order_amount: Mapped[float] = mapped_column(Float, default=0)
    commission_amount: Mapped[float] = mapped_column(Float, default=0)
    converted_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AffiliateSettlement(Base):
    __tablename__ = "affiliate_settlements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    partner_id: Mapped[int] = mapped_column(Integer, ForeignKey("affiliate_partners.id"))
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"))
    amount: Mapped[float] = mapped_column(Float, default=0)
    period_start: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    period_end: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ReferralProgram(Base):
    __tablename__ = "referral_programs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(200))
    reward_type: Mapped[str] = mapped_column(String(20), default="points")
    referrer_reward: Mapped[float] = mapped_column(Float, default=0)
    referee_reward: Mapped[float] = mapped_column(Float, default=0)
    max_rewards_per_user: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
