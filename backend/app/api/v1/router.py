"""API v1 router configuration."""
from fastapi import APIRouter

from app.api.v1.endpoints import (
    auth, benchmark, creative, campaign, analytics, dashboard, campaign_planner
)

api_router = APIRouter()

# Authentication
api_router.include_router(
    auth.router,
    prefix="/auth",
    tags=["Authentication"]
)

# TAB 1: Market Intelligence
api_router.include_router(
    benchmark.router,
    prefix="/benchmark",
    tags=["Market Intelligence"]
)

# TAB 2: Creative Studio
api_router.include_router(
    creative.router,
    prefix="/creative",
    tags=["Creative Studio"]
)

# TAB 3: Ads Controller
api_router.include_router(
    campaign.router,
    prefix="/campaign",
    tags=["Ads Controller"]
)

# Campaign Planner (구조설계, 타겟, 카피, UTM, CSV분석, 소재예측)
api_router.include_router(
    campaign_planner.router,
    prefix="/campaign-planner",
    tags=["Campaign Planner"]
)

# TAB 4: Performance Dashboard
api_router.include_router(
    analytics.router,
    prefix="/analytics",
    tags=["Performance Dashboard"]
)

# Dashboard & Revenue Analytics (Toryt)
api_router.include_router(
    dashboard.router,
    prefix="/dashboard",
    tags=["Dashboard & Revenue"]
)
