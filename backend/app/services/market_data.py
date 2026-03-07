"""Real market data fetching from YouTube Data API, Naver API, and Instagram Graph API."""
import logging
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class MarketDataService:
    """Fetches real market data from YouTube, Naver, and Instagram APIs."""

    def __init__(self):
        settings = get_settings()
        self.youtube_key = settings.YOUTUBE_API_KEY
        self.naver_id = settings.NAVER_CLIENT_ID
        self.naver_secret = settings.NAVER_CLIENT_SECRET
        self.meta_token = settings.META_ACCESS_TOKEN
        self.meta_graph_base = settings.META_GRAPH_API_BASE
        self.meta_api_version = settings.META_API_VERSION
        logger.info(f"MarketDataService init: youtube={'YES' if self.youtube_key else 'NO'}, naver={'YES' if self.naver_id else 'NO'}, instagram={'YES' if self.meta_token else 'NO'}")

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
                if resp.status_code != 200:
                    logger.warning(f"YouTube search API error: {resp.status_code} {resp.text[:200]}")
                    return None
                search_data = resp.json()

                video_ids = [item["id"]["videoId"] for item in search_data.get("items", []) if item.get("id", {}).get("videoId")]
                total_results = search_data.get("pageInfo", {}).get("totalResults", 0)

                if not video_ids:
                    return {"content_count": total_results, "total_views": 0, "total_comments": 0, "tags": []}

                # Get video statistics + snippet (for tags)
                stats_resp = await client.get(
                    "https://www.googleapis.com/youtube/v3/videos",
                    params={
                        "part": "statistics,snippet",
                        "id": ",".join(video_ids),
                        "key": self.youtube_key,
                    },
                )
                if stats_resp.status_code != 200:
                    logger.warning(f"YouTube videos API error: {stats_resp.status_code}")
                    return {"content_count": total_results, "total_views": 0, "total_comments": 0, "tags": []}
                stats_data = stats_resp.json()

                total_views = 0
                total_comments = 0
                total_likes = 0
                total_dislikes = 0
                tag_counter: Dict[str, int] = {}
                for item in stats_data.get("items", []):
                    stats = item.get("statistics", {})
                    total_views += int(stats.get("viewCount", 0))
                    total_comments += int(stats.get("commentCount", 0))
                    total_likes += int(stats.get("likeCount", 0))
                    # Collect tags from video snippets
                    for tag in item.get("snippet", {}).get("tags", []):
                        tag_lower = tag.lower().strip()
                        tag_counter[tag_lower] = tag_counter.get(tag_lower, 0) + 1

                # Get top tags sorted by frequency
                sorted_tags = sorted(tag_counter.items(), key=lambda x: x[1], reverse=True)[:20]
                top_tags = [f"#{t[0]}" for t in sorted_tags]

                return {
                    "content_count": total_results,
                    "total_views": total_views,
                    "total_comments": total_comments,
                    "total_likes": total_likes,
                    "tags": top_tags,
                }
        except Exception as e:
            logger.warning(f"YouTube API error for '{keyword}': {e}")
            return None

    async def fetch_naver_data(self, keyword: str, days: int = 30) -> Optional[Dict[str, Any]]:
        """Fetch Naver blog search results and DataLab trend for a keyword."""
        if not self.has_naver:
            return None

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                headers = {
                    "X-Naver-Client-Id": self.naver_id,
                    "X-Naver-Client-Secret": self.naver_secret,
                }

                # Blog search (fetch 10 titles for sentiment keywords)
                blog_resp = await client.get(
                    "https://openapi.naver.com/v1/search/blog.json",
                    params={"query": keyword, "display": 10, "sort": "sim"},
                    headers=headers,
                )
                if blog_resp.status_code != 200:
                    logger.warning(f"Naver blog API error: {blog_resp.status_code} {blog_resp.text[:200]}")
                    return None
                blog_data = blog_resp.json()
                blog_count = blog_data.get("total", 0)

                # Extract blog titles for keyword extraction
                import re
                blog_titles = []
                for item in blog_data.get("items", []):
                    title = re.sub(r'<[^>]+>', '', item.get("title", ""))
                    blog_titles.append(title)

                # DataLab search trend
                end_date = datetime.utcnow().strftime("%Y-%m-%d")
                start_date = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")

                datalab_headers = {
                    **headers,
                    "Content-Type": "application/json",
                }
                trend_resp = await client.post(
                    "https://openapi.naver.com/v1/datalab/search",
                    headers=datalab_headers,
                    json={
                        "startDate": start_date,
                        "endDate": end_date,
                        "timeUnit": "date",
                        "keywordGroups": [
                            {"groupName": keyword, "keywords": [keyword]},
                        ],
                    },
                )
                logger.info(f"Naver DataLab response status: {trend_resp.status_code}")

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
                    "blog_titles": blog_titles,
                }
        except Exception as e:
            logger.warning(f"Naver API error for '{keyword}': {e}")
            return None

    async def _get_ig_user_id(self, client: httpx.AsyncClient) -> Optional[str]:
        """Get Instagram Business Account ID from Meta token."""
        try:
            # Get pages connected to the token
            resp = await client.get(
                f"{self.meta_graph_base}/{self.meta_api_version}/me/accounts",
                params={"access_token": self.meta_token, "fields": "instagram_business_account"},
            )
            if resp.status_code != 200:
                logger.warning(f"Meta pages API error: {resp.status_code} {resp.text[:200]}")
                return None
            pages = resp.json().get("data", [])
            for page in pages:
                ig_account = page.get("instagram_business_account", {})
                if ig_account.get("id"):
                    return ig_account["id"]
            logger.warning("No Instagram Business Account found on any connected page")
            return None
        except Exception as e:
            logger.warning(f"Failed to get IG user ID: {e}")
            return None

    async def fetch_instagram_hashtag_data(self, keyword: str) -> Optional[Dict[str, Any]]:
        """Fetch Instagram hashtag data using Meta Graph API."""
        if not self.has_instagram:
            return None

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                # First get IG Business Account ID (required for hashtag search)
                ig_user_id = await self._get_ig_user_id(client)
                if not ig_user_id:
                    logger.warning("Instagram: no IG Business Account ID available")
                    return None

                # Search for hashtag ID
                search_resp = await client.get(
                    f"{self.meta_graph_base}/{self.meta_api_version}/ig_hashtag_search",
                    params={
                        "q": keyword,
                        "user_id": ig_user_id,
                        "access_token": self.meta_token,
                    },
                )

                if search_resp.status_code != 200:
                    logger.warning(f"Instagram hashtag search error: {search_resp.status_code} {search_resp.text[:200]}")
                    return None

                hashtag_data = search_resp.json()
                hashtags = hashtag_data.get("data", [])
                if not hashtags:
                    return None

                hashtag_id = hashtags[0].get("id")

                # Get recent media for this hashtag
                media_resp = await client.get(
                    f"{self.meta_graph_base}/{self.meta_api_version}/{hashtag_id}/recent_media",
                    params={
                        "user_id": ig_user_id,
                        "fields": "id,caption,like_count,comments_count,media_type",
                        "access_token": self.meta_token,
                    },
                )

                content_count = 0
                total_likes = 0
                total_comments = 0
                ig_hashtags: List[str] = []

                if media_resp.status_code == 200:
                    media_data = media_resp.json().get("data", [])
                    content_count = len(media_data)
                    for media in media_data:
                        total_likes += media.get("like_count", 0)
                        total_comments += media.get("comments_count", 0)
                        # Extract hashtags from captions
                        caption = media.get("caption", "")
                        if caption:
                            import re
                            found_tags = re.findall(r'#[\w가-힣]+', caption)
                            ig_hashtags.extend(found_tags)
                else:
                    logger.warning(f"Instagram recent_media error: {media_resp.status_code} {media_resp.text[:200]}")

                # Deduplicate hashtags
                tag_counter: Dict[str, int] = {}
                for tag in ig_hashtags:
                    tag_counter[tag.lower()] = tag_counter.get(tag.lower(), 0) + 1
                top_ig_tags = [t[0] for t in sorted(tag_counter.items(), key=lambda x: x[1], reverse=True)[:15]]

                return {
                    "content_count": content_count,
                    "total_views": total_likes,  # Instagram doesn't expose views, use likes
                    "total_comments": total_comments,
                    "hashtag_id": hashtag_id,
                    "tags": top_ig_tags,
                }
        except Exception as e:
            logger.warning(f"Instagram API error for '{keyword}': {e}")
            return None

    async def fetch_all(self, keyword: str, days: int = 30) -> Dict[str, Any]:
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

        naver = await self.fetch_naver_data(keyword, days=days)
        if naver:
            result["naver"] = naver
            result["api_sources"].append("naver")

        ig = await self.fetch_instagram_hashtag_data(keyword)
        if ig:
            result["instagram"] = ig
            result["api_sources"].append("instagram")

        return result
