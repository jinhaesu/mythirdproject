"""User schemas for API requests/responses."""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr


class BrandSettings(BaseModel):
    """Brand customization settings."""
    logo_url: Optional[str] = None
    primary_color: Optional[str] = "#3B82F6"
    secondary_color: Optional[str] = "#1E40AF"
    brand_voice: Optional[str] = "professional"  # professional, casual, playful


class UserBase(BaseModel):
    """Base user schema."""
    email: EmailStr
    full_name: Optional[str] = None
    company_name: Optional[str] = None


class UserCreate(UserBase):
    """Schema for user creation."""
    password: str


class UserUpdate(BaseModel):
    """Schema for user updates."""
    full_name: Optional[str] = None
    company_name: Optional[str] = None
    brand_settings: Optional[BrandSettings] = None


class UserResponse(UserBase):
    """Schema for user responses."""
    id: int
    is_active: bool
    created_at: datetime
    meta_connected: bool = False
    meta_user_id: Optional[str] = None
    meta_ad_account_id: Optional[str] = None
    meta_ig_account_id: Optional[str] = None
    brand_settings: Optional[BrandSettings] = None

    class Config:
        from_attributes = True


class MetaConnectionRequest(BaseModel):
    """Request to connect Meta account."""
    access_token: str
    ad_account_id: Optional[str] = None


class MagicLinkRequest(BaseModel):
    """Request to send magic link email."""
    email: EmailStr


class MagicLinkVerifyRequest(BaseModel):
    """Request to verify magic link token."""
    token: str


class Token(BaseModel):
    """JWT token response."""
    access_token: str
    token_type: str = "bearer"


class TokenPayload(BaseModel):
    """JWT token payload."""
    sub: int
    exp: datetime
