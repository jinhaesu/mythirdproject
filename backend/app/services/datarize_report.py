"""데이터라이즈 CRM 월간 운영 진단 — 계산만 하는 순수 함수 (DB·네트워크 없음, 시험 가능).

원칙(건의서 기준):
- 기여매출·구매자·주문은 채널끼리 더하지 않는다(한 구매가 여러 채널에 동시에 기여로 잡힐 수 있음).
  합계는 발송·도달·발송비만.
- 발송 = 발송시도수, 도달 = 발송수(성공). 발송비는 데이터라이즈가 성공 건에만 매기므로 도달 기준.
- 문자는 클릭 추적이 없다 → 클릭 지표는 None(화면 '-').
- 도달 300건 미만인 칸은 비율을 내지 않는다(small_sample) — '표본이 적어 해석하지 않습니다'.
- ROAS = 기여매출 ÷ 발송비 × 100 (%, 데이터라이즈 표기와 같음).
- 구매자 = 구매전환수의 합. 시트가 캠페인×날짜 단위라 같은 사람이 여러 번 잡힐 수 있다(상한값).
"""
import calendar
from collections import defaultdict
from datetime import date, timedelta
from typing import Iterable, Optional

CHANNEL_ORDER = ["브랜드 메시지", "알림톡", "문자", "이메일"]
NO_CLICK_CHANNELS = {"문자"}
SMALL_SAMPLE = 300
TREND_MONTHS = 5
ALIGN_DAYS = 28  # 지난달 같은 요일 맞추기(4주 전)


def ym(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def month_bounds(m: str) -> tuple[date, date]:
    y, mo = int(m[:4]), int(m[5:7])
    return date(y, mo, 1), date(y, mo, calendar.monthrange(y, mo)[1])


def shift_month(m: str, k: int) -> str:
    y, mo = int(m[:4]), int(m[5:7])
    idx = y * 12 + (mo - 1) + k
    return f"{idx // 12:04d}-{idx % 12 + 1:02d}"


def _div(a, b, scale=1.0) -> Optional[float]:
    if a is None or not b:
        return None
    return a / b * scale


def pct_change(cur, prev) -> Optional[float]:
    if cur is None or prev is None or not prev:
        return None
    return (cur - prev) / abs(prev) * 100


def pp_change(cur, prev) -> Optional[float]:
    if cur is None or prev is None:
        return None
    return cur - prev


def order_channels(chs: Iterable[str]) -> list[str]:
    chs = [c for c in set(chs) if c]
    return sorted(chs, key=lambda c: (CHANNEL_ORDER.index(c) if c in CHANNEL_ORDER else 99, c))


def _empty():
    return {"attempts": 0.0, "sent": 0.0, "cost": 0.0, "visitors": 0.0, "clickers": 0.0,
            "conv_users": 0.0, "orders": 0.0, "revenue": 0.0, "rows": 0, "_dates": set(), "_click_seen": False}


def _add(acc: dict, r: dict, basis: str):
    acc["attempts"] += r.get("attempts") or 0
    acc["sent"] += r.get("sent") or 0
    acc["cost"] += r.get("cost") or 0
    acc["visitors"] += r.get("visitors") or 0
    if r.get("clickers") is not None:
        acc["clickers"] += r.get("clickers") or 0
        acc["_click_seen"] = True
    p = "visit_" if basis == "visit" else "click_"
    acc["conv_users"] += r.get(p + "conv_users") or 0
    acc["orders"] += r.get(p + "orders") or 0
    acc["revenue"] += r.get(p + "revenue") or 0
    acc["rows"] += 1
    acc["_dates"].add(r["date"])


def finalize(acc: dict, channel: Optional[str], basis: str) -> dict:
    """합계 → 지표. channel=None이면 합계 행(발송·도달·발송비만)."""
    no_click = channel in NO_CLICK_CHANNELS
    small = acc["sent"] < SMALL_SAMPLE
    out = {
        "attempts": acc["attempts"], "sent": acc["sent"], "cost": acc["cost"],
        "reach_rate": _div(acc["sent"], acc["attempts"], 100),
        "cost_per_reach": _div(acc["cost"], acc["sent"]),
        "days": len(acc["_dates"]), "rows": acc["rows"], "small_sample": small,
    }
    if channel is None:
        return out
    click_ok = not no_click
    out.update({
        "visitors": acc["visitors"],
        "clickers": acc["clickers"] if click_ok else None,
        "conv_users": None if (no_click and basis == "click") else acc["conv_users"],
        "orders": None if (no_click and basis == "click") else acc["orders"],
        "revenue": None if (no_click and basis == "click") else acc["revenue"],
    })
    rev = out["revenue"]
    rates = {
        "visit_rate": _div(acc["visitors"], acc["sent"], 100),
        "click_rate": _div(acc["clickers"], acc["sent"], 100) if click_ok else None,
        "conv_rate": _div(out["conv_users"], acc["sent"], 100),
        "roas": _div(rev, acc["cost"], 100),
        "revenue_per_reach": _div(rev, acc["sent"]),
        "aov": _div(rev, out["orders"]),
        "cost_per_order": _div(acc["cost"], out["orders"]),
    }
    if small:
        rates = {k: None for k in rates}
        out["reach_rate"] = None
    out.update(rates)
    return out


RATE_KEYS = {"reach_rate", "visit_rate", "click_rate", "conv_rate"}  # %p로 비교
NUM_KEYS = ["attempts", "sent", "cost", "visitors", "clickers", "conv_users", "orders", "revenue",
            "roas", "revenue_per_reach", "aov", "cost_per_order", "cost_per_reach"]


def deltas(cur: dict, prev: Optional[dict]) -> dict:
    if not prev:
        return {}
    d = {}
    for k in NUM_KEYS:
        if k in cur:
            d[k] = pct_change(cur.get(k), prev.get(k))
    for k in RATE_KEYS:
        if k in cur:
            d[k] = pp_change(cur.get(k), prev.get(k))
    return d


def aggregate(rows: list[dict], basis: str) -> dict:
    """{(month, channel): acc}"""
    acc = defaultdict(_empty)
    for r in rows:
        _add(acc[(ym(r["date"]), r["channel"])], r, basis)
    return acc


def month_info(m: str, data_dates: set, today: date) -> dict:
    start, end = month_bounds(m)
    ds = sorted(d for d in data_dates if start <= d <= end)
    return {
        "month": m, "start": start.isoformat(), "end": end.isoformat(),
        "days_in_month": (end - start).days + 1, "data_days": len(ds),
        "first": ds[0].isoformat() if ds else None, "last": ds[-1].isoformat() if ds else None,
        "in_progress": start <= today <= end,
        "partial": len(ds) < (end - start).days + 1,
    }


def pick_default_month(data_dates: set, today: date) -> Optional[str]:
    """데이터가 7일 이상 있는 가장 최근 달(이번 달 초엔 지난달)."""
    by = defaultdict(int)
    for d in data_dates:
        by[ym(d)] += 1
    for m in sorted(by, reverse=True):
        if by[m] >= 7:
            return m
    return max(by) if by else None


def _fmt_man(v: float) -> str:
    return f"{v / 1e4:,.0f}만원" if abs(v) >= 1e5 else f"{v / 1e4:,.1f}만원"


def insights(month_rows: dict, prev_rows: dict, basis: str) -> list[dict]:
    """눈여겨볼 변화 — 두 달 모두 표본 충분한 채널만, 변화 큰 순 최대 6개. 문장은 쉬운 말."""
    out = []
    for ch, cur in month_rows.items():
        prev = prev_rows.get(ch)
        if not prev:
            if cur["sent"] > 0:
                out.append({"channel": ch, "score": 999, "tone": "info",
                            "text": f"{ch}: 지난달에는 발송이 없었고 이번 달 {cur['sent']:,.0f}건 도달했습니다."})
            continue
        if cur["sent"] == 0 and prev["sent"] > 0:
            out.append({"channel": ch, "score": 998, "tone": "down",
                        "text": f"{ch}: 이번 달 발송이 없습니다(지난달 {prev['sent']:,.0f}건 도달)."})
            continue
        if cur["small_sample"] or prev["small_sample"]:
            continue
        c_roas, p_roas = cur.get("roas"), prev.get("roas")
        ch_roas = pct_change(c_roas, p_roas)
        if ch_roas is not None and abs(ch_roas) >= 15:
            out.append({"channel": ch, "score": abs(ch_roas), "tone": "up" if ch_roas > 0 else "down",
                        "text": f"{ch}: ROAS {p_roas:,.0f}% → {c_roas:,.0f}% ({'▲' if ch_roas > 0 else '▼'}{abs(ch_roas):.0f}%)."})
        rate_key = "visit_rate" if basis == "visit" else "click_rate"
        label = "방문율" if basis == "visit" else "클릭률"
        dp = pp_change(cur.get(rate_key), prev.get(rate_key))
        if dp is not None and abs(dp) >= 0.5:
            out.append({"channel": ch, "score": abs(dp) * 20, "tone": "up" if dp > 0 else "down",
                        "text": f"{ch}: {label} {prev[rate_key]:.2f}% → {cur[rate_key]:.2f}% ({'▲' if dp > 0 else '▼'}{abs(dp):.2f}%p)."})
        dr = pp_change(cur.get("reach_rate"), prev.get("reach_rate"))
        if dr is not None and abs(dr) >= 5:
            out.append({"channel": ch, "score": abs(dr) * 3, "tone": "up" if dr > 0 else "down",
                        "text": f"{ch}: 도달률(발송 대비 성공) {prev['reach_rate']:.1f}% → {cur['reach_rate']:.1f}% ({'▲' if dr > 0 else '▼'}{abs(dr):.1f}%p)."})
        dc = pct_change(cur["cost"], prev["cost"])
        if dc is not None and abs(dc) >= 30:
            out.append({"channel": ch, "score": abs(dc) / 2, "tone": "neutral",
                        "text": f"{ch}: 발송비 {_fmt_man(prev['cost'])} → {_fmt_man(cur['cost'])} ({'▲' if dc > 0 else '▼'}{abs(dc):.0f}%)."})
    out.sort(key=lambda x: -x["score"])
    return [{k: v for k, v in x.items() if k != "score"} for x in out[:6]]


def build_report(*, message_rows: list[dict], cost_rows: list[dict], member_rows: list[dict],
                 segment_rows: list[dict], month: Optional[str], basis: str, today: date) -> dict:
    basis = "click" if basis == "click" else "visit"
    data_dates = {r["date"] for r in message_rows}
    months_avail = sorted({ym(d) for d in data_dates} | {ym(r["date"]) for r in cost_rows if r.get("kind") == "차감"},
                          reverse=True)
    month = month or pick_default_month(data_dates, today)
    if not month:
        return {"empty": True, "basis": basis, "months": months_avail}
    prev = shift_month(month, -1)
    acc = aggregate(message_rows, basis)
    channels = order_channels(c for (_m, c) in acc.keys())

    def ch_metrics(m):
        res = {}
        for ch in channels:
            a = acc.get((m, ch))
            if a and a["rows"]:
                res[ch] = finalize(a, ch, basis)
        return res

    def totals(m):
        t = _empty()
        for ch in channels:
            a = acc.get((m, ch))
            if not a:
                continue
            for k in ("attempts", "sent", "cost"):
                t[k] += a[k]
            t["rows"] += a["rows"]
            t["_dates"] |= a["_dates"]
        return finalize(t, None, basis)

    cur_ch, prev_ch = ch_metrics(month), ch_metrics(prev)
    cur_tot, prev_tot = totals(month), totals(prev)

    # 발송비 월별(충전금 차감 내역) — 메시지 통계 창보다 길다
    cost_hist = defaultdict(float)
    for r in cost_rows:
        if r.get("kind") == "차감" and r.get("channel"):
            cost_hist[(ym(r["date"]), r["channel"])] += r.get("amount") or 0

    trend_months = [shift_month(month, -k) for k in range(TREND_MONTHS - 1, -1, -1)]
    trend = []
    for m in trend_months:
        info = month_info(m, data_dates, today)
        row = {"month": m, "partial": info["partial"], "data_days": info["data_days"],
               "in_progress": info["in_progress"], "channels": {}}
        for ch in channels:
            a = acc.get((m, ch))
            if a and a["rows"]:
                f = finalize(a, ch, basis)
                row["channels"][ch] = {"source": "message", "cost": f["cost"], "sent": f["sent"],
                                       "revenue": f.get("revenue"), "roas": f.get("roas"),
                                       "small_sample": f["small_sample"]}
            elif cost_hist.get((m, ch)):
                row["channels"][ch] = {"source": "cost_only", "cost": cost_hist[(m, ch)], "sent": None,
                                       "revenue": None, "roas": None, "small_sample": True}
        trend.append(row)

    cost_months = sorted({m for (m, _c) in cost_hist}, reverse=True)[:12][::-1]
    cost_history = [{"month": m, "channels": {ch: cost_hist.get((m, ch), 0.0) for ch in channels}}
                    for m in cost_months]

    # 일별 — 이번 달 날짜 d와 4주 전(d-28, 같은 요일)
    start, end = month_bounds(month)
    daily_acc = defaultdict(_empty)
    for r in message_rows:
        _add(daily_acc[(r["date"], r["channel"])], r, basis)
    last = max((d for d in data_dates if start <= d <= end), default=None)
    daily = []
    if last:
        d = start
        while d <= last:
            p = d - timedelta(days=ALIGN_DAYS)
            daily.append({
                "date": d.isoformat(), "prev_date": p.isoformat(), "weekday": "월화수목금토일"[d.weekday()],
                "cur": {ch: _daily_row(daily_acc.get((d, ch)), ch, basis) for ch in channels if daily_acc.get((d, ch))},
                "prev": {ch: _daily_row(daily_acc.get((p, ch)), ch, basis) for ch in channels if daily_acc.get((p, ch))},
            })
            d += timedelta(days=1)

    # 캠페인별(이번 달)
    camp = defaultdict(_empty)
    names = {}
    for r in message_rows:
        if start <= r["date"] <= end:
            k = (r["channel"], r["campaign_id"])
            _add(camp[k], r, basis)
            names[k] = r.get("campaign_name") or r["campaign_id"]
    campaigns = []
    for (ch, cid), a in camp.items():
        f = finalize(a, ch, basis)
        campaigns.append({"channel": ch, "campaign_id": cid, "name": names[(ch, cid)], **f})
    campaigns.sort(key=lambda x: -(x.get("revenue") or 0))

    return {
        "empty": False, "basis": basis, "month": month, "prev_month": prev,
        "months": months_avail, "channels": channels,
        "month_info": month_info(month, data_dates, today),
        "prev_month_info": month_info(prev, data_dates, today),
        "totals": {"cur": cur_tot, "prev": prev_tot if prev_tot["rows"] else None,
                   "delta": deltas(cur_tot, prev_tot) if prev_tot["rows"] else {}},
        "by_channel": [{"channel": ch, "cur": cur_ch.get(ch), "prev": prev_ch.get(ch),
                        "delta": deltas(cur_ch[ch], prev_ch.get(ch)) if ch in cur_ch else {}}
                       for ch in channels],
        "trend": trend, "cost_history": cost_history, "daily": daily,
        "campaigns": campaigns[:40], "campaign_count": len(campaigns),
        "insights": insights(cur_ch, prev_ch, basis),
        "members": members_summary(member_rows, month),
        "segments": segments_summary(segment_rows, month),
        "data_range": {"first": min(data_dates).isoformat() if data_dates else None,
                       "last": max(data_dates).isoformat() if data_dates else None},
    }


def _daily_row(a: Optional[dict], ch: str, basis: str) -> dict:
    if not a:
        return {}
    no_click = ch in NO_CLICK_CHANNELS
    blank = no_click and basis == "click"
    return {"attempts": a["attempts"], "sent": a["sent"], "cost": a["cost"], "visitors": a["visitors"],
            "clickers": None if no_click else a["clickers"],
            "conv_users": None if blank else a["conv_users"], "orders": None if blank else a["orders"],
            "revenue": None if blank else a["revenue"]}


def _members_on(rows: list[dict], d: date) -> Optional[dict]:
    rs = [r for r in rows if r["date"] == d]
    if not rs:
        return None
    tot = sum(r["members"] for r in rs)
    email = sum(r["members"] for r in rs if r["email_opt_in"])
    sms = sum(r["members"] for r in rs if r["sms_opt_in"])
    anyo = sum(r["members"] for r in rs if r["email_opt_in"] or r["sms_opt_in"])
    return {"date": d.isoformat(), "total": tot, "email_opt_in": email, "sms_opt_in": sms, "any_opt_in": anyo,
            "email_rate": _div(email, tot, 100), "sms_rate": _div(sms, tot, 100)}


def members_summary(rows: list[dict], month: str) -> dict:
    start, end = month_bounds(month)
    dates = sorted({r["date"] for r in rows})
    cur_d = max((d for d in dates if d <= end), default=None)
    prev_d = max((d for d in dates if d < start), default=None)
    cur = _members_on(rows, cur_d) if cur_d else None
    prev = _members_on(rows, prev_d) if prev_d else None
    return {"cur": cur, "prev": prev,
            "delta": {k: pct_change(cur[k], prev[k]) for k in ("total", "email_opt_in", "sms_opt_in")}
            if cur and prev else {}}


def segments_summary(rows: list[dict], month: str) -> dict:
    """그 달 마지막 날(또는 가장 가까운 앞날) 세그먼트 + 약 30일 앞(없으면 가장 이른 날)과 비교."""
    _start, end = month_bounds(month)
    dates = sorted({r["date"] for r in rows})
    cur_d = max((d for d in dates if d <= end), default=None)
    if not cur_d:
        return {"date": None, "compare_date": None, "rows": []}
    target = cur_d - timedelta(days=30)
    earlier = [d for d in dates if d < cur_d]
    cmp_d = min(earlier, key=lambda d: abs((d - target).days)) if earlier else None
    prev_map = {(r["segment"], r.get("classification")): r for r in rows if r["date"] == cmp_d} if cmp_d else {}
    out = []
    for r in rows:
        if r["date"] != cur_d:
            continue
        p = prev_map.get((r["segment"], r.get("classification")))
        out.append({
            "segment": r["segment"], "classification": r.get("classification"),
            "members": r["members"], "ratio": (r["ratio"] * 100) if r.get("ratio") is not None else None,
            "median_days_no_visit": r.get("median_days_no_visit"),
            "median_days_no_purchase": r.get("median_days_no_purchase"),
            "avg_order_value": r.get("avg_order_value"),
            "members_delta": pct_change(r["members"], p["members"]) if p else None,
        })
    out.sort(key=lambda x: (x["classification"] or "", -x["members"]))
    return {"date": cur_d.isoformat(), "compare_date": cmp_d.isoformat() if cmp_d else None, "rows": out}
