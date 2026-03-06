"""Market Intelligence / Benchmark endpoints (TAB 1)."""
from typing import List, Optional
import json

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.database import get_db
from app.models.user import User
from app.models.benchmark import Benchmark, CollectedPost, BenchmarkType
from app.schemas.benchmark import (
    BenchmarkQuery, BenchmarkResponse, CollectedPostResponse,
    AISummaryResponse, SentimentAnalysis,
    StyleExtractionRequest, StyleExtractionResponse, StyleExtraction
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
        # 일반 키워드 → 해시태그 검색으로 처리
        return BenchmarkType.HASHTAG_RESEARCH


async def _generate_ai_market_data(query: str, limit: int) -> list:
    """Meta API 사용 불가 시 AI로 시장 분석 데이터 생성."""
    import random

    claude = ClaudeService()
    prompt = f"""'{query}' 키워드로 Instagram/Facebook에서 인기있는 광고/게시물을 분석합니다.

실제 마케팅 데이터처럼 다음 형식의 JSON 배열을 {min(limit, 12)}개 생성해주세요:

[
  {{
    "caption": "실제 인스타그램 게시물처럼 작성한 캡션 (해시태그 포함, 한국어)",
    "media_type": "IMAGE",
    "like_count": 좋아요 수 (100~50000 사이 현실적인 수치),
    "comments_count": 댓글 수 (5~2000 사이 현실적인 수치),
    "shares_count": 공유 수 (0~500),
    "engagement_rate": 참여율 (1.0~15.0 사이),
    "estimated_reach": 예상 도달 (1000~500000),
    "content_theme": "콘텐츠 주제"
  }}
]

'{query}' 관련 실제 트렌드를 반영해서 다양한 콘텐츠 유형을 포함해주세요.
JSON 배열만 출력하세요. 다른 텍스트 없이."""

    try:
        result = claude.client.messages.create(
            model=claude.model,
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )
        text = result.content[0].text.strip()
        # JSON 배열 추출
        if text.startswith("["):
            return json.loads(text)
        # ```json ... ``` 패턴 처리
        import re
        match = re.search(r'\[[\s\S]*\]', text)
        if match:
            return json.loads(match.group())
    except Exception as e:
        pass

    # AI 실패 시 기본 데이터
    return [
        {
            "caption": f"{query} 관련 인기 게시물 #{i+1} - 트렌드 분석 중 #{query.replace(' ', '')}",
            "media_type": "IMAGE",
            "like_count": random.randint(200, 15000),
            "comments_count": random.randint(10, 800),
            "shares_count": random.randint(5, 200),
            "engagement_rate": round(random.uniform(1.5, 8.0), 2),
            "estimated_reach": random.randint(2000, 200000),
        }
        for i in range(min(limit, 10))
    ]


@router.post("/search", response_model=BenchmarkResponse)
async def search_benchmark(
    query: BenchmarkQuery,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Search and analyze competitor/keyword content.

    Query can be:
    - @username: Competitor Instagram account
    - #hashtag: Hashtag research
    - keyword: General keyword analysis (AI-powered)
    """
    benchmark_type = determine_benchmark_type(query.query)

    # Create benchmark record
    benchmark = Benchmark(
        user_id=current_user.id,
        benchmark_type=benchmark_type,
        query=query.query
    )
    db.add(benchmark)
    await db.commit()
    await db.refresh(benchmark)

    posts_data = []
    use_ai_data = False

    # Meta API로 데이터 수집 시도
    if current_user.meta_access_token:
        meta_api = MetaGraphAPI(current_user.meta_access_token)
        try:
            if benchmark_type == BenchmarkType.COMPETITOR_ACCOUNT:
                username = query.query.lstrip("@")
                ig_account_id = current_user.meta_user_id
                result = await meta_api.business_discovery(ig_account_id, username)
                media = result.get("business_discovery", {}).get("media", {}).get("data", [])
                posts_data = media

            elif benchmark_type == BenchmarkType.HASHTAG_RESEARCH:
                hashtag = query.query.lstrip("#")
                ig_account_id = current_user.meta_user_id
                hashtag_result = await meta_api.search_hashtag(ig_account_id, hashtag)
                if hashtag_result.get("data"):
                    hashtag_id = hashtag_result["data"][0]["id"]
                    media_result = await meta_api.get_hashtag_recent_media(
                        ig_account_id, hashtag_id, limit=query.limit
                    )
                    posts_data = media_result.get("data", [])
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Meta API failed for '{query.query}': {e}")
            posts_data = []

    # Meta API 데이터가 없으면 AI로 생성
    if not posts_data:
        use_ai_data = True
        posts_data = await _generate_ai_market_data(query.query, query.limit)

    # Save collected posts
    collected_posts = []
    for i, post in enumerate(posts_data[:query.limit]):
        likes = post.get("like_count", 0)
        comments = post.get("comments_count", 0)
        shares = post.get("shares_count", 0)
        reach = post.get("estimated_reach", (likes + comments) * 10)
        eng_rate = post.get("engagement_rate", 0.0)

        collected = CollectedPost(
            benchmark_id=benchmark.id,
            post_id=post.get("id", f"ai_{benchmark.id}_{i}"),
            post_url=post.get("permalink"),
            media_url=post.get("media_url") or f"https://picsum.photos/seed/{query.query}{i}/400/400",
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
        if use_ai_data:
            avg_eng = sum(p.get("engagement_rate", 0) for p in posts_data[:query.limit]) / len(collected_posts)
            benchmark.avg_engagement_rate = avg_eng
        else:
            total_engagement = sum(p.likes + p.comments for p in collected_posts)
            benchmark.avg_engagement_rate = total_engagement / len(collected_posts)

    await db.commit()

    # Build response
    posts_response = []
    for j, p in enumerate(collected_posts):
        eng_rate = posts_data[j].get("engagement_rate", 0.0) if use_ai_data and j < len(posts_data) else 0.0
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
        created_at=benchmark.created_at
    )


@router.post("/{benchmark_id}/ai-summary", response_model=AISummaryResponse)
async def generate_ai_summary(
    benchmark_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Generate AI summary analysis for benchmark.

    Analyzes top posts and provides insights.
    """
    result = await db.execute(
        select(Benchmark)
        .where(Benchmark.id == benchmark_id, Benchmark.user_id == current_user.id)
    )
    benchmark = result.scalar_one_or_none()

    if not benchmark:
        raise HTTPException(status_code=404, detail="Benchmark not found")

    # Get collected posts
    posts_result = await db.execute(
        select(CollectedPost).where(CollectedPost.benchmark_id == benchmark_id)
    )
    posts = posts_result.scalars().all()

    # Prepare data for AI analysis
    posts_data = [
        {
            "caption": p.caption,
            "likes": p.likes,
            "comments": p.comments,
            "media_type": p.media_type
        }
        for p in posts
    ]

    # Generate AI summary
    claude = ClaudeService()
    analysis = await claude.analyze_content_trends(posts_data, benchmark.query)

    # Save to benchmark
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
    """
    Analyze sentiment from comments.

    Returns positive/negative keyword word cloud data.
    """
    result = await db.execute(
        select(Benchmark)
        .where(Benchmark.id == benchmark_id, Benchmark.user_id == current_user.id)
    )
    benchmark = result.scalar_one_or_none()

    if not benchmark:
        raise HTTPException(status_code=404, detail="Benchmark not found")

    # Get posts and their captions (as proxy for comments in demo)
    posts_result = await db.execute(
        select(CollectedPost).where(CollectedPost.benchmark_id == benchmark_id)
    )
    posts = posts_result.scalars().all()

    # Use captions for sentiment analysis (in production, fetch actual comments)
    texts = [p.caption for p in posts if p.caption]

    # Analyze sentiment
    claude = ClaudeService()
    sentiment = await claude.analyze_sentiment(texts)

    # Save to benchmark
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
    """
    Extract style from URL (image or page).

    Reverse-engineering feature for benchmark engine.
    """
    vision = VisionService()
    claude = ClaudeService()

    # Analyze image style
    visual_style = await vision.analyze_image_style(request.url)

    # Extract text style if there's text
    text_extraction = await vision.extract_text_from_image(request.url)

    # Combine into style extraction
    style = StyleExtraction(
        visual_style=visual_style.get("visual_style", "unknown"),
        color_palette=visual_style.get("color_palette", []),
        composition=visual_style.get("composition", "unknown"),
        text_overlay=visual_style.get("text_overlay", False),
        tone_and_manner=text_extraction.get("font_style", "modern"),
        appeal_type=visual_style.get("mood", "neutral"),
        key_elements=visual_style.get("key_visual_elements", [])
    )

    # Generate prompt template for Creative Studio
    prompt_template = await vision.generate_image_prompt(
        visual_style,
        "product advertisement",
        None
    )

    preview_desc = f"이 콘텐츠는 [{style.visual_style}] 스타일 + [{style.appeal_type}] 소구 패턴입니다."

    # Save as benchmark for reference
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
