"""Creative Studio endpoints (TAB 2)."""
from typing import List, Optional
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

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

router = APIRouter()

# In-memory job storage (use Redis in production)
generation_jobs = {}


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
