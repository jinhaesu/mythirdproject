"""마케팅 KPI 모듈 — 몰 전체 주문 + 채널 광고비 + CAC/LTV/전환율 대시보드.

자사몰(mall) KPI와 그 외(external) KPI를 분리한다. naver_sa(네이버 검색광고)는 자사몰(카페24)로
연결되지 않는 채널이므로 자사몰 summary/export에서 제외하고 "그 외" KPI로 이동했다. "그 외" KPI에는
어필리에이트(인플루언서 공동구매) 매출(app.models.affiliate.ReferralConversion)을 연동한다.

엔드포인트:
  GET    /api/v1/kpi/summary?granularity=month|week|day — 자사몰 KPI 요약 (month=월별 요약, week/day=최근 N일 버킷)
  PUT    /api/v1/kpi/goals/{month}               — 월간 목표 upsert
  GET    /api/v1/kpi/goals?months=12             — 월간 목표 목록
  PUT    /api/v1/kpi/channel-spend               — 채널별 월 광고비 upsert (scope: mall|external, 기본 mall)
  DELETE /api/v1/kpi/channel-spend/{id}          — 채널별 월 광고비 삭제
  POST   /api/v1/kpi/backfill-orders             — Cafe24 주문 백필 (MallOrder)
  GET    /api/v1/kpi/naver-queries               — 네이버 DataLab 검색어트렌드 프록시 + 절대 검색량(키워드도구)
  POST   /api/v1/kpi/backfill-naver-spend         — 네이버 검색광고 일별 광고비 백필
  POST   /api/v1/kpi/backfill-visitors            — 카페24 일별 방문자수 백필
  GET    /api/v1/kpi/export                      — 자사몰 KPI 요약 엑셀 다운로드 (summary와 동일 파라미터)
  GET    /api/v1/kpi/external-summary?months=12  — 그 외(외부) KPI 요약 (naver_sa 자동 + 어필리에이트 공동구매 매출)
  PUT    /api/v1/kpi/external-goals/{month}      — 그 외 KPI 월간 목표 upsert
  GET    /api/v1/kpi/external-goals?months=12    — 그 외 KPI 월간 목표 목록
  GET    /api/v1/kpi/external-export             — 그 외 KPI 요약 엑셀 다운로드
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
from app.models.affiliate import AffiliateCampaign, ReferralConversion
from app.models.kpi import (
    ChannelSpendDaily,
    ExternalMarketingGoal,
    MallMember,
    MallOrder,
    MallVisitorsDaily,
    MarketingGoal,
    MonthlyChannelSpend,
)
from app.models.meta_insight import MetaInsightDaily
from app.models.user import User
from app.services import cafe24 as cafe24_svc
from app.services.attribution import CONFIRMED_SOURCES
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


async def _daily_channel_spend_by_month(
    db: AsyncSession, channel: str, range_start: date, range_end: date
) -> dict[str, float]:
    """ChannelSpendDaily(channel=channel)의 일별 자동 수집 광고비를 월 합산."""
    rows = (
        await db.execute(
            select(ChannelSpendDaily.date, ChannelSpendDaily.spend).where(
                ChannelSpendDaily.channel == channel,
                ChannelSpendDaily.date >= range_start,
                ChannelSpendDaily.date <= range_end,
            )
        )
    ).all()
    spend_by_month: dict[str, float] = defaultdict(float)
    for d, spend in rows:
        spend_by_month[f"{d.year:04d}-{d.month:02d}"] += float(spend or 0)
    return spend_by_month


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
                "channel_label": None if is_auto else row.channel_label,
                "revenue_linked": False if is_auto else bool(row.revenue_linked),
                "revenue": None if is_auto else row.revenue,
                "views": row.views,
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
                "channel_label": None,
                "revenue_linked": False,
                "revenue": None,
                "views": None,
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


def _serialize_external_goal(goal: ExternalMarketingGoal) -> dict:
    return {
        "id": goal.id,
        "month": goal.month,
        "target_spend": goal.target_spend,
        "target_revenue": goal.target_revenue,
        "actual_revenue_manual": goal.actual_revenue_manual,
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

    # ── 채널별 월 광고비 (수동 입력, 자사몰 scope만) — naver_sa는 자사몰로 연결되지
    #    않으므로 자동 병합하지 않는다 (그 외 KPI로 이동, /kpi/external-summary 참고) ──
    spend_rows = (
        await db.execute(
            select(MonthlyChannelSpend).where(
                MonthlyChannelSpend.month.in_(month_list),
                MonthlyChannelSpend.scope == "mall",
            )
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

        # 채널별 광고비 병합 (meta는 actual_amount 미입력 시 자동 계산값 채움).
        # naver_sa는 자사몰로 연결되지 않는 채널이므로 자동 병합 대상에서 제외했다
        # (scope='mall'로 필터된 rows_this_month에 naver_sa 행이 수동으로 남아있다면
        #  아래 "나머지 채널" 루프에서 수동 입력 그대로 반영된다).
        rows_this_month = spend_by_month.get(month_key, [])
        channel_spends: list[dict] = []
        total_ad_spend = 0.0

        meta_entries, meta_total = _merge_channel_spend(
            "meta", month_key, meta_spend, rows_this_month, always_include_virtual=True
        )
        channel_spends.extend(meta_entries)
        total_ad_spend += meta_total

        # 자동 계산값이 없는 나머지 채널 (수동 입력 그대로 반영)
        for row in rows_this_month:
            if row.channel == "meta":
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
                    "channel_label": row.channel_label,
                    "revenue_linked": bool(row.revenue_linked),
                    "revenue": row.revenue,
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
        member_orders = orders_count - guest_orders
        avg_orders_per_customer = round(member_orders / buyers, 3) if buyers else None
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
                    "avg_orders_per_customer": avg_orders_per_customer,
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

    ltv/ltv_cac/goal은 항상 None (월 단위 전용 지표). channel_spends는 meta 자동 1행만
    포함한다 (naver_sa는 자사몰로 연결되지 않는 채널이라 그 외 KPI로 이동).
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

        channel_spends = [
            {
                "id": None,
                "month": key,
                "channel": "meta",
                "planned_amount": 0.0,
                "actual_amount": meta_spend,
                "is_auto": True,
                "memo": None,
                "channel_label": None,
                "revenue_linked": False,
                "revenue": None,
            },
        ]
        total_ad_spend = round(meta_spend, 2)

        orders_this_bucket = mall_by_bucket.get(key, [])
        orders_count = len(orders_this_bucket)
        revenue = round(sum(o.amount or 0.0 for o in orders_this_bucket), 2)
        member_ids = {o.member_id for o in orders_this_bucket if o.member_id}
        buyers = len(member_ids)
        guest_orders = sum(1 for o in orders_this_bucket if not o.member_id)
        aov = round(revenue / orders_count, 2) if orders_count else None
        member_orders = orders_count - guest_orders
        avg_orders_per_customer = round(member_orders / buyers, 3) if buyers else None
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
                    "avg_orders_per_customer": avg_orders_per_customer,
                },
                "cac": cac,
                "ltv": None,
                "ltv_cac": None,
                "goal": None,
            }
        )

    return {"months": buckets_out, "granularity": granularity}


# ── 그 외(외부) KPI ────────────────────────────────────────────────────────────

async def _external_summary_monthly(db: AsyncSession, months: int) -> dict:
    """최근 N개월(당월 포함) '그 외(외부)' 마케팅 KPI 요약.

    naver_sa(네이버 검색광고)는 자사몰(카페24)로 연결되지 않는 채널이라 자동 병합
    대상이며, MonthlyChannelSpend(scope='external') 수동 입력 채널과 병합한다.
    매출은 어필리에이트(인플루언서 공동구매) ReferralConversion(status='paid') +
    ExternalMarketingGoal.actual_revenue_manual(자동 집계 외 판매채널 수동 보정)을 합산한다.
    """
    month_list = _recent_months(months)
    range_start, _ = _month_bounds(month_list[0])
    _, range_end = _month_bounds(month_list[-1])

    # ── 네이버 검색광고 일별 광고비 (자동 수집 스냅샷 → 월 합산) ──
    naver_spend_by_month = await _daily_channel_spend_by_month(db, "naver_sa", range_start, range_end)

    # ── 채널별 월 광고비 (수동 입력, 그 외 scope만) ──
    spend_rows = (
        await db.execute(
            select(MonthlyChannelSpend).where(
                MonthlyChannelSpend.month.in_(month_list),
                MonthlyChannelSpend.scope == "external",
            )
        )
    ).scalars().all()
    spend_by_month: dict[str, list[MonthlyChannelSpend]] = defaultdict(list)
    for row in spend_rows:
        spend_by_month[row.month].append(row)

    # ── 어필리에이트 공동구매 매출 (ReferralConversion, status='paid') ──
    range_start_dt = datetime.combine(range_start, datetime.min.time())
    range_end_dt = datetime.combine(range_end, datetime.max.time())
    rc_rows = (
        await db.execute(
            select(
                ReferralConversion.converted_at,
                ReferralConversion.order_amount,
                ReferralConversion.campaign_id,
            ).where(
                ReferralConversion.status == "paid",
                # 확정 귀속만 집계 — 추정 라스트클릭은 오가닉 주문까지 흡수 (2026-07-20)
                ReferralConversion.attribution_source.in_(sorted(CONFIRMED_SOURCES)),
                ReferralConversion.converted_at >= range_start_dt,
                ReferralConversion.converted_at <= range_end_dt,
            )
        )
    ).all()
    groupbuy_revenue_by_month: dict[str, float] = defaultdict(float)
    groupbuy_orders_by_month: dict[str, int] = defaultdict(int)
    campaign_agg: dict[Optional[int], dict] = defaultdict(lambda: {"revenue": 0.0, "orders": 0})
    for converted_at, order_amount, campaign_id in rc_rows:
        if not converted_at:
            continue
        month_key = f"{converted_at.year:04d}-{converted_at.month:02d}"
        groupbuy_revenue_by_month[month_key] += float(order_amount or 0.0)
        groupbuy_orders_by_month[month_key] += 1
        campaign_agg[campaign_id]["revenue"] += float(order_amount or 0.0)
        campaign_agg[campaign_id]["orders"] += 1

    # ── 캠페인명 조인 (상위 10 캠페인) ──
    campaign_ids = [cid for cid in campaign_agg.keys() if cid is not None]
    campaign_name_by_id: dict[int, str] = {}
    if campaign_ids:
        name_rows = (
            await db.execute(
                select(AffiliateCampaign.id, AffiliateCampaign.name).where(
                    AffiliateCampaign.id.in_(campaign_ids)
                )
            )
        ).all()
        campaign_name_by_id = {cid: name for cid, name in name_rows}

    top_campaigns = sorted(
        (
            {
                "campaign_id": cid,
                "campaign_name": campaign_name_by_id.get(cid) if cid is not None else None,
                "revenue": round(agg["revenue"], 2),
                "orders": agg["orders"],
            }
            for cid, agg in campaign_agg.items()
        ),
        key=lambda c: c["revenue"],
        reverse=True,
    )[:10]

    # ── 목표 ──
    goal_rows = (
        await db.execute(
            select(ExternalMarketingGoal).where(ExternalMarketingGoal.month.in_(month_list))
        )
    ).scalars().all()
    goal_by_month = {g.month: g for g in goal_rows}

    months_out = []
    for month_key in month_list:
        naver_spend = round(naver_spend_by_month.get(month_key, 0.0), 2)
        rows_this_month = spend_by_month.get(month_key, [])

        channel_spends: list[dict] = []
        total_spend = 0.0

        naver_entries, naver_total = _merge_channel_spend(
            "naver_sa", month_key, naver_spend, rows_this_month, always_include_virtual=False
        )
        channel_spends.extend(naver_entries)
        total_spend += naver_total

        for row in rows_this_month:
            if row.channel == "naver_sa":
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
                    "channel_label": row.channel_label,
                    "revenue_linked": bool(row.revenue_linked),
                    "revenue": row.revenue,
                    "views": row.views,
                }
            )
            total_spend += resolved

        groupbuy_revenue = round(groupbuy_revenue_by_month.get(month_key, 0.0), 2)
        groupbuy_orders = groupbuy_orders_by_month.get(month_key, 0)
        goal = goal_by_month.get(month_key)
        manual_revenue = goal.actual_revenue_manual if goal else None
        # 매출 관여 채널의 채널 매출 합 (scope='external' 행 중 revenue_linked=True)
        channel_revenue = round(
            sum((row.revenue or 0.0) for row in rows_this_month if row.revenue_linked), 2
        )
        total_revenue = round(groupbuy_revenue + channel_revenue + (manual_revenue or 0.0), 2)

        months_out.append(
            {
                "month": month_key,
                "channel_spends": channel_spends,
                "total_spend": round(total_spend, 2),
                "groupbuy_revenue": groupbuy_revenue,
                "groupbuy_orders": groupbuy_orders,
                "channel_revenue": channel_revenue,
                "manual_revenue": manual_revenue,
                "total_revenue": total_revenue,
                "goal": _serialize_external_goal(goal) if goal else None,
            }
        )

    return {"months": months_out, "top_campaigns": top_campaigns}


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


@router.get("/external-summary")
async def get_external_kpi_summary(
    months: int = Query(default=12, ge=1, le=24),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """그 외(외부) 마케팅 KPI 요약 — naver_sa 자동 + 어필리에이트 공동구매 매출 + 목표."""
    return await _external_summary_monthly(db, months)


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


# ── External Goals (그 외/외부 KPI) ────────────────────────────────────────────

class ExternalMarketingGoalUpsert(BaseModel):
    target_spend: Optional[float] = None
    target_revenue: Optional[float] = None
    actual_revenue_manual: Optional[float] = None
    memo: Optional[str] = None


@router.put("/external-goals/{month}")
async def upsert_external_marketing_goal(
    month: str,
    payload: ExternalMarketingGoalUpsert,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """그 외(외부) 마케팅 KPI 월간 목표 upsert. 지정된 필드만 갱신 (미지정은 기존값 유지)."""
    _validate_month(month)
    result = await db.execute(
        select(ExternalMarketingGoal).where(ExternalMarketingGoal.month == month)
    )
    goal = result.scalar_one_or_none()
    if goal is None:
        goal = ExternalMarketingGoal(month=month)
        db.add(goal)
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(goal, field, value)
    await db.commit()
    await db.refresh(goal)
    return _serialize_external_goal(goal)


@router.get("/external-goals")
async def list_external_marketing_goals(
    months: int = Query(default=12, ge=1, le=24),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """최근 N개월 범위 내 저장된 그 외(외부) 마케팅 목표 목록 (없는 월은 생략)."""
    month_list = _recent_months(months)
    result = await db.execute(
        select(ExternalMarketingGoal)
        .where(ExternalMarketingGoal.month.in_(month_list))
        .order_by(ExternalMarketingGoal.month)
    )
    goals = result.scalars().all()
    return {"goals": [_serialize_external_goal(g) for g in goals]}


# ── 데이터 대시보드 ──────────────────────────────────────────────────────────

_DD_CHANNEL_LABELS = {
    "meta": "메타",
    "naver_sa": "네이버 검색광고",
    "naver_gfa": "네이버 GFA",
    "kakao": "카카오",
    "google": "구글",
    "youtube": "유튜브",
    "tiktok": "틱톡",
    "instagram": "인스타그램",
}


@router.get("/data-dashboard")
async def get_data_dashboard(
    months: int = Query(default=6, ge=1, le=24),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """데이터 대시보드 — 판매/집행 채널별 월 지표 통합 뷰.

    - involved(지표 관여): ROAS를 따지는 채널 — meta(자동: 인사이츠 spend/귀속매출),
      naver_sa(자동 spend), 그리고 KPI 탭에서 revenue_linked=True로 입력한 채널.
    - uninvolved(지표 비관여): 브랜딩 집행 — revenue_linked=False로 입력한 채널의
      광고비·조회수(views). 유튜브·메타 브랜딩 등.
    자사몰/그 외 마케팅 KPI 탭의 수기 입력(MonthlyChannelSpend)과 실시간 연동된다.
    """
    month_list = _recent_months(months)
    range_start, _ = _month_bounds(month_list[0])
    _, range_end = _month_bounds(month_list[-1])

    # ── 자동값: 메타 spend/귀속매출 월별 ──
    meta_rows = (
        await db.execute(
            select(
                func.to_char(MetaInsightDaily.date, "YYYY-MM").label("m"),
                func.coalesce(func.sum(MetaInsightDaily.spend), 0),
                func.coalesce(func.sum(MetaInsightDaily.revenue), 0),
            )
            .where(
                MetaInsightDaily.level == "campaign",
                MetaInsightDaily.date >= range_start,
                MetaInsightDaily.date <= range_end,
            )
            .group_by("m")
        )
    ).all()
    meta_by_month = {m: (float(s), float(r)) for m, s, r in meta_rows}

    # ── 자동값: 네이버 검색광고 spend 월별 ──
    naver_by_month = await _daily_channel_spend_by_month(db, "naver_sa", range_start, range_end)

    # ── 자사몰 총매출 월별 (컨텍스트) ──
    mall_rows = (
        await db.execute(
            select(
                func.to_char(MallOrder.order_date, "YYYY-MM").label("m"),
                func.coalesce(func.sum(MallOrder.amount), 0),
            )
            .where(
                MallOrder.order_date >= range_start,
                MallOrder.order_date <= range_end,
                MallOrder.status == "paid",
            )
            .group_by("m")
        )
    ).all()
    mall_rev_by_month = {m: float(v) for m, v in mall_rows}

    # ── 수동 입력 (mall + external 전체) ──
    spend_rows = (
        await db.execute(
            select(MonthlyChannelSpend).where(MonthlyChannelSpend.month.in_(month_list))
        )
    ).scalars().all()
    rows_by_month: dict[str, list[MonthlyChannelSpend]] = defaultdict(list)
    for row in spend_rows:
        rows_by_month[row.month].append(row)

    def _label(channel: str, channel_label: Optional[str]) -> str:
        return channel_label or _DD_CHANNEL_LABELS.get(channel, channel)

    months_out = []
    for month_key in month_list:
        involved: list[dict] = []
        uninvolved: list[dict] = []
        rows_this = rows_by_month.get(month_key, [])

        # 메타 — 수동 행(scope=mall, channel=meta)이 있으면 spend/revenue 오버라이드
        meta_auto_spend, meta_auto_rev = meta_by_month.get(month_key, (0.0, 0.0))
        meta_manual = next((r for r in rows_this if r.channel == "meta" and r.scope == "mall"), None)
        meta_spend = (
            meta_manual.actual_amount
            if meta_manual is not None and meta_manual.actual_amount is not None
            else meta_auto_spend
        )
        meta_rev = (
            meta_manual.revenue
            if meta_manual is not None and meta_manual.revenue_linked and meta_manual.revenue is not None
            else meta_auto_rev
        )
        if meta_spend or meta_rev:
            involved.append({
                "channel": "meta",
                "label": "메타 (자사몰)",
                "spend": round(meta_spend, 2),
                "revenue": round(meta_rev, 2),
                "roas": round(meta_rev / meta_spend, 2) if meta_spend else None,
                "is_auto": meta_manual is None or meta_manual.actual_amount is None,
            })

        # 네이버 검색광고 — 자동 spend, 수동 행 있으면 관여 여부/매출 반영
        naver_auto = round(naver_by_month.get(month_key, 0.0), 2)
        naver_manual = next((r for r in rows_this if r.channel == "naver_sa"), None)
        naver_spend = (
            naver_manual.actual_amount
            if naver_manual is not None and naver_manual.actual_amount is not None
            else naver_auto
        )
        if naver_spend:
            if naver_manual is not None and not naver_manual.revenue_linked:
                uninvolved.append({
                    "channel": "naver_sa",
                    "label": "네이버 검색광고",
                    "spend": round(naver_spend, 2),
                    "views": naver_manual.views,
                })
            else:
                nrev = naver_manual.revenue if (naver_manual and naver_manual.revenue_linked) else None
                involved.append({
                    "channel": "naver_sa",
                    "label": "네이버 검색광고",
                    "spend": round(naver_spend, 2),
                    "revenue": nrev,
                    "roas": round(nrev / naver_spend, 2) if (nrev and naver_spend) else None,
                    "is_auto": naver_manual is None or naver_manual.actual_amount is None,
                })

        # 나머지 수동 채널
        for row in rows_this:
            if row.channel == "naver_sa":
                continue  # 위에서 자동값과 병합 처리됨
            if row.channel == "meta" and row.scope == "mall":
                continue  # 위에서 자동값과 병합 처리됨
            spend = row.actual_amount or 0.0
            entry_label = _label(row.channel, row.channel_label)
            if row.revenue_linked:
                rev = row.revenue or 0.0
                involved.append({
                    "channel": row.channel,
                    "label": entry_label,
                    "spend": round(spend, 2),
                    "revenue": round(rev, 2),
                    "roas": round(rev / spend, 2) if spend else None,
                    "is_auto": False,
                })
            else:
                uninvolved.append({
                    "channel": row.channel,
                    "label": entry_label,
                    "spend": round(spend, 2),
                    "views": row.views,
                })

        inv_spend = round(sum(e["spend"] for e in involved), 2)
        inv_rev = round(sum((e["revenue"] or 0.0) for e in involved), 2)
        uninv_spend = round(sum(e["spend"] for e in uninvolved), 2)
        uninv_views = round(sum((e["views"] or 0.0) for e in uninvolved), 0)

        months_out.append({
            "month": month_key,
            "involved": sorted(involved, key=lambda e: -e["spend"]),
            "uninvolved": sorted(uninvolved, key=lambda e: -e["spend"]),
            "totals": {
                "involved_spend": inv_spend,
                "involved_revenue": inv_rev,
                "blended_roas": round(inv_rev / inv_spend, 2) if inv_spend else None,
                "uninvolved_spend": uninv_spend,
                "uninvolved_views": uninv_views,
                "total_spend": round(inv_spend + uninv_spend, 2),
                "mall_revenue": round(mall_rev_by_month.get(month_key, 0.0), 2),
            },
        })

    return {"months": months_out}


# ── Channel spend ────────────────────────────────────────────────────────────

class ChannelSpendUpsert(BaseModel):
    month: str
    channel: str
    scope: Optional[str] = None  # "mall" | "external", 기본 "mall"
    planned_amount: Optional[float] = None
    actual_amount: Optional[float] = None
    memo: Optional[str] = None
    revenue_linked: Optional[bool] = None  # 매출 관여 여부 (True면 해당 채널 매출도 등록)
    revenue: Optional[float] = None  # 관여 시 해당 채널 매출
    channel_label: Optional[str] = None  # channel='etc' 등 커스텀 채널명
    views: Optional[float] = None  # 비관여(브랜딩) 채널 월 조회수


@router.put("/channel-spend")
async def upsert_channel_spend(
    payload: ChannelSpendUpsert,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """채널별 월 광고비(예산/실적) upsert. (month, channel, scope) 유니크 기준.

    scope 미지정 시 "mall"(자사몰). "external"이면 그 외(외부) KPI에 반영된다.
    revenue_linked=True(매출 관여)이면 revenue(해당 채널 매출)도 함께 저장한다.
    channel='etc' 선택 시 channel_label로 커스텀 채널명을 지정할 수 있다.
    """
    _validate_month(payload.month)
    if not payload.channel or not payload.channel.strip():
        raise HTTPException(status_code=422, detail="channel은 필수입니다.")
    channel = payload.channel.strip()
    scope = (payload.scope or "mall").strip() or "mall"
    if scope not in ("mall", "external"):
        raise HTTPException(status_code=422, detail="scope는 mall 또는 external이어야 합니다.")

    result = await db.execute(
        select(MonthlyChannelSpend).where(
            MonthlyChannelSpend.month == payload.month,
            MonthlyChannelSpend.channel == channel,
            MonthlyChannelSpend.scope == scope,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        row = MonthlyChannelSpend(month=payload.month, channel=channel, scope=scope)
        db.add(row)

    if payload.planned_amount is not None:
        row.planned_amount = payload.planned_amount
    if payload.actual_amount is not None:
        row.actual_amount = payload.actual_amount
    if payload.memo is not None:
        row.memo = payload.memo
    if payload.revenue_linked is not None:
        row.revenue_linked = payload.revenue_linked
    if payload.revenue is not None:
        row.revenue = payload.revenue
    if payload.channel_label is not None:
        row.channel_label = payload.channel_label
    if payload.views is not None:
        row.views = payload.views

    await db.commit()
    await db.refresh(row)
    return {
        "id": row.id,
        "month": row.month,
        "channel": row.channel,
        "scope": row.scope,
        "planned_amount": row.planned_amount,
        "actual_amount": row.actual_amount,
        "memo": row.memo,
        "channel_label": row.channel_label,
        "revenue_linked": row.revenue_linked,
        "revenue": row.revenue,
        "views": row.views,
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


# ── 회원 인구통계 (가입 히트맵 + 연령·성별 CAC/LTV) ──────────────────────────

@router.post("/backfill-members")
async def backfill_members(
    mode: str = Query(default="orders", description="orders=구매회원 보강(customers API) | privacy=전체 가입자 백필(customersprivacy, 재동의 필요)"),
    limit: int = Query(default=500, ge=1, le=2000, description="orders 모드: 이번 호출에서 보강할 회원 수"),
    since: Optional[str] = Query(default=None, description="privacy 모드: 가입일 시작 YYYY-MM-DD"),
    until: Optional[str] = Query(default=None, description="privacy 모드: 가입일 끝 YYYY-MM-DD"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """카페24 회원 정보(가입일시·성별·출생연도)를 MallMember에 백필."""
    from app.services.kpi_collectors import backfill_members_privacy, sync_mall_members

    if mode == "privacy":
        if not since:
            raise HTTPException(status_code=422, detail="privacy 모드는 since(YYYY-MM-DD)가 필요합니다.")
        try:
            since_d = date.fromisoformat(since)
            until_d = date.fromisoformat(until) if until else date.today()
        except ValueError:
            raise HTTPException(status_code=422, detail="since/until은 YYYY-MM-DD 형식이어야 합니다.")
        try:
            return await backfill_members_privacy(db, since_d, until_d)
        except httpx.HTTPStatusError as e:
            status_code = e.response.status_code if e.response is not None else 502
            if status_code == 403:
                raise HTTPException(
                    status_code=400,
                    detail="카페24 앱에 개인정보 읽기(mall.read_privacy) 권한 추가 + 재동의가 필요합니다.",
                )
            raise HTTPException(status_code=502, detail=f"카페24 회원 백필 실패: {e}")

    return await sync_mall_members(db, limit=limit)


@router.get("/signup-heatmap")
async def get_signup_heatmap(
    months: int = Query(default=3, ge=1, le=24),
    gender: str = Query(default="all", description="all | M | F"),
    age_band: str = Query(default="all", description="all | 13-17 | 18-24 | 25-34 | 35-44 | 45-54 | 55-64 | 65+"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """기간 내 회원가입 시간대 히트맵 — 요일(월=0)×시간(0~23) 매트릭스.

    데이터 소스: mall_members.joined_at (카페24 회원 가입일시, KST).
    gender/age_band 필터는 privacy 데이터(성별·생년) 보강 회원에만 적용 가능 —
    미보강 회원은 필터 선택 시 집계에서 제외된다.
    """
    if gender not in ("all", "M", "F"):
        raise HTTPException(status_code=422, detail="gender 는 all|M|F 여야 합니다.")
    if age_band != "all" and age_band not in _AGE_BANDS:
        raise HTTPException(status_code=422, detail=f"age_band 는 all 또는 {_AGE_BANDS} 중 하나여야 합니다.")

    month_list = _recent_months(months)
    range_start, _ = _month_bounds(month_list[0])
    _, range_end = _month_bounds(month_list[-1])
    start_dt = datetime.combine(range_start, datetime.min.time())
    end_dt = datetime.combine(range_end + timedelta(days=1), datetime.min.time())

    stmt = select(MallMember.joined_at, MallMember.birthyear).where(
        MallMember.joined_at.isnot(None),
        MallMember.joined_at >= start_dt,
        MallMember.joined_at < end_dt,
    )
    if gender != "all":
        stmt = stmt.where(MallMember.gender == gender)
    member_rows = (await db.execute(stmt)).all()

    as_of = date.today()
    matrix = [[0] * 24 for _ in range(7)]
    monthly_counts: dict[str, int] = defaultdict(int)
    filtered_total = 0
    for joined, birthyear in member_rows:
        if age_band != "all" and _age_band(birthyear, as_of) != age_band:
            continue
        matrix[joined.weekday()][joined.hour] += 1
        monthly_counts[f"{joined.year:04d}-{joined.month:02d}"] += 1
        filtered_total += 1

    total_members = (
        await db.execute(select(func.count()).select_from(MallMember))
    ).scalar() or 0
    with_join = (
        await db.execute(
            select(func.count()).select_from(MallMember).where(MallMember.joined_at.isnot(None))
        )
    ).scalar() or 0
    privacy_members = (
        await db.execute(
            select(func.count()).select_from(MallMember).where(MallMember.source == "privacy")
        )
    ).scalar() or 0
    buyers_total = (
        await db.execute(
            select(func.count(func.distinct(MallOrder.member_id))).where(MallOrder.member_id.isnot(None))
        )
    ).scalar() or 0
    with_gender = (
        await db.execute(
            select(func.count()).select_from(MallMember).where(MallMember.gender.isnot(None))
        )
    ).scalar() or 0
    with_birthyear = (
        await db.execute(
            select(func.count()).select_from(MallMember).where(MallMember.birthyear.isnot(None))
        )
    ).scalar() or 0

    return {
        "since": range_start.isoformat(),
        "until": range_end.isoformat(),
        "matrix": matrix,
        "total": filtered_total,
        "weekday_totals": [sum(r) for r in matrix],
        "hour_totals": [sum(matrix[w][h] for w in range(7)) for h in range(24)],
        "monthly_counts": [{"month": m, "count": monthly_counts.get(m, 0)} for m in month_list],
        "coverage": {
            "members_enriched": total_members,
            "members_with_join": with_join,
            "buyers_total": buyers_total,
            "privacy_source": privacy_members,
            "full_signup_data": privacy_members > 0,
            "members_with_gender": with_gender,
            "members_with_birthyear": with_birthyear,
        },
    }


# Meta 연령·성별 광고비 breakdown 캐시 (모듈 레벨, TTL 6시간)
_meta_demo_cache: dict = {}


async def _meta_demographic_spend(db: AsyncSession, since: date, until: date) -> Optional[dict]:
    """Meta 인사이트 breakdowns=age,gender — 월×연령×성별 광고비.

    반환: {"age": {(month, band): spend}, "gender": {(month, band): spend}} | None(자격증명 없음/실패)
    """
    import time as _time

    cache_key = (since.isoformat(), until.isoformat())
    cached = _meta_demo_cache.get(cache_key)
    if cached and (_time.time() - cached[0] < 6 * 3600):
        return cached[1]

    meta_user = (
        await db.execute(
            select(User).where(User.meta_access_token.isnot(None), User.meta_access_token != "").limit(1)
        )
    ).scalar_one_or_none()
    if not meta_user or not meta_user.meta_ad_account_id:
        return None

    ad_account_id = meta_user.meta_ad_account_id
    if not ad_account_id.startswith("act_"):
        ad_account_id = f"act_{ad_account_id}"

    settings = get_settings()
    base = f"{settings.META_GRAPH_API_BASE}/{settings.META_API_VERSION}"
    params = {
        "access_token": meta_user.meta_access_token,
        "level": "account",
        "fields": "spend",
        "breakdowns": "age,gender",
        "time_increment": "monthly",
        "time_range": f'{{"since":"{since.isoformat()}","until":"{until.isoformat()}"}}',
        "limit": 500,
    }

    age_spend: dict[tuple[str, str], float] = defaultdict(float)
    gender_spend: dict[tuple[str, str], float] = defaultdict(float)
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            url = f"{base}/{ad_account_id}/insights"
            while True:
                resp = await client.get(url, params=params)
                body = resp.json()
                if body.get("error"):
                    logger.error(f"[KPI] Meta demographic insights 에러: {body['error']}")
                    return None
                for row in body.get("data", []):
                    month_key = str(row.get("date_start", ""))[:7]
                    spend = float(row.get("spend") or 0)
                    age_band = str(row.get("age") or "unknown").lower()
                    gender_raw = str(row.get("gender") or "unknown").lower()
                    gender_band = {"male": "M", "female": "F"}.get(gender_raw, "unknown")
                    age_spend[(month_key, age_band)] += spend
                    gender_spend[(month_key, gender_band)] += spend
                next_url = (body.get("paging") or {}).get("next")
                if not next_url:
                    break
                url, params = next_url, {}
    except Exception as e:
        logger.error(f"[KPI] Meta demographic insights 호출 실패: {e}")
        return None

    result = {"age": dict(age_spend), "gender": dict(gender_spend)}
    _meta_demo_cache[cache_key] = (_time.time(), result)
    return result


# Meta breakdown과 동일한 연령 밴드 사용 — CAC 분자(연령별 광고비)와 분모(연령별 신규고객) 기준 통일
_AGE_BANDS = ["13-17", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"]


def _age_band(birthyear: Optional[int], as_of: date) -> str:
    if not birthyear:
        return "unknown"
    age = as_of.year - birthyear  # 만 나이 근사 (생일 경과 여부 무시)
    if age < 13:
        return "unknown"
    if age <= 17:
        return "13-17"
    if age <= 24:
        return "18-24"
    if age <= 34:
        return "25-34"
    if age <= 44:
        return "35-44"
    if age <= 54:
        return "45-54"
    if age <= 64:
        return "55-64"
    return "65+"


@router.get("/demographics")
async def get_kpi_demographics(
    months: int = Query(default=6, ge=1, le=24),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """월별 연령대·성별 LTV/CAC/신규고객 — Meta 연령·성별 광고비 실데이터 결합.

    산식(응답 basis에 동일 내용 포함):
      - 신규고객: 해당 월에 사상 첫 paid 주문을 한 회원. 연령/성별은 mall_members 기준.
      - LTV: 해당 월 말일 기준 트레일링 180일 동안 paid 주문이 있는 회원 1인당 평균 매출을
        연령대/성별 그룹별로 계산.
      - CAC: Meta 연령·성별 breakdown 광고비 ÷ 해당 그룹 신규고객 수. Meta 외 채널(카카오 등
        수동 입력)은 연령 구분이 불가능해 연령별 CAC에서 제외 → 전체 CAC보다 낮게 표시될 수 있음.
      - 연령대 밴드는 Meta breakdown과 동일(18-24, 25-34, …) — 분자·분모 기준 통일 목적.
    """
    month_list = _recent_months(months)
    range_start, _ = _month_bounds(month_list[0])
    _, range_end = _month_bounds(month_list[-1])

    # 회원 인구통계 로드 (전체 — 45k 수준까지는 메모리 무리 없음)
    member_rows = (
        await db.execute(select(MallMember.member_id, MallMember.gender, MallMember.birthyear))
    ).all()
    member_info = {mid: (g, by) for mid, g, by in member_rows}

    # 첫 주문월 (전체 기간)
    first_order_rows = (
        await db.execute(
            select(MallOrder.member_id, func.min(MallOrder.order_date))
            .where(MallOrder.status == "paid", MallOrder.member_id.isnot(None))
            .group_by(MallOrder.member_id)
        )
    ).all()

    # LTV용 주문 로드 (트레일링 180일 여유 포함)
    ltv_rows = (
        await db.execute(
            select(MallOrder.member_id, MallOrder.order_date, MallOrder.amount).where(
                MallOrder.status == "paid",
                MallOrder.member_id.isnot(None),
                MallOrder.order_date >= range_start - timedelta(days=180),
                MallOrder.order_date <= range_end,
            )
        )
    ).all()

    meta_demo = await _meta_demographic_spend(db, range_start, range_end)

    def _bands_for(member_id: str, as_of: date) -> tuple[str, str]:
        g, by = member_info.get(member_id, (None, None))
        gender_band = g if g in ("M", "F") else "unknown"
        return _age_band(by, as_of), gender_band

    # 신규고객 집계: (month, age_band) / (month, gender_band)
    new_by_age: dict[tuple[str, str], int] = defaultdict(int)
    new_by_gender: dict[tuple[str, str], int] = defaultdict(int)
    month_set = set(month_list)
    for member_id, first_date in first_order_rows:
        if not (member_id and first_date):
            continue
        mk = f"{first_date.year:04d}-{first_date.month:02d}"
        if mk not in month_set:
            continue
        ab, gb = _bands_for(member_id, first_date)
        new_by_age[(mk, ab)] += 1
        new_by_gender[(mk, gb)] += 1

    age_rows_out: list[dict] = []
    gender_rows_out: list[dict] = []
    for month_key in month_list:
        _, m_end = _month_bounds(month_key)
        window_start = m_end - timedelta(days=179)

        # 그룹별 트레일링 180일 매출/고객
        rev_by_age: dict[str, float] = defaultdict(float)
        cnt_by_age: dict[str, set] = defaultdict(set)
        rev_by_gender: dict[str, float] = defaultdict(float)
        cnt_by_gender: dict[str, set] = defaultdict(set)
        for member_id, o_date, amount in ltv_rows:
            if not (window_start <= o_date <= m_end):
                continue
            ab, gb = _bands_for(member_id, m_end)
            rev_by_age[ab] += float(amount or 0)
            cnt_by_age[ab].add(member_id)
            rev_by_gender[gb] += float(amount or 0)
            cnt_by_gender[gb].add(member_id)

        for band in _AGE_BANDS + ["unknown"]:
            new_c = new_by_age.get((month_key, band), 0)
            customers = len(cnt_by_age.get(band, set()))
            ltv = round(rev_by_age[band] / customers, 2) if customers else None
            meta_spend = None
            if meta_demo is not None:
                meta_spend = round(meta_demo["age"].get((month_key, band), 0.0), 2)
            cac = round(meta_spend / new_c, 2) if (meta_spend and new_c) else None
            age_rows_out.append({
                "month": month_key, "band": band, "new_customers": new_c,
                "ltv_customers": customers, "ltv": ltv, "meta_spend": meta_spend, "cac": cac,
            })

        for band in ["F", "M", "unknown"]:
            new_c = new_by_gender.get((month_key, band), 0)
            customers = len(cnt_by_gender.get(band, set()))
            ltv = round(rev_by_gender[band] / customers, 2) if customers else None
            meta_spend = None
            if meta_demo is not None:
                meta_spend = round(meta_demo["gender"].get((month_key, band), 0.0), 2)
            cac = round(meta_spend / new_c, 2) if (meta_spend and new_c) else None
            gender_rows_out.append({
                "month": month_key, "band": band, "new_customers": new_c,
                "ltv_customers": customers, "ltv": ltv, "meta_spend": meta_spend, "cac": cac,
            })

    gender_known = sum(1 for g, _ in member_info.values() if g in ("M", "F"))
    birthyear_known = sum(1 for _, by in member_info.values() if by)

    return {
        "months": month_list,
        "age_bands": _AGE_BANDS + ["unknown"],
        "gender_bands": ["F", "M", "unknown"],
        "age": age_rows_out,
        "gender": gender_rows_out,
        "meta_available": meta_demo is not None,
        "coverage": {
            "members_enriched": len(member_info),
            "gender_known": gender_known,
            "birthyear_known": birthyear_known,
        },
        "basis": {
            "new_customers": "해당 월에 사상 첫 결제(paid) 주문을 한 회원 수. 연령·성별은 카페24 회원정보 기준.",
            "ltv": "해당 월 말일 기준 최근 180일 내 결제 주문이 있는 회원 1인당 평균 매출(그룹별). 실현 매출 기반 트레일링 LTV — 예측치 아님.",
            "cac": "Meta 연령·성별 breakdown 광고비 ÷ 그룹별 신규고객 수. 연령 구분이 불가능한 수동 채널(카카오 등) 광고비는 제외되어 전체 CAC보다 낮게 보일 수 있음.",
            "age_band": "연령대 밴드는 Meta 광고 breakdown과 동일 기준(만 나이 근사 = 기준일 연도 - 출생연도). 출생연도 미보유 회원은 '미상'.",
        },
    }


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


@router.get("/external-export")
async def export_external_kpi_excel(
    months: int = Query(default=12, ge=1, le=24),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """그 외(외부) 마케팅 KPI 요약을 엑셀(xlsx)로 다운로드. 파라미터는 /external-summary와 동일."""
    from io import BytesIO
    from urllib.parse import quote

    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter
    from fastapi.responses import StreamingResponse

    data = await _external_summary_monthly(db, months)
    items = data["months"]
    top_campaigns = data["top_campaigns"]

    header_font = Font(bold=True)
    header_fill = PatternFill(start_color="D9D9D9", end_color="D9D9D9", fill_type="solid")
    center = Alignment(horizontal="center", vertical="center")
    money_fmt = "#,##0"

    # 채널 목록 (등장한 순서대로, 모든 월에 걸쳐 union)
    channel_order: list[str] = []
    for item in items:
        for cs in item.get("channel_spends") or []:
            ch = cs.get("channel")
            if ch not in channel_order:
                channel_order.append(ch)

    headers = ["월", "총광고비"] + [f"{ch} 광고비" for ch in channel_order] + [
        "채널 매출 합", "공동구매 매출", "공동구매 주문수", "기타 매출(수동)", "총 매출", "목표 광고비", "목표 매출",
    ]
    money_cols = set(range(2, 3 + len(channel_order))) | {
        3 + len(channel_order),  # 채널 매출 합
        4 + len(channel_order),  # 공동구매 매출
        6 + len(channel_order),  # 기타 매출(수동)
        7 + len(channel_order),  # 총 매출
        8 + len(channel_order),  # 목표 광고비
        9 + len(channel_order),  # 목표 매출
    }

    wb = Workbook()
    ws = wb.active
    ws.title = "외부 마케팅 KPI"
    for ci, h in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=ci, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center

    for ri, item in enumerate(items, start=2):
        spend_by_channel = {
            cs.get("channel"): cs.get("actual_amount") or 0.0 for cs in (item.get("channel_spends") or [])
        }
        goal = item.get("goal") or {}
        row_vals = (
            [item["month"], item.get("total_spend")]
            + [round(spend_by_channel.get(ch, 0.0), 2) for ch in channel_order]
            + [
                item.get("channel_revenue"),
                item.get("groupbuy_revenue"),
                item.get("groupbuy_orders"),
                item.get("manual_revenue"),
                item.get("total_revenue"),
                goal.get("target_spend"),
                goal.get("target_revenue"),
            ]
        )
        for ci, val in enumerate(row_vals, start=1):
            cell = ws.cell(row=ri, column=ci, value=val)
            if isinstance(val, (int, float)) and ci in money_cols:
                cell.number_format = money_fmt

    widths = [10, 14] + [14] * len(channel_order) + [14, 14, 12, 14, 14, 12, 12]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A2"

    # ── Sheet2: 캠페인별 공동구매 ──
    ws2 = wb.create_sheet("캠페인별 공동구매")
    ch_headers = ["캠페인", "매출", "주문수"]
    for ci, h in enumerate(ch_headers, start=1):
        cell = ws2.cell(row=1, column=ci, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center

    for ri, camp in enumerate(top_campaigns, start=2):
        ws2.cell(row=ri, column=1, value=camp.get("campaign_name") or "미지정")
        ws2.cell(row=ri, column=2, value=camp.get("revenue") or 0.0).number_format = money_fmt
        ws2.cell(row=ri, column=3, value=camp.get("orders") or 0)

    ws2.column_dimensions[get_column_letter(1)].width = 24
    ws2.column_dimensions[get_column_letter(2)].width = 14
    ws2.column_dimensions[get_column_letter(3)].width = 10
    ws2.freeze_panes = "A2"

    # ── Sheet3: 채널별 상세 (매출 관여/비관여 구분 + 채널 매출 + ROAS) ──
    ws3 = wb.create_sheet("채널별 상세")
    d_headers = ["월", "채널", "유형", "예산", "광고비", "매출", "ROAS", "메모"]
    for ci, h in enumerate(d_headers, start=1):
        cell = ws3.cell(row=1, column=ci, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center

    r = 2
    for item in items:
        for cs in item.get("channel_spends") or []:
            revenue_linked = bool(cs.get("revenue_linked"))
            actual = cs.get("actual_amount") or 0.0
            revenue = cs.get("revenue") if revenue_linked else None
            roas = round(revenue / actual, 2) if (revenue_linked and revenue is not None and actual) else None

            ws3.cell(row=r, column=1, value=item["month"])
            ws3.cell(row=r, column=2, value=cs.get("channel_label") or cs.get("channel"))
            ws3.cell(row=r, column=3, value="관여" if revenue_linked else "비관여")
            ws3.cell(row=r, column=4, value=cs.get("planned_amount") or 0.0).number_format = money_fmt
            ws3.cell(row=r, column=5, value=actual).number_format = money_fmt
            revenue_cell = ws3.cell(row=r, column=6, value=revenue)
            if revenue is not None:
                revenue_cell.number_format = money_fmt
            roas_cell = ws3.cell(row=r, column=7, value=roas)
            if roas is not None:
                roas_cell.number_format = "0.00"
            ws3.cell(row=r, column=8, value=cs.get("memo") or "")
            r += 1

    d_widths = [10, 16, 10, 14, 14, 14, 10, 24]
    for i, w in enumerate(d_widths, start=1):
        ws3.column_dimensions[get_column_letter(i)].width = w
    ws3.freeze_panes = "A2"

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)

    if items:
        start_label = items[0]["month"]
        end_label = items[-1]["month"]
    else:
        start_label = end_label = "no-data"
    filename = f"그외마케팅KPI_{start_label}_{end_label}.xlsx"
    quoted = quote(filename)

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quoted}"},
    )
