"""API v1 router configuration."""
from fastapi import APIRouter

from app.api.v1.endpoints import (
    auth, benchmark, creative, campaign, analytics, dashboard, campaign_planner, chat, market_keywords,
    naver_analytics, naver_campaign, affiliate, partner_auth, partner_portal,
)
from app.api.v1.endpoints import cafe24, webhooks, insights, kpi, influencer, sponsorship
from app.api.v1.endpoints import naver_insights
from app.api.v1.endpoints import activities, home

api_router = APIRouter()

# 홈 브리핑 (통합 대시보드)
api_router.include_router(
    home.router,
    prefix="/home",
    tags=["Home"]
)

# 마케팅 활동 기록 (콘텐츠/인플루언서/체험단/서포터즈)
api_router.include_router(
    activities.router,
    prefix="/activities",
    tags=["Marketing Activities"]
)

# 공구 보드 (어필리에이트 캠페인 묶음 + 일정/목표)
from app.api.v1.endpoints import groupbuys  # noqa: E402
api_router.include_router(
    groupbuys.router,
    prefix="/groupbuys",
    tags=["Group Buys"]
)

# 광고비 일보 (매체별 일별 광고비 기입/예산/자동연동)
from app.api.v1.endpoints import adspend  # noqa: E402
api_router.include_router(
    adspend.router,
    prefix="/adspend",
    tags=["Ad Spend Daily"]
)

# Authentication
api_router.include_router(
    auth.router,
    prefix="/auth",
    tags=["Authentication"]
)

# ── 2026-09 개편에서 언마운트된 죽은 기능 라우터 ─────────────────────────────
# 벤치마크(/benchmark)·소재 스튜디오(/creative)·Meta 캠페인 발행(/campaign)·
# 캠페인 플래너(/campaign-planner)·수익 대시보드(/dashboard)는 3월 이후 미사용
# (DB 실측: campaigns 12건·creatives 65건 3월 말 마지막, platform_connections 0건)
# + 프론트 진입점 제거됨. 코드는 보존 — 다시 쓰려면 아래 include_router 복원.
# api_router.include_router(benchmark.router, prefix="/benchmark", tags=["Market Intelligence"])
# api_router.include_router(creative.router, prefix="/creative", tags=["Creative Studio"])
# api_router.include_router(campaign.router, prefix="/campaign", tags=["Ads Controller"])
# api_router.include_router(campaign_planner.router, prefix="/campaign-planner", tags=["Campaign Planner"])
# api_router.include_router(dashboard.router, prefix="/dashboard", tags=["Dashboard & Revenue"])

# TAB 4: Performance Dashboard
api_router.include_router(
    analytics.router,
    prefix="/analytics",
    tags=["Performance Dashboard"]
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

# Marketing KPI (몰 전체 주문 + 채널 광고비 + CAC/LTV)
api_router.include_router(
    kpi.router,
    prefix="/kpi",
    tags=["Marketing KPI"]
)

# Influencer Seeding (시딩 비용/대상 기록 + AI 타겟 고객층 분석)
api_router.include_router(
    influencer.router,
    prefix="/influencer",
    tags=["Influencer Seeding"]
)

# Sponsorship (대학축제/동아리/마라톤/학회 등 행사 제품 협찬 기록·집계)
api_router.include_router(
    sponsorship.router,
    prefix="/sponsorship",
    tags=["Sponsorship"]
)

# Naver Insights (API HUB — 검색어트렌드/쇼핑인사이트/언급량/감성 마인드맵)
api_router.include_router(
    naver_insights.router,
    prefix="/naver-insights",
    tags=["Naver Insights"]
)
