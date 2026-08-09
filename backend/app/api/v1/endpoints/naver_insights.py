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
    """키워드(그룹 최대 5개)의 통합검색 검색량 추이 (상대지수 0~100)."""
    if not api_hub.is_configured():
        raise HTTPException(status_code=503, detail="NAVER API HUB 키가 설정되지 않았습니다.")
    d_start, d_end = _default_range()
    r = await api_hub.search_trend(
        keyword_groups=[
            {"groupName": g.name, "keywords": g.keywords} for g in req.keyword_groups
        ],
        start_date=req.start_date or d_start,
        end_date=req.end_date or d_end,
        time_unit=req.time_unit,
        device=req.device,
        gender=req.gender,
        ages=req.ages,
    )
    if not r["ok"]:
        raise HTTPException(status_code=502, detail=f"검색어 트렌드 조회 실패: {r.get('error')}")
    return {**r["data"], "as_of": datetime.utcnow().isoformat()}


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

    since = date.today() - timedelta(days=min(days, 365))
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

    # 최근 블로그 글 수집 (정확도순 + 최신순 섞어 다양성 확보)
    posts: List[Dict[str, str]] = []
    seen_links: set = set()
    for sort in ("date", "sim"):
        r = await api_hub.search("blog", req.keyword, display=req.sample, sort=sort)
        if not r["ok"]:
            continue
        for it in r["data"].get("items", []):
            link = it.get("link", "")
            if link in seen_links:
                continue
            seen_links.add(link)
            posts.append({
                "title": clean_text(it.get("title", "")),
                "description": clean_text(it.get("description", "")),
                "date": it.get("postdate", ""),
            })
    if not posts:
        raise HTTPException(status_code=502, detail="블로그 글을 수집하지 못했습니다.")
    posts = posts[: req.sample * 2]

    corpus = "\n".join(
        f"- [{p['date']}] {p['title']} :: {p['description']}" for p in posts
    )

    prompt = f"""다음은 '{req.keyword}'에 대한 최근 네이버 블로그 글 {len(posts)}건의 제목·요약입니다.

{corpus}

위 글들에서 '{req.keyword}'에 대한 소비자 반응을 분석해 아래 JSON만 출력하세요(설명·마크다운 금지).

{{
  "positive": [{{"word": "긍정 단어/표현", "weight": 1~10 빈도·강도 점수, "context": "어떤 맥락인지 한 문장"}}],
  "negative": [{{"word": "부정 단어/표현", "weight": 1~10, "context": "한 문장"}}],
  "themes": [{{"name": "주요 화제(제품명·상황 등)", "sentiment": "positive|negative|neutral", "count": 언급횟수}}],
  "summary": "전체 여론 요약 2~3문장 (긍정:부정 비중 포함)"
}}

규칙:
- positive/negative 각 5~12개, weight 내림차순
- 단어는 실제 글에 등장한 한국어 표현 그대로 (예: "쫀득하다", "달다", "배송 빠름")
- 광고성 상투어("최고", "강추" 남발)는 weight를 낮게
- themes는 3~8개"""

    try:
        from app.services.ai import ClaudeService, extract_text

        claude = ClaudeService()
        response = claude.client.messages.create(
            model=claude.model,
            max_tokens=3000,
            messages=[{"role": "user", "content": prompt}],
        )
        text = extract_text(response)
        if not text:
            raise ValueError("AI 응답에 텍스트 블록이 없습니다")
        # JSON 블록만 추출 (앞뒤 잡설 방어)
        start_i, end_i = text.find("{"), text.rfind("}")
        parsed = json.loads(text[start_i:end_i + 1])
    except Exception as exc:
        logger.error(f"[NaverInsights] 감성 분석 실패: {exc}")
        raise HTTPException(status_code=502, detail=f"AI 감성 분석 실패: {exc}")

    return {
        "keyword": req.keyword,
        "sample_size": len(posts),
        "positive": parsed.get("positive", []),
        "negative": parsed.get("negative", []),
        "themes": parsed.get("themes", []),
        "summary": parsed.get("summary", ""),
        "as_of": datetime.utcnow().isoformat(),
    }
