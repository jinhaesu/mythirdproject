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

ACTIVITY_TYPES = ["content", "influencer", "experience", "crew", "supporters", "groupbuy", "etc"]


class ActivityIn(BaseModel):
    activity_type: str = Field(..., max_length=30)
    entry_kind: str = Field("actual", max_length=10)  # actual(실적) | plan(계획)
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
    link: Optional[str] = Field(None, max_length=500)  # 콘텐츠/게시물 URL
    creator: Optional[str] = Field(None, max_length=200)  # 크리에이터 이름/핸들
    metrics_as_of: Optional[str] = None  # 지표(조회수 등) 기준일 "YYYY-MM-DD"
    notes: Optional[str] = Field(None, max_length=500)
    source: str = "manual"


import re as _re

_CREATOR_LINK_PATTERNS = [
    _re.compile(r"tiktok\.com/@([\w.\-]+)"),                      # 틱톡 @핸들
    _re.compile(r"blog\.naver\.com/([\w\-]+)"),                   # 네이버 블로그 ID
    _re.compile(r"(?:m\.)?cafe\.naver\.com/[\w\-]+/members/([\w\-]+)"),
    _re.compile(r"instagram\.com/([\w.\-]+)/(?:p|reel|reels|tv)/"),  # 프로필 경유 permalink
]


def derive_creator_from_link(link: Optional[str]) -> Optional[str]:
    """링크에서 크리에이터 핸들 유도 — 틱톡·네이버블로그 등 URL에 계정이 드러나는 채널만.

    (인스타 /p/·/reel/ 단독 permalink, 유튜브 video URL에는 계정이 없음 —
    유튜브는 content_metrics 데일리 수집이 채널명으로 채운다.)
    """
    if not link:
        return None
    for p in _CREATOR_LINK_PATTERNS:
        m = p.search(link)
        if m:
            handle = m.group(1).strip()
            if handle and handle.lower() not in ("p", "reel", "reels", "tv", "watch", "shorts"):
                return handle[:200]
    return None


def _apply(row: MarketingActivity, data: ActivityIn) -> None:
    from datetime import date as _date

    for f in ("activity_type", "entry_kind", "product", "product_category", "channel", "purpose",
              "status", "period_month", "quantity", "views", "reach", "likes",
              "comments", "saves", "shares", "follows", "cost", "link", "creator", "notes", "source"):
        setattr(row, f, getattr(data, f))
    if not (row.creator or "").strip():
        row.creator = derive_creator_from_link(row.link)
    row.activity_date = _date.fromisoformat(data.activity_date) if data.activity_date else None
    row.metrics_as_of = _date.fromisoformat(data.metrics_as_of) if data.metrics_as_of else None


def _row_out(a: MarketingActivity) -> dict:
    return {
        "id": a.id,
        "activity_type": a.activity_type,
        "entry_kind": getattr(a, "entry_kind", None) or "actual",
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
        "link": a.link,
        "creator": getattr(a, "creator", None),
        "metrics_as_of": a.metrics_as_of.isoformat() if a.metrics_as_of else None,
        "notes": a.notes,
        "source": a.source,
    }


def _filters(query, activity_type, month_from, month_to, channel, product, q, entry_kind=None,
             creator=None, purpose=None, product_category=None):
    if activity_type:
        query = query.where(MarketingActivity.activity_type == activity_type)
    if entry_kind:
        query = query.where(MarketingActivity.entry_kind == entry_kind)
    if month_from:
        query = query.where(MarketingActivity.period_month >= month_from)
    if month_to:
        query = query.where(MarketingActivity.period_month <= month_to)
    if channel:
        query = query.where(MarketingActivity.channel == channel)
    if product:
        query = query.where(MarketingActivity.product == product)
    if creator:
        query = query.where(MarketingActivity.creator == creator)
    if purpose:
        query = query.where(MarketingActivity.purpose == purpose)
    if product_category:
        query = query.where(MarketingActivity.product_category == product_category)
    if q:
        like = f"%{q}%"
        query = query.where(
            MarketingActivity.product.ilike(like)
            | MarketingActivity.notes.ilike(like)
            | MarketingActivity.purpose.ilike(like)
            | MarketingActivity.creator.ilike(like)
        )
    return query


# 정렬 가능한 열 화이트리스트 (cost_per_view는 파생식)
def _sort_expr(sort_by: str):
    A = MarketingActivity
    cols = {
        "period_month": A.period_month,
        "activity_date": A.activity_date,
        "activity_type": A.activity_type,
        "creator": A.creator,
        "product": A.product,
        "channel": A.channel,
        "purpose": A.purpose,
        "quantity": A.quantity,
        "views": A.views,
        "cost": A.cost,
        "cost_per_view": A.cost / func.nullif(A.views, 0),
    }
    return cols.get(sort_by)


@router.get("")
async def list_activities(
    activity_type: Optional[str] = None,
    entry_kind: Optional[str] = None,
    month_from: Optional[str] = None,
    month_to: Optional[str] = None,
    channel: Optional[str] = None,
    product: Optional[str] = None,
    creator: Optional[str] = None,
    purpose: Optional[str] = None,
    product_category: Optional[str] = None,
    q: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_dir: str = Query("desc", pattern="^(asc|desc)$"),
    limit: int = Query(default=100, le=500),
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    base = _filters(select(MarketingActivity), activity_type, month_from, month_to, channel, product, q, entry_kind,
                    creator, purpose, product_category)
    total = (await db.execute(
        _filters(select(func.count(MarketingActivity.id)), activity_type, month_from, month_to, channel, product, q, entry_kind,
                 creator, purpose, product_category)
    )).scalar() or 0

    expr = _sort_expr(sort_by) if sort_by else None
    if expr is not None:
        primary = expr.desc().nulls_last() if sort_dir == "desc" else expr.asc().nulls_last()
        order = [primary, MarketingActivity.id.desc()]
    else:
        order = [
            MarketingActivity.period_month.desc(),
            MarketingActivity.activity_date.desc().nulls_last(),
            MarketingActivity.id.desc(),
        ]
    rows = (await db.execute(base.order_by(*order).limit(limit).offset(offset))).scalars().all()
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
        ("creators", MarketingActivity.creator),
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
    entry_kind: str = "actual",  # 집계는 기본 실적만 (계획 제외)
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
        if entry_kind and entry_kind != "all":
            q = q.where(MarketingActivity.entry_kind == entry_kind)
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


@router.get("/pivot")
async def activity_pivot(
    group_by: str = Query("month", pattern="^(month|activity_type|channel|product|product_category|creator|purpose)$"),
    entry_kind: str = "actual",
    activity_type: Optional[str] = None,
    month_from: Optional[str] = None,
    month_to: Optional[str] = None,
    channel: Optional[str] = None,
    product: Optional[str] = None,
    creator: Optional[str] = None,
    purpose: Optional[str] = None,
    product_category: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = Query(default=30, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """다각도 분석 피벗 — 임의 축(월/유형/채널/제품/제품류/크리에이터/목적)으로
    조회수·비용·건수·뷰당비용을 집계. 리스트와 동일한 필터를 적용한다."""
    A = MarketingActivity
    col = A.period_month if group_by == "month" else getattr(A, group_by)
    agg = select(
        col.label("key"),
        func.sum(A.quantity).label("quantity"),
        func.sum(A.views).label("views"),
        func.sum(A.cost).label("cost"),
        func.count(A.id).label("rows"),
    )
    agg = _filters(agg, activity_type, month_from, month_to, channel, product, q,
                   entry_kind if entry_kind != "all" else None,
                   creator, purpose, product_category)
    agg = agg.group_by(col)
    if group_by == "month":
        agg = agg.order_by(col.asc())
    else:
        agg = agg.order_by(func.sum(A.views).desc()).limit(limit)
    rows = (await db.execute(agg)).all()
    out = []
    for r in rows:
        views = int(r.views or 0)
        cost = float(r.cost or 0)
        out.append({
            "key": r.key if (r.key and str(r.key).strip()) else "미지정",
            "quantity": int(r.quantity or 0),
            "views": views,
            "cost": cost,
            "rows": int(r.rows or 0),
            "cost_per_view": round(cost / views, 2) if views else None,
        })
    return {"group_by": group_by, "entry_kind": entry_kind, "groups": out}
