"""Meta-Commander FastAPI Application."""
import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from fastapi import FastAPI, Request
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
    """Background task: check and execute due scheduled reports + keyword rank checks every 60s."""
    from app.db.database import AsyncSessionLocal as async_session_factory
    from app.models.scheduled_report import ScheduledReport
    from app.models.keyword_rank_schedule import KeywordRankSchedule
    from app.services.scheduled_report_executor import execute_scheduled_report, calc_next_run
    from app.services.keyword_rank_service import execute_keyword_rank_check
    from app.services.cafe24_poller import poll_cafe24_orders
    from sqlalchemy import select
    import json as _json

    global _scheduler_last_check, _scheduler_status, _scheduler_run_count, _scheduler_last_error, _scheduler_last_result
    _scheduler_status = "running"
    _cafe24_poll_counter = 0
    while True:
        try:
            await asyncio.sleep(60)
            now = datetime.utcnow()
            _scheduler_last_check = now
            _scheduler_run_count += 1

            # ── Cafe24 주문 폴링 (5분마다, 웹훅 fallback) ──
            _cafe24_poll_counter += 1
            if _cafe24_poll_counter >= 5:
                _cafe24_poll_counter = 0
                try:
                    result = await poll_cafe24_orders(lookback_hours=6)
                    logger.info(f"[Scheduler] Cafe24 poll result: {result}")
                except Exception as pe:
                    logger.error(f"[Scheduler] Cafe24 poll failed: {pe}", exc_info=True)
            async with async_session_factory() as db:
                # ── 1. 기존 스케줄 리포트 ──
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
                        run_result = await execute_scheduled_report(sched, db)
                        _scheduler_last_result = {"sched_id": sched.id, "name": sched.name, "result": run_result, "time": now.isoformat()}
                        sched.last_run_at = now
                        sched.next_run_at = calc_next_run(sched, now)
                        await db.commit()
                        logger.info("Scheduled report completed: %s -> %s", sched.name, run_result)
                    except Exception as e:
                        _scheduler_last_error = {"sched_id": sched.id, "error": str(e), "time": now.isoformat()}
                        logger.error("Scheduled report %s failed: %s", sched.id, e, exc_info=True)
                        try:
                            sched.next_run_at = calc_next_run(sched, now)
                            await db.commit()
                        except Exception:
                            await db.rollback()

                # ── 2. 키워드 순위 체크 스케줄 ──
                kr_result = await db.execute(
                    select(KeywordRankSchedule).where(
                        KeywordRankSchedule.enabled == True,  # noqa: E712
                        KeywordRankSchedule.next_run_at <= now,
                    )
                )
                due_rank_scheds = kr_result.scalars().all()
                if due_rank_scheds:
                    logger.info("Scheduler found %d due keyword rank checks", len(due_rank_scheds))
                for kr_sched in due_rank_scheds:
                    try:
                        logger.info("Running keyword rank check: %s (id=%s)", kr_sched.name, kr_sched.id)
                        kr_run_result = await execute_keyword_rank_check(kr_sched, db)
                        _scheduler_last_result = {"sched_id": kr_sched.id, "name": kr_sched.name, "type": "keyword_rank", "result": kr_run_result, "time": now.isoformat()}
                        kr_sched.last_run_at = now
                        kr_sched.last_result = _json.dumps(kr_run_result, ensure_ascii=False, default=str)
                        kr_sched.next_run_at = calc_next_run(kr_sched, now)
                        await db.commit()
                        logger.info("Keyword rank check completed: %s", kr_sched.name)
                    except Exception as e:
                        _scheduler_last_error = {"sched_id": kr_sched.id, "error": str(e), "time": now.isoformat()}
                        logger.error("Keyword rank check %s failed: %s", kr_sched.id, e, exc_info=True)
                        try:
                            kr_sched.next_run_at = calc_next_run(kr_sched, now)
                            await db.commit()
                        except Exception:
                            await db.rollback()

                # ── 3. 리뷰 리포트 스케줄 ──
                from app.models.review_monitor import ReviewReportSchedule, MonitoredProduct
                from app.services.review_service import fetch_naver_product_reviews, analyze_reviews, ai_review_analysis, build_review_report_html
                rr_result = await db.execute(
                    select(ReviewReportSchedule).where(
                        ReviewReportSchedule.enabled == True,  # noqa: E712
                        ReviewReportSchedule.next_run_at <= now,
                    )
                )
                due_rr = rr_result.scalars().all()
                for rr_sched in due_rr:
                    try:
                        logger.info("Running review report: %s", rr_sched.name)
                        user_id = int(rr_sched.user_id)
                        prods = (await db.execute(select(MonitoredProduct).where(MonitoredProduct.user_id == user_id))).scalars().all()
                        products_data = []
                        for p in prods:
                            rd = await fetch_naver_product_reviews(p.product_url)
                            if rd.get("reviews"):
                                st = analyze_reviews(rd["reviews"], rr_sched.star_threshold or 3)
                                ai = await ai_review_analysis(p.product_name, st, st.get("low_reviews_sample", []))
                            else:
                                st = {"total_reviews": 0, "average_rating": 0, "star_distribution": {}, "star_threshold": 3,
                                      "low_star_count_7d": 0, "low_star_count_14d": 0, "low_star_count_30d": 0, "low_star_total": 0}
                                ai = "리뷰를 가져올 수 없습니다."
                            products_data.append({"product_name": p.product_name, "stats": st, "ai_analysis": ai})
                        if products_data and rr_sched.email_to:
                            from app.core.config import get_settings as _gs
                            _settings = _gs()
                            if _settings.RESEND_API_KEY:
                                import resend as _resend
                                ct = (now + timedelta(hours=9)).strftime("%Y-%m-%d %H:%M KST")
                                _resend.api_key = _settings.RESEND_API_KEY
                                _resend.Emails.send({"from": _settings.RESEND_FROM_EMAIL, "to": [rr_sched.email_to],
                                    "subject": f"[리뷰 모니터링] 리포트 - {ct}", "html": build_review_report_html(products_data, ct)})
                        rr_sched.last_run_at = now
                        rr_sched.next_run_at = calc_next_run(rr_sched, now)
                        await db.commit()
                    except Exception as e:
                        logger.error("Review report %s failed: %s", rr_sched.id, e, exc_info=True)
                        try:
                            rr_sched.next_run_at = calc_next_run(rr_sched, now)
                            await db.commit()
                        except Exception:
                            await db.rollback()
        except Exception as e:
            _scheduler_status = f"error: {e}"
            _scheduler_last_error = {"error": str(e), "time": datetime.utcnow().isoformat()}
            logger.error("Schedule runner error: %s", e, exc_info=True)


async def _execute_scheduled_report(sched, db) -> dict:
    """Thin wrapper for backward compatibility — delegates to service module."""
    from app.services.scheduled_report_executor import execute_scheduled_report
    return await execute_scheduled_report(sched, db)


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


@app.get("/r/{code}")
async def short_track(code: str, request: "Request"):
    """Shortcut — /r/{code} 는 /api/v1/affiliate/track/{code}와 동일하게 동작."""
    from fastapi import Request as _Req  # noqa: F401
    from app.api.v1.endpoints.affiliate import track_referral_click
    from app.db.database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        return await track_referral_click(code, request, db)


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


@app.post("/api/v1/affiliate/poll-cafe24")
async def manual_poll_cafe24(lookback_hours: int = 24):
    """Cafe24 주문 폴링 수동 실행 — 즉시 현재까지의 주문을 조회해 conversion 반영."""
    from app.services.cafe24_poller import poll_cafe24_orders
    result = await poll_cafe24_orders(lookback_hours=lookback_hours)
    return result
