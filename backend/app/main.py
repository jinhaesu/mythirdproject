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
    from app.services.scheduled_report_executor import execute_scheduled_report, calc_next_run
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
                        run_result = await execute_scheduled_report(sched, db)
                        _scheduler_last_result = {"sched_id": sched.id, "name": sched.name, "result": run_result, "time": now.isoformat()}
                        sched.last_run_at = now
                        sched.next_run_at = calc_next_run(sched, now)
                        await db.commit()
                        logger.info("Scheduled report completed: %s -> %s", sched.name, run_result)
                    except Exception as e:
                        _scheduler_last_error = {"sched_id": sched.id, "error": str(e), "time": now.isoformat()}
                        logger.error("Scheduled report %s failed: %s", sched.id, e, exc_info=True)
                        # Always advance next_run_at even on failure to prevent infinite retry
                        try:
                            sched.next_run_at = calc_next_run(sched, now)
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
