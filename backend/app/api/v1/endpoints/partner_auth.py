"""파트너 포털 인증 — 매직링크 이메일 로그인."""
import logging
from datetime import timedelta
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, decode_token
from app.db.database import get_db
from app.models.affiliate import AffiliatePartner

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter()

_partner_oauth2 = OAuth2PasswordBearer(tokenUrl="/api/v1/partner/auth/verify")


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class SendMagicLinkRequest(BaseModel):
    email: str


class SendSmsLinkRequest(BaseModel):
    phone: str


class VerifyMagicLinkRequest(BaseModel):
    token: str


def _normalize_phone(raw: str) -> str:
    """휴대폰 번호 정규화 — 숫자만 추출."""
    return "".join(c for c in (raw or "") if c.isdigit())


# ---------------------------------------------------------------------------
# Dependency: 현재 파트너 확인
# ---------------------------------------------------------------------------

async def get_current_partner(
    token: Annotated[str, Depends(_partner_oauth2)],
    db: AsyncSession = Depends(get_db),
) -> AffiliatePartner:
    """파트너 JWT 토큰을 검증하고 AffiliatePartner 객체를 반환하는 의존성."""
    payload = decode_token(token)
    if not payload or payload.get("type") != "partner":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 파트너 토큰입니다.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        partner_id = int(payload.get("sub"))
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="토큰 형식이 올바르지 않습니다.",
        )

    r = await db.execute(
        select(AffiliatePartner).where(
            AffiliatePartner.id == partner_id,
            AffiliatePartner.deleted_at.is_(None),
        )
    )
    partner = r.scalar_one_or_none()
    if not partner:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="파트너를 찾을 수 없거나 삭제된 계정입니다.",
        )
    return partner


# ---------------------------------------------------------------------------
# 엔드포인트
# ---------------------------------------------------------------------------

@router.post("/send-magic-link")
async def send_magic_link(
    request: SendMagicLinkRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    파트너 포털 로그인 매직링크 발송.

    - approved 상태이고 deleted_at IS NULL 인 파트너만 허용
    - 유효 시간: 10분
    - 발송 수단: Resend 이메일
    """
    email = request.email.lower().strip()

    r = await db.execute(
        select(AffiliatePartner).where(
            AffiliatePartner.email == email,
            AffiliatePartner.status == "approved",
            AffiliatePartner.deleted_at.is_(None),
        )
    )
    partner = r.scalar_one_or_none()
    if not partner:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="등록된 파트너가 아닙니다.",
        )

    # 매직링크 토큰 생성 (sub=partner.id, type=partner_magic_link, exp=10분)
    token = create_access_token(
        data={"sub": str(partner.id), "type": "partner_magic_link"},
        expires_delta=timedelta(minutes=10),
    )
    magic_link = f"{settings.FRONTEND_URL}/partner?token={token}"

    if not settings.RESEND_API_KEY:
        logger.warning("[PartnerAuth] RESEND_API_KEY 미설정 — 이메일 발송 건너뜀")
        return {"success": True, "message": "로그인 링크가 이메일로 전송되었습니다. (개발 모드)"}

    try:
        from_email = settings.RESEND_FROM_EMAIL or "onboarding@resend.dev"
        if "<" not in from_email:
            from_email = f"널담 어필리에이트 <{from_email}>"

        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
                json={
                    "from": from_email,
                    "to": [email],
                    "subject": "[널담 어필리에이트] 로그인 링크",
                    "html": (
                        f"<div style='font-family:Apple SD Gothic Neo,sans-serif;max-width:480px;margin:0 auto;padding:40px 20px;'>"
                        f"<h2 style='color:#111;'>안녕하세요, {partner.name}님!</h2>"
                        f"<p style='color:#555;font-size:16px;line-height:1.6;'>"
                        f"아래 버튼을 클릭하면 파트너 포털에 로그인됩니다.<br>"
                        f"이 링크는 <strong>10분간</strong>만 유효합니다.</p>"
                        f"<div style='text-align:center;margin:32px 0;'>"
                        f"<a href='{magic_link}' "
                        f"style='display:inline-block;padding:14px 32px;background:#3B82F6;"
                        f"color:white;text-decoration:none;border-radius:8px;font-size:16px;font-weight:600;'>"
                        f"파트너 포털 로그인</a></div>"
                        f"<p style='color:#999;font-size:13px;'>"
                        f"본인이 요청하지 않았다면 이 이메일을 무시해주세요.</p>"
                        f"</div>"
                    ),
                },
            )
        if resp.status_code >= 400:
            logger.error(f"[PartnerAuth] Resend 실패 {resp.status_code}: {resp.text[:200]}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="이메일 전송에 실패했습니다. 잠시 후 다시 시도해주세요.",
            )
        logger.info(f"[PartnerAuth] 매직링크 발송 완료 → {email}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[PartnerAuth] 이메일 발송 예외: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"이메일 전송 실패: {str(e)}",
        )

    return {"success": True, "message": "로그인 링크가 이메일로 전송되었습니다."}


@router.post("/send-sms-link")
async def send_sms_link(
    request: SendSmsLinkRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    파트너 포털 로그인 매직링크를 SMS로 발송 (이메일 미등록 파트너용).

    - approved 상태이고 deleted_at IS NULL 인 파트너만 허용
    - 입력 phone과 DB phone을 숫자만 비교 (하이픈/공백 무시)
    - 유효 시간: 10분
    """
    target_digits = _normalize_phone(request.phone)
    if len(target_digits) < 9:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="유효한 휴대폰 번호를 입력하세요.",
        )

    r = await db.execute(
        select(AffiliatePartner).where(
            AffiliatePartner.status == "approved",
            AffiliatePartner.deleted_at.is_(None),
            AffiliatePartner.phone.isnot(None),
        )
    )
    matched: AffiliatePartner | None = None
    for p in r.scalars().all():
        if _normalize_phone(p.phone or "") == target_digits:
            matched = p
            break

    if not matched:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="등록된 파트너 연락처를 찾을 수 없습니다.",
        )

    token = create_access_token(
        data={"sub": str(matched.id), "type": "partner_magic_link"},
        expires_delta=timedelta(minutes=10),
    )
    magic_link = f"{settings.FRONTEND_URL}/partner?token={token}"

    try:
        from app.services.sms import send_sms
        sms_message = (
            f"[널담] {matched.name}님 로그인 링크입니다 (10분 유효).\n{magic_link}"
        )
        sms_result = await send_sms(matched.phone, sms_message)
        if not sms_result.get("success"):
            logger.warning(
                f"[PartnerAuth] SMS 매직링크 발송 실패: {sms_result.get('reason')}"
            )
    except Exception as e:
        logger.error(f"[PartnerAuth] SMS 발송 예외: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="문자 메시지 발송에 실패했습니다.",
        )

    return {"success": True, "message": "로그인 링크를 문자로 전송했습니다."}


@router.post("/verify")
async def verify_magic_link(
    request: VerifyMagicLinkRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    파트너 매직링크 토큰 검증 후 장기 액세스 토큰 발급.

    - type='partner_magic_link' 확인
    - 파트너 approved + not deleted 확인
    - 7일 유효 JWT 반환
    """
    import json as _json

    payload = decode_token(request.token)
    if not payload or payload.get("type") != "partner_magic_link":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않거나 만료된 링크입니다.",
        )

    try:
        partner_id = int(payload.get("sub"))
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="토큰 형식이 올바르지 않습니다.",
        )

    r = await db.execute(
        select(AffiliatePartner).where(
            AffiliatePartner.id == partner_id,
            AffiliatePartner.status == "approved",
            AffiliatePartner.deleted_at.is_(None),
        )
    )
    partner = r.scalar_one_or_none()
    if not partner:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="파트너를 찾을 수 없거나 승인되지 않은 계정입니다.",
        )

    access_token = create_access_token(
        data={"sub": str(partner.id), "type": "partner"},
        expires_delta=timedelta(days=7),
    )

    # channels JSON 파싱
    channels = None
    if partner.channels:
        try:
            parsed = _json.loads(partner.channels)
            channels = parsed if isinstance(parsed, list) else None
        except Exception:
            channels = [c.strip() for c in partner.channels.split(",") if c.strip()]

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "partner": {
            "id": partner.id,
            "name": partner.name,
            "email": partner.email,
            "phone": partner.phone,
            "channel": partner.channel,
            "channels": channels,
        },
    }
