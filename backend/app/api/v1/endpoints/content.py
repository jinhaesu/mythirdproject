"""콘텐츠 분석 — 발행 콘텐츠의 일별 스냅샷 기반 누적/증가 추이·기여 분해.

- 누적 조회수 = 활동별 마지막 스냅샷 값 carry-forward 합 (일별)
- 증가 분해: 기존 콘텐츠(조회 기간 전 발행)의 증가분 vs 신규 콘텐츠 기여분
- 좋아요·댓글 합계 추이 + 네이버 브랜드 언급량 병치
- 톱 무버: 최근 7일 조회수 증가 상위 콘텐츠
"""
import logging
from collections import defaultdict
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_user
from app.db.database import get_db
from app.models import ContentMetricSnapshot, MarketingActivity, NaverMentionDaily
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/analytics")
async def content_analytics(
    days: int = Query(default=30, ge=7, le=120),
    activity_type: str = Query(default=""),  # 빈 값 = 전체
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    today = date.today()
    start = today - timedelta(days=days - 1)
    start_month = start.strftime("%Y-%m")

    # 스냅샷: 기간 내 + 기간 직전 베이스라인(활동별 start 이전 마지막 값)
    snaps = (await db.execute(
        select(ContentMetricSnapshot)
        .where(ContentMetricSnapshot.date >= start - timedelta(days=45))
        .order_by(ContentMetricSnapshot.activity_id, ContentMetricSnapshot.date)
    )).scalars().all()
    act_ids = {s.activity_id for s in snaps}
    acts = {}
    if act_ids:
        for a in (await db.execute(
            select(MarketingActivity).where(MarketingActivity.id.in_(act_ids))
        )).scalars().all():
            acts[a.id] = a
    if activity_type:
        snaps = [s for s in snaps if acts.get(s.activity_id)
                 and acts[s.activity_id].activity_type == activity_type]

    # 활동별 날짜순 스냅샷
    by_act: dict[int, list] = defaultdict(list)
    for s in snaps:
        by_act[s.activity_id].append(s)

    def is_new(a) -> bool:
        """조회 기간 내 발행된 콘텐츠인가 — activity_date 우선, 없으면 period_month."""
        if a.activity_date:
            return a.activity_date >= start
        return (a.period_month or "") >= start_month

    dates = [start + timedelta(days=i) for i in range(days)]
    daily = {d: {"views_total": 0, "views_existing": 0, "views_new": 0,
                 "likes": 0, "comments": 0, "tracked": 0} for d in dates}

    per_act_7d: list = []
    d7 = today - timedelta(days=7)
    for aid, slist in by_act.items():
        a = acts.get(aid)
        if not a:
            continue
        new_flag = is_new(a)
        # carry-forward: 각 날짜 d에 대해 d 이전 마지막 스냅샷 값
        idx = 0
        last = None
        for d in dates:
            while idx < len(slist) and slist[idx].date <= d:
                last = slist[idx]
                idx += 1
            if last is None:
                continue
            row = daily[d]
            row["views_total"] += last.views
            row["views_new" if new_flag else "views_existing"] += last.views
            row["likes"] += last.likes
            row["comments"] += last.comments
            row["tracked"] += 1
        # 7일 증가분 (톱 무버)
        base7 = None
        last_all = slist[-1]
        for s in slist:
            if s.date <= d7:
                base7 = s
        delta7 = last_all.views - (base7.views if base7 else 0)
        if delta7 > 0:
            per_act_7d.append({
                "activity_id": aid, "delta_views_7d": delta7,
                "views": last_all.views, "likes": last_all.likes, "comments": last_all.comments,
                "product": a.product, "channel": a.channel, "creator": a.creator,
                "activity_type": a.activity_type, "period_month": a.period_month,
                "link": (a.link or "").split()[0][:300] if a.link else None,
                "is_new": is_new(a),
            })

    series = []
    prev = None
    for d in dates:
        row = daily[d]
        delta = (row["views_total"] - prev["views_total"]) if prev and row["tracked"] else None
        delta_new = (row["views_new"] - prev["views_new"]) if prev and row["tracked"] else None
        delta_existing = (row["views_existing"] - prev["views_existing"]) if prev and row["tracked"] else None
        series.append({
            "date": d.isoformat(),
            "views_total": row["views_total"],
            "views_existing": row["views_existing"],
            "views_new": row["views_new"],
            "delta": max(delta, 0) if delta is not None else None,
            "delta_existing": max(delta_existing, 0) if delta_existing is not None else None,
            "delta_new": max(delta_new, 0) if delta_new is not None else None,
            "likes": row["likes"], "comments": row["comments"], "tracked": row["tracked"],
        })
        if row["tracked"]:
            prev = row

    # 네이버 언급량 병치
    mentions = (await db.execute(
        select(NaverMentionDaily).where(NaverMentionDaily.date >= start)
        .order_by(NaverMentionDaily.date)
    )).scalars().all()
    mention_series: dict[str, list] = defaultdict(list)
    for mrow in mentions:
        mention_series[mrow.keyword].append({
            "date": mrow.date.isoformat(), "blog": mrow.blog_total, "cafe": mrow.cafe_total,
        })

    filled = [r for r in series if r["tracked"]]
    latest = filled[-1] if filled else None
    first = filled[0] if filled else None
    top_movers = sorted(per_act_7d, key=lambda x: -x["delta_views_7d"])[:12]

    return {
        "as_of": datetime.utcnow().isoformat(),
        "window": {"from": start.isoformat(), "to": today.isoformat(), "days": days},
        "summary": {
            "tracked_contents": latest["tracked"] if latest else 0,
            "views_total": latest["views_total"] if latest else 0,
            "views_delta_window": (latest["views_total"] - first["views_total"]) if latest and first else 0,
            "views_new_contents": latest["views_new"] if latest else 0,
            "likes_total": latest["likes"] if latest else 0,
            "comments_total": latest["comments"] if latest else 0,
        },
        "series": series,
        "top_movers_7d": top_movers,
        "mentions": mention_series,
        "note": "유튜브=전 영상 자동, 인스타=자사 게시물(연동 시) 자동 — 매일 03:10 KST 스냅샷. "
                "타인 인스타 게시물은 API 미제공으로 시트/수기 값 유지.",
    }
