"""Meta 장기 토큰 자동 갱신(롤링 재교환) 서비스.

Meta 장기(60일) 사용자 토큰은 "만료 전"이라면 fb_exchange_token 재교환으로
새 60일 토큰을 발급받을 수 있다. 수집 루프에서 24시간마다 재교환해
만료가 영원히 도래하지 않도록 롤링 갱신한다.
이미 만료된 토큰(190)은 갱신 불가 → 사용자가 프론트에서 Meta 재연동해야 한다.
"""
import logging
from datetime import datetime
from typing import Any, Dict, Optional

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# 전역 토큰 상태 (프로세스 메모리 — 상태 API 노출용)
token_state: Dict[str, Any] = {
    "expires_at": None,      # ISO str | None — debug_token 기준 토큰 만료 시각(UTC)
    "last_refresh": None,    # ISO str | None — 마지막 재교환 성공 시각(UTC)
    "last_error": None,      # str | None
}


async def _get_shared_meta_user(db: AsyncSession):
    from app.models.user import User

    result = await db.execute(
        select(User).where(
            User.meta_access_token.isnot(None),
            User.meta_access_token != "",
        ).limit(1)
    )
    return result.scalar_one_or_none()


async def fetch_token_expiry(access_token: str) -> Optional[datetime]:
    """debug_token 엔드포인트로 토큰 만료 시각(UTC) 조회. 실패 시 None."""
    if not settings.META_APP_ID or not settings.META_APP_SECRET:
        return None
    base = f"{settings.META_GRAPH_API_BASE}/{settings.META_API_VERSION}"
    app_token = f"{settings.META_APP_ID}|{settings.META_APP_SECRET}"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{base}/debug_token",
                params={"input_token": access_token, "access_token": app_token},
            )
        data = resp.json().get("data", {})
        ts = data.get("expires_at") or data.get("data_access_expires_at")
        if ts:
            return datetime.utcfromtimestamp(int(ts))
    except Exception as exc:
        logger.debug(f"[MetaToken] debug_token 조회 실패: {exc}")
    return None


async def refresh_shared_meta_token(db: AsyncSession) -> bool:
    """공유 Meta 토큰을 fb_exchange_token으로 재교환해 만료를 60일 뒤로 연장.

    Returns:
        True  — 재교환 성공(새 토큰 DB 저장)
        False — 갱신 대상 없음 또는 실패(만료 190 포함 — 재연동 필요)
    """
    if not settings.META_APP_ID or not settings.META_APP_SECRET:
        return False

    user = await _get_shared_meta_user(db)
    if not user:
        return False

    base = f"{settings.META_GRAPH_API_BASE}/{settings.META_API_VERSION}"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{base}/oauth/access_token",
                params={
                    "grant_type": "fb_exchange_token",
                    "client_id": settings.META_APP_ID,
                    "client_secret": settings.META_APP_SECRET,
                    "fb_exchange_token": user.meta_access_token,
                },
            )
        body = resp.json()
    except Exception as exc:
        token_state["last_error"] = str(exc)
        logger.warning(f"[MetaToken] 재교환 요청 실패: {exc}")
        return False

    if resp.status_code != 200 or "access_token" not in body:
        error = body.get("error") or {}
        token_state["last_error"] = error.get("message") or resp.text[:200]
        if error.get("code") == 190:
            # 이미 만료 — 재교환 불가, 사용자 재연동만이 유일한 복구 경로
            from app.services.meta_insights_collector import collector_state

            collector_state["token_expired"] = True
            logger.error("[MetaToken] 토큰이 이미 만료되어 갱신 불가 — Meta 재연동 필요")
        else:
            logger.warning(f"[MetaToken] 재교환 실패: {token_state['last_error']}")
        return False

    user.meta_access_token = body["access_token"]
    await db.commit()

    token_state["last_refresh"] = datetime.utcnow().isoformat()
    token_state["last_error"] = None
    expiry = await fetch_token_expiry(body["access_token"])
    token_state["expires_at"] = expiry.isoformat() if expiry else None

    from app.services.meta_insights_collector import collector_state

    collector_state["token_expired"] = False
    logger.info(
        f"[MetaToken] 토큰 재교환 성공 — 만료 예정: {token_state['expires_at'] or '알 수 없음'}"
    )
    return True
