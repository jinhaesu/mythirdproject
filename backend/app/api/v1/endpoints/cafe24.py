"""Cafe24 OAuth 2.0 연동 엔드포인트."""
import logging
import secrets

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_user
from app.core.config import get_settings
from app.db.database import get_db
from app.models.user import User
import app.services.cafe24 as cafe24_svc

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter()


@router.get("/auth/start")
async def cafe24_auth_start(
    mall_id: str = Query(..., description="Cafe24 쇼핑몰 ID"),
    current_user: User = Depends(get_current_user),
):
    """Cafe24 OAuth 인가 URL 반환."""
    if not settings.CAFE24_CLIENT_ID:
        raise HTTPException(status_code=400, detail="CAFE24_CLIENT_ID가 설정되지 않았습니다.")

    # state = user_id:random
    state = f"{current_user.id}:{secrets.token_urlsafe(16)}"
    auth_url = cafe24_svc.build_auth_url(mall_id, state)
    return {"auth_url": auth_url}


@router.get("/auth/callback")
async def cafe24_auth_callback(
    code: str,
    state: str,
    mall_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Cafe24 OAuth 콜백 — code 교환 후 토큰 저장. 인증 없음(state로 user_id 복원)."""
    # state에서 user_id 추출
    try:
        user_id_str = state.split(":")[0]
        user_id = int(user_id_str)
    except (ValueError, IndexError):
        raise HTTPException(status_code=400, detail="유효하지 않은 state 파라미터입니다.")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

    try:
        data = await cafe24_svc.exchange_code(mall_id, code)
    except Exception as e:
        logger.error(f"[Cafe24] Token exchange failed: {e}")
        raise HTTPException(status_code=400, detail=f"Cafe24 토큰 교환 실패: {str(e)}")

    from datetime import datetime

    user.cafe24_mall_id = data.get("mall_id") or mall_id
    user.cafe24_access_token = data.get("access_token")
    user.cafe24_refresh_token = data.get("refresh_token")
    user.cafe24_scopes = data.get("scopes") or data.get("scope", "")

    expires_at_raw = data.get("expires_at")
    if expires_at_raw:
        try:
            user.cafe24_token_expires_at = datetime.fromisoformat(
                expires_at_raw.replace("Z", "+00:00")
            ).replace(tzinfo=None)
        except Exception:
            pass

    await db.commit()
    logger.info(f"[Cafe24] Connected mall={user.cafe24_mall_id} for user={user.id}")

    return RedirectResponse(f"{settings.FRONTEND_URL}/?cafe24=connected")


@router.get("/status")
async def cafe24_status(
    current_user: User = Depends(get_current_user),
):
    """Cafe24 연결 상태 반환."""
    connected = bool(current_user.cafe24_access_token)
    return {
        "connected": connected,
        "mall_id": current_user.cafe24_mall_id,
        "scopes": current_user.cafe24_scopes,
        "token_expires_at": current_user.cafe24_token_expires_at,
    }


@router.post("/disconnect")
async def cafe24_disconnect(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cafe24 연동 해제."""
    current_user.cafe24_mall_id = None
    current_user.cafe24_access_token = None
    current_user.cafe24_refresh_token = None
    current_user.cafe24_token_expires_at = None
    current_user.cafe24_scopes = None
    await db.commit()
    return {"success": True, "message": "Cafe24 연동이 해제되었습니다."}


@router.get("/products")
async def cafe24_list_products(
    q: str = Query(None, description="상품명 검색"),
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cafe24 상품 목록 조회."""
    if not current_user.cafe24_access_token:
        raise HTTPException(status_code=400, detail="Cafe24 스토어 연결이 필요합니다.")

    try:
        products = await cafe24_svc.list_products(current_user, db, q=q, limit=limit)
    except Exception as e:
        logger.error(f"[Cafe24] list_products failed: {e}")
        raise HTTPException(status_code=502, detail=f"Cafe24 API 오류: {str(e)}")

    return {"products": products}
