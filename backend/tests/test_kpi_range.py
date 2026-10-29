"""자사몰 KPI 직접 설정 기간 — 검증 규칙만 시험(DB 없음)."""
from datetime import date, timedelta

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import kpi


def test_no_range():
    assert kpi._resolve_range(None, None) is None


def test_half_range_rejected():
    with pytest.raises(HTTPException):
        kpi._resolve_range(date(2026, 10, 1), None)


def test_reversed_rejected():
    with pytest.raises(HTTPException):
        kpi._resolve_range(date(2026, 10, 10), date(2026, 10, 1))


def test_future_end_clamped():
    s, e = kpi._resolve_range(date(2026, 1, 1), date.today() + timedelta(days=30))
    assert e == date.today()


def test_months_between():
    assert kpi._months_between(date(2025, 11, 15), date(2026, 2, 3)) == ["2025-11", "2025-12", "2026-01", "2026-02"]
    assert kpi._months_between(date(2026, 10, 1), date(2026, 10, 29)) == ["2026-10"]
