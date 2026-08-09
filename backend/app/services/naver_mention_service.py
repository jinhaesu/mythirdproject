"""블로그/카페 언급량 수집 + 일별 스냅샷 저장."""
import logging
import re
from datetime import date, datetime
from typing import Any, Dict, List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.naver import api_hub

logger = logging.getLogger(__name__)

# 데일리 스냅샷 기본 추적 키워드 (브랜드)
DEFAULT_TRACK_KEYWORDS = ["널담", "널담은디저트"]

_TAG = re.compile(r"</?b>|<[^>]+>")


def clean_text(text: str) -> str:
    import html
    return _TAG.sub("", html.unescape(text or "")).strip()


async def fetch_mentions(keyword: str, display: int = 10) -> Dict[str, Any]:
    """블로그+카페 언급 총량과 최근 게시물. 실패 채널은 total=-1."""
    result: Dict[str, Any] = {"keyword": keyword, "blog": None, "cafe": None}
    for kind, key in (("blog", "blog"), ("cafearticle", "cafe")):
        r = await api_hub.search(kind, keyword, display=display, sort="date")
        if not r["ok"]:
            result[key] = {"total": -1, "items": [], "error": r.get("error")}
            continue
        data = r["data"]
        items = [
            {
                "title": clean_text(it.get("title", "")),
                "link": it.get("link", ""),
                "description": clean_text(it.get("description", "")),
                "date": it.get("postdate", ""),
                "blogger": it.get("bloggername", "") or it.get("cafename", ""),
            }
            for it in data.get("items", [])
        ]
        result[key] = {"total": int(data.get("total", 0)), "items": items}
    return result


async def upsert_mention_snapshot(
    db: AsyncSession, keyword: str, blog_total: int, cafe_total: int
) -> None:
    """(keyword, 오늘) 스냅샷 upsert. total<0(수집실패)은 저장하지 않는다."""
    from app.models.naver_insight import NaverMentionDaily

    if blog_total < 0 and cafe_total < 0:
        return
    today = date.today()
    existing_q = await db.execute(
        select(NaverMentionDaily).where(
            NaverMentionDaily.keyword == keyword,
            NaverMentionDaily.date == today,
        )
    )
    existing = existing_q.scalar_one_or_none()
    if existing:
        if blog_total >= 0:
            existing.blog_total = blog_total
        if cafe_total >= 0:
            existing.cafe_total = cafe_total
        existing.collected_at = datetime.utcnow()
    else:
        db.add(NaverMentionDaily(
            keyword=keyword,
            date=today,
            blog_total=max(blog_total, 0),
            cafe_total=max(cafe_total, 0),
        ))
    await db.commit()


async def capture_daily_snapshots(db: AsyncSession, keywords: List[str] = None) -> int:
    """추적 키워드들의 오늘자 언급량 스냅샷 저장. 반환: 저장 건수."""
    if not api_hub.is_configured():
        return 0
    saved = 0
    for kw in (keywords or DEFAULT_TRACK_KEYWORDS):
        try:
            m = await fetch_mentions(kw, display=1)
            blog_total = m["blog"]["total"] if m["blog"] else -1
            cafe_total = m["cafe"]["total"] if m["cafe"] else -1
            await upsert_mention_snapshot(db, kw, blog_total, cafe_total)
            saved += 1
        except Exception as exc:
            logger.warning(f"[NaverMention] 스냅샷 실패 '{kw}': {exc}")
    return saved
