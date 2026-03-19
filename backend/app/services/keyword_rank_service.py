"""키워드 순위 체크 + AI 분석 + 이메일 발송 서비스."""
import logging
import json
from typing import Dict, Any, List, Optional
from datetime import datetime

import httpx
import resend

from app.core.config import get_settings
from app.services.ai import ClaudeService

logger = logging.getLogger(__name__)
settings = get_settings()


async def check_keyword_ranks(
    keywords: List[str],
    brand_name: str = "널담",
) -> List[Dict[str, Any]]:
    """네이버 쇼핑/블로그에서 키워드별 브랜드 순위를 체크한다.

    Returns list of:
      {keyword, shopping_ranks, blog_ranks, shopping_total, blog_total}
    """
    results = []
    naver_id = settings.NAVER_CLIENT_ID
    naver_secret = settings.NAVER_CLIENT_SECRET
    if not naver_id or not naver_secret:
        logger.error("[KeywordRank] Naver API keys not configured")
        return results

    headers = {
        "X-Naver-Client-Id": naver_id,
        "X-Naver-Client-Secret": naver_secret,
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        for keyword in keywords:
            rank_data: Dict[str, Any] = {
                "keyword": keyword,
                "shopping_ranks": [],
                "blog_ranks": [],
                "shopping_total": 0,
                "blog_total": 0,
            }

            # 네이버 쇼핑 검색
            try:
                shop_resp = await client.get(
                    "https://openapi.naver.com/v1/search/shop.json",
                    params={"query": keyword, "display": 100, "sort": "sim"},
                    headers=headers,
                )
                if shop_resp.status_code == 200:
                    shop_data = shop_resp.json()
                    rank_data["shopping_total"] = shop_data.get("total", 0)
                    items = shop_data.get("items", [])
                    for idx, item in enumerate(items, 1):
                        title = item.get("title", "").replace("<b>", "").replace("</b>", "")
                        mall = item.get("mallName", "")
                        if brand_name in title or brand_name in mall:
                            rank_data["shopping_ranks"].append({
                                "rank": idx,
                                "title": title,
                                "price": item.get("lprice", ""),
                                "mall": mall,
                                "link": item.get("link", ""),
                            })
            except Exception as e:
                logger.warning(f"[KeywordRank] Naver Shopping error for '{keyword}': {e}")

            # 네이버 블로그 검색
            try:
                blog_resp = await client.get(
                    "https://openapi.naver.com/v1/search/blog.json",
                    params={"query": keyword, "display": 100, "sort": "sim"},
                    headers=headers,
                )
                if blog_resp.status_code == 200:
                    blog_data = blog_resp.json()
                    rank_data["blog_total"] = blog_data.get("total", 0)
                    items = blog_data.get("items", [])
                    import re
                    for idx, item in enumerate(items, 1):
                        title = re.sub(r'<[^>]+>', '', item.get("title", ""))
                        desc = re.sub(r'<[^>]+>', '', item.get("description", ""))
                        if brand_name in title or brand_name in desc:
                            rank_data["blog_ranks"].append({
                                "rank": idx,
                                "title": title,
                                "blogger": item.get("bloggername", ""),
                                "link": item.get("link", ""),
                                "postdate": item.get("postdate", ""),
                            })
            except Exception as e:
                logger.warning(f"[KeywordRank] Naver Blog error for '{keyword}': {e}")

            results.append(rank_data)

    return results


async def analyze_ranks_with_ai(rank_results: List[Dict[str, Any]], brand_name: str = "널담") -> str:
    """AI로 순위 분석 + 개선/유지 전략을 생성한다."""
    # 순위 데이터 요약 텍스트 생성
    summary_lines = []
    for r in rank_results:
        kw = r["keyword"]
        shop_ranks = r.get("shopping_ranks", [])
        blog_ranks = r.get("blog_ranks", [])
        shop_total = r.get("shopping_total", 0)
        blog_total = r.get("blog_total", 0)

        if shop_ranks:
            best_shop = min(shop_ranks, key=lambda x: x["rank"])
            shop_str = f"쇼핑 최고순위 {best_shop['rank']}위/{shop_total}건 ({best_shop['title']})"
        else:
            shop_str = f"쇼핑 미노출 (총 {shop_total}건 중 100위 내 없음)"

        if blog_ranks:
            best_blog = min(blog_ranks, key=lambda x: x["rank"])
            blog_str = f"블로그 최고순위 {best_blog['rank']}위/{blog_total}건 ({best_blog['title'][:30]})"
        else:
            blog_str = f"블로그 미노출 (총 {blog_total}건 중 100위 내 없음)"

        summary_lines.append(f"- [{kw}]: {shop_str} / {blog_str}")

    summary_text = "\n".join(summary_lines)

    prompt = f"""당신은 네이버 SEO 및 커머스 마케팅 전문가입니다.
다음은 '{brand_name}' 브랜드의 네이버 검색 순위 현황입니다:

{summary_text}

각 키워드별로 다음을 분석해주세요:

1. **현재 순위 평가**: 좋음/보통/위험 판정
2. **순위가 낮은 키워드**: 순위를 올리기 위한 구체적 전략 (블로그 포스팅 전략, 쇼핑 SEO 최적화, 리뷰 확보 등)
3. **순위가 높은 키워드**: 현재 순위를 유지하기 위한 방안 (경쟁사 모니터링, 콘텐츠 업데이트 주기 등)
4. **전체 요약 & 핵심 액션 아이템** 3가지

한국어로 마크다운 형식 없이 깔끔하게 정리해주세요. 이메일 본문에 들어갈 내용입니다."""

    try:
        claude = ClaudeService()
        response = claude.client.messages.create(
            model=claude.model,
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text.strip()
    except Exception as e:
        logger.error(f"[KeywordRank] AI analysis failed: {e}")
        # Fallback: 기본 분석
        lines = [f"[{brand_name} 키워드 순위 리포트]\n"]
        for r in rank_results:
            kw = r["keyword"]
            shop = r.get("shopping_ranks", [])
            blog = r.get("blog_ranks", [])
            if shop:
                lines.append(f"- {kw} 쇼핑: {shop[0]['rank']}위")
            else:
                lines.append(f"- {kw} 쇼핑: 100위 내 미노출")
            if blog:
                lines.append(f"- {kw} 블로그: {blog[0]['rank']}위")
            else:
                lines.append(f"- {kw} 블로그: 100위 내 미노출")
        return "\n".join(lines)


def build_rank_report_html(
    rank_results: List[Dict[str, Any]],
    ai_analysis: str,
    brand_name: str = "널담",
    check_time: Optional[str] = None,
) -> str:
    """키워드 순위 리포트 HTML 이메일을 생성한다."""
    if not check_time:
        check_time = datetime.utcnow().strftime("%Y-%m-%d %H:%M (UTC)")

    # 키워드별 순위 테이블 행 생성
    keyword_rows = ""
    for r in rank_results:
        kw = r["keyword"]
        shop_ranks = r.get("shopping_ranks", [])
        blog_ranks = r.get("blog_ranks", [])
        shop_total = r.get("shopping_total", 0)
        blog_total = r.get("blog_total", 0)

        if shop_ranks:
            best_shop = min(shop_ranks, key=lambda x: x["rank"])
            shop_rank = best_shop["rank"]
            shop_color = "#22c55e" if shop_rank <= 10 else "#f59e0b" if shop_rank <= 30 else "#ef4444"
            shop_text = f"<span style='color:{shop_color};font-weight:bold;'>{shop_rank}위</span> / {shop_total:,}건"
            shop_detail = f"<br><small style='color:#666'>{best_shop['title'][:40]}</small>"
        else:
            shop_text = f"<span style='color:#ef4444;font-weight:bold;'>미노출</span> / {shop_total:,}건"
            shop_detail = ""

        if blog_ranks:
            best_blog = min(blog_ranks, key=lambda x: x["rank"])
            blog_rank = best_blog["rank"]
            blog_color = "#22c55e" if blog_rank <= 10 else "#f59e0b" if blog_rank <= 30 else "#ef4444"
            blog_text = f"<span style='color:{blog_color};font-weight:bold;'>{blog_rank}위</span> / {blog_total:,}건"
            blog_detail = f"<br><small style='color:#666'>{best_blog['title'][:40]}</small>"
        else:
            blog_text = f"<span style='color:#ef4444;font-weight:bold;'>미노출</span> / {blog_total:,}건"
            blog_detail = ""

        keyword_rows += f"""
        <tr>
          <td style="padding:12px;border-bottom:1px solid #eee;font-weight:600;">{kw}</td>
          <td style="padding:12px;border-bottom:1px solid #eee;">{shop_text}{shop_detail}</td>
          <td style="padding:12px;border-bottom:1px solid #eee;">{blog_text}{blog_detail}</td>
        </tr>"""

    # AI 분석 텍스트를 HTML 단락으로 변환
    ai_paragraphs = ai_analysis.replace("\n\n", "</p><p style='margin:8px 0;line-height:1.7;'>").replace("\n", "<br>")

    html = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;">
    <!-- Header -->
    <tr>
      <td style="background:linear-gradient(135deg,#1e3a5f,#2563eb);padding:32px 24px;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:22px;">{brand_name} 키워드 순위 리포트</h1>
        <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;font-size:14px;">체크 시간: {check_time}</p>
      </td>
    </tr>

    <!-- Rank Table -->
    <tr>
      <td style="background:#fff;padding:24px;">
        <h2 style="font-size:16px;color:#1e3a5f;margin:0 0 16px;">키워드별 순위 현황</h2>
        <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
          <tr style="background:#f8fafc;">
            <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #e2e8f0;">키워드</th>
            <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #e2e8f0;">네이버 쇼핑</th>
            <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #e2e8f0;">네이버 블로그</th>
          </tr>
          {keyword_rows}
        </table>
      </td>
    </tr>

    <!-- AI Analysis -->
    <tr>
      <td style="background:#fff;padding:0 24px 24px;">
        <div style="background:#eff6ff;border-left:4px solid #2563eb;padding:16px 20px;border-radius:4px;">
          <h3 style="font-size:15px;color:#1e3a5f;margin:0 0 12px;">AI 분석 & 전략 제안</h3>
          <p style="margin:8px 0;line-height:1.7;font-size:13px;color:#374151;">{ai_paragraphs}</p>
        </div>
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="background:#f8fafc;padding:16px 24px;text-align:center;border-top:1px solid #e5e7eb;">
        <p style="margin:0;color:#9ca3af;font-size:11px;">Meta-Commander 키워드 순위 모니터링 | 자동 생성 리포트</p>
      </td>
    </tr>
  </table>
</body>
</html>"""
    return html


async def execute_keyword_rank_check(
    sched,
    db,
) -> Dict[str, Any]:
    """스케줄된 키워드 순위 체크를 실행한다."""
    from app.models.market_keyword import MarketKeyword
    from app.models.user import User
    from sqlalchemy import select

    brand_name = sched.brand_name or "널담"

    # 사용자의 등록 키워드 조회
    user_id = int(sched.user_id)
    result = await db.execute(
        select(MarketKeyword).where(MarketKeyword.user_id == user_id)
    )
    all_keywords = result.scalars().all()

    # 브랜드명이 포함된 키워드 필터링
    if sched.keyword_filter:
        target_keywords = [kw.keyword for kw in all_keywords if sched.keyword_filter in kw.keyword]
    else:
        target_keywords = [kw.keyword for kw in all_keywords if brand_name in kw.keyword]

    # 브랜드 키워드가 없으면 전체 키워드 사용
    if not target_keywords:
        target_keywords = [kw.keyword for kw in all_keywords]

    if not target_keywords:
        return {"status": "skip", "reason": "등록된 키워드가 없습니다"}

    # 순위 체크
    rank_results = await check_keyword_ranks(target_keywords, brand_name)

    # AI 분석
    ai_analysis = await analyze_ranks_with_ai(rank_results, brand_name)

    from datetime import timezone, timedelta
    kst = timezone(timedelta(hours=9))
    check_time = datetime.now(kst).strftime("%Y-%m-%d %H:%M KST")

    # 이메일 발송
    email_sent = False
    email_error = None
    if sched.email_to and settings.RESEND_API_KEY:
        try:
            html = build_rank_report_html(rank_results, ai_analysis, brand_name, check_time)
            resend.api_key = settings.RESEND_API_KEY
            resend.Emails.send({
                "from": settings.RESEND_FROM_EMAIL,
                "to": [sched.email_to],
                "subject": f"[{brand_name}] 키워드 순위 리포트 - {check_time}",
                "html": html,
            })
            email_sent = True
            logger.info(f"[KeywordRank] Email sent to {sched.email_to}")
        except Exception as e:
            email_error = str(e)
            logger.error(f"[KeywordRank] Email send failed: {e}")

    return {
        "status": "success",
        "keywords_checked": len(target_keywords),
        "rank_results": rank_results,
        "ai_analysis": ai_analysis[:500],
        "email_sent": email_sent,
        "email_error": email_error,
        "check_time": check_time,
    }
