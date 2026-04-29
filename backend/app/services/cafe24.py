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


import asyncio as _asyncio
_refresh_locks: dict = {}


async def proactive_refresh_all(db) -> dict:
    """
    모든 Cafe24 연결된 유저의 토큰을 선제적으로 갱신.
    스케줄러가 30분마다 호출해 2시간 만료 훨씬 전에 refresh —
    refresh_token 체인이 끊기지 않도록 유지.
    """
    from app.models.user import User
    from sqlalchemy import select as _select
    r = await db.execute(
        _select(User).where(
            User.cafe24_access_token.isnot(None),
            User.cafe24_access_token != "",
        )
    )
    users = r.scalars().all()
    refreshed = 0
    failed = 0
    skipped = 0
    for u in users:
        exp = u.cafe24_token_expires_at
        now = datetime.utcnow()
        # 만료까지 1시간 이상 남았으면 스킵 (불필요한 refresh 방지)
        if exp and (exp - now) > timedelta(hours=1):
            skipped += 1
            continue
        try:
            # 1시간 이내 → 무조건 force refresh 해서 체인 유지
            # (ensure_valid_token은 1분 이내만 갱신하므로 여기선 _do_refresh_locked 직접 호출)
            await _do_refresh_locked(u, db, force=True)
            refreshed += 1
            logger.info(f"[Cafe24] Proactive refresh ok user={u.id}")
        except Exception as e:
            failed += 1
            logger.error(f"[Cafe24] Proactive refresh FAILED user={u.id}: {e}")
            # 진짜 끊김일 때만 알림 (토큰이 DB에서 이미 초기화됐는지로 판정)
            try:
                await db.refresh(u)
            except Exception:
                pass
            if not u.cafe24_refresh_token:
                await _notify_cafe24_disconnect(u.id, str(e))
    return {"refreshed": refreshed, "failed": failed, "skipped": skipped, "total": len(users)}


async def _notify_cafe24_disconnect(user_id: int, error: str) -> None:
    """Cafe24 연결 끊김을 관리자 이메일로 알림."""
    try:
        _s = settings
        if not _s.RESEND_API_KEY:
            return
        recipients_raw = _s.ALLOWED_EMAILS or ""
        recipients = [e.strip() for e in recipients_raw.replace(";", ",").split(",") if e.strip()]
        if not recipients:
            return
        import resend
        resend.api_key = _s.RESEND_API_KEY
        from_email = _s.RESEND_FROM_EMAIL or "onboarding@resend.dev"
        if "<" not in from_email:
            from_email = f"어필리에이트 알림 <{from_email}>"
        resend.Emails.send({
            "from": from_email,
            "to": recipients,
            "subject": "⚠️ Cafe24 연결이 끊어졌습니다 — 재연결 필요",
            "html": f"""
            <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px;">
              <h2 style="color: #DC2626;">Cafe24 어필리에이트 연결 끊김</h2>
              <p style="color: #333; line-height: 1.6;">
                자동 토큰 갱신이 실패해 Cafe24 연결이 끊어졌습니다. 어필리에이트 대시보드의
                <b>Cafe24 스토어 연결</b> 배너에서 <b>"연결하기"</b>를 눌러 OAuth를 다시 진행해주세요.
              </p>
              <p style="background: #FEE2E2; padding: 12px; border-radius: 8px; font-size: 12px; color: #991B1B;">
                <b>오류:</b> {error[:300]}
              </p>
              <p style="color: #666; font-size: 13px;">
                재연결 전까지 상품 조회, 주문 폴링, 쿠폰 발급 기능이 일시 중단됩니다.
              </p>
            </div>
            """,
        })
        logger.info(f"[Cafe24] disconnect 알림 이메일 발송 → {recipients}")
    except Exception as e:
        logger.warning(f"[Cafe24] disconnect 알림 실패: {e}")


def _is_invalid_grant_error(resp_text: str) -> bool:
    """Cafe24 응답 본문이 refresh_token 무효화(재연결 필요) 에러인지 판정.

    네트워크 일시 오류나 기타 400과 구분해 refresh_token 체인을 불필요하게
    파기하지 않도록 함.
    """
    t = (resp_text or "").lower()
    keywords = ("invalid_grant", "invalid_refresh", "invalid_token",
                "revoked", "expired_token", "access denied")
    return any(k in t for k in keywords)


async def _persist_refresh_result(user, db, data: dict) -> None:
    """refresh() 결과를 DB에 atomic 저장. access+refresh+expires_at 함께 커밋."""
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


async def _do_refresh_locked(user, db, force: bool = False) -> str:
    """유저별 lock 하에 DB를 최신으로 재조회 후 필요시 refresh.

    force=True면 (access_token 만료 판정과 무관하게) 무조건 refresh 시도.
    실패 시에도 refresh_token 체인 무효화는 오직 invalid_grant 계열 응답일 때만.
    """
    lock = _refresh_locks.setdefault(user.id, _asyncio.Lock())
    async with lock:
        # 락 획득 직후 DB 최신값 재조회 — 다른 워커/요청이 이미 갱신했을 수 있음
        try:
            await db.refresh(user)
        except Exception:
            pass
        expires_at = user.cafe24_token_expires_at
        now = datetime.utcnow()
        need_refresh = force or (expires_at is None) or (
            expires_at - now < timedelta(minutes=1)
        )
        if not need_refresh:
            return user.cafe24_access_token
        if not user.cafe24_refresh_token:
            raise RuntimeError("Cafe24 refresh_token 없음 — 재연결 필요")

        logger.info(f"[Cafe24] Refreshing token user={user.id} force={force}")
        try:
            data = await refresh(user.cafe24_mall_id, user.cafe24_refresh_token)
        except httpx.HTTPStatusError as e:
            status = e.response.status_code if e.response else 0
            body = e.response.text if e.response else ""
            logger.error(f"[Cafe24] Refresh 실패 status={status}: {body[:300]}")
            # invalid_grant 계열만 토큰 초기화 — 네트워크/일시 오류로 체인 끊기지 않도록
            if status in (400, 401) and _is_invalid_grant_error(body):
                user.cafe24_access_token = None
                user.cafe24_refresh_token = None
                user.cafe24_token_expires_at = None
                user.cafe24_scopes = None
                await db.commit()
                raise httpx.HTTPStatusError(
                    "Cafe24 재연결이 필요합니다. 관리자에서 Cafe24를 다시 연결해주세요.",
                    request=e.request, response=e.response,
                )
            # 그 외 400/5xx/timeout은 일시 오류로 보고 토큰 보존 + 재시도 기회
            raise
        except (httpx.RequestError, httpx.TimeoutException) as e:
            logger.error(f"[Cafe24] Refresh 네트워크 오류 user={user.id}: {e}")
            raise

        await _persist_refresh_result(user, db, data)

    return user.cafe24_access_token


async def ensure_valid_token(user, db) -> str:
    """access_token 만료 1분 이내이면 refresh 후 DB에 저장, access_token 반환.

    - 유저별 asyncio lock으로 동시 refresh 경합 방지
    - Cafe24는 refresh_token rotating 방식 → 반드시 새 refresh_token도 같이 DB 저장
    - refresh 실패 시 invalid_grant 계열만 토큰 초기화 (네트워크 일시 오류 보호)
    """
    expires_at = user.cafe24_token_expires_at
    now = datetime.utcnow()
    need_refresh = (expires_at is None) or (expires_at - now < timedelta(minutes=1))
    if not (need_refresh and user.cafe24_refresh_token):
        return user.cafe24_access_token
    return await _do_refresh_locked(user, db, force=False)


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
            # 401 → 락 보호 하에 강제 refresh + 새 refresh_token 저장 후 1회 재시도
            # (rotating refresh_token이 유실되어 체인 끊기는 것 방지)
            if user.cafe24_refresh_token:
                new_token = await _do_refresh_locked(user, db, force=True)
                headers["Authorization"] = f"Bearer {new_token}"
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


async def list_orders(
    user,
    db,
    start_date: datetime,
    end_date: datetime,
    limit: int = 500,
) -> list:
    """Cafe24 주문 목록 조회. start/end_date는 naive datetime(UTC)."""
    params = {
        "start_date": start_date.strftime("%Y-%m-%d"),
        "end_date": end_date.strftime("%Y-%m-%d"),
        "limit": limit,
        "embed": "items,coupons",  # 주문 상세에 items/coupons 포함 요청
    }
    data = await api_request(user, db, "GET", "/api/v2/admin/orders", params=params)
    orders = data.get("orders", [])
    logger.info(
        f"[Cafe24] list_orders {params['start_date']}~{params['end_date']} -> {len(orders)} items"
    )
    return orders


async def get_product(user, db, product_no: int) -> dict:
    """단일 상품 상세 조회."""
    data = await api_request(
        user, db, "GET", f"/api/v2/admin/products/{product_no}",
    )
    product = data.get("product") or (data.get("products") or [{}])[0]
    return product or {}


async def verify_storefront_url(url: str) -> bool:
    """
    스토어프론트 URL이 실제 상품 페이지로 연결되는지 확인.
    302로 /index.html로 리다이렉트되면 False, 상품 페이지 유지되면 True.
    """
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            resp = await client.head(url)
            final_url = str(resp.url)
            # index.html로 redirect되면 접근 불가
            if "/index.html" in final_url or final_url.rstrip("/").endswith(".com"):
                return False
            # 원본 URL의 product_no가 최종 URL에도 남아있어야 함
            return "product_no=" in final_url or "/product/" in final_url
    except Exception as e:
        logger.warning(f"[Cafe24] verify_storefront_url failed for {url}: {e}")
        # 검증 실패 시 통과 (false negative 방지)
        return True


async def probe_category_url(url: str) -> dict:
    """
    카테고리 URL을 GET하고 리다이렉트 체인 + 최종 응답 코드를 반환 (진단용).
    Cafe24가 홈으로 302시키는지 직접 확인.
    """
    try:
        async with httpx.AsyncClient(
            timeout=10, follow_redirects=False,
            headers={"User-Agent": "Mozilla/5.0 (compatible; affiliate-debug)"}
        ) as client:
            chain = []
            current = url
            for _ in range(5):
                resp = await client.get(current)
                chain.append({
                    "url": current,
                    "status": resp.status_code,
                    "location": resp.headers.get("location"),
                })
                if resp.status_code in (301, 302, 303, 307, 308) and resp.headers.get("location"):
                    loc = resp.headers["location"]
                    # 절대/상대 URL 처리
                    if loc.startswith("http"):
                        current = loc
                    else:
                        from urllib.parse import urljoin as _uj
                        current = _uj(current, loc)
                else:
                    break
            final = chain[-1]
            redirected_to_home = (
                final["status"] in (200, 301, 302) and
                ("index" in (final.get("url") or "") or
                 (final.get("url") or "").rstrip("/").endswith(".com") or
                 (final.get("url") or "").rstrip("/").endswith(".kr"))
            )
            return {
                "ok": not redirected_to_home and final["status"] == 200,
                "redirected_to_home": redirected_to_home,
                "chain": chain,
                "final_url": final.get("url"),
                "final_status": final.get("status"),
            }
    except Exception as e:
        logger.warning(f"[Cafe24] probe_category_url failed for {url}: {e}")
        return {"ok": False, "error": str(e), "chain": []}


async def list_categories(
    user, db, *, parent_category_no: Optional[int] = None, depth: Optional[int] = None,
) -> list:
    """
    Cafe24 카테고리 목록 조회. parent 선택용.
    Cafe24 응답: { categories: [{ category_no, category_name, parent_category_no, category_depth, display, ... }] }
    """
    params: dict = {"limit": 200}
    if parent_category_no is not None:
        params["parent_category_no"] = parent_category_no
    if depth is not None:
        params["category_depth"] = depth
    data = await api_request(user, db, "GET", "/api/v2/admin/categories", params=params)
    cats = data.get("categories", [])
    return [
        {
            "category_no": c.get("category_no"),
            "category_name": c.get("category_name"),
            "parent_category_no": c.get("parent_category_no"),
            "category_depth": c.get("category_depth"),
            "display": c.get("display"),
        }
        for c in cats
    ]


async def create_category(
    user,
    db,
    *,
    category_name: str,
    parent_category_no: int = 1,
    display: bool = True,
    use_main: bool = False,
) -> dict:
    """
    카페24 카테고리 생성.

    - parent_category_no=1: 루트 아래 1단(대분류). 0 또는 1을 보통 사용.
    - display=True: PC/모바일에서 카테고리 페이지 URL 접근 허용. 카페24는 display_pc_yn=F인
      카테고리에 접근 시 홈으로 302 리다이렉트하므로, 인플루언서 링크가 동작하려면 반드시 T.
    - use_main=False: 메인 카테고리 진열 메뉴에서는 숨김 → 메뉴엔 안 보이지만 URL은 접근 가능.

    응답: { category: { category_no, ... } } → category_no 반환.
    """
    display_yn = "T" if display else "F"
    use_main_yn = "T" if use_main else "F"
    body = {
        "shop_no": 1,
        "request": {
            "category_name": category_name,
            "parent_category_no": parent_category_no,
            "display_order": 0,
            "use_display": "T",  # 카테고리 자체는 항상 사용함
            "display_pc_yn": display_yn,
            "display_mobile_yn": display_yn,
            "use_main_category": use_main_yn,
        },
    }
    data = await api_request(user, db, "POST", "/api/v2/admin/categories", json=body)
    # Cafe24 응답 구조 방어적 파싱 — 'category' 단일 또는 'categories' 배열 모두 처리
    cat: dict = {}
    if isinstance(data.get("category"), dict):
        cat = data["category"]
    elif isinstance(data.get("categories"), list) and data["categories"]:
        first = data["categories"][0]
        if isinstance(first, dict):
            cat = first
    if not cat or not cat.get("category_no"):
        logger.error(
            f"[Cafe24] create_category 응답에 category_no 없음. "
            f"raw response keys={list(data.keys())} body={str(data)[:500]}"
        )
    else:
        logger.info(
            f"[Cafe24] create_category 성공: no={cat.get('category_no')} "
            f"name={cat.get('category_name')} display_pc_yn={cat.get('display_pc_yn')}"
        )
    return {
        "category_no": cat.get("category_no"),
        "category_name": cat.get("category_name") or category_name,
        "display": cat.get("display_pc_yn") or display_yn,
        "raw_response_keys": list(data.keys()),
    }


async def get_category(user, db, *, category_no: int) -> dict:
    """단일 카테고리 상세 조회 — 진단/검증용."""
    try:
        data = await api_request(
            user, db, "GET", f"/api/v2/admin/categories/{category_no}",
        )
    except Exception as e:
        return {"error": str(e), "exists": False}
    cat: dict = {}
    if isinstance(data.get("category"), dict):
        cat = data["category"]
    elif isinstance(data.get("categories"), list) and data["categories"]:
        first = data["categories"][0]
        if isinstance(first, dict):
            cat = first
    if not cat:
        return {"error": "카테고리 정보 파싱 실패", "raw_keys": list(data.keys()), "exists": False}
    # 카페24 카테고리 API 핵심 필드 값들 모두 노출 (진단용)
    return {
        "exists": True,
        "category_no": cat.get("category_no"),
        "category_name": cat.get("category_name"),
        "category_depth": cat.get("category_depth"),
        "parent_category_no": cat.get("parent_category_no"),
        # 진열/접근 핵심 필드
        "use_display": cat.get("use_display"),
        "display_type": cat.get("display_type"),
        "use_main": cat.get("use_main"),
        "access_authority": cat.get("access_authority"),
        # legacy 필드들 — 일부 카페24 버전이 사용
        "display_pc_yn": cat.get("display_pc_yn"),
        "display_mobile_yn": cat.get("display_mobile_yn"),
        "display_raw": cat.get("display"),
        "all_keys": list(cat.keys()),
        # 진단 편의용 — display_pc_yn 호환 (UI 코드가 이 필드를 보고 needsRepublish 결정)
        "computed_display_ok": (cat.get("use_display") == "T") and (cat.get("access_authority") in ("A", None)),
    }


async def update_category_visibility(
    user, db, *, category_no: int, display: bool = True, use_main: bool = False,
) -> dict:
    """
    카테고리 진열 + 접근권한 설정 업데이트 — 인플루언서 링크가 동작하도록.

    카페24 카테고리 API 실제 필드 (응답 키에서 확인):
    - use_display: T/F (대표 진열 ON/OFF)
    - display_type: 진열 방식 (P=PC, M=Mobile, B=Both — 추정)
    - use_main: T/F (메인분류 진열 ON/OFF — `use_main_category`가 아니라 `use_main`)
    - access_authority: 접근 권한 (A=전체, M=회원, ... — URL 차단 의심 키)
    """
    display_yn = "T" if display else "F"
    use_main_yn = "T" if use_main else "F"
    # 카페24 422 에러로 검증됨 — display_type="B"는 invalid. 카페24가 자체적으로 갖는 값("A")이
    # 이미 PC+Mobile 모두 진열 의미이므로 굳이 PUT으로 바꾸지 않음. display_pc_yn/_mobile_yn도
    # 응답에 없는 필드라 PUT에서 제거.
    body = {
        "shop_no": 1,
        "request": {
            "use_display": display_yn,
            "use_main": use_main_yn,
            "access_authority": "A",  # 모든 방문자 접근 허용 (회원 게이트 해제 시도)
        },
    }
    logger.info(
        f"[Cafe24] update_category_visibility category={category_no} body.request={body['request']}"
    )
    data = await api_request(
        user, db, "PUT", f"/api/v2/admin/categories/{category_no}", json=body,
    )
    cat: dict = {}
    if isinstance(data.get("category"), dict):
        cat = data["category"]
    elif isinstance(data.get("categories"), list) and data["categories"]:
        first = data["categories"][0]
        if isinstance(first, dict):
            cat = first
    # 핵심 필드 값들 모두 로그로 덤프 — 카페24가 무엇을 저장했는지 확인
    important_fields = [
        "use_display", "display_type", "use_main", "access_authority",
        "display_pc_yn", "display_mobile_yn", "display",
    ]
    field_values = {k: cat.get(k) for k in important_fields}
    logger.info(
        f"[Cafe24] update_category_visibility 응답 category={category_no} field_values={field_values}"
    )
    return {
        "category_no": cat.get("category_no") or category_no,
        "use_display": cat.get("use_display"),
        "display_type": cat.get("display_type"),
        "use_main": cat.get("use_main"),
        "access_authority": cat.get("access_authority"),
        "raw_response_keys": list(data.keys()),
        "cat_keys": list(cat.keys()) if cat else [],
    }


async def attach_products_to_category(
    user, db, *, category_no: int, product_nos: list[int],
) -> dict:
    """
    상품들을 카테고리에 추가.

    카페24의 bulk 엔드포인트(POST /categories/{N}/products)가 422로 까다로워
    상품별 PUT /products/{product_no}로 add_category_no 처리하는 방식 사용.
    각 PUT 호출이 독립이라 일부 실패해도 나머지는 성공.

    PUT body: { shop_no: 1, request: { add_category_no: [{category_no, recommend, new}] } }
    """
    if not product_nos:
        return {"attached": 0, "errors": []}

    success_count = 0
    errors: list[dict] = []
    for pn in product_nos:
        if not pn:
            continue
        try:
            await api_request(
                user, db, "PUT", f"/api/v2/admin/products/{int(pn)}",
                json={
                    "shop_no": 1,
                    "request": {
                        "add_category_no": [
                            {"category_no": int(category_no), "recommend": "F", "new": "F"}
                        ],
                    },
                },
            )
            success_count += 1
        except Exception as e:
            err_msg = str(e)[:300]
            # 이미 카테고리에 속한 상품은 카페24가 에러 반환할 수 있음 — 성공으로 간주
            if "already" in err_msg.lower() or "exists" in err_msg.lower() or "duplicate" in err_msg.lower():
                success_count += 1
                logger.info(f"[Cafe24] product {pn} already in category {category_no}")
            else:
                errors.append({"product_no": int(pn), "error": err_msg})
                logger.warning(f"[Cafe24] add product {pn} to category {category_no} failed: {err_msg}")

    logger.info(
        f"[Cafe24] attach_products_to_category category={category_no} "
        f"success={success_count}/{len(product_nos)} errors={len(errors)}"
    )
    return {"attached": success_count, "errors": errors, "total_attempted": len(product_nos)}


async def list_category_products(
    user, db, *, category_no: int, limit: int = 200,
) -> list:
    """
    카페24 카테고리에 실제로 묶인 상품 목록 조회 (검증/진단용).
    GET /api/v2/admin/categories/{category_no}/products
    """
    try:
        data = await api_request(
            user, db, "GET",
            f"/api/v2/admin/categories/{category_no}/products",
            params={"limit": limit},
        )
    except Exception as e:
        logger.warning(f"[Cafe24] list_category_products {category_no} failed: {e}")
        return []
    products = data.get("products") or []
    return [
        {
            "product_no": p.get("product_no"),
            "product_name": p.get("product_name"),
            "display_order": p.get("display_order") or p.get("sort_no"),
        }
        for p in products
    ]


async def delete_category(user, db, *, category_no: int) -> dict:
    """카테고리 삭제. 캠페인 삭제 시 cleanup용."""
    try:
        data = await api_request(
            user, db, "DELETE", f"/api/v2/admin/categories/{category_no}",
        )
        return {"success": True, "raw": data}
    except Exception as e:
        logger.warning(f"[Cafe24] delete_category {category_no} failed: {e}")
        return {"success": False, "error": str(e)}


def category_storefront_url(domain: str, category_no: int) -> str:
    """
    카페24 카테고리 페이지 URL.

    실제 동작 확인: /product/list.html?cate_no={N} 패턴이 동작.
    /category/cat-no/{N}/category.html 패턴은 nuldam.com 같은 SmartDesign 테마에서
    홈으로 302됨 (URL probe로 확인됨).
    """
    domain = (domain or "").replace("https://", "").replace("http://", "").rstrip("/")
    return f"https://{domain}/product/list.html?cate_no={category_no}"


async def create_coupon(
    user,
    db,
    *,
    coupon_name: str,
    benefit_type: str,
    benefit_percentage: Optional[float],
    benefit_price: Optional[float],
    product_no: Optional[int] = None,
    product_nos: Optional[list[int]] = None,
    category_no: Optional[int] = None,
    period_days: int = 365,
) -> dict:
    """
    Cafe24 쿠폰 발급. coupon_no, coupon_code 반환.

    범위 우선순위:
      - category_no 주어지면 → 카테고리 단위 쿠폰 (available_category=U)
      - product_nos / product_no 주어지면 → 상품 단위 (available_product=U)
      - 둘 다 없으면 전체 적용
    """
    from datetime import timezone as tz

    # 쿠폰 유효기간: 지금부터 period_days 일 동안
    now = datetime.now(tz.utc)
    begin = now.strftime("%Y-%m-%dT%H:%M:%S+09:00")
    end_dt = now + timedelta(days=period_days)
    end = end_dt.strftime("%Y-%m-%dT%H:%M:%S+09:00")

    request_body: dict = {
        "coupon_name": coupon_name,
        "coupon_type": "O",
        "benefit_type": benefit_type,
        "issue_type": "M",
        "issued_member_scope": "A",
        "available_site": ["W", "M"],  # 배열 필수. W=웹, M=모바일 둘 다
        "available_period_type": "F",
        "available_begin_datetime": begin,
        "available_end_datetime": end,
        "available_coupon_count_by_order": "N",
    }
    if benefit_type == "A" and benefit_percentage is not None:
        request_body["benefit_percentage"] = benefit_percentage
    elif benefit_type == "B" and benefit_price is not None:
        request_body["benefit_price"] = benefit_price

    # 적용 범위 결정
    if category_no is not None:
        request_body["available_category"] = "U"
        request_body["available_category_list"] = [int(category_no)]
        request_body["available_product"] = "A"
    else:
        nos: list[int] = []
        if product_nos:
            nos.extend(int(p) for p in product_nos if p)
        if product_no and product_no not in nos:
            nos.append(int(product_no))
        if nos:
            request_body["available_product"] = "U"
            request_body["available_product_list"] = nos
            request_body["available_category"] = "A"
        else:
            request_body["available_product"] = "A"
            request_body["available_category"] = "A"

    data = await api_request(
        user, db, "POST", "/api/v2/admin/coupons",
        json={"shop_no": 1, "request": request_body},
    )
    coupon = data.get("coupon", {})
    return {
        "coupon_no": str(coupon.get("coupon_no", "")),
        "coupon_code": coupon.get("coupon_code", ""),
    }
