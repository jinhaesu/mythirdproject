"""매일 09:00 KST 전일 Meta 광고 지출액·ROAS 알림 (2026-10-29 마케팅 연다은 건의).

- 대상: 공유 Meta 계정(널담은디저트) 계정 전체 합계, 전일 00:00~23:59(KST, 계정 시간대 기준 일자).
- 값: Meta 성과 화면(계정 추이)과 같은 방식 — get_account_daily_trend의 spend, roas.
- 받는 곳: env META_DAILY_ALERT_TO(쉼표로 여러 번호). 비어 있으면 아무것도 보내지 않는다.
- 카카오 알림톡: env META_ALERT_KAKAO_PFID + META_ALERT_KAKAO_TEMPLATE_ID가 있으면 Solapi 알림톡,
  없으면 문자(LMS)로 보낸다. 알림톡 템플릿 변수는 #{날짜} #{지출액} #{ROAS} #{판단}.
- 같은 날짜는 meta_daily_alert_log 행으로 한 번만 보낸다.
"""
import asyncio
import logging
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings

logger = logging.getLogger(__name__)

KST = timedelta(hours=9)
SEND_HOUR_KST = 9
# 지속 가능 ROAS 기준 3.1~3.3 (format.ts roasClass와 같은 기준)
BREAKEVEN_LOW = 3.1
BREAKEVEN_HIGH = 3.3


def kst_today(now_utc: Optional[datetime] = None) -> date:
    return ((now_utc or datetime.utcnow()) + KST).date()


def recipients_from_env(raw: str) -> list[str]:
    out = []
    for p in (raw or "").split(","):
        n = p.strip().replace("-", "").replace(" ", "")
        if n.isdigit() and len(n) >= 9:
            out.append(n)
    return out


def roas_judgement(roas: Optional[float]) -> str:
    if roas is None:
        return "광고 매출 없음"
    if roas < BREAKEVEN_LOW:
        return f"기준 {BREAKEVEN_LOW} 미만"
    if roas <= BREAKEVEN_HIGH:
        return f"기준 {BREAKEVEN_LOW}~{BREAKEVEN_HIGH} 안"
    return f"기준 {BREAKEVEN_HIGH} 초과"


def build_message(account_name: str, day: date, spend: float, roas: Optional[float]) -> dict:
    """알림 본문과 알림톡 변수. 순수 함수 — 시험용."""
    weekday = "월화수목금토일"[day.weekday()]
    date_txt = f"{day.month}/{day.day}({weekday})"
    spend_txt = f"{round(spend):,}원"
    roas_txt = f"{roas:.2f}" if roas is not None else "-"
    judge = roas_judgement(roas)
    text = (
        f"[Meta 광고 전일 성과] {account_name}\n"
        f"{date_txt} 하루 합계\n"
        f"- 지출액: {spend_txt}\n"
        f"- ROAS: {roas_txt} ({judge})\n"
        f"자세히: 마케팅 시스템 › 광고 성과 › Meta"
    )
    return {
        "text": text,
        "variables": {"#{날짜}": date_txt, "#{지출액}": spend_txt, "#{ROAS}": roas_txt, "#{판단}": judge},
    }


async def fetch_day(db, day: date) -> dict:
    """공유 Meta 계정의 그날 합계(계정 레벨). 연결이 없으면 connected False."""
    from app.models.user import User
    from app.services.meta_ads_service import MetaAdsService

    meta_user = (
        await db.execute(
            select(User).where(User.meta_access_token.isnot(None), User.meta_access_token != "").limit(1)
        )
    ).scalar_one_or_none()
    if not meta_user:
        return {"connected": False}
    svc = await MetaAdsService.create(meta_user, db)
    if not svc.connected:
        return {"connected": False}
    d = day.isoformat()
    rows = await svc.get_account_daily_trend(1, since=d, until=d, time_increment=1)
    info = await svc._get(svc.ad_account_id, {"fields": "name"})
    spend = sum(float(r.get("spend", 0) or 0) for r in rows)
    value = sum(float(r.get("conversion_value", 0) or 0) for r in rows)
    roas = round(value / spend, 2) if spend > 0 and value > 0 else None
    return {
        "connected": True,
        "account_name": (info or {}).get("name") or "Meta 광고 계정",
        "spend": spend,
        "roas": roas,
        "rows": len(rows),
    }


async def _deliver(text: str, variables: dict, to_list: list[str]) -> tuple[str, list[dict]]:
    from app.services.sms import send_sms

    s = get_settings()
    kakao = None
    channel = "lms"
    if s.META_ALERT_KAKAO_PFID and s.META_ALERT_KAKAO_TEMPLATE_ID:
        kakao = {"pfId": s.META_ALERT_KAKAO_PFID, "templateId": s.META_ALERT_KAKAO_TEMPLATE_ID, "variables": variables}
        channel = "kakao"
    results = []
    for to in to_list:
        results.append(await send_sms(to, text, kakao_options=kakao))
    return channel, results


async def run_once(db, day: Optional[date] = None, dry_run: bool = False) -> dict:
    """day(기본 전일 KST) 알림 1회. dry_run이면 조회·본문만 만들고 보내지도 기록하지도 않는다."""
    from app.models.meta_daily_alert import MetaDailyAlertLog

    s = get_settings()
    to_list = recipients_from_env(s.META_DAILY_ALERT_TO)
    day = day or (kst_today() - timedelta(days=1))
    if not to_list and not dry_run:
        return {"skipped": "no_recipients"}

    data = await fetch_day(db, day)
    if not data.get("connected"):
        return {"skipped": "meta_not_connected", "day": day.isoformat()}
    msg = build_message(data["account_name"], day, data["spend"], data["roas"])
    if dry_run:
        return {"dry_run": True, "day": day.isoformat(), **msg, "recipients": len(to_list)}

    log = MetaDailyAlertLog(day=day, status="sending", recipients=len(to_list), message=msg["text"])
    db.add(log)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return {"skipped": "already_sent", "day": day.isoformat()}

    channel, results = await _deliver(msg["text"], msg["variables"], to_list)
    ok = sum(1 for r in results if r.get("success"))
    log.channel = channel
    log.status = "sent" if ok == len(results) else ("failed" if ok == 0 else "partial")
    log.detail = "; ".join(str(r.get("reason", "ok"))[:120] for r in results)
    await db.commit()
    return {"day": day.isoformat(), "channel": channel, "sent": ok, "total": len(results)}


def seconds_until_next_send(now_utc: Optional[datetime] = None) -> float:
    now = now_utc or datetime.utcnow()
    target = now.replace(hour=(SEND_HOUR_KST - 9) % 24, minute=0, second=30, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


async def run_meta_daily_alert_loop() -> None:
    """매일 09:00 KST(00:00 UTC) 전일 알림. 받는 번호 env가 비어 있으면 그 날은 건너뛴다."""
    from app.db.database import AsyncSessionLocal

    while True:
        await asyncio.sleep(seconds_until_next_send())
        try:
            async with AsyncSessionLocal() as db:
                r = await run_once(db)
                logger.info(f"[meta-daily-alert] {r}")
        except Exception as e:
            logger.error(f"[meta-daily-alert] 오류: {e}", exc_info=True)
