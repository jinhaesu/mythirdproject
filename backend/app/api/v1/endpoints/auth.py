"""Authentication endpoints - Magic Link via Resend."""
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

    # Create magic link token
    magic_token = create_magic_link_token(email)
    magic_link = f"{settings.FRONTEND_URL}?token={magic_token}"

    # Send email via Resend
    try:
        resend.api_key = settings.RESEND_API_KEY
        resend.Emails.send({
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
    except Exception as e:
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
    return current_user


@router.post("/connect-meta")
async def connect_meta(
    connection: MetaConnectionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Connect Meta (Facebook/Instagram) account."""
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
