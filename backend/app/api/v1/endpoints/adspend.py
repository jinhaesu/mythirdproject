"""광고비 일보 API — 매체 마스터 + 일별 기입 그리드 + 월 예산(Limit/사업계획).

구글시트 "광고비 일보"의 시스템화. 금액은 원 단위(VAT 포함).
auto_source가 있는 매체(meta/naver_sa)는 일별 금액을 수집 스냅샷에서
자동으로 채우고 수동 기입을 막는다.
"""
import logging
from datetime import date, datetime, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_user
from app.db.database import get_db
from app.models import (
    AdMedia,
    AdMediaBudget,
    AdMediaSpendDaily,
    ChannelSpendDaily,
    MetaInsightDaily,
)
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter()

AUTO_SOURCES = {"meta", "naver_sa"}


def _month_add(month: str, delta: int) -> str:
    y, m = int(month[:4]), int(month[5:7])
    total = y * 12 + (m - 1) + delta
    return f"{total // 12:04d}-{total % 12 + 1:02d}"


def _month_range(month: str):
    y, m = int(month[:4]), int(month[5:7])
    start = date(y, m, 1)
    end = date(y + (m == 12), m % 12 + 1, 1)
    return start, end


async def _auto_daily(db: AsyncSession, source: str, d_from: date, d_to: date) -> dict:
    """자동 수집 소스의 일별 금액 {date: amount(원)}."""
    if source == "meta":
        rows = (await db.execute(
            select(MetaInsightDaily.date, func.coalesce(func.sum(MetaInsightDaily.spend), 0))
            .where(MetaInsightDaily.level == "campaign",
                   MetaInsightDaily.date >= d_from, MetaInsightDaily.date < d_to)
            .group_by(MetaInsightDaily.date)
        )).all()
    elif source == "naver_sa":
        rows = (await db.execute(
            select(ChannelSpendDaily.date, func.coalesce(func.sum(ChannelSpendDaily.spend), 0))
            .where(ChannelSpendDaily.channel == "naver_sa",
                   ChannelSpendDaily.date >= d_from, ChannelSpendDaily.date < d_to)
            .group_by(ChannelSpendDaily.date)
        )).all()
    else:
        return {}
    return {d.isoformat(): float(s) for d, s in rows if float(s)}


# ─── 매체 마스터 ─────────────────────────────────────────────────────────────

class MediaIn(BaseModel):
    name: str = Field(..., max_length=200)
    group_name: Optional[str] = Field(None, max_length=100)
    inflow: Optional[str] = Field(None, max_length=100)
    auto_source: Optional[str] = Field(None, max_length=20)  # meta|naver_sa
    sort_order: int = 0
    memo: Optional[str] = Field(None, max_length=300)


@router.get("/media")
async def list_media(
    include_inactive: bool = False,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(AdMedia)
    if not include_inactive:
        q = q.where(AdMedia.active.is_(True))
    rows = (await db.execute(
        q.order_by(AdMedia.inflow, AdMedia.group_name, AdMedia.sort_order, AdMedia.id)
    )).scalars().all()
    return [{
        "id": m.id, "name": m.name, "group_name": m.group_name, "inflow": m.inflow,
        "auto_source": m.auto_source, "sort_order": m.sort_order,
        "active": m.active, "memo": m.memo,
    } for m in rows]


@router.post("/media")
async def create_media(
    data: MediaIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if data.auto_source and data.auto_source not in AUTO_SOURCES:
        raise HTTPException(status_code=422, detail=f"auto_source는 {sorted(AUTO_SOURCES)} 중 하나")
    m = AdMedia(**data.model_dump())
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return {"id": m.id}


@router.patch("/media/{media_id}")
async def update_media(
    media_id: int,
    data: MediaIn,
    active: Optional[bool] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    m = (await db.execute(select(AdMedia).where(AdMedia.id == media_id))).scalar_one_or_none()
    if not m:
        raise HTTPException(status_code=404, detail="매체를 찾을 수 없습니다")
    for k, v in data.model_dump().items():
        setattr(m, k, v)
    if active is not None:
        m.active = active
    await db.commit()
    return {"id": m.id, "active": m.active}


# ─── 일보 보드 (월 그리드) ───────────────────────────────────────────────────

@router.get("/board")
async def spend_board(
    month: str = Query(..., min_length=7, max_length=7),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """해당 월의 일보 그리드 — 매체별 일별 금액 + 월합계/Limit/사용율/사업계획."""
    d_from, d_to = _month_range(month)
    media = (await db.execute(
        select(AdMedia).where(AdMedia.active.is_(True))
        .order_by(AdMedia.inflow, AdMedia.group_name, AdMedia.sort_order, AdMedia.id)
    )).scalars().all()
    budgets = {b.media_id: b for b in (await db.execute(
        select(AdMediaBudget).where(AdMediaBudget.month == month)
    )).scalars().all()}
    manual_rows = (await db.execute(
        select(AdMediaSpendDaily).where(
            AdMediaSpendDaily.date >= d_from, AdMediaSpendDaily.date < d_to
        )
    )).scalars().all()
    manual_by_media: dict = {}
    for r in manual_rows:
        manual_by_media.setdefault(r.media_id, {})[r.date.isoformat()] = r.amount

    auto_cache = {s: await _auto_daily(db, s, d_from, d_to) for s in AUTO_SOURCES}

    out_rows = []
    for m in media:
        daily = auto_cache.get(m.auto_source, {}) if m.auto_source else manual_by_media.get(m.id, {})
        b = budgets.get(m.id)
        total = round(sum(daily.values()), 0)
        limit_amt = b.limit_amount if b else None
        out_rows.append({
            "media_id": m.id, "name": m.name, "group_name": m.group_name,
            "inflow": m.inflow, "auto": bool(m.auto_source), "auto_source": m.auto_source,
            "owner": m.owner, "memo": m.memo,
            "daily": daily,
            "month_total": total,
            "limit_amount": limit_amt,
            "plan_amount": b.plan_amount if b else None,
            "note": b.note if b else None,  # 월별 비고
            "usage_pct": round(total / limit_amt * 100, 1) if limit_amt else None,
        })

    day_totals: dict = {}
    for r in out_rows:
        for d, v in r["daily"].items():
            day_totals[d] = day_totals.get(d, 0) + v

    grand_total = round(sum(r["month_total"] for r in out_rows), 0)
    grand_limit = round(sum(r["limit_amount"] or 0 for r in out_rows), 0)
    grand_plan = round(sum(r["plan_amount"] or 0 for r in out_rows), 0)
    return {
        "as_of": datetime.utcnow().isoformat(),
        "month": month,
        "days_in_month": (d_to - timedelta(days=1)).day,
        "rows": out_rows,
        "day_totals": day_totals,
        "totals": {
            "spend": grand_total, "limit": grand_limit, "plan": grand_plan,
            "usage_pct": round(grand_total / grand_limit * 100, 1) if grand_limit else None,
        },
    }


class EntryUpsert(BaseModel):
    media_id: int
    date: str  # YYYY-MM-DD
    amount: float = Field(..., ge=0)


@router.put("/entry")
async def upsert_entry(
    payload: EntryUpsert,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    m = (await db.execute(select(AdMedia).where(AdMedia.id == payload.media_id))).scalar_one_or_none()
    if not m:
        raise HTTPException(status_code=404, detail="매체를 찾을 수 없습니다")
    if m.auto_source:
        raise HTTPException(status_code=422, detail="자동 연동 매체는 수동 기입이 불가합니다")
    try:
        d = date.fromisoformat(payload.date)
    except ValueError:
        raise HTTPException(status_code=422, detail="date는 YYYY-MM-DD 형식")
    row = (await db.execute(select(AdMediaSpendDaily).where(
        AdMediaSpendDaily.media_id == payload.media_id, AdMediaSpendDaily.date == d
    ))).scalar_one_or_none()
    if payload.amount == 0:
        if row:
            await db.delete(row)
    elif row:
        row.amount = payload.amount
    else:
        db.add(AdMediaSpendDaily(media_id=payload.media_id, date=d, amount=payload.amount))
    await db.commit()
    return {"media_id": payload.media_id, "date": payload.date, "amount": payload.amount}


class BudgetUpsert(BaseModel):
    media_id: int
    month: str = Field(..., min_length=7, max_length=7)
    limit_amount: Optional[float] = None
    plan_amount: Optional[float] = None
    note: Optional[str] = Field(None, max_length=300)  # 월별 비고


@router.put("/budget")
async def upsert_budget(
    payload: BudgetUpsert,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = (await db.execute(select(AdMediaBudget).where(
        AdMediaBudget.media_id == payload.media_id, AdMediaBudget.month == payload.month
    ))).scalar_one_or_none()
    if not row:
        row = AdMediaBudget(media_id=payload.media_id, month=payload.month)
        db.add(row)
    if payload.limit_amount is not None:
        row.limit_amount = payload.limit_amount
    if payload.plan_amount is not None:
        row.plan_amount = payload.plan_amount
    if payload.note is not None:
        row.note = payload.note.strip() or None
    await db.commit()
    return {"media_id": payload.media_id, "month": payload.month}


# ─── 월 단위 일괄 임포트 (시트 백필/포맷 동기화) ─────────────────────────────

def _norm_name(s: str) -> str:
    import re as _re
    return _re.sub(r"\s+", " ", (s or "")).strip()


class ImportRow(BaseModel):
    name: str = Field(..., max_length=200)
    owner: Optional[str] = Field(None, max_length=50)
    inflow: Optional[str] = Field(None, max_length=100)
    group_name: Optional[str] = Field(None, max_length=100)
    limit_amount: Optional[float] = None
    plan_amount: Optional[float] = None
    daily: dict = Field(default_factory=dict)  # {"1".."31": 금액(원)}


class MonthImport(BaseModel):
    month: str = Field(..., min_length=7, max_length=7)
    rows: list[ImportRow]
    update_master: bool = False  # True면 매체의 inflow/group/owner/sort를 이 리스트 기준으로 갱신


@router.post("/import-month")
async def import_month(
    payload: MonthImport,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """한 달치 일보를 일괄 적재 — 매체는 이름(공백 정규화)으로 매칭, 없으면 생성.

    daily 금액은 원 단위(VAT 포함). 같은 (매체,일) 기존 값은 교체.
    update_master=True면 매체 정렬/분류를 이 리스트 순서 기준으로 표준화한다.
    """
    if len(payload.rows) > 300:
        raise HTTPException(status_code=422, detail="한 번에 300행까지")
    d_from, d_to = _month_range(payload.month)
    media_all = (await db.execute(select(AdMedia))).scalars().all()
    by_name = {_norm_name(m.name): m for m in media_all}

    created = updated = entries = budgets = 0
    pending_daily: dict = {}  # (media_id, date) — 같은 요청 내 중복 방어 (동일 매체명 복수 행)
    for i, row in enumerate(payload.rows):
        key = _norm_name(row.name)
        if not key:
            continue
        m = by_name.get(key)
        if not m:
            m = AdMedia(
                name=key, owner=row.owner, inflow=row.inflow,
                group_name=row.group_name, sort_order=(i + 1) * 10,
            )
            db.add(m)
            await db.flush()
            by_name[key] = m
            created += 1
        elif payload.update_master:
            m.owner = row.owner or m.owner
            m.inflow = row.inflow or m.inflow
            m.group_name = row.group_name or m.group_name
            m.sort_order = (i + 1) * 10
            m.active = True
            updated += 1

        if row.limit_amount is not None or row.plan_amount is not None:
            b = (await db.execute(select(AdMediaBudget).where(
                AdMediaBudget.media_id == m.id, AdMediaBudget.month == payload.month
            ))).scalar_one_or_none()
            if not b:
                b = AdMediaBudget(media_id=m.id, month=payload.month)
                db.add(b)
            if row.limit_amount is not None:
                b.limit_amount = row.limit_amount
            if row.plan_amount is not None:
                b.plan_amount = row.plan_amount
            budgets += 1

        for day_str, amt in (row.daily or {}).items():
            try:
                d = date(int(payload.month[:4]), int(payload.month[5:7]), int(day_str))
            except ValueError:
                continue
            if not (d_from <= d < d_to) or amt is None:
                continue
            cache_key = (m.id, d)
            ex = pending_daily.get(cache_key) or (await db.execute(
                select(AdMediaSpendDaily).where(
                    AdMediaSpendDaily.media_id == m.id, AdMediaSpendDaily.date == d
                )
            )).scalar_one_or_none()
            if float(amt) == 0:
                if ex:
                    await db.delete(ex)
                    pending_daily.pop(cache_key, None)
                continue
            if ex:
                ex.amount = float(amt)
            else:
                ex = AdMediaSpendDaily(media_id=m.id, date=d, amount=float(amt))
                db.add(ex)
            pending_daily[cache_key] = ex
            entries += 1

    await db.commit()
    return {"month": payload.month, "media_created": created, "media_updated": updated,
            "entries": entries, "budgets": budgets}


@router.get("/export")
async def export_month_xlsx(
    month: str = Query(..., min_length=7, max_length=7),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """일보 엑셀 다운로드 — 10월 포맷(담당자|판매채널|광고분류|광고매체|일별|TOTAL|계획|사용율)."""
    from io import BytesIO
    from urllib.parse import quote

    from fastapi.responses import StreamingResponse
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    board = await spend_board(month=month, current_user=current_user, db=db)
    media_meta = {m.id: m for m in (await db.execute(select(AdMedia))).scalars().all()}
    days = board["days_in_month"]

    wb = Workbook()
    ws = wb.active
    ws.title = f"광고비 일보 {int(month[5:7])}월"
    header_font = Font(bold=True)
    header_fill = PatternFill(start_color="D9D9D9", end_color="D9D9D9", fill_type="solid")
    center = Alignment(horizontal="center", vertical="center")
    money = "#,##0"

    headers = ["판매 담당자", "판매채널", "광고분류", "광고매체"] + \
        [f"{int(month[5:7])}.{d}" for d in range(1, days + 1)] + \
        ["TOTAL", "광고비 계획(Limit)", "사용율", "비고"]
    for ci, h in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=ci, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center

    ri = 2
    for r in board["rows"]:
        meta = media_meta.get(r["media_id"])
        ws.cell(ri, 1, (meta.owner if meta else None) or "")
        ws.cell(ri, 2, r["inflow"] or "")
        ws.cell(ri, 3, r["group_name"] or "")
        ws.cell(ri, 4, r["name"] + (" (자동)" if r["auto"] else ""))
        for d in range(1, days + 1):
            v = r["daily"].get(f"{month}-{d:02d}")
            if v:
                c = ws.cell(ri, 4 + d, round(v))
                c.number_format = money
        ws.cell(ri, 5 + days, round(r["month_total"])).number_format = money
        if r["limit_amount"]:
            ws.cell(ri, 6 + days, round(r["limit_amount"])).number_format = money
        if r["usage_pct"] is not None:
            ws.cell(ri, 7 + days, r["usage_pct"] / 100).number_format = "0%"
        ws.cell(ri, 8 + days, r.get("note") or (meta.memo if meta else None) or "")
        ri += 1

    # 합계 행
    ws.cell(ri, 4, "합계").font = header_font
    for d in range(1, days + 1):
        v = board["day_totals"].get(f"{month}-{d:02d}")
        if v:
            c = ws.cell(ri, 4 + d, round(v))
            c.number_format = money
            c.font = header_font
    ws.cell(ri, 5 + days, round(board["totals"]["spend"])).number_format = money
    ws.cell(ri, 5 + days).font = header_font
    if board["totals"]["limit"]:
        ws.cell(ri, 6 + days, round(board["totals"]["limit"])).number_format = money
    if board["totals"]["usage_pct"] is not None:
        ws.cell(ri, 7 + days, board["totals"]["usage_pct"] / 100).number_format = "0%"

    ws.freeze_panes = "E2"
    for i, w in enumerate([10, 14, 12, 30] + [9] * days + [13, 14, 8, 16], start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.cell(ri + 2, 4, "단위: 원 (VAT 포함) · 시스템 광고비 일보 export")

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = f"광고비일보_{month}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


# ─── SALES(CSA) 채널 매출 연동 ───────────────────────────────────────────────
# myfirstproject CSA 대시보드에서 월×채널 매출(공급가, VAT별도·월정액 차감 후)을
# 가져와 ROAS를 자동 계산한다. 이름이 명확히 대응하는 채널만 매핑하고(대표 지시),
# 애매한 채널(B2B·오프라인 CVS/마트·GS샵 홈쇼핑·11번가 슈팅 등)은 수동 기입 유지.
import time as _time

CSA_BASE = "https://myfirstproject-api-557811875995.asia-northeast3.run.app"

INFLOW_TO_CSA: dict = {
    "자사몰": ["카페24"],
    "네이버스토어": ["스마트스토어"],
    "쿠팡 WING": ["쿠팡 WING"],
    "쿠팡 (사입)": ["쿠팡 로켓"],
    "토스쇼핑": ["토스"],
    "G마켓": ["지마켓"],
    "옥션": ["옥션"],
    "알리익스프레스": ["알리익스프레스"],
    "11번가": ["11번가"],
    "카카오 스토어": ["카카오톡스토어"],
    "카카오선물하기": ["카카오선물하기"],
    "올리브영": ["올리브영"],
    "올웨이즈": ["올웨이즈"],
    "GS샵": ["GS 샵"],
    "CJ온스타일": ["CJ온스타일"],
    "롯데ON": ["롯데온"],
    "지그재그": ["카카오스타일"],  # 지그재그 운영명 = 카카오스타일
    "이지웰": ["이지웰"],
    "에이블리": ["에이블리"],
    "Tdeal": ["T deal"],
    "신세계라이브쇼핑": ["신세계 라이브쇼핑"],
    "신세계TV": ["신세계 TV 쇼핑"],
    "비마트": ["B마트"],
    "컬리": ["마켓컬리"],
}

_csa_cache: dict = {}  # month -> {"data": {channel_name: revenue}, "expires": ts}
_CSA_TTL = 600


async def _csa_month_revenues(month: str) -> Optional[dict]:
    """해당 월의 CSA 채널별 매출 {채널명: revenue}. 실패 시 None (수동 기입 폴백)."""
    now = _time.time()
    cached = _csa_cache.get(month)
    if cached and cached["expires"] > now:
        return cached["data"]
    d_from, d_to = _month_range(month)
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(f"{CSA_BASE}/api/csa/dashboard", params={
                "period_start": d_from.isoformat(),
                "period_end": (d_to - timedelta(days=1)).isoformat(),
                "granularity": "month",
            })
        if resp.status_code != 200:
            logger.warning(f"[CSA] dashboard {month} -> {resp.status_code}")
            return None
        data = {c["channel_name"]: float(c.get("revenue") or 0)
                for c in resp.json().get("channels", [])}
        _csa_cache[month] = {"data": data, "expires": now + _CSA_TTL}
        return data
    except Exception as e:
        logger.warning(f"[CSA] dashboard {month} 실패: {e}")
        return None


# ─── 채널 ROAS 보드 (유입채널 × 월 — 광고비 자동 + 매출 기입) ────────────────

async def _inflow_spend_by_month(db: AsyncSession, months: list) -> dict:
    """{(month, inflow): spend} — 일보 수동 기입 + 자동 매체(meta/naver_sa)."""
    m_from, m_to = months[0], months[-1]
    d_from, _ = _month_range(m_from)
    _, d_to = _month_range(m_to)

    media = (await db.execute(select(AdMedia).where(AdMedia.active.is_(True)))).scalars().all()
    inflow_of = {m.id: (m.inflow or "기타") for m in media}
    auto_media = [(m.id, m.auto_source) for m in media if m.auto_source]

    out: dict = {}
    rows = (await db.execute(
        select(
            AdMediaSpendDaily.media_id,
            func.to_char(AdMediaSpendDaily.date, "YYYY-MM"),
            func.coalesce(func.sum(AdMediaSpendDaily.amount), 0),
        ).where(AdMediaSpendDaily.date >= d_from, AdMediaSpendDaily.date < d_to)
        .group_by(text("1, 2"))  # to_char 포맷이 바인드 파라미터로 렌더돼 표현식 GROUP BY가 불일치 → 위치 지정
    )).all()
    for mid, month, amt in rows:
        key = (month, inflow_of.get(mid, "기타"))
        out[key] = out.get(key, 0) + float(amt)
    for mid, source in auto_media:
        daily = await _auto_daily(db, source, d_from, d_to)
        for d, amt in daily.items():
            key = (d[:7], inflow_of.get(mid, "기타"))
            out[key] = out.get(key, 0) + amt
    return out


@router.get("/roas-board")
async def roas_board(
    months_back: int = Query(default=6, ge=1, le=24),
    month_from: str | None = Query(default=None, min_length=7, max_length=7),
    month_to: str | None = Query(default=None, min_length=7, max_length=7),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """유입채널별 월 광고비(일보 자동 합산) × 매출(기입/자사몰 자동) × ROAS.

    구 '채널 성과 분석'(monthly_channel_spends 소수 채널) 대체 —
    광고비 일보의 전체 유입채널 축으로 분석한다. 금액 원 단위(VAT 포함).
    month_from/month_to(YYYY-MM)를 함께 주면 커스텀 범위(최대 24개월)가 months_back보다 우선.
    """
    from app.models import ChannelRevenue, MallOrder

    this_month = date.today().strftime("%Y-%m")
    if month_from and month_to:
        import re as _re
        if not (_re.fullmatch(r"\d{4}-\d{2}", month_from) and _re.fullmatch(r"\d{4}-\d{2}", month_to)):
            raise HTTPException(status_code=422, detail="month_from/month_to는 YYYY-MM 형식이어야 합니다")
        if month_from > month_to:
            month_from, month_to = month_to, month_from
        span = (int(month_to[:4]) - int(month_from[:4])) * 12 + int(month_to[5:7]) - int(month_from[5:7]) + 1
        if span > 24:
            raise HTTPException(status_code=422, detail="조회 범위는 최대 24개월입니다")
        months = [_month_add(month_from, i) for i in range(span)]
    else:
        months = [_month_add(this_month, i) for i in range(-months_back + 1, 1)]
    spend_by = await _inflow_spend_by_month(db, months)

    # 매출: ① SALES(CSA) 매칭 채널 = 자동 ② 미매칭 채널 = 수동 기입(channel_revenues)
    import asyncio as _asyncio
    rev_rows = (await db.execute(
        select(ChannelRevenue).where(
            ChannelRevenue.month >= months[0], ChannelRevenue.month <= months[-1]
        )
    )).scalars().all()
    rev_by = {(r.month, r.inflow): r.revenue for r in rev_rows}
    csa_results = await _asyncio.gather(*[_csa_month_revenues(m) for m in months])
    csa_by_month = dict(zip(months, csa_results))

    # 예산(Limit·사업계획) — 유입채널별 월합
    budgets = (await db.execute(
        select(AdMediaBudget).where(AdMediaBudget.month.in_(months))
    )).scalars().all()
    media = (await db.execute(select(AdMedia))).scalars().all()
    inflow_of = {m.id: (m.inflow or "기타") for m in media}
    limit_by: dict = {}
    for b in budgets:
        key = (b.month, inflow_of.get(b.media_id, "기타"))
        limit_by[key] = limit_by.get(key, 0) + (b.limit_amount or 0)

    inflows = sorted({k[1] for k in list(spend_by) + list(rev_by) + list(limit_by)})
    cells = []
    for m in months:
        csa = csa_by_month.get(m)
        for inf in inflows:
            spend = round(spend_by.get((m, inf), 0), 0)
            csa_names = INFLOW_TO_CSA.get(inf)
            revenue = None
            source = None
            if csa_names and csa is not None:
                revenue = sum(csa.get(n, 0) for n in csa_names)
                source = "sales"
                if revenue == 0:
                    revenue = None  # 해당 월 SALES 데이터 없음(미업로드) — 빈 값으로
            if revenue is None and rev_by.get((m, inf)) is not None:
                revenue = rev_by[(m, inf)]
                source = "manual"
            limit_amt = round(limit_by.get((m, inf), 0), 0) or None
            if not spend and not revenue and not limit_amt:
                continue
            cells.append({
                "month": m, "inflow": inf,
                "spend": spend,
                "limit": limit_amt,
                "usage_pct": round(spend / limit_amt * 100, 1) if limit_amt else None,
                "revenue": round(revenue, 0) if revenue is not None else None,
                "revenue_auto": source == "sales",
                "revenue_source": source,
                "sales_linked": bool(csa_names),
                "roas": round(revenue / spend, 2) if revenue and spend else None,
            })
    return {
        "as_of": datetime.utcnow().isoformat(),
        "months": months,
        "this_month": this_month,
        "inflows": inflows,
        "cells": cells,
    }


class RevenueUpsert(BaseModel):
    month: str = Field(..., min_length=7, max_length=7)
    inflow: str = Field(..., max_length=100)
    revenue: float = Field(..., ge=0)


@router.put("/revenue")
async def upsert_channel_revenue(
    payload: RevenueUpsert,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models import ChannelRevenue

    if payload.inflow in INFLOW_TO_CSA:
        raise HTTPException(status_code=422, detail="SALES 시스템 연동 채널은 매출이 자동 집계됩니다")
    row = (await db.execute(select(ChannelRevenue).where(
        ChannelRevenue.month == payload.month, ChannelRevenue.inflow == payload.inflow
    ))).scalar_one_or_none()
    if payload.revenue == 0:
        if row:
            await db.delete(row)
    elif row:
        row.revenue = payload.revenue
    else:
        db.add(ChannelRevenue(month=payload.month, inflow=payload.inflow, revenue=payload.revenue))
    await db.commit()
    return {"month": payload.month, "inflow": payload.inflow, "revenue": payload.revenue}


@router.get("/monthly-summary")
async def monthly_summary(
    month: str = Query(..., min_length=7, max_length=7),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """KPI 요약용 — 유입채널(inflow) 그룹별 집행/Limit/사업계획 합계."""
    board = await spend_board(month=month, current_user=current_user, db=db)
    groups: dict = {}
    for r in board["rows"]:
        g = groups.setdefault(r["inflow"] or "기타", {"spend": 0, "limit": 0, "plan": 0})
        g["spend"] += r["month_total"]
        g["limit"] += r["limit_amount"] or 0
        g["plan"] += r["plan_amount"] or 0
    return {
        "month": month,
        "by_inflow": [{"inflow": k, **{kk: round(vv, 0) for kk, vv in v.items()}} for k, v in groups.items()],
        "totals": board["totals"],
    }
