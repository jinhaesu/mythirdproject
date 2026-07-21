"""구매자 식별 기반 주문 귀속 헬퍼.

폴러(cafe24_poller)와 웹훅(webhooks) 양쪽에서 공유하는 귀속 우선순위 도구:

1. AffiliateOrderBind — tracker.js가 주문완료 페이지에서 보낸 (주문번호 ↔ 클릭) 확정 바인딩
2. ref 코드 — 주문 메모 등에 명시된 레퍼럴 코드 (호출측 기존 로직)
3. AffiliateMemberLink — 과거 확정 귀속된 회원의 재구매 (클릭 없이도 귀속)

라스트클릭 추정(쿠폰→최근 클릭, 상품→2시간 내 클릭)은 settings.ATTRIBUTION_STRICT
가 True면 호출측에서 중단한다.
"""
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.affiliate import (
    AffiliateMemberLink,
    AffiliateOrderBind,
    AffiliatePartner,
    ReferralClick,
)

logger = logging.getLogger(__name__)

# 확정 신호로 인정하는 귀속 소스 — 이 소스로 귀속된 주문만 member link를 생성한다.
STRONG_SOURCES = {"bind", "ref"}

# 커미션 적립·매출 집계를 인정하는 귀속 계보:
# - bind/ref: 직접 확정 신호
# - coupon: 파트너 전용 쿠폰 사용 (PartnerCampaign.cafe24_coupon_code 매칭)
# - coupon_member/member: bind/ref로 만들어진 회원 연결에서 파생된 준확정 신호
# lastclick 추정·null(구버전)은 제외 — 기록은 계속 쌓되(참고·캘리브레이션용 텔레메트리)
# 모든 집계·정산에서 배제된다.
CONFIRMED_SOURCES = {"bind", "ref", "coupon", "coupon_member", "member"}


def is_confirmed_source(source: Optional[str]) -> bool:
    """이 귀속 소스에 커미션을 적립해도 되는가 (추정 귀속은 커미션 0)."""
    return source in CONFIRMED_SOURCES


async def effective_strict(db: AsyncSession) -> bool:
    """추정 귀속(lastclick 계열)의 '기록'까지 중단해야 하는가.

    기본은 False — 추정 귀속은 집계·정산에서 이미 전면 배제되므로 기록 자체는
    무해하고, 오히려 두 가지 용도로 계속 쌓는다:
      1) 대시보드 '추정 포함(참고)' 조회
      2) 캘리브레이션 백캐스팅: 확정 매출 ÷ (확정+추정) 배율을 실측해
         과거(추적 설치 전) 추정치를 보정하는 데 분모로 사용
    env ATTRIBUTION_STRICT=true로만 기록을 완전히 끌 수 있다 (kill switch).
    """
    from app.core.config import get_settings

    return bool(get_settings().ATTRIBUTION_STRICT)


def extract_member_id(order: dict) -> str:
    """카페24 주문 payload에서 회원 식별자 추출 (비회원이면 빈 문자열)."""
    return str(order.get("member_id") or order.get("buyer_id") or "").strip()


async def get_order_bind(db: AsyncSession, order_id: str) -> Optional[AffiliateOrderBind]:
    """주문번호에 대한 확정 클릭 바인딩 조회."""
    if not order_id:
        return None
    r = await db.execute(
        select(AffiliateOrderBind).where(AffiliateOrderBind.cafe24_order_id == str(order_id))
    )
    return r.scalar_one_or_none()


async def get_member_link(db: AsyncSession, member_id: str) -> Optional[AffiliateMemberLink]:
    """회원 ↔ 파트너 연결 조회 (휴지통 파트너 연결은 무시)."""
    if not member_id:
        return None
    r = await db.execute(
        select(AffiliateMemberLink).where(AffiliateMemberLink.member_id == member_id)
    )
    link = r.scalar_one_or_none()
    if not link:
        return None
    p_r = await db.execute(
        select(AffiliatePartner).where(
            AffiliatePartner.id == link.partner_id,
            AffiliatePartner.deleted_at.is_(None),
        )
    )
    if not p_r.scalar_one_or_none():
        return None
    return link


async def upsert_member_link(
    db: AsyncSession,
    member_id: str,
    partner_id: int,
    campaign_id: Optional[int],
    source: str,
) -> None:
    """확정 귀속된 주문의 회원을 파트너에 연결 (이미 있으면 최신 신호로 갱신).

    commit은 하지 않는다 — 호출측 트랜잭션에 편승.
    """
    if not member_id or source not in STRONG_SOURCES:
        return
    r = await db.execute(
        select(AffiliateMemberLink).where(AffiliateMemberLink.member_id == member_id)
    )
    link = r.scalar_one_or_none()
    now = datetime.utcnow()
    if link:
        link.partner_id = partner_id
        link.campaign_id = campaign_id
        link.source = source
        link.last_seen = now
    else:
        db.add(
            AffiliateMemberLink(
                member_id=member_id,
                partner_id=partner_id,
                campaign_id=campaign_id,
                source=source,
                first_seen=now,
                last_seen=now,
            )
        )


async def find_click_by_token(db: AsyncSession, token: str) -> Optional[ReferralClick]:
    """트래커 토큰(cookie_id)으로 가장 최근 클릭 조회."""
    if not token or len(token) < 16 or len(token) > 100:
        return None
    r = await db.execute(
        select(ReferralClick)
        .where(ReferralClick.cookie_id == token)
        .order_by(ReferralClick.clicked_at.desc())
        .limit(1)
    )
    return r.scalar_one_or_none()
