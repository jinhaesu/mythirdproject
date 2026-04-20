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

    # state = user_id:mall_id:random  (mall_id는 Cafe24 콜백이 돌려주지 않아 state에 보존)
    state = f"{current_user.id}:{mall_id}:{secrets.token_urlsafe(16)}"
    auth_url = cafe24_svc.build_auth_url(mall_id, state)
    return {"auth_url": auth_url}


@router.get("/auth/callback")
async def cafe24_auth_callback(
    state: str = Query(...),
    code: str | None = Query(None),
    mall_id: str | None = Query(None),
    error: str | None = Query(None),
    error_description: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Cafe24 OAuth 콜백 — code 교환 후 토큰 저장. 인증 없음(state로 user_id 복원)."""
    # state = "{user_id}:{mall_id}:{token}" — mall_id를 여기서 복원
    parts = state.split(":")
    if len(parts) < 2:
        return RedirectResponse(f"{settings.FRONTEND_URL}/?cafe24=error&reason=invalid_state")
    try:
        user_id = int(parts[0])
    except ValueError:
        return RedirectResponse(f"{settings.FRONTEND_URL}/?cafe24=error&reason=invalid_state")
    mall_id_from_state = parts[1] if len(parts) >= 3 else None
    mall_id = mall_id or mall_id_from_state
    if not mall_id:
        return RedirectResponse(f"{settings.FRONTEND_URL}/?cafe24=error&reason=missing_mall_id")

    # Cafe24에서 사용자가 취소하거나 거부한 경우 code 없이 돌아옴
    if error or not code:
        logger.warning(f"[Cafe24] callback without code: error={error} desc={error_description}")
        return RedirectResponse(
            f"{settings.FRONTEND_URL}/?cafe24=error&reason={error or 'no_code'}"
        )

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return RedirectResponse(f"{settings.FRONTEND_URL}/?cafe24=error&reason=user_not_found")

    try:
        data = await cafe24_svc.exchange_code(mall_id, code)
    except Exception as e:
        logger.error(f"[Cafe24] Token exchange failed: {e}")
        return RedirectResponse(f"{settings.FRONTEND_URL}/?cafe24=error&reason=token_exchange_failed")

    from datetime import datetime

    user.cafe24_mall_id = data.get("mall_id") or mall_id
    user.cafe24_access_token = data.get("access_token")
    user.cafe24_refresh_token = data.get("refresh_token")
    # Cafe24는 scopes를 list로 돌려줌 → comma-separated string으로 변환
    scopes_raw = data.get("scopes") or data.get("scope") or ""
    if isinstance(scopes_raw, list):
        scopes_raw = ",".join(str(s) for s in scopes_raw)
    user.cafe24_scopes = scopes_raw

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
