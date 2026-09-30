"""광고비 일보 API — 매체 마스터 + 일별 기입 그리드 + 월 예산(Limit/사업계획).

구글시트 "광고비 일보"의 시스템화. 금액은 원 단위(VAT 포함).
auto_source가 있는 매체(meta/naver_sa)는 일별 금액을 수집 스냅샷에서
자동으로 채우고 수동 기입을 막는다.
"""
import logging
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_user
from app.db.database import get_db
from app.models import (
    AdMedia,
    AdMediaBudget,
    AdMediaSpendDaily,
    ChannelSpendDaily,
    MetaInsightDaily,
)
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter()

AUTO_SOURCES = {"meta", "naver_sa"}


def _month_add(month: str, delta: int) -> str:
    y, m = int(month[:4]), int(month[5:7])
    total = y * 12 + (m - 1) + delta
    return f"{total // 12:04d}-{total % 12 + 1:02d}"


def _month_range(month: str):
    y, m = int(month[:4]), int(month[5:7])
    start = date(y, m, 1)
    end = date(y + (m == 12), m % 12 + 1, 1)
    return start, end


async def _auto_daily(db: AsyncSession, source: str, d_from: date, d_to: date) -> dict:
    """자동 수집 소스의 일별 금액 {date: amount(원)}."""
    if source == "meta":
        rows = (await db.execute(
            select(MetaInsightDaily.date, func.coalesce(func.sum(MetaInsightDaily.spend), 0))
            .where(MetaInsightDaily.level == "campaign",
                   MetaInsightDaily.date >= d_from, MetaInsightDaily.date < d_to)
            .group_by(MetaInsightDaily.date)
        )).all()
    elif source == "naver_sa":
        rows = (await db.execute(
            select(ChannelSpendDaily.date, func.coalesce(func.sum(ChannelSpendDaily.spend), 0))
            .where(ChannelSpendDaily.channel == "naver_sa",
                   ChannelSpendDaily.date >= d_from, ChannelSpendDaily.date < d_to)
            .group_by(ChannelSpendDaily.date)
        )).all()
    else:
        return {}
    return {d.isoformat(): float(s) for d, s in rows if float(s)}


# ─── 매체 마스터 ─────────────────────────────────────────────────────────────

class MediaIn(BaseModel):
    name: str = Field(..., max_length=200)
    group_name: Optional[str] = Field(None, max_length=100)
    inflow: Optional[str] = Field(None, max_length=100)
    auto_source: Optional[str] = Field(None, max_length=20)  # meta|naver_sa
    sort_order: int = 0
    memo: Optional[str] = Field(None, max_length=300)


@router.get("/media")
async def list_media(
    include_inactive: bool = False,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(AdMedia)
    if not include_inactive:
        q = q.where(AdMedia.active.is_(True))
    rows = (await db.execute(
        q.order_by(AdMedia.inflow, AdMedia.group_name, AdMedia.sort_order, AdMedia.id)
    )).scalars().all()
    return [{
        "id": m.id, "name": m.name, "group_name": m.group_name, "inflow": m.inflow,
        "auto_source": m.auto_source, "sort_order": m.sort_order,
        "active": m.active, "memo": m.memo,
    } for m in rows]


@router.post("/media")
async def create_media(
    data: MediaIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if data.auto_source and data.auto_source not in AUTO_SOURCES:
        raise HTTPException(status_code=422, detail=f"auto_source는 {sorted(AUTO_SOURCES)} 중 하나")
    m = AdMedia(**data.model_dump())
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return {"id": m.id}


@router.patch("/media/{media_id}")
async def update_media(
    media_id: int,
    data: MediaIn,
    active: Optional[bool] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    m = (await db.execute(select(AdMedia).where(AdMedia.id == media_id))).scalar_one_or_none()
    if not m:
        raise HTTPException(status_code=404, detail="매체를 찾을 수 없습니다")
    for k, v in data.model_dump().items():
        setattr(m, k, v)
    if active is not None:
        m.active = active
    await db.commit()
    return {"id": m.id, "active": m.active}


# ─── 일보 보드 (월 그리드) ───────────────────────────────────────────────────

@router.get("/board")
async def spend_board(
    month: str = Query(..., min_length=7, max_length=7),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """해당 월의 일보 그리드 — 매체별 일별 금액 + 월합계/Limit/사용율/사업계획."""
    d_from, d_to = _month_range(month)
    media = (await db.execute(
        select(AdMedia).where(AdMedia.active.is_(True))
        .order_by(AdMedia.inflow, AdMedia.group_name, AdMedia.sort_order, AdMedia.id)
    )).scalars().all()
    budgets = {b.media_id: b for b in (await db.execute(
        select(AdMediaBudget).where(AdMediaBudget.month == month)
    )).scalars().all()}
    manual_rows = (await db.execute(
        select(AdMediaSpendDaily).where(
            AdMediaSpendDaily.date >= d_from, AdMediaSpendDaily.date < d_to
        )
    )).scalars().all()
    manual_by_media: dict = {}
    for r in manual_rows:
        manual_by_media.setdefault(r.media_id, {})[r.date.isoformat()] = r.amount

    auto_cache = {s: await _auto_daily(db, s, d_from, d_to) for s in AUTO_SOURCES}

    out_rows = []
    for m in media:
        daily = auto_cache.get(m.auto_source, {}) if m.auto_source else manual_by_media.get(m.id, {})
        b = budgets.get(m.id)
        total = round(sum(daily.values()), 0)
        limit_amt = b.limit_amount if b else None
        out_rows.append({
            "media_id": m.id, "name": m.name, "group_name": m.group_name,
            "inflow": m.inflow, "auto": bool(m.auto_source), "auto_source": m.auto_source,
            "memo": m.memo,
            "daily": daily,
            "month_total": total,
            "limit_amount": limit_amt,
            "plan_amount": b.plan_amount if b else None,
            "usage_pct": round(total / limit_amt * 100, 1) if limit_amt else None,
        })

    day_totals: dict = {}
    for r in out_rows:
        for d, v in r["daily"].items():
            day_totals[d] = day_totals.get(d, 0) + v

    grand_total = round(sum(r["month_total"] for r in out_rows), 0)
    grand_limit = round(sum(r["limit_amount"] or 0 for r in out_rows), 0)
    grand_plan = round(sum(r["plan_amount"] or 0 for r in out_rows), 0)
    return {
        "as_of": datetime.utcnow().isoformat(),
        "month": month,
        "days_in_month": (d_to - timedelta(days=1)).day,
        "rows": out_rows,
        "day_totals": day_totals,
        "totals": {
            "spend": grand_total, "limit": grand_limit, "plan": grand_plan,
            "usage_pct": round(grand_total / grand_limit * 100, 1) if grand_limit else None,
        },
    }


class EntryUpsert(BaseModel):
    media_id: int
    date: str  # YYYY-MM-DD
    amount: float = Field(..., ge=0)


@router.put("/entry")
async def upsert_entry(
    payload: EntryUpsert,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    m = (await db.execute(select(AdMedia).where(AdMedia.id == payload.media_id))).scalar_one_or_none()
    if not m:
        raise HTTPException(status_code=404, detail="매체를 찾을 수 없습니다")
    if m.auto_source:
        raise HTTPException(status_code=422, detail="자동 연동 매체는 수동 기입이 불가합니다")
    try:
        d = date.fromisoformat(payload.date)
    except ValueError:
        raise HTTPException(status_code=422, detail="date는 YYYY-MM-DD 형식")
    row = (await db.execute(select(AdMediaSpendDaily).where(
        AdMediaSpendDaily.media_id == payload.media_id, AdMediaSpendDaily.date == d
    ))).scalar_one_or_none()
    if payload.amount == 0:
        if row:
            await db.delete(row)
    elif row:
        row.amount = payload.amount
    else:
        db.add(AdMediaSpendDaily(media_id=payload.media_id, date=d, amount=payload.amount))
    await db.commit()
    return {"media_id": payload.media_id, "date": payload.date, "amount": payload.amount}


class BudgetUpsert(BaseModel):
    media_id: int
    month: str = Field(..., min_length=7, max_length=7)
    limit_amount: Optional[float] = None
    plan_amount: Optional[float] = None


@router.put("/budget")
async def upsert_budget(
    payload: BudgetUpsert,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = (await db.execute(select(AdMediaBudget).where(
        AdMediaBudget.media_id == payload.media_id, AdMediaBudget.month == payload.month
    ))).scalar_one_or_none()
    if not row:
        row = AdMediaBudget(media_id=payload.media_id, month=payload.month)
        db.add(row)
    if payload.limit_amount is not None:
        row.limit_amount = payload.limit_amount
    if payload.plan_amount is not None:
        row.plan_amount = payload.plan_amount
    await db.commit()
    return {"media_id": payload.media_id, "month": payload.month}


# ─── 채널 ROAS 보드 (유입채널 × 월 — 광고비 자동 + 매출 기입) ────────────────

async def _inflow_spend_by_month(db: AsyncSession, months: list) -> dict:
    """{(month, inflow): spend} — 일보 수동 기입 + 자동 매체(meta/naver_sa)."""
    m_from, m_to = months[0], months[-1]
    d_from, _ = _month_range(m_from)
    _, d_to = _month_range(m_to)

    media = (await db.execute(select(AdMedia).where(AdMedia.active.is_(True)))).scalars().all()
    inflow_of = {m.id: (m.inflow or "기타") for m in media}
    auto_media = [(m.id, m.auto_source) for m in media if m.auto_source]

    out: dict = {}
    rows = (await db.execute(
        select(
            AdMediaSpendDaily.media_id,
            func.to_char(AdMediaSpendDaily.date, "YYYY-MM"),
            func.coalesce(func.sum(AdMediaSpendDaily.amount), 0),
        ).where(AdMediaSpendDaily.date >= d_from, AdMediaSpendDaily.date < d_to)
        .group_by(text("1, 2"))  # to_char 포맷이 바인드 파라미터로 렌더돼 표현식 GROUP BY가 불일치 → 위치 지정
    )).all()
    for mid, month, amt in rows:
        key = (month, inflow_of.get(mid, "기타"))
        out[key] = out.get(key, 0) + float(amt)
    for mid, source in auto_media:
        daily = await _auto_daily(db, source, d_from, d_to)
        for d, amt in daily.items():
            key = (d[:7], inflow_of.get(mid, "기타"))
            out[key] = out.get(key, 0) + amt
    return out


@router.get("/roas-board")
async def roas_board(
    months_back: int = Query(default=6, ge=1, le=24),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """유입채널별 월 광고비(일보 자동 합산) × 매출(기입/자사몰 자동) × ROAS.

    구 '채널 성과 분석'(monthly_channel_spends 소수 채널) 대체 —
    광고비 일보의 전체 유입채널 축으로 분석한다. 금액 원 단위(VAT 포함).
    """
    from app.models import ChannelRevenue, MallOrder

    this_month = date.today().strftime("%Y-%m")
    months = [_month_add(this_month, i) for i in range(-months_back + 1, 1)]
    spend_by = await _inflow_spend_by_month(db, months)

    # 매출: 기입값 + 자사몰 자동(mall_orders paid 월합)
    rev_rows = (await db.execute(
        select(ChannelRevenue).where(
            ChannelRevenue.month >= months[0], ChannelRevenue.month <= months[-1]
        )
    )).scalars().all()
    rev_by = {(r.month, r.inflow): r.revenue for r in rev_rows}
    d_from, _ = _month_range(months[0])
    _, d_to = _month_range(months[-1])
    mall_rows = (await db.execute(
        select(
            func.to_char(MallOrder.order_date, "YYYY-MM"),
            func.coalesce(func.sum(MallOrder.amount), 0),
        ).where(MallOrder.status == "paid", MallOrder.order_date >= d_from, MallOrder.order_date < d_to)
        .group_by(text("1"))
    )).all()
    mall_rev = {m: float(v) for m, v in mall_rows}

    # 예산(Limit·사업계획) — 유입채널별 월합
    budgets = (await db.execute(
        select(AdMediaBudget).where(AdMediaBudget.month.in_(months))
    )).scalars().all()
    media = (await db.execute(select(AdMedia))).scalars().all()
    inflow_of = {m.id: (m.inflow or "기타") for m in media}
    limit_by: dict = {}
    for b in budgets:
        key = (b.month, inflow_of.get(b.media_id, "기타"))
        limit_by[key] = limit_by.get(key, 0) + (b.limit_amount or 0)

    inflows = sorted({k[1] for k in list(spend_by) + list(rev_by) + list(limit_by)})
    cells = []
    for m in months:
        for inf in inflows:
            spend = round(spend_by.get((m, inf), 0), 0)
            is_mall = inf == "자사몰"
            revenue = mall_rev.get(m) if is_mall else rev_by.get((m, inf))
            limit_amt = round(limit_by.get((m, inf), 0), 0) or None
            if not spend and not revenue and not limit_amt:
                continue
            cells.append({
                "month": m, "inflow": inf,
                "spend": spend,
                "limit": limit_amt,
                "usage_pct": round(spend / limit_amt * 100, 1) if limit_amt else None,
                "revenue": round(revenue, 0) if revenue is not None else None,
                "revenue_auto": is_mall,
                "roas": round(revenue / spend, 2) if revenue and spend else None,
            })
    return {
        "as_of": datetime.utcnow().isoformat(),
        "months": months,
        "this_month": this_month,
        "inflows": inflows,
        "cells": cells,
    }


class RevenueUpsert(BaseModel):
    month: str = Field(..., min_length=7, max_length=7)
    inflow: str = Field(..., max_length=100)
    revenue: float = Field(..., ge=0)


@router.put("/revenue")
async def upsert_channel_revenue(
    payload: RevenueUpsert,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models import ChannelRevenue

    if payload.inflow == "자사몰":
        raise HTTPException(status_code=422, detail="자사몰 매출은 주문 데이터에서 자동 집계됩니다")
    row = (await db.execute(select(ChannelRevenue).where(
        ChannelRevenue.month == payload.month, ChannelRevenue.inflow == payload.inflow
    ))).scalar_one_or_none()
    if payload.revenue == 0:
        if row:
            await db.delete(row)
    elif row:
        row.revenue = payload.revenue
    else:
        db.add(ChannelRevenue(month=payload.month, inflow=payload.inflow, revenue=payload.revenue))
    await db.commit()
    return {"month": payload.month, "inflow": payload.inflow, "revenue": payload.revenue}


@router.get("/monthly-summary")
async def monthly_summary(
    month: str = Query(..., min_length=7, max_length=7),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """KPI 요약용 — 유입채널(inflow) 그룹별 집행/Limit/사업계획 합계."""
    board = await spend_board(month=month, current_user=current_user, db=db)
    groups: dict = {}
    for r in board["rows"]:
        g = groups.setdefault(r["inflow"] or "기타", {"spend": 0, "limit": 0, "plan": 0})
        g["spend"] += r["month_total"]
        g["limit"] += r["limit_amount"] or 0
        g["plan"] += r["plan_amount"] or 0
    return {
        "month": month,
        "by_inflow": [{"inflow": k, **{kk: round(vv, 0) for kk, vv in v.items()}} for k, v in groups.items()],
        "totals": board["totals"],
    }
