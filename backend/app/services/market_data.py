"""Real market data fetching from YouTube Data API, Naver API, and Instagram Graph API."""
import logging
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class MarketDataService:
    """Fetches real market data from YouTube, Naver, and Instagram APIs."""

    def __init__(self):
        self.youtube_key = settings.YOUTUBE_API_KEY
        self.naver_id = settings.NAVER_CLIENT_ID
        self.naver_secret = settings.NAVER_CLIENT_SECRET
        self.meta_token = settings.META_ACCESS_TOKEN

    @property
    def has_youtube(self) -> bool:
        return bool(self.youtube_key)

    @property
    def has_naver(self) -> bool:
        return bool(self.naver_id and self.naver_secret)

    @property
    def has_instagram(self) -> bool:
        return bool(self.meta_token)

    async def fetch_youtube_data(self, keyword: str) -> Optional[Dict[str, Any]]:
        """Fetch YouTube search results for a keyword."""
        if not self.has_youtube:
            return None

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                # Search for videos
                resp = await client.get(
                    "https://www.googleapis.com/youtube/v3/search",
                    params={
                        "part": "snippet",
                        "q": keyword,
                        "type": "video",
                        "maxResults": 20,
                        "order": "relevance",
                        "key": self.youtube_key,
                        "regionCode": "KR",
                        "relevanceLanguage": "ko",
                    },
                )
                resp.raise_for_status()
                search_data = resp.json()

                video_ids = [item["id"]["videoId"] for item in search_data.get("items", [])]
                total_results = search_data.get("pageInfo", {}).get("totalResults", 0)

                if not video_ids:
                    return {"content_count": total_results, "total_views": 0, "total_comments": 0}

                # Get video statistics
                stats_resp = await client.get(
                    "https://www.googleapis.com/youtube/v3/videos",
                    params={
                        "part": "statistics",
                        "id": ",".join(video_ids),
                        "key": self.youtube_key,
                    },
                )
                stats_resp.raise_for_status()
                stats_data = stats_resp.json()

                total_views = 0
                total_comments = 0
                for item in stats_data.get("items", []):
                    stats = item.get("statistics", {})
                    total_views += int(stats.get("viewCount", 0))
                    total_comments += int(stats.get("commentCount", 0))

                return {
                    "content_count": total_results,
                    "total_views": total_views,
                    "total_comments": total_comments,
                }
        except Exception as e:
            logger.warning(f"YouTube API error for '{keyword}': {e}")
            return None

    async def fetch_naver_data(self, keyword: str) -> Optional[Dict[str, Any]]:
        """Fetch Naver blog search results and DataLab trend for a keyword."""
        if not self.has_naver:
            return None

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                headers = {
                    "X-Naver-Client-Id": self.naver_id,
                    "X-Naver-Client-Secret": self.naver_secret,
                }

                # Blog search
                blog_resp = await client.get(
                    "https://openapi.naver.com/v1/search/blog.json",
                    params={"query": keyword, "display": 1, "sort": "sim"},
                    headers=headers,
                )
                blog_resp.raise_for_status()
                blog_data = blog_resp.json()
                blog_count = blog_data.get("total", 0)

                # DataLab search trend (last 30 days)
                end_date = datetime.utcnow().strftime("%Y-%m-%d")
                start_date = (datetime.utcnow() - timedelta(days=30)).strftime("%Y-%m-%d")

                trend_resp = await client.post(
                    "https://openapi.naver.com/v1/datalab/search",
                    headers=headers,
                    json={
                        "startDate": start_date,
                        "endDate": end_date,
                        "timeUnit": "date",
                        "keywordGroups": [
                            {"groupName": keyword, "keywords": [keyword]},
                        ],
                    },
                )

                daily_searches: List[Dict] = []
                search_volume = 0
                if trend_resp.status_code == 200:
                    trend_data = trend_resp.json()
                    results = trend_data.get("results", [])
                    if results:
                        data_points = results[0].get("data", [])
                        for dp in data_points:
                            daily_searches.append({
                                "date": dp["period"],
                                "ratio": dp["ratio"],
                            })
                        # Ratio is relative (0-100), estimate volume
                        search_volume = int(max(dp["ratio"] for dp in data_points) * 100) if data_points else 0

                return {
                    "blog_post_count": blog_count,
                    "search_query_volume": search_volume,
                    "daily_trend": daily_searches,
                }
        except Exception as e:
            logger.warning(f"Naver API error for '{keyword}': {e}")
            return None

    async def fetch_instagram_hashtag_data(self, keyword: str) -> Optional[Dict[str, Any]]:
        """Fetch Instagram hashtag data using Meta Graph API."""
        if not self.has_instagram:
            return None

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                # Search for hashtag ID
                search_resp = await client.get(
                    f"{settings.META_GRAPH_API_BASE}/{settings.META_API_VERSION}/ig_hashtag_search",
                    params={
                        "q": keyword,
                        "access_token": self.meta_token,
                    },
                )

                if search_resp.status_code != 200:
                    return None

                hashtag_data = search_resp.json()
                hashtags = hashtag_data.get("data", [])
                if not hashtags:
                    return None

                return {
                    "content_count": 0,
                    "total_views": 0,
                    "total_comments": 0,
                    "hashtag_id": hashtags[0].get("id"),
                }
        except Exception as e:
            logger.warning(f"Instagram API error for '{keyword}': {e}")
            return None

    async def fetch_all(self, keyword: str) -> Dict[str, Any]:
        """Fetch data from all available APIs and return combined result."""
        result = {
            "api_sources": [],
            "youtube": None,
            "instagram": None,
            "naver": None,
        }

        yt = await self.fetch_youtube_data(keyword)
        if yt:
            result["youtube"] = yt
            result["api_sources"].append("youtube")

        naver = await self.fetch_naver_data(keyword)
        if naver:
            result["naver"] = naver
            result["api_sources"].append("naver")

        ig = await self.fetch_instagram_hashtag_data(keyword)
        if ig:
            result["instagram"] = ig
            result["api_sources"].append("instagram")

        return result
