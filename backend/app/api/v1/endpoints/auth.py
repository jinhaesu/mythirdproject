"""Authentication endpoints - Magic Link via Resend."""
import logging
from datetime import timedelta
from typing import Annotated, Optional

import resend
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.security import create_access_token, create_magic_link_token, decode_token
from app.db.database import get_db
from app.models.user import User
from app.schemas.user import UserResponse, Token, MetaConnectionRequest, MagicLinkRequest, MagicLinkVerifyRequest

logger = logging.getLogger(__name__)

router = APIRouter()
settings = get_settings()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/verify-magic-link")


async def get_shared_meta_credentials(db: AsyncSession):
    """전체 계정에서 공유하는 Meta 인증 정보를 가져온다 (최초 1회 인증으로 전체 공유)."""
    result = await db.execute(
        select(User).where(User.meta_access_token.isnot(None), User.meta_access_token != "").limit(1)
    )
    return result.scalar_one_or_none()


async def get_shared_cafe24_user(db: AsyncSession) -> Optional[User]:
    """전체 계정에서 공유하는 Cafe24 인증된 User 반환 (최초 1회 연결로 전체 공유)."""
    result = await db.execute(
        select(User).where(
            User.cafe24_access_token.isnot(None),
            User.cafe24_access_token != "",
        ).limit(1)
    )
    return result.scalar_one_or_none()


async def get_shared_naver_user(db: AsyncSession) -> Optional[User]:
    """전체 계정에서 공유하는 Naver 인증된 User 반환."""
    result = await db.execute(
        select(User).where(
            (User.naver_search_ads_connected == True) | (User.naver_gfa_connected == True)  # noqa: E712
        ).limit(1)
    )
    return result.scalar_one_or_none()


async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: AsyncSession = Depends(get_db)
) -> User:
    """Get current authenticated user."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    payload = decode_token(token)
    if payload is None:
        raise credentials_exception

    user_id = payload.get("sub")
    if user_id is None:
        raise credentials_exception

    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()

    if user is None:
        raise credentials_exception

    return user


@router.post("/send-magic-link")
async def send_magic_link(
    request: MagicLinkRequest,
    db: AsyncSession = Depends(get_db)
):
    """Send magic link email for login/signup."""
    email = request.email.lower().strip()

    # Check email whitelist
    allowed = settings.allowed_emails_list
    logger.info(f"Login attempt: {email}, allowed_list: {allowed}")
    if allowed and email not in allowed:
        logger.warning(f"Email rejected: '{email}' not in {allowed}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"허가되지 않은 이메일입니다. ({email})"
        )

    # Create magic link token
    magic_token = create_magic_link_token(email)
    magic_link = f"{settings.FRONTEND_URL}?token={magic_token}"

    # Send email via Resend
    try:
        resend.api_key = settings.RESEND_API_KEY
        from_email = settings.RESEND_FROM_EMAIL or "onboarding@resend.dev"
        if "<" not in from_email:
            from_email = f"Meta-Commander <{from_email}>"
        result = resend.Emails.send({
            "from": from_email,
            "to": [email],
            "subject": "Meta-Commander 로그인 링크",
            "html": f"""
            <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
                <div style="text-align: center; margin-bottom: 32px;">
                    <div style="display: inline-block; width: 48px; height: 48px; background: linear-gradient(135deg, #1877F2, #E1306C); border-radius: 12px; line-height: 48px; color: white; font-weight: bold; font-size: 20px;">M</div>
                    <h1 style="margin: 12px 0 0; font-size: 24px; color: #111;">Meta-Commander</h1>
                </div>
                <p style="color: #555; font-size: 16px; line-height: 1.6;">
                    아래 버튼을 클릭하면 로그인됩니다.<br>이 링크는 10분간 유효합니다.
                </p>
                <div style="text-align: center; margin: 32px 0;">
                    <a href="{magic_link}"
                       style="display: inline-block; padding: 14px 32px; background: #3B82F6; color: white; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: 600;">
                        로그인하기
                    </a>
                </div>
                <p style="color: #999; font-size: 13px;">
                    본인이 요청하지 않았다면 이 이메일을 무시해주세요.
                </p>
            </div>
            """
        })
        logger.info(f"Magic link email sent to {email}, result: {result}")
    except Exception as e:
        logger.error(f"Failed to send magic link email to {email}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"이메일 전송 실패: {str(e)}"
        )

    return {"success": True, "message": "로그인 링크가 이메일로 전송되었습니다."}


@router.post("/verify-magic-link", response_model=Token)
async def verify_magic_link(
    request: MagicLinkVerifyRequest,
    db: AsyncSession = Depends(get_db)
):
    """Verify magic link token and return access token."""
    payload = decode_token(request.token)

    if payload is None or payload.get("type") != "magic_link":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않거나 만료된 링크입니다."
        )

    email = payload.get("sub")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 토큰입니다."
        )

    # Find or create user
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    is_new_user = False
    if not user:
        import uuid as _uuid
        # referral_code 자동 생성 (충돌 3회 재시도)
        referral_code = None
        for _ in range(3):
            candidate = _uuid.uuid4().hex[:8].upper()
            dup = await db.execute(select(User).where(User.referral_code == candidate))
            if not dup.scalar_one_or_none():
                referral_code = candidate
                break

        user = User(
            email=email,
            hashed_password="",
            is_active=True,
            referral_code=referral_code,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        is_new_user = True

    # 신규 가입이고 ref 코드가 있으면 추천인 포인트 처리
    if is_new_user and request.ref:
        try:
            from app.models.affiliate import ReferralProgram
            from app.models.points import PointTransaction

            ref_result = await db.execute(
                select(User).where(User.referral_code == request.ref)
            )
            referrer = ref_result.scalar_one_or_none()

            if referrer:
                user.referred_by_user_id = referrer.id

                # 활성 ReferralProgram 조회 (추천인 전용 우선, 없으면 전역)
                prog_result = await db.execute(
                    select(ReferralProgram).where(
                        ReferralProgram.user_id == referrer.id,
                        ReferralProgram.status == "active",
                    ).limit(1)
                )
                program = prog_result.scalar_one_or_none()

                if program:
                    # 추천인 max_rewards 체크
                    if program.max_rewards_per_user:
                        used_count_result = await db.execute(
                            select(func.count(PointTransaction.id)).where(
                                PointTransaction.user_id == referrer.id,
                                PointTransaction.reason == "referral_bonus_referrer",
                                PointTransaction.program_id == program.id,
                            )
                        )
                        used_count = used_count_result.scalar() or 0
                    else:
                        used_count = 0

                    skip_referrer_bonus = (
                        program.max_rewards_per_user is not None
                        and used_count >= program.max_rewards_per_user
                    )

                    if not skip_referrer_bonus and program.referrer_reward > 0:
                        db.add(PointTransaction(
                            user_id=referrer.id,
                            amount=program.referrer_reward,
                            reason="referral_bonus_referrer",
                            related_user_id=user.id,
                            program_id=program.id,
                            memo=f"추천인 보상 — {user.email}",
                        ))

                    if program.referee_reward > 0:
                        db.add(PointTransaction(
                            user_id=user.id,
                            amount=program.referee_reward,
                            reason="referral_bonus_referee",
                            related_user_id=referrer.id,
                            program_id=program.id,
                            memo=f"피추천인 보상 — {referrer.email}",
                        ))

                await db.commit()
                await db.refresh(user)
        except Exception as e:
            logger.warning(f"[Auth] Referral processing failed: {e}")

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="비활성화된 계정입니다."
        )

    access_token = create_access_token(
        data={"sub": str(user.id)},
        expires_delta=timedelta(days=7)
    )

    return Token(access_token=access_token)


@router.get("/me", response_model=UserResponse)
async def get_me(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get current user info. Meta 인증은 전체 계정 공유."""
    # Meta 인증 정보는 전체 계정에서 공유
    meta_user = current_user if current_user.meta_access_token else await get_shared_meta_credentials(db)
    meta_connected = bool(meta_user and meta_user.meta_access_token)
    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        full_name=current_user.full_name,
        company_name=current_user.company_name,
        is_active=current_user.is_active,
        created_at=current_user.created_at,
        meta_connected=meta_connected,
        meta_user_id=meta_user.meta_user_id if meta_user else None,
        meta_ad_account_id=meta_user.meta_ad_account_id if meta_user else None,
        meta_ig_account_id=meta_user.meta_ig_account_id if meta_user else None,
        brand_settings=None,
    )


@router.post("/connect-meta")
async def connect_meta(
    connection: MetaConnectionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Connect Meta (Facebook/Instagram) account with access token."""
    from app.services.meta import MetaGraphAPI

    try:
        meta_api = MetaGraphAPI(connection.access_token)
        user_info = await meta_api.get_user_profile()

        current_user.meta_access_token = connection.access_token
        current_user.meta_user_id = user_info.get("id")

        if connection.ad_account_id:
            current_user.meta_ad_account_id = connection.ad_account_id

        await db.commit()

        return {
            "success": True,
            "meta_user_id": user_info.get("id"),
            "meta_name": user_info.get("name")
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Meta 계정 연결 실패: {str(e)}"
        )


@router.get("/meta/login-url")
async def get_meta_login_url(
    current_user: User = Depends(get_current_user),
):
    """
    Meta OAuth 로그인 URL 생성.

    프론트엔드에서 이 URL로 리다이렉트하면 Facebook 로그인 화면이 표시됩니다.
    """
    if not settings.META_APP_ID:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="META_APP_ID가 설정되지 않았습니다."
        )

    redirect_uri = f"{settings.FRONTEND_URL}/auth/meta/callback"
    scopes = ",".join([
        "public_profile",
        "pages_show_list",
        "pages_read_engagement",
        "ads_management",
        "ads_read",
        "business_management",
    ])

    login_url = (
        f"https://www.facebook.com/{settings.META_API_VERSION}/dialog/oauth"
        f"?client_id={settings.META_APP_ID}"
        f"&redirect_uri={redirect_uri}"
        f"&scope={scopes}"
        f"&response_type=code"
        f"&state={current_user.id}"
    )

    return {"login_url": login_url, "redirect_uri": redirect_uri}


@router.post("/meta/callback")
async def meta_oauth_callback(
    code: str,
    state: str = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Meta OAuth 콜백 처리 (인증 불필요 - state 파라미터로 유저 식별).

    프론트엔드가 Facebook에서 받은 code를 전달하면:
    1. state에서 user_id 추출
    2. code → short-lived access token 교환
    3. short-lived → long-lived access token 교환
    4. 사용자 프로필 조회
    5. 광고 계정 목록 조회
    6. DB에 토큰 및 계정 정보 저장
    """
    import httpx

    # state 파라미터(user_id)로 사용자 조회
    current_user = None
    if state:
        try:
            result = await db.execute(select(User).where(User.id == int(state)))
            current_user = result.scalar_one_or_none()
        except (ValueError, Exception):
            pass

    if current_user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="사용자를 확인할 수 없습니다. 다시 로그인해주세요."
        )

    if not settings.META_APP_ID or not settings.META_APP_SECRET:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="META_APP_ID와 META_APP_SECRET이 설정되지 않았습니다."
        )

    redirect_uri = f"{settings.FRONTEND_URL}/auth/meta/callback"
    base_url = f"{settings.META_GRAPH_API_BASE}/{settings.META_API_VERSION}"

    async with httpx.AsyncClient() as client:
        # Step 1: Exchange code for short-lived token
        token_response = await client.get(
            f"{base_url}/oauth/access_token",
            params={
                "client_id": settings.META_APP_ID,
                "client_secret": settings.META_APP_SECRET,
                "redirect_uri": redirect_uri,
                "code": code,
            }
        )

        if token_response.status_code != 200:
            logger.error(f"Meta token exchange failed: {token_response.text}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Meta 토큰 교환 실패: {token_response.text}"
            )

        token_data = token_response.json()
        short_lived_token = token_data.get("access_token")

        if not short_lived_token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Meta에서 access_token을 받지 못했습니다."
            )

        # Step 2: Exchange for long-lived token (60-day expiry)
        long_token_response = await client.get(
            f"{base_url}/oauth/access_token",
            params={
                "grant_type": "fb_exchange_token",
                "client_id": settings.META_APP_ID,
                "client_secret": settings.META_APP_SECRET,
                "fb_exchange_token": short_lived_token,
            }
        )

        long_lived_token = short_lived_token  # fallback
        if long_token_response.status_code == 200:
            long_data = long_token_response.json()
            long_lived_token = long_data.get("access_token", short_lived_token)

        # Step 3: Get user profile
        profile_response = await client.get(
            f"{base_url}/me",
            params={
                "access_token": long_lived_token,
                "fields": "id,name,email",
            }
        )

        if profile_response.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Meta 프로필 조회 실패"
            )

        profile = profile_response.json()

        # Step 4: Get ad accounts
        ad_accounts_response = await client.get(
            f"{base_url}/me/adaccounts",
            params={
                "access_token": long_lived_token,
                "fields": "id,name,account_id,currency,timezone_name,account_status",
            }
        )

        ad_accounts = []
        if ad_accounts_response.status_code == 200:
            ad_accounts = ad_accounts_response.json().get("data", [])

        # Step 5: Get Pages (for Instagram Business Account)
        pages_response = await client.get(
            f"{base_url}/me/accounts",
            params={
                "access_token": long_lived_token,
                "fields": "id,name,instagram_business_account{id,username}",
            }
        )

        pages = []
        if pages_response.status_code == 200:
            pages = pages_response.json().get("data", [])

        # Save to DB
        current_user.meta_access_token = long_lived_token
        current_user.meta_user_id = profile.get("id")

        # Auto-select first ad account if available
        if ad_accounts and not current_user.meta_ad_account_id:
            current_user.meta_ad_account_id = ad_accounts[0].get("account_id")

        # Save Page ID and IG Business Account ID from pages
        for page in pages:
            if not current_user.meta_page_id and page.get("id"):
                current_user.meta_page_id = page["id"]
            ig_biz = page.get("instagram_business_account")
            if ig_biz and ig_biz.get("id"):
                current_user.meta_ig_account_id = ig_biz["id"]
            if current_user.meta_page_id and current_user.meta_ig_account_id:
                break

        # Fetch Pixel ID from ad account
        ad_account_for_pixel = current_user.meta_ad_account_id
        if ad_account_for_pixel:
            pixel_prefix = ad_account_for_pixel if ad_account_for_pixel.startswith("act_") else f"act_{ad_account_for_pixel}"
            try:
                pixel_response = await client.get(
                    f"{base_url}/{pixel_prefix}/adspixels",
                    params={"access_token": long_lived_token, "fields": "id,name"}
                )
                if pixel_response.status_code == 200:
                    pixels = pixel_response.json().get("data", [])
                    if pixels:
                        current_user.meta_pixel_id = pixels[0].get("id")
                        logger.info(f"Saved pixel_id: {current_user.meta_pixel_id}")
            except Exception as e:
                logger.warning(f"Failed to fetch pixel: {e}")

        await db.commit()

        return {
            "success": True,
            "meta_user_id": profile.get("id"),
            "meta_name": profile.get("name"),
            "meta_email": profile.get("email"),
            "ad_accounts": [
                {
                    "id": acc.get("id"),
                    "account_id": acc.get("account_id"),
                    "name": acc.get("name"),
                    "currency": acc.get("currency"),
                    "timezone": acc.get("timezone_name"),
                    "status": acc.get("account_status"),
                }
                for acc in ad_accounts
            ],
            "pages": [
                {
                    "id": page.get("id"),
                    "name": page.get("name"),
                    "instagram": page.get("instagram_business_account"),
                }
                for page in pages
            ],
            "token_type": "long_lived",
        }


@router.post("/meta/select-ad-account")
async def select_ad_account(
    ad_account_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """광고 계정 선택/변경."""
    if not current_user.meta_access_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Meta 계정이 연결되지 않았습니다."
        )

    current_user.meta_ad_account_id = ad_account_id
    await db.commit()

    return {
        "success": True,
        "ad_account_id": ad_account_id,
        "message": "광고 계정이 선택되었습니다."
    }


@router.post("/meta/disconnect")
async def disconnect_meta(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Meta 계정 연동 해제."""
    current_user.meta_access_token = None
    current_user.meta_user_id = None
    current_user.meta_ad_account_id = None
    current_user.meta_ig_account_id = None
    current_user.meta_page_id = None
    current_user.meta_pixel_id = None
    await db.commit()
    return {"success": True, "message": "Meta 계정 연동이 해제되었습니다."}


@router.get("/meta/status")
async def get_meta_connection_status(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Meta 연결 상태 확인 (전체 계정 공유)."""
    meta_user = current_user if current_user.meta_access_token else await get_shared_meta_credentials(db)
    connected = bool(meta_user and meta_user.meta_access_token)
    result = {
        "connected": connected,
        "meta_user_id": meta_user.meta_user_id if meta_user else None,
        "meta_ad_account_id": meta_user.meta_ad_account_id if meta_user else None,
    }

    # Verify token is still valid and fetch account details
    if connected and meta_user:
        from app.services.meta import MetaGraphAPI, MetaMarketingAPI
        try:
            graph_api = MetaGraphAPI(meta_user.meta_access_token)
            profile = await graph_api.get_user_profile()
            result["meta_name"] = profile.get("name")
            result["token_valid"] = True

            # Fetch pages, IG account, ad accounts
            marketing_api = MetaMarketingAPI(
                meta_user.meta_access_token,
                meta_user.meta_ad_account_id,
            )
            pages = await marketing_api.get_pages()

            # Enrich each page with its connected Instagram accounts
            enriched_pages = []
            ig_account_id = None
            ig_username = None
            for page in pages:
                page_entry = dict(page)
                try:
                    ig_data = await graph_api.get_instagram_account(page["id"])
                    ig_biz = ig_data.get("instagram_business_account")
                    if ig_biz:
                        biz_id = ig_biz.get("id")
                        try:
                            ig_profile = await graph_api._request(
                                "GET", biz_id,
                                params={"fields": "id,username,name"}
                            )
                            page_entry["instagram_accounts"] = [ig_profile]
                            # Use first found IG account for top-level fields
                            if ig_account_id is None:
                                ig_account_id = biz_id
                                ig_username = ig_profile.get("username")
                        except Exception:
                            page_entry["instagram_accounts"] = [{"id": biz_id}]
                            if ig_account_id is None:
                                ig_account_id = biz_id
                    else:
                        page_entry["instagram_accounts"] = []
                except Exception:
                    page_entry["instagram_accounts"] = []
                enriched_pages.append(page_entry)

            result["pages"] = enriched_pages
            result["ig_account_id"] = ig_account_id
            result["ig_username"] = ig_username

            # Fetch all ad accounts
            try:
                ad_accounts_resp = await graph_api._request(
                    "GET", "me/adaccounts",
                    params={"fields": "id,name,currency,account_status", "limit": 50}
                )
                result["ad_accounts"] = ad_accounts_resp.get("data", [])
            except Exception:
                result["ad_accounts"] = []

            # Threads profile (if available)
            try:
                threads_resp = await graph_api._request(
                    "GET", "me",
                    params={"fields": "threads_profile_picture_url,name"}
                )
                result["threads_profile"] = threads_resp.get("name")
            except Exception:
                result["threads_profile"] = None

        except Exception:
            result["token_valid"] = False
            result["message"] = "토큰이 만료되었습니다. 다시 연결해주세요."

    return result


@router.put("/meta/settings")
async def update_meta_settings(
    page_id: Optional[str] = None,
    instagram_account_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Save the user's preferred Meta Page ID and Instagram account ID.

    Both fields are optional; only provided fields are updated.
    """
    if not current_user.meta_access_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Meta 계정이 연결되지 않았습니다."
        )

    if page_id is not None:
        current_user.meta_page_id = page_id
    if instagram_account_id is not None:
        current_user.meta_ig_account_id = instagram_account_id

    await db.commit()

    return {
        "success": True,
        "meta_page_id": current_user.meta_page_id,
        "meta_ig_account_id": current_user.meta_ig_account_id,
        "message": "대표 계정 설정이 저장되었습니다.",
    }


@router.get("/connections-status")
async def get_connections_status(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """모든 외부 플랫폼 연결 상태 한번에 반환 (Cafe24 / Meta / Naver)."""
    from datetime import datetime as _dt, timedelta as _td

    # Cafe24 (shared)
    cafe24_user = current_user if current_user.cafe24_access_token else await get_shared_cafe24_user(db)
    cafe24_connected = bool(cafe24_user and cafe24_user.cafe24_access_token)
    cafe24_expiring = False
    if cafe24_connected and cafe24_user.cafe24_token_expires_at:
        # 만료 1시간 내 = 경고 (이미 만료됐을 수도)
        delta = cafe24_user.cafe24_token_expires_at - _dt.utcnow()
        cafe24_expiring = delta < _td(hours=1)

    # Meta (shared)
    meta_user = current_user if current_user.meta_access_token else await get_shared_meta_credentials(db)
    meta_connected = bool(meta_user and meta_user.meta_access_token)

    # Naver (shared)
    naver_user = current_user if (current_user.naver_search_ads_connected or current_user.naver_gfa_connected) else await get_shared_naver_user(db)
    naver_connected = bool(naver_user and (naver_user.naver_search_ads_connected or naver_user.naver_gfa_connected))

    return {
        "cafe24": {
            "connected": cafe24_connected,
            "mall_id": cafe24_user.cafe24_mall_id if cafe24_user else None,
            "expires_at": cafe24_user.cafe24_token_expires_at.isoformat() if cafe24_connected and cafe24_user and cafe24_user.cafe24_token_expires_at else None,
            "expiring_soon": cafe24_expiring,
        },
        "meta": {
            "connected": meta_connected,
            "user_id": meta_user.meta_user_id if meta_user else None,
            "ad_account_id": meta_user.meta_ad_account_id if meta_user else None,
        },
        "naver": {
            "connected": naver_connected,
            "search_ads": bool(naver_user.naver_search_ads_connected) if naver_user else False,
            "gfa": bool(naver_user.naver_gfa_connected) if naver_user else False,
        },
    }
