"""네이버 쇼핑 리뷰 수집 + AI 분석 서비스.

스마트스토어/브랜드스토어 리뷰를 다단계 API 전략으로 수집.
"""
import re
import json
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta

import httpx

from app.services.ai import ClaudeService

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9",
}

API_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "ko-KR,ko;q=0.9",
}


def extract_product_id(url: str) -> Optional[str]:
    """URL에서 제품 ID(originProductNo)를 추출."""
    m = re.search(r'/products?/(\d+)', url)
    if m:
        return m.group(1)
    m = re.search(r'(\d{8,})', url)
    if m:
        return m.group(1)
    return None


def extract_channel_uid(url: str) -> Optional[str]:
    """URL에서 스토어 채널 슬러그를 추출."""
    m = re.search(r'(?:brand|smartstore)\.naver\.com/([^/\?]+)', url)
    if m:
        return m.group(1)
    return None


async def _extract_merchant_no_from_page(client: httpx.AsyncClient, url: str) -> Optional[str]:
    """제품 페이지 HTML에서 merchantNo를 추출 (1회 시도)."""
    try:
        resp = await client.get(url, headers=HEADERS)
        if resp.status_code != 200:
            logger.warning(f"[Review] Page fetch returned {resp.status_code}")
            return None

        html = resp.text

        # __NEXT_DATA__에서 추출
        m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.DOTALL)
        if m:
            try:
                nd = json.loads(m.group(1))
                props = nd.get("props", {}).get("pageProps", {})
                channel = props.get("channel", {})
                merchant_no = str(channel.get("channelNo") or channel.get("merchantNo") or "")
                if merchant_no:
                    logger.info(f"[Review] Got merchantNo from __NEXT_DATA__: {merchant_no}")
                    return merchant_no
            except Exception:
                pass

        # regex fallback
        for pattern in [r'"merchantNo"\s*:\s*"?(\d+)', r'"channelNo"\s*:\s*"?(\d+)']:
            m = re.search(pattern, html)
            if m:
                logger.info(f"[Review] Got merchantNo from regex: {m.group(1)}")
                return m.group(1)

    except Exception as e:
        logger.warning(f"[Review] Page extraction error: {e}")
    return None


async def _try_review_api(
    client: httpx.AsyncClient,
    origin_product_no: str,
    merchant_no: Optional[str],
    referer: str,
    max_pages: int = 5,
    page_size: int = 20,
) -> List[Dict]:
    """스마트스토어 리뷰 API를 호출하여 리뷰 목록을 반환."""
    reviews = []
    params_base = {
        "originProductNo": origin_product_no,
        "sortType": "REVIEW_CREATE_DATE_DESC",
        "pageSize": str(page_size),
    }
    if merchant_no:
        params_base["merchantNo"] = merchant_no

    headers = {**API_HEADERS, "Referer": referer}

    for page in range(1, max_pages + 1):
        try:
            params = {**params_base, "page": str(page)}
            resp = await client.get(
                "https://smartstore.naver.com/i/v1/reviews/paged-reviews",
                params=params,
                headers=headers,
            )
            if resp.status_code == 200:
                data = resp.json()
                contents = data.get("contents", [])
                if not contents:
                    break
                for item in contents:
                    reviews.append({
                        "id": str(item.get("id", "")),
                        "rating": item.get("reviewScore", 0),
                        "content": item.get("reviewContent", ""),
                        "date": item.get("createDate", ""),
                        "product_option": item.get("productOptionContent", ""),
                        "writer": item.get("writerNickname", "익명"),
                    })
                total = data.get("totalElements", 0)
                if page == 1:
                    logger.info(f"[Review] API success: totalElements={total}")
            else:
                logger.warning(f"[Review] API page {page} returned {resp.status_code}")
                break
        except Exception as e:
            logger.warning(f"[Review] API page {page} error: {e}")
            break
    return reviews


async def _try_naver_shopping_search_reviews(
    client: httpx.AsyncClient,
    product_name: str,
    naver_client_id: str,
    naver_client_secret: str,
) -> List[Dict]:
    """네이버 쇼핑 검색 API로 제품을 찾고 리뷰 정보를 가져오는 fallback."""
    try:
        resp = await client.get(
            "https://openapi.naver.com/v1/search/shop.json",
            params={"query": product_name, "display": 5, "sort": "sim"},
            headers={
                "X-Naver-Client-Id": naver_client_id,
                "X-Naver-Client-Secret": naver_client_secret,
            },
        )
        if resp.status_code == 200:
            items = resp.json().get("items", [])
            # 검색 결과에서 기본 정보 반환 (리뷰 본문은 못 가져옴)
            reviews = []
            for item in items:
                title = re.sub(r'<[^>]+>', '', item.get("title", ""))
                reviews.append({
                    "id": item.get("productId", ""),
                    "title": title,
                    "price": item.get("lprice", ""),
                    "mall": item.get("mallName", ""),
                    "link": item.get("link", ""),
                    "source": "shopping_search",
                })
            return reviews
    except Exception as e:
        logger.warning(f"[Review] Shopping search fallback error: {e}")
    return []


async def fetch_naver_product_reviews(
    product_url: str,
    product_name: str = "",
    max_pages: int = 5,
    page_size: int = 20,
) -> Dict[str, Any]:
    """네이버 리뷰를 다단계 전략으로 수집."""
    product_id = extract_product_id(product_url)
    channel_uid = extract_channel_uid(product_url)
    errors = []

    if not product_id:
        return {"reviews": [], "total": 0, "error": "제품 ID를 URL에서 추출할 수 없습니다."}

    logger.info(f"[Review] Fetching reviews: productId={product_id}, channel={channel_uid}")

    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        # ── 전략 1: merchantNo 없이 API 호출 (일부 제품에서 동작) ──
        reviews = await _try_review_api(client, product_id, None, product_url, max_pages, page_size)
        if reviews:
            return {"reviews": reviews, "total": len(reviews), "product_id": product_id, "strategy": "no_merchant"}

        errors.append("전략1(merchantNo없이): 리뷰 없음")

        # ── 전략 2: 페이지에서 merchantNo 추출 후 재시도 ──
        merchant_no = await _extract_merchant_no_from_page(client, product_url)
        if merchant_no:
            reviews = await _try_review_api(client, product_id, merchant_no, product_url, max_pages, page_size)
            if reviews:
                return {"reviews": reviews, "total": len(reviews), "product_id": product_id, "merchant_no": merchant_no, "strategy": "with_merchant"}
            errors.append(f"전략2(merchantNo={merchant_no}): 리뷰 없음")
        else:
            errors.append("전략2: merchantNo 추출 실패 (페이지 로드 불가)")

        # ── 전략 3: smartstore.naver.com 도메인으로 시도 ──
        if channel_uid:
            alt_url = f"https://smartstore.naver.com/{channel_uid}/products/{product_id}"
            merchant_no2 = await _extract_merchant_no_from_page(client, alt_url)
            if merchant_no2 and merchant_no2 != merchant_no:
                reviews = await _try_review_api(client, product_id, merchant_no2, alt_url, max_pages, page_size)
                if reviews:
                    return {"reviews": reviews, "total": len(reviews), "product_id": product_id, "merchant_no": merchant_no2, "strategy": "smartstore_alt"}
                errors.append(f"전략3(smartstore merchantNo={merchant_no2}): 리뷰 없음")
            else:
                errors.append("전략3: smartstore 페이지에서도 merchantNo 추출 실패")

    error_detail = " | ".join(errors)
    logger.warning(f"[Review] All strategies failed for {product_id}: {error_detail}")
    return {
        "reviews": [],
        "total": 0,
        "product_id": product_id,
        "error": f"리뷰를 가져올 수 없습니다. 네이버 서버 접근 제한일 수 있습니다. ({error_detail})",
    }


def analyze_reviews(
    reviews: List[Dict],
    star_threshold: int = 3,
) -> Dict[str, Any]:
    """리뷰 통계 분석."""
    now = datetime.utcnow()
    star_dist = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
    total_rating = 0.0
    low_7d, low_14d, low_30d, all_low = [], [], [], []

    for r in reviews:
        rating = int(r.get("rating", 0))
        if 1 <= rating <= 5:
            star_dist[rating] += 1
            total_rating += rating

        date_str = r.get("date", "")
        review_date = None
        for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y.%m.%d", "%Y-%m-%d"):
            try:
                review_date = datetime.strptime(date_str[:26].rstrip("Z"), fmt)
                break
            except (ValueError, IndexError):
                continue

        if rating <= star_threshold:
            item = {"rating": rating, "content": r.get("content", ""), "date": date_str, "writer": r.get("writer", "")}
            all_low.append(item)
            if review_date:
                days_ago = (now - review_date).days
                if days_ago <= 7: low_7d.append(item)
                if days_ago <= 14: low_14d.append(item)
                if days_ago <= 30: low_30d.append(item)

    total_count = sum(star_dist.values())
    avg_rating = round(total_rating / total_count, 2) if total_count > 0 else 0

    return {
        "total_reviews": total_count,
        "average_rating": avg_rating,
        "star_distribution": star_dist,
        "star_threshold": star_threshold,
        "low_star_count_7d": len(low_7d),
        "low_star_count_14d": len(low_14d),
        "low_star_count_30d": len(low_30d),
        "low_star_total": len(all_low),
        "low_reviews_sample": all_low[:20],
    }


async def ai_review_analysis(
    product_name: str,
    stats: Dict[str, Any],
    low_reviews: List[Dict],
) -> str:
    """AI로 저별점 리뷰의 주요 이슈를 분석."""
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


def build_review_report_html(
    products_data: List[Dict[str, Any]],
    check_time: str,
) -> str:
    """전체 제품 리뷰 리포트 이메일 HTML."""
    product_sections = ""
    for pd in products_data:
        name = pd.get("product_name", "")
        stats = pd.get("stats", {})
        ai = pd.get("ai_analysis", "")
        avg = stats.get("average_rating", 0)
        total = stats.get("total_reviews", 0)
        low_7 = stats.get("low_star_count_7d", 0)
        low_30 = stats.get("low_star_count_30d", 0)
        threshold = stats.get("star_threshold", 3)
        ai_html = ai.replace("\n\n", "</p><p style='margin:6px 0;'>").replace("\n", "<br>")

        product_sections += f"""
        <tr><td style="padding:20px 24px;border-bottom:1px solid #e5e7eb;">
          <h3 style="color:#059669;margin:0 0 12px;font-size:16px;">{name}</h3>
          <table width="100%" cellspacing="0" cellpadding="0" style="font-size:13px;">
            <tr>
              <td style="padding:8px 12px;background:#f0fdf4;border-radius:8px;text-align:center;width:25%">
                <div style="font-size:22px;font-weight:bold;color:#047857">{total}</div>
                <div style="font-size:11px;color:#6b7280">전체 리뷰</div>
              </td>
              <td style="padding:8px 12px;background:#fefce8;border-radius:8px;text-align:center;width:25%">
                <div style="font-size:22px;font-weight:bold;color:#a16207">{avg}</div>
                <div style="font-size:11px;color:#6b7280">평균 별점</div>
              </td>
              <td style="padding:8px 12px;background:#fef2f2;border-radius:8px;text-align:center;width:25%">
                <div style="font-size:22px;font-weight:bold;color:#dc2626">{low_7}</div>
                <div style="font-size:11px;color:#6b7280">7일 {threshold}점↓</div>
              </td>
              <td style="padding:8px 12px;background:#fff7ed;border-radius:8px;text-align:center;width:25%">
                <div style="font-size:22px;font-weight:bold;color:#c2410c">{low_30}</div>
                <div style="font-size:11px;color:#6b7280">30일 {threshold}점↓</div>
              </td>
            </tr>
          </table>
          <div style="margin-top:14px;padding:12px 16px;background:#f0fdf4;border-left:4px solid #059669;border-radius:4px;">
            <p style="font-size:12px;color:#374151;line-height:1.7;margin:0;">{ai_html}</p>
          </div>
        </td></tr>"""

    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;">
  <tr><td style="background:linear-gradient(135deg,#065f46,#059669);padding:28px 24px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:20px;">리뷰 모니터링 리포트</h1>
    <p style="color:rgba(255,255,255,0.8);margin:6px 0 0;font-size:13px;">{check_time}</p>
  </td></tr>
  {product_sections}
  <tr><td style="padding:14px 24px;text-align:center;background:#f8fafc;border-top:1px solid #e5e7eb;">
    <p style="margin:0;color:#9ca3af;font-size:11px;">네이버 커맨더 리뷰 모니터링 | 자동 생성 리포트</p>
  </td></tr>
</table></body></html>"""
