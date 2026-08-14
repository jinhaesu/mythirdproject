"""네이버 인사이트 — NAVER API HUB 기반 분석 기능.

- 검색어 트렌드 (search-trend/v1/search)
- 쇼핑인사이트 분야/키워드 트렌드 (shopping/v1/*)
- 블로그/카페 언급량 모니터링 (+일별 스냅샷 추이)
- 블로그 내용 긍정/부정 단어 추출 → 마인드맵 데이터 (Claude)
"""
import json
import logging
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_user
from app.db.database import get_db
from app.models.user import User
from app.services.naver import api_hub
from app.services.naver_mention_service import clean_text, fetch_mentions, upsert_mention_snapshot

logger = logging.getLogger(__name__)
router = APIRouter()

# 네이버쇼핑 카테고리 프리셋 (datalab getCategory 실측, 2026-08-09)
SHOPPING_CATEGORY_PRESETS = [
    {"name": "빵/베이커리", "code": "50022959"},
    {"name": "스낵/과자", "code": "50022619"},
    {"name": "젤리/사탕/초콜릿", "code": "50022439"},
    {"name": "전통과자", "code": "50022819"},
    {"name": "떡류", "code": "50019139"},
    {"name": "아이스크림/빙수", "code": "50023159"},
    {"name": "다이어트식품", "code": "50000024"},
    {"name": "건강식품", "code": "50000023"},
    {"name": "식품(전체)", "code": "50000006"},
]


def _default_range(days: int = 90) -> tuple:
    end = date.today() - timedelta(days=1)  # 데이터랩은 전일까지 제공
    start = end - timedelta(days=days)
    return start.isoformat(), end.isoformat()


# ── 절대 검색량 환산 (데이터랩 상대지수 × 검색광고 키워드도구 월간 검색량) ──

def _norm_kw(k: str) -> str:
    return (k or "").replace(" ", "").upper()


def _qc_num(v) -> int:
    """키워드도구 검색량 값 파싱 — '< 10' 형태는 최소 근사값 5로 처리."""
    try:
        return int(v)
    except (TypeError, ValueError):
        return 5 if "<" in str(v) else 0


async def _fetch_monthly_volumes(keywords: List[str]) -> Dict[str, Dict[str, int]]:
    """검색광고 키워드도구로 키워드별 최근 30일 절대 검색량 조회.

    반환: {정규화키워드: {pc, mobile, total}}. 자격증명 미설정/실패 시 {} (호출측 폴백).
    """
    from app.core.config import get_settings

    settings = get_settings()
    if not (
        settings.NAVER_ADS_API_KEY
        and settings.NAVER_ADS_SECRET_KEY
        and settings.NAVER_ADS_CUSTOMER_ID
    ):
        return {}

    from app.services.naver.search_ads_api import NaverSearchAdsAPI

    client = NaverSearchAdsAPI(
        api_key=settings.NAVER_ADS_API_KEY,
        secret_key=settings.NAVER_ADS_SECRET_KEY,
        customer_id=settings.NAVER_ADS_CUSTOMER_ID,
    )
    try:
        rows = await client.get_keyword_search_volume(
            [k.replace(" ", "") for k in keywords if k.strip()][:5]
        )
    except Exception as exc:
        logger.warning(f"[NaverInsights] 키워드도구 검색량 조회 실패: {exc}")
        return {}

    wanted = {_norm_kw(k) for k in keywords}
    out: Dict[str, Dict[str, int]] = {}
    for r in rows:
        rk = _norm_kw(r.get("relKeyword", ""))
        if rk in wanted and rk not in out:
            pc = _qc_num(r.get("monthlyPcQcCnt"))
            mo = _qc_num(r.get("monthlyMobileQcCnt"))
            out[rk] = {"pc": pc, "mobile": mo, "total": pc + mo}
    return out


def _bucket_range(period_str: str, time_unit: str) -> tuple:
    """데이터랩 버킷의 (시작일, 종료일). period는 버킷 시작일."""
    start = date.fromisoformat(period_str)
    if time_unit == "week":
        return start, start + timedelta(days=6)
    if time_unit == "month":
        nxt = date(start.year + (start.month == 12), start.month % 12 + 1, 1)
        return start, nxt - timedelta(days=1)
    return start, start


def _apply_absolute_scale(
    results: List[dict], time_unit: str, end_date_str: str,
    volumes: Dict[str, Dict[str, int]], kw_by_title: Dict[str, str],
) -> bool:
    """상대지수 시리즈에 absolute(추정 쿼리수) 필드 부여.

    스케일: 최근 30일 창과 각 버킷의 겹침 일수를 가중해
    Σ(ratio×overlap비율) ↔ 월간검색량×(창일수/30) 이 일치하도록 k 산출.
    """
    try:
        end_dt = date.fromisoformat(end_date_str)
    except ValueError:
        return False
    window_start = end_dt - timedelta(days=29)
    applied = False

    for res in results:
        kw = kw_by_title.get(res.get("title", ""))
        vol = volumes.get(_norm_kw(kw)) if kw else None
        pts = res.get("data", [])
        res["monthly_volume"] = vol
        if not vol or not vol.get("total") or not pts:
            continue
        weighted = 0.0
        window_days = 0
        for p in pts:
            try:
                b_start, b_end = _bucket_range(p["period"], time_unit)
            except (KeyError, ValueError):
                continue
            o_start = max(b_start, window_start)
            o_end = min(b_end, end_dt)
            if o_start > o_end:
                continue
            overlap = (o_end - o_start).days + 1
            bucket_days = (b_end - b_start).days + 1
            weighted += float(p.get("ratio", 0)) * (overlap / bucket_days)
            window_days += overlap
        if weighted <= 0 or window_days <= 0:
            continue
        k = (vol["total"] * (window_days / 30.0)) / weighted
        for p in pts:
            p["absolute"] = round(float(p.get("ratio", 0)) * k)
        res["scale_factor"] = k
        applied = True
    return applied


# ── 상태/프리셋 ──────────────────────────────────────────────────────────────

@router.get("/status")
async def get_status(current_user: User = Depends(get_current_user)):
    return {"configured": api_hub.is_configured()}


@router.get("/shopping-categories")
async def get_shopping_categories(current_user: User = Depends(get_current_user)):
    return {"categories": SHOPPING_CATEGORY_PRESETS}


# ── 검색어 트렌드 ────────────────────────────────────────────────────────────

class KeywordGroup(BaseModel):
    name: str
    keywords: List[str] = Field(..., min_length=1, max_length=20)


class SearchTrendRequest(BaseModel):
    keyword_groups: List[KeywordGroup] = Field(..., min_length=1, max_length=5)
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    time_unit: str = "date"
    device: Optional[str] = None
    gender: Optional[str] = None
    ages: Optional[List[str]] = None


@router.post("/search-trend")
async def search_trend(
    req: SearchTrendRequest,
    current_user: User = Depends(get_current_user),
):
    """키워드(그룹 최대 5개)의 통합검색 검색량 추이.

    데이터랩 상대지수에 검색광고 키워드도구 월간 검색량을 결합해
    절대 쿼리수(absolute)를 추정 부여. 키워드도구 실패 시 상대지수만 반환.
    """
    if not api_hub.is_configured():
        raise HTTPException(status_code=503, detail="NAVER API HUB 키가 설정되지 않았습니다.")
    d_start, d_end = _default_range()
    end_date = req.end_date or d_end
    r = await api_hub.search_trend(
        keyword_groups=[
            {"groupName": g.name, "keywords": g.keywords} for g in req.keyword_groups
        ],
        start_date=req.start_date or d_start,
        end_date=end_date,
        time_unit=req.time_unit,
        device=req.device,
        gender=req.gender,
        ages=req.ages,
    )
    if not r["ok"]:
        raise HTTPException(status_code=502, detail=f"검색어 트렌드 조회 실패: {r.get('error')}")

    data = r["data"]
    kw_by_title = {g.name: g.keywords[0] for g in req.keyword_groups if g.keywords}
    volumes = await _fetch_monthly_volumes(list(kw_by_title.values()))
    absolute_available = _apply_absolute_scale(
        data.get("results", []), req.time_unit, end_date, volumes, kw_by_title,
    ) if volumes else False

    return {
        **data,
        "absolute_available": absolute_available,
        "as_of": datetime.utcnow().isoformat(),
    }


# ── 쇼핑인사이트 ─────────────────────────────────────────────────────────────

class CategoryItem(BaseModel):
    name: str
    code: str


class ShoppingCategoryTrendRequest(BaseModel):
    categories: List[CategoryItem] = Field(..., min_length=1, max_length=3)
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    time_unit: str = "date"
    device: Optional[str] = None
    gender: Optional[str] = None
    ages: Optional[List[str]] = None


@router.post("/shopping-category-trend")
async def shopping_category_trend(
    req: ShoppingCategoryTrendRequest,
    current_user: User = Depends(get_current_user),
):
    """쇼핑 분야(최대 3개)의 클릭 트렌드 (상대지수 0~100)."""
    if not api_hub.is_configured():
        raise HTTPException(status_code=503, detail="NAVER API HUB 키가 설정되지 않았습니다.")
    d_start, d_end = _default_range()
    r = await api_hub.shopping_category_trend(
        categories=[{"name": c.name, "param": [c.code]} for c in req.categories],
        start_date=req.start_date or d_start,
        end_date=req.end_date or d_end,
        time_unit=req.time_unit,
        device=req.device,
        gender=req.gender,
        ages=req.ages,
    )
    if not r["ok"]:
        raise HTTPException(status_code=502, detail=f"쇼핑인사이트 조회 실패: {r.get('error')}")
    return {**r["data"], "as_of": datetime.utcnow().isoformat()}


class ShoppingKeywordTrendRequest(BaseModel):
    category_code: str
    keywords: List[str] = Field(..., min_length=1, max_length=5)
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    time_unit: str = "date"
    device: Optional[str] = None
    gender: Optional[str] = None
    ages: Optional[List[str]] = None


@router.post("/shopping-keyword-trend")
async def shopping_keyword_trend(
    req: ShoppingKeywordTrendRequest,
    current_user: User = Depends(get_current_user),
):
    """특정 쇼핑 분야 내 키워드(최대 5개)별 클릭 트렌드."""
    if not api_hub.is_configured():
        raise HTTPException(status_code=503, detail="NAVER API HUB 키가 설정되지 않았습니다.")
    d_start, d_end = _default_range()
    r = await api_hub.shopping_keyword_trend(
        category_code=req.category_code,
        keywords=[{"name": kw, "param": [kw]} for kw in req.keywords],
        start_date=req.start_date or d_start,
        end_date=req.end_date or d_end,
        time_unit=req.time_unit,
        device=req.device,
        gender=req.gender,
        ages=req.ages,
    )
    if not r["ok"]:
        raise HTTPException(status_code=502, detail=f"쇼핑 키워드 트렌드 조회 실패: {r.get('error')}")
    return {**r["data"], "as_of": datetime.utcnow().isoformat()}


# ── 블로그/카페 언급량 ───────────────────────────────────────────────────────

@router.get("/mentions")
async def get_mentions(
    keyword: str,
    display: int = 10,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """블로그+카페 언급 총량 및 최근 게시물. 조회 시 오늘자 스냅샷도 저장."""
    if not api_hub.is_configured():
        raise HTTPException(status_code=503, detail="NAVER API HUB 키가 설정되지 않았습니다.")
    result = await fetch_mentions(keyword, display=min(display, 30))
    try:
        await upsert_mention_snapshot(
            db, keyword,
            result["blog"]["total"] if result["blog"] else -1,
            result["cafe"]["total"] if result["cafe"] else -1,
        )
    except Exception as exc:
        logger.warning(f"[NaverInsights] 스냅샷 저장 실패: {exc}")
    return {**result, "as_of": datetime.utcnow().isoformat()}


@router.get("/mention-history")
async def get_mention_history(
    keyword: str,
    days: int = 90,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """저장된 일별 언급량 스냅샷 추이."""
    from app.models.naver_insight import NaverMentionDaily

    since = date.today() - timedelta(days=min(days, 1095))
    q = await db.execute(
        select(NaverMentionDaily)
        .where(NaverMentionDaily.keyword == keyword, NaverMentionDaily.date >= since)
        .order_by(NaverMentionDaily.date)
    )
    rows = q.scalars().all()
    return {
        "keyword": keyword,
        "history": [
            {"date": r.date.isoformat(), "blog_total": r.blog_total, "cafe_total": r.cafe_total}
            for r in rows
        ],
    }


# ── 블로그 감성 마인드맵 ─────────────────────────────────────────────────────

class SentimentMindmapRequest(BaseModel):
    keyword: str
    sample: int = Field(default=30, ge=5, le=50)


@router.post("/sentiment-mindmap")
async def sentiment_mindmap(
    req: SentimentMindmapRequest,
    current_user: User = Depends(get_current_user),
):
    """최근 블로그 글에서 긍정/부정 단어를 추출해 마인드맵 데이터로 반환."""
    if not api_hub.is_configured():
        raise HTTPException(status_code=503, detail="NAVER API HUB 키가 설정되지 않았습니다.")

    from app.services.naver_insights_service import analyze_blog_sentiment

    try:
        result = await analyze_blog_sentiment(req.keyword, sample=req.sample)
    except Exception as exc:
        logger.error(f"[NaverInsights] 감성 분석 실패: {exc}")
        raise HTTPException(status_code=502, detail=f"AI 감성 분석 실패: {exc}")

    return {**result, "as_of": datetime.utcnow().isoformat()}
