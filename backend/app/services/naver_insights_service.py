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


# ── 절대 검색량 환산 (데이터랩 상대지수 × 검색광고 키워드도구) ───────────────

def norm_kw(k: str) -> str:
    return (k or "").replace(" ", "").upper()


def _qc_num(v) -> int:
    """키워드도구 검색량 값 파싱 — '< 10' 형태는 최소 근사값 5로 처리."""
    try:
        return int(v)
    except (TypeError, ValueError):
        return 5 if "<" in str(v) else 0


async def fetch_monthly_volumes(keywords: List[str]) -> Dict[str, Dict[str, int]]:
    """검색광고 키워드도구로 키워드별 최근 30일 절대 검색량 조회.

    반환: {정규화키워드: {pc, mobile, total}}. 자격증명 미설정/실패 시 {} (호출측 폴백).
    """
    from app.core.config import get_settings

    settings = get_settings()
    if not (
        settings.NAVER_ADS_API_KEY
        and settings.NAVER_ADS_SECRET_KEY
        and settings.NAVER_ADS_CUSTOMER_ID
    ):
        return {}

    from app.services.naver.search_ads_api import NaverSearchAdsAPI

    client = NaverSearchAdsAPI(
        api_key=settings.NAVER_ADS_API_KEY,
        secret_key=settings.NAVER_ADS_SECRET_KEY,
        customer_id=settings.NAVER_ADS_CUSTOMER_ID,
    )
    try:
        rows = await client.get_keyword_search_volume(
            [k.replace(" ", "") for k in keywords if k.strip()][:5]
        )
    except Exception as exc:
        logger.warning(f"[NaverInsights] 키워드도구 검색량 조회 실패: {exc}")
        return {}

    wanted = {norm_kw(k) for k in keywords}
    out: Dict[str, Dict[str, int]] = {}
    for r in rows:
        rk = norm_kw(r.get("relKeyword", ""))
        if rk in wanted and rk not in out:
            pc = _qc_num(r.get("monthlyPcQcCnt"))
            mo = _qc_num(r.get("monthlyMobileQcCnt"))
            out[rk] = {"pc": pc, "mobile": mo, "total": pc + mo}
    return out


def _bucket_range(period_str: str, time_unit: str) -> tuple:
    """데이터랩 버킷의 (시작일, 종료일). period는 버킷 시작일."""
    start = date.fromisoformat(period_str)
    if time_unit == "week":
        return start, start + timedelta(days=6)
    if time_unit == "month":
        nxt = date(start.year + (start.month == 12), start.month % 12 + 1, 1)
        return start, nxt - timedelta(days=1)
    return start, start


def apply_absolute_scale(
    results: List[dict], time_unit: str, end_date_str: str,
    volumes: Dict[str, Dict[str, int]], kw_by_title: Dict[str, str],
) -> bool:
    """상대지수 시리즈에 absolute(추정 쿼리수) 필드 부여.

    스케일: 최근 30일 창과 각 버킷의 겹침 일수를 가중해
    Σ(ratio×overlap비율) ↔ 월간검색량×(창일수/30) 이 일치하도록 k 산출.
    """
    try:
        end_dt = date.fromisoformat(end_date_str)
    except ValueError:
        return False
    window_start = end_dt - timedelta(days=29)
    applied = False

    for res in results:
        kw = kw_by_title.get(res.get("title", ""))
        vol = volumes.get(norm_kw(kw)) if kw else None
        pts = res.get("data", [])
        res["monthly_volume"] = vol
        if not vol or not vol.get("total") or not pts:
            continue
        weighted = 0.0
        window_days = 0
        for p in pts:
            try:
                b_start, b_end = _bucket_range(p["period"], time_unit)
            except (KeyError, ValueError):
                continue
            o_start = max(b_start, window_start)
            o_end = min(b_end, end_dt)
            if o_start > o_end:
                continue
            overlap = (o_end - o_start).days + 1
            bucket_days = (b_end - b_start).days + 1
            weighted += float(p.get("ratio", 0)) * (overlap / bucket_days)
            window_days += overlap
        if weighted <= 0 or window_days <= 0:
            continue
        k = (vol["total"] * (window_days / 30.0)) / weighted
        for p in pts:
            p["absolute"] = round(float(p.get("ratio", 0)) * k)
        res["scale_factor"] = k
        applied = True
    return applied


# ── 블로그 여론 분석 (엔드포인트/이메일 공용) ────────────────────────────────

async def _collect_blog_posts(
    keyword: str, sample: int, days: Optional[int] = None,
) -> List[Dict[str, str]]:
    """분석용 블로그 글 수집 — 최신순 페이지 스캔(+정확도순 보강), 기간 필터 지원."""
    posts: List[Dict[str, str]] = []
    seen_links: set = set()
    cutoff = (
        (date.today() - timedelta(days=days)).strftime("%Y%m%d") if days else None
    )

    def _append(it: dict) -> bool:
        """중복/기간 체크 후 추가. 기간 밖(과거) 글이면 False(스캔 중단 신호)."""
        pd = it.get("postdate", "")
        if cutoff and pd and pd < cutoff:
            return False
        link = it.get("link", "")
        if link and link not in seen_links:
            seen_links.add(link)
            posts.append({
                "title": clean_text(it.get("title", "")),
                "description": clean_text(it.get("description", "")),
                "date": pd,
            })
        return True

    # 1) 최신순 페이지 스캔 (start 상한 901 — API 최대 1000건)
    start = 1
    while len(posts) < sample and start <= 901:
        r = await api_hub.search("blog", keyword, display=100, start=start, sort="date")
        if not r["ok"]:
            break
        items = r["data"].get("items", [])
        if not items:
            break
        hit_old = False
        for it in items:
            if not _append(it):
                hit_old = True
                break
            if len(posts) >= sample:
                break
        if hit_old or len(items) < 100:
            break
        start += 100

    # 2) 정확도순 보강 (기간 필터 동일 적용) — 표본 다양성 확보
    if len(posts) < sample:
        r = await api_hub.search("blog", keyword, display=100, sort="sim")
        if r["ok"]:
            for it in r["data"].get("items", []):
                _append(it)  # sim은 날짜순이 아니므로 과거 글이어도 스캔 계속
                if len(posts) >= sample:
                    break
    return posts[:sample]


async def analyze_blog_sentiment(
    keyword: str, sample: int = 60, days: Optional[int] = None,
) -> Dict[str, Any]:
    """블로그 글에서 긍정/부정 단어·테마·요약 추출. 실패 시 ValueError.

    days 주어지면 해당 기간 내 작성 글만 표본으로 사용.
    """
    posts = await _collect_blog_posts(keyword, sample=sample, days=days)
    if not posts:
        raise ValueError("블로그 글을 수집하지 못했습니다."
                         + (f" (최근 {days}일 내 글 없음)" if days else ""))

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
- positive/negative 각 6~15개, weight 내림차순
- 단어는 실제 글에 등장한 한국어 표현 그대로 (예: "쫀득하다", "달다", "배송 빠름")
- 광고성 상투어("최고", "강추" 남발)는 weight를 낮게
- themes는 3~8개
- JSON 문자열 값 안에 큰따옴표(")를 절대 쓰지 말 것 — 인용이 필요하면 작은따옴표 사용"""

    from app.services.ai import ClaudeService, extract_text

    claude = ClaudeService()
    parsed = None
    last_error: Optional[Exception] = None
    for attempt in range(2):  # 모델이 깨진 JSON을 낼 때가 있어 1회 재시도
        response = claude.client.messages.create(
            model=claude.model,
            max_tokens=3000,
            messages=[{"role": "user", "content": prompt}],
        )
        text = extract_text(response)
        if not text:
            last_error = ValueError("AI 응답에 텍스트 블록이 없습니다")
            continue
        start_i, end_i = text.find("{"), text.rfind("}")
        try:
            parsed = json.loads(text[start_i:end_i + 1])
            break
        except Exception as exc:
            last_error = exc
            logger.warning(f"[InsightsReport] 감성 JSON 파싱 실패(시도 {attempt + 1}/2): {exc}")
    if parsed is None:
        raise ValueError(f"감성 분석 JSON 파싱 실패: {last_error}")
    return {
        "keyword": keyword,
        "sample_size": len(posts),
        "period_days": days,
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
            results = r["data"].get("results", [])
            # 절대 검색량 환산 (실패해도 상대지수 기반 delta는 유지)
            try:
                vols = await fetch_monthly_volumes(REPORT_SEARCH_KEYWORDS)
                if vols:
                    apply_absolute_scale(
                        results, "date", rng["end_date"], vols,
                        {k: k for k in REPORT_SEARCH_KEYWORDS},
                    )
            except Exception as exc:
                logger.warning(f"[InsightsReport] 절대 검색량 환산 실패: {exc}")
            out["search_trend"] = [
                {
                    "title": g["title"],
                    "delta": _delta(g["data"]),
                    "monthly_volume": (g.get("monthly_volume") or {}).get("total"),
                    "week_queries": (
                        sum(p.get("absolute", 0) for p in g["data"][-7:])
                        if g.get("monthly_volume") else None
                    ),
                }
                for g in results
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
        out["sentiment"] = await analyze_blog_sentiment(REPORT_BRAND, sample=50, days=30)
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


def _search_trend_rows(items: Optional[List[Dict]]) -> str:
    """검색어 트렌드 — 절대 쿼리수(최근 7일 합·월간) + 변화율. 환산 실패 시 변화율만."""
    if not items:
        return "<tr><td colspan='3' style='padding:8px 12px;color:#9ca3af;'>수집 실패</td></tr>"
    rows = []
    for it in items:
        wq = it.get("week_queries")
        mv = it.get("monthly_volume")
        vol_cell = (
            f"최근 7일 <b>{wq:,}회</b>"
            f"<span style='color:#9ca3af;font-size:11px;'> · 월간 {mv:,}회</span>"
            if wq is not None and mv else
            "<span style='color:#9ca3af;'>상대지수</span>"
        )
        rows.append(
            f"<tr><td style='padding:8px 12px;border-bottom:1px solid #eee;'>{it['title']}</td>"
            f"<td style='padding:8px 12px;border-bottom:1px solid #eee;'>{vol_cell}</td>"
            f"<td style='padding:8px 12px;border-bottom:1px solid #eee;'>{_delta_span(it['delta'])}</td></tr>"
        )
    return "".join(rows)


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
          <p style="margin:10px 0 0;color:#9ca3af;font-size:11px;">분석 표본: 최근 30일 블로그 글 {sentiment.get('sample_size', 0)}건 (긍/부정 상세 마인드맵은 대시보드 → 네이버 인사이트 탭)</p>
        </div>"""
    else:
        sentiment_html = "<p style='font-size:12px;color:#9ca3af;'>여론 분석 수집 실패</p>"

    kw_cat_name = REPORT_CATEGORY_KEYWORDS["name"]

    return f"""
    <!-- Naver Insights -->
    <tr>
      <td style="background:#fff;padding:0 24px 24px;">
        <h2 style="font-size:16px;color:#1e3a5f;margin:0 0 4px;">네이버 인사이트</h2>
        <p style="margin:0 0 16px;color:#9ca3af;font-size:11px;">데이터 기준일: {data.get('as_of')} · 검색어 트렌드는 절대 쿼리수(검색광고 키워드도구 환산), 쇼핑인사이트는 상대지수 · 변화율은 최근 7일 vs 이전 7일</p>

        <h3 style="font-size:13px;color:#1e3a5f;margin:0 0 6px;">검색어 트렌드 (통합검색 절대 검색량)</h3>
        <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;margin-bottom:14px;">{_search_trend_rows(data.get('search_trend'))}</table>

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
