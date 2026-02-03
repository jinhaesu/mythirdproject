"""Creative content schemas."""
from datetime import datetime
from typing import Optional, List
from enum import Enum

from pydantic import BaseModel, Field


class CreativeType(str, Enum):
    """Type of creative content."""
    IMAGE = "IMAGE"
    VIDEO = "VIDEO"
    CAROUSEL = "CAROUSEL"


class CreativeFormat(str, Enum):
    """Format/aspect ratio of creative."""
    SQUARE = "1:1"
    PORTRAIT = "4:5"
    STORY = "9:16"
    LANDSCAPE = "16:9"


class VoiceStyle(str, Enum):
    """Voice style for video generation."""
    CALM = "calm"
    ENERGETIC = "energetic"
    MALE = "male"
    FEMALE = "female"


class ImageGenerationRequest(BaseModel):
    """Request for AI image generation."""
    prompt: Optional[str] = None
    style_reference: Optional[str] = None  # JSON style from benchmark
    brand_info: Optional[dict] = None  # Logo, colors
    highlight_text: Optional[str] = None  # Promo text to include
    format: CreativeFormat = CreativeFormat.SQUARE
    variations: int = Field(default=4, le=8)


class VideoGenerationRequest(BaseModel):
    """Request for AI video/shorts generation."""
    prompt: Optional[str] = None
    style_reference: Optional[str] = None
    brand_info: Optional[dict] = None
    script: Optional[str] = None
    voice_style: VoiceStyle = VoiceStyle.CALM
    include_subtitles: bool = True
    duration_seconds: int = Field(default=15, le=60)


class TextRewriteRequest(BaseModel):
    """Request to rewrite text in image."""
    creative_id: int
    new_text: str
    position: Optional[str] = "center"  # center, top, bottom


class BackgroundExtendRequest(BaseModel):
    """Request to extend image background."""
    creative_id: int
    target_format: CreativeFormat


class CreativeBase(BaseModel):
    """Base creative schema."""
    name: str
    creative_type: CreativeType
    format: CreativeFormat
    headline: Optional[str] = None
    primary_text: Optional[str] = None
    call_to_action: Optional[str] = "LEARN_MORE"


class CreativeCreate(CreativeBase):
    """Schema for creating creative."""
    file_url: str
    thumbnail_url: Optional[str] = None
    prompt_used: Optional[str] = None
    style_reference: Optional[str] = None
    benchmark_id: Optional[int] = None


class CreativeUpdate(BaseModel):
    """Schema for updating creative."""
    name: Optional[str] = None
    headline: Optional[str] = None
    primary_text: Optional[str] = None
    call_to_action: Optional[str] = None


class CreativeResponse(CreativeBase):
    """Response schema for creative."""
    id: int
    user_id: int
    file_url: Optional[str]
    thumbnail_url: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class GenerationJobResponse(BaseModel):
    """Response for generation job status."""
    job_id: str
    status: str  # pending, processing, completed, failed
    progress: int = 0  # 0-100
    results: Optional[List[CreativeResponse]] = None
    error_message: Optional[str] = None
