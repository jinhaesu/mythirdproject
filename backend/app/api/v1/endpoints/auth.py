"""Authentication endpoints - Magic Link via Resend."""
import logging
from datetime import timedelta
from typing import Annotated

import resend
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import get_settings
from app.core.security import create_access_token, create_magic_link_token, decode_token
from app.db.database import get_db
from app.models.user import User
from app.schemas.user import UserResponse, Token, MetaConnectionRequest, MagicLinkRequest, MagicLinkVerifyRequest

logger = logging.getLogger(__name__)

router = APIRouter()
settings = get_settings()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/verify-magic-link")


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
    if allowed and email not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="허가되지 않은 이메일입니다."
        )

    # Create magic link token
    magic_token = create_magic_link_token(email)
    magic_link = f"{settings.FRONTEND_URL}?token={magic_token}"

    # Send email via Resend
    try:
        resend.api_key = settings.RESEND_API_KEY
        result = resend.Emails.send({
            "from": settings.RESEND_FROM_EMAIL,
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

    if not user:
        user = User(
            email=email,
            hashed_password="",
            is_active=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)

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
async def get_me(current_user: User = Depends(get_current_user)):
    """Get current user info."""
    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        full_name=current_user.full_name,
        company_name=current_user.company_name,
        is_active=current_user.is_active,
        created_at=current_user.created_at,
        meta_connected=bool(current_user.meta_access_token),
        meta_user_id=current_user.meta_user_id,
        meta_ad_account_id=current_user.meta_ad_account_id,
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
    current_user: User = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Meta OAuth 콜백 처리.

    프론트엔드가 Facebook에서 받은 code를 전달하면:
    1. code → short-lived access token 교환
    2. short-lived → long-lived access token 교환
    3. 사용자 프로필 조회
    4. 광고 계정 목록 조회
    5. DB에 토큰 및 계정 정보 저장
    """
    import httpx

    # state 파라미터(user_id)로 사용자 조회 (OAuth 리다이렉트 후 토큰이 없을 수 있음)
    if current_user is None and state:
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


@router.get("/meta/status")
async def get_meta_connection_status(
    current_user: User = Depends(get_current_user),
):
    """Meta 연결 상태 확인."""
    connected = bool(current_user.meta_access_token)
    result = {
        "connected": connected,
        "meta_user_id": current_user.meta_user_id,
        "meta_ad_account_id": current_user.meta_ad_account_id,
    }

    # Verify token is still valid
    if connected:
        from app.services.meta import MetaGraphAPI
        try:
            meta_api = MetaGraphAPI(current_user.meta_access_token)
            profile = await meta_api.get_user_profile()
            result["meta_name"] = profile.get("name")
            result["token_valid"] = True
        except Exception:
            result["token_valid"] = False
            result["message"] = "토큰이 만료되었습니다. 다시 연결해주세요."

    return result
