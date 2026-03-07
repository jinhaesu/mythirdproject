"""Market keyword registration and monitoring endpoints."""
import json
import logging
from datetime import datetime
from typing import Dict, List, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from app.db.database import get_db
from app.models.user import User
from app.models.market_keyword import MarketKeyword
from app.api.v1.endpoints.auth import get_current_user
from app.services.ai import ClaudeService
from app.services.market_data import MarketDataService

logger = logging.getLogger(__name__)

router = APIRouter()


# --- Pydantic Schemas ---

class KeywordCreate(BaseModel):
    keyword: str = Field(..., min_length=1, max_length=255)


class PlatformMetrics(BaseModel):
    content_count: int = 0
    total_views: int = 0
    total_comments: int = 0


class NaverMetrics(BaseModel):
    blog_post_count: int = 0
    search_query_volume: int = 0


class PlatformData(BaseModel):
    youtube: Optional[PlatformMetrics] = None
    instagram: Optional[PlatformMetrics] = None
    naver: Optional[NaverMetrics] = None
    daily_trends: List[dict] = Field(default_factory=list)
    monthly_trends: List[dict] = Field(default_factory=list)
    api_sources: List[str] = Field(default_factory=list)
    api_errors: dict = Field(default_factory=dict)


class SentimentData(BaseModel):
    positive_ratio: float = 0.0
    negative_ratio: float = 0.0
    neutral_ratio: float = 0.0
    positive_keywords: List[dict] = Field(default_factory=list)
    negative_keywords: List[dict] = Field(default_factory=list)
    emotion_keywords: List[dict] = Field(default_factory=list)


class KeywordResponse(BaseModel):
    id: str
    user_id: int
    keyword: str
    platform_data: Optional[PlatformData] = None
    sentiment_data: Optional[SentimentData] = None
    hashtags: List[str] = Field(default_factory=list)
    last_analyzed_at: Optional[str] = None
    created_at: str

    class Config:
        from_attributes = True


class CompareRequest(BaseModel):
    keyword_ids: List[str] = Field(..., min_length=1, max_length=10)


class CompareResponse(BaseModel):
    keywords: List[KeywordResponse]
    comparison_summary: str = ""


# --- Helper ---

def _serialize_keyword(kw: MarketKeyword) -> KeywordResponse:
    platform_data = None
    if kw.platform_data:
        try:
            platform_data = PlatformData(**json.loads(kw.platform_data))
        except Exception:
            platform_data = None

    sentiment_data = None
    if kw.sentiment_data:
        try:
            sentiment_data = SentimentData(**json.loads(kw.sentiment_data))
        except Exception:
            sentiment_data = None

    hashtags = []
    if kw.hashtags:
        try:
            hashtags = json.loads(kw.hashtags)
        except Exception:
            hashtags = []

    return KeywordResponse(
        id=kw.id,
        user_id=kw.user_id,
        keyword=kw.keyword,
        platform_data=platform_data,
        sentiment_data=sentiment_data,
        hashtags=hashtags,
        last_analyzed_at=kw.last_analyzed_at.isoformat() if kw.last_analyzed_at else None,
        created_at=kw.created_at.isoformat() if kw.created_at else "",
    )


# --- Endpoints ---

@router.post("/keywords", response_model=KeywordResponse, status_code=status.HTTP_201_CREATED)
async def register_keyword(
    body: KeywordCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Register a new keyword for monitoring."""
    # Check for duplicate
    result = await db.execute(
        select(MarketKeyword).where(
            MarketKeyword.user_id == current_user.id,
            MarketKeyword.keyword == body.keyword.strip(),
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"키워드 '{body.keyword}'가 이미 등록되어 있습니다.",
        )

    try:
        kw = MarketKeyword(
            id=str(uuid4()),
            user_id=current_user.id,
            keyword=body.keyword.strip(),
            created_at=datetime.utcnow(),
        )
        db.add(kw)
        await db.commit()
        await db.refresh(kw)
        return _serialize_keyword(kw)
    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to register keyword '{body.keyword}': {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"키워드 등록 중 오류가 발생했습니다: {str(e)}",
        )


@router.get("/keywords", response_model=List[KeywordResponse])
async def list_keywords(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all registered keywords for the current user."""
    result = await db.execute(
        select(MarketKeyword)
        .where(MarketKeyword.user_id == current_user.id)
        .order_by(MarketKeyword.created_at.desc())
    )
    keywords = result.scalars().all()
    return [_serialize_keyword(kw) for kw in keywords]


@router.delete("/keywords/{keyword_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_keyword(
    keyword_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove a registered keyword."""
    result = await db.execute(
        select(MarketKeyword).where(
            MarketKeyword.id == keyword_id,
            MarketKeyword.user_id == current_user.id,
        )
    )
    kw = result.scalar_one_or_none()
    if not kw:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="키워드를 찾을 수 없습니다.")

    await db.execute(
        delete(MarketKeyword).where(MarketKeyword.id == keyword_id)
    )
    await db.commit()


@router.post("/keywords/{keyword_id}/analyze", response_model=KeywordResponse)
async def analyze_keyword(
    keyword_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Trigger AI analysis for a keyword - generates realistic market data."""
    result = await db.execute(
        select(MarketKeyword).where(
            MarketKeyword.id == keyword_id,
            MarketKeyword.user_id == current_user.id,
        )
    )
    kw = result.scalar_one_or_none()
    if not kw:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="키워드를 찾을 수 없습니다.")

    try:
        # ── Step 1: Fetch REAL data from APIs (no fake data) ──
        market_svc = MarketDataService()
        real_data = await market_svc.fetch_all(kw.keyword)
        api_sources = real_data.get("api_sources", [])
        logger.info(f"Keyword '{kw.keyword}' real API sources: {api_sources}")

        # Build platform_data from REAL API data only
        platform_data: dict = {
            "api_sources": api_sources,
            "api_errors": {},
            "daily_trends": [],
            "monthly_trends": [],
        }

        # YouTube: real data only
        if real_data["youtube"]:
            platform_data["youtube"] = real_data["youtube"]
        else:
            if market_svc.has_youtube:
                platform_data["api_errors"]["youtube"] = "YouTube API 호출에 실패했습니다. 잠시 후 다시 시도해주세요."
            else:
                platform_data["api_errors"]["youtube"] = "YouTube API 키가 설정되지 않았습니다."

        # Instagram: real data only
        if real_data["instagram"]:
            platform_data["instagram"] = real_data["instagram"]
        else:
            if market_svc.has_instagram:
                platform_data["api_errors"]["instagram"] = "Instagram API 호출에 실패했습니다."
            else:
                platform_data["api_errors"]["instagram"] = "Instagram API 토큰이 설정되지 않았습니다."

        # Naver: real data only
        if real_data["naver"]:
            nv = real_data["naver"]
            platform_data["naver"] = {
                "blog_post_count": nv["blog_post_count"],
                "search_query_volume": nv["search_query_volume"],
            }
            # Build daily_trends from Naver DataLab data
            if nv.get("daily_trend"):
                for dp in nv["daily_trend"]:
                    platform_data["daily_trends"].append({
                        "date": dp["date"],
                        "naver_searches": int(dp["ratio"] * 100),
                    })
        else:
            if market_svc.has_naver:
                platform_data["api_errors"]["naver"] = "Naver API 호출에 실패했습니다."
            else:
                platform_data["api_errors"]["naver"] = "Naver API 키가 설정되지 않았습니다."

        # ── Step 2: AI for sentiment analysis + hashtags ONLY ──
        sentiment_data = {}
        hashtags = []
        try:
            claude = ClaudeService()
            prompt = f"""당신은 소셜 미디어 마켓 분석 전문가입니다. "{kw.keyword}" 키워드에 대해 감성 분석과 관련 해시태그를 생성해주세요.

다음 JSON 형식으로 정확하게 응답해주세요 (JSON만 반환, 다른 텍스트 없이):
{{
    "sentiment_data": {{
        "positive_ratio": <float: 0.0~1.0>,
        "negative_ratio": <float: 0.0~1.0>,
        "neutral_ratio": <float: 0.0~1.0>,
        "positive_keywords": [
            {{"keyword": "<한국어 긍정 키워드>", "count": <int>}},
            {{"keyword": "<한국어 긍정 키워드>", "count": <int>}},
            {{"keyword": "<한국어 긍정 키워드>", "count": <int>}},
            {{"keyword": "<한국어 긍정 키워드>", "count": <int>}},
            {{"keyword": "<한국어 긍정 키워드>", "count": <int>}}
        ],
        "negative_keywords": [
            {{"keyword": "<한국어 부정 키워드>", "count": <int>}},
            {{"keyword": "<한국어 부정 키워드>", "count": <int>}},
            {{"keyword": "<한국어 부정 키워드>", "count": <int>}}
        ],
        "emotion_keywords": [
            {{"keyword": "<감정 키워드>", "count": <int>, "emotion": "<기쁨/슬픔/분노/놀라움/기대 중 하나>"}},
            {{"keyword": "<감정 키워드>", "count": <int>, "emotion": "<기쁨/슬픔/분노/놀라움/기대 중 하나>"}},
            {{"keyword": "<감정 키워드>", "count": <int>, "emotion": "<기쁨/슬픔/분노/놀라움/기대 중 하나>"}},
            {{"keyword": "<감정 키워드>", "count": <int>, "emotion": "<기쁨/슬픔/분노/놀라움/기대 중 하나>"}}
        ]
    }},
    "hashtags": [
        "#관련해시태그1", "#관련해시태그2", "#관련해시태그3", "#관련해시태그4",
        "#관련해시태그5", "#관련해시태그6", "#관련해시태그7", "#관련해시태그8",
        "#관련해시태그9", "#관련해시태그10"
    ]
}}

"{kw.keyword}" 키워드와 관련된 현실적이고 구체적인 한국 시장 감성 분석을 생성하세요. 해시태그는 실제로 사용될 법한 한국어/영어 태그로 작성하세요."""

            response = claude.client.messages.create(
                model=claude.model,
                max_tokens=2000,
                messages=[{"role": "user", "content": prompt}],
            )

            content = response.content[0].text
            start = content.find("{")
            end = content.rfind("}") + 1
            if start >= 0 and end > start:
                analysis = json.loads(content[start:end])
                sentiment_data = analysis.get("sentiment_data", {})
                hashtags = analysis.get("hashtags", [])
        except Exception as e:
            logger.warning(f"AI sentiment analysis failed for '{kw.keyword}': {e}")

        # ── Step 3: Save to DB ──
        kw.platform_data = json.dumps(platform_data, ensure_ascii=False)
        kw.sentiment_data = json.dumps(sentiment_data, ensure_ascii=False)
        kw.hashtags = json.dumps(hashtags, ensure_ascii=False)
        kw.last_analyzed_at = datetime.utcnow()

        await db.commit()
        await db.refresh(kw)

        return _serialize_keyword(kw)

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse AI response for keyword '{kw.keyword}': {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="AI 분석 결과를 파싱하는 데 실패했습니다. 다시 시도해주세요.",
        )
    except Exception as e:
        logger.error(f"Analysis failed for keyword '{kw.keyword}': {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"키워드 분석 중 오류가 발생했습니다: {str(e)}",
        )


@router.post("/keywords/compare", response_model=CompareResponse)
async def compare_keywords(
    body: CompareRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Compare multiple keywords side-by-side."""
    result = await db.execute(
        select(MarketKeyword).where(
            MarketKeyword.id.in_(body.keyword_ids),
            MarketKeyword.user_id == current_user.id,
        )
    )
    keywords = result.scalars().all()

    if not keywords:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="선택한 키워드를 찾을 수 없습니다.",
        )

    serialized = [_serialize_keyword(kw) for kw in keywords]

    # Generate comparison summary using AI
    comparison_summary = ""
    analyzed_keywords = [kw for kw in keywords if kw.platform_data]
    if len(analyzed_keywords) >= 2:
        try:
            claude = ClaudeService()
            keyword_summaries = []
            for kw in analyzed_keywords:
                pd = json.loads(kw.platform_data) if kw.platform_data else {}
                yt = pd.get("youtube", {})
                ig = pd.get("instagram", {})
                nv = pd.get("naver", {})
                keyword_summaries.append(
                    f"- {kw.keyword}: YouTube 조회수 {yt.get('total_views', 0):,}, "
                    f"Instagram 조회수 {ig.get('total_views', 0):,}, "
                    f"네이버 검색량 {nv.get('search_query_volume', 0):,}"
                )

            prompt = f"""다음 키워드들의 시장 데이터를 비교 분석해주세요:

{chr(10).join(keyword_summaries)}

3-4문장으로 핵심 비교 인사이트를 한국어로 작성해주세요. 어떤 키워드가 더 인기 있는지, 어떤 플랫폼에서 강세인지 등을 분석해주세요."""

            response = claude.client.messages.create(
                model=claude.model,
                max_tokens=500,
                messages=[{"role": "user", "content": prompt}],
            )
            comparison_summary = response.content[0].text.strip()
        except Exception as e:
            logger.warning(f"Comparison summary generation failed: {e}")
            comparison_summary = "비교 요약을 생성하는 데 실패했습니다."

    return CompareResponse(keywords=serialized, comparison_summary=comparison_summary)
