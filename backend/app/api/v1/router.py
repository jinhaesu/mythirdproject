"""API v1 router configuration."""
from fastapi import APIRouter

from app.api.v1.endpoints import (
    auth, benchmark, creative, campaign, analytics, dashboard, campaign_planner, chat, market_keywords,
    naver_analytics, naver_campaign, affiliate, partner_auth, partner_portal,
)
from app.api.v1.endpoints import cafe24, webhooks, insights

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

# Market Keywords (Keyword Monitoring)
api_router.include_router(
    market_keywords.router,
    prefix="/market",
    tags=["Market Keywords"]
)

# AI Command Center (Chat)
api_router.include_router(
    chat.router,
    prefix="/ai",
    tags=["AI Command Center"]
)

# Naver Advertising Analytics (검색광고 + GFA)
api_router.include_router(
    naver_analytics.router,
    prefix="/naver",
    tags=["Naver Advertising"]
)

# Naver Campaign Management (캠페인 위자드, 입찰가 최적화)
api_router.include_router(
    naver_campaign.router,
    prefix="/naver",
    tags=["Naver Campaign Management"]
)

# Affiliate Managing
api_router.include_router(
    affiliate.router,
    prefix="/affiliate",
    tags=["Affiliate Managing"]
)

# Cafe24 OAuth & Integration
api_router.include_router(
    cafe24.router,
    prefix="/cafe24",
    tags=["Cafe24"]
)

# Partner Portal Auth (매직링크 이메일 로그인)
api_router.include_router(
    partner_auth.router,
    prefix="/partner/auth",
    tags=["Partner Auth"],
)

# Partner Portal (내 정보, 대시보드, 캠페인 성과)
api_router.include_router(
    partner_portal.router,
    prefix="/partner",
    tags=["Partner Portal"],
)

# Webhooks (HMAC protected, no auth)
api_router.include_router(
    webhooks.router,
    prefix="/webhooks",
    tags=["Webhooks"]
)

# Meta 인사이트 스냅샷 + 온디맨드 하이브리드
api_router.include_router(
    insights.router,
    prefix="/insights",
    tags=["Meta Insights"]
)
