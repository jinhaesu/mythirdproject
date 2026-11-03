"""데이터라이즈(CRM) 구글시트 → DB 동기화 (2026-11-03 마케팅 연다은 건의 37189ff2).

- 출처: 시트 "[Datarize] 널담몰(11846) 데이터 연동"(settings.DATARIZE_SHEET_ID). 데이터라이즈가 매일 09시경 갱신.
- 읽기: 링크 공유 시트라 CSV 내보내기 주소(export?format=csv&gid=)로 키 없이 읽는다.
  탭 머리글이 예상과 다르면 탭 이름으로 한 번 더 읽고(gviz), 그래도 안 맞으면 그 탭만 건너뛴다(DB 안 건드림).
- 저장: 탭마다 시트에 있는 날짜의 예전 행을 지우고 새로 넣는다 → 시트 창(최근 90일 등)보다 오래된 날짜는 DB에 계속 쌓인다.
- 가져오는 탭(집계만): 메시지 캠페인 통계 · 충전금 차감 내역 · 수신 동의 여부별 일별 회원수 · 세그먼트별 지표.
  회원·주문 단위 탭(캠페인별 구매 정보 등)은 가져오지 않는다.
- 일정: 매일 09:30·13:30 KST(시트 9시 갱신 뒤) + 서버 시작 때 오늘 성공 기록이 없으면 1회.
"""
import asyncio
import csv
import io
import json
import logging
from datetime import date, datetime, timedelta
from typing import Callable, Optional
from urllib.parse import quote

import httpx
from sqlalchemy import delete, insert, select

from app.core.config import get_settings

logger = logging.getLogger(__name__)

KST = timedelta(hours=9)
SYNC_TIMES_KST = [(9, 30), (13, 30)]
INSERT_CHUNK = 2000
DATE_CHUNK = 400

_lock = asyncio.Lock()


class SheetReadError(Exception):
    pass


# ── 값 해석 (순수 함수) ──────────────────────────────────────────────────────

def num(v) -> Optional[float]:
    if v is None:
        return None
    s = str(v).strip().replace(",", "").replace("%", "").replace("₩", "")
    if s in ("", "-", "N/A", "NaN", "nan"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def num0(v) -> float:
    n = num(v)
    return n if n is not None else 0.0


def day(v) -> Optional[date]:
    s = str(v or "").strip()[:10]
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def truthy(v) -> bool:
    return str(v or "").strip().upper() in ("TRUE", "1", "Y", "YES", "동의")


def read_csv(text: str) -> list[dict]:
    text = text.lstrip("﻿")
    return [dict(r) for r in csv.DictReader(io.StringIO(text))]


def parse_message(rows: list[dict]) -> list[dict]:
    out, seen = [], {}
    for r in rows:
        d = day(r.get("날짜"))
        if not d:
            continue
        key = (d, r.get("캠페인 아이디") or "", r.get("오디언스 아이디") or "")
        seq = seen.get(key, 0)
        seen[key] = seq + 1
        out.append({
            "date": d,
            "channel": (r.get("채널") or "").strip(),
            "campaign_id": key[1],
            "campaign_name": (r.get("캠페인 이름") or "").strip()[:500] or None,
            "audience_id": key[2] or None,
            "audience_name": (r.get("오디언스 이름") or "").strip()[:500] or None,
            "seq": seq,
            "attempts": num0(r.get("발송시도수")),
            "sent": num0(r.get("발송수")),
            "cost": num0(r.get("발송 비용")),
            "visitors": num(r.get("방문자수")),
            "visit_conv_users": num(r.get("방문 기준 구매전환수")),
            "visit_orders": num(r.get("방문 기준 구매건수")),
            "visit_revenue": num(r.get("방문 기준 기여금액")),
            "clickers": num(r.get("클릭자수")),
            "click_conv_users": num(r.get("클릭 기준 구매전환수")),
            "click_orders": num(r.get("클릭 기준 구매건수")),
            "click_revenue": num(r.get("클릭 기준 기여금액")),
        })
    return out


def parse_cost(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        d = day(r.get("날짜"))
        if not d:
            continue
        out.append({
            "date": d,
            "charged_at": (r.get("충전금 차감일시") or "").strip()[:30] or None,
            "kind": (r.get("충전 차감 여부") or "").strip()[:20],
            "amount": num0(r.get("차감금액(원)")),
            "channel": (r.get("채널") or "").strip() or None,
            "campaign_id": (r.get("캠페인 아이디") or "").strip() or None,
        })
    return out


def parse_members(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        d = day(r.get("날짜"))
        if not d:
            continue
        out.append({
            "date": d,
            "email_opt_in": truthy(r.get("이메일 수신 동의 여부")),
            "sms_opt_in": truthy(r.get("문자 수신 동의 여부")),
            "members": num0(r.get("회원수")),
        })
    return out


def parse_segments(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        d = day(r.get("날짜"))
        name = (r.get("세그먼트 이름") or "").strip()
        if not d or not name:
            continue
        out.append({
            "date": d,
            "segment": name[:100],
            "classification": (r.get("세그먼트 분류") or "").strip()[:20] or None,
            "members": num0(r.get("회원수")),
            "ratio": num(r.get("비중")),
            "median_days_no_visit": num(r.get("중앙값 미방문 기간")),
            "median_days_no_purchase": num(r.get("중앙값 미구매 기간")),
            "avg_order_value": num(r.get("평균 구매금액")),
        })
    return out


def _tabs():
    from app.models.datarize import (
        DatarizeCostDaily, DatarizeMemberDaily, DatarizeMessageDaily, DatarizeSegmentDaily,
    )
    return [
        {"key": "message", "gid": 1102384947, "title": "메시지 캠페인 통계", "model": DatarizeMessageDaily,
         "required": ["날짜", "채널", "캠페인 아이디", "발송시도수", "발송수", "발송 비용", "방문 기준 기여금액", "클릭 기준 기여금액"],
         "parse": parse_message},
        {"key": "cost", "gid": 314086065, "title": "충전금 차감 내역", "model": DatarizeCostDaily,
         "required": ["날짜", "충전 차감 여부", "차감금액(원)", "채널"], "parse": parse_cost},
        {"key": "members", "gid": 489452689, "title": "이메일, 문자 수신 동의 여부별 일별 회원수", "model": DatarizeMemberDaily,
         "required": ["날짜", "이메일 수신 동의 여부", "문자 수신 동의 여부", "회원수"], "parse": parse_members},
        {"key": "segments", "gid": 880817965, "title": "[방문, 구매 세그먼트] 일별 세그먼트별 지표", "model": DatarizeSegmentDaily,
         "required": ["날짜", "세그먼트 이름", "회원수"], "parse": parse_segments},
    ]


def missing_columns(rows: list[dict], required: list[str]) -> list[str]:
    if not rows:
        return list(required)
    have = set(rows[0].keys())
    return [c for c in required if c not in have]


# ── 읽기 ─────────────────────────────────────────────────────────────────────

async def _get_csv(client: httpx.AsyncClient, url: str) -> str:
    r = await client.get(url)
    ctype = r.headers.get("content-type", "")
    if r.status_code in (401, 403) or "text/html" in ctype:
        raise SheetReadError("시트를 읽을 수 없습니다 — 공유 설정이 '링크가 있는 모든 사용자 보기'인지 확인해 주세요")
    if r.status_code != 200:
        raise SheetReadError(f"시트 응답 {r.status_code}")
    r.encoding = "utf-8"
    return r.text


async def fetch_tab(client: httpx.AsyncClient, sheet_id: str, tab: dict) -> list[dict]:
    base = f"https://docs.google.com/spreadsheets/d/{sheet_id}"
    rows = read_csv(await _get_csv(client, f"{base}/export?format=csv&gid={tab['gid']}"))
    if missing_columns(rows, tab["required"]):
        # 탭을 새로 만들어 gid가 바뀐 경우 — 탭 이름으로 다시
        alt = read_csv(await _get_csv(client, f"{base}/gviz/tq?tqx=out:csv&sheet={quote(tab['title'])}"))
        if not missing_columns(alt, tab["required"]):
            return alt
    return rows


# ── 저장 ─────────────────────────────────────────────────────────────────────

async def replace_by_dates(db, model, items: list[dict]) -> dict:
    dates = sorted({it["date"] for it in items})
    deleted = 0
    for i in range(0, len(dates), DATE_CHUNK):
        res = await db.execute(delete(model).where(model.date.in_(dates[i:i + DATE_CHUNK])))
        deleted += res.rowcount or 0
    now = datetime.utcnow()
    for i in range(0, len(items), INSERT_CHUNK):
        await db.execute(insert(model), [{**it, "synced_at": now} for it in items[i:i + INSERT_CHUNK]])
    await db.commit()
    return {"rows": len(items), "replaced": deleted,
            "date_from": dates[0].isoformat() if dates else None,
            "date_to": dates[-1].isoformat() if dates else None}


def is_running() -> bool:
    return _lock.locked()


async def run_sync(trigger: str = "schedule", fetch: Optional[Callable] = None) -> dict:
    """시트 전체 탭 1회 동기화. 이미 도는 중이면 {'skipped': 'running'}."""
    from app.db.database import AsyncSessionLocal
    from app.models.datarize import DatarizeSyncLog

    if _lock.locked():
        return {"skipped": "running"}
    async with _lock:
        sheet_id = get_settings().DATARIZE_SHEET_ID
        async with AsyncSessionLocal() as db:
            log = DatarizeSyncLog(trigger=trigger[:50], status="running")
            db.add(log)
            await db.commit()
            results: dict = {}
            async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
                for tab in _tabs():
                    try:
                        rows = await (fetch(tab) if fetch else fetch_tab(client, sheet_id, tab))
                        miss = missing_columns(rows, tab["required"])
                        if miss:
                            results[tab["key"]] = {"ok": False, "error": f"칸 없음: {', '.join(miss)}"}
                            continue
                        items = tab["parse"](rows)
                        if not items:
                            results[tab["key"]] = {"ok": False, "error": "읽은 줄 없음"}
                            continue
                        results[tab["key"]] = {"ok": True, **(await replace_by_dates(db, tab["model"], items))}
                    except Exception as e:  # 한 탭 실패가 다른 탭을 막지 않게
                        await db.rollback()
                        logger.warning(f"[datarize] {tab['key']} 실패: {e}")
                        results[tab["key"]] = {"ok": False, "error": str(e)[:300]}
            oks = sum(1 for r in results.values() if r.get("ok"))
            log.status = "ok" if oks == len(results) else ("failed" if oks == 0 else "partial")
            log.finished_at = datetime.utcnow()
            log.detail = json.dumps(results, ensure_ascii=False)
            await db.commit()
            return {"status": log.status, "tabs": results}


# ── 일정 ─────────────────────────────────────────────────────────────────────

def seconds_until_next_run(now_utc: Optional[datetime] = None) -> float:
    now = now_utc or datetime.utcnow()
    best = None
    for h, m in SYNC_TIMES_KST:
        t = now.replace(hour=(h - 9) % 24, minute=m, second=0, microsecond=0)
        if t <= now:
            t += timedelta(days=1)
        best = t if best is None or t < best else best
    return (best - now).total_seconds()


async def _synced_recently(hours: int = 20) -> bool:
    from app.db.database import AsyncSessionLocal
    from app.models.datarize import DatarizeSyncLog

    async with AsyncSessionLocal() as db:
        last = (await db.execute(
            select(DatarizeSyncLog.started_at)
            .where(DatarizeSyncLog.status.in_(["ok", "partial"]))
            .order_by(DatarizeSyncLog.started_at.desc()).limit(1)
        )).scalar_one_or_none()
    return bool(last and datetime.utcnow() - last < timedelta(hours=hours))


async def run_datarize_sync_loop() -> None:
    await asyncio.sleep(90)  # 시작 직후 다른 루프와 겹치지 않게
    try:
        if not await _synced_recently():
            logger.info(f"[datarize] startup sync {await run_sync('startup')}")
    except Exception as e:
        logger.error(f"[datarize] startup sync 오류: {e}", exc_info=True)
    while True:
        await asyncio.sleep(seconds_until_next_run())
        try:
            logger.info(f"[datarize] {await run_sync('schedule')}")
        except Exception as e:
            logger.error(f"[datarize] 오류: {e}", exc_info=True)
