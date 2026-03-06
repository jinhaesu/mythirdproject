"""Market Intelligence / Benchmark endpoints (TAB 1)."""
from typing import List, Optional
import json
import re

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.database import get_db
from app.models.user import User
from app.models.benchmark import Benchmark, CollectedPost, BenchmarkType
from app.schemas.benchmark import (
    BenchmarkQuery, BenchmarkResponse, CollectedPostResponse,
    AISummaryResponse, SentimentAnalysis,
    StyleExtractionRequest, StyleExtractionResponse, StyleExtraction,
    MarketIntelligenceReport, ContentTrend, HashtagGroup, ContentPillar,
)
from app.api.v1.endpoints.auth import get_current_user
from app.services.meta import MetaGraphAPI
from app.services.ai import ClaudeService, VisionService

router = APIRouter()


def determine_benchmark_type(query: str) -> BenchmarkType:
    """Determine benchmark type from query."""
    if query.startswith("@"):
        return BenchmarkType.COMPETITOR_ACCOUNT
    elif query.startswith("#"):
        return BenchmarkType.HASHTAG_RESEARCH
    elif query.startswith("http"):
        return BenchmarkType.URL_ANALYSIS
    else:
        return BenchmarkType.HASHTAG_RESEARCH


async def _generate_ai_market_report(query: str) -> dict:
    """Generate an AI-powered market intelligence report instead of fake posts."""
    claude = ClaudeService()
    prompt = f"""'{query}' 키워드에 대한 Instagram/Facebook 시장 분석 리포트를 생성해주세요.

실제 마케팅 전문가처럼 분석해주세요. JSON 형식으로 응답:
{{
    "market_overview": "이 시장/키워드에 대한 전반적인 분석 (3-5문장)",
    "content_trends": [
        {{
            "topic": "트렌드 주제",
            "description": "구체적 설명",
            "engagement_level": "high/medium/low",
            "examples": ["콘텐츠 예시1", "콘텐츠 예시2"]
        }}
    ],
    "hashtag_groups": [
        {{
            "theme": "해시태그 그룹 테마",
            "hashtags": ["#태그1", "#태그2", "#태그3"],
            "avg_engagement": 3.5,
            "recommendation": "사용 추천 이유"
        }}
    ],
    "content_pillars": [
        {{
            "pillar_name": "콘텐츠 축 이름",
            "description": "설명",
            "content_ratio": 30,
            "example_topics": ["예시 주제1", "예시 주제2"]
        }}
    ],
    "competitor_insights": [
        "경쟁사/시장 인사이트1",
        "경쟁사/시장 인사이트2"
    ],
    "recommendations": [
        "실행 가능한 추천 전략1",
        "실행 가능한 추천 전략2"
    ],
    "estimated_posts": [
        {{
            "caption": "트렌드를 반영한 예시 캡션 (해시태그 포함, 한국어)",
            "media_type": "IMAGE",
            "like_count": 현실적인 좋아요 수,
            "comments_count": 현실적인 댓글 수,
            "engagement_rate": 현실적인 참여율,
            "content_theme": "콘텐츠 주제"
        }}
    ]
}}

'{query}' 관련 실제 트렌드와 시장 상황을 반영해주세요.
estimated_posts는 5-8개 정도 다양하게 생성해주세요.
JSON만 출력하세요."""

    try:
        result = claude.client.messages.create(
            model=claude.model,
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )
        text = result.content[0].text.strip()
        if text.startswith("{"):
            return json.loads(text)
        match = re.search(r'\{[\s\S]*\}', text)
        if match:
            return json.loads(match.group())
    except Exception:
        pass

    return {
        "market_overview": f"'{query}' 관련 시장 분석 데이터를 생성하지 못했습니다.",
        "content_trends": [],
        "hashtag_groups": [],
        "content_pillars": [],
        "competitor_insights": [],
        "recommendations": [],
        "estimated_posts": [],
    }


@router.post("/search", response_model=BenchmarkResponse)
async def search_benchmark(
    query: BenchmarkQuery,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Search and analyze competitor/keyword content.

    - Meta 연동 유저: Business Discovery API로 실제 데이터
    - 미연동 유저: AI 시장 분석 리포트 생성 (가짜 이미지 없음)
    """
    benchmark_type = determine_benchmark_type(query.query)

    benchmark = Benchmark(
        user_id=current_user.id,
        benchmark_type=benchmark_type,
        query=query.query
    )
    db.add(benchmark)
    await db.commit()
    await db.refresh(benchmark)

    posts_data = []
    data_source = "ai"
    ai_report = None

    # Meta API로 데이터 수집 시도
    if current_user.meta_access_token and current_user.meta_ig_account_id:
        meta_api = MetaGraphAPI(current_user.meta_access_token)
        try:
            if benchmark_type == BenchmarkType.COMPETITOR_ACCOUNT:
                username = query.query.lstrip("@")
                ig_account_id = current_user.meta_ig_account_id
                result = await meta_api.business_discovery(ig_account_id, username)
                media = result.get("business_discovery", {}).get("media", {}).get("data", [])
                posts_data = media
                data_source = "meta_api"

            elif benchmark_type == BenchmarkType.HASHTAG_RESEARCH:
                hashtag = query.query.lstrip("#")
                ig_account_id = current_user.meta_ig_account_id
                hashtag_result = await meta_api.search_hashtag(ig_account_id, hashtag)
                if hashtag_result.get("data"):
                    hashtag_id = hashtag_result["data"][0]["id"]
                    media_result = await meta_api.get_hashtag_recent_media(
                        ig_account_id, hashtag_id, limit=query.limit
                    )
                    posts_data = media_result.get("data", [])
                    data_source = "meta_api"
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Meta API failed for '{query.query}': {e}")
            posts_data = []

    # Meta API 데이터가 없으면 AI 리포트 생성
    if not posts_data:
        data_source = "ai"
        report_data = await _generate_ai_market_report(query.query)

        ai_report = MarketIntelligenceReport(
            market_overview=report_data.get("market_overview", ""),
            content_trends=[
                ContentTrend(**t) for t in report_data.get("content_trends", [])
            ],
            hashtag_groups=[
                HashtagGroup(**h) for h in report_data.get("hashtag_groups", [])
            ],
            content_pillars=[
                ContentPillar(**p) for p in report_data.get("content_pillars", [])
            ],
            competitor_insights=report_data.get("competitor_insights", []),
            recommendations=report_data.get("recommendations", []),
        )

        # Use estimated_posts for display
        posts_data = report_data.get("estimated_posts", [])

    # Save collected posts
    collected_posts = []
    for i, post in enumerate(posts_data[:query.limit]):
        likes = post.get("like_count", 0)
        comments = post.get("comments_count", 0)
        shares = post.get("shares_count", 0)
        reach = post.get("estimated_reach", (likes + comments) * 10)

        # Never use picsum.photos — use actual media_url or null
        media_url = post.get("media_url") if data_source == "meta_api" else None

        collected = CollectedPost(
            benchmark_id=benchmark.id,
            post_id=post.get("id", f"ai_{benchmark.id}_{i}"),
            post_url=post.get("permalink"),
            media_url=media_url,
            media_type=post.get("media_type", "IMAGE"),
            caption=post.get("caption", ""),
            likes=likes,
            comments=comments,
            shares=shares,
            estimated_reach=reach,
        )
        db.add(collected)
        collected_posts.append(collected)

    benchmark.total_posts_analyzed = len(collected_posts)

    # Calculate average engagement
    if collected_posts:
        if data_source == "ai":
            eng_rates = [p.get("engagement_rate", 0) for p in posts_data[:query.limit]]
            benchmark.avg_engagement_rate = sum(eng_rates) / len(eng_rates) if eng_rates else 0
        else:
            total_engagement = sum(p.likes + p.comments for p in collected_posts)
            benchmark.avg_engagement_rate = total_engagement / len(collected_posts)

    await db.commit()

    # Build response
    posts_response = []
    for j, p in enumerate(collected_posts):
        eng_rate = posts_data[j].get("engagement_rate", 0.0) if data_source == "ai" and j < len(posts_data) else 0.0
        posts_response.append(
            CollectedPostResponse(
                id=p.id,
                post_id=p.post_id,
                post_url=p.post_url,
                media_url=p.media_url,
                media_type=p.media_type,
                caption=p.caption,
                hashtags=[],
                metrics={
                    "likes": p.likes,
                    "comments": p.comments,
                    "shares": p.shares,
                    "estimated_reach": p.estimated_reach,
                    "engagement_rate": eng_rate,
                },
                posted_at=p.posted_at
            )
        )

    return BenchmarkResponse(
        id=benchmark.id,
        query=benchmark.query,
        benchmark_type=benchmark.benchmark_type.value,
        total_posts_analyzed=benchmark.total_posts_analyzed,
        avg_engagement_rate=benchmark.avg_engagement_rate,
        posts=posts_response,
        data_source=data_source,
        ai_report=ai_report,
        created_at=benchmark.created_at
    )


@router.post("/{benchmark_id}/ai-summary", response_model=AISummaryResponse)
async def generate_ai_summary(
    benchmark_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Generate AI summary analysis for benchmark."""
    result = await db.execute(
        select(Benchmark)
        .where(Benchmark.id == benchmark_id, Benchmark.user_id == current_user.id)
    )
    benchmark = result.scalar_one_or_none()

    if not benchmark:
        raise HTTPException(status_code=404, detail="Benchmark not found")

    posts_result = await db.execute(
        select(CollectedPost).where(CollectedPost.benchmark_id == benchmark_id)
    )
    posts = posts_result.scalars().all()

    posts_data = [
        {
            "caption": p.caption,
            "likes": p.likes,
            "comments": p.comments,
            "media_type": p.media_type
        }
        for p in posts
    ]

    claude = ClaudeService()
    analysis = await claude.analyze_content_trends(posts_data, benchmark.query)

    benchmark.analysis_summary = json.dumps(analysis, ensure_ascii=False)
    await db.commit()

    return AISummaryResponse(
        summary=analysis.get("summary", ""),
        key_insights=analysis.get("key_insights", []),
        recommendations=analysis.get("recommendations", []),
        trending_topics=analysis.get("trending_topics", [])
    )


@router.post("/{benchmark_id}/sentiment", response_model=SentimentAnalysis)
async def analyze_sentiment(
    benchmark_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Analyze sentiment from comments."""
    result = await db.execute(
        select(Benchmark)
        .where(Benchmark.id == benchmark_id, Benchmark.user_id == current_user.id)
    )
    benchmark = result.scalar_one_or_none()

    if not benchmark:
        raise HTTPException(status_code=404, detail="Benchmark not found")

    posts_result = await db.execute(
        select(CollectedPost).where(CollectedPost.benchmark_id == benchmark_id)
    )
    posts = posts_result.scalars().all()

    texts = [p.caption for p in posts if p.caption]

    claude = ClaudeService()
    sentiment = await claude.analyze_sentiment(texts)

    benchmark.sentiment_analysis = json.dumps(sentiment, ensure_ascii=False)
    await db.commit()

    return SentimentAnalysis(
        overall_sentiment=sentiment.get("overall_sentiment", "neutral"),
        positive_keywords=sentiment.get("positive_keywords", []),
        negative_keywords=sentiment.get("negative_keywords", []),
        word_cloud_data=sentiment.get("word_cloud_data", [])
    )


@router.post("/extract-style", response_model=StyleExtractionResponse)
async def extract_style(
    request: StyleExtractionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Extract style from URL (image or page)."""
    vision = VisionService()
    claude = ClaudeService()

    # Resolve the URL to get an actual image URL
    image_url = await vision.resolve_image_url(request.url)

    if not image_url:
        raise HTTPException(
            status_code=400,
            detail="이 URL에서 이미지를 찾을 수 없습니다. 직접 이미지 URL, Instagram 게시물 URL, 또는 이미지가 있는 웹페이지 URL을 입력해주세요."
        )

    try:
        visual_style = await vision.analyze_image_style(image_url)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"이미지 스타일 분석 실패: {str(e)}")

    try:
        text_extraction = await vision.extract_text_from_image(image_url)
    except Exception:
        text_extraction = {"font_style": "modern"}

    style = StyleExtraction(
        visual_style=visual_style.get("visual_style", "unknown"),
        color_palette=visual_style.get("color_palette", []),
        composition=visual_style.get("composition", "unknown"),
        text_overlay=visual_style.get("text_overlay", False),
        tone_and_manner=text_extraction.get("font_style", "modern"),
        appeal_type=visual_style.get("mood", "neutral"),
        key_elements=visual_style.get("key_visual_elements", [])
    )

    try:
        prompt_template = await vision.generate_image_prompt(
            visual_style,
            "product advertisement",
            None
        )
    except Exception:
        prompt_template = f"Create a {visual_style.get('visual_style', 'modern')} style advertisement image with {visual_style.get('mood', 'neutral')} mood."

    preview_desc = f"이 콘텐츠는 [{style.visual_style}] 스타일 + [{style.appeal_type}] 소구 패턴입니다."

    benchmark = Benchmark(
        user_id=current_user.id,
        benchmark_type=BenchmarkType.URL_ANALYSIS,
        query=request.url,
        style_extraction=json.dumps(style.model_dump(), ensure_ascii=False)
    )
    db.add(benchmark)
    await db.commit()

    return StyleExtractionResponse(
        style=style,
        prompt_template=prompt_template,
        preview_description=preview_desc
    )


@router.get("/history", response_model=List[BenchmarkResponse])
async def get_benchmark_history(
    limit: int = 20,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get user's benchmark history."""
    result = await db.execute(
        select(Benchmark)
        .where(Benchmark.user_id == current_user.id)
        .order_by(Benchmark.created_at.desc())
        .limit(limit)
    )
    benchmarks = result.scalars().all()

    responses = []
    for b in benchmarks:
        responses.append(BenchmarkResponse(
            id=b.id,
            query=b.query,
            benchmark_type=b.benchmark_type.value,
            total_posts_analyzed=b.total_posts_analyzed,
            avg_engagement_rate=b.avg_engagement_rate,
            posts=[],
            created_at=b.created_at
        ))

    return responses
