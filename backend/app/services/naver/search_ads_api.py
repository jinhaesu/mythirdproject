"""Naver Search Ads API comprehensive client.

Full CRUD for campaigns, adgroups, keywords, ads.
Stats, bid estimation, quality index, business channels.
Auth: HMAC-SHA256 signature with API_KEY, SECRET_KEY, CUSTOMER_ID.
All monetary values in KRW.

Docs: https://naver.github.io/searchad-apidoc/
"""
import base64
import hashlib
import hmac
import json
import logging
import time
from datetime import date
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)


class NaverSearchAdsAPI:
    """Naver Search Ads API client (async, httpx-based).

    Campaign types (campaign_tp):
      - WEB_SITE    : 파워링크
      - SHOPPING    : 쇼핑검색
      - BRAND_SEARCH: 브랜드검색
      - PERFORMANCE_MAX: 성과최대화
    """

    BASE_URL = "https://api.searchad.naver.com"

    # Stat field constants (viewCnt/reachCnt are NOT supported for campaign stats)
    STAT_FIELDS = [
        "impCnt",       # 노출수
        "clkCnt",       # 클릭수
        "salesAmt",     # 총비용(KRW)
        "ctr",          # 클릭률
        "cpc",          # 클릭당비용
        "ccnt",         # 전환수
        "convAmt",      # 전환매출액
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
        """Generate HMAC-SHA256 signature for Naver Search Ads API.

        Official: https://github.com/naver/searchad-apidoc/blob/master/python-sample/examples/signaturehelper.py
        Signature = Base64(HMAC-SHA256(secret_key.encode("utf-8"), "{timestamp}.{method}.{path}"))
        """
        message = f"{timestamp}.{method}.{path}"
        signature = hmac.new(
            bytes(self.secret_key, "utf-8"),
            bytes(message, "utf-8"),
            hashlib.sha256,
        )
        return base64.b64encode(signature.digest()).decode("utf-8")

    def _build_headers(self, method: str, path: str) -> Dict[str, str]:
        """Build request headers including timestamp and signature."""
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
        data: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """Execute an authenticated request against the Naver Search Ads API.

        Returns parsed JSON on success, raises on HTTP or API errors.
        """
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
                "Naver Search Ads API error: %s %s -> %s %s",
                method, path, response.status_code, response.text,
            )
            response.raise_for_status()

        # Some endpoints return empty body on success (e.g. DELETE)
        if response.status_code == 204 or not response.text:
            return None
        return response.json()

    # ─── Campaign CRUD ───────────────────────────────────────────

    async def get_campaigns(self) -> List[Dict[str, Any]]:
        """GET /ncc/campaigns - 전체 캠페인 목록 조회."""
        result = await self._request("GET", "/ncc/campaigns")
        return result if isinstance(result, list) else []

    async def get_campaign(self, campaign_id: str) -> Dict[str, Any]:
        """GET /ncc/campaigns/{campaignId} - 단일 캠페인 조회."""
        return await self._request("GET", f"/ncc/campaigns/{campaign_id}")

    async def create_campaign(
        self,
        name: str,
        campaign_tp: str,
        daily_budget: int,
        user_lock: bool = False,
        delivery_method: str = "STANDARD",
        track_id: Optional[str] = None,
        custom_config: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """POST /ncc/campaigns - 캠페인 생성.

        Args:
            name: 캠페인 이름
            campaign_tp: WEB_SITE | SHOPPING | BRAND_SEARCH | PERFORMANCE_MAX
            daily_budget: 일 예산 (KRW)
            user_lock: 수동 중지 여부
            delivery_method: STANDARD | ACCELERATED
            track_id: 추적 ID
            custom_config: 추가 설정
        """
        payload: Dict[str, Any] = {
            "name": name,
            "campaignTp": campaign_tp,
            "customerId": self.customer_id,
            "dailyBudget": daily_budget,
            "userLock": user_lock,
            "deliveryMethod": delivery_method,
        }
        if track_id:
            payload["trackId"] = track_id
        if custom_config:
            payload["customConfig"] = custom_config
        return await self._request("POST", "/ncc/campaigns", data=payload)

    async def update_campaign(
        self,
        campaign_id: str,
        fields: Dict[str, Any],
    ) -> Dict[str, Any]:
        """PUT /ncc/campaigns/{campaignId} - 캠페인 수정.

        fields may include: name, dailyBudget, userLock, deliveryMethod, etc.
        """
        fields["nccCampaignId"] = campaign_id
        return await self._request("PUT", f"/ncc/campaigns/{campaign_id}", data=fields)

    # ─── AdGroup CRUD ────────────────────────────────────────────

    async def get_adgroups(
        self,
        campaign_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """GET /ncc/adgroups - 광고그룹 목록 조회.

        campaign_id를 지정하면 해당 캠페인의 광고그룹만 반환.
        """
        params = {}
        if campaign_id:
            params["nccCampaignId"] = campaign_id
        result = await self._request("GET", "/ncc/adgroups", params=params)
        return result if isinstance(result, list) else []

    async def get_adgroup(self, adgroup_id: str) -> Dict[str, Any]:
        """GET /ncc/adgroups/{adgroupId} - 단일 광고그룹 조회."""
        return await self._request("GET", f"/ncc/adgroups/{adgroup_id}")

    async def create_adgroup(
        self,
        campaign_id: str,
        name: str,
        targets: Optional[Dict[str, Any]] = None,
        bid_amt: int = 70,
        budget: Optional[int] = None,
        contentsNetworkBidAmt: Optional[int] = None,
        use_daily_budget: bool = False,
        daily_budget: Optional[int] = None,
        target_summary: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """POST /ncc/adgroups - 광고그룹 생성.

        Args:
            campaign_id: 상위 캠페인 ID
            name: 광고그룹 이름
            targets: 타겟팅 설정 (지역, 시간대 등)
            bid_amt: 기본 입찰가 (KRW, 최소 70원)
            budget: 예산
            contentsNetworkBidAmt: 콘텐츠 네트워크 입찰가
            use_daily_budget: 일 예산 사용 여부
            daily_budget: 일 예산 (KRW)
            target_summary: 타겟 요약 정보
        """
        payload: Dict[str, Any] = {
            "nccCampaignId": campaign_id,
            "name": name,
            "bidAmt": bid_amt,
        }
        if targets:
            payload["targets"] = targets
        if budget is not None:
            payload["budget"] = budget
        if contentsNetworkBidAmt is not None:
            payload["contentsNetworkBidAmt"] = contentsNetworkBidAmt
        if use_daily_budget:
            payload["useDailyBudget"] = use_daily_budget
            if daily_budget is not None:
                payload["dailyBudget"] = daily_budget
        if target_summary:
            payload["targetSummary"] = target_summary
        return await self._request("POST", "/ncc/adgroups", data=payload)

    async def update_adgroup(
        self,
        adgroup_id: str,
        fields: Dict[str, Any],
    ) -> Dict[str, Any]:
        """PUT /ncc/adgroups/{adgroupId} - 광고그룹 수정."""
        fields["nccAdgroupId"] = adgroup_id
        return await self._request("PUT", f"/ncc/adgroups/{adgroup_id}", data=fields)

    # ─── Keyword CRUD ────────────────────────────────────────────

    async def get_keywords(self, adgroup_id: str) -> List[Dict[str, Any]]:
        """GET /ncc/keywords?nccAdgroupId= - 키워드 목록 조회."""
        params = {"nccAdgroupId": adgroup_id}
        result = await self._request("GET", "/ncc/keywords", params=params)
        return result if isinstance(result, list) else []

    async def create_keywords(
        self,
        adgroup_id: str,
        keywords: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """POST /ncc/keywords - 키워드 추가.

        keywords: [{"keyword": "검색어", "bidAmt": 100, "useGroupBidAmt": False}, ...]
        """
        payload = []
        for kw in keywords:
            entry: Dict[str, Any] = {
                "nccAdgroupId": adgroup_id,
                "keyword": kw["keyword"],
            }
            if "bidAmt" in kw:
                entry["bidAmt"] = kw["bidAmt"]
            if "useGroupBidAmt" in kw:
                entry["useGroupBidAmt"] = kw["useGroupBidAmt"]
            payload.append(entry)
        result = await self._request("POST", "/ncc/keywords", data=payload)
        return result if isinstance(result, list) else [result] if result else []

    async def update_keyword(
        self,
        keyword_id: str,
        fields: Dict[str, Any],
    ) -> Dict[str, Any]:
        """PUT /ncc/keywords/{keywordId} - 키워드 수정 (입찰가 변경 등)."""
        fields["nccKeywordId"] = keyword_id
        return await self._request("PUT", f"/ncc/keywords/{keyword_id}", data=fields)

    # ─── Ad (소재) CRUD ──────────────────────────────────────────

    async def get_ads(self, adgroup_id: str) -> List[Dict[str, Any]]:
        """GET /ncc/ads?nccAdgroupId= - 광고 소재 목록 조회."""
        params = {"nccAdgroupId": adgroup_id}
        result = await self._request("GET", "/ncc/ads", params=params)
        return result if isinstance(result, list) else []

    async def create_ad(
        self,
        adgroup_id: str,
        ad_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """POST /ncc/ads - 광고 소재 생성.

        ad_data should include: type, pc/mobile subject/description, etc.
        Example:
            {
                "type": "TEXT_45",
                "pc": {"subject": "제목", "description": "설명"},
                "mobile": {"subject": "모바일제목", "description": "모바일설명"},
                "nccAdgroupId": "<id>",
            }
        """
        ad_data["nccAdgroupId"] = adgroup_id
        return await self._request("POST", "/ncc/ads", data=ad_data)

    async def update_ad(
        self,
        ad_id: str,
        fields: Dict[str, Any],
    ) -> Dict[str, Any]:
        """PUT /ncc/ads/{adId} - 광고 소재 수정."""
        fields["nccAdId"] = ad_id
        return await self._request("PUT", f"/ncc/ads/{ad_id}", data=fields)

    # ─── Stats / Reporting ───────────────────────────────────────

    async def get_stat_report(
        self,
        ids: List[str],
        fields: Optional[List[str]] = None,
        date_preset: str = "custom",
        time_increment: str = "allDays",
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        breakdown: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """GET /stats - 성과 리포트 조회.

        Args:
            ids: 통계 대상 ID 목록 (campaign, adgroup, keyword, ad IDs)
            fields: 조회할 필드 목록. Default: all STAT_FIELDS.
                    Available: impCnt, clkCnt, salesAmt, ctr, cpc, ccnt,
                               convAmt, viewCnt, reachCnt
            date_preset: today, yesterday, last_7_days, last_14_days,
                         last_30_days, this_month, last_month, custom
            time_increment: allDays | 1 (daily) | 7 (weekly) | month
            start_date: YYYY-MM-DD (required when date_preset=custom)
            end_date: YYYY-MM-DD (required when date_preset=custom)
            breakdown: Optional dimension breakdown (e.g. "hh" for hourly)
        """
        if fields is None:
            fields = self.STAT_FIELDS

        params: Dict[str, Any] = {
            "id": ",".join(ids) if isinstance(ids, list) else ids,
            "fields": json.dumps(fields),
            "datePreset": date_preset,
            "timeIncrement": time_increment,
        }

        if date_preset == "custom":
            if start_date and end_date:
                params["timeRange"] = (
                    f'{{"since":"{start_date}","until":"{end_date}"}}'
                )

        if breakdown:
            params["breakdown"] = breakdown

        result = await self._request("GET", "/stats", params=params)
        if isinstance(result, dict):
            return result.get("data", [])
        return result if isinstance(result, list) else []

    # ─── Keyword Tool (검색량 조회) ─────────────────────────────

    async def get_keyword_search_volume(
        self,
        keywords: List[str],
    ) -> List[Dict[str, Any]]:
        """GET /keywordstool - 키워드 월간 검색량 조회.

        Returns monthlyPcQcCnt, monthlyMobileQcCnt for each keyword.
        These are absolute monthly search volumes.
        """
        params = {
            "hintKeywords": ",".join(keywords),
            "showDetail": "1",
        }
        result = await self._request("GET", "/keywordstool", params=params)
        if isinstance(result, dict):
            return result.get("keywordList", [])
        return result if isinstance(result, list) else []

    # ─── Bid Estimation ──────────────────────────────────────────

    async def get_estimate(
        self,
        keywords: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """POST /keywordstool/estimates - 키워드 입찰가 추정.

        keywords: [{"keyword": "검색어", "device": "PC"}, ...]
        device: PC | MOBILE
        """
        payload = {"keywords": keywords}
        result = await self._request("POST", "/keywordstool/estimates", data=payload)
        if isinstance(result, dict):
            return result.get("estimate", [])
        return result if isinstance(result, list) else []

    # ─── Business Channel ────────────────────────────────────────

    async def get_business_channel(self) -> List[Dict[str, Any]]:
        """GET /ncc/channels - 비즈채널 목록 조회."""
        result = await self._request("GET", "/ncc/channels")
        return result if isinstance(result, list) else []

    # ─── Quality Index ───────────────────────────────────────────

    async def get_quality_index(
        self,
        keyword_ids: List[str],
    ) -> List[Dict[str, Any]]:
        """GET /ncc/keywords quality index for given keyword IDs.

        Fetches keywords by ID and returns quality-index-related data.
        """
        results = []
        for kid in keyword_ids:
            try:
                kw_data = await self._request("GET", f"/ncc/keywords/{kid}")
                if kw_data:
                    results.append({
                        "keywordId": kid,
                        "keyword": kw_data.get("keyword"),
                        "qualityIndex": kw_data.get("qualityIndex"),
                        "bidAmt": kw_data.get("bidAmt"),
                        "status": kw_data.get("status"),
                    })
            except Exception as e:
                logger.warning("Failed to get quality index for keyword %s: %s", kid, e)
                results.append({"keywordId": kid, "error": str(e)})
        return results

    # ─── Helpers ─────────────────────────────────────────────────

    async def get_account_info(self) -> Dict[str, Any]:
        """GET /ncc/customers - 광고주 계정 정보."""
        return await self._request("GET", "/ncc/customers")

    async def get_campaign_ids(self) -> List[str]:
        """Return list of all campaign IDs for the account."""
        campaigns = await self.get_campaigns()
        return [c["nccCampaignId"] for c in campaigns if "nccCampaignId" in c]

    async def pause_campaign(self, campaign_id: str) -> Dict[str, Any]:
        """Pause a campaign by setting userLock=True."""
        return await self.update_campaign(campaign_id, {"userLock": True})

    async def enable_campaign(self, campaign_id: str) -> Dict[str, Any]:
        """Enable a campaign by setting userLock=False."""
        return await self.update_campaign(campaign_id, {"userLock": False})

    async def update_keyword_bid(
        self,
        keyword_id: str,
        bid_amt: int,
    ) -> Dict[str, Any]:
        """Update keyword bid amount (convenience wrapper)."""
        return await self.update_keyword(keyword_id, {
            "bidAmt": bid_amt,
            "useGroupBidAmt": False,
        })
