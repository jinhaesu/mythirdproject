"""데이터라이즈(CRM) 운영 진단 대시보드 API (2026-11-03 마케팅 연다은 건의 37189ff2).

  GET  /crm/datarize/status   마지막 불러오기·저장 범위·다음 일정·불러오기 권한
  GET  /crm/datarize/report   월간 진단 (?month=YYYY-MM&basis=visit|click)
  POST /crm/datarize/sync     지금 다시 불러오기 (슈퍼유저 또는 DATARIZE_ADMIN_EMAILS)

동기화는 services/datarize_sync.py, 계산은 services/datarize_report.py.
"""
import json
import logging
import re
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_user
from app.core.config import get_settings
from app.db.database import get_db
from app.models.datarize import (
    DatarizeCostDaily, DatarizeMemberDaily, DatarizeMessageDaily, DatarizeSegmentDaily, DatarizeSyncLog,
)
from app.models.user import User
from app.services import datarize_report as rep
from app.services import datarize_sync as ds

logger = logging.getLogger(__name__)
router = APIRouter()

KST = timedelta(hours=9)


def _kst_today():
    return (datetime.utcnow() + KST).date()


def can_sync(user: User) -> bool:
    allowed = {e.strip().lower() for e in (get_settings().DATARIZE_ADMIN_EMAILS or "").split(",") if e.strip()}
    return bool(getattr(user, "is_superuser", False) or (user.email or "").lower() in allowed)


def _iso_kst(dt: Optional[datetime]) -> Optional[str]:
    return (dt + KST).strftime("%Y-%m-%d %H:%M") if dt else None


@router.get("/datarize/status")
async def status(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    logs = (await db.execute(
        select(DatarizeSyncLog).order_by(DatarizeSyncLog.started_at.desc()).limit(5)
    )).scalars().all()
    ranges = {}
    for key, model in (("message", DatarizeMessageDaily), ("cost", DatarizeCostDaily),
                       ("members", DatarizeMemberDaily), ("segments", DatarizeSegmentDaily)):
        lo, hi, n = (await db.execute(select(func.min(model.date), func.max(model.date), func.count()))).one()
        ranges[key] = {"from": lo.isoformat() if lo else None, "to": hi.isoformat() if hi else None, "rows": n}
    nxt = datetime.utcnow() + timedelta(seconds=ds.seconds_until_next_run())
    return {
        "sheet_id": get_settings().DATARIZE_SHEET_ID,
        "sheet_url": f"https://docs.google.com/spreadsheets/d/{get_settings().DATARIZE_SHEET_ID}/edit",
        "schedule_kst": [f"{h:02d}:{m:02d}" for h, m in ds.SYNC_TIMES_KST],
        "next_run_kst": _iso_kst(nxt),
        "running": ds.is_running(),
        "can_sync": can_sync(user),
        "ranges": ranges,
        "logs": [{
            "started_kst": _iso_kst(l.started_at), "finished_kst": _iso_kst(l.finished_at),
            "status": l.status, "trigger": (l.trigger or "").split(":")[0],
            "tabs": json.loads(l.detail) if l.detail else None,
        } for l in logs],
    }


@router.post("/datarize/sync")
async def sync_now(user: User = Depends(get_current_user)):
    if not can_sync(user):
        raise HTTPException(status_code=403, detail="관리자만 불러올 수 있습니다")
    if ds.is_running():
        raise HTTPException(status_code=409, detail="지금 불러오는 중입니다 — 잠시 뒤 새로고침해 주세요")
    return await ds.run_sync(f"manual:{user.email or user.id}")


@router.get("/datarize/report")
async def report(
    month: Optional[str] = Query(None, description="YYYY-MM (없으면 데이터 7일 이상인 최근 달)"),
    basis: str = Query("visit", description="visit(방문 기준) | click(클릭 기준)"),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    if month and not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
        raise HTTPException(status_code=422, detail="month는 YYYY-MM")
    if basis not in ("visit", "click"):
        raise HTTPException(status_code=422, detail="basis는 visit 또는 click")
    since = _kst_today() - timedelta(days=430)
    M = DatarizeMessageDaily
    msg = [dict(r) for r in (await db.execute(select(
        M.date, M.channel, M.campaign_id, M.campaign_name, M.attempts, M.sent, M.cost, M.visitors,
        M.visit_conv_users, M.visit_orders, M.visit_revenue, M.clickers, M.click_conv_users, M.click_orders,
        M.click_revenue,
    ).where(M.date >= since))).mappings().all()]
    C = DatarizeCostDaily
    cost = [dict(r) for r in (await db.execute(
        select(C.date, C.kind, C.amount, C.channel).where(C.date >= since)
    )).mappings().all()]
    Mb = DatarizeMemberDaily
    members = [dict(r) for r in (await db.execute(
        select(Mb.date, Mb.email_opt_in, Mb.sms_opt_in, Mb.members).where(Mb.date >= since)
    )).mappings().all()]
    S = DatarizeSegmentDaily
    segs = [dict(r) for r in (await db.execute(select(
        S.date, S.segment, S.classification, S.members, S.ratio, S.median_days_no_visit,
        S.median_days_no_purchase, S.avg_order_value,
    ).where(S.date >= since))).mappings().all()]
    return rep.build_report(message_rows=msg, cost_rows=cost, member_rows=members, segment_rows=segs,
                            month=month, basis=basis, today=_kst_today())
