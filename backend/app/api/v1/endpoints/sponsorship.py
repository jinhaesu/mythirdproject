"""협찬(스폰서십) 관리 모듈 — 전시/마라톤/대학축제/동아리 등 행사 제품 협찬 기록·집계.

엔드포인트:
  GET    /api/v1/sponsorship/events                — 협찬 목록 (품목·결과물 포함)
  POST   /api/v1/sponsorship/events                — 협찬 등록 (items 복수 품목)
  PUT    /api/v1/sponsorship/events/{id}           — 협찬 수정 (items 교체)
  DELETE /api/v1/sponsorship/events/{id}           — 협찬 삭제 (품목·결과물 같이)
  POST   /api/v1/sponsorship/events/{id}/outcomes  — 결과물 등록
  PUT    /api/v1/sponsorship/outcomes/{id}         — 결과물 수정
  DELETE /api/v1/sponsorship/outcomes/{id}         — 결과물 삭제
  GET    /api/v1/sponsorship/summary               — 월별/품목별/종류별/결과물 집계
  GET    /api/v1/sponsorship/meta                  — 종류·품목 자동완성 목록
  GET    /api/v1/sponsorship/export                — xlsx 다운로드

2026-10-02 재활성화: 복수 품목(sponsorship_items)·결과물(sponsorship_outcomes)
추가. event_type은 자유 문자열(전시, 마라톤, 대학축제 …) — 구 코드값은
EVENT_TYPE_LABELS로 한글 표기 폴백.
"""
import logging
from collections import defaultdict
from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete as sa_delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_user
from app.db.database import get_db
from app.models.sponsorship import Sponsorship, SponsorshipItem, SponsorshipOutcome
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter()

EVENT_TYPE_LABELS = {
    "festival": "대학축제",
    "club": "동아리",
    "marathon": "마라톤",
    "conference": "학회",
    "etc": "기타",
}


# ── 공용 헬퍼 ────────────────────────────────────────────────────────────────

def _item_out(it: SponsorshipItem) -> dict:
    return {
        "id": it.id, "product": it.product, "quantity": it.quantity,
        "estimated_value": it.estimated_value, "note": it.note,
    }


def _outcome_out(o: SponsorshipOutcome) -> dict:
    return {
        "id": o.id, "kind": o.kind, "link": o.link, "views": o.views,
        "note": o.note,
        "occurred_at": o.occurred_at.isoformat() if o.occurred_at else None,
    }


def _serialize(row: Sponsorship, items: Optional[list] = None, outcomes: Optional[list] = None) -> dict:
    return {
        "id": row.id,
        "target_name": row.target_name,
        "event_type": row.event_type,
        "event_type_label": EVENT_TYPE_LABELS.get(row.event_type, row.event_type),
        "sponsored_at": row.sponsored_at.isoformat() if row.sponsored_at else None,
        "product": row.product,
        "quantity": row.quantity,
        "estimated_value": row.estimated_value,
        "reason": row.reason,
        "expected_effect": row.expected_effect,
        "conditions": row.conditions,
        "notes": row.notes,
        "items": [_item_out(i) for i in (items or [])],
        "outcomes": [_outcome_out(o) for o in (outcomes or [])],
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _apply_items_rollup(row: Sponsorship, items: List["ItemIn"]) -> None:
    """레거시 product/quantity/estimated_value 컬럼을 품목 합계 요약으로 유지."""
    names = [i.product.strip() for i in items if i.product.strip()]
    row.product = (names[0] + (f" 외 {len(names) - 1}" if len(names) > 1 else "")) if names else "-"
    row.quantity = sum(int(i.quantity or 0) for i in items)
    values = [i.estimated_value for i in items if i.estimated_value is not None]
    row.estimated_value = sum(values) if values else None


async def _load_children(db: AsyncSession, ids: List[int]):
    """협찬 id들의 품목·결과물을 한 번에 로드 → {id: [...]} 2개."""
    items_by: dict[int, list] = defaultdict(list)
    outs_by: dict[int, list] = defaultdict(list)
    if ids:
        for it in (await db.execute(
            select(SponsorshipItem).where(SponsorshipItem.sponsorship_id.in_(ids))
            .order_by(SponsorshipItem.id)
        )).scalars().all():
            items_by[it.sponsorship_id].append(it)
        for o in (await db.execute(
            select(SponsorshipOutcome).where(SponsorshipOutcome.sponsorship_id.in_(ids))
            .order_by(SponsorshipOutcome.id)
        )).scalars().all():
            outs_by[o.sponsorship_id].append(o)
    return items_by, outs_by


def _parse_date(value: str, field_name: str = "sponsored_at") -> date:
    try:
        return date.fromisoformat(value)
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail=f"{field_name}는 YYYY-MM-DD 형식이어야 합니다.")


def _split_conditions(conditions: Optional[str]) -> list[str]:
    if not conditions:
        return []
    return [c.strip() for c in conditions.split(",") if c.strip()]


# ── GET /events ──────────────────────────────────────────────────────────────

@router.get("/events")
async def list_events(
    event_type: Optional[str] = Query(default=None),
    since: Optional[str] = Query(default=None, description="YYYY-MM-DD"),
    until: Optional[str] = Query(default=None, description="YYYY-MM-DD"),
    q: Optional[str] = Query(default=None, description="대상명/제품/사유 검색어"),
    limit: int = Query(default=300, ge=1, le=1000),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """협찬 목록 (sponsored_at desc)."""
    query = select(Sponsorship)
    if event_type:
        query = query.where(Sponsorship.event_type == event_type)
    if since:
        query = query.where(Sponsorship.sponsored_at >= _parse_date(since, "since"))
    if until:
        query = query.where(Sponsorship.sponsored_at <= _parse_date(until, "until"))
    if q:
        like = f"%{q.strip()}%"
        query = query.where(
            (Sponsorship.target_name.ilike(like))
            | (Sponsorship.product.ilike(like))
            | (Sponsorship.reason.ilike(like))
        )
    query = query.order_by(Sponsorship.sponsored_at.desc(), Sponsorship.id.desc()).limit(limit)

    rows = (await db.execute(query)).scalars().all()
    items_by, outs_by = await _load_children(db, [r.id for r in rows])
    return {
        "events": [_serialize(r, items_by.get(r.id), outs_by.get(r.id)) for r in rows],
        "count": len(rows),
    }


# ── POST /events ─────────────────────────────────────────────────────────────

class ItemIn(BaseModel):
    product: str = Field(..., max_length=200)
    quantity: int = Field(0, ge=0)
    estimated_value: Optional[float] = Field(None, ge=0)
    note: Optional[str] = Field(None, max_length=200)


class SponsorshipCreate(BaseModel):
    target_name: str
    event_type: str
    sponsored_at: str  # YYYY-MM-DD
    items: Optional[List[ItemIn]] = None  # 복수 품목 (권장)
    # 레거시 단일 품목 호환
    product: Optional[str] = None
    quantity: Optional[int] = 0
    estimated_value: Optional[float] = None
    reason: Optional[str] = None
    expected_effect: Optional[str] = None
    conditions: Optional[str] = None
    notes: Optional[str] = None


def _normalize_items(payload) -> List[ItemIn]:
    items = [i for i in (payload.items or []) if i.product and i.product.strip()]
    if not items and payload.product and payload.product.strip():
        items = [ItemIn(product=payload.product.strip(), quantity=payload.quantity or 0,
                        estimated_value=payload.estimated_value)]
    return items


@router.post("/events")
async def create_event(
    payload: SponsorshipCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """협찬 등록 — items에 품목·수량 복수 기입."""
    if not payload.target_name or not payload.target_name.strip():
        raise HTTPException(status_code=422, detail="target_name은 필수입니다.")
    if not payload.event_type or not payload.event_type.strip():
        raise HTTPException(status_code=422, detail="event_type은 필수입니다.")
    items = _normalize_items(payload)
    if not items:
        raise HTTPException(status_code=422, detail="품목을 1개 이상 입력해 주세요.")

    sponsored_at = _parse_date(payload.sponsored_at)

    row = Sponsorship(
        target_name=payload.target_name.strip(),
        event_type=payload.event_type.strip(),
        sponsored_at=sponsored_at,
        reason=payload.reason,
        expected_effect=payload.expected_effect,
        conditions=payload.conditions,
        notes=payload.notes,
    )
    _apply_items_rollup(row, items)
    db.add(row)
    await db.flush()
    item_rows = [SponsorshipItem(
        sponsorship_id=row.id, product=i.product.strip(), quantity=i.quantity or 0,
        estimated_value=i.estimated_value, note=i.note,
    ) for i in items]
    db.add_all(item_rows)
    await db.commit()
    await db.refresh(row)
    return _serialize(row, item_rows, [])


# ── PUT /events/{id} ─────────────────────────────────────────────────────────

class SponsorshipUpdate(BaseModel):
    target_name: Optional[str] = None
    event_type: Optional[str] = None
    sponsored_at: Optional[str] = None
    items: Optional[List[ItemIn]] = None  # 주어지면 품목 전체 교체
    reason: Optional[str] = None
    expected_effect: Optional[str] = None
    conditions: Optional[str] = None
    notes: Optional[str] = None


@router.put("/events/{event_id}")
async def update_event(
    event_id: int,
    payload: SponsorshipUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """협찬 부분 수정 (지정된 필드만 갱신, items는 전체 교체)."""
    row = (
        await db.execute(select(Sponsorship).where(Sponsorship.id == event_id))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="협찬 항목을 찾을 수 없습니다.")

    data = payload.model_dump(exclude_none=True, exclude={"items"})
    if "sponsored_at" in data:
        data["sponsored_at"] = _parse_date(data["sponsored_at"])
    for field, value in data.items():
        setattr(row, field, value)

    if payload.items is not None:
        items = [i for i in payload.items if i.product and i.product.strip()]
        if not items:
            raise HTTPException(status_code=422, detail="품목을 1개 이상 입력해 주세요.")
        await db.execute(sa_delete(SponsorshipItem).where(SponsorshipItem.sponsorship_id == event_id))
        db.add_all([SponsorshipItem(
            sponsorship_id=event_id, product=i.product.strip(), quantity=i.quantity or 0,
            estimated_value=i.estimated_value, note=i.note,
        ) for i in items])
        _apply_items_rollup(row, items)

    await db.commit()
    await db.refresh(row)
    items_by, outs_by = await _load_children(db, [event_id])
    return _serialize(row, items_by.get(event_id), outs_by.get(event_id))


# ── DELETE /events/{id} ──────────────────────────────────────────────────────

@router.delete("/events/{event_id}")
async def delete_event(
    event_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = (
        await db.execute(select(Sponsorship).where(Sponsorship.id == event_id))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="협찬 항목을 찾을 수 없습니다.")
    await db.execute(sa_delete(SponsorshipItem).where(SponsorshipItem.sponsorship_id == event_id))
    await db.execute(sa_delete(SponsorshipOutcome).where(SponsorshipOutcome.sponsorship_id == event_id))
    await db.delete(row)
    await db.commit()
    return {"status": "deleted", "id": event_id}


# ── 결과물 (outcomes) ─────────────────────────────────────────────────────────

class OutcomeIn(BaseModel):
    kind: str = Field(..., max_length=50)  # 사진|영상|SNS 포스팅|보도|후기|기타
    link: Optional[str] = Field(None, max_length=500)
    views: Optional[int] = Field(None, ge=0)
    note: Optional[str] = Field(None, max_length=300)
    occurred_at: Optional[str] = None  # YYYY-MM-DD


@router.post("/events/{event_id}/outcomes")
async def add_outcome(
    event_id: int,
    payload: OutcomeIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """협찬 결과물 등록."""
    exists = (await db.execute(
        select(Sponsorship.id).where(Sponsorship.id == event_id)
    )).scalar_one_or_none()
    if exists is None:
        raise HTTPException(status_code=404, detail="협찬 항목을 찾을 수 없습니다.")
    if not payload.kind.strip():
        raise HTTPException(status_code=422, detail="kind는 필수입니다.")
    o = SponsorshipOutcome(
        sponsorship_id=event_id, kind=payload.kind.strip(), link=payload.link,
        views=payload.views, note=payload.note,
        occurred_at=_parse_date(payload.occurred_at, "occurred_at") if payload.occurred_at else None,
    )
    db.add(o)
    await db.commit()
    await db.refresh(o)
    return _outcome_out(o)


@router.put("/outcomes/{outcome_id}")
async def update_outcome(
    outcome_id: int,
    payload: OutcomeIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    o = (await db.execute(
        select(SponsorshipOutcome).where(SponsorshipOutcome.id == outcome_id)
    )).scalar_one_or_none()
    if o is None:
        raise HTTPException(status_code=404, detail="결과물을 찾을 수 없습니다.")
    o.kind = payload.kind.strip() or o.kind
    o.link = payload.link
    o.views = payload.views
    o.note = payload.note
    o.occurred_at = _parse_date(payload.occurred_at, "occurred_at") if payload.occurred_at else None
    await db.commit()
    await db.refresh(o)
    return _outcome_out(o)


@router.delete("/outcomes/{outcome_id}")
async def delete_outcome(
    outcome_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    o = (await db.execute(
        select(SponsorshipOutcome).where(SponsorshipOutcome.id == outcome_id)
    )).scalar_one_or_none()
    if o is None:
        raise HTTPException(status_code=404, detail="결과물을 찾을 수 없습니다.")
    await db.delete(o)
    await db.commit()
    return {"status": "deleted", "id": outcome_id}


# ── GET /meta ────────────────────────────────────────────────────────────────

@router.get("/meta")
async def get_meta(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """자동완성용 — 기존 협찬 종류·품목·결과물 종류 목록."""
    event_types = [EVENT_TYPE_LABELS.get(t, t) for t in (await db.execute(
        select(Sponsorship.event_type).distinct()
    )).scalars().all() if t]
    products = [p for p in (await db.execute(
        select(SponsorshipItem.product).distinct()
    )).scalars().all() if p]
    kinds = [k for k in (await db.execute(
        select(SponsorshipOutcome.kind).distinct()
    )).scalars().all() if k]
    default_types = ["전시", "마라톤", "대학축제", "동아리", "학회", "팝업", "운동회", "기타"]
    default_kinds = ["사진", "영상", "SNS 포스팅", "보도", "후기", "기타"]
    return {
        "event_types": sorted(set(event_types) | set(default_types)),
        "products": sorted(set(products)),
        "outcome_kinds": sorted(set(kinds) | set(default_kinds)),
    }


# ── GET /summary ─────────────────────────────────────────────────────────────

@router.get("/summary")
async def get_summary(
    months: int = Query(default=12, ge=1, le=60),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """월별 / 제품별 / 행사유형별 / 협찬조건별 집계."""
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
            select(Sponsorship).where(Sponsorship.sponsored_at >= range_start)
        )
    ).scalars().all()
    items_by, outs_by = await _load_children(db, [r.id for r in rows])

    by_month: dict[str, dict] = defaultdict(lambda: {"count": 0, "quantity": 0, "estimated_value": 0.0, "outcomes": 0})
    by_product: dict[str, dict] = defaultdict(lambda: {"count": 0, "quantity": 0, "estimated_value": 0.0})
    by_event_type: dict[str, dict] = defaultdict(lambda: {"count": 0, "quantity": 0, "estimated_value": 0.0, "outcomes": 0})
    by_condition: dict[str, int] = defaultdict(int)
    by_outcome_kind: dict[str, dict] = defaultdict(lambda: {"count": 0, "views": 0})

    total_count = 0
    total_quantity = 0
    total_estimated_value = 0.0
    total_outcomes = 0
    total_views = 0

    for r in rows:
        quantity = int(r.quantity or 0)
        value = float(r.estimated_value or 0)
        outs = outs_by.get(r.id, [])
        type_label = EVENT_TYPE_LABELS.get(r.event_type, r.event_type)

        total_count += 1
        total_quantity += quantity
        total_estimated_value += value
        total_outcomes += len(outs)

        if r.sponsored_at:
            month_key = f"{r.sponsored_at.year:04d}-{r.sponsored_at.month:02d}"
            by_month[month_key]["count"] += 1
            by_month[month_key]["quantity"] += quantity
            by_month[month_key]["estimated_value"] += value
            by_month[month_key]["outcomes"] += len(outs)

        # 품목별: 자식 품목이 있으면 품목 단위로, 없으면(레거시) 요약 컬럼으로
        its = items_by.get(r.id, [])
        if its:
            for it in its:
                by_product[it.product]["count"] += 1
                by_product[it.product]["quantity"] += int(it.quantity or 0)
                by_product[it.product]["estimated_value"] += float(it.estimated_value or 0)
        elif r.product:
            by_product[r.product]["count"] += 1
            by_product[r.product]["quantity"] += quantity
            by_product[r.product]["estimated_value"] += value

        by_event_type[type_label]["count"] += 1
        by_event_type[type_label]["quantity"] += quantity
        by_event_type[type_label]["estimated_value"] += value
        by_event_type[type_label]["outcomes"] += len(outs)

        for cond in _split_conditions(r.conditions):
            by_condition[cond] += 1

        for o in outs:
            by_outcome_kind[o.kind]["count"] += 1
            by_outcome_kind[o.kind]["views"] += int(o.views or 0)
            total_views += int(o.views or 0)

    return {
        "as_of": datetime.utcnow().isoformat(),
        "by_month": [
            {
                "month": k,
                "count": v["count"],
                "quantity": v["quantity"],
                "estimated_value": round(v["estimated_value"], 2),
                "outcomes": v["outcomes"],
            }
            for k, v in sorted(by_month.items())
        ],
        "by_product": [
            {"product": k, "count": v["count"], "quantity": v["quantity"],
             "estimated_value": round(v["estimated_value"], 2)}
            for k, v in sorted(by_product.items(), key=lambda kv: -kv[1]["quantity"])
        ],
        "by_event_type": [
            {
                "event_type": k,
                "count": v["count"],
                "quantity": v["quantity"],
                "estimated_value": round(v["estimated_value"], 2),
                "outcomes": v["outcomes"],
            }
            for k, v in sorted(by_event_type.items(), key=lambda kv: -kv[1]["count"])
        ],
        "by_condition": [
            {"condition": k, "count": v}
            for k, v in sorted(by_condition.items(), key=lambda kv: -kv[1])
        ],
        "by_outcome_kind": [
            {"kind": k, "count": v["count"], "views": v["views"]}
            for k, v in sorted(by_outcome_kind.items(), key=lambda kv: -kv[1]["count"])
        ],
        "total": {
            "count": total_count,
            "quantity": total_quantity,
            "estimated_value": round(total_estimated_value, 2),
            "outcomes": total_outcomes,
            "views": total_views,
        },
    }


# ── GET /export ──────────────────────────────────────────────────────────────

@router.get("/export")
async def export_events(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """협찬 목록 + 제품별/행사유형별 요약 xlsx 다운로드."""
    from io import BytesIO
    from urllib.parse import quote

    from fastapi.responses import StreamingResponse
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    rows = (
        await db.execute(select(Sponsorship).order_by(Sponsorship.sponsored_at.desc()))
    ).scalars().all()
    items_by, outs_by = await _load_children(db, [r.id for r in rows])

    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="2A2D35", end_color="2A2D35", fill_type="solid")
    center = Alignment(horizontal="center", vertical="center")

    wb = Workbook()

    # ===== Sheet1: 협찬 목록 =====
    ws1 = wb.active
    ws1.title = "협찬 목록"
    headers1 = ["일자", "대상명", "행사유형", "제품", "수량", "환산금액", "협찬조건", "사유", "기대효과", "메모"]
    ws1.append(headers1)
    for col in range(1, len(headers1) + 1):
        cell = ws1.cell(row=1, column=col)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center

    for r in rows:
        ws1.append([
            r.sponsored_at.isoformat() if r.sponsored_at else "",
            r.target_name or "",
            EVENT_TYPE_LABELS.get(r.event_type, r.event_type or ""),
            r.product or "",
            r.quantity or 0,
            r.estimated_value or 0,
            r.conditions or "",
            r.reason or "",
            r.expected_effect or "",
            r.notes or "",
        ])

    widths1 = [12, 26, 12, 18, 8, 12, 30, 30, 30, 24]
    for i, w in enumerate(widths1, start=1):
        ws1.column_dimensions[get_column_letter(i)].width = w

    # ===== Sheet2: 제품별 요약 =====
    ws2 = wb.create_sheet("제품별 요약")
    headers2 = ["제품", "건수", "수량", "환산금액"]
    ws2.append(headers2)
    for col in range(1, len(headers2) + 1):
        cell = ws2.cell(row=1, column=col)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center

    product_agg: dict[str, dict] = defaultdict(lambda: {"count": 0, "quantity": 0, "estimated_value": 0.0})
    for r in rows:
        product_agg[r.product]["count"] += 1
        product_agg[r.product]["quantity"] += int(r.quantity or 0)
        product_agg[r.product]["estimated_value"] += float(r.estimated_value or 0)
    for product, agg in sorted(product_agg.items(), key=lambda kv: -kv[1]["count"]):
        ws2.append([product, agg["count"], agg["quantity"], agg["estimated_value"]])
    for i, w in enumerate([24, 10, 10, 14], start=1):
        ws2.column_dimensions[get_column_letter(i)].width = w

    # ===== Sheet3: 행사유형별 요약 =====
    ws3 = wb.create_sheet("행사유형별 요약")
    headers3 = ["행사유형", "건수", "수량", "환산금액"]
    ws3.append(headers3)
    for col in range(1, len(headers3) + 1):
        cell = ws3.cell(row=1, column=col)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center

    event_type_agg: dict[str, dict] = defaultdict(lambda: {"count": 0, "quantity": 0, "estimated_value": 0.0})
    for r in rows:
        event_type_agg[r.event_type]["count"] += 1
        event_type_agg[r.event_type]["quantity"] += int(r.quantity or 0)
        event_type_agg[r.event_type]["estimated_value"] += float(r.estimated_value or 0)
    for event_type, agg in sorted(event_type_agg.items(), key=lambda kv: -kv[1]["count"]):
        label = EVENT_TYPE_LABELS.get(event_type, event_type)
        ws3.append([label, agg["count"], agg["quantity"], agg["estimated_value"]])
    for i, w in enumerate([16, 10, 10, 14], start=1):
        ws3.column_dimensions[get_column_letter(i)].width = w

    # ===== Sheet4: 품목 상세 =====
    ws4 = wb.create_sheet("품목 상세")
    headers4 = ["일자", "대상명", "종류", "품목", "수량", "환산금액", "비고"]
    ws4.append(headers4)
    for col in range(1, len(headers4) + 1):
        cell = ws4.cell(row=1, column=col)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center
    for r in rows:
        for it in items_by.get(r.id, []):
            ws4.append([
                r.sponsored_at.isoformat() if r.sponsored_at else "",
                r.target_name or "",
                EVENT_TYPE_LABELS.get(r.event_type, r.event_type or ""),
                it.product, it.quantity or 0, it.estimated_value or 0, it.note or "",
            ])
    for i, w in enumerate([12, 26, 12, 20, 8, 12, 24], start=1):
        ws4.column_dimensions[get_column_letter(i)].width = w

    # ===== Sheet5: 결과물 =====
    ws5 = wb.create_sheet("결과물")
    headers5 = ["협찬 일자", "대상명", "결과물 종류", "링크", "조회/노출", "게시일", "메모"]
    ws5.append(headers5)
    for col in range(1, len(headers5) + 1):
        cell = ws5.cell(row=1, column=col)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center
    for r in rows:
        for o in outs_by.get(r.id, []):
            ws5.append([
                r.sponsored_at.isoformat() if r.sponsored_at else "",
                r.target_name or "",
                o.kind, o.link or "", o.views or 0,
                o.occurred_at.isoformat() if o.occurred_at else "",
                o.note or "",
            ])
    for i, w in enumerate([12, 26, 14, 50, 10, 12, 24], start=1):
        ws5.column_dimensions[get_column_letter(i)].width = w

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)

    today_str = datetime.utcnow().strftime("%Y%m%d")
    filename = f"협찬관리_{today_str}.xlsx"
    quoted = quote(filename)

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quoted}",
        },
    )
