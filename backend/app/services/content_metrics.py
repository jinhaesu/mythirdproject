"""콘텐츠 지표 데일리 수집 — 활동 기록(링크 보유)의 조회수·좋아요·댓글 갱신+스냅샷.

- 유튜브 링크: Data API 배치 조회 (공개 데이터, 전 영상)
- 인스타 자사 게시물: 연결 토큰으로 자사 미디어 목록 → 숏코드 매칭
  (타인 인스타 게시물은 API 미제공 — 마지막 수기/시트 값 유지)
- 결과는 활동 기록 본문 갱신 + content_metric_snapshots(activity_id×date) upsert
- 매일 18:10 UTC(03:10 KST) 자동 실행 + 수동 갱신 버튼(/social/refresh-activity-metrics)
"""
import asyncio
import logging
import re
from datetime import date, datetime, timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import ContentMetricSnapshot, MarketingActivity
from app.models.user import User

logger = logging.getLogger(__name__)
settings = get_settings()

YT_BASE = "https://www.googleapis.com/youtube/v3"
IG_API_BASE = "https://graph.instagram.com"

_YT_ID_PATTERNS = [
    re.compile(r"(?:youtube\.com/watch\?(?:[^#]*&)?v=)([\w-]{11})"),
    re.compile(r"(?:youtu\.be/)([\w-]{11})"),
    re.compile(r"(?:youtube\.com/shorts/)([\w-]{11})"),
    re.compile(r"(?:youtube\.com/embed/)([\w-]{11})"),
]
_IG_CODE = re.compile(r"instagram\.com/(?:p|reel|reels|tv)/([\w-]+)")


def yt_video_id(value: str):
    v = (value or "").strip()
    if re.fullmatch(r"[\w-]{11}", v):
        return v
    for p in _YT_ID_PATTERNS:
        m = p.search(v)
        if m:
            return m.group(1)
    return None


def ig_shortcode(value: str):
    m = _IG_CODE.search(value or "")
    return m.group(1) if m else None


async def _snapshot(db: AsyncSession, activity: MarketingActivity, today: date) -> None:
    snap = (await db.execute(
        select(ContentMetricSnapshot).where(
            ContentMetricSnapshot.activity_id == activity.id,
            ContentMetricSnapshot.date == today,
        )
    )).scalar_one_or_none()
    if snap is None:
        snap = ContentMetricSnapshot(activity_id=activity.id, date=today)
        db.add(snap)
    snap.views = activity.views or 0
    snap.likes = activity.likes or 0
    snap.comments = activity.comments or 0


async def refresh_content_metrics(db: AsyncSession, months_back: int = 24) -> dict:
    """유튜브(전체)+인스타(자사 게시물) 지표 갱신 + 오늘자 스냅샷."""
    today = date.today()
    y, m = today.year, today.month - (months_back - 1)
    while m <= 0:
        m += 12
        y -= 1
    month_from = f"{y:04d}-{m:02d}"

    rows = (await db.execute(
        select(MarketingActivity).where(
            MarketingActivity.link.isnot(None), MarketingActivity.link != "",
            MarketingActivity.period_month >= month_from,
        )
    )).scalars().all()

    yt_targets = [(a, yt_video_id(a.link)) for a in rows if yt_video_id(a.link)]
    ig_targets = [(a, ig_shortcode(a.link)) for a in rows if ig_shortcode(a.link)]

    result = {"as_of": today.isoformat(), "yt_matched": len(yt_targets), "yt_updated": 0,
              "ig_matched": len(ig_targets), "ig_updated": 0, "snapshots": 0, "rows": []}

    # ── 유튜브 ──
    if settings.YOUTUBE_API_KEY and yt_targets:
        stats: dict = {}
        async with httpx.AsyncClient(timeout=60) as client:
            vids = list({v for _, v in yt_targets})
            for i in range(0, len(vids), 50):
                try:
                    r = await client.get(f"{YT_BASE}/videos", params={
                        "part": "statistics", "id": ",".join(vids[i:i + 50]),
                        "key": settings.YOUTUBE_API_KEY,
                    })
                    if r.status_code != 200:
                        continue
                    for item in r.json().get("items", []):
                        st = item.get("statistics", {})
                        stats[item["id"]] = {
                            "views": int(st.get("viewCount", 0)),
                            "likes": int(st["likeCount"]) if st.get("likeCount") is not None else None,
                            "comments": int(st["commentCount"]) if st.get("commentCount") is not None else None,
                        }
                except Exception as e:
                    logger.warning(f"[content-metrics] yt batch 실패: {e}")
        for a, vid in yt_targets:
            s = stats.get(vid)
            if s and s["views"] > 0:
                old = a.views or 0
                a.views = s["views"]
                if s["likes"] is not None:
                    a.likes = s["likes"]
                if s["comments"] is not None:
                    a.comments = s["comments"]
                a.metrics_as_of = today
                result["yt_updated"] += 1
                result["rows"].append({"id": a.id, "title": (a.product or a.channel or "")[:40],
                                       "old_views": old, "new_views": s["views"]})

    # ── 인스타 자사 게시물 (연결 토큰 있을 때만) ──
    ig_user = (await db.execute(
        select(User).where(User.ig_access_token.isnot(None), User.ig_access_token != "").limit(1)
    )).scalar_one_or_none()
    if ig_user and ig_targets:
        code_map: dict = {}
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                url = f"{IG_API_BASE}/me/media"
                params = {"fields": "id,permalink,like_count,comments_count,media_type",
                          "limit": 50, "access_token": ig_user.ig_access_token}
                for _page in range(6):  # 최대 300개
                    r = await client.get(url, params=params)
                    if r.status_code != 200:
                        break
                    body = r.json()
                    for mitem in body.get("data", []):
                        code = ig_shortcode(mitem.get("permalink") or "")
                        if code:
                            code_map[code] = mitem
                    nxt = (body.get("paging") or {}).get("next")
                    if not nxt:
                        break
                    url, params = nxt, {}
                # 릴스/비디오 조회수(views 인사이트)는 매칭된 것만 개별 조회
                for a, code in ig_targets:
                    mitem = code_map.get(code)
                    if not mitem:
                        continue
                    a.likes = mitem.get("like_count") or a.likes
                    a.comments = mitem.get("comments_count") or a.comments
                    if mitem.get("media_type") in ("VIDEO", "REELS"):
                        try:
                            ir = await client.get(f"{IG_API_BASE}/{mitem['id']}/insights", params={
                                "metric": "views", "access_token": ig_user.ig_access_token,
                            })
                            if ir.status_code == 200:
                                for ins in ir.json().get("data", []):
                                    vals = ins.get("values", [])
                                    if vals and vals[0].get("value"):
                                        a.views = int(vals[0]["value"])
                        except Exception:
                            pass
                    a.metrics_as_of = today
                    result["ig_updated"] += 1
        except Exception as e:
            logger.warning(f"[content-metrics] ig 수집 실패: {e}")

    # ── 오늘자 스냅샷 (링크 보유 전체 — 미갱신 행도 마지막 값으로 기록해 누적 연속성 유지) ──
    for a in rows:
        await _snapshot(db, a, today)
        result["snapshots"] += 1

    await db.commit()
    result["rows"] = result["rows"][:50]
    return result


async def run_content_metrics_loop():
    """매일 18:10 UTC(03:10 KST) 콘텐츠 지표 수집. 기동 3분 후 1회 선실행."""
    from app.db.database import AsyncSessionLocal

    await asyncio.sleep(180)
    while True:
        try:
            async with AsyncSessionLocal() as db:
                r = await refresh_content_metrics(db)
                logger.info(f"[content-metrics] daily: yt {r['yt_updated']}/{r['yt_matched']}, "
                            f"ig {r['ig_updated']}/{r['ig_matched']}, snapshots {r['snapshots']}")
        except Exception as e:
            logger.error(f"[content-metrics] loop 오류: {e}", exc_info=True)
        # 다음 18:10 UTC까지 대기
        now = datetime.utcnow()
        target = now.replace(hour=18, minute=10, second=0, microsecond=0)
        if target <= now:
            target += timedelta(days=1)
        await asyncio.sleep((target - now).total_seconds())
