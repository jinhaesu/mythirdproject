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
from sqlalchemy import func, select
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
