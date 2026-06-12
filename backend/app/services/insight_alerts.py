"""인사이트 스냅샷 기반 알람 엔진.

평가 규칙 (모두 campaign 레벨 일별 데이터 기준):
  1. CPA 급등   — 어제 CPA가 직전 7일 평균 CPA 대비 +30% 이상
                  (단, 어제 spend >= 10,000원 AND conversions >= 1)
  2. ROAS 연속 하락 — 최근 3일 ROAS가 3일 연속 전일 대비 하락
                      (spend >= 10,000원인 날만 유효)
  3. 피로도     — 어제 frequency >= 3.5
                  (단, impressions >= 1,000)

중복 발송 방지: 모듈 전역 _SENT_CACHE dict에 {(campaign_id, rule): datetime} 보관.
동일 조합이 24시간 내에 이미 발송되면 재발송 생략.
(재시작 시 초기화 허용 — DB 저장 불필요)
"""
import logging
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Dict, Optional, Tuple

import resend
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# ── 임계값 상수 ─────────────────────────────────────────────────────────────
CPA_SURGE_THRESHOLD = 0.30       # 전 7일 평균 대비 +30%
CPA_MIN_SPEND = 10_000.0         # 어제 최소 소재비(원)
CPA_MIN_CONVERSIONS = 1.0        # 어제 최소 전환수

ROAS_DIP_DAYS = 3                # 연속 하락 일수
ROAS_MIN_SPEND = 10_000.0        # 유효 날 최소 소재비(원)

FREQ_THRESHOLD = 3.5             # 피로도 frequency 임계값
FREQ_MIN_IMPRESSIONS = 1_000     # 최소 노출수

DEDUP_HOURS = 24                 # 중복 방지 시간(시간)

# ── 전역 중복 방지 캐시 ──────────────────────────────────────────────────────
# key: (campaign_id, rule_name), value: 마지막 발송 datetime
_SENT_CACHE: Dict[Tuple[str, str], datetime] = {}


# ── 내부 헬퍼 ────────────────────────────────────────────────────────────────

def _safe_div(numerator: float, denominator: float) -> float:
    """0 나누기 → 0."""
    return numerator / denominator if denominator else 0.0


def _already_sent(campaign_id: str, rule: str) -> bool:
    """24시간 내 동일 (campaign_id, rule) 발송 여부 확인."""
    key = (campaign_id, rule)
    last = _SENT_CACHE.get(key)
    if last is None:
        return False
    return (datetime.utcnow() - last).total_seconds() < DEDUP_HOURS * 3600


def _mark_sent(campaign_id: str, rule: str) -> None:
    """발송 완료 기록."""
    _SENT_CACHE[(campaign_id, rule)] = datetime.utcnow()


def _fmt_krw(v: float) -> str:
    """원화 포맷: ₩12,345"""
    try:
        return f"₩{int(v):,}"
    except (ValueError, TypeError):
        return "₩0"


def _fmt_pct(v: float) -> str:
    """퍼센트 포맷: +54.2%"""
    sign = "+" if v >= 0 else ""
    return f"{sign}{v:.1f}%"


def _build_alert_html(
    campaign_name: str,
    rule_label: str,
    description: str,
    as_of: str,
) -> str:
    """간결한 한국어 알람 HTML 이메일 본문 생성."""
    now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    return f"""
<div style="font-family:'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',Arial,sans-serif;
            max-width:600px;margin:0 auto;padding:16px">
  <div style="border-radius:12px;overflow:hidden;border:1px solid #fecaca;
              box-shadow:0 2px 8px rgba(0,0,0,0.07);background:#fff">

    <!-- 헤더 -->
    <div style="background:linear-gradient(135deg,#7f1d1d,#ef4444);
                padding:20px 24px">
      <p style="color:#fca5a5;font-size:11px;font-weight:600;letter-spacing:1.5px;
                text-transform:uppercase;margin:0 0 6px">Meta-Commander 알람</p>
      <h2 style="color:#fff;font-size:18px;font-weight:700;margin:0;line-height:1.4">
        {rule_label}
      </h2>
    </div>

    <!-- 캠페인명 -->
    <div style="padding:16px 24px 0">
      <p style="color:#6b7280;font-size:12px;margin:0 0 4px">캠페인</p>
      <p style="color:#111827;font-size:15px;font-weight:600;margin:0">{campaign_name}</p>
    </div>

    <!-- 수치 비교 -->
    <div style="padding:16px 24px">
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px 16px">
        <p style="color:#7f1d1d;font-size:13px;line-height:1.8;margin:0;white-space:pre-line">{description}</p>
      </div>
    </div>

    <!-- 데이터 기준일 -->
    <div style="background:#f9fafb;border-top:1px solid #e5e7eb;
                padding:10px 24px;display:flex;justify-content:space-between">
      <span style="font-size:11px;color:#9ca3af">데이터 기준일: {as_of}</span>
      <span style="font-size:11px;color:#9ca3af">발송: {now_str}</span>
    </div>

  </div>
</div>"""


async def _send_alert_email(
    to_emails: list,
    subject: str,
    html: str,
) -> None:
    """resend 라이브러리로 알람 메일 발송.

    RESEND_API_KEY 미설정 시 로그만 남기고 조용히 반환.
    """
    if not settings.RESEND_API_KEY:
        logger.warning("[InsightAlerts] RESEND_API_KEY 미설정 — 이메일 발송 생략")
        return

    try:
        resend.api_key = settings.RESEND_API_KEY
        from_email = settings.RESEND_FROM_EMAIL or "onboarding@resend.dev"
        if "<" not in from_email:
            from_email = f"Meta-Commander <{from_email}>"

        result = resend.Emails.send({
            "from": from_email,
            "to": to_emails,
            "subject": subject,
            "html": html,
        })
        logger.info(f"[InsightAlerts] 이메일 발송 완료: to={to_emails}, id={result.get('id') if isinstance(result, dict) else result}")
    except Exception as exc:
        logger.error(f"[InsightAlerts] 이메일 발송 실패: {exc}", exc_info=True)


async def _resolve_recipients(db: AsyncSession) -> list:
    """발송 대상 이메일 목록 결정.

    우선순위:
      1. ScheduledReport 테이블의 email_to (활성화된 리포트의 수신자)
      2. User 테이블에서 meta_access_token 보유 유저의 email
    """
    recipients: list = []

    try:
        from app.models.scheduled_report import ScheduledReport
        sr_result = await db.execute(
            select(ScheduledReport.email_to).where(
                ScheduledReport.enabled.is_(True),
                ScheduledReport.email_to.isnot(None),
                ScheduledReport.email_to != "",
            ).limit(20)
        )
        for (email_to,) in sr_result.all():
            # email_to는 쉼표 구분 가능
            for addr in email_to.split(","):
                addr = addr.strip()
                if addr and addr not in recipients:
                    recipients.append(addr)
    except Exception as exc:
        logger.debug(f"[InsightAlerts] ScheduledReport 수신자 조회 실패: {exc}")

    if not recipients:
        try:
            from app.models.user import User
            u_result = await db.execute(
                select(User.email).where(
                    User.meta_access_token.isnot(None),
                    User.meta_access_token != "",
                    User.email.isnot(None),
                    User.email != "",
                ).limit(5)
            )
            for (email,) in u_result.all():
                if email and email not in recipients:
                    recipients.append(email)
        except Exception as exc:
            logger.debug(f"[InsightAlerts] User 수신자 조회 실패: {exc}")

    return recipients


# ── 핵심 평가 함수 ───────────────────────────────────────────────────────────

async def evaluate_insight_alerts(db: AsyncSession) -> None:
    """meta_insights_daily 데이터를 읽어 3개 규칙을 평가하고 알람 이메일 발송.

    모든 예외는 내부에서 잡아 log — 수집 루프를 절대 죽이지 않는다.
    """
    try:
        await _run_evaluations(db)
    except Exception as exc:
        logger.error(f"[InsightAlerts] 평가 중 예외: {exc}", exc_info=True)


async def _run_evaluations(db: AsyncSession) -> None:
    """실제 규칙 평가 로직."""
    from app.models.meta_insight import MetaInsightDaily

    today = date.today()
    yesterday = today - timedelta(days=1)

    # 최근 10일치 데이터 로드 (campaign별 grouping 용도)
    lookback_since = today - timedelta(days=10)

    result = await db.execute(
        select(MetaInsightDaily)
        .where(
            MetaInsightDaily.level == "campaign",
            MetaInsightDaily.date >= lookback_since,
        )
        .order_by(MetaInsightDaily.campaign_id, MetaInsightDaily.date)
    )
    rows = result.scalars().all()

    if not rows:
        logger.debug("[InsightAlerts] 평가할 데이터 없음")
        return

    # campaign_id별로 날짜→행 매핑
    # {campaign_id: {date: MetaInsightDaily}}
    by_campaign: Dict[str, Dict[date, MetaInsightDaily]] = defaultdict(dict)
    for row in rows:
        by_campaign[row.campaign_id or row.object_id][row.date] = row

    # 수신자 목록 (한 번만 조회)
    recipients = await _resolve_recipients(db)
    if not recipients:
        logger.warning("[InsightAlerts] 수신자 없음 — 알람 발송 생략")
        return

    alerts_fired = 0

    for campaign_id, date_map in by_campaign.items():
        # 대표 캠페인 이름 (가장 최근 행 기준)
        latest_date = max(date_map.keys())
        campaign_name = date_map[latest_date].campaign_name or campaign_id

        # ── 규칙 1: CPA 급등 ─────────────────────────────────────────────────
        try:
            alerts_fired += await _check_cpa_surge(
                campaign_id, campaign_name, yesterday, date_map, recipients
            )
        except Exception as exc:
            logger.error(f"[InsightAlerts] CPA 규칙 평가 오류 ({campaign_id}): {exc}")

        # ── 규칙 2: ROAS 연속 하락 ───────────────────────────────────────────
        try:
            alerts_fired += await _check_roas_consecutive_dip(
                campaign_id, campaign_name, today, date_map, recipients
            )
        except Exception as exc:
            logger.error(f"[InsightAlerts] ROAS 규칙 평가 오류 ({campaign_id}): {exc}")

        # ── 규칙 3: 피로도 ───────────────────────────────────────────────────
        try:
            alerts_fired += await _check_frequency_fatigue(
                campaign_id, campaign_name, yesterday, date_map, recipients
            )
        except Exception as exc:
            logger.error(f"[InsightAlerts] 피로도 규칙 평가 오류 ({campaign_id}): {exc}")

    logger.info(f"[InsightAlerts] 평가 완료 — 캠페인 {len(by_campaign)}개, 알람 발동 {alerts_fired}건")


# ── 규칙별 평가 함수 ─────────────────────────────────────────────────────────

async def _check_cpa_surge(
    campaign_id: str,
    campaign_name: str,
    yesterday: date,
    date_map: Dict[date, "MetaInsightDaily"],
    recipients: list,
) -> int:
    """규칙 1: CPA 급등 — 어제 CPA가 직전 7일 평균 대비 +30% 이상.

    Returns:
        발동 건수 (0 또는 1)
    """
    rule = "cpa_surge"

    yesterday_row = date_map.get(yesterday)
    if not yesterday_row:
        return 0

    y_spend = float(yesterday_row.spend or 0)
    y_conv = float(yesterday_row.conversions or 0)

    # 발동 조건: 어제 spend >= 10,000 AND conversions >= 1
    if y_spend < CPA_MIN_SPEND or y_conv < CPA_MIN_CONVERSIONS:
        return 0

    y_cpa = _safe_div(y_spend, y_conv)

    # 직전 7일 평균 CPA (conversions > 0 인 날만)
    prior_cpas = []
    for offset in range(2, 9):  # 2일 전 ~ 8일 전
        d = yesterday - timedelta(days=offset - 1)
        r = date_map.get(d)
        if r and float(r.conversions or 0) >= 1 and float(r.spend or 0) >= CPA_MIN_SPEND:
            prior_cpas.append(_safe_div(float(r.spend), float(r.conversions)))

    if not prior_cpas:
        return 0  # 비교 데이터 없음

    avg_cpa = sum(prior_cpas) / len(prior_cpas)
    if avg_cpa <= 0:
        return 0

    change_rate = (y_cpa - avg_cpa) / avg_cpa

    if change_rate < CPA_SURGE_THRESHOLD:
        return 0

    # 중복 방지
    if _already_sent(campaign_id, rule):
        return 0

    # 알람 발송
    change_pct_str = _fmt_pct(change_rate * 100)
    description = (
        f"CPA: {_fmt_krw(avg_cpa)} (7일 평균) → {_fmt_krw(y_cpa)} (어제), {change_pct_str}\n"
        f"어제 지출: {_fmt_krw(y_spend)} / 전환수: {y_conv:.0f}건\n"
        f"임계값: 7일 평균 대비 +{int(CPA_SURGE_THRESHOLD * 100)}% 이상"
    )
    html = _build_alert_html(
        campaign_name=campaign_name,
        rule_label="CPA 급등 경보",
        description=description,
        as_of=yesterday.isoformat(),
    )
    subject = f"[Meta-Commander 알람] CPA 급등 — {campaign_name} ({change_pct_str})"
    await _send_alert_email(recipients, subject, html)
    _mark_sent(campaign_id, rule)
    logger.info(f"[InsightAlerts] CPA 급등 알람 발동: campaign={campaign_name}, cpa={y_cpa:.0f}, avg={avg_cpa:.0f}, change={change_pct_str}")
    return 1


async def _check_roas_consecutive_dip(
    campaign_id: str,
    campaign_name: str,
    today: date,
    date_map: Dict[date, "MetaInsightDaily"],
    recipients: list,
) -> int:
    """규칙 2: ROAS 연속 하락 — 최근 3일 ROAS가 3일 연속 전일 대비 하락.

    spend >= 10,000원인 날만 유효한 날로 간주.

    Returns:
        발동 건수 (0 또는 1)
    """
    rule = "roas_consecutive_dip"

    # 최근 4일치 ROAS 수집 (3일 연속 하락 = 4개 포인트 필요)
    # 오늘(today)은 아직 집계 중일 수 있으므로 yesterday부터 역산
    yesterday = today - timedelta(days=1)

    roas_series = []  # [(date, roas)] — 최신부터 오래된 순
    for offset in range(4):
        d = yesterday - timedelta(days=offset)
        r = date_map.get(d)
        if r and float(r.spend or 0) >= ROAS_MIN_SPEND:
            roas_val = _safe_div(float(r.revenue or 0), float(r.spend or 0))
            roas_series.append((d, roas_val))
        # spend 조건 미충족 시 해당 날은 시리즈에서 제외 (연속 계산 시 건너뜀)

    # 유효 날이 4개 미만이면 3일 연속 하락 판단 불가
    if len(roas_series) < 4:
        return 0

    # roas_series는 최신→오래된 순이므로 인덱스 0이 어제
    # 3일 연속 하락: [0] < [1] < [2] < [3] (어제 < 2일전 < 3일전 < 4일전)
    d0, r0 = roas_series[0]
    d1, r1 = roas_series[1]
    d2, r2 = roas_series[2]
    d3, r3 = roas_series[3]

    if not (r0 < r1 < r2 < r3):
        return 0

    # 중복 방지
    if _already_sent(campaign_id, rule):
        return 0

    # 알람 발송
    description = (
        f"3일 연속 ROAS 하락 감지 (유효 지출 기준)\n"
        f"  {d3.isoformat()}: ROAS {r3:.2f}\n"
        f"  {d2.isoformat()}: ROAS {r2:.2f}\n"
        f"  {d1.isoformat()}: ROAS {r1:.2f}\n"
        f"  {d0.isoformat()}: ROAS {r0:.2f} ← 어제\n"
        f"임계값: 유효 지출(≥{_fmt_krw(ROAS_MIN_SPEND)}) 기준 3일 연속 하락"
    )
    html = _build_alert_html(
        campaign_name=campaign_name,
        rule_label="ROAS 연속 하락 경보",
        description=description,
        as_of=d0.isoformat(),
    )
    subject = f"[Meta-Commander 알람] ROAS 연속 하락 — {campaign_name}"
    await _send_alert_email(recipients, subject, html)
    _mark_sent(campaign_id, rule)
    logger.info(f"[InsightAlerts] ROAS 연속 하락 알람 발동: campaign={campaign_name}, roas={r0:.2f}")
    return 1


async def _check_frequency_fatigue(
    campaign_id: str,
    campaign_name: str,
    yesterday: date,
    date_map: Dict[date, "MetaInsightDaily"],
    recipients: list,
) -> int:
    """규칙 3: 피로도 — 어제 frequency >= 3.5 AND impressions >= 1,000.

    Returns:
        발동 건수 (0 또는 1)
    """
    rule = "frequency_fatigue"

    yesterday_row = date_map.get(yesterday)
    if not yesterday_row:
        return 0

    freq = float(yesterday_row.frequency or 0)
    impr = int(yesterday_row.impressions or 0)

    if freq < FREQ_THRESHOLD or impr < FREQ_MIN_IMPRESSIONS:
        return 0

    # 중복 방지
    if _already_sent(campaign_id, rule):
        return 0

    # 알람 발송
    description = (
        f"Frequency: {freq:.2f} (임계값 {FREQ_THRESHOLD})\n"
        f"노출수: {impr:,}회\n"
        f"동일 사용자에게 광고가 반복 노출되고 있습니다. 소재 교체를 검토하세요."
    )
    html = _build_alert_html(
        campaign_name=campaign_name,
        rule_label="광고 피로도 경보",
        description=description,
        as_of=yesterday.isoformat(),
    )
    subject = f"[Meta-Commander 알람] 광고 피로도 — {campaign_name} (Frequency {freq:.2f})"
    await _send_alert_email(recipients, subject, html)
    _mark_sent(campaign_id, rule)
    logger.info(f"[InsightAlerts] 피로도 알람 발동: campaign={campaign_name}, frequency={freq:.2f}")
    return 1
