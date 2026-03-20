"""네이버 리뷰 수집 서비스 — 하이브리드 방식.

1. 커머스 API로 인증 → originProductNo + channelNo(merchantNo) 확보
2. 스마트스토어 리뷰 API로 실제 리뷰 수집
"""
import re
import json
import base64
import time
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta

import httpx
import bcrypt

from app.core.config import get_settings
from app.services.ai import ClaudeService

logger = logging.getLogger(__name__)

COMMERCE_API_BASE = "https://api.commerce.naver.com/external"
SMARTSTORE_REVIEW_URL = "https://smartstore.naver.com/i/v1/reviews/paged-reviews"


# ══════════════════════════════════════════════════════════════════════════════
# Commerce API 인증
# ══════════════════════════════════════════════════════════════════════════════

async def _get_commerce_token(client: httpx.AsyncClient) -> Dict[str, Any]:
    """커머스 API OAuth 토큰 발급."""
    settings = get_settings()
    client_id = (settings.NAVER_COMMERCE_CLIENT_ID or "").strip()
    client_secret = (settings.NAVER_COMMERCE_CLIENT_SECRET or "").strip()

    if not client_id or not client_secret:
        return {"error": "NAVER_COMMERCE_CLIENT_ID/SECRET 미설정"}

    timestamp = str(int(time.time() * 1000))
    password = f"{client_id}_{timestamp}"
    hashed = bcrypt.hashpw(password.encode("utf-8"), client_secret.encode("utf-8"))
    signature = base64.b64encode(hashed).decode("utf-8")

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
        if resp.status_code == 200:
            token = resp.json().get("access_token")
            if token:
                return {"token": token}
            return {"error": "토큰 응답에 access_token 없음"}
        return {"error": f"토큰 발급 실패 ({resp.status_code}): {resp.text[:200]}"}
    except Exception as e:
        return {"error": f"토큰 요청 오류: {e}"}


async def _get_product_ids(client: httpx.AsyncClient, token: str, channel_product_no: str) -> Dict[str, Any]:
    """커머스 API로 originProductNo와 channelNo(merchantNo)를 조회."""
    headers = {"Authorization": f"Bearer {token}"}
    result = {"origin_product_no": channel_product_no, "merchant_no": None}

    # v2 channel-products로 조회
    try:
        resp = await client.get(
            f"{COMMERCE_API_BASE}/v2/products/channel-products/{channel_product_no}",
            headers=headers,
        )
        logger.info(f"[Review] channel-products: {resp.status_code} {resp.text[:500]}")
        if resp.status_code == 200:
            data = resp.json()
            # originProduct에서 상품번호 추출
            origin = data.get("originProduct", {})
            if isinstance(origin, dict):
                for k in ["productNo", "id", "originProductNo"]:
                    v = origin.get(k)
                    if v and str(v).isdigit():
                        result["origin_product_no"] = str(v)
                        break
                # 못 찾으면 첫 번째 숫자값
                if result["origin_product_no"] == channel_product_no:
                    for k, v in origin.items():
                        if v and str(v).isdigit() and len(str(v)) >= 4:
                            result["origin_product_no"] = str(v)
                            break
    except Exception as e:
        logger.warning(f"[Review] channel-products error: {e}")

    # 판매자 채널 정보로 merchantNo 조회
    for path in ["/v1/seller/channels", "/v2/seller/channels", "/v1/channels"]:
        try:
            resp2 = await client.get(f"{COMMERCE_API_BASE}{path}", headers=headers)
            logger.info(f"[Review] {path}: {resp2.status_code} {resp2.text[:300]}")
            if resp2.status_code == 200:
                ch_data = resp2.json()
                # 배열이면 첫 번째 요소
                if isinstance(ch_data, list) and ch_data:
                    ch_data = ch_data[0]
                for k in ["channelNo", "merchantNo", "channelId", "id"]:
                    v = ch_data.get(k)
                    if v and str(v).isdigit():
                        result["merchant_no"] = str(v)
                        break
                if result["merchant_no"]:
                    break
        except Exception:
            continue

    logger.info(f"[Review] Resolved: origin={result['origin_product_no']}, merchant={result['merchant_no']}")
    return result


# ══════════════════════════════════════════════════════════════════════════════
# 리뷰 수집 (스마트스토어 API)
# ══════════════════════════════════════════════════════════════════════════════

def extract_product_id(url: str) -> Optional[str]:
    m = re.search(r'/products?/(\d+)', url)
    if m:
        return m.group(1)
    m = re.search(r'(\d{8,})', url)
    if m:
        return m.group(1)
    return None


async def _fetch_reviews_smartstore(
    client: httpx.AsyncClient,
    origin_product_no: str,
    merchant_no: Optional[str],
    referer: str,
    max_pages: int = 5,
    page_size: int = 20,
) -> Dict[str, Any]:
    """스마트스토어 리뷰 API로 리뷰를 수집."""
    reviews = []
    total = 0
    errors = []

    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
        "Accept": "application/json",
        "Referer": referer,
    }

    # merchantNo가 있으면 포함, 없으면 없이 시도
    configs = []
    if merchant_no:
        configs.append({"merchantNo": merchant_no, "originProductNo": origin_product_no})
    configs.append({"originProductNo": origin_product_no})

    for params_base in configs:
        reviews = []
        for page in range(1, max_pages + 1):
            try:
                params = {**params_base, "page": str(page), "pageSize": str(page_size), "sortType": "REVIEW_CREATE_DATE_DESC"}
                resp = await client.get(SMARTSTORE_REVIEW_URL, params=params, headers=headers)

                if resp.status_code == 200:
                    data = resp.json()
                    contents = data.get("contents", [])
                    if page == 1:
                        total = data.get("totalElements", 0)
                        logger.info(f"[Review] SmartStore API success: total={total}, params={params_base}")
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
                elif resp.status_code == 429:
                    errors.append(f"SmartStore API 429 (rate limit)")
                    break
                else:
                    errors.append(f"SmartStore API {resp.status_code}")
                    break
            except Exception as e:
                errors.append(f"SmartStore error: {e}")
                break

        if reviews:
            return {"reviews": reviews, "total": total}

    return {"reviews": [], "total": 0, "errors": errors}


async def fetch_naver_product_reviews(
    product_url: str,
    product_name: str = "",
    max_pages: int = 5,
    page_size: int = 20,
) -> Dict[str, Any]:
    """하이브리드 방식: 커머스 API로 ID 확보 → 스마트스토어 API로 리뷰 수집."""
    channel_product_no = extract_product_id(product_url)
    if not channel_product_no:
        return {"reviews": [], "total": 0, "error": "URL에서 제품 ID를 추출할 수 없습니다."}

    settings = get_settings()
    debug_info = []

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        origin_no = channel_product_no
        merchant_no = None

        # Step 1: 커머스 API로 originProductNo + merchantNo 확보
        if settings.NAVER_COMMERCE_CLIENT_ID:
            token_result = await _get_commerce_token(client)
            if "token" in token_result:
                ids = await _get_product_ids(client, token_result["token"], channel_product_no)
                origin_no = ids["origin_product_no"]
                merchant_no = ids["merchant_no"]
                debug_info.append(f"origin={origin_no}")
                debug_info.append(f"merchant={merchant_no}")
            else:
                debug_info.append(f"auth-fail:{token_result.get('error', '')[:50]}")

        # Step 2: 스마트스토어 리뷰 API 호출
        result = await _fetch_reviews_smartstore(
            client, origin_no, merchant_no, product_url, max_pages, page_size,
        )

        if result["reviews"]:
            return {
                "reviews": result["reviews"],
                "total": result["total"],
                "product_id": origin_no,
            }

        # Step 3: originProductNo와 channelProductNo 모두 시도
        if origin_no != channel_product_no:
            result2 = await _fetch_reviews_smartstore(
                client, channel_product_no, merchant_no, product_url, max_pages, page_size,
            )
            if result2["reviews"]:
                return {
                    "reviews": result2["reviews"],
                    "total": result2["total"],
                    "product_id": channel_product_no,
                }
            debug_info.extend(result2.get("errors", []))

        debug_info.extend(result.get("errors", []))

    error_detail = " | ".join(debug_info) if debug_info else "리뷰 API 호출 실패"
    return {
        "reviews": [], "total": 0,
        "product_id": origin_no,
        "error": f"리뷰를 가져올 수 없습니다. ({error_detail})",
    }


# ══════════════════════════════════════════════════════════════════════════════
# 분석 + AI
# ══════════════════════════════════════════════════════════════════════════════

def analyze_reviews(reviews: List[Dict], star_threshold: int = 3) -> Dict[str, Any]:
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
        "total_reviews": total_count, "average_rating": avg_rating,
        "star_distribution": star_dist, "star_threshold": star_threshold,
        "low_star_count_7d": len(low_7d), "low_star_count_14d": len(low_14d),
        "low_star_count_30d": len(low_30d), "low_star_total": len(all_low),
        "low_reviews_sample": all_low[:20],
    }


async def ai_review_analysis(product_name: str, stats: Dict, low_reviews: List[Dict]) -> str:
    texts = "\n".join([f"- [{r['rating']}점] {r['content'][:200]}" for r in low_reviews[:15]])
    if not texts.strip():
        return "저별점 리뷰가 없어 분석할 내용이 없습니다."

    prompt = f"""이커머스 리뷰 분석 전문가로서 분석해주세요.

제품: {product_name}
전체: {stats['total_reviews']}건, 평균: {stats['average_rating']}점
{stats['star_threshold']}점 이하: 7일 {stats['low_star_count_7d']}건, 14일 {stats['low_star_count_14d']}건, 30일 {stats['low_star_count_30d']}건

[저별점 리뷰]
{texts}

분석:
1. **주요 불만 이슈 TOP 3**
2. **긴급도 평가**
3. **대응 전략**
4. **긍정 포인트**"""

    try:
        claude = ClaudeService()
        resp = claude.client.messages.create(model=claude.model, max_tokens=1500, messages=[{"role": "user", "content": prompt}])
        return resp.content[0].text.strip()
    except Exception as e:
        return f"AI 분석 오류: {e}"


def build_review_report_html(products_data: List[Dict], check_time: str) -> str:
    sections = ""
    for pd in products_data:
        n = pd.get("product_name", "")
        s = pd.get("stats", {})
        ai = pd.get("ai_analysis", "").replace("\n\n", "</p><p style='margin:6px 0;'>").replace("\n", "<br>")
        sections += f"""<tr><td style="padding:20px 24px;border-bottom:1px solid #e5e7eb;">
          <h3 style="color:#059669;margin:0 0 12px;font-size:16px;">{n}</h3>
          <table width="100%" cellspacing="0" style="font-size:13px;"><tr>
            <td style="padding:8px;background:#f0fdf4;border-radius:8px;text-align:center;width:25%"><div style="font-size:22px;font-weight:bold;color:#047857">{s.get('total_reviews',0)}</div><div style="font-size:11px;color:#6b7280">전체</div></td>
            <td style="padding:8px;background:#fefce8;border-radius:8px;text-align:center;width:25%"><div style="font-size:22px;font-weight:bold;color:#a16207">{s.get('average_rating',0)}</div><div style="font-size:11px;color:#6b7280">평균</div></td>
            <td style="padding:8px;background:#fef2f2;border-radius:8px;text-align:center;width:25%"><div style="font-size:22px;font-weight:bold;color:#dc2626">{s.get('low_star_count_7d',0)}</div><div style="font-size:11px;color:#6b7280">7일↓</div></td>
            <td style="padding:8px;background:#fff7ed;border-radius:8px;text-align:center;width:25%"><div style="font-size:22px;font-weight:bold;color:#c2410c">{s.get('low_star_count_30d',0)}</div><div style="font-size:11px;color:#6b7280">30일↓</div></td>
          </tr></table>
          <div style="margin-top:14px;padding:12px 16px;background:#f0fdf4;border-left:4px solid #059669;border-radius:4px;">
            <p style="font-size:12px;color:#374151;line-height:1.7;margin:0;">{ai}</p></div>
        </td></tr>"""

    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;">
  <tr><td style="background:linear-gradient(135deg,#065f46,#059669);padding:28px 24px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:20px;">리뷰 모니터링 리포트</h1>
    <p style="color:rgba(255,255,255,0.8);margin:6px 0 0;font-size:13px;">{check_time}</p>
  </td></tr>{sections}
  <tr><td style="padding:14px 24px;text-align:center;background:#f8fafc;border-top:1px solid #e5e7eb;">
    <p style="margin:0;color:#9ca3af;font-size:11px;">네이버 커맨더 리뷰 모니터링</p>
  </td></tr></table></body></html>"""
