"""회원 최저가 쿠폰 — 순수 계산(외부 의존 없음, 단위 테스트 대상).

대표 결정(2026-10-28): 로그인 회원 전원에게 혜택(0원 구간·제외 구간 없음), 월 상한 300만원.
상한은 '전원 사용' 최악값이 아니라 **기대 사용액 = 구간 과거 30일 구매율 × 안전계수 1.3 × 금액**으로 계획.
실제 사용액은 매일 주문에서 확인해 월 누적이 상한에 닿으면 그 달 쿠폰을 조기 종료(bestprice.py).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable

# 발급 우선순위 순서(앞이 먼저). 금액은 원.
TIERS: list[tuple[str, str, int]] = [
    ("new",          "신규(가입 30일 이내·무구매)",       1000),
    ("vip",          "VIP(최근 1년 30만원+)",            500),
    ("loyal",        "충성(60일 내 3회+)",               300),
    ("active",       "최근 활성(60일 내 1~2회)",          500),
    ("dormant",      "휴면(마지막 구매 61~120일)",        1500),
    ("lapsed",       "이탈(마지막 구매 120일 초과)",       1500),
    ("nopurchase",   "가입 후 무구매(31~270일)",          1000),
    ("longinactive", "장기 무구매(가입 270일 초과)",       1000),
]
TIER_AMOUNT = {k: a for k, _, a in TIERS}
TIER_LABEL = {k: l for k, l, _ in TIERS}
TIER_ORDER = [k for k, _, _ in TIERS]

# 과거 데이터가 너무 적을 때 쓰는 기본 구매율(2026-10-28 백테스트, 9/28→10/28 30일 구매 회원 비율)
DEFAULT_BUYER_RATE = {
    "new": 0.0408, "vip": 0.4187, "loyal": 0.2595, "active": 0.0660,
    "dormant": 0.0284, "lapsed": 0.0106, "nopurchase": 0.0050, "longinactive": 0.0018,
}
MIN_SAMPLE_FOR_RATE = 200


def classify(*, days_since_join: int | None, n_orders: int, days_since_last: int | None,
             amount_365: float) -> str:
    """회원 1명의 구간. 주문 이력은 mall_orders(2026-01 이후) 기준."""
    if n_orders <= 0:
        dj = 10 ** 6 if days_since_join is None else days_since_join
        if dj <= 30:
            return "new"
        if dj <= 270:
            return "nopurchase"
        return "longinactive"
    if amount_365 >= 300000:
        return "vip"
    dl = days_since_last if days_since_last is not None else 10 ** 6
    if dl > 120:
        return "lapsed"
    if dl > 60:
        return "dormant"
    if n_orders >= 3:
        return "loyal"
    return "active"


def min_order_for(tier: str, median_order: float | None, *, low_tiers: set[str] | frozenset,
                  low_aov: float, high_min: int, low_min: int) -> int:
    """회원별 최소 주문금액(대표 결정 2026-10-29: 회원마다 1만원 또는 1.5만원).
    - 첫 구매·복귀 전환 구간(low_tiers: 신규·가입후무구매·휴면·이탈)은 1만원
    - 그 밖에는 그 회원 주문금액 중앙값이 low_aov(1.5만원) 미만이면 1만원, 아니면 1.5만원
    """
    if tier in low_tiers:
        return int(low_min)
    if median_order is not None and float(median_order) < float(low_aov):
        return int(low_min)
    return int(high_min)


def coupon_slot(tier: str, min_order: int, high_min: int) -> str:
    """카페24 쿠폰 1개 = (구간 금액 × 최소 주문금액). 기본 기준은 구간 이름 그대로(기존 8개와 호환)."""
    return tier if int(min_order) == int(high_min) else f"{tier}:{int(min_order)}"


def slot_tier(slot: str) -> str:
    return slot.split(":", 1)[0]


def slot_min(slot: str, high_min: int) -> int:
    return int(slot.split(":", 1)[1]) if ":" in slot else int(high_min)


def blended_rates(observed: dict[str, tuple[int, int]]) -> dict[str, float]:
    """observed[tier] = (구간 인원, 30일 내 구매 회원 수). 표본이 작으면 기본값."""
    out = {}
    for t in TIER_ORDER:
        n, b = observed.get(t, (0, 0))
        out[t] = (b / n) if n >= MIN_SAMPLE_FOR_RATE else DEFAULT_BUYER_RATE[t]
    return out


def expected_cost(tier: str, rates: dict[str, float], safety: float) -> float:
    return rates[tier] * safety * TIER_AMOUNT[tier]


@dataclass
class Plan:
    issue: list[tuple[str, str]] = field(default_factory=list)  # (member_id, tier) 오늘 발급할 회원
    per_tier: dict = field(default_factory=dict)
    budget_total: float = 0
    committed_before: float = 0
    planned_expected: float = 0
    deferred_budget: int = 0
    deferred_batch: int = 0


def plan_issuance(candidates: dict[str, Iterable[str]], *, rates: dict[str, float], safety: float,
                  cap: float, committed_expected: float, max_issue: int) -> Plan:
    """우선순위 순으로 기대비용을 쌓아 상한 안에서 발급 대상 확정.

    candidates[tier] = 아직 이번 달 쿠폰이 없는 회원(우선순위 정렬된 순서).
    committed_expected = 이번 달 이미 발급된 쿠폰의 기대비용 합(실사용 확인분은 실제값으로 교체해 넘김).
    max_issue = 오늘 밤 발급 회원 수 상한(API 부담 분산 — 넘친 회원은 다음 밤).
    """
    p = Plan(budget_total=cap, committed_before=committed_expected)
    remaining = cap - committed_expected
    for t in TIER_ORDER:
        members = list(candidates.get(t, []))
        unit = expected_cost(t, rates, safety)
        stat = {"label": TIER_LABEL[t], "amount": TIER_AMOUNT[t], "rate": round(rates[t], 4),
                "eligible": len(members), "planned": 0, "deferred_budget": 0, "deferred_batch": 0,
                "expected_cost": 0.0, "worst_case_cost": 0}
        for m in members:
            if len(p.issue) >= max_issue:
                stat["deferred_batch"] += 1
                continue
            if unit > remaining:
                stat["deferred_budget"] += 1
                continue
            p.issue.append((m, t))
            remaining -= unit
            stat["planned"] += 1
            stat["expected_cost"] += unit
        stat["worst_case_cost"] = stat["planned"] * TIER_AMOUNT[t]
        stat["expected_cost"] = round(stat["expected_cost"])
        p.per_tier[t] = stat
        p.deferred_budget += stat["deferred_budget"]
        p.deferred_batch += stat["deferred_batch"]
    p.planned_expected = round(sum(s["expected_cost"] for s in p.per_tier.values()))
    return p


def cap_status(redeemed_mtd: float, cap: float, warn_ratio: float) -> str:
    """ok | warn(≥70%) | reached(≥100%)."""
    if cap <= 0:
        return "reached"
    r = redeemed_mtd / cap
    if r >= 1:
        return "reached"
    if r >= warn_ratio:
        return "warn"
    return "ok"
