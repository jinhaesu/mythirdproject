"""마케팅 KPI 모듈 — 몰 전체 주문 + 채널 광고비 + CAC/LTV/전환율 대시보드.

엔드포인트:
  GET    /api/v1/kpi/summary?months=6           — 월별 KPI 요약
  PUT    /api/v1/kpi/goals/{month}               — 월간 목표 upsert
  GET    /api/v1/kpi/goals?months=12             — 월간 목표 목록
  PUT    /api/v1/kpi/channel-spend               — 채널별 월 광고비 upsert
  DELETE /api/v1/kpi/channel-spend/{id}          — 채널별 월 광고비 삭제
  POST   /api/v1/kpi/backfill-orders             — Cafe24 주문 백필 (MallOrder)
  GET    /api/v1/kpi/naver-queries               — 네이버 DataLab 검색어트렌드 프록시
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
from app.models.kpi import MallOrder, MarketingGoal, MonthlyChannelSpend
from app.models.meta_insight import MetaInsightDaily
from app.models.user import User
from app.services import cafe24 as cafe24_svc
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

@router.get("/summary")
async def get_kpi_summary(
    months: int = Query(default=6, ge=1, le=24),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
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

        # 채널별 광고비 병합 (meta는 actual_amount 미입력 시 자동 계산값 채움)
        channel_spends = []
        total_ad_spend = 0.0
        has_meta_row = False
        for row in spend_by_month.get(month_key, []):
            is_auto = row.channel == "meta" and row.actual_amount is None
            resolved = meta_spend if is_auto else (row.actual_amount or 0.0)
            if row.channel == "meta":
                has_meta_row = True
            channel_spends.append(
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
            total_ad_spend += resolved
        if not has_meta_row:
            channel_spends.append(
                {
                    "id": None,
                    "month": month_key,
                    "channel": "meta",
                    "planned_amount": 0.0,
                    "actual_amount": meta_spend,
                    "is_auto": True,
                    "memo": None,
                }
            )
            total_ad_spend += meta_spend

        # 몰 지표
        orders_this_month = mall_by_month.get(month_key, [])
        orders_count = len(orders_this_month)
        revenue = round(sum(o.amount or 0.0 for o in orders_this_month), 2)
        member_ids = {o.member_id for o in orders_this_month if o.member_id}
        buyers = len(member_ids)
        guest_orders = sum(1 for o in orders_this_month if not o.member_id)
        aov = round(revenue / orders_count, 2) if orders_count else None
        new_customers = new_customers_by_month.get(month_key, 0)

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
                },
                "cac": cac,
                "ltv": ltv,
                "ltv_cac": ltv_cac,
                "goal": _serialize_goal(goal) if goal else None,
            }
        )

    return {"months": months_out}


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


# ── Naver DataLab 검색어트렌드 프록시 ─────────────────────────────────────────

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
    return {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "keywords": keyword_list,
        "results": data.get("results", []),
    }
