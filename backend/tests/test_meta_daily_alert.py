"""매일 아침 Meta 알림 — 가짜 숫자로만 시험(네트워크·DB·발송 없음)."""
import asyncio
from datetime import date, datetime

from app.services import meta_daily_alert as m


def test_recipients_parse():
    assert m.recipients_from_env("") == []
    assert m.recipients_from_env("010-1234-5678, 01099998888,abc") == ["01012345678", "01099998888"]


def test_judgement():
    assert m.roas_judgement(None) == "광고 매출 없음"
    assert m.roas_judgement(2.5) == "기준 3.1 미만"
    assert m.roas_judgement(3.2) == "기준 3.1~3.3 안"
    assert m.roas_judgement(4.0) == "기준 3.3 초과"


def test_message():
    msg = m.build_message("시험계정", date(2026, 10, 28), 1234567.4, 2.734)
    assert "10/28(수)" in msg["text"]
    assert "1,234,567원" in msg["text"]
    assert "ROAS: 2.73 (기준 3.1 미만)" in msg["text"]
    assert msg["variables"]["#{ROAS}"] == "2.73"


def test_schedule_time():
    # 23:59:00 UTC → 다음 00:00:30 UTC(=09:00 KST)까지 90초
    assert m.seconds_until_next_send(datetime(2026, 10, 28, 23, 59, 0)) == 90
    assert m.kst_today(datetime(2026, 10, 28, 15, 0, 0)) == date(2026, 10, 29)


def test_run_once_dry_and_disabled(monkeypatch):
    async def fake_fetch(db, day):
        return {"connected": True, "account_name": "시험계정", "spend": 500000.0, "roas": 3.5, "rows": 1}

    sent = []

    async def fake_deliver(*a, **k):
        sent.append(a)
        return "lms", []

    monkeypatch.setattr(m, "fetch_day", fake_fetch)
    monkeypatch.setattr(m, "_deliver", fake_deliver)
    monkeypatch.setattr(m.get_settings(), "META_DAILY_ALERT_TO", "")
    # 받는 번호가 없으면 조회도 발송도 하지 않는다
    assert asyncio.run(m.run_once(None, day=date(2026, 10, 28))) == {"skipped": "no_recipients"}
    # 시험 실행은 본문만 만든다
    r = asyncio.run(m.run_once(None, day=date(2026, 10, 28), dry_run=True))
    assert r["dry_run"] and "500,000원" in r["text"] and "기준 3.3 초과" in r["text"]
    assert sent == []
