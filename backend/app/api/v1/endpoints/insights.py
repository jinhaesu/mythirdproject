"""Meta 광고 인사이트 API — 스냅샷 + 온디맨드 하이브리드.

엔드포인트:
  GET  /api/v1/insights/trend?days=30  — DB 기반 트렌드 조회
  POST /api/v1/insights/refresh         — 즉시 수집 실행
  GET  /api/v1/insights/status          — 수집기 상태 조회
"""
import logging
from collections import defaultdict
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.user import User
from app.api.v1.endpoints.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()


# ── 파생 지표 계산 헬퍼 ──────────────────────────────────────────────────────

def _safe_div(numerator: float, denominator: float) -> float:
    """0 나누기를 0으로 처리하는 안전 나눗셈."""
    if not denominator:
        return 0.0
    return round(numerator / denominator, 4)


def _build_series_row(
    row_date: date,
    spend: float,
    impressions: int,
    clicks: int,
    conversions: float,
    revenue: float,
) -> Dict[str, Any]:
    """날짜 + 원본 지표 → 파생 지표 포함 시리즈 행 반환."""
    roas = _safe_div(revenue, spend)
    cpa = _safe_div(spend, conversions)
    ctr = round(_safe_div(clicks, impressions) * 100, 4)
    return {
        "date": row_date.isoformat(),
        "spend": round(spend, 2),
        "impressions": impressions,
        "clicks": clicks,
        "conversions": round(conversions, 2),
        "revenue": round(revenue, 2),
        "roas": roas,
        "cpa": round(cpa, 2),
        "ctr": ctr,
    }


# ── GET /trend ───────────────────────────────────────────────────────────────

@router.get("/trend")
async def get_insights_trend(
    days: int = Query(default=30, description="조회 일수: 7, 30, 90"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """DB에 저장된 campaign 레벨 인사이트를 일별로 집계하여 반환.

    account.series — 전체 캠페인 합산 일별 지표
    campaigns      — 캠페인별 일별 지표
    """
    if days not in (7, 30, 90):
        raise HTTPException(status_code=422, detail="days 는 7, 30, 90 중 하나여야 합니다.")

    from app.models.meta_insight import MetaInsightDaily
    from app.services.meta_insights_collector import collector_state

    since = date.today() - timedelta(days=days)

    # 공유 Meta 자격증명의 ad_account_id 를 기준으로 조회
    # (현재 유저에게 없으면 공유 유저에서 가져옴 — analytics와 동일 패턴)
    from app.api.v1.endpoints.auth import get_shared_meta_credentials

    meta_user: Optional[User] = (
        current_user if current_user.meta_access_token
        else await get_shared_meta_credentials(db)
    )
    ad_account_id: Optional[str] = None
    if meta_user and meta_user.meta_ad_account_id:
        ad_account_id = meta_user.meta_ad_account_id
        if not ad_account_id.startswith("act_"):
            ad_account_id = f"act_{ad_account_id}"

    # DB 조회 — ad_account_id 필터 (없으면 전체)
    query = select(MetaInsightDaily).where(
        MetaInsightDaily.date >= since,
        MetaInsightDaily.level == "campaign",
    )
    if ad_account_id:
        query = query.where(MetaInsightDaily.ad_account_id == ad_account_id)

    result = await db.execute(query.order_by(MetaInsightDaily.date))
    rows = result.scalars().all()

    # ── 일자별 전체 합산 (account 레벨) ──
    # key: date_str → 누적 dict
    account_agg: Dict[str, Dict[str, float]] = defaultdict(
        lambda: {"spend": 0.0, "impressions": 0, "clicks": 0, "conversions": 0.0, "revenue": 0.0}
    )
    # key: campaign_id → {"name": ..., "dates": {date_str: {...}}}
    campaign_agg: Dict[str, Dict[str, Any]] = {}

    for row in rows:
        date_str = row.date.isoformat()

        # 계정 집계
        acc = account_agg[date_str]
        acc["spend"] += row.spend
        acc["impressions"] += row.impressions
        acc["clicks"] += row.clicks
        acc["conversions"] += row.conversions
        acc["revenue"] += row.revenue

        # 캠페인 집계
        cid = row.campaign_id or row.object_id
        if cid not in campaign_agg:
            campaign_agg[cid] = {
                "campaign_id": cid,
                "campaign_name": row.campaign_name or row.object_name or cid,
                "dates": defaultdict(
                    lambda: {"spend": 0.0, "impressions": 0, "clicks": 0, "conversions": 0.0, "revenue": 0.0}
                ),
            }
        cdates = campaign_agg[cid]["dates"][date_str]
        cdates["spend"] += row.spend
        cdates["impressions"] += row.impressions
        cdates["clicks"] += row.clicks
        cdates["conversions"] += row.conversions
        cdates["revenue"] += row.revenue

    # ── 시리즈 빌드 ──
    account_series = [
        _build_series_row(
            date.fromisoformat(d),
            v["spend"], v["impressions"], v["clicks"], v["conversions"], v["revenue"]
        )
        for d, v in sorted(account_agg.items())
    ]

    campaigns_out = []
    for cid, cdata in campaign_agg.items():
        series = [
            _build_series_row(
                date.fromisoformat(d),
                v["spend"], v["impressions"], v["clicks"], v["conversions"], v["revenue"]
            )
            for d, v in sorted(cdata["dates"].items())
        ]
        campaigns_out.append({
            "campaign_id": cdata["campaign_id"],
            "campaign_name": cdata["campaign_name"],
            "series": series,
        })

    return {
        "as_of": collector_state.get("as_of"),
        "account": {"series": account_series},
        "campaigns": campaigns_out,
    }


# ── POST /refresh ────────────────────────────────────────────────────────────

@router.post("/refresh")
async def refresh_insights(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """즉시 Meta 인사이트 수집을 실행하고 결과를 반환."""
    from app.services.meta_insights_collector import collect_insights, collector_state

    try:
        collected_rows = await collect_insights(db)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"수집 중 오류 발생: {exc}")

    return {
        "collected_rows": collected_rows,
        "as_of": collector_state.get("as_of"),
    }


# ── GET /status ──────────────────────────────────────────────────────────────

@router.get("/status")
async def get_insights_status(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """수집기 상태 및 DB 요약 반환."""
    from app.models.meta_insight import MetaInsightDaily
    from app.services.meta_insights_collector import collector_state

    count_result = await db.execute(
        select(func.count()).select_from(MetaInsightDaily)
    )
    total_rows = count_result.scalar() or 0

    return {
        "as_of": collector_state.get("as_of"),
        "total_rows": total_rows,
        "token_expired": collector_state.get("token_expired", False),
        "last_error": collector_state.get("last_error"),
    }
