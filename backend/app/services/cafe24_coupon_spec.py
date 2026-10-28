"""카페24 쿠폰 API 요청 본문 만들기 — 순수 함수(외부 의존 없음, 단위 테스트 대상).

근거: 카페24 Admin API 문서 2026-09-01 (apidocs.cafe24.com/docs/admin/post-coupons,
post-coupons-by-coupon-no-issues, put-coupons-by-coupon-no).

  benefit_type        A=할인금액(정액)  B=할인율(정률)  C=적립금액  D=적립율
                      E=기본배송비 할인(전액)  H=기본배송비 할인(금액)  I=기본배송비 할인(율)
  available_product   U=제한 없음  I=선택 상품 적용  E=선택 상품 제외   (+ available_product_list)
  available_category  U=제한 없음  I=선택 분류 적용  E=선택 분류 제외   (+ available_category_list)
  available_scope     P=상품 쿠폰  O=주문서 쿠폰
  available_period_type F=고정 기간  R=발급일 기준(available_day_from_issued)  M=당월 말

2026-10-28 이전 코드는 percentage→A, fixed→B, shipping→D(적립율!), 선택 상품에 'U'(=제한 없음),
전체에 'A'(문서에 없는 값)를 보내고 있었다. 실제 생성된 쿠폰은 0건이라 피해는 없었음.
"""
from __future__ import annotations

from typing import Iterable, Optional

# 어필리에이트 캠페인 discount_type → 카페24 benefit_type
BENEFIT_TYPE_BY_DISCOUNT = {
    "fixed": "A",       # 정액 할인
    "percentage": "B",  # 정률 할인
    "shipping": "E",    # 기본배송비 전액 할인
}


def affiliate_benefit_type(discount_type: Optional[str]) -> str:
    """discount_type(percentage|fixed|shipping) → 카페24 benefit_type. 모르는 값은 정률(B)."""
    return BENEFIT_TYPE_BY_DISCOUNT.get((discount_type or "percentage").strip().lower(), "B")


def apply_benefit(body: dict, benefit_type: str,
                  benefit_percentage: Optional[float], benefit_price: Optional[float]) -> dict:
    """benefit_type에 맞는 금액/비율 필드만 넣는다 (A=benefit_price, B=benefit_percentage)."""
    body["benefit_type"] = benefit_type
    if benefit_type == "A" and benefit_price is not None:
        body["benefit_price"] = benefit_price
    elif benefit_type == "B" and benefit_percentage is not None:
        body["benefit_percentage"] = benefit_percentage
    return body


def apply_scope(body: dict, *, category_no: Optional[int] = None,
                product_nos: Optional[Iterable[int]] = None) -> dict:
    """적용 범위: 분류 지정 > 상품 지정 > 전체(U/U)."""
    nos = [int(p) for p in (product_nos or []) if p]
    if category_no is not None:
        body["available_category"] = "I"
        body["available_category_list"] = [int(category_no)]
        body["available_product"] = "U"
    elif nos:
        body["available_product"] = "I"
        body["available_product_list"] = sorted(set(nos))
        body["available_category"] = "U"
    else:
        body["available_product"] = "U"
        body["available_category"] = "U"
    return body


# ── 회원 최저가(bestprice) 쿠폰 ───────────────────────────────────────────────

BESTPRICE_NAME_PREFIX = "널담 회원 최저가"


def bestprice_coupon_name(amount: int, month: str) -> str:
    """고객에게 보이는 이름. 스킨 ndBestPrice가 접두어로 찾는다. month='YYYY-MM'."""
    return f"{BESTPRICE_NAME_PREFIX} {int(amount):,}원 ({int(month[5:7])}월)"


def build_bestprice_coupon_request(*, amount: int, month: str, issue_max_count: int,
                                   min_order_price: int = 15000, valid_days: int = 14) -> dict:
    """정액·주문서 쿠폰, 최소 주문금액, 발급일 기준 N일, 알림 전부 끔. issue_max_count는 기록용(카페24엔 안 보냄)."""
    if amount <= 0:
        raise ValueError("amount must be positive")
    if issue_max_count <= 0:
        raise ValueError("issue_max_count must be positive")
    body = {
        "coupon_name": bestprice_coupon_name(amount, month),
        "benefit_type": "A",
        "benefit_price": int(amount),
        "issue_type": "M",                      # 대상자 지정 발급
        "available_site": ["W", "M"],
        "available_scope": "O",                 # 주문서 쿠폰
        "available_product": "U",
        "available_category": "U",
        "available_amount_type": "E",
        "available_period_type": "R",           # 발급일 기준
        "available_day_from_issued": int(valid_days),
        "available_price_type": "O",            # 주문 금액 기준
        "available_order_price_type": "U",
        "available_min_price": int(min_order_price),
        "available_coupon_count_by_order": 1,
        # 카페24는 지정발급 쿠폰 issue_max_count < 999만 허용(2026-10-28 실측 422) → 상한 끔.
        # 비용 통제는 우리 쪽 3중 장치(회원당 1장·기대비용 계획·실사용 조기종료)로.
        "issue_limit": "F",
        "show_product_detail": "F",
        "use_notification_when_login": "F",
        "send_sms_for_issue": "F",
        "send_email_for_issue": "F",
    }
    return {"shop_no": 1, "request": body}


def build_issue_request(member_ids: list[str]) -> dict:
    """특정 회원 발급. SMS 끔, 중복 발급 안 함, 1회 1장."""
    ids = [m for m in member_ids if m]
    if not ids:
        raise ValueError("member_ids empty")
    return {"shop_no": 1, "request": {
        "issued_member_scope": "M",
        "member_id": ids[0] if len(ids) == 1 else ids,
        "send_sms_for_issue": "F",
        "allow_duplication": "F",
        "single_issue_per_once": "T",
    }}


def build_pause_request() -> dict:
    """발급 즉시 중지."""
    return {"shop_no": 1, "request": {"status": "pause", "immediate_issue_pause": "I"}}
