"""스케줄 리포트 실행 서비스 — main.py와 analytics.py 양쪽에서 사용."""
import json
import logging
from datetime import datetime, timedelta

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


async def execute_scheduled_report(sched, db) -> dict:
    """Execute a single scheduled report: generate + email. Returns status dict."""
    from app.models.user import User
    from sqlalchemy import select as sa_select

    # Get user
    # user_id is stored as varchar but User.id is integer — cast to int
    try:
        uid = int(sched.user_id)
    except (ValueError, TypeError):
        logger.warning("Invalid user_id for scheduled report: %s", sched.user_id)
        return {"status": "error", "reason": "user_not_found"}
    user_result = await db.execute(sa_select(User).where(User.id == uid))
    user = user_result.scalar_one_or_none()
    if not user:
        logger.warning("Scheduled report user not found: %s", sched.user_id)
        return {"status": "error", "reason": "user_not_found"}

    # Calculate date range
    end_date = datetime.utcnow().strftime("%Y-%m-%d")
    start_date = (datetime.utcnow() - timedelta(days=sched.lookback_days or 7)).strftime("%Y-%m-%d")

    # Resolve Meta token & ad account: user → shared PlatformConnection
    from app.models.ad_platform import PlatformConnection
    meta_token = user.meta_access_token
    meta_ad_account = user.meta_ad_account_id or ""
    if not meta_token:
        shared = await db.execute(
            sa_select(PlatformConnection).where(
                PlatformConnection.platform == "META",
                PlatformConnection.is_active == True,  # noqa: E712
            ).limit(1)
        )
        conn = shared.scalar_one_or_none()
        if conn:
            meta_token = conn.access_token
            if not meta_ad_account:
                meta_ad_account = conn.account_id or ""

    if not meta_token:
        logger.warning("No Meta token for scheduled report %s", sched.id)
        return {"status": "error", "reason": "no_meta_token"}

    if not meta_ad_account:
        logger.warning("No ad account for scheduled report %s", sched.id)
        return {"status": "error", "reason": "no_ad_account"}

    ad_account_id = meta_ad_account if meta_ad_account.startswith("act_") else f"act_{meta_ad_account}"
    base_url = f"{settings.META_GRAPH_API_BASE}/{settings.META_API_VERSION}"
    insights_endpoint = f"{sched.meta_campaign_id}/insights" if sched.meta_campaign_id else f"{ad_account_id}/insights"

    # Fetch Meta insights
    insights_data = None
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{base_url}/{insights_endpoint}",
                params={
                    "access_token": meta_token,
                    "fields": "spend,impressions,reach,clicks,ctr,cpc,cpm,actions,cost_per_action_type,action_values,purchase_roas,website_purchase_roas",
                    "time_range": json.dumps({"since": start_date, "until": end_date}),
                    "time_increment": 1,
                }
            )
            if resp.status_code != 200:
                logger.error("Meta API error for scheduled report: %s", resp.text[:300])
                return {"status": "error", "reason": "meta_api_error", "detail": resp.text[:200]}
            insights_data = resp.json()
    except Exception as e:
        logger.error("Meta API request failed: %s", e)
        return {"status": "error", "reason": "meta_request_failed", "detail": str(e)}

    # Compute rich metrics from daily data
    daily_data = insights_data.get("data", [])
    total_spend = sum(float(d.get("spend", 0)) for d in daily_data)
    total_impressions = sum(int(d.get("impressions", 0)) for d in daily_data)
    total_clicks = sum(int(d.get("clicks", 0)) for d in daily_data)
    total_reach = sum(int(d.get("reach", 0)) for d in daily_data)
    avg_ctr = (total_clicks / total_impressions * 100) if total_impressions > 0 else 0
    avg_cpc = (total_spend / total_clicks) if total_clicks > 0 else 0
    avg_cpm = (total_spend / total_impressions * 1000) if total_impressions > 0 else 0

    # Extract conversions & ROAS from actions (same logic as in-app report)
    total_conversions = 0
    total_purchase_value = 0.0
    purchase_types = {"offsite_conversion.fb_pixel_purchase", "purchase", "omni_purchase", "onsite_web_purchase"}
    for row in daily_data:
        for act in (row.get("actions") or []):
            if act.get("action_type") in purchase_types:
                total_conversions += int(float(act.get("value", 0)))

    # Calculate total_purchase_value: try website_purchase_roas first, then action_values
    for row in daily_data:
        row_spend = float(row.get("spend", 0) or 0)
        row_purchase_value = 0.0

        # Method 1: website_purchase_roas or purchase_roas (ROAS * spend = purchase value)
        roas_val = 0.0
        for rk in (row.get("website_purchase_roas") or row.get("purchase_roas") or []):
            rv = float(rk.get("value", 0))
            if rv > 0:
                roas_val = rv
                break

        if roas_val > 0 and row_spend > 0:
            row_purchase_value = roas_val * row_spend
        else:
            # Method 2: action_values fallback
            for av in (row.get("action_values") or []):
                if av.get("action_type") in purchase_types:
                    row_purchase_value += float(av.get("value", 0))

        total_purchase_value += row_purchase_value

        # Store per-row values
        row["roas"] = roas_val if roas_val > 0 else (round(row_purchase_value / row_spend, 2) if row_spend > 0 and row_purchase_value > 0 else 0)
        row["conversion_value"] = round(row_purchase_value, 0)

    roas = round(total_purchase_value / total_spend, 2) if total_spend > 0 and total_purchase_value > 0 else None

    # Build report_data dict matching the in-app report structure
    report_data = {
        "period": {"start": start_date, "end": end_date},
        "totals": {
            "spend": total_spend,
            "impressions": total_impressions,
            "clicks": total_clicks,
            "reach": total_reach,
            "ctr": round(avg_ctr, 2),
            "cpc": round(avg_cpc, 0),
            "conversion_value": total_purchase_value,
            "roas": roas,
        },
        "daily_data": daily_data,
    }

    # AI Analysis — same detailed prompt as in-app report
    ai_report = None
    try:
        from app.services.ai import ClaudeService
        claude = ClaudeService()
        ai_input = {
            "period": report_data["period"],
            "totals": report_data["totals"],
        }
        daily_for_ai = daily_data
        if len(daily_for_ai) > 60:
            ai_input["daily_data"] = [
                {"date": d.get("date_stop") or d.get("date"), "spend": d.get("spend"),
                 "impressions": d.get("impressions"), "clicks": d.get("clicks"),
                 "ctr": d.get("ctr"), "roas": d.get("roas")}
                for d in daily_for_ai
            ]
        else:
            ai_input["daily_data"] = [
                {"date": d.get("date_stop") or d.get("date_start"), "spend": d.get("spend"),
                 "impressions": d.get("impressions"), "reach": d.get("reach"),
                 "clicks": d.get("clicks"), "ctr": d.get("ctr"), "roas": d.get("roas")}
                for d in daily_for_ai
            ]

        ai_prompt = f"""다음 캠페인 성과 데이터를 분석하여 한국어 리포트를 작성해주세요. 반드시 상세하고 풍부하게 분석하세요.

{json.dumps(ai_input, ensure_ascii=False, indent=2)}

반드시 아래 JSON 형식으로 응답하세요:

```json
{{
  "headline": "한 줄 핵심 분석 제목 (예: 'ROAS 1.8x 달성, 전환 효율 개선 필요')",
  "period_summary": "3-5문장으로 기간 전체 성과를 종합 요약. 주요 지표 변화와 의미를 포함.",
  "kpi_highlights": [
    {{"metric": "총 지출", "value": "₩금액", "change": "+15%", "insight": "한 줄 해석"}},
    {{"metric": "ROAS", "value": "수치", "change": "+0.3", "insight": "한 줄 해석"}},
    {{"metric": "CTR", "value": "수치%", "change": "-0.1%", "insight": "한 줄 해석"}},
    {{"metric": "CPC", "value": "₩금액", "change": "+10%", "insight": "한 줄 해석"}}
  ],
  "daily_trend_insight": "일별 트렌드에서 발견한 핵심 패턴을 3-5문장으로 상세히 설명.",
  "key_insights": [
    "핵심 인사이트 1 - 2문장 이상으로 상세하게",
    "핵심 인사이트 2 - 데이터 기반 구체적 분석",
    "핵심 인사이트 3 - 성과 영향 요인 분석",
    "핵심 인사이트 4 - 경쟁 환경 또는 시즌 영향",
    "핵심 인사이트 5 - 개선 기회 포인트"
  ],
  "recommendations": [
    {{"title": "추천 제목", "description": "3-5문장으로 구체적 실행 방안 상세 설명", "priority": "high", "expected_impact": "예상 효과 (수치 포함)"}},
    {{"title": "추천 제목", "description": "상세 설명", "priority": "medium", "expected_impact": "예상 효과"}},
    {{"title": "추천 제목", "description": "상세 설명", "priority": "low", "expected_impact": "예상 효과"}}
  ],
  "overall_grade": "A 또는 B 또는 C 또는 D 또는 F",
  "grade_reason": "등급 사유를 2문장으로 설명"
}}
```

규칙:
- ROAS(광고비 대비 매출)는 특히 중요하게 분석
- kpi_highlights는 최소 4개 이상
- key_insights는 최소 5개, 각각 2문장 이상으로 상세하게
- recommendations는 최소 3개, description은 3문장 이상
- 모든 분석은 데이터에 기반하여 구체적으로 작성
- JSON만 출력하세요"""

        models_to_try = [
            "claude-sonnet-4-20250514", "claude-3-7-sonnet-20250219",
            "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022",
        ]
        for model_id in models_to_try:
            try:
                ai_resp = claude.client.messages.create(
                    model=model_id, max_tokens=8192,
                    messages=[{"role": "user", "content": ai_prompt}],
                )
                ai_text = ai_resp.content[0].text
                logger.info("Scheduled report AI raw response (first 300 chars): %s", ai_text[:300])

                # Attempt 1: ```json ... ``` block
                try:
                    if "```json" in ai_text:
                        json_block = ai_text.split("```json")[1].split("```")[0].strip()
                        ai_report = json.loads(json_block)
                        logger.info("Parsed AI report via ```json block")
                except Exception as parse_err:
                    logger.warning("```json block parsing failed: %s", parse_err)
                    ai_report = None

                # Attempt 2: ``` ... ``` block (without json tag)
                if ai_report is None:
                    try:
                        if "```" in ai_text:
                            parts = ai_text.split("```")
                            if len(parts) >= 3:
                                json_block = parts[1].replace("json", "", 1).strip()
                                ai_report = json.loads(json_block)
                                logger.info("Parsed AI report via ``` block")
                    except Exception as parse_err:
                        logger.warning("``` block parsing failed: %s", parse_err)
                        ai_report = None

                # Attempt 3: Find raw JSON object using first { and last }
                if ai_report is None:
                    try:
                        start_idx = ai_text.find("{")
                        end_idx = ai_text.rfind("}")
                        if start_idx >= 0 and end_idx > start_idx:
                            json_candidate = ai_text[start_idx:end_idx + 1]
                            ai_report = json.loads(json_candidate)
                            logger.info("Parsed AI report via raw JSON extraction (first { to last })")
                    except Exception as parse_err:
                        logger.warning("Raw JSON extraction failed: %s", parse_err)
                        ai_report = None

                # Fallback: Create minimal ai_report from raw text
                if ai_report is None:
                    logger.warning("All JSON parsing attempts failed. Creating fallback ai_report from raw text.")
                    # Use first 500 chars as a summary fallback
                    fallback_text = ai_text.strip()[:500] if ai_text else "AI 분석 결과를 파싱할 수 없습니다."
                    ai_report = {
                        "headline": "AI 분석 완료 (원본 텍스트)",
                        "period_summary": fallback_text,
                        "kpi_highlights": [],
                        "daily_trend_insight": "",
                        "key_insights": ["AI 응답을 JSON으로 파싱하지 못했습니다. 원본 텍스트를 참고하세요."],
                        "recommendations": [],
                        "overall_grade": "N/A",
                        "grade_reason": "JSON 파싱 실패로 등급 산정 불가",
                    }

                logger.info("Scheduled report AI analysis succeeded with model: %s", model_id)
                break
            except Exception as model_err:
                logger.warning("AI model %s failed for scheduled report: %s", model_id, model_err)
    except Exception as e:
        logger.warning("AI analysis for scheduled report failed: %s", e)

    report_data["ai_report"] = ai_report

    # Build rich email HTML using the same builder as in-app reports
    from app.api.v1.endpoints.analytics import _build_report_html
    email_html = f"""
    <div style="font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', 'Segoe UI', Arial, sans-serif; max-width: 680px; margin: 0 auto; padding: 16px;">
        <div style="border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;box-shadow:0 4px 12px rgba(0,0,0,0.08);background:white">
            {_build_report_html(report_data)}
        </div>
        <div style="text-align:center;margin-top:16px;padding:12px">
            <p style="font-size:11px;color:#9ca3af">
                Meta-Commander 스케줄 리포트 ({sched.name}) | 자동 생성 {datetime.utcnow().strftime('%Y-%m-%d %H:%M')} UTC
            </p>
        </div>
    </div>
    """

    # Send email
    email_sent = False
    email_error = None
    if not sched.email_to:
        return {"status": "success", "reason": "no_email_configured", "insights_count": len(daily_data)}
    if not settings.RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not set, cannot send scheduled report email")
        return {"status": "error", "reason": "resend_api_key_not_set", "insights_count": len(daily_data)}

    try:
        import resend
        resend.api_key = settings.RESEND_API_KEY
        from_email = settings.RESEND_FROM_EMAIL or "onboarding@resend.dev"
        resend.Emails.send({
            "from": from_email,
            "to": [sched.email_to],
            "subject": f"[Meta-Commander] {sched.name} ({start_date} ~ {end_date})",
            "html": email_html,
        })
        email_sent = True
        logger.info("Scheduled report email sent to %s", sched.email_to)
    except Exception as e:
        email_error = str(e)
        logger.error("Scheduled report email failed: %s", e, exc_info=True)

    return {
        "status": "success" if email_sent else "email_failed",
        "email_sent": email_sent,
        "email_error": email_error,
        "insights_count": len(daily_data),
        "performance": {
            "spend": total_spend,
            "impressions": total_impressions,
            "clicks": total_clicks,
            "ctr": round(avg_ctr, 2),
            "roas": roas,
            "conversions": total_conversions,
            "purchase_value": total_purchase_value,
        },
    }


def calc_next_run(sched, now_utc: datetime) -> datetime:
    """Calculate the next run time for a schedule. Returns UTC datetime.

    send_hour/send_minute are in KST (UTC+9).
    """
    import calendar

    hour_kst = sched.send_hour if sched.send_hour is not None else 9
    minute = sched.send_minute if hasattr(sched, 'send_minute') and sched.send_minute is not None else 0

    if sched.schedule_type == "weekly":
        # Find next occurrence of the target day-of-week in KST
        kst_now = now_utc + timedelta(hours=9)
        # Frontend convention: 0=일(Sun), 1=월(Mon), ..., 6=토(Sat)
        # Python weekday(): 0=Mon, 1=Tue, ..., 6=Sun
        # Convert frontend → Python: (frontend_dow - 1) % 7
        frontend_dow = sched.day_of_week if sched.day_of_week is not None else 1  # default=Monday
        target_dow_python = (frontend_dow - 1) % 7  # 0(Sun)→6, 1(Mon)→0, ..., 6(Sat)→5
        days_ahead = (target_dow_python - kst_now.weekday()) % 7
        if days_ahead == 0:
            # Same day — check if time already passed
            target_time = kst_now.replace(hour=hour_kst, minute=minute, second=0, microsecond=0)
            if kst_now >= target_time:
                days_ahead = 7  # Schedule for next week
        next_kst = kst_now.replace(hour=hour_kst, minute=minute, second=0, microsecond=0) + timedelta(days=days_ahead)
        # Convert back to UTC
        return next_kst - timedelta(hours=9)
    else:
        # Monthly: next month, clamped day-of-month
        kst_now = now_utc + timedelta(hours=9)
        m = kst_now.month + 1
        y = kst_now.year
        if m > 12:
            m = 1
            y += 1
        dom = sched.day_of_month or 1
        # Clamp to last valid day of month
        max_day = calendar.monthrange(y, m)[1]
        dom = min(dom, max_day)
        next_kst = datetime(y, m, dom, hour_kst, minute, 0)
        # Convert back to UTC
        return next_kst - timedelta(hours=9)
