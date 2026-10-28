"""쿠폰(프로모션) 호출용 얇은 래퍼 — 기존 카페24 연동(users 토큰)을 그대로 쓰되,
GET이 아닌 호출은 settings.BESTPRICE_LIVE가 true일 때만 내보낸다(false면 예외로 차단).
"""
from __future__ import annotations

import logging

from sqlalchemy import select

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class BestpriceWriteBlocked(RuntimeError):
    """BESTPRICE_LIVE=false 상태에서 카페24 쓰기를 시도함."""


async def main_cafe24_user(db):
    from app.models.user import User
    s = get_settings()
    q = select(User).where(User.cafe24_access_token.isnot(None))
    if s.CAFE24_MALL_ID:
        q = q.where(User.cafe24_mall_id == s.CAFE24_MALL_ID)
    return (await db.execute(q.order_by(User.id))).scalars().first()


async def promo_request(db, method: str, path: str, *, params=None, json=None) -> dict:
    """쿠폰 API 호출. path는 '/api/v2/admin/...'."""
    if method.upper() != "GET" and not get_settings().BESTPRICE_LIVE:
        raise BestpriceWriteBlocked(f"BESTPRICE_LIVE=false — 카페24 쓰기 차단: {method} {path}")
    from app.services import cafe24 as cafe24_svc
    user = await main_cafe24_user(db)
    if user is None:
        raise RuntimeError("카페24 연동 사용자 없음")
    return await cafe24_svc.api_request(user, db, method, path, params=params, json=json)
