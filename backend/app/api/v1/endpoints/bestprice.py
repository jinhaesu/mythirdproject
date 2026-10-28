"""회원 최저가 쿠폰(bestprice) 관리자 API — 슈퍼유저 전용.

GET  /bestprice/summary          최근 실행 요약(기본 dry) — 구간별 인원·계획·기대비용·실사용·상한 상태
POST /bestprice/run-dry          지금 dry-run 1회 실행(카페24 호출 0회, dry 행만 기록)
POST /bestprice/live/coupons      (LIVE) 이번 기간 구간 쿠폰 생성 + GET 재확인(틀리면 즉시 중지)
POST /bestprice/live/pilot        (LIVE) 최근 활동 순 limit명 + 지정 회원 시범 발급(백그라운드)
GET  /bestprice/live/verify       (LIVE) 카페24 issued_count vs DB 발급 기록
GET  /bestprice/catalog.js       (공개) 쿠폰 정의 카탈로그 → window.ndCouponCatalog. 회원정보 없음·쓰기 없음.
"""
import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_user
from app.core.config import get_settings
from app.db.database import get_db
from app.models.user import User
from app.services import bestprice as bp

router = APIRouter()


def _require_super(user: User) -> None:
    if not getattr(user, "is_superuser", False):
        raise HTTPException(status_code=403, detail="관리자 권한이 필요합니다.")


@router.get("/summary")
async def bestprice_summary(
    mode: str = Query("dry", pattern="^(dry|live|any)$"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_super(current_user)
    s = get_settings()
    latest = await bp.latest_summary(db, None if mode == "any" else mode)
    return {"live_enabled": bool(s.BESTPRICE_LIVE), "cap": s.BESTPRICE_MONTHLY_CAP_KRW, "latest": latest}


@router.post("/run-dry")
async def bestprice_run_dry(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_super(current_user)
    return await bp.run_bestprice(db, live=False)


@router.get("/catalog.js")
async def bestprice_catalog_js(db: AsyncSession = Depends(get_db)):
    """스킨이 <script>로 읽는 쿠폰 규칙표(CORS 불필요). 실패하면 빈 표."""
    try:
        data = await bp.coupon_catalog(db)
    except Exception:
        data = {"coupons": [], "groups": [], "points": None, "shipping": None}
    body = "window.ndCouponCatalog=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";"
    return Response(body, media_type="application/javascript; charset=utf-8",
                    headers={"Cache-Control": "public, max-age=600"})


class PilotBody(BaseModel):
    limit: int = 500
    member_ids: list[str] = []


_pilot_task: dict = {"task": None, "result": None}


def _require_live():
    if not get_settings().BESTPRICE_LIVE:
        raise HTTPException(status_code=409, detail="BESTPRICE_LIVE=false")


@router.post("/live/coupons")
async def bestprice_live_coupons(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    _require_super(current_user)
    _require_live()
    return await bp.live_create_and_verify(db)


@router.post("/live/pilot")
async def bestprice_live_pilot(body: PilotBody, current_user: User = Depends(get_current_user)):
    _require_super(current_user)
    _require_live()
    if body.limit > 2000:
        raise HTTPException(status_code=400, detail="limit ≤ 2000")
    t = _pilot_task["task"]
    if t is not None and not t.done():
        return {"started": False, "detail": "이미 실행 중"}

    async def _job():
        from app.db.database import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            try:
                _pilot_task["result"] = await bp.live_pilot(db, limit=body.limit, extra_member_ids=body.member_ids)
            except Exception as e:
                _pilot_task["result"] = {"error": str(e)[:500]}
    _pilot_task["result"] = None
    _pilot_task["task"] = asyncio.create_task(_job())
    return {"started": True}


@router.get("/live/pilot")
async def bestprice_live_pilot_status(current_user: User = Depends(get_current_user)):
    _require_super(current_user)
    t = _pilot_task["task"]
    return {"running": bool(t and not t.done()), "result": _pilot_task["result"]}


@router.get("/live/verify")
async def bestprice_live_verify(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    _require_super(current_user)
    _require_live()
    return await bp.live_issued_counts(db)
