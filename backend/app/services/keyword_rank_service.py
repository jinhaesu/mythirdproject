"""키워드 순위 체크 + AI 분석 + 이메일 발송 서비스."""
import asyncio
import logging
import json
from typing import Dict, Any, List, Optional
from datetime import datetime

import httpx
import resend

from app.core.config import get_settings
from app.services.ai import ClaudeService, extract_text
from app.services.serp_rank_service import fetch_serp_shopping

logger = logging.getLogger(__name__)
settings = get_settings()


async def check_keyword_ranks(
    keywords: List[str],
    brand_name: str = "널담",
) -> List[Dict[str, Any]]:
    """네이버 쇼핑/블로그에서 키워드별 브랜드 순위를 체크한다.

    Returns list of:
      {keyword, shopping_ranks, blog_ranks, shopping_total, blog_total,
       shopping_available, shopping_source, brand_chip}

    쇼핑 순위는 쇼핑 검색 오픈API 종료(SE05) 이후 통합검색(SERP)
    쇼핑 블록 노출 순위로 대체됐다 (shopping_source="serp_block").
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

    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        for i, keyword in enumerate(keywords):
            rank_data: Dict[str, Any] = {
                "keyword": keyword,
                "shopping_ranks": [],
                "blog_ranks": [],
                "shopping_total": 0,
                "blog_total": 0,
                "shopping_available": True,
                "shopping_source": "serp_block",
                "brand_chip": False,
            }

            # 네이버 쇼핑 — 통합검색 쇼핑 블록 크롤 (쇼핑 검색 API 종료 대체)
            if i > 0:
                await asyncio.sleep(0.6)  # SERP 요청 간격 (봇 차단 예방)
            serp = await fetch_serp_shopping(client, keyword, brand_name)
            if serp["ok"]:
                rank_data["shopping_total"] = len(serp["items"])
                rank_data["brand_chip"] = serp["brand_chip"]
                rank_data["shopping_ranks"] = [
                    {
                        "rank": br["rank"],
                        "title": br["title"],
                        "price": br["price"],
                        "mall": "",
                        "link": br["link"],
                    }
                    for br in serp["brand_ranks"]
                ]
            else:
                rank_data["shopping_available"] = False

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
    shopping_unavailable = any(r.get("shopping_available") is False for r in rank_results)
    summary_lines = []
    for r in rank_results:
        kw = r["keyword"]
        shop_ranks = r.get("shopping_ranks", [])
        blog_ranks = r.get("blog_ranks", [])
        shop_total = r.get("shopping_total", 0)
        blog_total = r.get("blog_total", 0)

        if r.get("shopping_available") is False:
            shop_str = "쇼핑 데이터 수집 실패"
        elif shop_ranks:
            best_shop = min(shop_ranks, key=lambda x: x["rank"])
            chip = " · 브랜드필터 노출" if r.get("brand_chip") else ""
            shop_str = f"통합검색 쇼핑블록 {best_shop['rank']}위/{shop_total}개 카드{chip} ({best_shop['title']})"
        elif shop_total == 0:
            shop_str = "통합검색에 쇼핑블록 없음 (비상거래성 키워드)"
        else:
            chip = " (단, 브랜드필터에는 노출)" if r.get("brand_chip") else ""
            shop_str = f"쇼핑블록 미노출 (카드 {shop_total}개 중 없음){chip}"

        if blog_ranks:
            best_blog = min(blog_ranks, key=lambda x: x["rank"])
            blog_str = f"블로그 최고순위 {best_blog['rank']}위/{blog_total}건 ({best_blog['title'][:30]})"
        else:
            blog_str = f"블로그 미노출 (총 {blog_total}건 중 100위 내 없음)"

        summary_lines.append(f"- [{kw}]: {shop_str} / {blog_str}")

    summary_text = "\n".join(summary_lines)

    shopping_note = (
        "\n\n참고: 쇼핑 순위는 네이버 '통합검색 결과의 쇼핑 블록'(상위 5~20개 카드) 노출 기준입니다. "
        "쇼핑 검색 API 종료로 쇼핑 버티컬 전체 100위 데이터는 없으며, "
        "통합검색 쇼핑블록은 사용자가 검색 시 가장 먼저 보는 영역이므로 실질 노출 지표로 해석해주세요."
    )
    if shopping_unavailable:
        shopping_note += " 일부 키워드는 쇼핑 데이터 수집에 실패해 블로그 중심으로 분석해야 합니다."

    prompt = f"""당신은 네이버 SEO 및 커머스 마케팅 전문가입니다.
다음은 '{brand_name}' 브랜드의 네이버 검색 순위 현황입니다:

{summary_text}{shopping_note}

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
        text = extract_text(response)
        if not text:
            raise ValueError("AI 응답에 텍스트 블록이 없습니다")
        return text
    except Exception as e:
        logger.error(f"[KeywordRank] AI analysis failed: {e}")
        # Fallback: 기본 분석
        lines = [f"[{brand_name} 키워드 순위 리포트]\n"]
        for r in rank_results:
            kw = r["keyword"]
            shop = r.get("shopping_ranks", [])
            blog = r.get("blog_ranks", [])
            if r.get("shopping_available") is False:
                pass  # 쇼핑 수집 실패 — 쇼핑 줄 생략
            elif shop:
                lines.append(f"- {kw} 쇼핑블록: {shop[0]['rank']}위")
            else:
                lines.append(f"- {kw} 쇼핑블록: 미노출")
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
    insights_html: str = "",
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

        if r.get("shopping_available") is False:
            shop_text = "<span style='color:#9ca3af;'>수집 실패</span>"
            shop_detail = ""
        elif shop_ranks:
            best_shop = min(shop_ranks, key=lambda x: x["rank"])
            shop_rank = best_shop["rank"]
            shop_color = "#22c55e" if shop_rank <= 3 else "#f59e0b" if shop_rank <= 10 else "#ef4444"
            chip = " · 브랜드필터" if r.get("brand_chip") else ""
            shop_text = f"<span style='color:{shop_color};font-weight:bold;'>{shop_rank}위</span> / 블록 {shop_total}개{chip}"
            shop_detail = f"<br><small style='color:#666'>{best_shop['title'][:40]}</small>"
        elif shop_total == 0:
            shop_text = "<span style='color:#9ca3af;'>쇼핑블록 없음</span>"
            shop_detail = ""
        else:
            shop_text = f"<span style='color:#ef4444;font-weight:bold;'>미노출</span> / 블록 {shop_total}개"
            shop_detail = "<br><small style='color:#9ca3af'>브랜드필터 노출</small>" if r.get("brand_chip") else ""

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
            <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #e2e8f0;">쇼핑 (통합검색 블록)</th>
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
{insights_html}

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

    # 네이버 인사이트 섹션 (실패해도 순위 리포트는 발송)
    insights_html = ""
    try:
        from app.services.naver_insights_service import (
            build_insights_html_section,
            collect_insights_report_data,
        )

        insights_data = await collect_insights_report_data(db)
        insights_html = build_insights_html_section(insights_data)
    except Exception as e:
        logger.warning(f"[KeywordRank] 인사이트 섹션 생성 실패(순위만 발송): {e}")

    from datetime import timezone, timedelta
    kst = timezone(timedelta(hours=9))
    check_time = datetime.now(kst).strftime("%Y-%m-%d %H:%M KST")

    # 이메일 발송
    email_sent = False
    email_error = None
    if sched.email_to and settings.RESEND_API_KEY:
        try:
            html = build_rank_report_html(rank_results, ai_analysis, brand_name, check_time, insights_html)
            resend.api_key = settings.RESEND_API_KEY
            resend.Emails.send({
                "from": settings.RESEND_FROM_EMAIL,
                "to": [sched.email_to],
                "subject": f"[{brand_name}] 키워드 순위·인사이트 리포트 - {check_time}",
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
