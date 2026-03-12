"""Creative Studio endpoints (TAB 2)."""
from typing import List, Optional
import json
import uuid
import os
import io
import logging

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from PIL import Image as PILImage

from app.db.database import get_db
from app.models.user import User
from app.models.creative import Creative, CreativeType, CreativeFormat
from app.schemas.creative import (
    ImageGenerationRequest, VideoGenerationRequest,
    TextRewriteRequest, BackgroundExtendRequest,
    CreativeCreate, CreativeUpdate, CreativeResponse,
    GenerationJobResponse
)
from app.api.v1.endpoints.auth import get_current_user
from app.services.ai import (
    ClaudeService, VisionService,
    ImageGenerationService, VideoGenerationService
)

logger = logging.getLogger(__name__)

router = APIRouter()

# Allowed file extensions and size limits
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi"}
MAX_IMAGE_SIZE = 30 * 1024 * 1024  # 30MB
MAX_VIDEO_SIZE = 4 * 1024 * 1024 * 1024  # 4GB

# In-memory job storage (use Redis in production)
generation_jobs = {}


# ──────────────────────────────────────────────
# File Upload Endpoint
# ──────────────────────────────────────────────

@router.post("/upload", response_model=CreativeResponse)
async def upload_creative(
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    creative_type: Optional[str] = Form(None),  # IMAGE or VIDEO
    headline: Optional[str] = Form(None),
    primary_text: Optional[str] = Form(None),
    call_to_action: Optional[str] = Form("SHOP_NOW"),
    link_url: Optional[str] = Form(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload an image or video file as a creative."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    ext = os.path.splitext(file.filename)[1].lower()

    # Detect creative_type from extension if not provided
    if not creative_type:
        if ext in ALLOWED_IMAGE_EXTENSIONS:
            creative_type = "IMAGE"
        elif ext in ALLOWED_VIDEO_EXTENSIONS:
            creative_type = "VIDEO"
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file extension: {ext}. "
                       f"Allowed: {', '.join(ALLOWED_IMAGE_EXTENSIONS | ALLOWED_VIDEO_EXTENSIONS)}"
            )
    else:
        creative_type = creative_type.upper()

    # Validate extension matches creative_type
    if creative_type == "IMAGE" and ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid image file extension: {ext}. Allowed: {', '.join(ALLOWED_IMAGE_EXTENSIONS)}"
        )
    if creative_type == "VIDEO" and ext not in ALLOWED_VIDEO_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid video file extension: {ext}. Allowed: {', '.join(ALLOWED_VIDEO_EXTENSIONS)}"
        )

    # Read file content
    file_content = await file.read()
    file_size = len(file_content)

    # Validate file size
    if creative_type == "IMAGE" and file_size > MAX_IMAGE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"Image file too large: {file_size / (1024*1024):.1f}MB. Maximum: 30MB"
        )
    if creative_type == "VIDEO" and file_size > MAX_VIDEO_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"Video file too large: {file_size / (1024*1024*1024):.1f}GB. Maximum: 4GB"
        )

    # Detect format/aspect ratio from image dimensions
    format_value = "1:1"  # default
    if creative_type == "IMAGE":
        try:
            img = PILImage.open(io.BytesIO(file_content))
            width, height = img.size
            ratio = width / height
            if 0.9 <= ratio <= 1.1:
                format_value = "1:1"
            elif 0.75 <= ratio <= 0.85:
                format_value = "4:5"
            elif ratio <= 0.65:
                format_value = "9:16"
            elif ratio >= 1.5:
                format_value = "16:9"
            else:
                format_value = "1:1"  # default
        except Exception as e:
            logger.warning(f"Could not detect image dimensions: {e}")
            format_value = "1:1"

    # Save file to uploads/ directory
    upload_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))),
        "uploads"
    )
    os.makedirs(upload_dir, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(upload_dir, filename)

    with open(filepath, "wb") as f:
        f.write(file_content)

    file_url = f"/uploads/{filename}"

    # Use original filename as name if not provided
    creative_name = name or os.path.splitext(file.filename)[0]

    # Create Creative record in database
    creative = Creative(
        user_id=current_user.id,
        name=creative_name,
        creative_type=CreativeType(creative_type),
        format=CreativeFormat(format_value),
        file_url=file_url,
        thumbnail_url=file_url,
        headline=headline,
        primary_text=primary_text,
        call_to_action=call_to_action,
    )
    db.add(creative)
    await db.commit()
    await db.refresh(creative)

    return CreativeResponse(
        id=creative.id,
        user_id=creative.user_id,
        name=creative.name,
        creative_type=creative.creative_type,
        format=creative.format,
        headline=creative.headline,
        primary_text=creative.primary_text,
        call_to_action=creative.call_to_action,
        file_url=creative.file_url,
        thumbnail_url=creative.file_url,
        created_at=creative.created_at,
        updated_at=creative.updated_at,
    )


# ──────────────────────────────────────────────
# Creative Validation Endpoint
# ──────────────────────────────────────────────

@router.post("/validate-specs")
async def validate_creative_specs(
    creative_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Validate creative against Meta ad specifications."""
    result = await db.execute(
        select(Creative)
        .where(Creative.id == creative_id, Creative.user_id == current_user.id)
    )
    creative = result.scalar_one_or_none()

    if not creative:
        raise HTTPException(status_code=404, detail="Creative not found")

    warnings = []
    errors = []
    recommendations = []

    # Text validations
    if creative.primary_text:
        if len(creative.primary_text) > 2200:
            errors.append("Primary text exceeds maximum 2200 characters")
        elif len(creative.primary_text) > 125:
            warnings.append(
                f"Primary text is {len(creative.primary_text)} chars "
                "(recommended: 125 or fewer for full visibility)"
            )

    if creative.headline:
        if len(creative.headline) > 255:
            errors.append("Headline exceeds maximum 255 characters")
        elif len(creative.headline) > 40:
            warnings.append(
                f"Headline is {len(creative.headline)} chars "
                "(recommended: 40 or fewer)"
            )

    # File-based validations
    if creative.file_url and creative.file_url.startswith("/uploads/"):
        upload_dir = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))),
            "uploads"
        )
        filename = creative.file_url.replace("/uploads/", "")
        filepath = os.path.join(upload_dir, filename)

        if os.path.exists(filepath):
            file_size = os.path.getsize(filepath)
            ext = os.path.splitext(filename)[1].lower()

            if creative.creative_type == CreativeType.IMAGE:
                # File size check
                if file_size > MAX_IMAGE_SIZE:
                    errors.append(
                        f"Image file size ({file_size / (1024*1024):.1f}MB) exceeds 30MB limit"
                    )

                # Format check
                if ext not in {".jpg", ".jpeg", ".png"}:
                    warnings.append(
                        f"File format ({ext}) may not be optimal. JPG and PNG are recommended"
                    )

                # Resolution check
                try:
                    img = PILImage.open(filepath)
                    width, height = img.size

                    if width < 600 or height < 600:
                        errors.append(
                            f"Image resolution too low ({width}x{height}). "
                            "Minimum: 600x600 pixels"
                        )
                    elif width < 1080 or height < 1080:
                        warnings.append(
                            f"Image resolution ({width}x{height}) is below recommended. "
                            "Use 1080x1080 or higher for best quality"
                        )

                    # Aspect ratio recommendations
                    ratio = width / height
                    if 0.9 <= ratio <= 1.1:
                        recommendations.append("1:1 format - optimal for Feed placement")
                    elif 0.75 <= ratio <= 0.85:
                        recommendations.append("4:5 format - optimal for Feed (more vertical space)")
                    elif ratio <= 0.65:
                        recommendations.append("9:16 format - optimal for Stories and Reels")
                    elif ratio >= 1.5:
                        recommendations.append(
                            "16:9 format - consider cropping to 1:1 or 4:5 for better Feed performance"
                        )

                    recommendations.append("Use 1080x1080 for best feed performance")

                except Exception as e:
                    warnings.append(f"Could not analyze image dimensions: {str(e)}")

            elif creative.creative_type == CreativeType.VIDEO:
                # File size check
                if file_size > MAX_VIDEO_SIZE:
                    errors.append(
                        f"Video file size ({file_size / (1024*1024*1024):.1f}GB) exceeds 4GB limit"
                    )

                # Format check
                if ext not in {".mp4", ".mov"}:
                    warnings.append(
                        f"Video format ({ext}) may not be optimal. MP4 and MOV are recommended"
                    )

                recommendations.append("Recommended: 1:1 or 4:5 for Feed, 9:16 for Stories/Reels")
                recommendations.append("Keep videos under 15 seconds for Stories")
                recommendations.append("Minimum resolution: 1080x1080")

    elif creative.creative_type == CreativeType.CAROUSEL:
        recommendations.append("Carousel ads support 2-10 cards")
        recommendations.append("Each card should use 1:1 aspect ratio for consistency")
        recommendations.append("Use 1080x1080 resolution for each card")

    valid = len(errors) == 0

    return {
        "valid": valid,
        "warnings": warnings,
        "errors": errors,
        "recommendations": recommendations,
        "meta_specs": {
            "feed": {"recommended_size": "1080x1080", "aspect_ratio": "1:1"},
            "stories": {"recommended_size": "1080x1920", "aspect_ratio": "9:16"},
            "reels": {"recommended_size": "1080x1920", "aspect_ratio": "9:16"},
        }
    }


# ──────────────────────────────────────────────
# Meta Creative Guidelines Endpoint
# ──────────────────────────────────────────────

@router.get("/meta-guidelines")
async def get_meta_creative_guidelines():
    """Return Meta's recommended creative specifications and best practices."""
    return {
        "placements": {
            "feed": {
                "image": {
                    "recommended_size": "1080 x 1080 px",
                    "aspect_ratio": "1:1",
                    "min_size": "600 x 600 px",
                    "max_file_size": "30MB",
                    "formats": ["JPG", "PNG"],
                },
                "video": {
                    "recommended_size": "1080 x 1080 px",
                    "aspect_ratio": "1:1 또는 4:5",
                    "min_resolution": "1080 x 1080 px",
                    "max_file_size": "4GB",
                    "duration": "1~240초 (15초 권장)",
                    "formats": ["MP4", "MOV"],
                },
            },
            "stories_reels": {
                "image": {
                    "recommended_size": "1080 x 1920 px",
                    "aspect_ratio": "9:16",
                    "min_size": "600 x 1067 px",
                    "max_file_size": "30MB",
                    "formats": ["JPG", "PNG"],
                },
                "video": {
                    "recommended_size": "1080 x 1920 px",
                    "aspect_ratio": "9:16",
                    "min_resolution": "1080 x 1920 px",
                    "max_file_size": "4GB",
                    "duration": "1~60초 (15초 권장)",
                    "formats": ["MP4", "MOV"],
                },
            },
            "right_column": {
                "image": {
                    "recommended_size": "1200 x 628 px",
                    "aspect_ratio": "1.91:1",
                    "min_size": "600 x 315 px",
                    "max_file_size": "30MB",
                },
            },
        },
        "text_guidelines": {
            "primary_text": {
                "max_length": 2200,
                "recommended_length": 125,
                "description": "광고 본문 텍스트 (125자 이내 권장, 초과 시 더보기로 숨김)",
            },
            "headline": {
                "max_length": 255,
                "recommended_length": 40,
                "description": "광고 제목 (40자 이내 권장)",
            },
            "description": {
                "max_length": 255,
                "recommended_length": 30,
                "description": "추가 설명 (뉴스피드 링크 광고에만 표시)",
            },
        },
        "call_to_action_options": [
            {"value": "SHOP_NOW", "label": "지금 쇼핑하기"},
            {"value": "LEARN_MORE", "label": "자세히 알아보기"},
            {"value": "SIGN_UP", "label": "가입하기"},
            {"value": "CONTACT_US", "label": "문의하기"},
            {"value": "GET_OFFER", "label": "혜택 받기"},
            {"value": "ORDER_NOW", "label": "지금 주문하기"},
            {"value": "BOOK_NOW", "label": "지금 예약하기"},
            {"value": "APPLY_NOW", "label": "지금 신청하기"},
            {"value": "SUBSCRIBE", "label": "구독하기"},
            {"value": "DOWNLOAD", "label": "다운로드"},
            {"value": "WATCH_MORE", "label": "더 보기"},
            {"value": "BUY_NOW", "label": "지금 구매"},
        ],
        "best_practices": [
            "소재 내 텍스트 비율 20% 이하 유지 (이미지의 20% 이상 텍스트 시 도달 감소)",
            "첫 3초 내에 브랜드/제품을 노출",
            "모바일 최적화: 세로형(4:5, 9:16) 소재 우선 사용",
            "소재 3개 이상 등록하여 Meta AI 최적화 활용",
            "정기적으로 소재 교체 (2~3주 주기)",
            "A/B 테스트: 동일 타겟에 다른 소재로 비교",
            "동영상: 자막 필수 (85%가 무음 시청)",
            "CTA(행동유도) 버튼과 소재 메시지 일관성 유지",
        ],
    }


# ──────────────────────────────────────────────
# AI Generation Endpoints
# ──────────────────────────────────────────────

@router.post("/generate/image", response_model=GenerationJobResponse)
async def generate_images(
    request: ImageGenerationRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Generate AI images for ads.

    Creates multiple variations based on style reference.
    """
    job_id = str(uuid.uuid4())
    generation_jobs[job_id] = {
        "status": "processing",
        "progress": 0,
        "results": []
    }

    async def generate_task():
        try:
            vision = VisionService()
            image_gen = ImageGenerationService()
            claude = ClaudeService()

            # Parse style reference
            style_dict = {}
            if request.style_reference:
                try:
                    style_dict = json.loads(request.style_reference)
                except json.JSONDecodeError:
                    style_dict = {"style": request.style_reference}

            # Generate prompt
            product_desc = request.highlight_text or "professional product advertisement"
            prompt = await vision.generate_image_prompt(
                style_dict,
                product_desc,
                request.brand_info
            )

            # Generate variations
            generation_jobs[job_id]["progress"] = 20
            results = await image_gen.generate_variations(
                prompt=prompt,
                format=request.format.value,
                count=request.variations,
                style=style_dict.get("visual_style")
            )

            generation_jobs[job_id]["progress"] = 80

            # Save to database
            creatives = []
            for i, result in enumerate(results):
                if result.get("image_url"):
                    creative = Creative(
                        user_id=current_user.id,
                        name=f"Generated Image {i+1}",
                        creative_type=CreativeType.IMAGE,
                        format=CreativeFormat(request.format.value),
                        file_url=result["image_url"],
                        prompt_used=result.get("prompt_used"),
                        style_reference=request.style_reference
                    )
                    db.add(creative)
                    creatives.append(creative)

            await db.commit()

            generation_jobs[job_id] = {
                "status": "completed",
                "progress": 100,
                "results": [
                    CreativeResponse(
                        id=c.id,
                        user_id=c.user_id,
                        name=c.name,
                        creative_type=c.creative_type,
                        format=c.format,
                        file_url=c.file_url,
                        thumbnail_url=c.file_url,
                        created_at=c.created_at,
                        updated_at=c.updated_at
                    )
                    for c in creatives
                ]
            }

        except Exception as e:
            generation_jobs[job_id] = {
                "status": "failed",
                "progress": 0,
                "error_message": str(e)
            }

    background_tasks.add_task(generate_task)

    return GenerationJobResponse(
        job_id=job_id,
        status="processing",
        progress=0
    )


@router.post("/generate/video", response_model=GenerationJobResponse)
async def generate_video(
    request: VideoGenerationRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Generate AI video/shorts for Reels.
    """
    job_id = str(uuid.uuid4())
    generation_jobs[job_id] = {
        "status": "processing",
        "progress": 0,
        "results": []
    }

    async def generate_task():
        try:
            video_gen = VideoGenerationService()

            # Parse style reference
            style_dict = {}
            if request.style_reference:
                try:
                    style_dict = json.loads(request.style_reference)
                except json.JSONDecodeError:
                    pass

            prompt = request.prompt or "professional product advertisement video"

            generation_jobs[job_id]["progress"] = 20

            # Generate video
            result = await video_gen.generate_video(
                prompt=prompt,
                duration_seconds=request.duration_seconds,
                aspect_ratio="9:16"
            )

            generation_jobs[job_id]["progress"] = 60

            # Add voice if script provided
            if request.script and result.get("success"):
                voice_result = await video_gen.add_voice_to_video(
                    result["video_url"],
                    request.script,
                    request.voice_style.value
                )

            # Add subtitles if requested
            if request.include_subtitles and result.get("success"):
                subtitle_result = await video_gen.add_subtitles(
                    result["video_url"],
                    request.script or "",
                    "reels"
                )

            generation_jobs[job_id]["progress"] = 90

            if result.get("success"):
                creative = Creative(
                    user_id=current_user.id,
                    name="Generated Video",
                    creative_type=CreativeType.VIDEO,
                    format=CreativeFormat.STORY,
                    file_url=result["video_url"],
                    prompt_used=prompt,
                    style_reference=request.style_reference
                )
                db.add(creative)
                await db.commit()
                await db.refresh(creative)

                generation_jobs[job_id] = {
                    "status": "completed",
                    "progress": 100,
                    "results": [
                        CreativeResponse(
                            id=creative.id,
                            user_id=creative.user_id,
                            name=creative.name,
                            creative_type=creative.creative_type,
                            format=creative.format,
                            file_url=creative.file_url,
                            thumbnail_url=creative.file_url,
                            created_at=creative.created_at,
                            updated_at=creative.updated_at
                        )
                    ]
                }
            else:
                generation_jobs[job_id] = {
                    "status": "failed",
                    "progress": 0,
                    "error_message": result.get("error", "Video generation failed")
                }

        except Exception as e:
            generation_jobs[job_id] = {
                "status": "failed",
                "progress": 0,
                "error_message": str(e)
            }

    background_tasks.add_task(generate_task)

    return GenerationJobResponse(
        job_id=job_id,
        status="processing",
        progress=0
    )


@router.get("/job/{job_id}", response_model=GenerationJobResponse)
async def get_job_status(job_id: str):
    """Get generation job status."""
    job = generation_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return GenerationJobResponse(
        job_id=job_id,
        status=job["status"],
        progress=job["progress"],
        results=job.get("results"),
        error_message=job.get("error_message")
    )


@router.post("/rewrite-text", response_model=CreativeResponse)
async def rewrite_text(
    request: TextRewriteRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Rewrite text in existing image creative.
    """
    result = await db.execute(
        select(Creative)
        .where(Creative.id == request.creative_id, Creative.user_id == current_user.id)
    )
    creative = result.scalar_one_or_none()

    if not creative:
        raise HTTPException(status_code=404, detail="Creative not found")

    if creative.creative_type != CreativeType.IMAGE:
        raise HTTPException(status_code=400, detail="Text rewrite only works for images")

    image_gen = ImageGenerationService()
    result = await image_gen.add_text_to_image(
        creative.file_url,
        request.new_text,
        request.position
    )

    if result.get("success"):
        # Create new creative with modified image
        new_creative = Creative(
            user_id=current_user.id,
            name=f"{creative.name} (Text Modified)",
            creative_type=CreativeType.IMAGE,
            format=creative.format,
            file_url=result["image_url"],
            headline=request.new_text,
            prompt_used=creative.prompt_used,
            style_reference=creative.style_reference
        )
        db.add(new_creative)
        await db.commit()
        await db.refresh(new_creative)

        return CreativeResponse(
            id=new_creative.id,
            user_id=new_creative.user_id,
            name=new_creative.name,
            creative_type=new_creative.creative_type,
            format=new_creative.format,
            headline=new_creative.headline,
            file_url=new_creative.file_url,
            thumbnail_url=new_creative.file_url,
            created_at=new_creative.created_at,
            updated_at=new_creative.updated_at
        )

    raise HTTPException(status_code=500, detail=result.get("error", "Text rewrite failed"))


@router.post("/extend-background", response_model=CreativeResponse)
async def extend_background(
    request: BackgroundExtendRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Extend image background (outpainting).

    Useful for converting 1:1 to 9:16 (Story format).
    """
    result = await db.execute(
        select(Creative)
        .where(Creative.id == request.creative_id, Creative.user_id == current_user.id)
    )
    creative = result.scalar_one_or_none()

    if not creative:
        raise HTTPException(status_code=404, detail="Creative not found")

    image_gen = ImageGenerationService()
    result = await image_gen.outpaint_image(
        creative.file_url,
        request.target_format.value
    )

    if result.get("success"):
        new_creative = Creative(
            user_id=current_user.id,
            name=f"{creative.name} ({request.target_format.value})",
            creative_type=CreativeType.IMAGE,
            format=CreativeFormat(request.target_format.value),
            file_url=result["image_url"],
            prompt_used=creative.prompt_used,
            style_reference=creative.style_reference
        )
        db.add(new_creative)
        await db.commit()
        await db.refresh(new_creative)

        return CreativeResponse(
            id=new_creative.id,
            user_id=new_creative.user_id,
            name=new_creative.name,
            creative_type=new_creative.creative_type,
            format=new_creative.format,
            file_url=new_creative.file_url,
            thumbnail_url=new_creative.file_url,
            created_at=new_creative.created_at,
            updated_at=new_creative.updated_at
        )

    raise HTTPException(status_code=500, detail=result.get("error", "Background extension failed"))


@router.get("/library", response_model=List[CreativeResponse])
async def get_creative_library(
    creative_type: Optional[str] = None,
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get user's creative library."""
    query = select(Creative).where(Creative.user_id == current_user.id)

    if creative_type:
        query = query.where(Creative.creative_type == CreativeType(creative_type))

    query = query.order_by(Creative.created_at.desc()).limit(limit)

    result = await db.execute(query)
    creatives = result.scalars().all()

    return [
        CreativeResponse(
            id=c.id,
            user_id=c.user_id,
            name=c.name,
            creative_type=c.creative_type,
            format=c.format,
            headline=c.headline,
            primary_text=c.primary_text,
            call_to_action=c.call_to_action,
            file_url=c.file_url,
            thumbnail_url=c.thumbnail_url or c.file_url,
            created_at=c.created_at,
            updated_at=c.updated_at
        )
        for c in creatives
    ]


@router.delete("/{creative_id}")
async def delete_creative(
    creative_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Delete a creative from library."""
    result = await db.execute(
        select(Creative)
        .where(Creative.id == creative_id, Creative.user_id == current_user.id)
    )
    creative = result.scalar_one_or_none()

    if not creative:
        raise HTTPException(status_code=404, detail="Creative not found")

    await db.delete(creative)
    await db.commit()

    return {"success": True, "message": "Creative deleted"}
