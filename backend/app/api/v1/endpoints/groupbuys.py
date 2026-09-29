"""공구 보드 API — 공구(행사) CRUD + 캠페인 묶음 + 실적 자동 합산.

매출은 확정 귀속(CONFIRMED_SOURCES)만 집계 — 정산·성과 판단 기준과 동일.
"""
import logging
from datetime import timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_user
from app.core.config import get_settings
from app.db.database import get_db
from app.models import (
    AffiliateCampaign,
    AffiliatePartner,
    GroupBuy,
    GroupBuyCampaign,
    ReferralClick,
    ReferralConversion,
)
from app.models.user import User
from app.services.attribution import CONFIRMED_SOURCES

logger = logging.getLogger(__name__)
router = APIRouter()
settings = get_settings()

CONFIRMED_ATTR = ReferralConversion.attribution_source.in_(sorted(CONFIRMED_SOURCES))


class GroupBuyIn(BaseModel):
    name: str = Field(..., max_length=200)
    description: Optional[str] = Field(None, max_length=500)
    status: str = Field("planned", max_length=20)  # planned|active|done
    start_date: Optional[str] = None  # YYYY-MM-DD
    end_date: Optional[str] = None
    target_revenue: Optional[float] = None
    memo: Optional[str] = Field(None, max_length=1000)
    campaign_ids: Optional[List[int]] = None  # 생성 시 즉시 연결


def _apply(gb: GroupBuy, data: GroupBuyIn) -> None:
    from datetime import date as _date

    gb.name = data.name
    gb.description = data.description
    gb.status = data.status
    gb.start_date = _date.fromisoformat(data.start_date) if data.start_date else None
    gb.end_date = _date.fromisoformat(data.end_date) if data.end_date else None
    gb.target_revenue = data.target_revenue
    gb.memo = data.memo


def _period_filters(gb: GroupBuy, conv: bool = True):
    """공구 기간이 설정돼 있으면 그 기간으로 실적을 한정."""
    col = ReferralConversion.converted_at if conv else ReferralClick.clicked_at
    conds = []
    if gb.start_date:
        conds.append(col >= gb.start_date)
    if gb.end_date:
        conds.append(col < gb.end_date + timedelta(days=1))
    return conds


def _gb_out(gb: GroupBuy) -> dict:
    return {
        "id": gb.id,
        "name": gb.name,
        "description": gb.description,
        "status": gb.status,
        "start_date": gb.start_date.isoformat() if gb.start_date else None,
        "end_date": gb.end_date.isoformat() if gb.end_date else None,
        "target_revenue": gb.target_revenue,
        "memo": gb.memo,
    }


async def _campaign_ids_of(db: AsyncSession, gb_id: int) -> List[int]:
    return list((await db.execute(
        select(GroupBuyCampaign.campaign_id).where(GroupBuyCampaign.group_buy_id == gb_id)
    )).scalars().all())


@router.get("")
async def list_group_buys(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    gbs = (await db.execute(
        select(GroupBuy).order_by(GroupBuy.start_date.desc().nulls_last(), GroupBuy.id.desc())
    )).scalars().all()
    out = []
    for gb in gbs:
        cids = await _campaign_ids_of(db, gb.id)
        confirmed = (0, 0.0)
        clicks = 0
        if cids:
            row = (await db.execute(
                select(
                    func.count(ReferralConversion.id),
                    func.coalesce(func.sum(ReferralConversion.order_amount), 0),
                ).where(
                    ReferralConversion.campaign_id.in_(cids), CONFIRMED_ATTR,
                    *_period_filters(gb),
                )
            )).first()
            confirmed = (int(row[0]), float(row[1]))
            clicks = (await db.execute(
                select(func.count(ReferralClick.id)).where(
                    ReferralClick.campaign_id.in_(cids), *_period_filters(gb, conv=False)
                )
            )).scalar() or 0
        d = _gb_out(gb)
        d.update({
            "campaign_count": len(cids),
            "confirmed_orders": confirmed[0],
            "confirmed_revenue": confirmed[1],
            "clicks": clicks,
            "progress_pct": round(confirmed[1] / gb.target_revenue * 100, 1)
            if gb.target_revenue else None,
        })
        out.append(d)
    return out


@router.post("")
async def create_group_buy(
    data: GroupBuyIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    gb = GroupBuy()
    _apply(gb, data)
    db.add(gb)
    await db.flush()
    for cid in dict.fromkeys(data.campaign_ids or []):
        db.add(GroupBuyCampaign(group_buy_id=gb.id, campaign_id=cid))
    await db.commit()
    await db.refresh(gb)
    return _gb_out(gb)


@router.patch("/{gb_id}")
async def update_group_buy(
    gb_id: int,
    data: GroupBuyIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    gb = (await db.execute(select(GroupBuy).where(GroupBuy.id == gb_id))).scalar_one_or_none()
    if not gb:
        raise HTTPException(status_code=404, detail="공구를 찾을 수 없습니다")
    _apply(gb, data)
    await db.commit()
    await db.refresh(gb)
    return _gb_out(gb)


@router.delete("/{gb_id}")
async def delete_group_buy(
    gb_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(delete(GroupBuyCampaign).where(GroupBuyCampaign.group_buy_id == gb_id))
    res = await db.execute(delete(GroupBuy).where(GroupBuy.id == gb_id))
    await db.commit()
    if not res.rowcount:
        raise HTTPException(status_code=404, detail="공구를 찾을 수 없습니다")
    return {"deleted": gb_id}


class CampaignAttach(BaseModel):
    campaign_ids: List[int]


@router.post("/{gb_id}/campaigns")
async def attach_campaigns(
    gb_id: int,
    data: CampaignAttach,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    existing = set(await _campaign_ids_of(db, gb_id))
    added = 0
    for cid in dict.fromkeys(data.campaign_ids):
        if cid not in existing:
            db.add(GroupBuyCampaign(group_buy_id=gb_id, campaign_id=cid))
            added += 1
    await db.commit()
    return {"added": added, "total": len(existing) + added}


@router.delete("/{gb_id}/campaigns/{campaign_id}")
async def detach_campaign(
    gb_id: int,
    campaign_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(delete(GroupBuyCampaign).where(
        GroupBuyCampaign.group_buy_id == gb_id,
        GroupBuyCampaign.campaign_id == campaign_id,
    ))
    await db.commit()
    return {"detached": campaign_id}


@router.get("/candidates")
async def campaign_candidates(
    q: Optional[str] = None,
    exclude_group_buy: Optional[int] = None,
    limit: int = Query(default=30, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """공구에 연결할 캠페인 검색."""
    query = select(AffiliateCampaign.id, AffiliateCampaign.name, AffiliateCampaign.status)
    if q:
        query = query.where(AffiliateCampaign.name.ilike(f"%{q}%"))
    if exclude_group_buy:
        attached = await _campaign_ids_of(db, exclude_group_buy)
        if attached:
            query = query.where(AffiliateCampaign.id.notin_(attached))
    rows = (await db.execute(query.order_by(AffiliateCampaign.id.desc()).limit(limit))).all()
    return [{"id": r[0], "name": r[1], "status": r[2]} for r in rows]


@router.get("/{gb_id}")
async def group_buy_detail(
    gb_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    gb = (await db.execute(select(GroupBuy).where(GroupBuy.id == gb_id))).scalar_one_or_none()
    if not gb:
        raise HTTPException(status_code=404, detail="공구를 찾을 수 없습니다")
    cids = await _campaign_ids_of(db, gb_id)

    backend = (settings.BACKEND_URL or "").rstrip("/")
    campaigns = []
    if cids:
        camp_rows = (await db.execute(
            select(AffiliateCampaign).where(AffiliateCampaign.id.in_(cids))
        )).scalars().all()

        conv_agg = {r[0]: (int(r[1]), float(r[2])) for r in (await db.execute(
            select(
                ReferralConversion.campaign_id,
                func.count(ReferralConversion.id),
                func.coalesce(func.sum(ReferralConversion.order_amount), 0),
            ).where(
                ReferralConversion.campaign_id.in_(cids), CONFIRMED_ATTR,
                *_period_filters(gb),
            ).group_by(ReferralConversion.campaign_id)
        )).all()}
        click_agg = {r[0]: int(r[1]) for r in (await db.execute(
            select(ReferralClick.campaign_id, func.count(ReferralClick.id))
            .where(ReferralClick.campaign_id.in_(cids), *_period_filters(gb, conv=False))
            .group_by(ReferralClick.campaign_id)
        )).all()}

        for c in sorted(camp_rows, key=lambda x: conv_agg.get(x.id, (0, 0))[1], reverse=True):
            orders, revenue = conv_agg.get(c.id, (0, 0.0))
            campaigns.append({
                "id": c.id,
                "name": c.name,
                "status": c.status,
                "referral_code": c.referral_code,
                "tracking_link": f"{backend}/r/{c.referral_code}" if backend and c.referral_code else None,
                "coupon_code": getattr(c, "cafe24_coupon_code", None),
                "clicks": click_agg.get(c.id, 0),
                "confirmed_orders": orders,
                "confirmed_revenue": revenue,
            })

    # 일별 확정 매출 (기간 내)
    daily = []
    if cids:
        daily_rows = (await db.execute(
            select(
                func.date(ReferralConversion.converted_at),
                func.count(ReferralConversion.id),
                func.coalesce(func.sum(ReferralConversion.order_amount), 0),
            ).where(
                ReferralConversion.campaign_id.in_(cids), CONFIRMED_ATTR,
                *_period_filters(gb),
            ).group_by(func.date(ReferralConversion.converted_at))
            .order_by(func.date(ReferralConversion.converted_at))
        )).all()
        daily = [{"date": str(d), "orders": int(o), "revenue": float(r)} for d, o, r in daily_rows]

    # 상위 파트너 (기간 내 확정 매출)
    top_partners = []
    if cids:
        tp = (await db.execute(
            select(
                AffiliatePartner.id, AffiliatePartner.name,
                func.count(ReferralConversion.id),
                func.coalesce(func.sum(ReferralConversion.order_amount), 0),
            )
            .join(ReferralConversion, ReferralConversion.partner_id == AffiliatePartner.id)
            .where(
                ReferralConversion.campaign_id.in_(cids), CONFIRMED_ATTR,
                *_period_filters(gb),
            )
            .group_by(AffiliatePartner.id, AffiliatePartner.name)
            .order_by(func.coalesce(func.sum(ReferralConversion.order_amount), 0).desc())
            .limit(10)
        )).all()
        top_partners = [
            {"id": r[0], "name": r[1], "orders": int(r[2]), "revenue": float(r[3])} for r in tp
        ]

    total_revenue = sum(c["confirmed_revenue"] for c in campaigns)
    d = _gb_out(gb)
    d.update({
        "campaigns": campaigns,
        "daily": daily,
        "top_partners": top_partners,
        "totals": {
            "clicks": sum(c["clicks"] for c in campaigns),
            "confirmed_orders": sum(c["confirmed_orders"] for c in campaigns),
            "confirmed_revenue": total_revenue,
            "progress_pct": round(total_revenue / gb.target_revenue * 100, 1)
            if gb.target_revenue else None,
        },
    })
    return d
