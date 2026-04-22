"""Webhook endpoints — Cafe24 주문 이벤트 수신."""
import base64
import hashlib
import hmac
import json
import logging
import re
from datetime import datetime, timedelta

from fastapi import APIRouter, Request, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.database import get_db
from app.models.affiliate import (
    AffiliateCampaign,
    AffiliatePartner,
    ReferralClick,
    ReferralConversion,
)

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter()


def _verify_hmac(raw: bytes, signature: str) -> bool:
    """
    Cafe24 웹훅 HMAC-SHA256 서명 검증.
    Cafe24는 앱의 Client Secret으로 서명. CAFE24_WEBHOOK_SECRET이 별도 설정돼 있으면 그걸 우선.
    """
    if not signature:
        return False
    # 우선순위: CAFE24_WEBHOOK_SECRET (명시적 override) → CAFE24_CLIENT_SECRET (Cafe24 기본)
    candidates = [
        settings.CAFE24_WEBHOOK_SECRET,
        settings.CAFE24_CLIENT_SECRET,
    ]
    for secret in candidates:
        if not secret:
            continue
        computed = base64.b64encode(
            hmac.new(secret.encode(), raw, hashlib.sha256).digest()
        ).decode()
        if hmac.compare_digest(computed, signature):
            return True
    return False


def _extract_ref_code(text: str) -> str | None:
    """URL 또는 텍스트에서 ref= 파라미터 추출."""
    if not text:
        return None
    m = re.search(r"ref=([A-Za-z0-9_-]+)", text)
    return m.group(1) if m else None


@router.get("/cafe24/orders")
async def cafe24_order_webhook_health():
    """GET 응답 — Cafe24의 endpoint 존재 확인용."""
    return {"status": "ok", "endpoint": "cafe24_order_webhook"}


@router.api_route("/debug/{full_path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def webhook_debug_catchall(full_path: str, request: Request):
    """
    디버그용: /webhooks/debug/{anything} 로 들어오는 모든 요청을 로그.
    Cafe24가 혹시 다른 경로로 쏘는지 추적용.
    """
    body = await request.body()
    headers = {k: v for k, v in request.headers.items() if k.lower().startswith(("x-", "content-", "user-"))}
    logger.info(
        f"[Webhook DEBUG] {request.method} /webhooks/debug/{full_path} "
        f"headers={headers} body={body[:500]!r}"
    )
    return {"status": "logged", "path": full_path, "method": request.method}


@router.api_route("/cafe24/{full_path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def cafe24_catchall(full_path: str, request: Request):
    """
    Cafe24 네임스페이스 catch-all — /webhooks/cafe24/orders 외의 경로로 쏘는 경우 포착.
    """
    if full_path == "orders" and request.method in ("GET", "POST"):
        # 정식 핸들러로 위임 방지 — 이 함수는 정식 경로가 아닌 경우만 처리
        # FastAPI는 구체적 경로가 우선하므로 여기 안 들어옴
        pass
    body = await request.body()
    headers = {k: v for k, v in request.headers.items() if k.lower().startswith(("x-", "content-", "user-"))}
    logger.warning(
        f"[Webhook CATCHALL] {request.method} /webhooks/cafe24/{full_path} "
        f"headers={headers} body_len={len(body)} body_preview={body[:300]!r}"
    )
    return {"status": "caught", "method": request.method, "path": full_path}


@router.post("/cafe24/orders")
async def cafe24_order_webhook(request: Request):
    """
    Cafe24 주문 웹훅.

    HMAC 서명 검증 후 쿠폰/ref 코드로 매칭해 ReferralConversion에 기록.
    서명 실패 시 Cafe24 test 버튼 케이스는 200으로 수용(DB 업데이트 없음) —
    실제 운영 데이터는 서명 검증된 요청만 기록.
    """
    raw = await request.body()
    signature = request.headers.get("X-Cafe24-Hmac-Sha256", "")
    hmac_ok = _verify_hmac(raw, signature)

    try:
        data = json.loads(raw) if raw else {}
    except Exception:
        raise HTTPException(status_code=400, detail="JSON 파싱 실패")

    # 테스트 샘플 식별 (Cafe24 test button 전송 payload)
    resource_pre = data.get("resource", {}) if isinstance(data, dict) else {}
    is_sample = (
        resource_pre.get("mall_id") in ("cafe24bestshop", None, "")
        or resource_pre.get("order_id") in ("20200716-0000023", None, "")
    )

    if not hmac_ok:
        if is_sample:
            logger.info(
                f"[Webhook] test 샘플 수신 (HMAC 미일치) — 200 응답, DB 기록 생략. "
                f"order={resource_pre.get('order_id')} event_code={resource_pre.get('event_code')}"
            )
            return {"status": "test_accepted", "hmac_verified": False}
        logger.warning(
            f"[Webhook] HMAC 서명 불일치 — sig_len={len(signature)} body_len={len(raw)}"
        )
        raise HTTPException(status_code=401, detail="HMAC 서명 불일치")

    resource = data.get("resource", {})
    order_id = resource.get("order_id")
    mall_id = resource.get("mall_id")
    used_coupons = resource.get("coupons") or resource.get("order_coupons") or []
    total_price = float(
        resource.get("order_price_amount") or resource.get("payment_amount")
        or resource.get("actual_payment_amount") or 0
    )
    buyer_id = resource.get("buyer_id") or resource.get("member_id")
    order_memo = (
        resource.get("order_memo")
        or resource.get("shipping_message")
        or ""
    )
    landing_url_in_payload = (
        resource.get("landing_url")
        or resource.get("order_place_name")
        or ""
    )

    # ── 이벤트 타입 판별 (환불/취소 vs 신규 주문) ────────────────────────────
    # Cafe24 실제 payload: resource.event_code = "refund_order" / "cancel_order" 등
    event_no = str(data.get("event_no") or resource.get("event_no") or "").lower()
    event_code_field = str(resource.get("event_code") or data.get("event_code") or "").lower()
    resource_name = str(data.get("resource_name") or resource.get("resource_name") or "").lower()
    topic = str(data.get("topic") or "").lower()

    event_blob = f"{event_no} {event_code_field} {resource_name} {topic}"
    # 단어 경계 매칭 — "cancellation_rules" 같은 단어 일부만 매칭되는 오판 방지
    is_refund = bool(re.search(r"\brefund(ed|s)?\b|\brefund_", event_blob))
    is_cancel = bool(re.search(r"\bcancel(led|ed|lation)?\b|\bcancel_", event_blob))

    # payload 내부 상태값 추가 heuristic
    refund_status = str(resource.get("refund_status") or "").lower()
    order_status = str(resource.get("order_status") or resource.get("status") or "").lower()
    if refund_status in ("refunded", "refund_complete", "approved"):
        is_refund = True
    if order_status in ("cancelled", "canceled", "cancel_complete"):
        is_cancel = True

    if is_refund and is_cancel:
        # 둘 다 True면 환불 우선 — 로그로 모호성 명시
        logger.warning(
            f"[Webhook] order={order_id} — 환불과 취소 양쪽 플래그 True, refund 우선 처리"
        )

    logger.info(
        f"[Webhook] event={event_code}/{resource_name}/{topic} "
        f"order={order_id} refund_status={refund_status} order_status={order_status} "
        f"is_refund={is_refund} is_cancel={is_cancel}"
    )
    # ─────────────────────────────────────────────────────────────────────────

    if not order_id:
        return {"status": "skipped", "reason": "order_id 없음"}

    # DB 세션은 직접 생성 (Depends 미사용 — 인증 없는 엔드포인트)
    from app.db.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        # ── 환불 이벤트 처리 ──────────────────────────────────────────────────
        if is_refund or is_cancel:
            existing = await db.execute(
                select(ReferralConversion).where(ReferralConversion.cafe24_order_id == order_id)
            )
            conv = existing.scalar_one_or_none()
            if conv:
                new_status = "refunded" if is_refund else "cancelled"
                refunded_amt = float(resource.get("refund_amount") or conv.order_amount)
                conv.status = new_status
                conv.refunded_amount = refunded_amt
                conv.refunded_at = datetime.utcnow()
                await db.commit()
                logger.info(
                    f"[Webhook] order={order_id} action={new_status} "
                    f"refunded_amount={refunded_amt} conversion_id={conv.id}"
                )
                return {"status": f"{new_status}_recorded", "conversion_id": conv.id}
            else:
                logger.info(
                    f"[Webhook] order={order_id} action={'refund' if is_refund else 'cancel'}_no_conversion"
                )
                return {"status": "no_conversion_found", "order_id": order_id}

        # ── 중복 체크 (신규 주문 흐름) ───────────────────────────────────────
        dup = await db.execute(
            select(ReferralConversion).where(ReferralConversion.cafe24_order_id == order_id)
        )
        if dup.scalar_one_or_none():
            return {"status": "duplicate"}

        # ── Attribution 우선순위 ─────────────────────────────
        # 1) ref= 파라미터 먼저 (PartnerCampaign → AffiliatePartner → AffiliateCampaign)
        # 2) 쿠폰 코드로 캠페인 매칭
        # 3) 양쪽 다 없으면 스킵
        # ─────────────────────────────────────────────────────
        from app.models.partner_campaign import PartnerCampaign as PC

        campaign = None
        partner = None
        click_id = None

        ref_code = _extract_ref_code(order_memo) or _extract_ref_code(landing_url_in_payload)

        if ref_code:
            # PartnerCampaign 우선
            pc_result = await db.execute(
                select(PC).where(PC.referral_code == ref_code)
            )
            pc = pc_result.scalar_one_or_none()
            if pc:
                partner_id_ref = pc.partner_id
                p_result = await db.execute(
                    select(AffiliatePartner).where(AffiliatePartner.id == partner_id_ref)
                )
                partner = p_result.scalar_one_or_none()
                camp_result = await db.execute(
                    select(AffiliateCampaign).where(AffiliateCampaign.id == pc.campaign_id)
                )
                campaign = camp_result.scalar_one_or_none()
            else:
                # AffiliatePartner 코드
                p_result = await db.execute(
                    select(AffiliatePartner).where(AffiliatePartner.referral_code == ref_code)
                )
                partner = p_result.scalar_one_or_none()
                # 캠페인은 쿠폰으로 보완 매칭
                if partner and partner.campaign_id:
                    camp_result = await db.execute(
                        select(AffiliateCampaign).where(AffiliateCampaign.id == partner.campaign_id)
                    )
                    campaign = camp_result.scalar_one_or_none()
                else:
                    # AffiliateCampaign 자체 코드
                    camp_result = await db.execute(
                        select(AffiliateCampaign).where(AffiliateCampaign.referral_code == ref_code)
                    )
                    campaign = camp_result.scalar_one_or_none()

        # 쿠폰 코드로 캠페인 보완/덮어쓰기
        coupon_codes = [c.get("coupon_code") or c.get("code") for c in used_coupons if c.get("coupon_code") or c.get("code")]
        if not campaign:
            for coupon_code in coupon_codes:
                camp_result = await db.execute(
                    select(AffiliateCampaign).where(AffiliateCampaign.cafe24_coupon_code == coupon_code)
                )
                campaign = camp_result.scalar_one_or_none()
                if campaign:
                    break

        # 쿠폰/ref 없으면 "최근 클릭 전역 fallback" — 쿠폰 미사용 정책 대응
        # 최근 2시간 내 클릭이 있으면 그 파트너/캠페인으로 귀속
        if not campaign and not partner:
            since_recent = datetime.utcnow() - timedelta(hours=2)
            recent_click_r = await db.execute(
                select(ReferralClick)
                .where(ReferralClick.clicked_at >= since_recent)
                .order_by(ReferralClick.clicked_at.desc())
                .limit(1)
            )
            recent_click = recent_click_r.scalar_one_or_none()
            if recent_click:
                click_id = recent_click.id
                p_result = await db.execute(
                    select(AffiliatePartner).where(AffiliatePartner.id == recent_click.partner_id)
                )
                partner = p_result.scalar_one_or_none()
                if recent_click.campaign_id:
                    camp_result = await db.execute(
                        select(AffiliateCampaign).where(AffiliateCampaign.id == recent_click.campaign_id)
                    )
                    campaign = camp_result.scalar_one_or_none()
                logger.info(
                    f"[Webhook] order={order_id} — 전역 최근 클릭 fallback: "
                    f"click={click_id} partner={recent_click.partner_id} campaign={recent_click.campaign_id}"
                )

        if not campaign and not partner:
            logger.info(
                f"[Webhook] order={order_id} — 매칭 없음 (coupons={coupon_codes}, ref={ref_code})"
            )
            return {"status": "no_match"}

        # 파트너 미확정 시 같은 캠페인 최근 클릭으로 보완
        if not partner and campaign:
            since = datetime.utcnow() - timedelta(days=7)
            click_result = await db.execute(
                select(ReferralClick)
                .where(
                    ReferralClick.campaign_id == campaign.id,
                    ReferralClick.clicked_at >= since,
                )
                .order_by(ReferralClick.clicked_at.desc())
                .limit(1)
            )
            click = click_result.scalar_one_or_none()
            if click:
                click_id = click.id
                p_result = await db.execute(
                    select(AffiliatePartner).where(AffiliatePartner.id == click.partner_id)
                )
                partner = p_result.scalar_one_or_none()

        if not partner:
            logger.info(f"[Webhook] order={order_id} — 파트너 attribution 실패")
            return {"status": "no_partner_match"}

        # 커미션 계산
        commission_amount = 0.0
        if campaign.commission_type == "percentage":
            commission_amount = total_price * (campaign.commission_rate / 100)
        else:
            commission_amount = campaign.commission_rate

        conversion = ReferralConversion(
            click_id=click_id,
            partner_id=partner.id,
            campaign_id=campaign.id,
            order_id=order_id,
            cafe24_order_id=order_id,
            order_amount=total_price,
            commission_amount=round(commission_amount, 2),
            status="paid",
        )
        db.add(conversion)
        await db.commit()
        await db.refresh(conversion)

        logger.info(
            f"[Webhook] Conversion recorded: order={order_id} "
            f"partner={partner.id} campaign={campaign.id} commission={commission_amount} action=paid"
        )
        return {"status": "recorded", "conversion_id": conversion.id}
