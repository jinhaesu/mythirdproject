"""마케팅 활동 기록 API — 콘텐츠/인플루언서/체험단/서포터즈 집행 데이터.

팀이 구글시트로 관리하던 것을 시스템에 누적하고, 시트의 차트 시트가 하던
집계(월별×채널 조회수 추이, 제품별 Top)를 자동 생성한다.
"""
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_user
from app.db.database import get_db
from app.models.marketing_activity import MarketingActivity
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter()

ACTIVITY_TYPES = ["content", "influencer", "experience", "supporters", "etc"]


class ActivityIn(BaseModel):
    activity_type: str = Field(..., max_length=30)
    product: Optional[str] = Field(None, max_length=200)
    product_category: Optional[str] = Field(None, max_length=100)
    channel: Optional[str] = Field(None, max_length=50)
    purpose: Optional[str] = Field(None, max_length=100)
    status: Optional[str] = Field(None, max_length=50)
    period_month: str = Field(..., min_length=7, max_length=7)  # "YYYY-MM"
    activity_date: Optional[str] = None  # "YYYY-MM-DD"
    quantity: int = 0
    views: int = 0
    reach: int = 0
    likes: int = 0
    comments: int = 0
    saves: int = 0
    shares: int = 0
    follows: int = 0
    cost: float = 0
    notes: Optional[str] = Field(None, max_length=500)
    source: str = "manual"


def _apply(row: MarketingActivity, data: ActivityIn) -> None:
    from datetime import date as _date

    for f in ("activity_type", "product", "product_category", "channel", "purpose",
              "status", "period_month", "quantity", "views", "reach", "likes",
              "comments", "saves", "shares", "follows", "cost", "notes", "source"):
        setattr(row, f, getattr(data, f))
    row.activity_date = _date.fromisoformat(data.activity_date) if data.activity_date else None


def _row_out(a: MarketingActivity) -> dict:
    return {
        "id": a.id,
        "activity_type": a.activity_type,
        "product": a.product,
        "product_category": a.product_category,
        "channel": a.channel,
        "purpose": a.purpose,
        "status": a.status,
        "period_month": a.period_month,
        "activity_date": a.activity_date.isoformat() if a.activity_date else None,
        "quantity": a.quantity,
        "views": a.views,
        "reach": a.reach,
        "likes": a.likes,
        "comments": a.comments,
        "saves": a.saves,
        "shares": a.shares,
        "follows": a.follows,
        "cost": a.cost,
        "cost_per_view": round(a.cost / a.views, 2) if a.views else None,
        "notes": a.notes,
        "source": a.source,
    }


def _filters(query, activity_type, month_from, month_to, channel, product, q):
    if activity_type:
        query = query.where(MarketingActivity.activity_type == activity_type)
    if month_from:
        query = query.where(MarketingActivity.period_month >= month_from)
    if month_to:
        query = query.where(MarketingActivity.period_month <= month_to)
    if channel:
        query = query.where(MarketingActivity.channel == channel)
    if product:
        query = query.where(MarketingActivity.product == product)
    if q:
        like = f"%{q}%"
        query = query.where(
            MarketingActivity.product.ilike(like)
            | MarketingActivity.notes.ilike(like)
            | MarketingActivity.purpose.ilike(like)
        )
    return query


@router.get("")
async def list_activities(
    activity_type: Optional[str] = None,
    month_from: Optional[str] = None,
    month_to: Optional[str] = None,
    channel: Optional[str] = None,
    product: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = Query(default=100, le=500),
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    base = _filters(select(MarketingActivity), activity_type, month_from, month_to, channel, product, q)
    total = (await db.execute(
        _filters(select(func.count(MarketingActivity.id)), activity_type, month_from, month_to, channel, product, q)
    )).scalar() or 0
    rows = (await db.execute(
        base.order_by(
            MarketingActivity.period_month.desc(),
            MarketingActivity.activity_date.desc().nulls_last(),
            MarketingActivity.id.desc(),
        ).limit(limit).offset(offset)
    )).scalars().all()
    return {"total": total, "items": [_row_out(a) for a in rows]}


@router.post("")
async def create_activity(
    data: ActivityIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = MarketingActivity()
    _apply(row, data)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _row_out(row)


@router.post("/bulk")
async def bulk_create(
    items: List[ActivityIn],
    replace_source: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """일괄 등록 (시트 백필용). replace_source 지정 시 해당 source 기존 행 전체 교체."""
    if len(items) > 20000:
        raise HTTPException(status_code=422, detail="한 번에 20,000행까지")
    deleted = 0
    if replace_source:
        res = await db.execute(
            delete(MarketingActivity).where(MarketingActivity.source == replace_source)
        )
        deleted = res.rowcount or 0
    rows = []
    for it in items:
        row = MarketingActivity()
        _apply(row, it)
        rows.append(row)
    db.add_all(rows)
    await db.commit()
    return {"created": len(rows), "deleted": deleted}


@router.patch("/{activity_id}")
async def update_activity(
    activity_id: int,
    data: ActivityIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = (await db.execute(
        select(MarketingActivity).where(MarketingActivity.id == activity_id)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="활동을 찾을 수 없습니다")
    _apply(row, data)
    await db.commit()
    await db.refresh(row)
    return _row_out(row)


@router.delete("/{activity_id}")
async def delete_activity(
    activity_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        delete(MarketingActivity).where(MarketingActivity.id == activity_id)
    )
    await db.commit()
    if not res.rowcount:
        raise HTTPException(status_code=404, detail="활동을 찾을 수 없습니다")
    return {"deleted": activity_id}


@router.get("/meta")
async def activity_meta(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """기입 폼 드롭다운용 — 기존 값들의 distinct 목록."""
    out = {"activity_types": ACTIVITY_TYPES}
    for name, col in [
        ("channels", MarketingActivity.channel),
        ("products", MarketingActivity.product),
        ("product_categories", MarketingActivity.product_category),
        ("purposes", MarketingActivity.purpose),
    ]:
        vals = (await db.execute(
            select(distinct(col)).where(col.isnot(None)).order_by(col).limit(300)
        )).scalars().all()
        out[name] = [v for v in vals if v and v.strip()]
    return out


@router.get("/summary")
async def activity_summary(
    month_from: Optional[str] = None,
    month_to: Optional[str] = None,
    activity_type: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """시트의 차트 시트를 대체하는 자동 집계.

    - by_month_channel: 월별×채널 조회수/비용 (시트 [차트1] 월별 채널별 추이)
    - by_product: 제품별 조회수/비용 Top 20 (시트 [차트1] 제품별 Top 10)
    - by_type: 유형별 합계
    """
    def flt(q):
        if month_from:
            q = q.where(MarketingActivity.period_month >= month_from)
        if month_to:
            q = q.where(MarketingActivity.period_month <= month_to)
        if activity_type:
            q = q.where(MarketingActivity.activity_type == activity_type)
        return q

    A = MarketingActivity
    agg = [
        func.sum(A.quantity).label("quantity"),
        func.sum(A.views).label("views"),
        func.sum(A.cost).label("cost"),
        func.count(A.id).label("rows"),
    ]

    by_month_channel = (await db.execute(
        flt(select(A.period_month, A.channel, *agg))
        .group_by(A.period_month, A.channel)
        .order_by(A.period_month)
    )).all()
    by_product = (await db.execute(
        flt(select(A.product, *agg))
        .where(A.product.isnot(None))
        .group_by(A.product)
        .order_by(func.sum(A.views).desc())
        .limit(20)
    )).all()
    by_type = (await db.execute(
        flt(select(A.activity_type, *agg)).group_by(A.activity_type)
    )).all()

    def rows_out(rows, keys):
        out = []
        for r in rows:
            d = dict(zip(keys, r[: len(keys)]))
            d.update({
                "quantity": int(r[-4] or 0),
                "views": int(r[-3] or 0),
                "cost": float(r[-2] or 0),
                "rows": int(r[-1] or 0),
            })
            views = d["views"]
            d["cost_per_view"] = round(d["cost"] / views, 2) if views else None
            out.append(d)
        return out

    return {
        "by_month_channel": rows_out(by_month_channel, ["month", "channel"]),
        "by_product": rows_out(by_product, ["product"]),
        "by_type": rows_out(by_type, ["activity_type"]),
    }
