"""Market keyword registration and monitoring endpoints."""
import json
import logging
from datetime import datetime
from typing import List, Optional
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
    youtube: PlatformMetrics = Field(default_factory=PlatformMetrics)
    instagram: PlatformMetrics = Field(default_factory=PlatformMetrics)
    naver: NaverMetrics = Field(default_factory=NaverMetrics)
    daily_trends: List[dict] = Field(default_factory=list)
    monthly_trends: List[dict] = Field(default_factory=list)


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
        # Fetch real data from available APIs
        market_svc = MarketDataService()
        real_data = await market_svc.fetch_all(kw.keyword)
        api_sources = real_data.get("api_sources", [])

        # Build context from real API data for AI to enhance
        real_data_context = ""
        if real_data["youtube"]:
            yt = real_data["youtube"]
            real_data_context += f"\n[실제 YouTube 데이터] 콘텐츠 수: {yt['content_count']}, 조회수: {yt['total_views']}, 댓글: {yt['total_comments']}"
        if real_data["naver"]:
            nv = real_data["naver"]
            real_data_context += f"\n[실제 Naver 데이터] 블로그 수: {nv['blog_post_count']}, 검색량 지수: {nv['search_query_volume']}"
        if real_data["instagram"]:
            ig = real_data["instagram"]
            real_data_context += f"\n[실제 Instagram 데이터] 해시태그 ID: {ig.get('hashtag_id', 'N/A')}"

        claude = ClaudeService()

        prompt = f"""당신은 소셜 미디어 마켓 분석 전문가입니다. "{kw.keyword}" 키워드에 대해 현실적인 시장 데이터를 생성해주세요.
{f"아래 실제 API 데이터를 참고하여 이를 기반으로 현실적인 수치를 생성하세요:{real_data_context}" if real_data_context else ""}

다음 JSON 형식으로 정확하게 응답해주세요 (JSON만 반환, 다른 텍스트 없이):
{{
    "platform_data": {{
        "youtube": {{
            "content_count": <int: 100~50000 사이의 현실적인 콘텐츠 수>,
            "total_views": <int: 10000~50000000 사이의 현실적인 조회수>,
            "total_comments": <int: 500~500000 사이의 현실적인 댓글 수>
        }},
        "instagram": {{
            "content_count": <int: 500~200000>,
            "total_views": <int: 50000~100000000>,
            "total_comments": <int: 1000~1000000>
        }},
        "naver": {{
            "blog_post_count": <int: 100~100000>,
            "search_query_volume": <int: 1000~500000>
        }},
        "daily_trends": [
            {{"date": "2026-02-20", "youtube_views": <int>, "instagram_views": <int>, "naver_searches": <int>}},
            {{"date": "2026-02-21", "youtube_views": <int>, "instagram_views": <int>, "naver_searches": <int>}},
            {{"date": "2026-02-22", "youtube_views": <int>, "instagram_views": <int>, "naver_searches": <int>}},
            {{"date": "2026-02-23", "youtube_views": <int>, "instagram_views": <int>, "naver_searches": <int>}},
            {{"date": "2026-02-24", "youtube_views": <int>, "instagram_views": <int>, "naver_searches": <int>}},
            {{"date": "2026-02-25", "youtube_views": <int>, "instagram_views": <int>, "naver_searches": <int>}},
            {{"date": "2026-02-26", "youtube_views": <int>, "instagram_views": <int>, "naver_searches": <int>}},
            {{"date": "2026-02-27", "youtube_views": <int>, "instagram_views": <int>, "naver_searches": <int>}},
            {{"date": "2026-02-28", "youtube_views": <int>, "instagram_views": <int>, "naver_searches": <int>}},
            {{"date": "2026-03-01", "youtube_views": <int>, "instagram_views": <int>, "naver_searches": <int>}},
            {{"date": "2026-03-02", "youtube_views": <int>, "instagram_views": <int>, "naver_searches": <int>}},
            {{"date": "2026-03-03", "youtube_views": <int>, "instagram_views": <int>, "naver_searches": <int>}},
            {{"date": "2026-03-04", "youtube_views": <int>, "instagram_views": <int>, "naver_searches": <int>}},
            {{"date": "2026-03-05", "youtube_views": <int>, "instagram_views": <int>, "naver_searches": <int>}}
        ],
        "monthly_trends": [
            {{"month": "2025-10", "youtube_views": <int>, "instagram_views": <int>, "naver_searches": <int>}},
            {{"month": "2025-11", "youtube_views": <int>, "instagram_views": <int>, "naver_searches": <int>}},
            {{"month": "2025-12", "youtube_views": <int>, "instagram_views": <int>, "naver_searches": <int>}},
            {{"month": "2026-01", "youtube_views": <int>, "instagram_views": <int>, "naver_searches": <int>}},
            {{"month": "2026-02", "youtube_views": <int>, "instagram_views": <int>, "naver_searches": <int>}},
            {{"month": "2026-03", "youtube_views": <int>, "instagram_views": <int>, "naver_searches": <int>}}
        ]
    }},
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

"{kw.keyword}" 키워드와 관련된 현실적이고 구체적인 한국 시장 데이터를 생성하세요. 트렌드에는 자연스러운 변동이 있어야 합니다. 해시태그는 실제로 사용될 법한 한국어/영어 태그로 작성하세요."""

        response = claude.client.messages.create(
            model=claude.model,
            max_tokens=4000,
            messages=[{"role": "user", "content": prompt}],
        )

        content = response.content[0].text
        start = content.find("{")
        end = content.rfind("}") + 1
        if start < 0 or end <= start:
            raise ValueError("AI response did not contain valid JSON")

        analysis = json.loads(content[start:end])

        # Override AI-generated platform stats with real API data
        platform_data = analysis.get("platform_data", {})
        if real_data["youtube"]:
            platform_data["youtube"] = real_data["youtube"]
        if real_data["naver"]:
            nv = real_data["naver"]
            platform_data["naver"] = {
                "blog_post_count": nv["blog_post_count"],
                "search_query_volume": nv["search_query_volume"],
            }
            # If Naver daily_trend is available, merge into daily_trends
            if nv.get("daily_trend"):
                ai_trends = platform_data.get("daily_trends", [])
                naver_map = {d["date"]: d["ratio"] for d in nv["daily_trend"]}
                for trend in ai_trends:
                    if trend["date"] in naver_map:
                        trend["naver_searches"] = int(naver_map[trend["date"]] * nv["blog_post_count"] / 100)
        platform_data["api_sources"] = api_sources

        # Save to DB
        kw.platform_data = json.dumps(platform_data, ensure_ascii=False)
        kw.sentiment_data = json.dumps(analysis.get("sentiment_data", {}), ensure_ascii=False)
        kw.hashtags = json.dumps(analysis.get("hashtags", []), ensure_ascii=False)
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
