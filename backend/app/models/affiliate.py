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
    # Cafe24 상품/쿠폰 연결 (Phase 2)
    cafe24_product_no: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    cafe24_product_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    cafe24_product_image: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    cafe24_coupon_code: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    cafe24_coupon_no: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    discount_type: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # percentage | fixed | shipping
    discount_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    base_product_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    # Phase 6 — 비공개 카테고리 기반 다중 상품 캠페인
    # 카페24 자동 생성 비공개 카테고리. 다중 상품을 한 인플루언서/캠페인에 묶기 위함.
    cafe24_category_no: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    cafe24_category_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    # 카테고리에 묶인 상품번호 목록 (JSON array string). attribution 매칭용.
    cafe24_product_nos: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # 카테고리 페이지 URL (랜딩 우선순위: category_url > base_product_url > landing_url)
    cafe24_category_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    # 캠페인 자체 레퍼럴 코드 (파트너 없이도 공유 가능)
    referral_code: Mapped[Optional[str]] = mapped_column(String(50), unique=True, nullable=True, index=True)
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
    channels: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON array string
    followers: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    referral_code: Mapped[str] = mapped_column(String(50), unique=True)
    referral_link: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    memo: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # 활동 그룹 분류 — crew(크루) / gongu(공구) / ad(광고) / other(기타)
    # 파트너 탭에서 대분류 필터로 사용. 기본은 crew(가장 일반적).
    partner_group: Mapped[str] = mapped_column(String(20), default="crew", server_default="crew")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    # Soft delete — 휴지통으로 이동한 시각. NULL이면 활성 파트너.
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, index=True)


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
    cafe24_order_id: Mapped[Optional[str]] = mapped_column(String(100), unique=True, nullable=True, index=True)
    order_amount: Mapped[float] = mapped_column(Float, default=0)
    commission_amount: Mapped[float] = mapped_column(Float, default=0)
    converted_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    # 환불/취소 상태 (paid | refunded | cancelled)
    status: Mapped[str] = mapped_column(String(20), default="paid", index=True)
    refunded_amount: Mapped[float] = mapped_column(Float, default=0.0)  # 부분 환불 대응
    refunded_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


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
