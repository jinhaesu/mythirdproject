"""마케팅 KPI 모듈 — 몰 전체 주문 + 채널 광고비 + CAC/LTV/전환율 대시보드.

엔드포인트:
  GET    /api/v1/kpi/summary?granularity=month|week|day — KPI 요약 (month=월별 요약, week/day=최근 N일 버킷)
  PUT    /api/v1/kpi/goals/{month}               — 월간 목표 upsert
  GET    /api/v1/kpi/goals?months=12             — 월간 목표 목록
  PUT    /api/v1/kpi/channel-spend               — 채널별 월 광고비 upsert
  DELETE /api/v1/kpi/channel-spend/{id}          — 채널별 월 광고비 삭제
  POST   /api/v1/kpi/backfill-orders             — Cafe24 주문 백필 (MallOrder)
  GET    /api/v1/kpi/naver-queries               — 네이버 DataLab 검색어트렌드 프록시 + 절대 검색량(키워드도구)
  POST   /api/v1/kpi/backfill-naver-spend         — 네이버 검색광고 일별 광고비 백필
  POST   /api/v1/kpi/backfill-visitors            — 카페24 일별 방문자수 백필
  GET    /api/v1/kpi/export                      — KPI 요약 엑셀 다운로드 (summary와 동일 파라미터)
"""
import calendar
import logging
import re
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_user, get_shared_cafe24_user
from app.core.config import get_settings
from app.db.database import get_db
from app.models.kpi import (
    ChannelSpendDaily,
    MallOrder,
    MallVisitorsDaily,
    MarketingGoal,
    MonthlyChannelSpend,
)
from app.models.meta_insight import MetaInsightDaily
from app.models.user import User
from app.services import cafe24 as cafe24_svc
from app.services.kpi_collectors import collect_mall_visitors, collect_naver_spend
from app.services.mall_order_sync import (
    extract_member_id_or_none,
    extract_order_amount,
    extract_order_date,
    extract_order_status,
    upsert_mall_order,
)

logger = logging.getLogger(__name__)
router = APIRouter()

_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


# ── 공용 헬퍼 ────────────────────────────────────────────────────────────────

def _validate_month(month: str) -> None:
    if not _MONTH_RE.match(month or ""):
        raise HTTPException(status_code=422, detail="month는 YYYY-MM 형식이어야 합니다.")


def _month_bounds(month: str) -> tuple[date, date]:
    year, mon = (int(x) for x in month.split("-"))
    start = date(year, mon, 1)
    last_day = calendar.monthrange(year, mon)[1]
    return start, date(year, mon, last_day)


def _recent_months(n: int) -> list[str]:
    """오늘이 속한 월을 포함해 최근 n개월 (오래된 순 → 최신 순)."""
    today = date.today()
    y, m = today.year, today.month
    months = []
    for _ in range(n):
        months.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    return list(reversed(months))


def _merge_channel_spend(
    channel: str,
    month_key: str,
    auto_value: float,
    rows: list,
    always_include_virtual: bool = False,
) -> tuple[list[dict], float]:
    """단일 채널의 MonthlyChannelSpend 수동 입력 행들과 자동 계산값(auto_value)을 병합.

    - rows 중 해당 채널 행이 있고 actual_amount가 None이면 auto_value 사용(is_auto=true).
    - rows 중 해당 채널 행이 없으면:
        - always_include_virtual=True → 항상 가상 행(id=None) 추가 (meta 기존 동작 유지)
        - always_include_virtual=False → auto_value > 0 일 때만 가상 행 추가 (naver_sa 등)

    Returns:
        (channel_spend_dicts, total_spend_added)
    """
    entries: list[dict] = []
    total = 0.0
    has_row = False
    for row in rows:
        if row.channel != channel:
            continue
        has_row = True
        is_auto = row.actual_amount is None
        resolved = auto_value if is_auto else (row.actual_amount or 0.0)
        entries.append(
            {
                "id": row.id,
                "month": month_key,
                "channel": row.channel,
                "planned_amount": row.planned_amount or 0.0,
                "actual_amount": resolved,
                "is_auto": is_auto,
                "memo": row.memo,
            }
        )
        total += resolved
    if not has_row and (always_include_virtual or auto_value > 0):
        entries.append(
            {
                "id": None,
                "month": month_key,
                "channel": channel,
                "planned_amount": 0.0,
                "actual_amount": auto_value,
                "is_auto": True,
                "memo": None,
            }
        )
        total += auto_value
    return entries, total


def _serialize_goal(goal: MarketingGoal) -> dict:
    return {
        "id": goal.id,
        "month": goal.month,
        "target_cac": goal.target_cac,
        "target_ltv": goal.target_ltv,
        "target_ltv_cac": goal.target_ltv_cac,
        "target_conversion_rate": goal.target_conversion_rate,
        "target_aov": goal.target_aov,
        "target_new_customers": goal.target_new_customers,
        "actual_conversion_rate": goal.actual_conversion_rate,
        "memo": goal.memo,
    }


# ── GET /summary ─────────────────────────────────────────────────────────────

async def _kpi_summary_data(
    db: AsyncSession,
    granularity: str,
    months: int,
    days: int,
) -> dict:
    """summary·export 공용 KPI 집계. granularity=month면 월별, week/day면 최근 days일 버킷."""
    if granularity == "month":
        return await _kpi_summary_monthly(db, months)
    return await _kpi_summary_bucketed(db, granularity, days)


async def _kpi_summary_monthly(db: AsyncSession, months: int) -> dict:
    """최근 N개월(당월 포함) 마케팅 KPI 요약. 데이터 부족 항목은 None."""
    month_list = _recent_months(months)
    range_start, _ = _month_bounds(month_list[0])
    _, range_end = _month_bounds(month_list[-1])

    # ── Meta 광고비 (일별 스냅샷 → 월 합산) ──
    meta_rows = (
        await db.execute(
            select(MetaInsightDaily.date, MetaInsightDaily.spend).where(
                MetaInsightDaily.level == "campaign",
                MetaInsightDaily.date >= range_start,
                MetaInsightDaily.date <= range_end,
            )
        )
    ).all()
    meta_spend_by_month: dict[str, float] = defaultdict(float)
    for d, spend in meta_rows:
        meta_spend_by_month[f"{d.year:04d}-{d.month:02d}"] += float(spend or 0)

    # ── 네이버 검색광고 일별 광고비 (자동 수집 스냅샷 → 월 합산) ──
    naver_rows = (
        await db.execute(
            select(ChannelSpendDaily.date, ChannelSpendDaily.spend).where(
                ChannelSpendDaily.channel == "naver_sa",
                ChannelSpendDaily.date >= range_start,
                ChannelSpendDaily.date <= range_end,
            )
        )
    ).all()
    naver_spend_by_month: dict[str, float] = defaultdict(float)
    for d, spend in naver_rows:
        naver_spend_by_month[f"{d.year:04d}-{d.month:02d}"] += float(spend or 0)

    # ── 카페24 일별 방문자수 (자동 수집 스냅샷 → 월 합산) ──
    visitor_rows = (
        await db.execute(
            select(MallVisitorsDaily.date, MallVisitorsDaily.visit_count).where(
                MallVisitorsDaily.date >= range_start,
                MallVisitorsDaily.date <= range_end,
            )
        )
    ).all()
    visits_by_month: dict[str, int] = defaultdict(int)
    for d, visit_count in visitor_rows:
        visits_by_month[f"{d.year:04d}-{d.month:02d}"] += int(visit_count or 0)

    # ── 채널별 월 광고비 (수동 입력) ──
    spend_rows = (
        await db.execute(
            select(MonthlyChannelSpend).where(MonthlyChannelSpend.month.in_(month_list))
        )
    ).scalars().all()
    spend_by_month: dict[str, list[MonthlyChannelSpend]] = defaultdict(list)
    for row in spend_rows:
        spend_by_month[row.month].append(row)

    # ── 몰 전체 주문 (paid) — 조회 범위 전체 로드 ──
    mall_rows = (
        await db.execute(
            select(MallOrder).where(
                MallOrder.status == "paid",
                MallOrder.order_date >= range_start,
                MallOrder.order_date <= range_end,
            )
        )
    ).scalars().all()
    mall_by_month: dict[str, list[MallOrder]] = defaultdict(list)
    for o in mall_rows:
        mall_by_month[f"{o.order_date.year:04d}-{o.order_date.month:02d}"].append(o)

    # ── 신규 고객 판별: 회원별 사상 최초 주문월 (전체 기간 기준) ──
    first_order_rows = (
        await db.execute(
            select(MallOrder.member_id, func.min(MallOrder.order_date))
            .where(MallOrder.status == "paid", MallOrder.member_id.isnot(None))
            .group_by(MallOrder.member_id)
        )
    ).all()
    new_customers_by_month: dict[str, int] = defaultdict(int)
    for member_id, first_date in first_order_rows:
        if member_id and first_date:
            new_customers_by_month[f"{first_date.year:04d}-{first_date.month:02d}"] += 1

    # ── LTV 계산용: (member_id, order_date, amount) 전체 로드 (트레일링 180일 윈도우가
    #    조회 범위보다 더 과거를 볼 수 있으므로 range_start 이전 180일도 포함해 로드) ──
    ltv_load_start = range_start - timedelta(days=180)
    ltv_source_rows = (
        await db.execute(
            select(MallOrder.member_id, MallOrder.order_date, MallOrder.amount).where(
                MallOrder.status == "paid",
                MallOrder.member_id.isnot(None),
                MallOrder.order_date >= ltv_load_start,
                MallOrder.order_date <= range_end,
            )
        )
    ).all()

    # ── 목표 ──
    goal_rows = (
        await db.execute(select(MarketingGoal).where(MarketingGoal.month.in_(month_list)))
    ).scalars().all()
    goal_by_month = {g.month: g for g in goal_rows}

    months_out = []
    for month_key in month_list:
        m_start, m_end = _month_bounds(month_key)
        meta_spend = round(meta_spend_by_month.get(month_key, 0.0), 2)
        naver_spend = round(naver_spend_by_month.get(month_key, 0.0), 2)

        # 채널별 광고비 병합 (meta/naver_sa는 actual_amount 미입력 시 자동 계산값 채움)
        rows_this_month = spend_by_month.get(month_key, [])
        channel_spends: list[dict] = []
        total_ad_spend = 0.0

        meta_entries, meta_total = _merge_channel_spend(
            "meta", month_key, meta_spend, rows_this_month, always_include_virtual=True
        )
        channel_spends.extend(meta_entries)
        total_ad_spend += meta_total

        naver_entries, naver_total = _merge_channel_spend(
            "naver_sa", month_key, naver_spend, rows_this_month, always_include_virtual=False
        )
        channel_spends.extend(naver_entries)
        total_ad_spend += naver_total

        # 자동 계산값이 없는 나머지 채널 (수동 입력 그대로 반영)
        for row in rows_this_month:
            if row.channel in ("meta", "naver_sa"):
                continue
            resolved = row.actual_amount or 0.0
            channel_spends.append(
                {
                    "id": row.id,
                    "month": month_key,
                    "channel": row.channel,
                    "planned_amount": row.planned_amount or 0.0,
                    "actual_amount": resolved,
                    "is_auto": False,
                    "memo": row.memo,
                }
            )
            total_ad_spend += resolved

        # 몰 지표
        orders_this_month = mall_by_month.get(month_key, [])
        orders_count = len(orders_this_month)
        revenue = round(sum(o.amount or 0.0 for o in orders_this_month), 2)
        member_ids = {o.member_id for o in orders_this_month if o.member_id}
        buyers = len(member_ids)
        guest_orders = sum(1 for o in orders_this_month if not o.member_id)
        aov = round(revenue / orders_count, 2) if orders_count else None
        new_customers = new_customers_by_month.get(month_key, 0)
        visits = visits_by_month.get(month_key)
        conversion_rate = (
            round(orders_count / visits * 100, 2) if visits else None
        )

        cac = round(total_ad_spend / new_customers, 2) if new_customers else None

        # LTV — 트레일링 180일 (해당 월 말일 기준), 고객당 평균 매출
        window_start = m_end - timedelta(days=179)
        ltv_members: dict[str, float] = defaultdict(float)
        for member_id, o_date, amount in ltv_source_rows:
            if window_start <= o_date <= m_end:
                ltv_members[member_id] += float(amount or 0.0)
        ltv = round(sum(ltv_members.values()) / len(ltv_members), 2) if ltv_members else None
        ltv_cac = round(ltv / cac, 2) if (ltv is not None and cac) else None

        goal = goal_by_month.get(month_key)

        months_out.append(
            {
                "month": month_key,
                "meta_spend": meta_spend,
                "channel_spends": channel_spends,
                "total_ad_spend": round(total_ad_spend, 2),
                "mall": {
                    "orders_count": orders_count,
                    "revenue": revenue,
                    "buyers": buyers,
                    "guest_orders": guest_orders,
                    "aov": aov,
                    "new_customers": new_customers,
                    "visits": visits,
                    "conversion_rate": conversion_rate,
                },
                "cac": cac,
                "ltv": ltv,
                "ltv_cac": ltv_cac,
                "goal": _serialize_goal(goal) if goal else None,
            }
        )

    return {"months": months_out, "granularity": "month"}


async def _kpi_summary_bucketed(db: AsyncSession, granularity: str, days: int) -> dict:
    """최근 days일(오늘 포함)을 일/주(월요일 시작) 버킷으로 나눈 마케팅 KPI 요약.

    ltv/ltv_cac/goal은 항상 None (월 단위 전용 지표). channel_spends는 meta/naver_sa
    자동 2행만 포함한다.
    """
    today = date.today()
    end_date = today
    start_date = today - timedelta(days=days - 1)

    bucket_bounds: list[tuple[date, date]] = []
    if granularity == "day":
        for i in range(days):
            d = start_date + timedelta(days=i)
            bucket_bounds.append((d, d))
    else:  # week (월요일 시작)
        first_anchor = start_date - timedelta(days=start_date.weekday())
        cursor = first_anchor
        while cursor <= end_date:
            b_end = min(cursor + timedelta(days=6), end_date)
            bucket_bounds.append((cursor, b_end))
            cursor += timedelta(days=7)

    range_start = bucket_bounds[0][0]
    range_end = end_date
    key_set = {b[0].isoformat() for b in bucket_bounds}

    def _key_for(d: date) -> str:
        if granularity == "day":
            return d.isoformat()
        return (d - timedelta(days=d.weekday())).isoformat()

    # ── Meta 광고비 (일별 스냅샷 → 버킷 합산) ──
    meta_rows = (
        await db.execute(
            select(MetaInsightDaily.date, MetaInsightDaily.spend).where(
                MetaInsightDaily.level == "campaign",
                MetaInsightDaily.date >= range_start,
                MetaInsightDaily.date <= range_end,
            )
        )
    ).all()
    meta_spend_by_bucket: dict[str, float] = defaultdict(float)
    for d, spend in meta_rows:
        meta_spend_by_bucket[_key_for(d)] += float(spend or 0)

    # ── 네이버 검색광고 일별 광고비 (자동 수집 스냅샷 → 버킷 합산) ──
    naver_rows = (
        await db.execute(
            select(ChannelSpendDaily.date, ChannelSpendDaily.spend).where(
                ChannelSpendDaily.channel == "naver_sa",
                ChannelSpendDaily.date >= range_start,
                ChannelSpendDaily.date <= range_end,
            )
        )
    ).all()
    naver_spend_by_bucket: dict[str, float] = defaultdict(float)
    for d, spend in naver_rows:
        naver_spend_by_bucket[_key_for(d)] += float(spend or 0)

    # ── 카페24 일별 방문자수 (자동 수집 스냅샷 → 버킷 합산) ──
    visitor_rows = (
        await db.execute(
            select(MallVisitorsDaily.date, MallVisitorsDaily.visit_count).where(
                MallVisitorsDaily.date >= range_start,
                MallVisitorsDaily.date <= range_end,
            )
        )
    ).all()
    visits_by_bucket: dict[str, int] = defaultdict(int)
    for d, visit_count in visitor_rows:
        visits_by_bucket[_key_for(d)] += int(visit_count or 0)

    # ── 몰 전체 주문 (paid) — 조회 범위 전체 로드 ──
    mall_rows = (
        await db.execute(
            select(MallOrder).where(
                MallOrder.status == "paid",
                MallOrder.order_date >= range_start,
                MallOrder.order_date <= range_end,
            )
        )
    ).scalars().all()
    mall_by_bucket: dict[str, list[MallOrder]] = defaultdict(list)
    for o in mall_rows:
        mall_by_bucket[_key_for(o.order_date)].append(o)

    # ── 신규 고객 판별: 회원별 사상 최초 주문일 (전체 기간 기준) ──
    first_order_rows = (
        await db.execute(
            select(MallOrder.member_id, func.min(MallOrder.order_date))
            .where(MallOrder.status == "paid", MallOrder.member_id.isnot(None))
            .group_by(MallOrder.member_id)
        )
    ).all()
    new_customers_by_bucket: dict[str, int] = defaultdict(int)
    for member_id, first_date in first_order_rows:
        if not (member_id and first_date):
            continue
        key = _key_for(first_date)
        if key in key_set:
            new_customers_by_bucket[key] += 1

    buckets_out = []
    for b_start, b_end in bucket_bounds:
        key = b_start.isoformat()
        meta_spend = round(meta_spend_by_bucket.get(key, 0.0), 2)
        naver_spend = round(naver_spend_by_bucket.get(key, 0.0), 2)

        channel_spends = [
            {
                "id": None,
                "month": key,
                "channel": "meta",
                "planned_amount": 0.0,
                "actual_amount": meta_spend,
                "is_auto": True,
                "memo": None,
            },
            {
                "id": None,
                "month": key,
                "channel": "naver_sa",
                "planned_amount": 0.0,
                "actual_amount": naver_spend,
                "is_auto": True,
                "memo": None,
            },
        ]
        total_ad_spend = round(meta_spend + naver_spend, 2)

        orders_this_bucket = mall_by_bucket.get(key, [])
        orders_count = len(orders_this_bucket)
        revenue = round(sum(o.amount or 0.0 for o in orders_this_bucket), 2)
        member_ids = {o.member_id for o in orders_this_bucket if o.member_id}
        buyers = len(member_ids)
        guest_orders = sum(1 for o in orders_this_bucket if not o.member_id)
        aov = round(revenue / orders_count, 2) if orders_count else None
        new_customers = new_customers_by_bucket.get(key, 0)
        visits = visits_by_bucket.get(key)
        conversion_rate = round(orders_count / visits * 100, 2) if visits else None

        cac = round(total_ad_spend / new_customers, 2) if new_customers else None

        buckets_out.append(
            {
                "month": key,
                "bucket_end": b_end.isoformat(),
                "meta_spend": meta_spend,
                "channel_spends": channel_spends,
                "total_ad_spend": total_ad_spend,
                "mall": {
                    "orders_count": orders_count,
                    "revenue": revenue,
                    "buyers": buyers,
                    "guest_orders": guest_orders,
                    "aov": aov,
                    "new_customers": new_customers,
                    "visits": visits,
                    "conversion_rate": conversion_rate,
                },
                "cac": cac,
                "ltv": None,
                "ltv_cac": None,
                "goal": None,
            }
        )

    return {"months": buckets_out, "granularity": granularity}


@router.get("/summary")
async def get_kpi_summary(
    granularity: str = Query(default="month", description="month | week | day"),
    months: int = Query(default=6, ge=1, le=24),
    days: int = Query(default=30, ge=7, le=190, description="week/day granularity 전용 — 최근 N일"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """마케팅 KPI 요약.

    granularity=month(기본): 최근 N개월(months) 월별 요약 (기존 동작 그대로, +"granularity" 필드).
    granularity=week|day: 최근 N일(days) 주/일 단위 요약. ltv/ltv_cac/goal은 항상 None.
    """
    if granularity not in ("month", "week", "day"):
        raise HTTPException(status_code=422, detail="granularity 는 month, week, day 중 하나여야 합니다.")
    return await _kpi_summary_data(db, granularity, months, days)


# ── Goals ────────────────────────────────────────────────────────────────────

class MarketingGoalUpsert(BaseModel):
    target_cac: Optional[float] = None
    target_ltv: Optional[float] = None
    target_ltv_cac: Optional[float] = None
    target_conversion_rate: Optional[float] = None
    target_aov: Optional[float] = None
    target_new_customers: Optional[int] = None
    actual_conversion_rate: Optional[float] = None
    memo: Optional[str] = None


@router.put("/goals/{month}")
async def upsert_marketing_goal(
    month: str,
    payload: MarketingGoalUpsert,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """월간 마케팅 목표 upsert. 지정된 필드만 갱신 (미지정은 기존값 유지)."""
    _validate_month(month)
    result = await db.execute(select(MarketingGoal).where(MarketingGoal.month == month))
    goal = result.scalar_one_or_none()
    if goal is None:
        goal = MarketingGoal(month=month)
        db.add(goal)
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(goal, field, value)
    await db.commit()
    await db.refresh(goal)
    return _serialize_goal(goal)


@router.get("/goals")
async def list_marketing_goals(
    months: int = Query(default=12, ge=1, le=24),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """최근 N개월 범위 내 저장된 마케팅 목표 목록 (없는 월은 생략)."""
    month_list = _recent_months(months)
    result = await db.execute(
        select(MarketingGoal)
        .where(MarketingGoal.month.in_(month_list))
        .order_by(MarketingGoal.month)
    )
    goals = result.scalars().all()
    return {"goals": [_serialize_goal(g) for g in goals]}


# ── Channel spend ────────────────────────────────────────────────────────────

class ChannelSpendUpsert(BaseModel):
    month: str
    channel: str
    planned_amount: Optional[float] = None
    actual_amount: Optional[float] = None
    memo: Optional[str] = None


@router.put("/channel-spend")
async def upsert_channel_spend(
    payload: ChannelSpendUpsert,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """채널별 월 광고비(예산/실적) upsert. (month, channel) 유니크 기준."""
    _validate_month(payload.month)
    if not payload.channel or not payload.channel.strip():
        raise HTTPException(status_code=422, detail="channel은 필수입니다.")
    channel = payload.channel.strip()

    result = await db.execute(
        select(MonthlyChannelSpend).where(
            MonthlyChannelSpend.month == payload.month,
            MonthlyChannelSpend.channel == channel,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        row = MonthlyChannelSpend(month=payload.month, channel=channel)
        db.add(row)

    if payload.planned_amount is not None:
        row.planned_amount = payload.planned_amount
    if payload.actual_amount is not None:
        row.actual_amount = payload.actual_amount
    if payload.memo is not None:
        row.memo = payload.memo

    await db.commit()
    await db.refresh(row)
    return {
        "id": row.id,
        "month": row.month,
        "channel": row.channel,
        "planned_amount": row.planned_amount,
        "actual_amount": row.actual_amount,
        "memo": row.memo,
    }


@router.delete("/channel-spend/{spend_id}")
async def delete_channel_spend(
    spend_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(MonthlyChannelSpend).where(MonthlyChannelSpend.id == spend_id)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="채널 광고비 항목을 찾을 수 없습니다.")
    await db.delete(row)
    await db.commit()
    return {"status": "deleted", "id": spend_id}


# ── Backfill ─────────────────────────────────────────────────────────────────

@router.post("/backfill-orders")
async def backfill_mall_orders(
    since: str = Query(..., description="YYYY-MM-DD"),
    until: Optional[str] = Query(default=None, description="YYYY-MM-DD, 기본값 오늘"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cafe24 주문을 월 단위로 조회해 MallOrder에 upsert (최대 6개월 범위)."""
    try:
        since_date = date.fromisoformat(since)
    except ValueError:
        raise HTTPException(status_code=422, detail="since는 YYYY-MM-DD 형식이어야 합니다.")

    until_date = date.today()
    if until:
        try:
            until_date = date.fromisoformat(until)
        except ValueError:
            raise HTTPException(status_code=422, detail="until은 YYYY-MM-DD 형식이어야 합니다.")

    if since_date > until_date:
        raise HTTPException(status_code=422, detail="since가 until보다 뒤일 수 없습니다.")
    if (until_date - since_date) > timedelta(days=186):
        raise HTTPException(status_code=422, detail="조회 범위는 최대 6개월까지 가능합니다.")

    cafe24_user = await get_shared_cafe24_user(db)
    if not cafe24_user:
        raise HTTPException(status_code=503, detail="Cafe24 연결된 계정이 없습니다. 먼저 Cafe24를 연결해주세요.")

    # 카페24 offset 상한(8000) 회피 — 7일 단위로 쪼갠다 (주 9천 건까지 안전).
    chunks: list[tuple[date, date]] = []
    cursor = since_date
    while cursor <= until_date:
        chunk_end = min(cursor + timedelta(days=6), until_date)
        chunks.append((cursor, chunk_end))
        cursor = chunk_end + timedelta(days=1)

    fetched = 0
    upserted = 0
    months_done: list[str] = []

    for chunk_start, chunk_end in chunks:
        # offset 페이지네이션 — 페이지당 1000건, offset 상한 8000 → 청크당 최대 9000건
        orders: list = []
        try:
            for page in range(9):
                batch = await cafe24_svc.list_orders(
                    cafe24_user,
                    db,
                    datetime.combine(chunk_start, datetime.min.time()),
                    datetime.combine(chunk_end, datetime.min.time()),
                    limit=1000,
                    offset=page * 1000,
                )
                orders.extend(batch)
                if len(batch) < 1000:
                    break
        except Exception as e:
            logger.error(f"[KPI Backfill] list_orders 실패 {chunk_start}~{chunk_end}: {e}")
            if not orders:
                continue

        fetched += len(orders)
        for o in orders:
            order_id = o.get("order_id")
            if not order_id:
                continue
            try:
                await upsert_mall_order(
                    db,
                    cafe24_order_id=str(order_id),
                    order_date=extract_order_date(o),
                    member_id=extract_member_id_or_none(o),
                    amount=extract_order_amount(o),
                    status=extract_order_status(o),
                    source="backfill",
                )
                upserted += 1
            except Exception as e:
                logger.error(f"[KPI Backfill] order={order_id} upsert 실패: {e}")

        month_key = f"{chunk_start.year:04d}-{chunk_start.month:02d}"
        if month_key not in months_done:
            months_done.append(month_key)

    return {"fetched": fetched, "upserted": upserted, "months": months_done}


# ── 네이버 검색광고 / 카페24 방문자수 자동 수집 백필 ──────────────────────────

@router.post("/backfill-naver-spend")
async def backfill_naver_spend(
    since: str = Query(..., description="YYYY-MM-DD"),
    until: Optional[str] = Query(default=None, description="YYYY-MM-DD, 기본값 오늘"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """네이버 검색광고 일별 광고비를 ChannelSpendDaily(channel=naver_sa)에 백필 (최대 12개월)."""
    try:
        since_date = date.fromisoformat(since)
    except ValueError:
        raise HTTPException(status_code=422, detail="since는 YYYY-MM-DD 형식이어야 합니다.")

    until_date = date.today()
    if until:
        try:
            until_date = date.fromisoformat(until)
        except ValueError:
            raise HTTPException(status_code=422, detail="until은 YYYY-MM-DD 형식이어야 합니다.")

    if since_date > until_date:
        raise HTTPException(status_code=422, detail="since가 until보다 뒤일 수 없습니다.")
    if (until_date - since_date) > timedelta(days=366):
        raise HTTPException(status_code=422, detail="조회 범위는 최대 12개월까지 가능합니다.")

    try:
        upserted = await collect_naver_spend(db, since_date, until_date)
    except Exception as e:
        logger.error(f"[KPI] backfill-naver-spend 실패: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=f"네이버 검색광고 광고비 수집 실패: {e}")

    return {"upserted": upserted, "since": since_date.isoformat(), "until": until_date.isoformat()}


@router.post("/backfill-visitors")
async def backfill_visitors(
    since: str = Query(..., description="YYYY-MM-DD"),
    until: Optional[str] = Query(default=None, description="YYYY-MM-DD, 기본값 오늘"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """카페24 Analytics API 일별 방문자수를 MallVisitorsDaily에 백필 (최대 12개월)."""
    try:
        since_date = date.fromisoformat(since)
    except ValueError:
        raise HTTPException(status_code=422, detail="since는 YYYY-MM-DD 형식이어야 합니다.")

    until_date = date.today()
    if until:
        try:
            until_date = date.fromisoformat(until)
        except ValueError:
            raise HTTPException(status_code=422, detail="until은 YYYY-MM-DD 형식이어야 합니다.")

    if since_date > until_date:
        raise HTTPException(status_code=422, detail="since가 until보다 뒤일 수 없습니다.")
    if (until_date - since_date) > timedelta(days=366):
        raise HTTPException(status_code=422, detail="조회 범위는 최대 12개월까지 가능합니다.")

    try:
        upserted = await collect_mall_visitors(db, since_date, until_date)
    except httpx.HTTPStatusError as e:
        status_code = e.response.status_code if e.response is not None else 502
        if status_code in (401, 403):
            raise HTTPException(
                status_code=400,
                detail="카페24 앱에 mall.read_analytics 권한 추가 후 재연결 필요",
            )
        raise HTTPException(status_code=502, detail=f"카페24 방문자수 수집 실패: {e}")
    except Exception as e:
        logger.error(f"[KPI] backfill-visitors 실패: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=f"카페24 방문자수 수집 실패: {e}")

    return {"upserted": upserted, "since": since_date.isoformat(), "until": until_date.isoformat()}


# ── Naver DataLab 검색어트렌드 프록시 ─────────────────────────────────────────

def _parse_qc_count(value) -> int:
    """네이버 검색광고 키워드도구 월간 검색량 파싱.

    정상적으로는 정수(문자열/숫자)로 오지만, 저노출 키워드는 "< 10" 형태 문자열로
    올 수 있어 방어적으로 파싱한다. 임계값 미만 표기는 임계값의 절반을 근사치로 사용.
    """
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    s = str(value).strip()
    if not s:
        return 0
    m = re.match(r"^<\s*([\d,]+)", s)
    if m:
        n = int(m.group(1).replace(",", ""))
        return max(0, n // 2)
    try:
        return int(float(s.replace(",", "")))
    except ValueError:
        return 0


@router.get("/naver-queries")
async def get_naver_queries(
    keywords: str = Query(..., description="쉼표 구분 키워드 (최대 5개)"),
    months: int = Query(default=6, ge=1, le=24),
    current_user: User = Depends(get_current_user),
):
    """네이버 DataLab 검색어트렌드(월 단위) 조회. NAVER_CLIENT_ID/SECRET 미설정 시 503."""
    settings = get_settings()
    if not settings.NAVER_CLIENT_ID or not settings.NAVER_CLIENT_SECRET:
        raise HTTPException(
            status_code=503,
            detail="NAVER_CLIENT_ID / NAVER_CLIENT_SECRET이 설정되어 있지 않습니다.",
        )

    keyword_list = [k.strip() for k in keywords.split(",") if k.strip()][:5]
    if not keyword_list:
        raise HTTPException(status_code=422, detail="keywords가 비어 있습니다.")

    end_date = date.today()
    start_year = end_date.year
    start_month = end_date.month - (months - 1)
    while start_month <= 0:
        start_month += 12
        start_year -= 1
    start_date = date(start_year, start_month, 1)

    headers = {
        "X-Naver-Client-Id": settings.NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": settings.NAVER_CLIENT_SECRET,
        "Content-Type": "application/json",
    }
    keyword_groups = [{"groupName": kw, "keywords": [kw]} for kw in keyword_list]

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                "https://openapi.naver.com/v1/datalab/search",
                headers=headers,
                json={
                    "startDate": start_date.isoformat(),
                    "endDate": end_date.isoformat(),
                    "timeUnit": "month",
                    "keywordGroups": keyword_groups,
                },
            )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"네이버 DataLab 요청 실패: {e}")

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"네이버 DataLab API 오류 {resp.status_code}: {resp.text[:300]}",
        )

    data = resp.json()
    results = data.get("results", [])

    # ── 절대 검색량 (네이버 검색광고 키워드도구) — 미설정/실패 시 조용히 생략 ──
    volumes: dict[str, dict] = {}
    results_absolute: list[dict] = []
    if settings.NAVER_ADS_API_KEY and settings.NAVER_ADS_SECRET_KEY and settings.NAVER_ADS_CUSTOMER_ID:
        try:
            from app.services.naver.search_ads_api import NaverSearchAdsAPI

            ads_client = NaverSearchAdsAPI(
                api_key=settings.NAVER_ADS_API_KEY,
                secret_key=settings.NAVER_ADS_SECRET_KEY,
                customer_id=settings.NAVER_ADS_CUSTOMER_ID,
            )
            raw_volumes = await ads_client.get_keyword_search_volume(keyword_list)

            def _norm(s: str) -> str:
                return re.sub(r"\s+", "", (s or "")).upper()

            norm_map = {_norm(kw): kw for kw in keyword_list}
            for item in raw_volumes or []:
                rel = item.get("relKeyword") or item.get("keyword") or ""
                orig = norm_map.get(_norm(rel))
                if not orig:
                    continue
                pc = _parse_qc_count(item.get("monthlyPcQcCnt"))
                mobile = _parse_qc_count(item.get("monthlyMobileQcCnt"))
                volumes[orig] = {"total": pc + mobile, "pc": pc, "mobile": mobile}
        except Exception as e:
            logger.warning(f"[KPI] naver-queries 절대 검색량 조회 실패 (무시하고 진행): {e}")
            volumes = {}

        if volumes:
            current_month_str = f"{date.today().year:04d}-{date.today().month:02d}"
            for result in results:
                title = result.get("title")
                data_points = result.get("data") or []
                vol = volumes.get(title)
                if vol is None:
                    continue
                monthly_total = vol["total"]

                # 앵커: 당월 제외, 가장 최근 period 중 ratio>0 인 것
                anchor_ratio = None
                for point in sorted(data_points, key=lambda p: p.get("period", ""), reverse=True):
                    period = point.get("period", "") or ""
                    if period[:7] == current_month_str:
                        continue
                    ratio = point.get("ratio") or 0
                    if ratio > 0:
                        anchor_ratio = ratio
                        break
                if not anchor_ratio:
                    continue  # 앵커 없으면 절대값 생략

                abs_data = [
                    {
                        "period": point.get("period"),
                        "count": round((point.get("ratio") or 0) / anchor_ratio * monthly_total),
                    }
                    for point in data_points
                ]
                results_absolute.append({"title": title, "data": abs_data})

    response = {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "keywords": keyword_list,
        "results": results,
    }
    if volumes:
        response["volumes"] = volumes
    if results_absolute:
        response["results_absolute"] = results_absolute
    return response


# ── 엑셀 다운로드 ──────────────────────────────────────────────────────────────

@router.get("/export")
async def export_kpi_excel(
    granularity: str = Query(default="month", description="month | week | day"),
    months: int = Query(default=6, ge=1, le=24),
    days: int = Query(default=30, ge=7, le=190, description="week/day granularity 전용 — 최근 N일"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """마케팅 KPI 요약을 엑셀(xlsx)로 다운로드. 파라미터는 /summary와 동일."""
    if granularity not in ("month", "week", "day"):
        raise HTTPException(status_code=422, detail="granularity 는 month, week, day 중 하나여야 합니다.")

    from io import BytesIO
    from urllib.parse import quote

    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter
    from fastapi.responses import StreamingResponse

    data = await _kpi_summary_data(db, granularity, months, days)
    items = data["months"]
    month_mode = granularity == "month"

    header_font = Font(bold=True)
    header_fill = PatternFill(start_color="D9D9D9", end_color="D9D9D9", fill_type="solid")
    center = Alignment(horizontal="center", vertical="center")
    money_fmt = "#,##0"
    ratio_fmt = "0.00"

    headers = [
        "기간", "총광고비", "Meta 광고비", "네이버 광고비",
        "주문수", "매출", "AOV", "방문자수", "구매전환율(%)",
        "신규고객수", "CAC", "LTV", "LTV/CAC",
    ]
    if month_mode:
        headers += ["목표CAC", "목표LTV", "목표전환율", "목표AOV", "목표신규"]

    # 1-based 컬럼 인덱스 기준 서식 그룹
    money_cols = {2, 3, 4, 6, 7, 11, 12}   # 총광고비/Meta/네이버/매출/AOV/CAC/LTV
    ratio_cols = {9, 13}                    # 구매전환율(%)/LTV_CAC
    if month_mode:
        money_cols |= {14, 15, 17}          # 목표CAC/목표LTV/목표AOV
        ratio_cols |= {16}                  # 목표전환율

    wb = Workbook()
    ws = wb.active
    ws.title = "KPI 요약"
    for ci, h in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=ci, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center

    for ri, item in enumerate(items, start=2):
        channel_spends = item.get("channel_spends") or []
        meta_actual = sum(
            (cs.get("actual_amount") or 0.0) for cs in channel_spends if cs.get("channel") == "meta"
        )
        naver_actual = sum(
            (cs.get("actual_amount") or 0.0) for cs in channel_spends if cs.get("channel") == "naver_sa"
        )
        mall = item.get("mall") or {}

        if month_mode:
            period_label = item["month"]
        else:
            start_s = item["month"]
            end_s = item.get("bucket_end") or start_s
            period_label = start_s if start_s == end_s else f"{start_s} ~ {end_s}"

        row_vals = [
            period_label,
            item.get("total_ad_spend"),
            round(meta_actual, 2),
            round(naver_actual, 2),
            mall.get("orders_count"),
            mall.get("revenue"),
            mall.get("aov"),
            mall.get("visits"),
            mall.get("conversion_rate"),
            mall.get("new_customers"),
            item.get("cac"),
            item.get("ltv"),
            item.get("ltv_cac"),
        ]
        if month_mode:
            goal = item.get("goal") or {}
            row_vals += [
                goal.get("target_cac"),
                goal.get("target_ltv"),
                goal.get("target_conversion_rate"),
                goal.get("target_aov"),
                goal.get("target_new_customers"),
            ]

        for ci, val in enumerate(row_vals, start=1):
            cell = ws.cell(row=ri, column=ci, value=val)
            if isinstance(val, (int, float)):
                if ci in money_cols:
                    cell.number_format = money_fmt
                elif ci in ratio_cols:
                    cell.number_format = ratio_fmt

    widths = [16, 14, 14, 14, 10, 14, 12, 12, 14, 12, 12, 12, 10]
    if month_mode:
        widths += [12, 12, 12, 12, 12]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A2"

    # ── Sheet2: 채널 광고비 (월 모드만) ──
    if month_mode:
        ws2 = wb.create_sheet("채널 광고비")
        ch_headers = ["월", "채널", "예산", "실적", "자동여부", "메모"]
        for ci, h in enumerate(ch_headers, start=1):
            cell = ws2.cell(row=1, column=ci, value=h)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = center

        r = 2
        for item in items:
            for cs in item.get("channel_spends") or []:
                ws2.cell(row=r, column=1, value=item["month"])
                ws2.cell(row=r, column=2, value=cs.get("channel"))
                ws2.cell(row=r, column=3, value=cs.get("planned_amount") or 0.0).number_format = money_fmt
                ws2.cell(row=r, column=4, value=cs.get("actual_amount") or 0.0).number_format = money_fmt
                ws2.cell(row=r, column=5, value="자동" if cs.get("is_auto") else "수동")
                ws2.cell(row=r, column=6, value=cs.get("memo") or "")
                r += 1

        ch_widths = [10, 14, 14, 14, 10, 24]
        for i, w in enumerate(ch_widths, start=1):
            ws2.column_dimensions[get_column_letter(i)].width = w
        ws2.freeze_panes = "A2"

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)

    if items:
        start_label = items[0]["month"]
        end_label = items[-1].get("bucket_end") or items[-1]["month"]
    else:
        start_label = end_label = "no-data"
    filename = f"마케팅KPI_{start_label}_{end_label}.xlsx"
    quoted = quote(filename)

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quoted}"},
    )
