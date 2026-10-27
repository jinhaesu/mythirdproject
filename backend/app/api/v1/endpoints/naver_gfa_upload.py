"""네이버 GFA 성과 파일 업로드 — 미리보기·반영·이력·대시보드 (2026-10-27 마케팅 연다은 건의).

GFA 오픈API가 연결되지 않아도 광고 관리자 보고서에서 내려받은 일별 성과 파일(CSV·XLSX)을
올리면 GFA 성과 대시보드가 그 값으로 그려진다. 파일 해석은 services/gfa_upload.py.

  POST   /naver/gfa/upload/preview        파일 미리보기 — DB는 바꾸지 않는다
  POST   /naver/gfa/upload/apply          반영 — 같은 (계정 이름, 날짜) 예전 행을 지우고 새로 넣는다
  GET    /naver/gfa/upload/batches        올린 기록
  DELETE /naver/gfa/upload/batches/{id}   그 업로드로 넣은 행 지우기
  GET    /naver/gfa/upload/status         올린 데이터 범위
  GET    /naver/gfa/upload/dashboard      대시보드 (KPI·추이·캠페인·소재·유형/상품/프로모션)

router.py에서 naver_analytics보다 먼저 /naver prefix로 등록한다.
"""
import asyncio
import json
import logging
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import delete, func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_user
from app.db.database import get_db
from app.models.gfa_upload import GfaUploadBatch, GfaUploadDaily
from app.models.user import User
from app.services import gfa_upload as gu

logger = logging.getLogger(__name__)
router = APIRouter()

MAX_BYTES = 8 * 1024 * 1024
CHUNK = 500  # IN (...) 날짜 묶음
INSERT_CHUNK = 2000
TOP_CREATIVES = 200
TOP_GROUPS = 30


def _kst_today() -> date:
    return (datetime.utcnow() + timedelta(hours=9)).date()


def _chunks(xs: list, n: int):
    for i in range(0, len(xs), n):
        yield xs[i:i + n]


async def _parse_upload(file: UploadFile, sheet: Optional[str], header_row: Optional[int],
                        mapping: Optional[str], account_label: Optional[str]) -> gu.Parsed:
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="파일이 너무 큽니다 (8MB까지) — 기간을 나눠 올려 주세요")
    if not data:
        raise HTTPException(status_code=422, detail="빈 파일입니다")
    try:
        manual = json.loads(mapping) if mapping and mapping.strip() else None
    except ValueError:
        manual = "bad"
    if manual is not None and not isinstance(manual, dict):
        raise HTTPException(status_code=422, detail="mapping은 {항목: 칸 번호} JSON이어야 합니다")
    sheet = sheet if sheet and sheet.strip() else None
    try:  # 파일 해석은 CPU 작업 — 이벤트 루프(수집 스케줄러 등)를 막지 않게 스레드로
        return await asyncio.to_thread(gu.parse, data, file.filename or "", sheet, header_row, manual,
                                       account_label or "")
    except gu.GfaUploadError as e:
        raise HTTPException(status_code=422, detail={"message": str(e), "sheets": e.sheets} if e.sheets else str(e))


async def _existing(db: AsyncSession, pairs: Dict[str, set]) -> dict:
    """반영하면 지워질 예전 행 수 + 같은 날짜에 있는 다른 계정 이름 데이터(두 번 셀 위험)."""
    replace_rows = 0
    batch_ids: set = set()
    for acc, ds in pairs.items():
        for part in _chunks(sorted(ds), CHUNK):
            res = (await db.execute(
                select(GfaUploadDaily.batch_id, func.count())
                .where(GfaUploadDaily.account_label == acc, GfaUploadDaily.date.in_(part))
                .group_by(GfaUploadDaily.batch_id)
            )).all()
            for bid, n in res:
                replace_rows += int(n)
                batch_ids.add(bid)
    all_dates = sorted({d for ds in pairs.values() for d in ds})
    others: dict = {}
    for part in _chunks(all_dates, CHUNK):
        res = (await db.execute(
            select(GfaUploadDaily.account_label, func.count(), func.min(GfaUploadDaily.date),
                   func.max(GfaUploadDaily.date))
            .where(GfaUploadDaily.date.in_(part), GfaUploadDaily.account_label.notin_(list(pairs.keys())))
            .group_by(GfaUploadDaily.account_label)
        )).all()
        for acc, n, d1, d2 in res:
            o = others.setdefault(acc, {"account": acc, "rows": 0, "date_from": d1, "date_to": d2})
            o["rows"] += int(n)
            o["date_from"] = min(o["date_from"], d1)
            o["date_to"] = max(o["date_to"], d2)
    return {
        "rows": replace_rows,
        "batches": sorted(batch_ids),
        "other_accounts": [
            {**o, "date_from": o["date_from"].isoformat(), "date_to": o["date_to"].isoformat()}
            for o in others.values()
        ],
    }


def _preview_body(p: gu.Parsed, filename: Optional[str]) -> dict:
    d1, d2 = p.date_range
    accounts = []
    for acc, ds in sorted(p.dates.items()):
        recs = [r for r in p.records if r.account == acc]
        accounts.append({"account": acc, "days": len(ds), "rows": len(recs),
                         "date_from": min(ds).isoformat(), "date_to": max(ds).isoformat(),
                         "spend": round(sum(r.spend or 0 for r in recs), 2)})
    return {
        "file": {
            "name": filename, "kind": p.grid.kind, "sheet": p.grid.sheet, "sheets": p.grid.sheets,
            "encoding": p.grid.encoding, "delimiter": p.grid.delimiter, "header_row": p.header_row,
        },
        "columns": gu.columns_info(p),
        "fields": [{"key": k, "label": v, "required": k in gu.REQUIRED,
                    "columns": p.mapping.fields.get(k, []), "manual": k in p.mapping.manual}
                   for k, v in gu.FIELDS.items()],
        "missing": p.missing,
        "spend_vat": p.spend_vat,
        "budget_kind": p.budget_kind,
        "granularity": p.granularity,
        "data_rows": p.data_rows,
        "record_count": len(p.records),
        "skipped": p.skipped,
        "date_from": d1.isoformat() if d1 else None,
        "date_to": d2.isoformat() if d2 else None,
        "days": len({d for ds in p.dates.values() for d in ds}),
        "totals": p.totals(),
        "accounts": accounts,
        "warnings": p.warnings,
        "errors": p.errors,
        "can_apply": p.can_apply,
        "sample": [r.as_dict() for r in p.records[:10]],
    }


@router.post("/gfa/upload/preview")
async def gfa_upload_preview(
    file: UploadFile = File(...),
    account_label: Optional[str] = Form(None),
    sheet: Optional[str] = Form(None),
    header_row: Optional[int] = Form(None),
    mapping: Optional[str] = Form(None),  # {"spend": 5, "conv_sales": null, ...} — 칸 번호(0부터)
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """GFA 성과 파일 미리보기 — DB는 바꾸지 않는다. 칸 연결·합계·기간·바뀔 행 수를 돌려준다."""
    p = await _parse_upload(file, sheet, header_row, mapping, account_label)
    body = _preview_body(p, file.filename)
    body["replace"] = await _existing(db, p.dates) if p.dates else {"rows": 0, "batches": [], "other_accounts": []}
    return body


@router.post("/gfa/upload/apply")
async def gfa_upload_apply(
    file: UploadFile = File(...),
    account_label: Optional[str] = Form(None),
    sheet: Optional[str] = Form(None),
    header_row: Optional[int] = Form(None),
    mapping: Optional[str] = Form(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """반영 — 파일에 있는 (계정 이름, 날짜)의 예전 행을 지우고 파일 값을 넣는다(한 트랜잭션)."""
    p = await _parse_upload(file, sheet, header_row, mapping, account_label)
    if not p.can_apply:
        msg = p.errors[0] if p.errors else "반영할 행이 없습니다"
        raise HTTPException(status_code=422, detail=msg)
    d1, d2 = p.date_range
    totals = p.totals()
    try:
        replaced = 0
        for acc, ds in p.dates.items():
            for part in _chunks(sorted(ds), CHUNK):
                res = await db.execute(delete(GfaUploadDaily).where(
                    GfaUploadDaily.account_label == acc, GfaUploadDaily.date.in_(part)))
                replaced += max(int(res.rowcount or 0), 0)
        batch = GfaUploadBatch(
            account_label=", ".join(sorted(a or "기본" for a in p.dates))[:300],
            filename=(file.filename or "")[:300] or None,
            sheet=(p.grid.sheet or None) and p.grid.sheet[:100],
            granularity=p.granularity,
            date_from=d1, date_to=d2,
            row_count=len(p.records),
            replaced_rows=replaced,
            spend_total=totals["spend"] or 0,
            conv_sales_total=totals["conv_sales"],
            spend_vat=p.spend_vat,
            columns=json.dumps(gu.mapping_meta(p), ensure_ascii=False),
            uploaded_by=(current_user.email or "")[:255] or None,
            created_at=datetime.utcnow(),
        )
        db.add(batch)
        await db.flush()
        rows = [{
            "batch_id": batch.id, "account_label": r.account, "date": r.date,
            "campaign_id": r.campaign_id, "campaign_name": r.campaign_name,
            "adgroup_id": r.adgroup_id, "adgroup_name": r.adgroup_name,
            "creative_id": r.creative_id, "creative_name": r.creative_name,
            "creative_type": r.creative_type, "product": r.product, "promotion": r.promotion,
            "impressions": r.impressions, "clicks": r.clicks, "spend": round(r.spend or 0, 2),
            "conversions": r.conversions, "conv_sales": r.conv_sales, "budget": r.budget,
        } for r in p.records]
        for part in _chunks(rows, INSERT_CHUNK):
            await db.execute(insert(GfaUploadDaily), part)
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    logger.info(f"[GFA upload] batch={batch.id} rows={len(rows)} replaced={replaced} {d1}~{d2} by={current_user.id}")
    return {
        "batch_id": batch.id, "inserted": len(rows), "replaced": replaced,
        "date_from": d1.isoformat() if d1 else None, "date_to": d2.isoformat() if d2 else None,
        "accounts": sorted(p.dates.keys()), "totals": totals, "granularity": p.granularity,
        "spend_vat": p.spend_vat,
    }


@router.get("/gfa/upload/batches")
async def gfa_upload_batches(
    limit: int = Query(default=30, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """올린 기록 — 남은 행 수는 지금 기준(나중 업로드가 같은 날짜를 대체하면 줄어든다)."""
    batches = (await db.execute(
        select(GfaUploadBatch).order_by(GfaUploadBatch.id.desc()).limit(limit)
    )).scalars().all()
    ids = [b.id for b in batches]
    live: dict = {}
    if ids:
        for bid, n, d1, d2, sp in (await db.execute(
            select(GfaUploadDaily.batch_id, func.count(), func.min(GfaUploadDaily.date),
                   func.max(GfaUploadDaily.date), func.coalesce(func.sum(GfaUploadDaily.spend), 0))
            .where(GfaUploadDaily.batch_id.in_(ids)).group_by(GfaUploadDaily.batch_id)
        )).all():
            live[bid] = (int(n), d1, d2, float(sp))
    out = []
    for b in batches:
        n, d1, d2, sp = live.get(b.id, (0, None, None, 0.0))
        out.append({
            "id": b.id, "filename": b.filename, "sheet": b.sheet, "account_label": b.account_label,
            "granularity": b.granularity, "spend_vat": b.spend_vat,
            "date_from": b.date_from.isoformat() if b.date_from else None,
            "date_to": b.date_to.isoformat() if b.date_to else None,
            "row_count": b.row_count, "replaced_rows": b.replaced_rows,
            "spend_total": b.spend_total, "conv_sales_total": b.conv_sales_total,
            "live_rows": n, "live_spend": round(sp, 2),
            "live_date_from": d1.isoformat() if d1 else None, "live_date_to": d2.isoformat() if d2 else None,
            "uploaded_by": b.uploaded_by,
            "created_at": b.created_at.isoformat() if b.created_at else None,
        })
    return {"batches": out}


@router.delete("/gfa/upload/batches/{batch_id}")
async def gfa_upload_delete_batch(
    batch_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """그 업로드로 넣은 행(아직 남은 것)과 기록을 지운다."""
    b = (await db.execute(select(GfaUploadBatch).where(GfaUploadBatch.id == batch_id))).scalar_one_or_none()
    if not b:
        raise HTTPException(status_code=404, detail="없는 업로드 기록입니다")
    res = await db.execute(delete(GfaUploadDaily).where(GfaUploadDaily.batch_id == batch_id))
    await db.delete(b)
    await db.commit()
    logger.info(f"[GFA upload] batch={batch_id} deleted rows={res.rowcount} by={current_user.id}")
    return {"deleted": batch_id, "rows": max(int(res.rowcount or 0), 0)}


async def _span(db: AsyncSession, account: Optional[str] = None) -> Optional[dict]:
    q = select(func.count(), func.min(GfaUploadDaily.date), func.max(GfaUploadDaily.date))
    if account is not None:
        q = q.where(GfaUploadDaily.account_label == account)
    n, d1, d2 = (await db.execute(q)).one()
    if not n:
        return None
    return {"rows": int(n), "min": d1, "max": d2}


@router.get("/gfa/upload/status")
async def gfa_upload_status(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    span = await _span(db)
    if not span:
        return {"has_data": False, "rows": 0, "accounts": []}
    accs = (await db.execute(
        select(GfaUploadDaily.account_label, func.count(), func.min(GfaUploadDaily.date),
               func.max(GfaUploadDaily.date))
        .group_by(GfaUploadDaily.account_label).order_by(GfaUploadDaily.account_label)
    )).all()
    last = (await db.execute(select(GfaUploadBatch).order_by(GfaUploadBatch.id.desc()).limit(1))).scalars().first()
    return {
        "has_data": True, "rows": span["rows"],
        "date_min": span["min"].isoformat(), "date_max": span["max"].isoformat(),
        "accounts": [{"account": a, "rows": int(n), "date_min": d1.isoformat(), "date_max": d2.isoformat()}
                     for a, n, d1, d2 in accs],
        "last_upload": {
            "id": last.id, "filename": last.filename, "uploaded_by": last.uploaded_by,
            "created_at": last.created_at.isoformat() if last.created_at else None,
            "spend_vat": last.spend_vat,
        } if last else None,
    }


# ─── 대시보드 ───────────────────────────────────────────────────────────────

def _resolve(date_range: str, start_date: Optional[str], end_date: Optional[str], span: dict) -> tuple:
    today = _kst_today()
    if date_range == "custom" and start_date and end_date:
        try:
            d1, d2 = date.fromisoformat(start_date), date.fromisoformat(end_date)
        except ValueError:
            raise HTTPException(status_code=422, detail="날짜는 YYYY-MM-DD 형식이어야 합니다")
        return (d1, d2) if d1 <= d2 else (d2, d1)
    if date_range == "all":
        return span["min"], span["max"]
    if date_range == "today":
        return today, today
    if date_range == "yesterday":
        y = today - timedelta(days=1)
        return y, y
    if date_range == "last_14_days":
        return today - timedelta(days=13), today
    if date_range == "last_30_days":
        return today - timedelta(days=29), today
    if date_range == "last_90_days":
        return today - timedelta(days=89), today
    if date_range == "this_month":
        return today.replace(day=1), today
    if date_range == "last_month":
        end = today.replace(day=1) - timedelta(days=1)
        return end.replace(day=1), end
    return today - timedelta(days=6), today  # last_7_days


_COLS = (GfaUploadDaily.batch_id, GfaUploadDaily.account_label, GfaUploadDaily.date,
         GfaUploadDaily.campaign_id, GfaUploadDaily.campaign_name, GfaUploadDaily.adgroup_id,
         GfaUploadDaily.adgroup_name, GfaUploadDaily.creative_id, GfaUploadDaily.creative_name,
         GfaUploadDaily.creative_type, GfaUploadDaily.product, GfaUploadDaily.promotion,
         GfaUploadDaily.impressions, GfaUploadDaily.clicks, GfaUploadDaily.spend,
         GfaUploadDaily.conversions, GfaUploadDaily.conv_sales, GfaUploadDaily.budget)
_M = ("impressions", "clicks", "spend", "conversions", "conv_sales")


class _Acc:
    """지표 합 — None(파일에 칸 없음)과 0을 구분해 둔다."""
    __slots__ = ("impressions", "clicks", "spend", "conversions", "conv_sales", "has", "days")

    def __init__(self):
        for m in _M:
            setattr(self, m, 0.0)
        self.has: set = set()
        self.days: set = set()

    def add(self, r) -> None:
        for m in _M:
            v = getattr(r, m)
            if v is not None:
                setattr(self, m, getattr(self, m) + float(v))
                self.has.add(m)
        self.days.add(r.date)

    def out(self) -> dict:
        def g(m):
            return round(getattr(self, m), 2) if m in self.has or m == "spend" else None

        sp, imp, clk = self.spend, self.impressions, self.clicks
        conv, sales = self.conversions, self.conv_sales
        has = self.has
        return {
            "spend": round(sp, 2),
            "impressions": g("impressions"), "clicks": g("clicks"),
            "conversions": g("conversions"), "conv_sales": g("conv_sales"),
            "roas": round(sales / sp, 4) if sp and "conv_sales" in has else None,
            "cpa": round(sp / conv, 2) if conv and "conversions" in has else None,
            "ctr": round(clk / imp * 100, 4) if imp and {"clicks", "impressions"} <= has else None,
            "cpc": round(sp / clk, 2) if clk and "clicks" in has else None,
            "cvr": round(conv / clk * 100, 4) if clk and {"clicks", "conversions"} <= has else None,
            "cpm": round(sp / imp * 1000, 2) if imp and "impressions" in has else None,
            "days": len(self.days),
        }


def _pct(cur, prev) -> Optional[float]:
    if cur is None or prev is None or not prev:
        return None
    return round((cur - prev) / abs(prev) * 100, 2)


_CHG = ("spend", "conv_sales", "roas", "conversions", "cpa", "ctr", "cpc", "cvr", "clicks", "impressions")


def _series(rows: list, d1: date, d2: date, unit: str) -> list:
    buckets: dict = {}
    for r in rows:
        if unit == "daily":
            k = r.date
        elif unit == "weekly":
            k = r.date - timedelta(days=r.date.weekday())
        else:
            k = r.date.replace(day=1)
        buckets.setdefault(k, _Acc()).add(r)
    out, prev = [], None
    for k in sorted(buckets):
        m = buckets[k].out()
        if unit == "daily":
            start = end = k
            label = f"{k.month}/{k.day}"
        elif unit == "weekly":
            start, end = k, k + timedelta(days=6)
            label = f"{start.month}/{start.day}~{end.month}/{end.day}"
        else:
            nxt = (k.replace(day=28) + timedelta(days=4)).replace(day=1)
            start, end = k, nxt - timedelta(days=1)
            label = f"{k.year}-{k.month:02d}"
        m.update({
            "key": k.isoformat(), "label": label,
            "start": start.isoformat(), "end": end.isoformat(),
            "partial": start < d1 or end > d2,  # 고른 기간이 버킷 일부만 덮음
            "change": {c: _pct(m.get(c), prev.get(c)) for c in _CHG} if prev else None,
        })
        out.append(m)
        prev = m
    return out


def _group(rows: list, keyf, limit: Optional[int] = None) -> list:
    acc: dict = {}
    for r in rows:
        k = keyf(r)
        if k is None:
            continue
        acc.setdefault(k, _Acc()).add(r)
    items = [(k, a.out()) for k, a in acc.items()]
    items.sort(key=lambda x: -x[1]["spend"])
    return items[:limit] if limit else items


def _budget_by_campaign(rows: list, meta: dict) -> dict:
    """캠페인별 예산 소진 재료 → {(계정, 캠페인): (예산 합, 기준, 비교할 광고비)}.

    일 예산(daily) = 날짜마다(광고그룹 예산이면 그룹마다) 한 번씩 더하고, 광고비도 예산이 적힌 날짜만 더한다.
    총 예산(total) = 그룹마다 한 번, 광고비는 고른 기간 전체.
    """
    daily: dict = {}
    total: dict = {}
    for r in rows:
        if r.budget is None or r.budget <= 0:
            continue
        kind, scope = meta.get(r.batch_id, ("daily", "campaign"))
        ck = (r.account_label, r.campaign_id or r.campaign_name)
        sub = (r.adgroup_id or r.adgroup_name) if scope == "adgroup" else None
        if kind == "total":
            k = ck + (sub,)
            total[k] = max(total.get(k, 0.0), float(r.budget))
        else:
            k = ck + (sub, r.date)
            daily[k] = max(daily.get(k, 0.0), float(r.budget))
    out: dict = {}
    days: dict = {}
    for k, v in daily.items():
        ck = k[:2]
        out[ck] = [out.get(ck, [0.0])[0] + v, "daily", 0.0]
        days.setdefault(ck, set()).add(k[3])
    for k, v in total.items():
        ck = k[:2]
        if ck in days:  # 일 예산이 있으면 그쪽
            continue
        out[ck] = [out.get(ck, [0.0])[0] + v, "total", 0.0]
    for r in rows:
        ck = (r.account_label, r.campaign_id or r.campaign_name)
        cur = out.get(ck)
        if cur and (cur[1] == "total" or r.date in days.get(ck, ())):
            cur[2] += float(r.spend or 0)
    return {k: tuple(v) for k, v in out.items()}


@router.get("/gfa/upload/dashboard")
async def gfa_upload_dashboard(
    date_range: str = Query(default="last_30_days"),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    account: Optional[str] = None,  # 없으면 전체 계정
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """올린 파일 값으로 만든 GFA 성과 대시보드 — 핵심 KPI(직전 같은 길이 기간 대비)·일/주/월 추이·
    캠페인·소재·소재 유형·상품·프로모션. 파일에 없는 칸이 필요한 표는 availability로 알려 준다."""
    account = None if account in (None, "__all__") else account  # ''는 계정 이름 없이 올린 '기본' 계정
    span = await _span(db, account)
    if not span:
        return {"has_data": False}
    d1, d2 = _resolve(date_range, start_date, end_date, span)
    if (d2 - d1).days > 800:
        raise HTTPException(status_code=422, detail="조회 기간은 800일까지입니다")
    n = (d2 - d1).days + 1
    p2 = d1 - timedelta(days=1)
    p1 = p2 - timedelta(days=n - 1)

    q = select(*_COLS).where(GfaUploadDaily.date >= p1, GfaUploadDaily.date <= d2)
    if account is not None:
        q = q.where(GfaUploadDaily.account_label == account)
    rows = (await db.execute(q)).all()
    cur = [r for r in rows if r.date >= d1]
    prev = [r for r in rows if r.date <= p2]

    meta: dict = {}
    bids = sorted({r.batch_id for r in cur if r.budget})
    if bids:
        for bid, cols in (await db.execute(
            select(GfaUploadBatch.id, GfaUploadBatch.columns).where(GfaUploadBatch.id.in_(bids))
        )).all():
            try:
                m = json.loads(cols or "{}")
            except ValueError:
                m = {}
            meta[bid] = (m.get("budget_kind") or "daily", m.get("budget_scope") or "campaign")

    k_cur, k_prev = _Acc(), _Acc()
    for r in cur:
        k_cur.add(r)
    for r in prev:
        k_prev.add(r)
    kpi, kpi_prev = k_cur.out(), (k_prev.out() if prev else None)

    def has(attr):
        return any(getattr(r, attr) for r in cur)

    avail = {
        "impressions": "impressions" in k_cur.has, "clicks": "clicks" in k_cur.has,
        "conversions": "conversions" in k_cur.has, "conv_sales": "conv_sales" in k_cur.has,
        "campaign": has("campaign_name") or has("campaign_id"),
        "adgroup": has("adgroup_name") or has("adgroup_id"),
        "creative": has("creative_name") or has("creative_id"),
        "creative_type": has("creative_type"), "product": has("product"), "promotion": has("promotion"),
        "budget": any(r.budget for r in cur),
    }
    accounts_in = sorted({r.account_label for r in cur})

    camp_items = _group(cur, lambda r: (r.account_label, r.campaign_id or r.campaign_name)
                        if (r.campaign_id or r.campaign_name) else (r.account_label, None))
    names: dict = {}
    for r in cur:
        k = (r.account_label, r.campaign_id or r.campaign_name)
        if r.campaign_name and k not in names:
            names[k] = r.campaign_name
    budgets = _budget_by_campaign(cur, meta) if avail["budget"] else {}
    tot_sp = kpi["spend"] or 0
    tot_sales = kpi["conv_sales"] or 0
    campaigns = []
    for (acc, ck), m in camp_items:
        b = budgets.get((acc, ck))
        campaigns.append({
            "account": acc, "id": ck, "name": names.get((acc, ck)) or ck or "(캠페인 칸 없음)",
            **m,
            "spend_share": round(m["spend"] / tot_sp * 100, 2) if tot_sp else None,
            "sales_share": round((m["conv_sales"] or 0) / tot_sales * 100, 2) if tot_sales and m["conv_sales"] is not None else None,
            "budget": round(b[0], 2) if b else None,
            "budget_basis": b[1] if b else None,
            "budget_util": round(b[2] / b[0] * 100, 2) if b and b[0] else None,
        })

    creatives: list = []
    creative_count = 0
    if avail["creative"]:
        items = _group(cur, lambda r: (r.account_label, r.campaign_id or r.campaign_name,
                                       r.adgroup_id or r.adgroup_name, r.creative_id or r.creative_name,
                                       r.creative_type)
                       if (r.creative_id or r.creative_name) else None)
        creative_count = len(items)
        label: dict = {}
        for r in cur:
            k = (r.account_label, r.campaign_id or r.campaign_name, r.adgroup_id or r.adgroup_name,
                 r.creative_id or r.creative_name, r.creative_type)
            if k not in label:
                label[k] = (r.campaign_name or r.campaign_id, r.adgroup_name or r.adgroup_id,
                            r.creative_name or r.creative_id)
        for k, m in items[:TOP_CREATIVES]:
            c, g, nm = label.get(k, (None, None, None))
            creatives.append({"account": k[0], "campaign": c, "adgroup": g, "name": nm, "id": k[3],
                              "type": k[4], "type_group": gu.type_group(k[4]) if k[4] else None, **m})

    types = None
    if avail["creative_type"]:
        types = {
            "groups": [{"group": k, **m} for k, m in _group(cur, lambda r: gu.type_group(r.creative_type))],
            "raw": [{"type": k or "(빈칸)", **m} for k, m in _group(cur, lambda r: r.creative_type or "", TOP_GROUPS)],
        }
    products = [{"name": k, **m} for k, m in _group(cur, lambda r: r.product, TOP_GROUPS)] if avail["product"] else None
    promotions = ([{"name": k, **m} for k, m in _group(cur, lambda r: r.promotion, TOP_GROUPS)]
                  if avail["promotion"] else None)

    vats = sorted({v for (v,) in (await db.execute(
        select(GfaUploadBatch.spend_vat).where(GfaUploadBatch.id.in_(sorted({r.batch_id for r in cur}) or [-1]))
    )).all()}, key=lambda v: v or "")
    last = (await db.execute(select(GfaUploadBatch).order_by(GfaUploadBatch.id.desc()).limit(1))).scalars().first()
    days_with = {r.date for r in cur}
    return {
        "has_data": True,
        "source": "upload",
        "period": {"start": d1.isoformat(), "end": d2.isoformat(), "days": n,
                   "prev_start": p1.isoformat(), "prev_end": p2.isoformat()},
        "data_span": {"min": span["min"].isoformat(), "max": span["max"].isoformat(), "rows": span["rows"]},
        "missing_days": n - len(days_with),
        "account": account,
        "accounts": accounts_in,
        "availability": avail,
        "kpi": kpi,
        "kpi_prev": kpi_prev,
        "kpi_change": {c: _pct(kpi.get(c), kpi_prev.get(c)) for c in _CHG} if kpi_prev else None,
        "series": {u: _series(cur, d1, d2, u) for u in ("daily", "weekly", "monthly")},
        "campaigns": campaigns,
        "creatives": creatives,
        "creative_count": creative_count,
        "types": types,
        "products": products,
        "promotions": promotions,
        "spend_vat": [v for v in vats],
        "last_upload": {
            "filename": last.filename, "created_at": last.created_at.isoformat() if last.created_at else None,
            "uploaded_by": last.uploaded_by,
        } if last else None,
    }


# ─── 보고·계획 서비스 API용 (service.py) ─────────────────────────────────────

async def upload_daily(db: AsyncSession, d1: date, d2: date) -> Optional[dict]:
    """올린 GFA 파일 값 일별 합(모든 계정). 올린 값이 하나도 없으면 None."""
    span = await _span(db)
    if not span:
        return None
    rows = (await db.execute(
        select(GfaUploadDaily.date,
               func.coalesce(func.sum(GfaUploadDaily.spend), 0),
               func.coalesce(func.sum(GfaUploadDaily.conv_sales), 0),
               func.coalesce(func.sum(GfaUploadDaily.conversions), 0),
               func.coalesce(func.sum(GfaUploadDaily.impressions), 0),
               func.coalesce(func.sum(GfaUploadDaily.clicks), 0))
        .where(GfaUploadDaily.date >= d1, GfaUploadDaily.date <= d2)
        .group_by(GfaUploadDaily.date).order_by(GfaUploadDaily.date)
    )).all()
    in_range = select(GfaUploadDaily.batch_id).where(GfaUploadDaily.date >= d1, GfaUploadDaily.date <= d2).distinct()
    vats = {v for (v,) in (await db.execute(
        select(GfaUploadBatch.spend_vat).where(GfaUploadBatch.id.in_(in_range)).distinct()
    )).all()}
    last = (await db.execute(select(func.max(GfaUploadBatch.created_at)))).scalar()
    return {
        "connected": True,
        "source": "upload",
        "data_from": span["min"].isoformat(),
        "data_until": span["max"].isoformat(),
        "uploaded_at": last.isoformat() if last else None,
        "spend_vat": next(iter(vats)) if len(vats) == 1 else ("mixed" if vats else None),  # excl|incl|None|mixed
        "daily": [{"date": d.isoformat(), "spend": round(float(s), 2), "conv_sales": round(float(cs), 2),
                   "conversions": round(float(c), 2), "impressions": round(float(i), 2),
                   "clicks": round(float(k), 2)}
                  for d, s, cs, c, i, k in rows],
    }
