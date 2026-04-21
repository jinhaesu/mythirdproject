"""SMS sending service — Solapi (쿨SMS) based."""
import hashlib
import hmac
import logging
import uuid
from datetime import datetime
from typing import Optional

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


def _auth_header(api_key: str, api_secret: str) -> str:
    """Solapi HMAC-SHA256 서명 헤더 생성."""
    date = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")
    salt = uuid.uuid4().hex
    data = date + salt
    signature = hmac.new(api_secret.encode(), data.encode(), hashlib.sha256).hexdigest()
    return f"HMAC-SHA256 apiKey={api_key}, date={date}, salt={salt}, signature={signature}"


async def send_sms(to_phone: str, message: str, from_phone: Optional[str] = None) -> dict:
    """
    Solapi를 통해 SMS 발송.

    환경변수:
      SOLAPI_API_KEY    — Solapi 콘솔에서 발급
      SOLAPI_API_SECRET — Solapi 콘솔에서 발급
      SOLAPI_SENDER     — 발신번호 (Solapi 콘솔 사전 등록 필수)

    Args:
        to_phone:   수신 전화번호 (하이픈 포함/미포함 모두 허용)
        message:    발송할 문자 내용
        from_phone: 발신번호 오버라이드 (None 이면 SOLAPI_SENDER 사용)

    Returns:
        {"success": True, "response": {...}} 또는 {"success": False, "reason": "..."}
    """
    api_key = settings.SOLAPI_API_KEY
    api_secret = settings.SOLAPI_API_SECRET
    sender = from_phone or settings.SOLAPI_SENDER

    if not (api_key and api_secret and sender):
        logger.warning(f"[SMS] Solapi 미설정 — 발송 건너뜀. to={to_phone}")
        return {"success": False, "reason": "sms_not_configured"}

    # 전화번호 정규화 (하이픈/공백 제거)
    to_clean = to_phone.replace("-", "").replace(" ", "")
    from_clean = sender.replace("-", "").replace(" ", "")

    payload = {
        "message": {
            "to": to_clean,
            "from": from_clean,
            "text": message,
        }
    }

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://api.solapi.com/messages/v4/send",
                headers={
                    "Authorization": _auth_header(api_key, api_secret),
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            if resp.status_code >= 400:
                logger.error(f"[SMS] Solapi 실패 {resp.status_code}: {resp.text[:200]}")
                return {"success": False, "reason": resp.text[:200]}
            logger.info(f"[SMS] Sent to {to_clean}")
            return {"success": True, "response": resp.json()}
    except Exception as e:
        logger.error(f"[SMS] 예외: {e}")
        return {"success": False, "reason": str(e)}
