"""소셜 채널 오가닉 데이터 — 유튜브(공개)·인스타그램(자사 계정) 조회/댓글/인사이트.

- 유튜브: Data API v3 (YOUTUBE_API_KEY, 공개 데이터라 영상·채널 누구든 조회 가능)
  · GET /social/youtube/video?video=        — 영상 통계 (URL/ID 모두 허용)
  · GET /social/youtube/video/comments      — 상위 댓글
  · GET /social/youtube/channel?channel=    — 채널 통계 + 최근 업로드별 통계
- 인스타그램: Graph API (연결된 Meta 토큰 + IG 비즈니스 계정, 자사 계정만)
  · GET /social/instagram/media             — 최근 미디어 + 좋아요/댓글수(+인사이트)
  · GET /social/instagram/media/{id}/comments — 게시물 댓글
  ⚠️ instagram_basic/instagram_manage_insights 스코프 필요 — 2026-10-06 이전
  연결 토큰은 Meta 재연동해야 동작.
- POST /social/refresh-activity-metrics — 활동 기록의 유튜브 링크 행 조회수 일괄 갱신
"""
import logging
import re
from datetime import date, datetime
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_user
from app.core.config import get_settings
from app.db.database import get_db
from app.models import MarketingActivity
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter()
settings = get_settings()

YT_BASE = "https://www.googleapis.com/youtube/v3"

_YT_ID_PATTERNS = [
    re.compile(r"(?:youtube\.com/watch\?(?:[^#]*&)?v=)([\w-]{11})"),
    re.compile(r"(?:youtu\.be/)([\w-]{11})"),
    re.compile(r"(?:youtube\.com/shorts/)([\w-]{11})"),
    re.compile(r"(?:youtube\.com/embed/)([\w-]{11})"),
]


def _yt_video_id(value: str) -> Optional[str]:
    """URL 또는 ID 문자열에서 유튜브 영상 ID 추출."""
    v = (value or "").strip()
    if re.fullmatch(r"[\w-]{11}", v):
        return v
    for p in _YT_ID_PATTERNS:
        m = p.search(v)
        if m:
            return m.group(1)
    return None


def _require_yt_key() -> str:
    if not settings.YOUTUBE_API_KEY:
        raise HTTPException(status_code=503, detail="YOUTUBE_API_KEY가 설정되지 않았습니다.")
    return settings.YOUTUBE_API_KEY


def _video_out(item: dict) -> dict:
    sn, st = item.get("snippet", {}), item.get("statistics", {})
    return {
        "video_id": item.get("id"),
        "title": sn.get("title"),
        "channel": sn.get("channelTitle"),
        "published_at": sn.get("publishedAt"),
        "views": int(st.get("viewCount", 0)),
        "likes": int(st.get("likeCount", 0)) if st.get("likeCount") is not None else None,
        "comments": int(st.get("commentCount", 0)) if st.get("commentCount") is not None else None,
        "url": f"https://www.youtube.com/watch?v={item.get('id')}",
        "thumbnail": (sn.get("thumbnails", {}).get("medium") or {}).get("url"),
    }


# ─── 유튜브 ──────────────────────────────────────────────────────────────────

@router.get("/youtube/video")
async def youtube_video(
    video: str = Query(..., description="영상 URL 또는 11자 ID"),
    current_user: User = Depends(get_current_user),
):
    key = _require_yt_key()
    vid = _yt_video_id(video)
    if not vid:
        raise HTTPException(status_code=422, detail="유튜브 영상 URL/ID를 인식하지 못했습니다.")
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(f"{YT_BASE}/videos", params={
            "part": "snippet,statistics", "id": vid, "key": key,
        })
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"YouTube API 오류: {r.status_code}")
    items = r.json().get("items", [])
    if not items:
        raise HTTPException(status_code=404, detail="영상을 찾을 수 없습니다 (비공개/삭제 가능).")
    return {"as_of": datetime.utcnow().isoformat(), **_video_out(items[0])}


@router.get("/youtube/video/comments")
async def youtube_video_comments(
    video: str = Query(...),
    limit: int = Query(default=20, ge=1, le=100),
    order: str = Query(default="relevance"),  # relevance|time
    current_user: User = Depends(get_current_user),
):
    key = _require_yt_key()
    vid = _yt_video_id(video)
    if not vid:
        raise HTTPException(status_code=422, detail="유튜브 영상 URL/ID를 인식하지 못했습니다.")
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(f"{YT_BASE}/commentThreads", params={
            "part": "snippet", "videoId": vid, "maxResults": limit,
            "order": order if order in ("relevance", "time") else "relevance",
            "textFormat": "plainText", "key": key,
        })
    if r.status_code == 403:
        return {"video_id": vid, "comments": [], "disabled": True,
                "note": "댓글이 비활성화됐거나 접근이 제한된 영상입니다."}
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"YouTube API 오류: {r.status_code}")
    out = []
    for th in r.json().get("items", []):
        top = th.get("snippet", {}).get("topLevelComment", {}).get("snippet", {})
        out.append({
            "author": top.get("authorDisplayName"),
            "text": top.get("textDisplay"),
            "likes": top.get("likeCount", 0),
            "replies": th.get("snippet", {}).get("totalReplyCount", 0),
            "published_at": top.get("publishedAt"),
        })
    return {"video_id": vid, "comments": out, "disabled": False,
            "as_of": datetime.utcnow().isoformat()}


@router.get("/youtube/channel")
async def youtube_channel(
    channel: str = Query(..., description="채널 핸들(@...), 채널 ID(UC...) 또는 채널 URL"),
    videos: int = Query(default=10, ge=1, le=25),
    current_user: User = Depends(get_current_user),
):
    """채널 통계 + 최근 업로드 영상별 조회수·좋아요·댓글수."""
    key = _require_yt_key()
    c = channel.strip()
    m = re.search(r"youtube\.com/(?:channel/)?(@?[\w.-]+)", c)
    if m:
        c = m.group(1)
    params: dict = {"part": "snippet,statistics,contentDetails", "key": key}
    if re.fullmatch(r"UC[\w-]{22}", c):
        params["id"] = c
    else:
        params["forHandle"] = c if c.startswith("@") else f"@{c}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{YT_BASE}/channels", params=params)
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail=f"YouTube API 오류: {r.status_code}")
        items = r.json().get("items", [])
        if not items:
            raise HTTPException(status_code=404, detail="채널을 찾을 수 없습니다.")
        ch = items[0]
        uploads = ch.get("contentDetails", {}).get("relatedPlaylists", {}).get("uploads")
        recent = []
        if uploads:
            pl = await client.get(f"{YT_BASE}/playlistItems", params={
                "part": "contentDetails", "playlistId": uploads,
                "maxResults": videos, "key": key,
            })
            vids = [i["contentDetails"]["videoId"] for i in pl.json().get("items", [])] \
                if pl.status_code == 200 else []
            if vids:
                vr = await client.get(f"{YT_BASE}/videos", params={
                    "part": "snippet,statistics", "id": ",".join(vids), "key": key,
                })
                if vr.status_code == 200:
                    recent = [_video_out(i) for i in vr.json().get("items", [])]
    st, sn = ch.get("statistics", {}), ch.get("snippet", {})
    return {
        "as_of": datetime.utcnow().isoformat(),
        "channel_id": ch.get("id"),
        "title": sn.get("title"),
        "subscribers": int(st.get("subscriberCount", 0)) if not st.get("hiddenSubscriberCount") else None,
        "total_views": int(st.get("viewCount", 0)),
        "video_count": int(st.get("videoCount", 0)),
        "recent_videos": recent,
    }


# ─── 인스타그램 (자사 계정) ───────────────────────────────────────────────────

async def _ig_context(db: AsyncSession, current_user: User):
    """IG 토큰·계정 ID — 본인 연결 우선, 없으면 연결된 아무 사용자 폴백."""
    user = current_user
    if not (user.meta_access_token and user.meta_ig_account_id):
        user = (await db.execute(
            select(User).where(
                User.meta_access_token.isnot(None), User.meta_access_token != "",
                User.meta_ig_account_id.isnot(None), User.meta_ig_account_id != "",
            ).limit(1)
        )).scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=409,
            detail="인스타그램 비즈니스 계정이 연결돼 있지 않습니다 — 우측 상단 Meta 연동에서 재연결하세요.",
        )
    return user.meta_access_token, user.meta_ig_account_id


@router.get("/instagram/media")
async def instagram_media(
    limit: int = Query(default=24, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """자사 IG 계정 최근 미디어 + 좋아요/댓글수 + (가능하면) 도달·조회 인사이트."""
    token, ig_id = await _ig_context(db, current_user)
    base = f"{settings.META_GRAPH_API_BASE}/{settings.META_API_VERSION}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{base}/{ig_id}/media", params={
            "fields": "id,caption,media_type,media_url,permalink,thumbnail_url,"
                      "timestamp,like_count,comments_count",
            "limit": limit, "access_token": token,
        })
        if r.status_code != 200:
            detail = r.json().get("error", {}).get("message", r.text[:200]) if r.text else str(r.status_code)
            raise HTTPException(
                status_code=502,
                detail=f"Instagram API 오류 — 재연동(instagram_basic 권한)이 필요할 수 있습니다: {detail}",
            )
        media = r.json().get("data", [])
        # 인사이트(도달·조회)는 권한/미디어 타입에 따라 거부될 수 있어 방어적으로
        for m in media:
            try:
                metric = "reach,views" if m.get("media_type") in ("VIDEO", "REELS") else "reach"
                ir = await client.get(f"{base}/{m['id']}/insights", params={
                    "metric": metric, "access_token": token,
                })
                if ir.status_code == 200:
                    for ins in ir.json().get("data", []):
                        vals = ins.get("values", [])
                        if vals:
                            m[ins["name"]] = vals[0].get("value")
            except Exception:
                pass
    account_username = None
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            pr = await client.get(f"{base}/{ig_id}", params={
                "fields": "username,followers_count,media_count", "access_token": token,
            })
        if pr.status_code == 200:
            p = pr.json()
            account_username = p.get("username")
            return {"as_of": datetime.utcnow().isoformat(), "account": p, "media": media}
    except Exception:
        pass
    return {"as_of": datetime.utcnow().isoformat(),
            "account": {"username": account_username}, "media": media}


@router.get("/instagram/media/{media_id}/comments")
async def instagram_media_comments(
    media_id: str,
    limit: int = Query(default=30, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    token, _ = await _ig_context(db, current_user)
    base = f"{settings.META_GRAPH_API_BASE}/{settings.META_API_VERSION}"
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(f"{base}/{media_id}/comments", params={
            "fields": "username,text,like_count,timestamp", "limit": limit,
            "access_token": token,
        })
    if r.status_code != 200:
        detail = r.json().get("error", {}).get("message", r.text[:200]) if r.text else str(r.status_code)
        raise HTTPException(status_code=502, detail=f"Instagram 댓글 조회 오류: {detail}")
    return {"media_id": media_id, "comments": r.json().get("data", []),
            "as_of": datetime.utcnow().isoformat()}


# ─── 활동 기록 조회수 자동 갱신 (유튜브 링크) ─────────────────────────────────

@router.post("/refresh-activity-metrics")
async def refresh_activity_metrics(
    months_back: int = Query(default=3, ge=1, le=24),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """활동 기록 중 link가 유튜브인 행의 views를 현재 조회수로 갱신(metrics_as_of=오늘).

    50개씩 videos API 배치 조회 — 최근 months_back개월의 실적(actual) 행만 대상.
    """
    key = _require_yt_key()
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

    targets: list[tuple[MarketingActivity, str]] = []
    for a in rows:
        vid = _yt_video_id(a.link or "")
        if vid:
            targets.append((a, vid))
    if not targets:
        return {"updated": 0, "matched": 0, "note": "유튜브 링크가 있는 활동 기록이 없습니다."}

    stats: dict[str, dict] = {}
    async with httpx.AsyncClient(timeout=30) as client:
        vids = list({v for _, v in targets})
        for i in range(0, len(vids), 50):
            r = await client.get(f"{YT_BASE}/videos", params={
                "part": "statistics", "id": ",".join(vids[i:i + 50]), "key": key,
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

    updated = []
    for a, vid in targets:
        s = stats.get(vid)
        if s and s["views"] > 0:
            old = a.views or 0
            a.views = s["views"]
            if s["likes"] is not None:
                a.likes = s["likes"]
            if s["comments"] is not None:
                a.comments = s["comments"]
            a.metrics_as_of = today
            updated.append({"id": a.id, "title": (a.product or a.channel or "")[:40],
                            "old_views": old, "new_views": s["views"]})
    await db.commit()
    return {
        "matched": len(targets), "fetched": len(stats), "updated": len(updated),
        "as_of": today.isoformat(), "rows": updated[:50],
    }
