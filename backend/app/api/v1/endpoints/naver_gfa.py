"""네이버 GFA(성과형 디스플레이) 오픈API — 올바른 구현 (2026-09-30 전면 재작성).

구 gfa_api.py는 존재하지 않는 api.naver.com/displayad/v3(HMAC)를 호출하던
잘못된 코드였음. 실제 스펙(naver-ad-api.github.io/developers):
  - Base: https://openapi.naver.com/v1/ad-api/1.0
  - 인증: 네이버 로그인 OAuth Bearer (개발자센터 앱 NAVER_CLIENT_ID/SECRET,
    광고계정 권한이 있는 네이버 계정으로 동의)
  - 성과: /adAccounts/{no}/performance/past/{aggregationType}
    (startDate/endDate, timeUnit=daily; 필드 impCount/clickCount/sales/convCount/convSales)

이 라우터는 router.py에서 naver_analytics보다 먼저 /naver prefix로 등록되어
기존 프론트 경로(/naver/gfa/overview 등)를 그대로 대체한다.
"""
import logging
import secrets as _secrets
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_user
from app.core.config import get_settings
from app.db.database import get_db
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter()
settings = get_settings()

GFA_BASE = "https://openapi.naver.com/v1/ad-api/1.0"
NID_TOKEN_URL = "https://nid.naver.com/oauth2.0/token"
NID_AUTH_URL = "https://nid.naver.com/oauth2.0/authorize"

# state 토큰 → user_id (콜백은 무인증이라 state로 복원; 프로세스 메모리로 충분)
_oauth_states: Dict[str, int] = {}


async def _get_gfa_user(current_user: User, db: AsyncSession) -> Optional[User]:
    """GFA 토큰 보유 유저 (본인 우선, 없으면 공유 계정)."""
    if current_user.naver_gfa_refresh_token:
        return current_user
    return (await db.execute(
        select(User).where(
            User.naver_gfa_refresh_token.isnot(None),
            User.naver_gfa_refresh_token != "",
        ).order_by(User.id)
    )).scalars().first()


async def _ensure_token(user: User, db: AsyncSession) -> str:
    """access token 반환 — 만료 5분 전이면 refresh_token으로 갱신."""
    now = datetime.utcnow()
    if (user.naver_gfa_access_token and user.naver_gfa_token_expires_at
            and user.naver_gfa_token_expires_at - now > timedelta(minutes=5)):
        return user.naver_gfa_access_token
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(NID_TOKEN_URL, params={
            "grant_type": "refresh_token",
            "client_id": settings.NAVER_CLIENT_ID,
            "client_secret": settings.NAVER_CLIENT_SECRET,
            "refresh_token": user.naver_gfa_refresh_token,
        })
    data = resp.json()
    if "access_token" not in data:
        logger.error(f"[GFA] token refresh failed: {str(data)[:200]}")
        raise HTTPException(status_code=400, detail="네이버 GFA 토큰 갱신 실패 — 재연결이 필요합니다")
    user.naver_gfa_access_token = data["access_token"]
    user.naver_gfa_token_expires_at = now + timedelta(seconds=int(data.get("expires_in", 3600)))
    await db.commit()
    return user.naver_gfa_access_token


async def _gfa_get(user: User, db: AsyncSession, path: str, params: Optional[dict] = None) -> Any:
    token = await _ensure_token(user, db)
    headers = {"Authorization": f"Bearer {token}"}
    if user.naver_gfa_manager_account_no:
        headers["AccessManagerAccountNo"] = str(user.naver_gfa_manager_account_no)
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(f"{GFA_BASE}{path}", headers=headers, params=params)
    if resp.status_code >= 400:
        snippet = resp.text[:300]
        logger.warning(f"[GFA] GET {path} -> {resp.status_code}: {snippet}")
        raise HTTPException(status_code=502, detail=f"GFA API {resp.status_code}: {snippet}")
    return resp.json()


def _resolve_range(date_range: str, start_date: Optional[str], end_date: Optional[str]):
    today = date.today()
    if date_range == "custom" and start_date and end_date:
        return date.fromisoformat(start_date), date.fromisoformat(end_date)
    if date_range == "today":
        return today, today
    if date_range == "yesterday":
        y = today - timedelta(days=1)
        return y, y
    if date_range == "last_14_days":
        return today - timedelta(days=13), today
    if date_range == "last_30_days":
        return today - timedelta(days=29), today
    if date_range == "this_month":
        return today.replace(day=1), today
    return today - timedelta(days=6), today  # last_7_days 기본


def _rows_of(payload: Any) -> List[dict]:
    """응답에서 성과 행 리스트 추출 (페이로드 구조 방어적 처리)."""
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("content", "items", "data", "performances", "list"):
            v = payload.get(key)
            if isinstance(v, list):
                return v
            if isinstance(v, dict):
                inner = _rows_of(v)
                if inner:
                    return inner
    return []


def _n(row: dict, *keys) -> float:
    for k in keys:
        v = row.get(k)
        if v is not None:
            try:
                return float(v)
            except (TypeError, ValueError):
                pass
    return 0.0


def _metric_sum(rows: List[dict]) -> Dict[str, float]:
    out = {"spend": 0.0, "impressions": 0.0, "clicks": 0.0, "conversions": 0.0, "conv_sales": 0.0}
    for r in rows:
        out["spend"] += _n(r, "sales", "cost", "adCost")
        out["impressions"] += _n(r, "impCount", "impCnt", "impressions")
        out["clicks"] += _n(r, "clickCount", "clickCnt", "clicks")
        out["conversions"] += _n(r, "convCount", "conversions")
        out["conv_sales"] += _n(r, "convSales", "convSalesAmt")
    return out


def _derive(m: Dict[str, float]) -> Dict[str, Any]:
    spend, imp, clk = m["spend"], m["impressions"], m["clicks"]
    return {
        **{k: round(v, 2) for k, v in m.items()},
        "ctr": round(clk / imp * 100, 2) if imp else 0,
        "cpc": round(spend / clk, 0) if clk else 0,
        "cpm": round(spend / imp * 1000, 0) if imp else 0,
        "roas": round(m["conv_sales"] / spend, 2) if spend else 0,
    }


# ─── OAuth 연결 ──────────────────────────────────────────────────────────────

@router.get("/gfa/auth/start")
async def gfa_auth_start(current_user: User = Depends(get_current_user)):
    if not settings.NAVER_CLIENT_ID:
        raise HTTPException(status_code=400, detail="NAVER_CLIENT_ID 미설정")
    state = _secrets.token_urlsafe(16)
    _oauth_states[state] = current_user.id
    redirect_uri = f"{settings.BACKEND_URL.rstrip('/')}/api/v1/naver/gfa/auth/callback"
    auth_url = (
        f"{NID_AUTH_URL}?response_type=code&client_id={settings.NAVER_CLIENT_ID}"
        f"&redirect_uri={redirect_uri}&state={state}"
    )
    return {"auth_url": auth_url, "redirect_uri": redirect_uri}


@router.get("/gfa/auth/callback")
async def gfa_auth_callback(
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    front = settings.FRONTEND_URL.rstrip("/")
    user_id = _oauth_states.pop(state or "", None)
    if error or not code or not user_id:
        return RedirectResponse(f"{front}/?gfa=error&reason={error or 'invalid_state'}")
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(NID_TOKEN_URL, params={
            "grant_type": "authorization_code",
            "client_id": settings.NAVER_CLIENT_ID,
            "client_secret": settings.NAVER_CLIENT_SECRET,
            "code": code,
            "state": state,
        })
    data = resp.json()
    if "access_token" not in data:
        logger.error(f"[GFA] code exchange failed: {str(data)[:200]}")
        return RedirectResponse(f"{front}/?gfa=error&reason=token_exchange_failed")

    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        return RedirectResponse(f"{front}/?gfa=error&reason=user_not_found")
    user.naver_gfa_access_token = data["access_token"]
    user.naver_gfa_refresh_token = data.get("refresh_token") or user.naver_gfa_refresh_token
    user.naver_gfa_token_expires_at = datetime.utcnow() + timedelta(seconds=int(data.get("expires_in", 3600)))
    user.naver_gfa_connected = True
    await db.commit()

    # 광고계정 자동 선택 (1개면 바로, 여러 개면 첫 번째 — /gfa/account로 변경 가능)
    try:
        accounts = _rows_of(await _gfa_get(user, db, "/adAccounts", {"size": 100}))
        if accounts and not user.naver_gfa_ad_account_no:
            no = accounts[0].get("adAccountNo") or accounts[0].get("no") or accounts[0].get("id")
            user.naver_gfa_ad_account_no = str(no) if no else None
            await db.commit()
        logger.info(f"[GFA] connected user={user.id}, accounts={len(accounts)}")
    except Exception as e:
        logger.warning(f"[GFA] ad account autoselect failed: {e}")

    return RedirectResponse(f"{front}/?gfa=connected")


@router.get("/gfa/status")
async def gfa_status(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    u = await _get_gfa_user(current_user, db)
    return {
        "connected": bool(u),
        "ad_account_no": u.naver_gfa_ad_account_no if u else None,
        "manager_account_no": u.naver_gfa_manager_account_no if u else None,
        "token_expires_at": u.naver_gfa_token_expires_at.isoformat() if u and u.naver_gfa_token_expires_at else None,
    }


@router.get("/gfa/accounts")
async def gfa_accounts(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    u = await _get_gfa_user(current_user, db)
    if not u:
        raise HTTPException(status_code=400, detail="네이버 GFA가 연결되지 않았습니다")
    return {
        "ad_accounts": _rows_of(await _gfa_get(u, db, "/adAccounts", {"size": 100})),
        "manager_accounts": _rows_of(await _gfa_get(u, db, "/managerAccounts", {"size": 100})),
        "selected": u.naver_gfa_ad_account_no,
    }


class AccountSelect(BaseModel):
    ad_account_no: str
    manager_account_no: Optional[str] = None


@router.put("/gfa/account")
async def gfa_select_account(
    payload: AccountSelect,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    u = await _get_gfa_user(current_user, db)
    if not u:
        raise HTTPException(status_code=400, detail="네이버 GFA가 연결되지 않았습니다")
    u.naver_gfa_ad_account_no = payload.ad_account_no
    u.naver_gfa_manager_account_no = payload.manager_account_no
    await db.commit()
    return {"selected": u.naver_gfa_ad_account_no}


# ─── 성과 조회 (기존 프론트 경로 호환) ───────────────────────────────────────

async def _require_account(current_user: User, db: AsyncSession) -> User:
    u = await _get_gfa_user(current_user, db)
    if not u:
        raise HTTPException(status_code=400, detail="네이버 GFA 계정이 연결되지 않았습니다. GFA 탭에서 연결해주세요.")
    if not u.naver_gfa_ad_account_no:
        raise HTTPException(status_code=400, detail="GFA 광고계정이 선택되지 않았습니다 (/naver/gfa/accounts 확인)")
    return u


async def _past_perf(u: User, db: AsyncSession, d1: date, d2: date,
                     sub_path: str = "", aggregation: str = "campaigns") -> List[dict]:
    """과거 성과 조회 — 기간이 31일 초과면 분할 호출."""
    rows: List[dict] = []
    cur = d1
    while cur <= d2:
        chunk_end = min(cur + timedelta(days=30), d2)
        payload = await _gfa_get(
            u, db,
            f"/adAccounts/{u.naver_gfa_ad_account_no}/performance/past{sub_path}/{aggregation}",
            {"startDate": cur.isoformat(), "endDate": chunk_end.isoformat(), "timeUnit": "daily"},
        )
        rows.extend(_rows_of(payload))
        cur = chunk_end + timedelta(days=1)
    return rows


@router.get("/gfa/overview")
async def gfa_overview(
    date_range: str = Query(default="last_7_days"),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    u = await _require_account(current_user, db)
    d1, d2 = _resolve_range(date_range, start_date, end_date)
    rows = await _past_perf(u, db, d1, d2)
    return {"kpi": _derive(_metric_sum(rows)), "top_creatives": [],
            "period": {"start": d1.isoformat(), "end": d2.isoformat()}}


@router.get("/gfa/trend")
async def gfa_trend(
    date_range: str = Query(default="last_7_days"),
    time_increment: str = "daily",
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    u = await _require_account(current_user, db)
    d1, d2 = _resolve_range(date_range, start_date, end_date)
    rows = await _past_perf(u, db, d1, d2)
    by_date: Dict[str, Dict[str, float]] = {}
    for r in rows:
        d = str(r.get("statDt") or r.get("date") or r.get("statDate") or "")[:10]
        if not d:
            continue
        cur = by_date.setdefault(d, {"spend": 0, "impressions": 0, "clicks": 0, "conversions": 0})
        cur["spend"] += _n(r, "sales", "cost", "adCost")
        cur["impressions"] += _n(r, "impCount", "impCnt", "impressions")
        cur["clicks"] += _n(r, "clickCount", "clickCnt", "clicks")
        cur["conversions"] += _n(r, "convCount", "conversions")
    return {"data": [{"date": d, **{k: round(v, 2) for k, v in m.items()}}
                     for d, m in sorted(by_date.items())]}


@router.get("/gfa/campaigns")
async def gfa_campaigns(
    date_range: str = Query(default="last_7_days"),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    u = await _require_account(current_user, db)
    d1, d2 = _resolve_range(date_range, start_date, end_date)
    camp_rows = _rows_of(await _gfa_get(
        u, db, f"/adAccounts/{u.naver_gfa_ad_account_no}/campaigns", {"size": 100}
    ))
    perf_rows = await _past_perf(u, db, d1, d2)
    perf_by_camp: Dict[str, List[dict]] = {}
    for r in perf_rows:
        cno = str(r.get("campaignNo") or r.get("campaign_no") or r.get("no") or "")
        perf_by_camp.setdefault(cno, []).append(r)

    out = []
    for c in camp_rows:
        cno = str(c.get("campaignNo") or c.get("no") or c.get("id") or "")
        m = _derive(_metric_sum(perf_by_camp.get(cno, [])))
        out.append({
            "id": cno,
            "name": c.get("name") or c.get("campaignName"),
            "status": c.get("status") or c.get("activationStatus") or c.get("userLock"),
            "objective": c.get("objective") or c.get("campaignObjective"),
            "budget": c.get("budget") or c.get("dailyBudget"),
            **m,
        })
    out.sort(key=lambda x: -x["spend"])
    return {"campaigns": out}


@router.get("/gfa/campaign/{campaign_no}/adgroups")
async def gfa_campaign_adgroups(
    campaign_no: str,
    date_range: str = Query(default="last_7_days"),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    u = await _require_account(current_user, db)
    d1, d2 = _resolve_range(date_range, start_date, end_date)
    rows = await _past_perf(u, db, d1, d2, sub_path=f"/campaigns/{campaign_no}", aggregation="adSets")
    by_set: Dict[str, List[dict]] = {}
    for r in rows:
        sno = str(r.get("adSetNo") or r.get("adSetId") or r.get("no") or "")
        by_set.setdefault(sno, []).append(r)
    return {"adgroups": [
        {"id": sno, "name": (grp[0].get("adSetName") or grp[0].get("name") or f"광고그룹 {sno}"),
         **_derive(_metric_sum(grp))}
        for sno, grp in by_set.items()
    ]}
