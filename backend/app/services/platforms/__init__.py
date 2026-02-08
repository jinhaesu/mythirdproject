"""Platform integration services."""
from app.services.platforms.base import BasePlatformService
from app.services.platforms.google_ads import GoogleAdsService
from app.services.platforms.naver_ads import NaverAdsService
from app.services.platforms.kakao_ads import KakaoAdsService

__all__ = [
    "BasePlatformService",
    "GoogleAdsService",
    "NaverAdsService",
    "KakaoAdsService",
]
