"""Meta-Commander FastAPI Application."""
import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import get_settings
from app.api.v1.router import api_router
from app.db.database import init_db

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

settings = get_settings()

_scheduler_last_check = None
_scheduler_status = "not started"
_scheduler_run_count = 0
_scheduler_last_error = None
_scheduler_last_result = None


async def _run_scheduled_reports():
    """Background task: check and execute due scheduled reports every 60s."""
    from app.db.database import AsyncSessionLocal as async_session_factory
    from app.models.scheduled_report import ScheduledReport
    from sqlalchemy import select

    global _scheduler_last_check, _scheduler_status, _scheduler_run_count, _scheduler_last_error, _scheduler_last_result
    _scheduler_status = "running"
    while True:
        try:
            await asyncio.sleep(60)
            now = datetime.utcnow()
            _scheduler_last_check = now
            _scheduler_run_count += 1
            async with async_session_factory() as db:
                result = await db.execute(
                    select(ScheduledReport).where(
                        ScheduledReport.enabled == True,  # noqa: E712
                        ScheduledReport.next_run_at <= now,
                    )
                )
                due_scheds = result.scalars().all()
                if due_scheds:
                    logger.info("Scheduler found %d due reports", len(due_scheds))
                for sched in due_scheds:
                    try:
                        logger.info("Running scheduled report: %s (id=%s)", sched.name, sched.id)
                        run_result = await _execute_scheduled_report(sched, db)
                        _scheduler_last_result = {"sched_id": sched.id, "name": sched.name, "result": run_result, "time": now.isoformat()}
                        sched.last_run_at = now
                        # Calculate next run
                        hour = sched.send_hour if sched.send_hour is not None else 9
                        minute = sched.send_minute if hasattr(sched, 'send_minute') and sched.send_minute is not None else 0
                        utc_hour = (hour - 9) % 24
                        if sched.schedule_type == "weekly":
                            sched.next_run_at = now.replace(hour=utc_hour, minute=minute, second=0, microsecond=0) + timedelta(days=7)
                        else:
                            m = now.month + 1
                            y = now.year + (1 if m > 12 else 0)
                            m = m if m <= 12 else m - 12
                            dom = sched.day_of_month or 1
                            sched.next_run_at = datetime(y, m, dom, utc_hour, minute, 0)
                        await db.commit()
                        logger.info("Scheduled report completed: %s -> %s", sched.name, run_result)
                    except Exception as e:
                        _scheduler_last_error = {"sched_id": sched.id, "error": str(e), "time": now.isoformat()}
                        logger.error("Scheduled report %s failed: %s", sched.id, e, exc_info=True)
                        await db.rollback()
        except Exception as e:
            _scheduler_status = f"error: {e}"
            _scheduler_last_error = {"error": str(e), "time": datetime.utcnow().isoformat()}
            logger.error("Schedule runner error: %s", e, exc_info=True)


async def _execute_scheduled_report(sched, db) -> dict:
    """Execute a single scheduled report: generate + email. Returns status dict."""
    import json
    import httpx
    from app.models.user import User
    from sqlalchemy import select as sa_select

    # Get user
    user_result = await db.execute(sa_select(User).where(User.id == sched.user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        logger.warning("Scheduled report user not found: %s", sched.user_id)
        return {"status": "error", "reason": "user_not_found"}

    # Calculate date range
    end_date = datetime.utcnow().strftime("%Y-%m-%d")
    start_date = (datetime.utcnow() - timedelta(days=sched.lookback_days or 7)).strftime("%Y-%m-%d")

    # Resolve Meta token: env var → user → PlatformConnection
    meta_token = settings.META_ACCESS_TOKEN or user.meta_access_token
    if not meta_token:
        from app.models.ad_platform import PlatformConnection
        shared = await db.execute(
            sa_select(PlatformConnection).where(
                PlatformConnection.platform == "META",
                PlatformConnection.is_active == True,  # noqa: E712
            ).limit(1)
        )
        conn = shared.scalar_one_or_none()
        if conn:
            meta_token = conn.access_token

    if not meta_token:
        logger.warning("No Meta token for scheduled report %s", sched.id)
        return {"status": "error", "reason": "no_meta_token"}

    meta_ad_account = user.meta_ad_account_id or settings.META_ACCESS_TOKEN and ""
    if not meta_ad_account:
        # Try to get from env or any reasonable default
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

    # Build email HTML with actual data
    daily_data = insights_data.get("data", [])
    total_spend = sum(float(d.get("spend", 0)) for d in daily_data)
    total_impressions = sum(int(d.get("impressions", 0)) for d in daily_data)
    total_clicks = sum(int(d.get("clicks", 0)) for d in daily_data)
    avg_ctr = (total_clicks / total_impressions * 100) if total_impressions > 0 else 0
    avg_cpc = (total_spend / total_clicks) if total_clicks > 0 else 0

    email_html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 24px; border-radius: 12px 12px 0 0;">
        <h2 style="color: white; margin: 0;">{sched.name}</h2>
        <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0;">기간: {start_date} ~ {end_date}</p>
      </div>
      <div style="background: #f8f9fa; padding: 24px; border: 1px solid #e9ecef;">
        <h3 style="margin: 0 0 16px; color: #333;">📊 성과 요약</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 12px; background: white; border: 1px solid #e9ecef; text-align: center;">
              <div style="font-size: 12px; color: #666;">총 비용</div>
              <div style="font-size: 20px; font-weight: bold; color: #333;">${'{:,.0f}'.format(total_spend)}원</div>
            </td>
            <td style="padding: 12px; background: white; border: 1px solid #e9ecef; text-align: center;">
              <div style="font-size: 12px; color: #666;">노출수</div>
              <div style="font-size: 20px; font-weight: bold; color: #333;">{total_impressions:,}</div>
            </td>
          </tr>
          <tr>
            <td style="padding: 12px; background: white; border: 1px solid #e9ecef; text-align: center;">
              <div style="font-size: 12px; color: #666;">클릭수</div>
              <div style="font-size: 20px; font-weight: bold; color: #333;">{total_clicks:,}</div>
            </td>
            <td style="padding: 12px; background: white; border: 1px solid #e9ecef; text-align: center;">
              <div style="font-size: 12px; color: #666;">CTR</div>
              <div style="font-size: 20px; font-weight: bold; color: #333;">{avg_ctr:.2f}%</div>
            </td>
          </tr>
          <tr>
            <td colspan="2" style="padding: 12px; background: white; border: 1px solid #e9ecef; text-align: center;">
              <div style="font-size: 12px; color: #666;">평균 CPC</div>
              <div style="font-size: 20px; font-weight: bold; color: #333;">${'{:,.0f}'.format(avg_cpc)}원</div>
            </td>
          </tr>
        </table>
        <p style="margin: 16px 0 0; font-size: 12px; color: #999; text-align: center;">
          데이터 일수: {len(daily_data)}일 | Meta-Commander 자동 리포트
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
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events."""
    # Startup
    try:
        await init_db()
        logger.info("Database initialized successfully")
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")
        raise
    # Start background scheduler
    scheduler_task = asyncio.create_task(_run_scheduled_reports())
    logger.info("Scheduled report background runner started")
    yield
    # Shutdown
    scheduler_task.cancel()


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="""
    Meta-Commander: AI-Powered Meta Marketing Platform

    ## Features

    - **Market Intelligence (TAB 1)**: Competitor analysis, keyword monitoring, style extraction
    - **Creative Studio (TAB 2)**: AI image/video generation, text rewriting, background extension
    - **Ads Controller (TAB 3)**: Campaign creation, strategy recommendation, Meta publishing
    - **Performance Dashboard (TAB 4)**: KPI tracking, A/B test analysis, AI insights

    ## API Structure

    - `/api/v1/auth` - Authentication & Meta connection
    - `/api/v1/benchmark` - Market intelligence & benchmarking
    - `/api/v1/creative` - Content generation & editing
    - `/api/v1/campaign` - Campaign management & publishing
    - `/api/v1/analytics` - Performance analytics & optimization
    """,
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=("*" not in settings.cors_origins_list),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API router
app.include_router(api_router, prefix="/api/v1")

# Mount uploads directory for static file serving
uploads_dir = os.path.join(os.path.dirname(__file__), "..", "uploads")
os.makedirs(uploads_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "status": "running",
        "docs": "/api/docs"
    }


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


@app.get("/scheduler/status")
async def scheduler_status():
    """Check the background scheduler status."""
    return {
        "status": _scheduler_status,
        "last_check": _scheduler_last_check.isoformat() if _scheduler_last_check else None,
        "check_count": _scheduler_run_count,
        "last_error": _scheduler_last_error,
        "last_result": _scheduler_last_result,
        "resend_configured": bool(settings.RESEND_API_KEY),
        "resend_from": settings.RESEND_FROM_EMAIL,
        "meta_token_configured": bool(settings.META_ACCESS_TOKEN),
    }
