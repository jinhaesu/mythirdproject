"""카페24 토큰 만료 시각 시간대 (2026-11-05: 한국 시각을 UTC 로 착각해 선제 갱신이 안 돌던 문제)."""
from datetime import datetime, timedelta

from app.services.cafe24 import parse_cafe24_expires_at, token_needs_refresh


def test_naive_value_is_kst():
    # 카페24 응답 그대로: 시간대 없음 = 한국 시각
    assert parse_cafe24_expires_at("2026-11-05T17:58:27.000") == datetime(2026, 11, 5, 8, 58, 27)


def test_explicit_offset_respected():
    assert parse_cafe24_expires_at("2026-11-05T17:58:27+09:00") == datetime(2026, 11, 5, 8, 58, 27)
    assert parse_cafe24_expires_at("2026-11-05T08:58:27Z") == datetime(2026, 11, 5, 8, 58, 27)


def test_bad_or_empty():
    assert parse_cafe24_expires_at(None) is None
    assert parse_cafe24_expires_at("") is None
    assert parse_cafe24_expires_at("not-a-date") is None


def test_needs_refresh_window():
    now = datetime(2026, 11, 5, 7, 0, 0)
    assert token_needs_refresh(None, now)
    assert token_needs_refresh(now + timedelta(minutes=30), now)          # 1시간 안 → 갱신
    assert token_needs_refresh(now - timedelta(minutes=5), now)           # 이미 만료 → 갱신
    assert not token_needs_refresh(now + timedelta(minutes=110), now)     # 막 받은 토큰 → 그대로


def test_old_kst_stored_value_triggers_refresh():
    # 옛 방식으로 저장된 값(한국 17:58 을 UTC 로 저장) → 수명보다 멀어 믿지 않고 갱신
    now = datetime(2026, 11, 5, 7, 0, 0)  # = 한국 16:00
    assert token_needs_refresh(datetime(2026, 11, 5, 17, 58, 27), now)
