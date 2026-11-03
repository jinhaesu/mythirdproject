"""GFA 성과 파일 누적·달 보기·비교 기간 (2026-11-03 연다은 건의).

GFA 광고 관리자는 한 번에 60일까지만 내려받을 수 있어 1~2월·3~4월처럼 나눠 올린다.
나눠 올린 파일이 쌓이고(같은 날짜는 새 파일이 이김), 달 보기·직접 지정·비교 기간이 고른 기간을 따라가는지 본다.
DB는 SQLite 메모리(운영 DB 안 씀).
"""
import asyncio
import io
from datetime import date, timedelta

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.v1.endpoints import naver_gfa_upload as up
from app.db.database import Base
from app.models.gfa_upload import GfaUploadBatch, GfaUploadDaily
from app.models.user import User


# ─── 순수 함수 ───────────────────────────────────────────────────────────────

def test_compare_month():
    assert up._compare(date(2026, 3, 1), date(2026, 3, 31))[:2] == (date(2026, 2, 1), date(2026, 2, 28))
    assert up._compare(date(2026, 3, 1), date(2026, 3, 31))[2] == "전월 대비"
    # 여러 달 → 바로 앞 같은 개수의 달
    p1, p2, label = up._compare(date(2026, 1, 1), date(2026, 2, 28))
    assert (p1, p2) == (date(2025, 11, 1), date(2025, 12, 31)) and label == "직전 2개월 대비"


def test_compare_partial_month():
    # 진행 중인 달(1일~3일) → 전월 1일~3일
    p1, p2, label = up._compare(date(2026, 11, 1), date(2026, 11, 3))
    assert (p1, p2) == (date(2026, 10, 1), date(2026, 10, 3)) and "전월 같은 기간" in label
    # 3월 1~31이 아닌 1~30 → 2월은 말일에서 자른다
    assert up._compare(date(2026, 3, 1), date(2026, 3, 30))[:2] == (date(2026, 2, 1), date(2026, 2, 28))


def test_compare_custom_days():
    p1, p2, label = up._compare(date(2026, 10, 5), date(2026, 10, 11))
    assert (p1, p2) == (date(2026, 9, 28), date(2026, 10, 4)) and label == "직전 7일 대비"


def test_resolve_month():
    span = {"min": date(2026, 1, 1), "max": date(2026, 4, 30)}
    assert up._resolve("month", None, None, span, "2026-02") == (date(2026, 2, 1), date(2026, 2, 28))
    today = up._kst_today()
    d1, d2 = up._resolve("month", None, None, span, None)  # 이번 달은 오늘까지
    assert d1 == today.replace(day=1) and d2 == today
    with pytest.raises(HTTPException):
        up._resolve("month", None, None, span, "2026-13")


def test_coverage_runs_and_gaps():
    days = [date(2026, 1, 1) + timedelta(days=i) for i in range(59)]  # 1/1~2/28
    days += [date(2026, 4, 1) + timedelta(days=i) for i in range(30)]  # 4/1~4/30 (3월 빔)
    c = up.coverage_of(days, date(2026, 2, 20), date(2026, 4, 5))
    assert c["runs"] == [{"from": "2026-01-01", "to": "2026-02-28", "days": 59},
                         {"from": "2026-04-01", "to": "2026-04-30", "days": 30}]
    assert c["gaps"] == [{"from": "2026-03-01", "to": "2026-03-31", "days": 31}]
    assert c["missing"] == [{"from": "2026-03-01", "to": "2026-03-31", "days": 31}]
    assert {m["month"]: (m["days"], m["month_days"]) for m in c["months"]} == {
        "2026-01": (31, 31), "2026-02": (28, 28), "2026-04": (30, 30)}
    assert up.coverage_of([]) == {"runs": [], "gaps": [], "months": []}


# ─── 나눠 올린 파일 누적 (SQLite 메모리) ─────────────────────────────────────

HEAD = "기간,광고 계정,캠페인 이름,노출,클릭,총 비용(VAT 제외),전환수,전환 매출액\n"


def _csv(d1: date, d2: date, spend: int, camps=("가을", "겨울")) -> bytes:
    lines = [HEAD]
    d = d1
    while d <= d2:
        for c in camps:
            lines.append(f"{d:%Y.%m.%d.},본계정,{c},1000,10,{spend},1,{spend * 4}\n")
        d += timedelta(days=1)
    return "".join(lines).encode("utf-8-sig")


def _uf(name: str, data: bytes) -> UploadFile:
    return UploadFile(file=io.BytesIO(data), filename=name)


async def _scenario():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool,
                                 connect_args={"check_same_thread": False})
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all, tables=[
            User.__table__, GfaUploadBatch.__table__, GfaUploadDaily.__table__])
    user = User(id=1, email="tester@example.com")
    async with Session() as s:
        s.add(user)
        await s.commit()
    kw = dict(account_label=None, sheet=None, header_row=None, mapping=None, current_user=user)

    async def apply(name, data):
        async with Session() as db:
            return await up.gfa_upload_apply(file=_uf(name, data), db=db, **kw)

    async def count():
        async with Session() as db:
            return (await db.execute(select(func.count()).select_from(GfaUploadDaily))).scalar()

    async def dash(**q):
        args = dict(date_range="month", start_date=None, end_date=None, month=None, account=None)
        args.update(q)
        async with Session() as db:
            return await up.gfa_upload_dashboard(current_user=user, db=db, **args)

    # 1~2월(59일) → 3~4월(61일은 못 받으니 3/1~4/29 60일) 차례로 올리면 쌓인다
    r1 = await apply("gfa_0102.csv", _csv(date(2026, 1, 1), date(2026, 2, 28), 1000))
    assert r1["inserted"] == 59 * 2 and r1["replaced"] == 0
    r2 = await apply("gfa_0304.csv", _csv(date(2026, 3, 1), date(2026, 4, 29), 2000))
    assert r2["inserted"] == 60 * 2 and r2["replaced"] == 0
    assert await count() == (59 + 60) * 2

    # 겹치는 파일(2/20~3/10, 값 3000) → 그 날짜만 새 값, 나머지는 그대로
    r3 = await apply("gfa_overlap.csv", _csv(date(2026, 2, 20), date(2026, 3, 10), 3000))
    assert r3["replaced"] == 19 * 2 and await count() == (59 + 60) * 2

    async with Session() as db:
        st = await up.gfa_upload_status(current_user=user, db=db)
        cov = await up.gfa_upload_coverage(account=None, current_user=user, db=db)
        bl = await up.gfa_upload_batches(limit=30, current_user=user, db=db)
    assert st["date_min"] == "2026-01-01" and st["date_max"] == "2026-04-29"
    assert cov["runs"] == [{"from": "2026-01-01", "to": "2026-04-29", "days": 119}] and cov["gaps"] == []
    assert st["coverage"] == cov
    live = {b["filename"]: (b["live_date_from"], b["live_date_to"], b["live_rows"]) for b in bl["batches"]}
    assert live["gfa_overlap.csv"] == ("2026-02-20", "2026-03-10", 38)
    assert live["gfa_0102.csv"] == ("2026-01-01", "2026-02-19", 50 * 2)
    assert live["gfa_0304.csv"] == ("2026-03-11", "2026-04-29", 50 * 2)

    # 달 보기 — 2월: 1~19일 1000×2, 20~28일 3000×2 / 비교 = 1월(1000×2×31)
    d = await dash(month="2026-02")
    assert d["period"]["start"] == "2026-02-01" and d["period"]["end"] == "2026-02-28"
    assert d["kpi"]["spend"] == 19 * 2000 + 9 * 6000
    assert d["period"]["compare_label"] == "전월 대비"
    assert d["period"]["prev_start"] == "2026-01-01" and d["period"]["prev_end"] == "2026-01-31"
    assert d["kpi_prev"]["spend"] == 31 * 2000
    assert d["missing_days"] == 0 and d["coverage"]["missing"] == []

    # 4월은 30일이 비었다 → 빈 날로 알려 준다
    d = await dash(month="2026-04")
    assert d["missing_days"] == 1 and d["coverage"]["missing"] == [{"from": "2026-04-30", "to": "2026-04-30", "days": 1}]

    # 직접 지정 — 1/10~2/5(27일) → 비교 = 바로 앞 27일(12/14~1/9), 데이터는 1/1~1/9만
    d = await dash(date_range="custom", start_date="2026-01-10", end_date="2026-02-05")
    assert d["period"]["compare_label"] == "직전 27일 대비"
    assert d["period"]["prev_start"] == "2025-12-14" and d["period"]["prev_days_with_data"] == 9
    assert d["kpi"]["spend"] == 27 * 2000 and d["kpi_prev"]["spend"] == 9 * 2000

    # 2개월 묶음(1~2월) → 비교 = 직전 2개월(데이터 없음)
    d = await dash(date_range="custom", start_date="2026-01-01", end_date="2026-02-28")
    assert d["period"]["compare_label"] == "직전 2개월 대비" and d["kpi_prev"] is None
    await engine.dispose()


def test_split_uploads_accumulate():
    asyncio.run(_scenario())
