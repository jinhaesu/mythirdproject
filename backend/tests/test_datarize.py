"""데이터라이즈 CRM 진단 — 가짜 숫자로만 시험(네트워크·DB 없음)."""
from datetime import date, datetime

from app.services import datarize_report as rep
from app.services import datarize_sync as ds

HEAD = ("날짜,채널,캠페인 아이디,캠페인 이름,오디언스 아이디,오디언스 이름,발송시도수,발송수,발송 비용,방문자수,방문율,"
        "방문 기준 구매전환수,방문 기준 구매건수,방문 기준 구매전환율,방문 기준 기여금액,방문 기준 ROAS,클릭자수,클릭률,"
        "클릭 기준 구매전환수,클릭 기준 구매건수,클릭 기준 구매전환율,클릭 기준 기여금액,클릭 기준 ROAS")


def _msg_csv(lines):
    return "﻿" + HEAD + "\n" + "\n".join(lines)


def test_parse_message_seq_and_numbers():
    text = _msg_csv([
        "2026-10-01,알림톡,C1,캠1,A1,오1,1000,900,9000,90,10,9,10,1,500000,5555,40,4,3,3,0.3,120000,1333",
        "2026-10-01,알림톡,C1,캠1,A1,오1,100,50,500,5,10,1,1,2,10000,2000,1,2,0,0,0,0,0",
        "bad-date,알림톡,C1,캠1,A1,오1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1",
    ])
    rows = ds.read_csv(text)
    assert not ds.missing_columns(rows, ["날짜", "발송수"])
    items = ds.parse_message(rows)
    assert len(items) == 2
    assert [i["seq"] for i in items] == [0, 1]
    assert items[0]["sent"] == 900 and items[0]["cost"] == 9000 and items[0]["visit_revenue"] == 500000


def test_num_and_bool():
    assert ds.num("1,234.5") == 1234.5
    assert ds.num("") is None and ds.num("-") is None
    assert ds.truthy("TRUE") and not ds.truthy("FALSE")


def _row(d, ch, attempts, sent, cost, visitors, vconv, vrev, clickers=None, crev=0, cid="C"):
    return {"date": d, "channel": ch, "campaign_id": cid, "campaign_name": cid, "attempts": attempts,
            "sent": sent, "cost": cost, "visitors": visitors, "visit_conv_users": vconv, "visit_orders": vconv,
            "visit_revenue": vrev, "clickers": clickers, "click_conv_users": 0, "click_orders": 0,
            "click_revenue": crev}


def test_report_rules():
    rows = [
        _row(date(2026, 9, 3), "알림톡", 2000, 1000, 10000, 50, 5, 200000, clickers=20),
        _row(date(2026, 10, 1), "알림톡", 2000, 1500, 15000, 90, 9, 600000, clickers=30),
        _row(date(2026, 10, 1), "문자", 500, 400, 12000, 10, 2, 50000, clickers=0),
        _row(date(2026, 10, 2), "이메일", 200, 100, 300, 1, 0, 0, clickers=1),  # 표본 적음
    ] + [_row(date(2026, 10, d), "알림톡", 0, 0, 0, 0, 0, 0, clickers=0) for d in range(3, 12)]
    cost = [{"date": date(2026, 6, 5), "kind": "차감", "amount": 7000, "channel": "알림톡"},
            {"date": date(2026, 6, 5), "kind": "충전", "amount": 1e6, "channel": None}]
    r = rep.build_report(message_rows=rows, cost_rows=cost, member_rows=[], segment_rows=[],
                         month=None, basis="visit", today=date(2026, 11, 3))
    assert r["month"] == "2026-10" and r["prev_month"] == "2026-09"
    assert r["channels"] == ["알림톡", "문자", "이메일"]
    # 합계는 발송·도달·발송비만
    tot = r["totals"]["cur"]
    assert tot["sent"] == 2000 and tot["cost"] == 27300 and "revenue" not in tot
    by = {b["channel"]: b for b in r["by_channel"]}
    al = by["알림톡"]["cur"]
    assert al["roas"] == 600000 / 15000 * 100
    assert round(by["알림톡"]["delta"]["visit_rate"], 2) == 1.0  # 5.0% → 6.0% = +1.0%p
    assert by["알림톡"]["delta"]["revenue"] == 200.0
    assert by["문자"]["cur"]["clickers"] is None and by["문자"]["cur"]["click_rate"] is None
    em = by["이메일"]["cur"]
    assert em["small_sample"] and em["roas"] is None and em["visit_rate"] is None
    # 5개월 추이: 6월은 충전금 차감만
    jun = next(t for t in r["trend"] if t["month"] == "2026-06")
    assert jun["channels"]["알림톡"]["source"] == "cost_only" and jun["channels"]["알림톡"]["cost"] == 7000
    # 일별: 10/1 ↔ 9/3 (4주 전, 같은 요일)
    d1 = r["daily"][0]
    assert d1["date"] == "2026-10-01" and d1["prev_date"] == "2026-09-03" and d1["prev"]["알림톡"]["sent"] == 1000
    # 고를 수 있는 달 = 메시지 성과가 있는 달만(발송비만 있는 6월은 목록에서 빠짐, 건의 61fa6731)
    assert r["months"] == ["2026-10", "2026-09"]


def test_click_basis_sms_blank():
    rows = [_row(date(2026, 10, d), "문자", 500, 400, 12000, 10, 2, 50000, clickers=0) for d in range(1, 9)]
    r = rep.build_report(message_rows=rows, cost_rows=[], member_rows=[], segment_rows=[],
                         month="2026-10", basis="click", today=date(2026, 11, 3))
    cur = r["by_channel"][0]["cur"]
    assert cur["revenue"] is None and cur["roas"] is None and cur["sent"] == 3200


def test_members_and_segments():
    mem = [{"date": date(2026, 10, 31), "email_opt_in": True, "sms_opt_in": True, "members": 10},
           {"date": date(2026, 10, 31), "email_opt_in": False, "sms_opt_in": False, "members": 30},
           {"date": date(2026, 9, 30), "email_opt_in": False, "sms_opt_in": False, "members": 20}]
    m = rep.members_summary(mem, "2026-10")
    assert m["cur"]["total"] == 40 and m["cur"]["email_rate"] == 25.0 and m["delta"]["total"] == 100.0
    seg = [{"date": date(2026, 10, 31), "segment": "A", "classification": "상세", "members": 110, "ratio": 0.1,
            "median_days_no_visit": 1, "median_days_no_purchase": 2, "avg_order_value": 3},
           {"date": date(2026, 10, 1), "segment": "A", "classification": "상세", "members": 100, "ratio": 0.1,
            "median_days_no_visit": 1, "median_days_no_purchase": 2, "avg_order_value": 3}]
    s = rep.segments_summary(seg, "2026-10")
    assert s["compare_date"] == "2026-10-01" and round(s["rows"][0]["members_delta"]) == 10


def test_schedule():
    # 00:29 UTC(=09:29 KST) → 09:30 KST까지 60초
    assert ds.seconds_until_next_run(datetime(2026, 11, 3, 0, 29, 0)) == 60
    # 04:31 UTC(=13:31 KST) → 다음날 09:30 KST
    assert ds.seconds_until_next_run(datetime(2026, 11, 3, 4, 31, 0)) == 19 * 3600 + 59 * 60
