"""Supabase Storage 서비스 — 소재 파일 업로드/URL 생성."""
import logging
import httpx
from typing import Optional

from app.core.config import get_settings

logger = logging.getLogger(__name__)

BUCKET_NAME = "creatives"


async def upload_to_supabase(
    file_content: bytes,
    filename: str,
    content_type: str = "image/jpeg",
) -> Optional[str]:
    """파일을 Supabase Storage에 업로드하고 공개 URL을 반환한다."""
    settings = get_settings()
    supabase_url = (settings.SUPABASE_URL or "").strip().rstrip("/")
    service_key = (settings.SUPABASE_SERVICE_KEY or "").strip()

    if not supabase_url or not service_key:
        logger.warning("[Storage] SUPABASE_URL 또는 SUPABASE_SERVICE_KEY 미설정, 로컬 저장")
        return None

    headers = {
        "Authorization": f"Bearer {service_key}",
        "apikey": service_key,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1) 버킷 존재 확인 / 생성
        try:
            bucket_resp = await client.get(
                f"{supabase_url}/storage/v1/bucket/{BUCKET_NAME}",
                headers=headers,
            )
            if bucket_resp.status_code == 404:
                await client.post(
                    f"{supabase_url}/storage/v1/bucket",
                    headers={**headers, "Content-Type": "application/json"},
                    json={"id": BUCKET_NAME, "name": BUCKET_NAME, "public": True},
                )
                logger.info(f"[Storage] Bucket '{BUCKET_NAME}' created")
        except Exception as e:
            logger.warning(f"[Storage] Bucket check failed: {e}")

        # 2) 파일 업로드
        try:
            upload_resp = await client.post(
                f"{supabase_url}/storage/v1/object/{BUCKET_NAME}/{filename}",
                headers={
                    **headers,
                    "Content-Type": content_type,
                    "x-upsert": "true",
                },
                content=file_content,
            )

            if upload_resp.status_code in (200, 201):
                public_url = f"{supabase_url}/storage/v1/object/public/{BUCKET_NAME}/{filename}"
                logger.info(f"[Storage] Uploaded: {filename} -> {public_url}")
                return public_url
            else:
                logger.error(f"[Storage] Upload failed: {upload_resp.status_code} {upload_resp.text[:200]}")
                return None
        except Exception as e:
            logger.error(f"[Storage] Upload error: {e}")
            return None
