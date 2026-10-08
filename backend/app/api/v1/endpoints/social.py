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
from datetime import date, datetime, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
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
#
# 경로 2개:
#  A. (우선) Instagram API with Instagram Login — 인스타 계정으로 직접 OAuth.
#     base graph.instagram.com, scope instagram_business_basic·manage_insights·manage_comments.
#     구형 instagram_basic이 FB Login에서 Invalid Scopes로 막혀 이쪽이 정식 경로(2026-10-08).
#  B. (폴백) 구형 FB Login 토큰 + meta_ig_account_id — 앱에 권한 있을 때만 동작.

IG_OAUTH_BASE = "https://www.instagram.com/oauth/authorize"
IG_API_BASE = "https://graph.instagram.com"
IG_SCOPES = "instagram_business_basic,instagram_business_manage_insights,instagram_business_manage_comments"


def _ig_redirect_uri() -> str:
    return "https://web-production-d7b11.up.railway.app/api/v1/social/instagram/auth/callback"


@router.get("/instagram/auth/start")
async def instagram_auth_start(current_user: User = Depends(get_current_user)):
    if not settings.INSTAGRAM_APP_ID:
        raise HTTPException(status_code=503,
                            detail="INSTAGRAM_APP_ID가 설정되지 않았습니다 — Railway Variables에 입력하세요.")
    url = (f"{IG_OAUTH_BASE}?client_id={settings.INSTAGRAM_APP_ID}"
           f"&redirect_uri={_ig_redirect_uri()}&response_type=code"
           f"&scope={IG_SCOPES}&state={current_user.id}")
    return {"auth_url": url, "redirect_uri": _ig_redirect_uri()}


@router.get("/instagram/auth/callback")
async def instagram_auth_callback(
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    from fastapi.responses import RedirectResponse
    front = settings.FRONTEND_URL or "https://marketing.nuldam.com"
    if error or not code or not state:
        return RedirectResponse(f"{front}/?ig=error&reason={error or 'no_code'}")
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            # 단기 토큰 교환
            tr = await client.post("https://api.instagram.com/oauth/access_token", data={
                "client_id": settings.INSTAGRAM_APP_ID,
                "client_secret": settings.INSTAGRAM_APP_SECRET,
                "grant_type": "authorization_code",
                "redirect_uri": _ig_redirect_uri(),
                "code": code,
            })
            if tr.status_code != 200:
                logger.warning(f"[IG] token exchange 실패: {tr.status_code} {tr.text[:200]}")
                return RedirectResponse(f"{front}/?ig=error&reason=token_exchange")
            td = tr.json()
            short_token = td.get("access_token")
            ig_user_id = str(td.get("user_id") or "")
            # 장기 토큰(60일) 교환
            lr = await client.get(f"{IG_API_BASE}/access_token", params={
                "grant_type": "ig_exchange_token",
                "client_secret": settings.INSTAGRAM_APP_SECRET,
                "access_token": short_token,
            })
            token = short_token
            expires_in = 3600
            if lr.status_code == 200:
                token = lr.json().get("access_token", short_token)
                expires_in = lr.json().get("expires_in", 5184000)
        user = (await db.execute(select(User).where(User.id == int(state)))).scalar_one_or_none()
        if not user:
            return RedirectResponse(f"{front}/?ig=error&reason=user_not_found")
        user.ig_user_id = ig_user_id
        user.ig_access_token = token
        user.ig_token_expires_at = datetime.utcnow() + timedelta(seconds=int(expires_in))
        await db.commit()
        return RedirectResponse(f"{front}/?ig=connected")
    except Exception as e:
        logger.error(f"[IG] callback 오류: {e}", exc_info=True)
        return RedirectResponse(f"{front}/?ig=error&reason=exception")


class IgTokenIn(BaseModel):
    access_token: str = Field(..., min_length=20)


@router.post("/instagram/token")
async def instagram_set_token(
    payload: IgTokenIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """콘솔에서 생성한 Instagram 액세스 토큰 직접 등록 (OAuth·env 불필요).

    developers.facebook.com 앱 › Instagram › API 설정에서 계정 추가 후
    '토큰 생성'으로 받은 장기 토큰을 붙여넣는 방식 — /me 호출로 유효성 검증.
    """
    token = payload.access_token.strip()
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(f"{IG_API_BASE}/me", params={
            "fields": "user_id,username,followers_count", "access_token": token,
        })
    if r.status_code != 200:
        detail = r.json().get("error", {}).get("message", r.text[:200]) if r.text else str(r.status_code)
        raise HTTPException(status_code=422, detail=f"토큰 검증 실패: {detail}")
    me = r.json()
    current_user.ig_user_id = str(me.get("user_id") or me.get("id") or "")
    current_user.ig_access_token = token
    # 콘솔 발급 장기 토큰은 60일 — 만료일을 모르므로 50일로 잡고 자동 연장에 맡긴다
    current_user.ig_token_expires_at = datetime.utcnow() + timedelta(days=50)
    await db.commit()
    return {"connected": True, "username": me.get("username"),
            "followers": me.get("followers_count")}


@router.delete("/instagram/token")
async def instagram_disconnect(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    current_user.ig_user_id = None
    current_user.ig_access_token = None
    current_user.ig_token_expires_at = None
    await db.commit()
    return {"connected": False}


@router.get("/instagram/status")
async def instagram_status(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _ig_login_user(db, current_user)
    legacy = bool(current_user.meta_access_token and current_user.meta_ig_account_id)
    return {
        "connected": bool(user),
        "mode": "instagram_login" if user else ("facebook_login" if legacy else None),
        "expires_at": user.ig_token_expires_at.isoformat() if user and user.ig_token_expires_at else None,
        "app_configured": bool(settings.INSTAGRAM_APP_ID),
    }


async def _ig_login_user(db: AsyncSession, current_user: User) -> Optional[User]:
    """인스타 로그인 토큰 보유 사용자 — 본인 우선, 없으면 아무 연결 사용자."""
    if current_user.ig_access_token and current_user.ig_user_id:
        return current_user
    return (await db.execute(
        select(User).where(
            User.ig_access_token.isnot(None), User.ig_access_token != "",
        ).limit(1)
    )).scalar_one_or_none()


async def _ig_login_token(db: AsyncSession, user: User) -> str:
    """장기 토큰 반환 — 만료 10일 전이면 자동 연장(ig_refresh_token)."""
    if user.ig_token_expires_at and user.ig_token_expires_at < datetime.utcnow() + timedelta(days=10):
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.get(f"{IG_API_BASE}/refresh_access_token", params={
                    "grant_type": "ig_refresh_token", "access_token": user.ig_access_token,
                })
            if r.status_code == 200:
                user.ig_access_token = r.json().get("access_token", user.ig_access_token)
                user.ig_token_expires_at = datetime.utcnow() + timedelta(
                    seconds=int(r.json().get("expires_in", 5184000)))
                await db.commit()
        except Exception as e:
            logger.warning(f"[IG] 토큰 연장 실패(기존 토큰 계속 사용): {e}")
    return user.ig_access_token


async def _ig_context(db: AsyncSession, current_user: User):
    """(폴백 경로 B) 구형 FB 토큰·IG 계정 ID — 본인 우선, 없으면 아무 연결 사용자."""
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
            detail="인스타그램 계정이 연결돼 있지 않습니다 — 소셜 채널 탭의 '인스타 계정 연결'을 사용하세요.",
        )
    return user.meta_access_token, user.meta_ig_account_id


@router.get("/instagram/media")
async def instagram_media(
    limit: int = Query(default=24, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """자사 IG 계정 최근 미디어 + 좋아요/댓글수 + (가능하면) 도달·조회 인사이트."""
    # 경로 A: 인스타 로그인 (신체계) 우선
    ig_user = await _ig_login_user(db, current_user)
    if ig_user:
        token = await _ig_login_token(db, ig_user)
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(f"{IG_API_BASE}/me/media", params={
                "fields": "id,caption,media_type,media_url,permalink,thumbnail_url,"
                          "timestamp,like_count,comments_count",
                "limit": limit, "access_token": token,
            })
            if r.status_code != 200:
                detail = r.json().get("error", {}).get("message", r.text[:200]) if r.text else str(r.status_code)
                raise HTTPException(status_code=502, detail=f"Instagram API 오류: {detail}")
            media = r.json().get("data", [])
            for m in media:
                try:
                    metric = "reach,views" if m.get("media_type") in ("VIDEO", "REELS") else "reach"
                    ir = await client.get(f"{IG_API_BASE}/{m['id']}/insights", params={
                        "metric": metric, "access_token": token,
                    })
                    if ir.status_code == 200:
                        for ins in ir.json().get("data", []):
                            vals = ins.get("values", [])
                            if vals:
                                m[ins["name"]] = vals[0].get("value")
                except Exception:
                    pass
            account = {}
            pr = await client.get(f"{IG_API_BASE}/me", params={
                "fields": "username,followers_count,media_count", "access_token": token,
            })
            if pr.status_code == 200:
                account = pr.json()
        return {"as_of": datetime.utcnow().isoformat(), "mode": "instagram_login",
                "account": account, "media": media}

    # 경로 B: 구형 FB Login 폴백
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
    ig_user = await _ig_login_user(db, current_user)
    if ig_user:
        token = await _ig_login_token(db, ig_user)
        base = IG_API_BASE
    else:
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
