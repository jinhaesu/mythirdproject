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
    from app.services.cafe24 import proactive_refresh_all
    from sqlalchemy import select
    import json as _json

    global _scheduler_last_check, _scheduler_status, _scheduler_run_count, _scheduler_last_error, _scheduler_last_result
    _scheduler_status = "running"
    _cafe24_poll_counter = 0
    _cafe24_refresh_counter = 0
    while True:
        try:
            await asyncio.sleep(60)
            now = datetime.utcnow()
            _scheduler_last_check = now
            _scheduler_run_count += 1

            # ── Cafe24 토큰 선제적 refresh (30분마다, 만료 훨씬 전에 갱신) ──
            _cafe24_refresh_counter += 1
            if _cafe24_refresh_counter >= 30:
                _cafe24_refresh_counter = 0
                try:
                    async with async_session_factory() as _db:
                        rr = await proactive_refresh_all(_db)
                        logger.info(f"[Scheduler] Cafe24 proactive refresh: {rr}")
                except Exception as e:
                    logger.error(f"[Scheduler] Cafe24 proactive refresh failed: {e}")

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
async def short_track(code: str, request: Request):
    """Shortcut — /r/{code} 는 /api/v1/affiliate/track/{code}와 동일하게 동작."""
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


@app.post("/api/v1/affiliate/cleanup-conversions")
async def cleanup_unattributable_conversions(hours: int = 24):
    """
    최근 N시간 내 생성된 ReferralConversion 중 ref/쿠폰으로 매칭 안 된 것을 정리.
    "전역 최근 클릭 fallback"으로 잘못 귀속된 비어필리에이트 주문 제거용.
    """
    from datetime import timedelta as _td
    from sqlalchemy import select as _select
    from app.db.database import AsyncSessionLocal as _S
    from app.models.affiliate import ReferralConversion, AffiliateCampaign

    since = datetime.utcnow() - _td(hours=hours)
    async with _S() as db:
        rows_r = await db.execute(
            _select(ReferralConversion).where(ReferralConversion.converted_at >= since)
        )
        rows = rows_r.scalars().all()

        deleted = 0
        kept = 0
        details = []
        for c in rows:
            if c.campaign_id:
                cr = await db.execute(
                    _select(AffiliateCampaign).where(AffiliateCampaign.id == c.campaign_id)
                )
                camp = cr.scalar_one_or_none()
                if camp and camp.cafe24_coupon_code:
                    kept += 1
                    continue
            details.append({
                "id": c.id, "order_id": c.cafe24_order_id,
                "partner_id": c.partner_id, "campaign_id": c.campaign_id,
                "order_amount": c.order_amount,
            })
            await db.delete(c)
            deleted += 1
        await db.commit()
        return {"deleted": deleted, "kept": kept, "details": details}


@app.post("/api/v1/affiliate/conversions/delete-by-order")
async def delete_conversion_by_order(order_id: str):
    """특정 cafe24_order_id의 ReferralConversion 단건 삭제 (수동 정정용)."""
    from sqlalchemy import delete as _delete, select as _select
    from app.db.database import AsyncSessionLocal as _S
    from app.models.affiliate import ReferralConversion

    async with _S() as db:
        r = await db.execute(
            _select(ReferralConversion).where(ReferralConversion.cafe24_order_id == order_id)
        )
        row = r.scalar_one_or_none()
        if not row:
            return {"deleted": 0, "order_id": order_id}
        snapshot = {
            "id": row.id, "order_id": row.cafe24_order_id,
            "status": row.status, "order_amount": row.order_amount,
            "partner_id": row.partner_id, "campaign_id": row.campaign_id,
        }
        await db.execute(
            _delete(ReferralConversion).where(ReferralConversion.cafe24_order_id == order_id)
        )
        await db.commit()
        return {"deleted": 1, "snapshot": snapshot}


@app.post("/api/v1/affiliate/conversions/purge-by-campaign")
async def purge_conversions_by_campaign(campaign_id: int):
    """특정 캠페인의 ReferralConversion을 전부 삭제. 잘못 귀속된 과거 데이터 초기화용."""
    from sqlalchemy import delete as _delete, select as _select, func as _func
    from app.db.database import AsyncSessionLocal as _S
    from app.models.affiliate import ReferralConversion

    async with _S() as db:
        count_r = await db.execute(
            _select(_func.count(ReferralConversion.id)).where(
                ReferralConversion.campaign_id == campaign_id
            )
        )
        count = count_r.scalar() or 0
        await db.execute(
            _delete(ReferralConversion).where(ReferralConversion.campaign_id == campaign_id)
        )
        await db.commit()
        return {"campaign_id": campaign_id, "deleted": count}


@app.get("/api/v1/affiliate/debug/timeseries")
async def debug_timeseries(days: int = 30):
    """timeseries raw 데이터 (디버그용, 인증 없음)."""
    from datetime import timedelta as _td
    from sqlalchemy import select as _select, func as _func
    from app.db.database import AsyncSessionLocal as _S
    from app.models.affiliate import AffiliatePartner, ReferralClick, ReferralConversion

    async with _S() as db:
        pid_r = await db.execute(_select(AffiliatePartner.id).where(AffiliatePartner.deleted_at.is_(None)))
        pids = [r[0] for r in pid_r.all()]
        since = datetime.utcnow() - _td(days=days)
        if not pids:
            return {"partner_ids": [], "days": days, "since": since.isoformat(), "rows": []}
        day_col = _func.date(ReferralConversion.converted_at).label("day")
        r = await db.execute(
            _select(day_col, ReferralConversion.status, _func.count(ReferralConversion.id),
                    _func.coalesce(_func.sum(ReferralConversion.order_amount), 0))
            .where(
                ReferralConversion.partner_id.in_(pids),
                ReferralConversion.converted_at >= since,
            )
            .group_by(day_col, ReferralConversion.status)
            .order_by(day_col)
        )
        rows = [{"date": str(row[0]), "status": row[1], "count": int(row[2]), "amount": float(row[3])} for row in r.all()]
        return {"partner_ids": pids, "days": days, "since": since.isoformat(), "rows": rows}


@app.get("/api/v1/affiliate/debug/cafe24-order")
async def debug_cafe24_order(order_id: str):
    """특정 Cafe24 주문 raw payload 조회 (디버그용)."""
    from app.db.database import AsyncSessionLocal as _S
    from app.api.v1.endpoints.auth import get_shared_cafe24_user
    from app.services import cafe24 as cafe24_svc
    async with _S() as db:
        user = await get_shared_cafe24_user(db)
        if not user:
            return {"error": "no_cafe24_user"}
        try:
            data = await cafe24_svc.api_request(
                user, db, "GET", f"/api/v2/admin/orders/{order_id}",
                params={"embed": "items,coupons"},
            )
            return data
        except Exception as e:
            return {"error": str(e)}


@app.get("/api/v1/affiliate/debug/conversions")
async def debug_list_conversions():
    """모든 ReferralConversion 조회 (디버그용, 인증 없음)."""
    from sqlalchemy import select as _select, desc as _desc
    from app.db.database import AsyncSessionLocal as _S
    from app.models.affiliate import ReferralConversion, AffiliatePartner, AffiliateCampaign

    async with _S() as db:
        r = await db.execute(
            _select(ReferralConversion).order_by(_desc(ReferralConversion.id)).limit(100)
        )
        rows = r.scalars().all()
        result = []
        for c in rows:
            p_r = await db.execute(_select(AffiliatePartner).where(AffiliatePartner.id == c.partner_id))
            p = p_r.scalar_one_or_none()
            camp = None
            if c.campaign_id:
                c_r = await db.execute(_select(AffiliateCampaign).where(AffiliateCampaign.id == c.campaign_id))
                camp = c_r.scalar_one_or_none()
            result.append({
                "id": c.id,
                "cafe24_order_id": c.cafe24_order_id,
                "status": c.status,
                "order_amount": c.order_amount,
                "refunded_amount": c.refunded_amount,
                "commission_amount": c.commission_amount,
                "partner_id": c.partner_id,
                "partner_name": p.name if p else None,
                "partner_deleted": p.deleted_at.isoformat() if p and p.deleted_at else None,
                "campaign_id": c.campaign_id,
                "campaign_name": camp.name if camp else None,
                "converted_at": c.converted_at.isoformat() if c.converted_at else None,
            })
        return {"total": len(result), "conversions": result}


@app.post("/api/v1/affiliate/conversions/purge-all")
async def purge_all_conversions():
    """모든 ReferralConversion 삭제. nuclear 옵션 — 폴링이 다음 주기에 재구축."""
    from sqlalchemy import delete as _delete, select as _select, func as _func
    from app.db.database import AsyncSessionLocal as _S
    from app.models.affiliate import ReferralConversion

    async with _S() as db:
        count_r = await db.execute(_select(_func.count(ReferralConversion.id)))
        count = count_r.scalar() or 0
        await db.execute(_delete(ReferralConversion))
        await db.commit()
        return {"deleted": count, "message": "모든 전환 기록 초기화. 폴링이 재구축."}
