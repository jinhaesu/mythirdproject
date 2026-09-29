"""홈 브리핑 API — 전 채널 현황을 DB 로컬 집계만으로 한 번에 반환.

외부 API 호출 없음(수집 루프가 쌓아둔 스냅샷만 사용) → 홈 화면이 즉시 뜬다.
"""
import logging
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_user, get_shared_cafe24_user
from app.db.database import get_db
from app.models import (
    AffiliateCampaign,
    AffiliateOrderBind,
    MallOrder,
    MarketingActivity,
    MarketingGoal,
    MetaInsightDaily,
    MonthlyChannelSpend,
    NaverMentionDaily,
    ReferralClick,
    ReferralConversion,
)
from app.models.user import User
from app.services.attribution import CONFIRMED_SOURCES

logger = logging.getLogger(__name__)
router = APIRouter()

CONFIRMED_ATTR = ReferralConversion.attribution_source.in_(sorted(CONFIRMED_SOURCES))


@router.get("/briefing")
async def home_briefing(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    today = date.today()
    month_start = today.replace(day=1)
    month_str = today.strftime("%Y-%m")
    d7 = today - timedelta(days=7)
    d14 = today - timedelta(days=14)
    d30 = today - timedelta(days=30)

    # ── 자사몰 매출 (이번 달 / 최근 7일, 취소·환불 제외) ──────────────────
    paid = MallOrder.status == "paid"
    month_sales = (await db.execute(
        select(func.coalesce(func.sum(MallOrder.amount), 0), func.count(MallOrder.id))
        .where(paid, MallOrder.order_date >= month_start)
    )).first()
    week_sales = (await db.execute(
        select(func.coalesce(func.sum(MallOrder.amount), 0), func.count(MallOrder.id))
        .where(paid, MallOrder.order_date >= d7)
    )).first()
    prev_week_sales = (await db.execute(
        select(func.coalesce(func.sum(MallOrder.amount), 0))
        .where(paid, MallOrder.order_date >= d14, MallOrder.order_date < d7)
    )).scalar() or 0

    # ── 이번 달 목표 (있으면) ────────────────────────────────────────────
    goal = (await db.execute(
        select(MarketingGoal).where(MarketingGoal.month == month_str)
    )).scalar_one_or_none()
    spend_rows = (await db.execute(
        select(MonthlyChannelSpend).where(MonthlyChannelSpend.month == month_str)
    )).scalars().all()
    month_planned_spend = sum(r.planned_amount or 0 for r in spend_rows)

    # ── Meta 최근 7일 (일별 스냅샷 합산) ─────────────────────────────────
    meta7 = (await db.execute(
        select(
            func.coalesce(func.sum(MetaInsightDaily.spend), 0),
            func.coalesce(func.sum(MetaInsightDaily.revenue), 0),
            func.coalesce(func.sum(MetaInsightDaily.conversions), 0),
        ).where(MetaInsightDaily.level == "campaign", MetaInsightDaily.date >= d7)
    )).first()
    meta_prev7 = (await db.execute(
        select(
            func.coalesce(func.sum(MetaInsightDaily.spend), 0),
            func.coalesce(func.sum(MetaInsightDaily.revenue), 0),
        ).where(
            MetaInsightDaily.level == "campaign",
            MetaInsightDaily.date >= d14, MetaInsightDaily.date < d7,
        )
    )).first()
    meta_spend7, meta_rev7 = float(meta7[0]), float(meta7[1])
    meta_daily = (await db.execute(
        select(
            MetaInsightDaily.date,
            func.sum(MetaInsightDaily.spend),
            func.sum(MetaInsightDaily.revenue),
        )
        .where(MetaInsightDaily.level == "campaign", MetaInsightDaily.date >= d14)
        .group_by(MetaInsightDaily.date).order_by(MetaInsightDaily.date)
    )).all()

    # ── 어필리에이트 ─────────────────────────────────────────────────────
    aff30 = (await db.execute(
        select(
            func.count(ReferralConversion.id),
            func.coalesce(func.sum(ReferralConversion.order_amount), 0),
        ).where(CONFIRMED_ATTR, ReferralConversion.converted_at >= d30)
    )).first()
    clicks7 = (await db.execute(
        select(func.count(ReferralClick.id)).where(ReferralClick.clicked_at >= d7)
    )).scalar() or 0
    clicks_prev7 = (await db.execute(
        select(func.count(ReferralClick.id))
        .where(ReferralClick.clicked_at >= d14, ReferralClick.clicked_at < d7)
    )).scalar() or 0
    binds7 = (await db.execute(
        select(func.count(AffiliateOrderBind.id)).where(AffiliateOrderBind.created_at >= d7)
    )).scalar() or 0
    active_campaigns = (await db.execute(
        select(func.count(AffiliateCampaign.id)).where(AffiliateCampaign.status == "active")
    )).scalar() or 0

    # ── 네이버 브랜드 언급량 (일별 스냅샷 — 최신 vs 7일 전) ──────────────
    mention_rows = (await db.execute(
        select(NaverMentionDaily)
        .where(NaverMentionDaily.date >= d14)
        .order_by(NaverMentionDaily.keyword, NaverMentionDaily.date)
    )).scalars().all()
    mentions = {}
    for r in mention_rows:
        m = mentions.setdefault(r.keyword, {"keyword": r.keyword, "series": []})
        m["series"].append({"date": r.date.isoformat(), "blog": r.blog_total, "cafe": r.cafe_total})
    naver_mentions = []
    for m in mentions.values():
        s = m["series"]
        latest, first = s[-1], s[0]
        naver_mentions.append({
            "keyword": m["keyword"],
            "blog_total": latest["blog"],
            "cafe_total": latest["cafe"],
            "blog_delta_14d": latest["blog"] - first["blog"],
            "as_of": latest["date"],
        })

    # ── 마케팅 활동 (이번 달 기입 데이터) ────────────────────────────────
    act = (await db.execute(
        select(
            func.count(MarketingActivity.id),
            func.coalesce(func.sum(MarketingActivity.views), 0),
            func.coalesce(func.sum(MarketingActivity.cost), 0),
        ).where(MarketingActivity.period_month == month_str)
    )).first()

    # ── 연동 상태 ────────────────────────────────────────────────────────
    cafe24_user = current_user if current_user.cafe24_access_token else await get_shared_cafe24_user(db)
    meta_connected = (await db.execute(
        select(func.count(User.id)).where(
            User.meta_access_token.isnot(None), User.meta_access_token != ""
        )
    )).scalar() or 0

    def pct(cur, prev):
        return round((cur - prev) / prev * 100, 1) if prev else None

    return {
        "as_of": datetime.utcnow().isoformat(),
        "month": month_str,
        "sales": {
            "month_amount": float(month_sales[0]),
            "month_orders": int(month_sales[1]),
            "week_amount": float(week_sales[0]),
            "week_orders": int(week_sales[1]),
            "week_delta_pct": pct(float(week_sales[0]), float(prev_week_sales)),
        },
        "goal": {
            "month_planned_spend": month_planned_spend,
            "target_new_customers": goal.target_new_customers if goal else None,
            "target_cac": goal.target_cac if goal else None,
        },
        "meta": {
            "spend_7d": meta_spend7,
            "revenue_7d": meta_rev7,
            "roas_7d": round(meta_rev7 / meta_spend7, 2) if meta_spend7 else None,
            "purchases_7d": float(meta7[2]),
            "spend_delta_pct": pct(meta_spend7, float(meta_prev7[0])),
            "roas_prev7": round(float(meta_prev7[1]) / float(meta_prev7[0]), 2) if float(meta_prev7[0]) else None,
            "daily": [
                {"date": d.isoformat(), "spend": float(s), "revenue": float(r)}
                for d, s, r in meta_daily
            ],
        },
        "affiliate": {
            "confirmed_orders_30d": int(aff30[0]),
            "confirmed_amount_30d": float(aff30[1]),
            "clicks_7d": clicks7,
            "clicks_delta_pct": pct(clicks7, clicks_prev7),
            "binds_7d": binds7,
            "active_campaigns": active_campaigns,
            "tracking_healthy": binds7 > 0 or clicks7 < 50,
        },
        "naver_mentions": naver_mentions,
        "activities": {
            "month_rows": int(act[0]),
            "month_views": int(act[1]),
            "month_cost": float(act[2]),
        },
        "connections": {
            "cafe24": bool(cafe24_user and cafe24_user.cafe24_access_token),
            "meta": meta_connected > 0,
        },
    }
