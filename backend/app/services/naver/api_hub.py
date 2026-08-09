"""NAVER API HUB 공용 클라이언트.

네이버클라우드 플랫폼이 중개하는 통합 API 플랫폼 — 클라이언트 ID/시크릿
한 쌍으로 검색·쇼핑·트렌드 등 네이버 API 전체를 호출한다.

인증: HTTP 헤더
  X-NCP-APIGW-API-KEY-ID: <client_id>
  X-NCP-APIGW-API-KEY:    <client_secret>

키는 Railway 환경변수 NAVER_HUB_CLIENT_ID / NAVER_HUB_CLIENT_SECRET로만
주입한다 — 코드·로그에 절대 노출 금지.
"""
import logging
from typing import Any, Dict, Optional

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


def is_configured() -> bool:
    return bool(settings.NAVER_HUB_CLIENT_ID and settings.NAVER_HUB_CLIENT_SECRET)


def _headers() -> Dict[str, str]:
    return {
        "X-NCP-APIGW-API-KEY-ID": settings.NAVER_HUB_CLIENT_ID,
        "X-NCP-APIGW-API-KEY": settings.NAVER_HUB_CLIENT_SECRET,
    }


async def hub_get(
    path: str,
    params: Optional[Dict[str, Any]] = None,
    base: Optional[str] = None,
) -> Dict[str, Any]:
    """API HUB GET 호출. 반환: {ok, status, data|error}."""
    return await _request("GET", path, params=params, base=base)


async def hub_post(
    path: str,
    json_body: Optional[Dict[str, Any]] = None,
    base: Optional[str] = None,
) -> Dict[str, Any]:
    """API HUB POST 호출 (트렌드/데이터랩 계열은 POST+JSON). 반환: {ok, status, data|error}."""
    return await _request("POST", path, json_body=json_body, base=base)


async def _request(
    method: str,
    path: str,
    params: Optional[Dict[str, Any]] = None,
    json_body: Optional[Dict[str, Any]] = None,
    base: Optional[str] = None,
) -> Dict[str, Any]:
    if not is_configured():
        return {"ok": False, "status": 0, "error": "NAVER_HUB_CLIENT_ID/SECRET 미설정"}

    url = f"{(base or settings.NAVER_HUB_API_BASE).rstrip('/')}/{path.lstrip('/')}"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.request(
                method, url, params=params, json=json_body, headers=_headers()
            )
    except Exception as exc:
        logger.warning(f"[NaverHub] 요청 실패: {method} {path} → {exc}")
        return {"ok": False, "status": 0, "error": str(exc)}

    if resp.status_code != 200:
        # 에러 본문은 자를 것 — 헤더/키는 절대 로그에 남기지 않는다
        snippet = resp.text[:300]
        logger.warning(f"[NaverHub] HTTP {resp.status_code}: {method} {path} → {snippet}")
        return {"ok": False, "status": resp.status_code, "error": snippet}

    try:
        data = resp.json()
    except ValueError:
        data = {"raw": resp.text}
    return {"ok": True, "status": 200, "data": data}
