"""네이버 쇼핑 리뷰 수집 + AI 분석 서비스."""
import re
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta

import httpx

from app.services.ai import ClaudeService

logger = logging.getLogger(__name__)


def extract_product_id(url: str) -> Optional[str]:
    """네이버 쇼핑 URL에서 제품 ID를 추출한다."""
    # https://smartstore.naver.com/store/products/12345
    m = re.search(r'/products/(\d+)', url)
    if m:
        return m.group(1)
    # https://shopping.naver.com/product/12345
    m = re.search(r'/product/(\d+)', url)
    if m:
        return m.group(1)
    # nid=12345
    m = re.search(r'nid=(\d+)', url)
    if m:
        return m.group(1)
    # 숫자만 있는 경우
    m = re.search(r'(\d{8,})', url)
    if m:
        return m.group(1)
    return None


async def fetch_naver_product_reviews(
    product_url: str,
    page: int = 1,
    page_size: int = 100,
) -> Dict[str, Any]:
    """네이버 스마트스토어 리뷰를 가져온다.

    네이버 쇼핑 리뷰 API를 활용:
    GET https://smartstore.naver.com/i/v1/reviews/paged-reviews
    """
    product_id = extract_product_id(product_url)
    if not product_id:
        return {"reviews": [], "total": 0, "error": "제품 ID를 추출할 수 없습니다."}

    reviews = []
    total = 0

    async with httpx.AsyncClient(timeout=15.0) as client:
        # 스마트스토어 리뷰 API 시도
        try:
            # 방법 1: 스마트스토어 내부 API
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": product_url,
            }

            # 상품 번호로 리뷰 조회 (스마트스토어 API)
            review_url = f"https://smartstore.naver.com/i/v1/reviews/paged-reviews?page={page}&pageSize={page_size}&merchantNo=&originProductNo={product_id}&sortType=REVIEW_RANKING"

            resp = await client.get(review_url, headers=headers)

            if resp.status_code == 200:
                data = resp.json()
                contents = data.get("contents", [])
                total = data.get("totalElements", len(contents))

                for item in contents:
                    review = {
                        "id": item.get("id", ""),
                        "rating": item.get("reviewScore", 0),
                        "content": item.get("reviewContent", ""),
                        "date": item.get("createDate", ""),
                        "product_option": item.get("productOptionContent", ""),
                        "writer": item.get("writerNickname", "익명"),
                    }
                    reviews.append(review)
                logger.info(f"[Review] Fetched {len(reviews)} reviews for product {product_id}")
            else:
                logger.warning(f"[Review] SmartStore API returned {resp.status_code}")
        except Exception as e:
            logger.warning(f"[Review] SmartStore API error: {e}")

        # 방법 2: 네이버 쇼핑 리뷰 API (fallback)
        if not reviews:
            try:
                shop_review_url = f"https://search.shopping.naver.com/api/review?nvMid={product_id}&page={page}&pageSize={page_size}&sortType=QUALITY"
                resp2 = await client.get(shop_review_url, headers=headers)
                if resp2.status_code == 200:
                    data2 = resp2.json()
                    review_list = data2.get("reviews", [])
                    total = data2.get("totalCount", len(review_list))
                    for item in review_list:
                        review = {
                            "id": str(item.get("reviewNo", "")),
                            "rating": item.get("starScore", 0),
                            "content": item.get("reviewContent", item.get("body", "")),
                            "date": item.get("registerDate", item.get("createDate", "")),
                            "product_option": item.get("productOptionContent", ""),
                            "writer": item.get("writerNickname", item.get("userId", "익명")),
                        }
                        reviews.append(review)
                    logger.info(f"[Review] Shopping API: {len(reviews)} reviews")
            except Exception as e2:
                logger.warning(f"[Review] Shopping API fallback error: {e2}")

    return {
        "reviews": reviews,
        "total": total,
        "product_id": product_id,
    }


def analyze_reviews(
    reviews: List[Dict],
    star_threshold: int = 3,
) -> Dict[str, Any]:
    """리뷰 통계 분석 (별점 분포, 기간별 저별점 수 등)."""
    now = datetime.utcnow()

    # 별점 분포
    star_dist = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
    total_rating = 0.0
    low_reviews_7d = []
    low_reviews_14d = []
    low_reviews_30d = []
    all_low_reviews = []

    for r in reviews:
        rating = int(r.get("rating", 0))
        if 1 <= rating <= 5:
            star_dist[rating] += 1
            total_rating += rating

        # 날짜 파싱
        date_str = r.get("date", "")
        review_date = None
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y.%m.%d", "%Y-%m-%d", "%Y%m%d"):
            try:
                review_date = datetime.strptime(date_str[:19], fmt)
                break
            except (ValueError, IndexError):
                continue

        # 저별점 필터
        if rating <= star_threshold:
            item = {"rating": rating, "content": r.get("content", ""), "date": date_str, "writer": r.get("writer", "")}
            all_low_reviews.append(item)
            if review_date:
                days_ago = (now - review_date).days
                if days_ago <= 7:
                    low_reviews_7d.append(item)
                if days_ago <= 14:
                    low_reviews_14d.append(item)
                if days_ago <= 30:
                    low_reviews_30d.append(item)

    total_count = sum(star_dist.values())
    avg_rating = round(total_rating / total_count, 2) if total_count > 0 else 0

    return {
        "total_reviews": total_count,
        "average_rating": avg_rating,
        "star_distribution": star_dist,
        "star_threshold": star_threshold,
        "low_star_count_7d": len(low_reviews_7d),
        "low_star_count_14d": len(low_reviews_14d),
        "low_star_count_30d": len(low_reviews_30d),
        "low_star_total": len(all_low_reviews),
        "low_reviews_sample": all_low_reviews[:20],  # 최근 20개
    }


async def ai_review_analysis(
    product_name: str,
    stats: Dict[str, Any],
    low_reviews: List[Dict],
) -> str:
    """AI로 저별점 리뷰의 주요 이슈를 분석한다."""
    review_texts = "\n".join([
        f"- [{r['rating']}점] {r['content'][:200]}"
        for r in low_reviews[:15]
    ])

    if not review_texts.strip():
        return "저별점 리뷰가 없어 분석할 내용이 없습니다. 좋은 품질을 유지하고 있습니다!"

    prompt = f"""당신은 이커머스 리뷰 분석 전문가입니다.

제품: {product_name}
전체 리뷰 수: {stats['total_reviews']}
평균 별점: {stats['average_rating']}점
{stats['star_threshold']}점 이하 리뷰: 7일내 {stats['low_star_count_7d']}건, 14일내 {stats['low_star_count_14d']}건, 30일내 {stats['low_star_count_30d']}건

[저별점 리뷰 샘플]
{review_texts}

다음을 분석해주세요:

1. **주요 불만 이슈 TOP 3**: 가장 빈번한 불만 유형과 구체적 내용
2. **긴급도 평가**: 즉시 대응이 필요한 이슈 vs 장기 개선 사항
3. **대응 전략**: 각 이슈별 구체적 개선 방안
4. **긍정 포인트**: 저별점 리뷰에서도 발견되는 긍정적 요소

한국어로 구조화하여 작성해주세요."""

    try:
        claude = ClaudeService()
        response = claude.client.messages.create(
            model=claude.model,
            max_tokens=1500,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text.strip()
    except Exception as e:
        logger.error(f"[Review] AI analysis failed: {e}")
        return f"AI 분석 중 오류가 발생했습니다: {str(e)}"
