"""네이버 인사이트 — 공용 분석 로직 + 데일리 이메일 리포트 섹션.

- analyze_blog_sentiment: 블로그 여론 긍정/부정 단어 추출 (탭 마인드맵 + 이메일 공용)
- collect_insights_report_data: 데일리 리포트용 트렌드·언급량·여론 데이터 수집
- build_insights_html_section: 키워드 순위 이메일에 붙는 인사이트 HTML 섹션
"""
import json
import logging
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

from app.services.naver import api_hub
from app.services.naver_mention_service import clean_text, fetch_mentions

logger = logging.getLogger(__name__)

# 데일리 리포트 구성 (탭 기본값과 동일)
REPORT_BRAND = "널담"
REPORT_SEARCH_KEYWORDS = ["널담", "마카롱", "휘낭시에"]
REPORT_CATEGORIES = [
    {"name": "빵/베이커리", "param": ["50022959"]},
    {"name": "스낵/과자", "param": ["50022619"]},
]
REPORT_CATEGORY_KEYWORDS = {"code": "50022959", "name": "빵/베이커리",
                            "keywords": ["마카롱", "휘낭시에", "베이글"]}


# ── 블로그 여론 분석 (엔드포인트/이메일 공용) ────────────────────────────────

async def analyze_blog_sentiment(keyword: str, sample: int = 30) -> Dict[str, Any]:
    """최근 블로그 글에서 긍정/부정 단어·테마·요약 추출. 실패 시 ValueError."""
    posts: List[Dict[str, str]] = []
    seen_links: set = set()
    for sort in ("date", "sim"):
        r = await api_hub.search("blog", keyword, display=sample, sort=sort)
        if not r["ok"]:
            continue
        for it in r["data"].get("items", []):
            link = it.get("link", "")
            if link in seen_links:
                continue
            seen_links.add(link)
            posts.append({
                "title": clean_text(it.get("title", "")),
                "description": clean_text(it.get("description", "")),
                "date": it.get("postdate", ""),
            })
    if not posts:
        raise ValueError("블로그 글을 수집하지 못했습니다.")
    posts = posts[: sample * 2]

    corpus = "\n".join(
        f"- [{p['date']}] {p['title']} :: {p['description']}" for p in posts
    )

    prompt = f"""다음은 '{keyword}'에 대한 최근 네이버 블로그 글 {len(posts)}건의 제목·요약입니다.

{corpus}

위 글들에서 '{keyword}'에 대한 소비자 반응을 분석해 아래 JSON만 출력하세요(설명·마크다운 금지).

{{
  "positive": [{{"word": "긍정 단어/표현", "weight": 1~10 빈도·강도 점수, "context": "어떤 맥락인지 한 문장"}}],
  "negative": [{{"word": "부정 단어/표현", "weight": 1~10, "context": "한 문장"}}],
  "themes": [{{"name": "주요 화제(제품명·상황 등)", "sentiment": "positive|negative|neutral", "count": 언급횟수}}],
  "summary": "전체 여론 요약 2~3문장 (긍정:부정 비중 포함)"
}}

규칙:
- positive/negative 각 5~12개, weight 내림차순
- 단어는 실제 글에 등장한 한국어 표현 그대로 (예: "쫀득하다", "달다", "배송 빠름")
- 광고성 상투어("최고", "강추" 남발)는 weight를 낮게
- themes는 3~8개"""

    from app.services.ai import ClaudeService, extract_text

    claude = ClaudeService()
    response = claude.client.messages.create(
        model=claude.model,
        max_tokens=3000,
        messages=[{"role": "user", "content": prompt}],
    )
    text = extract_text(response)
    if not text:
        raise ValueError("AI 응답에 텍스트 블록이 없습니다")
    start_i, end_i = text.find("{"), text.rfind("}")
    parsed = json.loads(text[start_i:end_i + 1])
    return {
        "keyword": keyword,
        "sample_size": len(posts),
        "positive": parsed.get("positive", []),
        "negative": parsed.get("negative", []),
        "themes": parsed.get("themes", []),
        "summary": parsed.get("summary", ""),
    }


# ── 데일리 리포트 데이터 수집 ────────────────────────────────────────────────

def _delta(data: List[Dict]) -> Optional[float]:
    """최근 7포인트 vs 이전 7포인트 평균 변화율(%)."""
    if len(data) < 14:
        return None
    recent = sum(p["ratio"] for p in data[-7:]) / 7
    prev = sum(p["ratio"] for p in data[-14:-7]) / 7
    if prev == 0:
        return None
    return (recent - prev) / prev * 100


def _range30() -> Dict[str, str]:
    end = date.today() - timedelta(days=1)
    start = end - timedelta(days=30)
    return {"start_date": start.isoformat(), "end_date": end.isoformat()}


async def collect_insights_report_data(db=None) -> Dict[str, Any]:
    """데일리 이메일용 인사이트 데이터. 각 항목은 개별 실패 허용(None)."""
    out: Dict[str, Any] = {
        "search_trend": None, "category_trend": None, "keyword_trend": None,
        "mentions": None, "mention_delta": None, "sentiment": None,
        "as_of": (date.today() - timedelta(days=1)).isoformat(),
    }
    if not api_hub.is_configured():
        return out
    rng = _range30()

    try:
        r = await api_hub.search_trend(
            keyword_groups=[{"groupName": k, "keywords": [k]} for k in REPORT_SEARCH_KEYWORDS],
            **rng,
        )
        if r["ok"]:
            out["search_trend"] = [
                {"title": g["title"], "delta": _delta(g["data"])}
                for g in r["data"].get("results", [])
            ]
    except Exception as exc:
        logger.warning(f"[InsightsReport] 검색어 트렌드 실패: {exc}")

    try:
        r = await api_hub.shopping_category_trend(categories=REPORT_CATEGORIES, **rng)
        if r["ok"]:
            out["category_trend"] = [
                {"title": g["title"], "delta": _delta(g["data"])}
                for g in r["data"].get("results", [])
            ]
    except Exception as exc:
        logger.warning(f"[InsightsReport] 쇼핑인사이트 분야 실패: {exc}")

    try:
        r = await api_hub.shopping_keyword_trend(
            category_code=REPORT_CATEGORY_KEYWORDS["code"],
            keywords=[{"name": k, "param": [k]} for k in REPORT_CATEGORY_KEYWORDS["keywords"]],
            **rng,
        )
        if r["ok"]:
            out["keyword_trend"] = [
                {"title": g["title"], "delta": _delta(g["data"])}
                for g in r["data"].get("results", [])
            ]
    except Exception as exc:
        logger.warning(f"[InsightsReport] 쇼핑 키워드 트렌드 실패: {exc}")

    try:
        m = await fetch_mentions(REPORT_BRAND, display=1)
        blog_total = m["blog"]["total"] if m["blog"] else -1
        cafe_total = m["cafe"]["total"] if m["cafe"] else -1
        out["mentions"] = {"blog": blog_total, "cafe": cafe_total}
        # 전일 스냅샷 대비 증감
        if db is not None and (blog_total >= 0 or cafe_total >= 0):
            from sqlalchemy import select
            from app.models.naver_insight import NaverMentionDaily

            q = await db.execute(
                select(NaverMentionDaily)
                .where(
                    NaverMentionDaily.keyword == REPORT_BRAND,
                    NaverMentionDaily.date < date.today(),
                )
                .order_by(NaverMentionDaily.date.desc())
                .limit(1)
            )
            prev = q.scalar_one_or_none()
            if prev:
                out["mention_delta"] = {
                    "since": prev.date.isoformat(),
                    "blog": blog_total - prev.blog_total if blog_total >= 0 else None,
                    "cafe": cafe_total - prev.cafe_total if cafe_total >= 0 else None,
                }
    except Exception as exc:
        logger.warning(f"[InsightsReport] 언급량 실패: {exc}")

    try:
        out["sentiment"] = await analyze_blog_sentiment(REPORT_BRAND, sample=25)
    except Exception as exc:
        logger.warning(f"[InsightsReport] 여론 분석 실패: {exc}")

    return out


# ── 이메일 HTML 섹션 ─────────────────────────────────────────────────────────

def _delta_span(d: Optional[float]) -> str:
    if d is None:
        return "<span style='color:#9ca3af;'>–</span>"
    color = "#22c55e" if d >= 0 else "#ef4444"
    arrow = "▲" if d >= 0 else "▼"
    return f"<span style='color:{color};font-weight:bold;'>{arrow} {abs(d):.1f}%</span>"


def _trend_rows(items: Optional[List[Dict]]) -> str:
    if not items:
        return "<tr><td colspan='2' style='padding:8px 12px;color:#9ca3af;'>수집 실패</td></tr>"
    return "".join(
        f"<tr><td style='padding:8px 12px;border-bottom:1px solid #eee;'>{it['title']}</td>"
        f"<td style='padding:8px 12px;border-bottom:1px solid #eee;'>{_delta_span(it['delta'])}</td></tr>"
        for it in items
    )


def build_insights_html_section(data: Dict[str, Any]) -> str:
    """키워드 순위 이메일 본문에 삽입할 네이버 인사이트 섹션(HTML 조각)."""
    mentions = data.get("mentions") or {}
    md = data.get("mention_delta") or {}

    def _fmt_total(v):
        return f"{v:,}건" if isinstance(v, int) and v >= 0 else "수집 실패"

    def _fmt_diff(v):
        if v is None:
            return ""
        color = "#22c55e" if v >= 0 else "#ef4444"
        return f" <span style='color:{color};font-size:11px;'>({'+' if v >= 0 else ''}{v:,})</span>"

    mention_html = f"""
        <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;margin-bottom:16px;">
          <tr>
            <td style="padding:10px 12px;background:#f8fafc;border-radius:6px;">
              블로그 누적 <b>{_fmt_total(mentions.get('blog'))}</b>{_fmt_diff(md.get('blog'))}
              &nbsp;·&nbsp; 카페 누적 <b>{_fmt_total(mentions.get('cafe'))}</b>{_fmt_diff(md.get('cafe'))}
              {f"<span style='color:#9ca3af;font-size:11px;'> — {md['since']} 대비</span>" if md.get('since') else ""}
            </td>
          </tr>
        </table>"""

    sentiment = data.get("sentiment")
    if sentiment:
        pos_words = " ".join(
            f"<span style='display:inline-block;background:#dcfce7;color:#15803d;border-radius:10px;"
            f"padding:2px 8px;margin:2px;font-size:12px;'>{w['word']} {w['weight']}</span>"
            for w in sentiment.get("positive", [])[:8]
        )
        neg_words = " ".join(
            f"<span style='display:inline-block;background:#fee2e2;color:#b91c1c;border-radius:10px;"
            f"padding:2px 8px;margin:2px;font-size:12px;'>{w['word']} {w['weight']}</span>"
            for w in sentiment.get("negative", [])[:8]
        )
        sentiment_html = f"""
        <div style="background:#fafafa;border:1px solid #e5e7eb;border-radius:6px;padding:14px 16px;margin-bottom:8px;">
          <p style="margin:0 0 10px;font-size:13px;color:#374151;line-height:1.7;">{sentiment.get('summary', '')}</p>
          <p style="margin:0 0 4px;font-size:12px;color:#15803d;font-weight:bold;">긍정 키워드</p>
          <p style="margin:0 0 10px;">{pos_words or '-'}</p>
          <p style="margin:0 0 4px;font-size:12px;color:#b91c1c;font-weight:bold;">부정 키워드</p>
          <p style="margin:0;">{neg_words or '-'}</p>
          <p style="margin:10px 0 0;color:#9ca3af;font-size:11px;">분석 표본: 최근 블로그 글 {sentiment.get('sample_size', 0)}건 (긍/부정 상세 마인드맵은 대시보드 → 네이버 인사이트 탭)</p>
        </div>"""
    else:
        sentiment_html = "<p style='font-size:12px;color:#9ca3af;'>여론 분석 수집 실패</p>"

    kw_cat_name = REPORT_CATEGORY_KEYWORDS["name"]

    return f"""
    <!-- Naver Insights -->
    <tr>
      <td style="background:#fff;padding:0 24px 24px;">
        <h2 style="font-size:16px;color:#1e3a5f;margin:0 0 4px;">네이버 인사이트</h2>
        <p style="margin:0 0 16px;color:#9ca3af;font-size:11px;">데이터 기준일: {data.get('as_of')} (데이터랩 상대지수, 최근 7일 vs 이전 7일 변화율)</p>

        <h3 style="font-size:13px;color:#1e3a5f;margin:0 0 6px;">검색어 트렌드 (통합검색)</h3>
        <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;margin-bottom:14px;">{_trend_rows(data.get('search_trend'))}</table>

        <h3 style="font-size:13px;color:#1e3a5f;margin:0 0 6px;">쇼핑인사이트 분야 트렌드</h3>
        <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;margin-bottom:14px;">{_trend_rows(data.get('category_trend'))}</table>

        <h3 style="font-size:13px;color:#1e3a5f;margin:0 0 6px;">{kw_cat_name} 분야 키워드 클릭 트렌드</h3>
        <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;margin-bottom:14px;">{_trend_rows(data.get('keyword_trend'))}</table>

        <h3 style="font-size:13px;color:#1e3a5f;margin:0 0 6px;">{REPORT_BRAND} 블로그/카페 언급량</h3>
        {mention_html}

        <h3 style="font-size:13px;color:#1e3a5f;margin:0 0 6px;">{REPORT_BRAND} 블로그 여론 AI 분석</h3>
        {sentiment_html}
      </td>
    </tr>"""
