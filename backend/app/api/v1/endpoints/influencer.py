"""인플루언서 시딩 관리 모듈 — 시딩 비용/대상 기록 + AI 타겟 고객층 분석 + 집계.

엔드포인트:
  GET    /api/v1/influencer/seedings                — 시딩 목록
  POST   /api/v1/influencer/seedings                — 시딩 등록
  PUT    /api/v1/influencer/seedings/{id}            — 시딩 수정
  DELETE /api/v1/influencer/seedings/{id}            — 시딩 삭제
  POST   /api/v1/influencer/seedings/{id}/analyze    — AI 타겟 고객층 분석
  GET    /api/v1/influencer/summary                  — 채널/타겟/월별 집계
  GET    /api/v1/influencer/export                   — xlsx 다운로드
"""
import logging
import re
from collections import defaultdict
from datetime import date, datetime
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_user
from app.db.database import get_db
from app.models.influencer import InfluencerSeeding
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter()

_UNANALYZED_LABEL = "미분석"


def _segment_key(segment: Optional[str]) -> str:
    """세그먼트 집계 키 정규화 — 분석 실패류('분석 불가', '정보 부족')는 미분석으로 묶는다."""
    if not segment:
        return _UNANALYZED_LABEL
    s = segment.strip()
    if s.startswith("분석 불가") or s.startswith("정보 부족"):
        return _UNANALYZED_LABEL
    return s


# ── 공용 헬퍼 ────────────────────────────────────────────────────────────────

def _serialize(row: InfluencerSeeding) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "channel": row.channel,
        "url": row.url,
        "follower_count": row.follower_count,
        "cost": row.cost,
        "seeded_at": row.seeded_at.isoformat() if row.seeded_at else None,
        "product": row.product,
        "notes": row.notes,
        "ai_target_segment": row.ai_target_segment,
        "ai_audience_summary": row.ai_audience_summary,
        "ai_analyzed_at": row.ai_analyzed_at.isoformat() if row.ai_analyzed_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _parse_date(value: str, field_name: str = "seeded_at") -> date:
    try:
        return date.fromisoformat(value)
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail=f"{field_name}는 YYYY-MM-DD 형식이어야 합니다.")


_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.5",
}


def _parse_korean_count(s: str) -> Optional[int]:
    """"1.23만", "9.8천", "1.2M", "34.5K", "9,450" 형태를 정수로 변환."""
    if not s:
        return None
    s = s.replace(",", "").replace("명", "").replace("subscribers", "").strip()
    m = re.match(r"^([\d.]+)\s*([만천억KMkm]?)$", s)
    if not m:
        return None
    try:
        num = float(m.group(1))
    except ValueError:
        return None
    unit = m.group(2)
    mult = {"만": 10_000, "천": 1_000, "억": 100_000_000,
            "K": 1_000, "k": 1_000, "M": 1_000_000, "m": 1_000_000}.get(unit, 1)
    return int(num * mult)


def _extract_og(html: str, prop: str) -> Optional[str]:
    """og 메타 추출 — 대용량 HTML에서 DOTALL 백트래킹을 피하기 위해
    <head> 영역만 자르고 <meta> 태그 단위로 선형 스캔한다."""
    head = html[:200_000]
    needle = f"og:{prop}"
    for tag in re.findall(r"<meta\b[^>]*>", head, re.IGNORECASE):
        if needle not in tag:
            continue
        m = re.search(r'content\s*=\s*["\']([^"\']*)["\']', tag, re.IGNORECASE)
        if m and m.group(1).strip():
            return _strip_html(m.group(1))
    return None


def _titles_from_youtube_html(html: str) -> list[str]:
    """ytInitialData의 accessibilityText("제목, 조회수 X회 …")에서 영상 제목 추출.

    데이터센터 IP에서 RSS가 404로 차단될 때의 폴백 (2026-07 Railway 실측).
    """
    import json as _json

    out: list[str] = []
    seen: set[str] = set()
    for m in re.finditer(r'"accessibilityText"\s*:\s*"((?:[^"\\]|\\.){4,300}?)"', html):
        try:
            text = _json.loads(f'"{m.group(1)}"')
        except (ValueError, UnicodeDecodeError):
            continue
        if "조회수" not in text and "views" not in text:
            continue
        title = re.split(r",\s*조회수", text)[0]
        title = re.sub(r"\s*[-–]?\s*[\d,.]+[KMB]?\s*views.*$", "", title, flags=re.IGNORECASE).strip()
        if len(title) < 4 or title in seen:
            continue
        seen.add(title)
        out.append(title)
        if len(out) >= 15:
            break
    return out


async def _fetch_youtube_channel(url: str, client: httpx.AsyncClient) -> tuple[Optional[str], Optional[int], str]:
    """유튜브 채널 실데이터: 설명·구독자수(HTML 내 ytInitialData) + RSS 최근 영상 제목.

    Returns: (텍스트, 구독자수, data_quality)
    """
    resp = await client.get(url, headers=_BROWSER_HEADERS)
    if resp.status_code >= 400:
        return None, None, "none"
    html = resp.text

    parts: list[str] = []
    title = _extract_og(html, "title")
    if title:
        parts.append(f"[채널명] {title}")

    desc = _extract_og(html, "description")
    if desc:
        parts.append(f"[채널 설명] {desc}")

    subscriber: Optional[int] = None
    sub_m = re.search(r'구독자\s*([\d.,]+\s*[만천억]?)\s*명', html)
    if not sub_m:
        sub_m = re.search(r'"subscriberCountText"[^}]*?"simpleText"\s*:\s*"구독자\s*([^"]+?)명?"', html)
    if not sub_m:
        sub_m = re.search(r'([\d.,]+[KM]?)\s*subscribers', html)
    if sub_m:
        subscriber = _parse_korean_count(sub_m.group(1).strip())
        if subscriber:
            parts.append(f"[구독자수] {subscriber:,}명")

    # 채널 ID → RSS 피드로 최근 영상 제목 수집 (JS 렌더링 무관, 가장 신뢰도 높은 실데이터)
    # 실측 교훈: ① HTML에는 노이즈 UC 문자열이 섞임 — 진짜 채널 ID는 수십 회 반복 등장
    # 하므로 최빈값 선정. ② RSS는 같은 ID라도 간헐적으로 404를 반환 → 재시도 필수.
    import asyncio as _asyncio
    from collections import Counter

    video_titles: list[str] = []
    candidates: list[str] = []
    ext_m = re.search(r'"externalId"\s*:\s*"(UC[0-9A-Za-z_-]{22})"', html)
    if ext_m:
        candidates.append(ext_m.group(1))
    freq = Counter(re.findall(r"UC[0-9A-Za-z_-]{22}", html))
    candidates.extend(cid for cid, _ in freq.most_common(2))
    seen: set[str] = set()
    candidates = [c for c in candidates if not (c in seen or seen.add(c))]

    for cid in candidates[:2]:
        for attempt in range(3):
            try:
                rss = await client.get(
                    f"https://www.youtube.com/feeds/videos.xml?channel_id={cid}",
                    headers=_BROWSER_HEADERS,
                )
                if rss.status_code < 400:
                    titles = re.findall(r"<title>([^<]*)</title>", rss.text[:400_000])
                    # 첫 title은 채널명이므로 제외
                    video_titles = [_strip_html(t) for t in titles[1:16] if _strip_html(t)]
                    if video_titles:
                        break
                else:
                    logger.info(f"[Influencer] 유튜브 RSS {rss.status_code} cid={cid} 시도 {attempt + 1}/3")
            except Exception as e:
                logger.warning(f"[Influencer] 유튜브 RSS 실패 cid={cid}: {e}")
            await _asyncio.sleep(0.7 * (attempt + 1))
        if video_titles:
            break

    # RSS 차단(데이터센터 IP 404) 폴백 — 페이지 HTML의 ytInitialData에서 제목 직접 추출
    if not video_titles:
        video_titles = _titles_from_youtube_html(html)
        if not video_titles:
            try:
                vresp = await client.get(url.rstrip("/") + "/videos", headers=_BROWSER_HEADERS)
                if vresp.status_code < 400:
                    video_titles = _titles_from_youtube_html(vresp.text)
            except Exception as e:
                logger.warning(f"[Influencer] 유튜브 /videos 폴백 실패: {e}")

    if video_titles:
        joined = "\n".join(f"- {t}" for t in video_titles)
        parts.append(f"[최근 업로드 영상 제목 {len(video_titles)}개]\n{joined}")

    if not parts:
        return None, None, "none"
    quality = "rich" if video_titles else "partial"
    return "\n".join(parts), subscriber, quality


async def _fetch_naver_blog(url: str, client: httpx.AsyncClient) -> tuple[Optional[str], Optional[int], str]:
    """네이버 블로그 실데이터: RSS로 블로그 제목·소개·최근 글 제목/카테고리."""
    bid_m = re.search(r"blog\.naver\.com/(?:PostList\.naver\?blogId=)?([A-Za-z0-9_-]+)", url)
    if not bid_m:
        return None, None, "none"
    blog_id = bid_m.group(1)
    if blog_id.lower() in ("postview", "postlist"):
        q = re.search(r"blogId=([A-Za-z0-9_-]+)", url)
        if not q:
            return None, None, "none"
        blog_id = q.group(1)

    try:
        rss = await client.get(f"https://rss.blog.naver.com/{blog_id}.xml", headers=_BROWSER_HEADERS)
    except Exception:
        return None, None, "none"
    if rss.status_code >= 400 or "<rss" not in rss.text[:200].lower():
        return None, None, "none"

    xml = rss.text
    parts: list[str] = []
    ch_m = re.search(r"<channel>.*?<title>(.*?)</title>.*?<description>(.*?)</description>", xml, re.DOTALL)
    if ch_m:
        parts.append(f"[블로그명] {_strip_html(ch_m.group(1))}")
        d = _strip_html(ch_m.group(2))
        if d:
            parts.append(f"[블로그 소개] {d}")

    item_titles = re.findall(r"<item>.*?<title>(.*?)</title>", xml, re.DOTALL)[:15]
    cats = list(dict.fromkeys(_strip_html(c) for c in re.findall(r"<category>(.*?)</category>", xml, re.DOTALL)))[:10]
    if item_titles:
        joined = "\n".join(f"- {_strip_html(t)}" for t in item_titles)
        parts.append(f"[최근 글 제목 {len(item_titles)}개]\n{joined}")
    if cats:
        parts.append(f"[글 카테고리] {', '.join(cats)}")

    if not parts:
        return None, None, "none"
    return "\n".join(parts), None, "rich" if item_titles else "partial"


async def _fetch_instagram(url: str, client: httpx.AsyncClient) -> tuple[Optional[str], Optional[int], str]:
    """인스타그램: og 메타에서 팔로워수·소개 추출 (로그인월이면 none)."""
    try:
        resp = await client.get(url, headers=_BROWSER_HEADERS)
    except Exception:
        return None, None, "none"
    if resp.status_code >= 400:
        return None, None, "none"
    html = resp.text

    parts: list[str] = []
    follower: Optional[int] = None
    og_title = _extract_og(html, "title")
    og_desc = _extract_og(html, "description")
    if og_title:
        parts.append(f"[프로필] {og_title}")
    if og_desc:
        parts.append(f"[프로필 설명] {og_desc}")
        f_m = re.search(r"([\d.,]+[KMkm만천]?)\s*(?:Followers|팔로워)", og_desc)
        if f_m:
            follower = _parse_korean_count(f_m.group(1))
            if follower:
                parts.append(f"[팔로워수] {follower:,}")

    if not parts:
        return None, None, "none"
    # og만으로는 콘텐츠 주제 판단이 어려움 → partial
    return "\n".join(parts), follower, "partial"


async def _fetch_channel_data(url: str, channel: str) -> tuple[Optional[str], Optional[int], str]:
    """채널 유형별 실데이터 수집. Returns (텍스트, 팔로워/구독자수, data_quality)."""
    lowered = url.lower()
    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            if "youtube.com" in lowered or "youtu.be" in lowered:
                return await _fetch_youtube_channel(url, client)
            if "blog.naver.com" in lowered:
                return await _fetch_naver_blog(url, client)
            if "instagram.com" in lowered:
                return await _fetch_instagram(url, client)
    except Exception as e:
        logger.warning(f"[Influencer] 채널 데이터 수집 실패 url={url}: {e}")

    # 일반 페이지 폴백
    text = await _fetch_page_text(url)
    return text, None, ("partial" if text else "none")


async def _fetch_page_text(url: str) -> Optional[str]:
    """URL의 title/meta description/본문 앞부분을 간단히 추출. 실패해도 None 반환."""
    try:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            )
        }
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
        if resp.status_code >= 400:
            return None
        # 대용량 페이지 정규식 백트래킹 방지 — 앞 500KB만 사용
        html = resp.text[:500_000]
    except Exception as e:
        logger.warning(f"[Influencer] 페이지 fetch 실패 url={url}: {e}")
        return None

    parts = []
    title_m = re.search(r"<title[^>]*>([^<]*)</title>", html[:200_000], re.IGNORECASE)
    if title_m and title_m.group(1).strip():
        parts.append(f"[title] {_strip_html(title_m.group(1))}")

    # meta description / og:description — 태그 단위 선형 스캔 (DOTALL 백트래킹 회피)
    for tag in re.findall(r"<meta\b[^>]*>", html[:200_000], re.IGNORECASE):
        low = tag.lower()
        label = None
        if 'name="description"' in low or "name='description'" in low:
            label = "description"
        elif "og:description" in low:
            label = "og:description"
        if not label:
            continue
        m = re.search(r'content\s*=\s*["\']([^"\']*)["\']', tag, re.IGNORECASE)
        if m and m.group(1).strip():
            parts.append(f"[{label}] {_strip_html(m.group(1))}")

    # 본문 앞부분: 스크립트/스타일 제거 후 태그 스트립
    body = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.IGNORECASE)
    body = re.sub(r"<style[\s\S]*?</style>", " ", body, flags=re.IGNORECASE)
    body_text = _strip_html(body)
    if body_text:
        parts.append(f"[body] {body_text[:3000]}")

    combined = "\n".join(parts).strip()
    return combined[:3500] if combined else None


def _strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text or "")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


# ── GET /seedings ────────────────────────────────────────────────────────────

@router.get("/seedings")
async def list_seedings(
    channel: Optional[str] = Query(default=None),
    since: Optional[str] = Query(default=None, description="YYYY-MM-DD"),
    until: Optional[str] = Query(default=None, description="YYYY-MM-DD"),
    q: Optional[str] = Query(default=None, description="이름/제품 검색어"),
    limit: int = Query(default=200, ge=1, le=1000),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """인플루언서 시딩 목록 (seeded_at desc)."""
    query = select(InfluencerSeeding)
    if channel:
        query = query.where(InfluencerSeeding.channel == channel)
    if since:
        query = query.where(InfluencerSeeding.seeded_at >= _parse_date(since, "since"))
    if until:
        query = query.where(InfluencerSeeding.seeded_at <= _parse_date(until, "until"))
    if q:
        like = f"%{q.strip()}%"
        query = query.where(
            (InfluencerSeeding.name.ilike(like)) | (InfluencerSeeding.product.ilike(like))
        )
    query = query.order_by(InfluencerSeeding.seeded_at.desc(), InfluencerSeeding.id.desc()).limit(limit)

    rows = (await db.execute(query)).scalars().all()
    return {"seedings": [_serialize(r) for r in rows], "count": len(rows)}


# ── POST /seedings ───────────────────────────────────────────────────────────

class InfluencerSeedingCreate(BaseModel):
    name: str
    channel: str
    url: Optional[str] = None
    follower_count: Optional[int] = None
    cost: Optional[float] = 0
    seeded_at: str  # YYYY-MM-DD
    product: Optional[str] = None
    notes: Optional[str] = None


@router.post("/seedings")
async def create_seeding(
    payload: InfluencerSeedingCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """인플루언서 시딩 등록."""
    if not payload.name or not payload.name.strip():
        raise HTTPException(status_code=422, detail="name은 필수입니다.")
    if not payload.channel or not payload.channel.strip():
        raise HTTPException(status_code=422, detail="channel은 필수입니다.")

    seeded_at = _parse_date(payload.seeded_at)

    row = InfluencerSeeding(
        name=payload.name.strip(),
        channel=payload.channel.strip(),
        url=payload.url,
        follower_count=payload.follower_count,
        cost=payload.cost or 0,
        seeded_at=seeded_at,
        product=payload.product,
        notes=payload.notes,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _serialize(row)


# ── PUT /seedings/{id} ───────────────────────────────────────────────────────

class InfluencerSeedingUpdate(BaseModel):
    name: Optional[str] = None
    channel: Optional[str] = None
    url: Optional[str] = None
    follower_count: Optional[int] = None
    cost: Optional[float] = None
    seeded_at: Optional[str] = None
    product: Optional[str] = None
    notes: Optional[str] = None


@router.put("/seedings/{seeding_id}")
async def update_seeding(
    seeding_id: int,
    payload: InfluencerSeedingUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """인플루언서 시딩 부분 수정 (지정된 필드만 갱신)."""
    row = (
        await db.execute(select(InfluencerSeeding).where(InfluencerSeeding.id == seeding_id))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="시딩 항목을 찾을 수 없습니다.")

    data = payload.model_dump(exclude_none=True)
    if "seeded_at" in data:
        data["seeded_at"] = _parse_date(data["seeded_at"])

    for field, value in data.items():
        setattr(row, field, value)

    await db.commit()
    await db.refresh(row)
    return _serialize(row)


# ── DELETE /seedings/{id} ────────────────────────────────────────────────────

@router.delete("/seedings/{seeding_id}")
async def delete_seeding(
    seeding_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = (
        await db.execute(select(InfluencerSeeding).where(InfluencerSeeding.id == seeding_id))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="시딩 항목을 찾을 수 없습니다.")
    await db.delete(row)
    await db.commit()
    return {"status": "deleted", "id": seeding_id}


# ── POST /seedings/{id}/analyze ──────────────────────────────────────────────

@router.post("/seedings/{seeding_id}/analyze")
async def analyze_seeding(
    seeding_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """URL 페이지 텍스트 + 메타데이터를 바탕으로 AI가 타겟 고객층을 분석."""
    row = (
        await db.execute(select(InfluencerSeeding).where(InfluencerSeeding.id == seeding_id))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="시딩 항목을 찾을 수 없습니다.")

    page_text: Optional[str] = None
    fetched_follower: Optional[int] = None
    data_quality = "none"
    if row.url:
        page_text, fetched_follower, data_quality = await _fetch_channel_data(row.url, row.channel)

    # 실측 팔로워/구독자수는 AI 추정보다 우선
    if fetched_follower and not row.follower_count:
        row.follower_count = fetched_follower

    import asyncio

    from app.services.ai import ClaudeService

    claude = ClaudeService()
    try:
        # ClaudeService는 동기 SDK 클라이언트 — 이벤트 루프 블로킹 방지를 위해
        # 반드시 스레드에서 실행하고 상한 시간을 건다 (전체 서비스 행 방지).
        result = await asyncio.wait_for(
            asyncio.to_thread(
                lambda: asyncio.run(
                    claude.analyze_influencer_target(
                        name=row.name,
                        channel=row.channel,
                        url=row.url,
                        page_text=page_text,
                        follower_count=row.follower_count,
                        product=row.product,
                        notes=row.notes,
                        data_quality=data_quality,
                    )
                )
            ),
            timeout=120.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="AI 분석 시간 초과(120초). 잠시 후 다시 시도해주세요.")
    except Exception as e:
        logger.error(f"[Influencer] AI 분석 실패 id={seeding_id}: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=f"AI 분석 요청 실패: {e}")

    row.ai_target_segment = result.get("target_segment")
    row.ai_audience_summary = result.get("audience_summary")
    row.ai_analyzed_at = datetime.utcnow()

    follower_estimate = result.get("follower_estimate")
    if not row.follower_count and isinstance(follower_estimate, (int, float)):
        row.follower_count = int(follower_estimate)

    await db.commit()
    await db.refresh(row)
    return _serialize(row)


# ── GET /summary ─────────────────────────────────────────────────────────────

@router.get("/summary")
async def get_summary(
    months: int = Query(default=12, ge=1, le=60),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """채널별 / 타겟별 / 월별 시딩 비용 집계."""
    today = date.today()
    y, m = today.year, today.month
    for _ in range(months - 1):
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    range_start = date(y, m, 1)

    rows = (
        await db.execute(
            select(InfluencerSeeding).where(InfluencerSeeding.seeded_at >= range_start)
        )
    ).scalars().all()

    by_channel: dict[str, dict] = defaultdict(lambda: {"total_cost": 0.0, "count": 0})
    by_segment: dict[str, dict] = defaultdict(lambda: {"total_cost": 0.0, "count": 0})
    by_month: dict[str, dict] = defaultdict(lambda: {"total_cost": 0.0, "count": 0})

    total_cost = 0.0
    total_count = 0
    analyzed_count = 0

    for r in rows:
        cost = float(r.cost or 0)
        total_cost += cost
        total_count += 1
        if r.ai_target_segment:
            analyzed_count += 1

        by_channel[r.channel]["total_cost"] += cost
        by_channel[r.channel]["count"] += 1

        segment_key = _segment_key(r.ai_target_segment)
        by_segment[segment_key]["total_cost"] += cost
        by_segment[segment_key]["count"] += 1

        if r.seeded_at:
            month_key = f"{r.seeded_at.year:04d}-{r.seeded_at.month:02d}"
            by_month[month_key]["total_cost"] += cost
            by_month[month_key]["count"] += 1

    return {
        "by_channel": [
            {"channel": k, "total_cost": round(v["total_cost"], 2), "count": v["count"]}
            for k, v in sorted(by_channel.items(), key=lambda kv: -kv[1]["total_cost"])
        ],
        "by_segment": [
            {"segment": k, "total_cost": round(v["total_cost"], 2), "count": v["count"]}
            for k, v in sorted(by_segment.items(), key=lambda kv: -kv[1]["total_cost"])
        ],
        "by_month": [
            {"month": k, "total_cost": round(v["total_cost"], 2), "count": v["count"]}
            for k, v in sorted(by_month.items())
        ],
        "total": {
            "cost": round(total_cost, 2),
            "count": total_count,
            "analyzed_count": analyzed_count,
        },
    }


# ── GET /export ──────────────────────────────────────────────────────────────

@router.get("/export")
async def export_seedings(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """인플루언서 시딩 목록 + 채널별/타겟별 요약 xlsx 다운로드."""
    from io import BytesIO
    from urllib.parse import quote

    from fastapi.responses import StreamingResponse
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    rows = (
        await db.execute(select(InfluencerSeeding).order_by(InfluencerSeeding.seeded_at.desc()))
    ).scalars().all()

    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="2A2D35", end_color="2A2D35", fill_type="solid")
    center = Alignment(horizontal="center", vertical="center")
    bold = Font(bold=True)

    wb = Workbook()

    # ===== Sheet1: 시딩 목록 =====
    ws1 = wb.active
    ws1.title = "시딩 목록"
    headers1 = ["일자", "이름", "채널", "팔로워", "비용", "제품", "AI 타겟", "URL", "메모"]
    ws1.append(headers1)
    for col in range(1, len(headers1) + 1):
        cell = ws1.cell(row=1, column=col)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center

    for r in rows:
        ws1.append([
            r.seeded_at.isoformat() if r.seeded_at else "",
            r.name or "",
            r.channel or "",
            r.follower_count or "",
            r.cost or 0,
            r.product or "",
            r.ai_target_segment or "",
            r.url or "",
            r.notes or "",
        ])

    widths1 = [12, 18, 12, 10, 12, 18, 30, 40, 30]
    for i, w in enumerate(widths1, start=1):
        ws1.column_dimensions[get_column_letter(i)].width = w

    # ===== Sheet2: 채널별 요약 =====
    ws2 = wb.create_sheet("채널별 요약")
    headers2 = ["채널", "건수", "총비용"]
    ws2.append(headers2)
    for col in range(1, len(headers2) + 1):
        cell = ws2.cell(row=1, column=col)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center

    channel_agg: dict[str, dict] = defaultdict(lambda: {"count": 0, "cost": 0.0})
    for r in rows:
        channel_agg[r.channel]["count"] += 1
        channel_agg[r.channel]["cost"] += float(r.cost or 0)
    for channel, agg in sorted(channel_agg.items(), key=lambda kv: -kv[1]["cost"]):
        ws2.append([channel, agg["count"], agg["cost"]])
    for i, w in enumerate([16, 10, 14], start=1):
        ws2.column_dimensions[get_column_letter(i)].width = w

    # ===== Sheet3: 타겟별 요약 =====
    ws3 = wb.create_sheet("타겟별 요약")
    headers3 = ["AI 타겟", "건수", "총비용"]
    ws3.append(headers3)
    for col in range(1, len(headers3) + 1):
        cell = ws3.cell(row=1, column=col)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center

    segment_agg: dict[str, dict] = defaultdict(lambda: {"count": 0, "cost": 0.0})
    for r in rows:
        key = _segment_key(r.ai_target_segment)
        segment_agg[key]["count"] += 1
        segment_agg[key]["cost"] += float(r.cost or 0)
    for segment, agg in sorted(segment_agg.items(), key=lambda kv: -kv[1]["cost"]):
        ws3.append([segment, agg["count"], agg["cost"]])
    for i, w in enumerate([36, 10, 14], start=1):
        ws3.column_dimensions[get_column_letter(i)].width = w

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)

    today_str = datetime.utcnow().strftime("%Y%m%d")
    filename = f"인플루언서시딩_{today_str}.xlsx"
    quoted = quote(filename)

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quoted}",
        },
    )
