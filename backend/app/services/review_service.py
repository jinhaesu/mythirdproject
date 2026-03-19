"""네이버 쇼핑 리뷰 수집 + AI 분석 서비스.

brand.naver.com / smartstore.naver.com 제품 페이지에서 리뷰를 수집한다.
제품 페이지 HTML에서 merchantNo를 추출 → 리뷰 API 호출.
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
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/html, */*",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
}


def extract_product_id(url: str) -> Optional[str]:
    """네이버 쇼핑 URL에서 제품 ID를 추출한다."""
    m = re.search(r'/products?/(\d+)', url)
    if m:
        return m.group(1)
    m = re.search(r'nid=(\d+)', url)
    if m:
        return m.group(1)
    m = re.search(r'(\d{8,})', url)
    if m:
        return m.group(1)
    return None


def extract_channel_uid(url: str) -> Optional[str]:
    """URL에서 스토어 채널 UID(슬러그)를 추출한다.

    예: https://brand.naver.com/nuldam/products/... → "nuldam"
        https://smartstore.naver.com/nuldam/products/... → "nuldam"
    """
    m = re.search(r'(?:brand|smartstore)\.naver\.com/([^/]+)/products?/', url)
    if m:
        return m.group(1)
    return None


async def _get_merchant_no(client: httpx.AsyncClient, product_url: str, channel_uid: str) -> Optional[str]:
    """제품 페이지에서 merchantNo를 추출한다."""
    try:
        resp = await client.get(product_url, headers=HEADERS, follow_redirects=True)
        if resp.status_code != 200:
            logger.warning(f"[Review] Product page returned {resp.status_code}")
            return None
        html = resp.text

        # __NEXT_DATA__ JSON에서 merchantNo 추출
        m = re.search(r'"merchantNo"\s*:\s*"(\d+)"', html)
        if m:
            return m.group(1)
        # window.__PRELOADED_STATE__ 에서 추출
        m = re.search(r'"channelNo"\s*:\s*(\d+)', html)
        if m:
            return m.group(1)
        # channel API로 조회
        channel_resp = await client.get(
            f"https://brand.naver.com/n/v2/shoppingMall/channel?channelUid={channel_uid}",
            headers=HEADERS,
        )
        if channel_resp.status_code == 200:
            ch_data = channel_resp.json()
            return str(ch_data.get("channelNo") or ch_data.get("merchantNo", ""))
    except Exception as e:
        logger.warning(f"[Review] merchantNo extraction failed: {e}")
    return None


async def fetch_naver_product_reviews(
    product_url: str,
    max_pages: int = 5,
    page_size: int = 20,
) -> Dict[str, Any]:
    """네이버 브랜드스토어/스마트스토어 리뷰를 가져온다."""
    product_id = extract_product_id(product_url)
    channel_uid = extract_channel_uid(product_url)

    if not product_id:
        return {"reviews": [], "total": 0, "error": "제품 ID를 추출할 수 없습니다."}

    reviews: List[Dict] = []
    total = 0
    error_msg = None

    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        merchant_no = None
        if channel_uid:
            merchant_no = await _get_merchant_no(client, product_url, channel_uid)
            logger.info(f"[Review] channel={channel_uid}, merchantNo={merchant_no}, productId={product_id}")

        # ── 방법 1: 브랜드스토어/스마트스토어 리뷰 API (merchantNo 필요) ──
        if merchant_no:
            for page in range(1, max_pages + 1):
                try:
                    api_url = (
                        f"https://smartstore.naver.com/i/v1/reviews/paged-reviews"
                        f"?page={page}&pageSize={page_size}"
                        f"&merchantNo={merchant_no}"
                        f"&originProductNo={product_id}"
                        f"&sortType=REVIEW_CREATE_DATE_DESC"
                    )
                    resp = await client.get(api_url, headers={**HEADERS, "Referer": product_url})

                    if resp.status_code == 200:
                        data = resp.json()
                        contents = data.get("contents", [])
                        if page == 1:
                            total = data.get("totalElements", 0)
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
                    else:
                        logger.warning(f"[Review] API page {page} returned {resp.status_code}: {resp.text[:200]}")
                        break
                except Exception as e:
                    logger.warning(f"[Review] API page {page} error: {e}")
                    break

        # ── 방법 2: merchantNo 없이 originProductNo만으로 시도 ──
        if not reviews:
            for page in range(1, max_pages + 1):
                try:
                    api_url = (
                        f"https://smartstore.naver.com/i/v1/reviews/paged-reviews"
                        f"?page={page}&pageSize={page_size}"
                        f"&originProductNo={product_id}"
                        f"&sortType=REVIEW_CREATE_DATE_DESC"
                    )
                    resp = await client.get(api_url, headers={**HEADERS, "Referer": product_url})
                    if resp.status_code == 200:
                        data = resp.json()
                        contents = data.get("contents", [])
                        if page == 1:
                            total = data.get("totalElements", 0)
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
                    else:
                        break
                except Exception:
                    break

        # ── 방법 3: 네이버 쇼핑 통합 리뷰 API ──
        if not reviews:
            try:
                shop_url = f"https://search.shopping.naver.com/api/review?nvMid={product_id}&reviewType=ALL&page=1&pageSize=100&sortType=QUALITY"
                resp = await client.get(shop_url, headers=HEADERS)
                if resp.status_code == 200:
                    data = resp.json()
                    total = data.get("totalCount", 0)
                    for item in data.get("reviews", []):
                        reviews.append({
                            "id": str(item.get("reviewNo", "")),
                            "rating": item.get("starScore", 0),
                            "content": item.get("reviewContent", item.get("body", "")),
                            "date": item.get("registerDate", item.get("createDate", "")),
                            "product_option": item.get("productOptionContent", ""),
                            "writer": item.get("writerNickname", item.get("userId", "익명")),
                        })
            except Exception as e:
                error_msg = f"모든 리뷰 API 호출 실패: {e}"

        if not reviews and not error_msg:
            error_msg = f"리뷰를 가져올 수 없습니다 (merchantNo={merchant_no}, productId={product_id}). URL 형식을 확인해주세요."

    logger.info(f"[Review] Final: {len(reviews)} reviews, total={total}")
    return {
        "reviews": reviews,
        "total": total or len(reviews),
        "product_id": product_id,
        "merchant_no": merchant_no,
        "error": error_msg,
    }


def analyze_reviews(
    reviews: List[Dict],
    star_threshold: int = 3,
) -> Dict[str, Any]:
    """리뷰 통계 분석 (별점 분포, 기간별 저별점 수 등)."""
    now = datetime.utcnow()

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

        # 날짜 파싱 (다양한 포맷 대응)
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
        "low_reviews_sample": all_low_reviews[:20],
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


def build_review_report_html(
    products_data: List[Dict[str, Any]],
    check_time: str,
) -> str:
    """전체 제품 리뷰 리포트 이메일 HTML을 생성한다."""
    product_sections = ""
    for pd in products_data:
        name = pd.get("product_name", "")
        stats = pd.get("stats", {})
        ai = pd.get("ai_analysis", "")
        avg = stats.get("average_rating", 0)
        total = stats.get("total_reviews", 0)
        dist = stats.get("star_distribution", {})
        low_7 = stats.get("low_star_count_7d", 0)
        low_14 = stats.get("low_star_count_14d", 0)
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
