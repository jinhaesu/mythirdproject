"""다른 사내 시스템이 서버끼리 읽는 조회 전용 API — 사람 로그인 없이 서비스 키로만 연다.

보고·계획(plan.nuldam.com) 마케팅 퍼포먼스 주간보고가 광고비 일보 합계와 Meta·GFA 광고 성과를
손으로 옮겨 적지 않고 바로 가져가게 한다(2026-10-27 마케팅 연다은 건의).
  GET /service/plan/ads-daily?since=YYYY-MM-DD&until=YYYY-MM-DD   (헤더 x-service-key)
키는 env PLAN_SERVICE_KEY — 비어 있으면 이 API는 닫혀 있다(503). 상태를 바꾸는 기능은 두지 않는다.
"""
import hmac
import logging
from datetime import date, datetime, timedelta
from typing import Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.adspend import _auto_daily
from app.core.config import get_settings
from app.db.database import get_db
from app.models import AdMedia, AdMediaSpendDaily, MetaInsightDaily
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter()
settings = get_settings()

MAX_DAYS = 400


def _require_key(x_service_key: Optional[str] = Header(default=None)) -> None:
    want = settings.PLAN_SERVICE_KEY
    if not want:
        raise HTTPException(status_code=503, detail="서비스 키가 설정되지 않았습니다")
    if not x_service_key or not hmac.compare_digest(x_service_key.encode(), want.encode()):
        raise HTTPException(status_code=401, detail="서비스 키가 맞지 않습니다")


def _day(s: str, name: str) -> date:
    try:
        return date.fromisoformat(s)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{name}는 YYYY-MM-DD 형식이어야 합니다")


def _add(acc: Dict[str, float], d: str, v: float) -> None:
    if v:
        acc[d] = acc.get(d, 0.0) + v


async def _adspend_daily(db: AsyncSession, d1: date, d2: date) -> tuple[Dict[str, float], Dict[str, float]]:
    """광고비 일보 일별 합(원, VAT 포함) — 일보 보드 합계와 같은 기준(활성 매체만, 자동 매체는 수집값).

    두 번째 값은 그중 이름에 GFA가 든 매체만. 시트에 합계만 적힌 매체는 한 날짜에 몰려 있다(일보 업로드 규칙).
    """
    media = (await db.execute(select(AdMedia).where(AdMedia.active.is_(True)))).scalars().all()
    end = d2 + timedelta(days=1)
    manual_ids = [m.id for m in media if not m.auto_source]
    gfa_ids = {m.id for m in media if "gfa" in (m.name or "").lower()}
    total: Dict[str, float] = {}
    gfa: Dict[str, float] = {}
    if manual_ids:
        rows = (await db.execute(
            select(AdMediaSpendDaily.media_id, AdMediaSpendDaily.date, AdMediaSpendDaily.amount)
            .where(AdMediaSpendDaily.media_id.in_(manual_ids),
                   AdMediaSpendDaily.date >= d1, AdMediaSpendDaily.date < end)
        )).all()
        for mid, d, amount in rows:
            v = float(amount or 0)
            _add(total, d.isoformat(), v)
            if mid in gfa_ids:
                _add(gfa, d.isoformat(), v)
    for src in sorted({m.auto_source for m in media if m.auto_source}):
        auto = await _auto_daily(db, src, d1, end)
        n = sum(1 for m in media if m.auto_source == src)  # 보드는 자동 매체 행마다 같은 수집값을 보여 준다
        for d, v in auto.items():
            _add(total, d, v * n)
    return total, gfa


async def _meta_daily(db: AsyncSession, d1: date, d2: date) -> tuple[list, Optional[str]]:
    """Meta 광고(공유 Meta 계정, 캠페인 합) 일별 — 마케팅 시스템 성과 분석 화면과 같은 값.

    revenue = 구매 전환값(omni_purchase 우선 하나만), conversions = 구매 수.
    """
    from app.api.v1.endpoints.auth import get_shared_meta_credentials

    meta_user = await get_shared_meta_credentials(db)
    account = None
    if meta_user and meta_user.meta_ad_account_id:
        account = meta_user.meta_ad_account_id
        if not account.startswith("act_"):
            account = f"act_{account}"
    q = (
        select(
            MetaInsightDaily.date,
            func.coalesce(func.sum(MetaInsightDaily.spend), 0),
            func.coalesce(func.sum(MetaInsightDaily.revenue), 0),
            func.coalesce(func.sum(MetaInsightDaily.conversions), 0),
            func.coalesce(func.sum(MetaInsightDaily.impressions), 0),
            func.coalesce(func.sum(MetaInsightDaily.clicks), 0),
        )
        .where(MetaInsightDaily.level == "campaign",
               MetaInsightDaily.date >= d1, MetaInsightDaily.date <= d2)
        .group_by(MetaInsightDaily.date)
        .order_by(MetaInsightDaily.date)
    )
    if account:
        q = q.where(MetaInsightDaily.ad_account_id == account)
    rows = (await db.execute(q)).all()
    out = [
        {"date": d.isoformat(), "spend": round(float(s), 2), "revenue": round(float(r), 2),
         "conversions": round(float(c), 2), "impressions": int(i), "clicks": int(k)}
        for d, s, r, c, i, k in rows
    ]
    return out, account


async def _gfa_daily(db: AsyncSession, d1: date, d2: date) -> dict:
    """네이버 GFA 오픈API 일별(연결돼 있을 때만). 연결 전이면 connected=false."""
    from app.api.v1.endpoints import naver_gfa as g

    u = (await db.execute(
        select(User).where(User.naver_gfa_refresh_token.isnot(None), User.naver_gfa_refresh_token != "")
        .order_by(User.id)
    )).scalars().first()
    if not u or not u.naver_gfa_ad_account_no:
        return {"connected": False, "daily": []}
    try:
        rows = await g._past_perf(u, db, d1, d2)
    except Exception as e:  # GFA 쪽 오류는 나머지 값을 막지 않는다
        logger.warning(f"[service] GFA 조회 실패: {e}")
        return {"connected": True, "error": str(getattr(e, "detail", e))[:200], "daily": []}
    by: Dict[str, Dict[str, float]] = {}
    for r in rows:
        d = str(r.get("statDt") or r.get("date") or r.get("statDate") or "")[:10]
        if not d:
            continue
        cur = by.setdefault(d, {"spend": 0.0, "conv_sales": 0.0, "conversions": 0.0, "impressions": 0.0, "clicks": 0.0})
        cur["spend"] += g._n(r, "sales", "cost", "adCost")
        cur["conv_sales"] += g._n(r, "convSales", "convSalesAmt")
        cur["conversions"] += g._n(r, "convCount", "conversions")
        cur["impressions"] += g._n(r, "impCount", "impCnt", "impressions")
        cur["clicks"] += g._n(r, "clickCount", "clickCnt", "clicks")
    return {
        "connected": True,
        "ad_account_no": u.naver_gfa_ad_account_no,
        "daily": [{"date": d, **{k: round(v, 2) for k, v in m.items()}} for d, m in sorted(by.items())],
    }


@router.get("/plan/ads-daily", dependencies=[Depends(_require_key)])
async def plan_ads_daily(
    since: str = Query(..., min_length=10, max_length=10),
    until: str = Query(..., min_length=10, max_length=10),
    db: AsyncSession = Depends(get_db),
):
    """기간 [since, until](양끝 포함) 일별 값 — 보고·계획 KPI 표와 고정 그래프용.

    adspend      광고비 일보 일별 합(원, VAT 포함, 일보 보드 합계와 같은 기준)
    adspend_gfa  그중 이름에 GFA가 든 매체
    meta         Meta 광고 일별 지출·구매 전환값·구매 수·노출·클릭(공유 Meta 계정, 캠페인 합)
    gfa          네이버 GFA 오픈API 일별(연결돼 있을 때만)
    """
    d1, d2 = _day(since, "since"), _day(until, "until")
    if d1 > d2:
        d1, d2 = d2, d1
    if (d2 - d1).days + 1 > MAX_DAYS:
        raise HTTPException(status_code=422, detail=f"조회 기간은 최대 {MAX_DAYS}일입니다")

    from app.services.meta_insights_collector import collector_state

    adspend, adspend_gfa = await _adspend_daily(db, d1, d2)
    meta, account = await _meta_daily(db, d1, d2)
    gfa = await _gfa_daily(db, d1, d2)
    return {
        "since": d1.isoformat(),
        "until": d2.isoformat(),
        "generated_at": datetime.utcnow().isoformat(),
        "adspend": [{"date": d, "amount": round(v, 0)} for d, v in sorted(adspend.items())],
        "adspend_gfa": [{"date": d, "amount": round(v, 0)} for d, v in sorted(adspend_gfa.items())],
        "meta": meta,
        "meta_account": account,
        "meta_collected_at": collector_state.get("as_of"),
        "meta_token_expired": bool(collector_state.get("token_expired")),
        "gfa": gfa,
    }
