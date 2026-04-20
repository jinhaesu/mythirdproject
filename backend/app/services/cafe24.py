"""Cafe24 API client service."""
import base64
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import quote

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

def _scopes() -> str:
    return (settings.CAFE24_SCOPES or "mall.read_product").strip()


def _base_url(mall_id: str) -> str:
    return f"https://{mall_id}.cafe24api.com"


def _basic_auth() -> str:
    raw = f"{settings.CAFE24_CLIENT_ID}:{settings.CAFE24_CLIENT_SECRET}"
    return "Basic " + base64.b64encode(raw.encode()).decode()


def build_auth_url(mall_id: str, state: str) -> str:
    """Cafe24 OAuth 인가 URL 생성."""
    return (
        f"https://{mall_id}.cafe24api.com/api/v2/oauth/authorize"
        f"?response_type=code"
        f"&client_id={quote(settings.CAFE24_CLIENT_ID, safe='')}"
        f"&state={quote(state, safe='')}"
        f"&redirect_uri={quote(settings.CAFE24_REDIRECT_URI, safe='')}"
        f"&scope={quote(_scopes(), safe=',')}"
    )


async def exchange_code(mall_id: str, code: str) -> dict:
    """Authorization code → access/refresh token 교환."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{_base_url(mall_id)}/api/v2/oauth/token",
            headers={
                "Authorization": _basic_auth(),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": settings.CAFE24_REDIRECT_URI,
            },
        )
        resp.raise_for_status()
        return resp.json()


async def refresh(mall_id: str, refresh_token: str) -> dict:
    """Refresh token으로 access token 갱신."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{_base_url(mall_id)}/api/v2/oauth/token",
            headers={
                "Authorization": _basic_auth(),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
            },
        )
        resp.raise_for_status()
        return resp.json()


async def ensure_valid_token(user, db) -> str:
    """만료 1분 이내이면 갱신 후 DB에 저장, access_token 반환."""
    from app.models.user import User  # circular import 방지

    expires_at = user.cafe24_token_expires_at
    now = datetime.utcnow()

    need_refresh = (expires_at is None) or (expires_at - now < timedelta(minutes=1))

    if need_refresh and user.cafe24_refresh_token:
        logger.info(f"[Cafe24] Refreshing token for user {user.id}")
        data = await refresh(user.cafe24_mall_id, user.cafe24_refresh_token)
        user.cafe24_access_token = data.get("access_token", user.cafe24_access_token)
        if data.get("refresh_token"):
            user.cafe24_refresh_token = data["refresh_token"]
        if data.get("expires_at"):
            try:
                user.cafe24_token_expires_at = datetime.fromisoformat(
                    data["expires_at"].replace("Z", "+00:00")
                ).replace(tzinfo=None)
            except Exception:
                pass
        await db.commit()

    return user.cafe24_access_token


async def api_request(
    user,
    db,
    method: str,
    path: str,
    params=None,
    json=None,
) -> dict:
    """Cafe24 API 요청. 401이면 토큰 갱신 후 1회 재시도. 에러 시 응답 본문 로깅."""
    token = await ensure_valid_token(user, db)
    # X-Cafe24-Api-Version 헤더는 생략 — 앱 기본 버전 사용
    # (하드코딩 버전이 앱의 default와 불일치하면 400 반환)
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    url = f"{_base_url(user.cafe24_mall_id)}{path}"

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.request(method, url, headers=headers, params=params, json=json)

        if resp.status_code == 401:
            # 토큰 강제 갱신 후 재시도
            if user.cafe24_refresh_token:
                data = await refresh(user.cafe24_mall_id, user.cafe24_refresh_token)
                user.cafe24_access_token = data.get("access_token", user.cafe24_access_token)
                await db.commit()
                headers["Authorization"] = f"Bearer {user.cafe24_access_token}"
                resp = await client.request(method, url, headers=headers, params=params, json=json)

        if resp.status_code >= 400:
            body = resp.text[:500]
            logger.error(f"[Cafe24] {method} {path} -> {resp.status_code}: {body}")
            raise httpx.HTTPStatusError(
                f"Cafe24 API {resp.status_code}: {body}",
                request=resp.request,
                response=resp,
            )
        return resp.json()


async def list_products(
    user, db, q: Optional[str] = None, limit: int = 50, include_hidden: bool = False
) -> list:
    """Cafe24 상품 목록 조회. 기본적으로 display=T/selling=T 상품만 (공개+판매중)."""
    params: dict = {"limit": limit}
    if not include_hidden:
        params["display"] = "T"
        params["selling"] = "T"
    if q:
        params["product_name"] = q

    data = await api_request(user, db, "GET", "/api/v2/admin/products", params=params)
    products = data.get("products", [])
    logger.info(
        f"[Cafe24] list_products q={q!r} hidden={include_hidden} -> {len(products)} items"
    )
    # 프론트엔드에서 쓰는 필드만 추림
    return [
        {
            "product_no": p.get("product_no"),
            "product_name": p.get("product_name"),
            "price": p.get("price"),
            "retail_price": p.get("retail_price"),
            "list_image": p.get("list_image"),
            "detail_image": p.get("detail_image"),
            "display": p.get("display"),
            "selling": p.get("selling"),
        }
        for p in products
    ]


async def get_product(user, db, product_no: int) -> dict:
    """단일 상품 상세 조회."""
    data = await api_request(
        user, db, "GET", f"/api/v2/admin/products/{product_no}",
    )
    product = data.get("product") or (data.get("products") or [{}])[0]
    return product or {}


async def create_coupon(
    user,
    db,
    *,
    coupon_name: str,
    benefit_type: str,
    benefit_percentage: Optional[float],
    benefit_price: Optional[float],
    product_no: int,
    period_days: int = 365,
) -> dict:
    """Cafe24 쿠폰 발급. coupon_no, coupon_code 반환."""
    from datetime import timezone as tz

    begin = "2024-01-01T00:00:00+09:00"
    end_dt = datetime.now(tz.utc) + timedelta(days=period_days)
    end = end_dt.strftime("%Y-%m-%dT%H:%M:%S+09:00")

    request_body: dict = {
        "coupon_name": coupon_name,
        "coupon_type": "O",
        "benefit_type": benefit_type,
        "issue_type": "M",
        "issued_member_scope": "A",
        "available_site": "A",  # A=전체(웹+모바일), W=웹, M=모바일
        "available_period_type": "F",
        "available_begin_datetime": begin,
        "available_end_datetime": end,
        "available_product": "U",
        "available_product_list": [product_no],
        "available_category": "A",
        "available_coupon_count_by_order": "N",
    }
    if benefit_type == "A" and benefit_percentage is not None:
        request_body["benefit_percentage"] = benefit_percentage
    elif benefit_type == "B" and benefit_price is not None:
        request_body["benefit_price"] = benefit_price

    data = await api_request(
        user, db, "POST", "/api/v2/admin/coupons",
        json={"shop_no": 1, "request": request_body},
    )
    coupon = data.get("coupon", {})
    return {
        "coupon_no": str(coupon.get("coupon_no", "")),
        "coupon_code": coupon.get("coupon_code", ""),
    }
