"""Naver GFA (성과형 디스플레이 광고) API client.

Full CRUD for campaigns, adgroups, creatives, audiences.
Performance reporting with daily/weekly breakdown.
Auth: HMAC-SHA256 signature (same pattern as Search Ads).
All monetary values in KRW.

Placements: 네이버 메인, 밴드, 카페, 블로그, 뉴스, 웹툰, 스포츠 등
"""
import hashlib
import hmac
import logging
import time
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)


class NaverGFAAPI:
    """Naver GFA (성과형 디스플레이 광고 / Display Ad) API client.

    Async, httpx-based. Covers:
    - Campaign, AdGroup, Creative CRUD
    - Performance stats & reporting
    - Audience management (custom + lookalike)
    - Placement management
    - Budget management
    """

    BASE_URL = "https://api.naver.com/displayad/v3"

    # Available placements (게재 위치)
    PLACEMENTS = [
        "NAVER_MAIN",           # 네이버 메인
        "NAVER_BAND",           # 밴드
        "NAVER_CAFE",           # 네이버 카페
        "NAVER_BLOG",           # 네이버 블로그
        "NAVER_NEWS",           # 네이버 뉴스
        "NAVER_WEBTOON",        # 네이버 웹툰
        "NAVER_SPORTS",         # 네이버 스포츠
        "NAVER_ENTERTAINMENT",  # 네이버 연예
        "NAVER_SHOPPING",       # 네이버 쇼핑
        "NAVER_VIBE",           # 네이버 바이브
        "NAVER_SERIES",         # 네이버 시리즈
        "SMART_CHANNEL",        # 스마트채널
    ]

    def __init__(
        self,
        api_key: str,
        secret_key: str,
        customer_id: str,
    ) -> None:
        self.api_key = api_key
        self.secret_key = secret_key
        self.customer_id = str(customer_id)

    # ─── Auth helpers ────────────────────────────────────────────

    def _generate_signature(self, timestamp: str, method: str, path: str) -> str:
        """Generate HMAC-SHA256 signature for GFA API."""
        message = f"{timestamp}.{method}.{path}"
        signature = hmac.new(
            self.secret_key.encode("utf-8"),
            message.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return signature

    def _build_headers(self, method: str, path: str) -> Dict[str, str]:
        """Build authenticated request headers."""
        timestamp = str(int(time.time() * 1000))
        signature = self._generate_signature(timestamp, method, path)
        return {
            "X-API-KEY": self.api_key,
            "X-Customer": self.customer_id,
            "X-Timestamp": timestamp,
            "X-Signature": signature,
            "Content-Type": "application/json",
        }

    # ─── Base HTTP request ───────────────────────────────────────

    async def _request(
        self,
        method: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        data: Optional[Any] = None,
    ) -> Any:
        """Execute an authenticated request against the GFA API."""
        url = f"{self.BASE_URL}{path}"
        headers = self._build_headers(method.upper(), path)

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.request(
                method=method.upper(),
                url=url,
                headers=headers,
                params=params,
                json=data,
            )

        if response.status_code >= 400:
            logger.error(
                "Naver GFA API error: %s %s -> %s %s",
                method, path, response.status_code, response.text,
            )
            response.raise_for_status()

        if response.status_code == 204 or not response.text:
            return None
        return response.json()

    # ─── Campaign CRUD ───────────────────────────────────────────

    async def get_campaigns(self) -> List[Dict[str, Any]]:
        """GET /campaigns - GFA 캠페인 목록 조회."""
        result = await self._request("GET", "/campaigns")
        return result if isinstance(result, list) else []

    async def get_campaign(self, campaign_id: str) -> Dict[str, Any]:
        """GET /campaigns/{id} - 단일 캠페인 조회."""
        return await self._request("GET", f"/campaigns/{campaign_id}")

    async def create_campaign(
        self,
        name: str,
        objective: str,
        daily_budget: int,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        status: str = "PAUSED",
    ) -> Dict[str, Any]:
        """POST /campaigns - GFA 캠페인 생성.

        Args:
            name: 캠페인 이름
            objective: TRAFFIC | CONVERSION | VIDEO_VIEWS | REACH | APP_INSTALL
            daily_budget: 일 예산 (KRW)
            start_date: YYYY-MM-DD
            end_date: YYYY-MM-DD (null = 종료일 없음)
            status: ACTIVE | PAUSED
        """
        payload: Dict[str, Any] = {
            "name": name,
            "objective": objective,
            "dailyBudget": daily_budget,
            "status": status,
        }
        if start_date:
            payload["startDate"] = start_date
        if end_date:
            payload["endDate"] = end_date
        return await self._request("POST", "/campaigns", data=payload)

    async def update_campaign(
        self,
        campaign_id: str,
        fields: Dict[str, Any],
    ) -> Dict[str, Any]:
        """PUT /campaigns/{id} - GFA 캠페인 수정."""
        return await self._request("PUT", f"/campaigns/{campaign_id}", data=fields)

    async def delete_campaign(self, campaign_id: str) -> None:
        """DELETE /campaigns/{id} - GFA 캠페인 삭제."""
        await self._request("DELETE", f"/campaigns/{campaign_id}")

    # ─── AdGroup CRUD ────────────────────────────────────────────

    async def get_adgroups(
        self,
        campaign_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """GET /adgroups - 광고그룹 목록 조회."""
        params = {}
        if campaign_id:
            params["campaignId"] = campaign_id
        result = await self._request("GET", "/adgroups", params=params)
        return result if isinstance(result, list) else []

    async def get_adgroup(self, adgroup_id: str) -> Dict[str, Any]:
        """GET /adgroups/{id} - 단일 광고그룹 조회."""
        return await self._request("GET", f"/adgroups/{adgroup_id}")

    async def create_adgroup(
        self,
        campaign_id: str,
        name: str,
        bid_strategy: str = "MANUAL_CPC",
        bid_amount: Optional[int] = None,
        daily_budget: Optional[int] = None,
        targeting: Optional[Dict[str, Any]] = None,
        placements: Optional[List[str]] = None,
        schedule: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """POST /adgroups - GFA 광고그룹 생성.

        Args:
            campaign_id: 상위 캠페인 ID
            name: 광고그룹 이름
            bid_strategy: MANUAL_CPC | MANUAL_CPM | AUTO_BID | TARGET_CPA
            bid_amount: 입찰가 (KRW)
            daily_budget: 일 예산 (KRW)
            targeting: 타겟팅 설정
                {
                    "demographics": {"gender": "ALL|MALE|FEMALE", "ageRange": [20, 59]},
                    "interests": ["패션", "뷰티", "여행", ...],
                    "locations": ["서울", "경기", ...],
                    "devices": ["MOBILE", "PC", "ALL"],
                }
            placements: 게재위치 목록 (see PLACEMENTS constant)
            schedule: 노출 스케줄 {"days": ["MON","TUE",...], "hours": [9,10,...]}
        """
        payload: Dict[str, Any] = {
            "campaignId": campaign_id,
            "name": name,
            "bidStrategy": bid_strategy,
        }
        if bid_amount is not None:
            payload["bidAmount"] = bid_amount
        if daily_budget is not None:
            payload["dailyBudget"] = daily_budget
        if targeting:
            payload["targeting"] = targeting
        if placements:
            payload["placements"] = placements
        if schedule:
            payload["schedule"] = schedule
        return await self._request("POST", "/adgroups", data=payload)

    async def update_adgroup(
        self,
        adgroup_id: str,
        fields: Dict[str, Any],
    ) -> Dict[str, Any]:
        """PUT /adgroups/{id} - GFA 광고그룹 수정."""
        return await self._request("PUT", f"/adgroups/{adgroup_id}", data=fields)

    async def delete_adgroup(self, adgroup_id: str) -> None:
        """DELETE /adgroups/{id} - GFA 광고그룹 삭제."""
        await self._request("DELETE", f"/adgroups/{adgroup_id}")

    # ─── Creative CRUD ───────────────────────────────────────────

    async def get_creatives(
        self,
        adgroup_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """GET /creatives - 소재 목록 조회."""
        params = {}
        if adgroup_id:
            params["adgroupId"] = adgroup_id
        result = await self._request("GET", "/creatives", params=params)
        return result if isinstance(result, list) else []

    async def get_creative(self, creative_id: str) -> Dict[str, Any]:
        """GET /creatives/{id} - 단일 소재 조회."""
        return await self._request("GET", f"/creatives/{creative_id}")

    async def create_creative(
        self,
        adgroup_id: str,
        creative_type: str,
        title: str,
        description: Optional[str] = None,
        image_url: Optional[str] = None,
        video_url: Optional[str] = None,
        landing_url: Optional[str] = None,
        call_to_action: str = "LEARN_MORE",
        extra: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """POST /creatives - GFA 소재 생성.

        Args:
            adgroup_id: 상위 광고그룹 ID
            creative_type: IMAGE | VIDEO | CAROUSEL | NATIVE
            title: 소재 제목
            description: 소재 설명
            image_url: 이미지 URL (IMAGE, CAROUSEL 타입)
            video_url: 동영상 URL (VIDEO 타입)
            landing_url: 랜딩 URL
            call_to_action: LEARN_MORE | SHOP_NOW | SIGN_UP | DOWNLOAD | ...
            extra: 추가 속성 (carousel items 등)
        """
        payload: Dict[str, Any] = {
            "adgroupId": adgroup_id,
            "creativeType": creative_type,
            "title": title,
            "callToAction": call_to_action,
        }
        if description:
            payload["description"] = description
        if image_url:
            payload["imageUrl"] = image_url
        if video_url:
            payload["videoUrl"] = video_url
        if landing_url:
            payload["landingUrl"] = landing_url
        if extra:
            payload.update(extra)
        return await self._request("POST", "/creatives", data=payload)

    async def update_creative(
        self,
        creative_id: str,
        fields: Dict[str, Any],
    ) -> Dict[str, Any]:
        """PUT /creatives/{id} - GFA 소재 수정."""
        return await self._request("PUT", f"/creatives/{creative_id}", data=fields)

    async def delete_creative(self, creative_id: str) -> None:
        """DELETE /creatives/{id} - GFA 소재 삭제."""
        await self._request("DELETE", f"/creatives/{creative_id}")

    # ─── Performance Stats ───────────────────────────────────────

    async def get_performance_report(
        self,
        campaign_ids: Optional[List[str]] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        time_increment: str = "DAILY",
        metrics: Optional[List[str]] = None,
        dimensions: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """GET /stats/report - GFA 성과 리포트 조회.

        Args:
            campaign_ids: 조회할 캠페인 ID 목록 (빈 경우 전체)
            start_date: YYYY-MM-DD
            end_date: YYYY-MM-DD
            time_increment: DAILY | WEEKLY | MONTHLY | TOTAL
            metrics: 조회할 지표
                     impressions, clicks, spend, conversions,
                     revenue, ctr, cpc, cpm, roas, videoViews, reach
            dimensions: 분석 차원
                        campaign, adgroup, creative, placement, device, age, gender
        """
        params: Dict[str, Any] = {
            "timeIncrement": time_increment,
        }
        if campaign_ids:
            params["campaignIds"] = ",".join(campaign_ids)
        if start_date:
            params["startDate"] = start_date
        if end_date:
            params["endDate"] = end_date
        if metrics:
            params["metrics"] = ",".join(metrics)
        if dimensions:
            params["dimensions"] = ",".join(dimensions)

        result = await self._request("GET", "/stats/report", params=params)
        if isinstance(result, dict):
            return result.get("data", [])
        return result if isinstance(result, list) else []

    async def get_campaign_stats(
        self,
        campaign_id: str,
        start_date: str,
        end_date: str,
    ) -> Dict[str, Any]:
        """Get performance stats for a single campaign."""
        report = await self.get_performance_report(
            campaign_ids=[campaign_id],
            start_date=start_date,
            end_date=end_date,
            time_increment="TOTAL",
        )
        return report[0] if report else {}

    # ─── Audience Management ─────────────────────────────────────

    async def get_audiences(self) -> List[Dict[str, Any]]:
        """GET /audiences - 맞춤 타겟 목록 조회."""
        result = await self._request("GET", "/audiences")
        return result if isinstance(result, list) else []

    async def get_audience(self, audience_id: str) -> Dict[str, Any]:
        """GET /audiences/{id} - 단일 맞춤 타겟 조회."""
        return await self._request("GET", f"/audiences/{audience_id}")

    async def create_custom_audience(
        self,
        name: str,
        audience_type: str,
        source: Optional[Dict[str, Any]] = None,
        description: Optional[str] = None,
    ) -> Dict[str, Any]:
        """POST /audiences - 맞춤 타겟 생성.

        Args:
            name: 타겟 이름
            audience_type: WEBSITE_VISITOR | APP_USER | CUSTOMER_LIST | ENGAGEMENT
            source: 소스 설정
                    WEBSITE_VISITOR: {"pixelId": "...", "retentionDays": 30}
                    CUSTOMER_LIST: {"fileUrl": "..."} or uploaded separately
                    ENGAGEMENT: {"eventType": "VIDEO_VIEW", "campaignId": "..."}
            description: 설명
        """
        payload: Dict[str, Any] = {
            "name": name,
            "audienceType": audience_type,
        }
        if source:
            payload["source"] = source
        if description:
            payload["description"] = description
        return await self._request("POST", "/audiences", data=payload)

    async def create_lookalike_audience(
        self,
        name: str,
        source_audience_id: str,
        similarity: int = 5,
        description: Optional[str] = None,
    ) -> Dict[str, Any]:
        """POST /audiences/lookalike - 유사 타겟 생성.

        Args:
            name: 유사 타겟 이름
            source_audience_id: 원본 맞춤 타겟 ID
            similarity: 유사도 (1-10, 1=가장 유사)
            description: 설명
        """
        payload: Dict[str, Any] = {
            "name": name,
            "sourceAudienceId": source_audience_id,
            "similarity": similarity,
        }
        if description:
            payload["description"] = description
        return await self._request("POST", "/audiences/lookalike", data=payload)

    async def update_audience(
        self,
        audience_id: str,
        fields: Dict[str, Any],
    ) -> Dict[str, Any]:
        """PUT /audiences/{id} - 맞춤 타겟 수정."""
        return await self._request("PUT", f"/audiences/{audience_id}", data=fields)

    async def delete_audience(self, audience_id: str) -> None:
        """DELETE /audiences/{id} - 맞춤 타겟 삭제."""
        await self._request("DELETE", f"/audiences/{audience_id}")

    # ─── Placement helpers ───────────────────────────────────────

    async def get_available_placements(self) -> List[Dict[str, Any]]:
        """GET /placements - 사용 가능한 게재위치 목록."""
        result = await self._request("GET", "/placements")
        return result if isinstance(result, list) else []

    # ─── Budget Management ───────────────────────────────────────

    async def update_campaign_budget(
        self,
        campaign_id: str,
        daily_budget: int,
    ) -> Dict[str, Any]:
        """Update campaign daily budget (convenience wrapper)."""
        return await self.update_campaign(campaign_id, {"dailyBudget": daily_budget})

    async def update_adgroup_budget(
        self,
        adgroup_id: str,
        daily_budget: int,
    ) -> Dict[str, Any]:
        """Update adgroup daily budget (convenience wrapper)."""
        return await self.update_adgroup(adgroup_id, {"dailyBudget": daily_budget})

    async def update_adgroup_bid(
        self,
        adgroup_id: str,
        bid_amount: int,
    ) -> Dict[str, Any]:
        """Update adgroup bid amount (convenience wrapper)."""
        return await self.update_adgroup(adgroup_id, {"bidAmount": bid_amount})

    # ─── Account helpers ─────────────────────────────────────────

    async def get_account_info(self) -> Dict[str, Any]:
        """GET /account - 광고주 계정 정보."""
        return await self._request("GET", "/account")

    async def pause_campaign(self, campaign_id: str) -> Dict[str, Any]:
        """Pause a campaign."""
        return await self.update_campaign(campaign_id, {"status": "PAUSED"})

    async def enable_campaign(self, campaign_id: str) -> Dict[str, Any]:
        """Enable (activate) a campaign."""
        return await self.update_campaign(campaign_id, {"status": "ACTIVE"})
