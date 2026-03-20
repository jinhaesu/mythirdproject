"""네이버 커머스 API 기반 리뷰 수집 + AI 분석 서비스.

네이버 커머스 API (공식 판매자 API)를 통해 리뷰를 안정적으로 수집.
https://apicenter.commerce.naver.com
"""
import re
import json
import hmac
import hashlib
import time
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
from urllib.parse import quote

import httpx

from app.core.config import get_settings
from app.services.ai import ClaudeService

logger = logging.getLogger(__name__)

COMMERCE_API_BASE = "https://api.commerce.naver.com/external"


def _make_commerce_signature(client_id: str, client_secret: str, timestamp: str) -> str:
    """네이버 커머스 API 서명 생성 (HMAC-SHA256 + Base64)."""
    import base64
    message = f"{client_id}_{timestamp}"
    sign = hmac.new(client_secret.encode("utf-8"), message.encode("utf-8"), hashlib.sha256)
    return base64.b64encode(sign.digest()).decode("utf-8")


async def _get_commerce_token(client: httpx.AsyncClient) -> Optional[str]:
    """네이버 커머스 API OAuth 토큰 발급."""
    settings = get_settings()
    client_id = settings.NAVER_COMMERCE_CLIENT_ID
    client_secret = settings.NAVER_COMMERCE_CLIENT_SECRET

    if not client_id or not client_secret:
        logger.error("[Review] NAVER_COMMERCE_CLIENT_ID/SECRET not configured")
        return None

    timestamp = str(int(time.time() * 1000))
    signature = _make_commerce_signature(client_id, client_secret, timestamp)

    try:
        resp = await client.post(
            f"{COMMERCE_API_BASE}/v1/oauth2/token",
            data={
                "client_id": client_id,
                "timestamp": timestamp,
                "client_secret_sign": signature,
                "grant_type": "client_credentials",
                "type": "SELF",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        logger.info(f"[Review] Token response: status={resp.status_code} body={resp.text[:500]}")
        if resp.status_code == 200:
            token_data = resp.json()
            token = token_data.get("access_token")
            if token:
                logger.info("[Review] Commerce API token obtained")
                return token
            else:
                logger.error(f"[Review] Token response has no access_token: {token_data}")
                return None
        else:
            logger.error(f"[Review] Token request failed: {resp.status_code} {resp.text[:500]}")
            return None
    except Exception as e:
        logger.error(f"[Review] Token request error: {e}")
        return None


def extract_product_id(url: str) -> Optional[str]:
    """URL에서 제품 ID를 추출."""
    m = re.search(r'/products?/(\d+)', url)
    if m:
        return m.group(1)
    m = re.search(r'(\d{8,})', url)
    if m:
        return m.group(1)
    return None


async def fetch_naver_product_reviews(
    product_url: str,
    product_name: str = "",
    max_pages: int = 10,
    page_size: int = 100,
) -> Dict[str, Any]:
    """네이버 커머스 API로 리뷰를 수집한다."""
    product_id = extract_product_id(product_url)
    if not product_id:
        return {"reviews": [], "total": 0, "error": "제품 ID를 URL에서 추출할 수 없습니다."}

    settings = get_settings()
    if not settings.NAVER_COMMERCE_CLIENT_ID:
        return {"reviews": [], "total": 0, "error": "NAVER_COMMERCE_CLIENT_ID가 설정되지 않았습니다."}

    reviews: List[Dict] = []
    total = 0
    error_msg = None

    async with httpx.AsyncClient(timeout=30.0) as client:
        token = await _get_commerce_token(client)
        if not token:
            return {"reviews": [], "total": 0, "error": "네이버 커머스 API 인증 실패. 커머스 API 센터(apicenter.commerce.naver.com)에서 발급한 Client ID/Secret인지 확인해주세요."}

        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

        # 커머스 API: 상품 리뷰 조회
        # GET /v1/products/{originProductNo}/reviews
        for page in range(1, max_pages + 1):
            try:
                resp = await client.get(
                    f"{COMMERCE_API_BASE}/v1/products/{product_id}/reviews",
                    params={
                        "page": page,
                        "size": page_size,
                        "sortType": "CREATE_DATE_DESC",
                    },
                    headers=headers,
                )

                if resp.status_code == 200:
                    data = resp.json()
                    contents = data.get("contents", data.get("reviews", []))

                    if page == 1:
                        total = data.get("totalElements", data.get("totalCount", 0))
                        logger.info(f"[Review] Commerce API success: total={total} for product {product_id}")

                    if not contents:
                        break

                    for item in contents:
                        reviews.append({
                            "id": str(item.get("id", item.get("reviewNo", ""))),
                            "rating": item.get("reviewScore", item.get("score", item.get("starScore", 0))),
                            "content": item.get("reviewContent", item.get("body", item.get("content", ""))),
                            "date": item.get("createDate", item.get("createdAt", item.get("registerDate", ""))),
                            "product_option": item.get("productOptionContent", ""),
                            "writer": item.get("writerNickname", item.get("writerId", "익명")),
                        })
                elif resp.status_code == 404:
                    error_msg = f"제품 ID {product_id}에 해당하는 리뷰를 찾을 수 없습니다."
                    logger.warning(f"[Review] Product {product_id} not found (404)")
                    break
                else:
                    error_msg = f"커머스 API 오류 ({resp.status_code}): {resp.text[:200]}"
                    logger.error(f"[Review] Commerce API error: {resp.status_code} {resp.text[:300]}")
                    break
            except Exception as e:
                error_msg = f"API 호출 오류: {str(e)}"
                logger.error(f"[Review] Commerce API call error: {e}")
                break

    if not reviews and not error_msg:
        error_msg = f"제품 {product_id}의 리뷰가 없거나 접근할 수 없습니다."

    return {
        "reviews": reviews,
        "total": total or len(reviews),
        "product_id": product_id,
        "error": error_msg if not reviews else None,
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
    """AI로 저별점 리뷰 주요 이슈 분석."""
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
