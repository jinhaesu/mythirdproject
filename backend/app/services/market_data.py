"""Real market data fetching from YouTube Data API, Naver API, and Instagram Graph API."""
import logging
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class MarketDataService:
    """Fetches real market data from YouTube, Naver, and Instagram APIs."""

    def __init__(self, user_meta_token: Optional[str] = None, user_ig_account_id: Optional[str] = None):
        settings = get_settings()
        self.youtube_key = settings.YOUTUBE_API_KEY
        self.naver_id = settings.NAVER_CLIENT_ID
        self.naver_secret = settings.NAVER_CLIENT_SECRET
        # Prefer user's personal Meta token (has page/IG permissions) over app-level token
        self.meta_token = user_meta_token or settings.META_ACCESS_TOKEN
        self.meta_graph_base = settings.META_GRAPH_API_BASE
        self.meta_api_version = settings.META_API_VERSION
        # IG Business Account ID from user's OAuth connection
        self.ig_account_id = user_ig_account_id
        logger.info(f"MarketDataService init: youtube={'YES' if self.youtube_key else 'NO'}, naver={'YES' if self.naver_id else 'NO'}, instagram={'YES' if self.meta_token else 'NO'} (user_token={'YES' if user_meta_token else 'NO'}, ig_id={'YES' if user_ig_account_id else 'NO'})")

    @property
    def has_youtube(self) -> bool:
        return bool(self.youtube_key)

    @property
    def has_naver(self) -> bool:
        return bool(self.naver_id and self.naver_secret)

    @property
    def has_instagram(self) -> bool:
        return bool(self.meta_token)

    async def fetch_youtube_data(self, keyword: str, days: int = 30) -> Optional[Dict[str, Any]]:
        """Fetch YouTube search results for a keyword within the specified date range."""
        if not self.has_youtube:
            return None

        try:
            # Date range filtering
            published_after = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%dT00:00:00Z")
            published_before = datetime.utcnow().strftime("%Y-%m-%dT23:59:59Z")

            async with httpx.AsyncClient(timeout=15.0) as client:
                # Search for videos within date range
                resp = await client.get(
                    "https://www.googleapis.com/youtube/v3/search",
                    params={
                        "part": "snippet",
                        "q": keyword,
                        "type": "video",
                        "maxResults": 20,
                        "order": "date",
                        "key": self.youtube_key,
                        "regionCode": "KR",
                        "relevanceLanguage": "ko",
                        "publishedAfter": published_after,
                        "publishedBefore": published_before,
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

                # Blog search (fetch recent posts sorted by date for period relevance)
                blog_resp = await client.get(
                    "https://openapi.naver.com/v1/search/blog.json",
                    params={"query": keyword, "display": 100, "sort": "date"},
                    headers=headers,
                )
                if blog_resp.status_code != 200:
                    logger.warning(f"Naver blog API error: {blog_resp.status_code} {blog_resp.text[:200]}")
                    return None
                blog_data = blog_resp.json()

                # Filter blog posts by date range and count only those within period
                import re
                cutoff_date = (datetime.utcnow() - timedelta(days=days)).strftime("%Y%m%d")
                blog_titles = []
                period_blog_count = 0
                for item in blog_data.get("items", []):
                    # Naver postdate format: "20260305"
                    post_date = item.get("postdate", "")
                    if post_date >= cutoff_date:
                        period_blog_count += 1
                        title = re.sub(r'<[^>]+>', '', item.get("title", ""))
                        blog_titles.append(title)
                blog_count = period_blog_count

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
                        # Ratio is relative (0-100). Use sum of daily ratios as volume indicator
                        # This changes with the selected period (more days = higher sum)
                        search_volume = int(sum(dp["ratio"] for dp in data_points)) if data_points else 0

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
        """Fetch Instagram hashtag data using Meta Graph API.

        Uses the user's IG Business Account ID (from OAuth) directly instead of
        calling me/accounts which requires pages_show_list permission.
        """
        if not self.has_instagram:
            logger.warning("Instagram: no meta token available")
            return None

        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                # Use pre-stored IG Business Account ID first, then fallback to me/accounts
                ig_user_id = self.ig_account_id
                if not ig_user_id:
                    logger.info("Instagram: no stored ig_account_id, trying me/accounts...")
                    ig_user_id = await self._get_ig_user_id(client)
                if not ig_user_id:
                    logger.warning("Instagram: no IG Business Account ID available. User needs to connect Instagram in Meta settings.")
                    return None

                logger.info(f"Instagram: using IG account ID: {ig_user_id[:10]}...")

                # Search for hashtag ID
                search_url = f"{self.meta_graph_base}/{self.meta_api_version}/ig_hashtag_search"
                logger.info(f"Instagram: hashtag search URL: {search_url}, keyword: {keyword}")
                search_resp = await client.get(
                    search_url,
                    params={
                        "q": keyword,
                        "user_id": ig_user_id,
                        "access_token": self.meta_token,
                    },
                )

                if search_resp.status_code != 200:
                    error_text = search_resp.text[:300]
                    logger.warning(f"Instagram hashtag search error: {search_resp.status_code} {error_text}")
                    # If permission error, try fetching IG account's own recent media instead
                    if search_resp.status_code in (400, 403):
                        logger.info("Instagram: hashtag search failed, trying IG account media fallback...")
                        return await self._fetch_ig_account_media(client, ig_user_id, keyword)
                    return None

                hashtag_data = search_resp.json()
                hashtags = hashtag_data.get("data", [])
                if not hashtags:
                    logger.warning("Instagram: no hashtag results found")
                    return await self._fetch_ig_account_media(client, ig_user_id, keyword)

                hashtag_id = hashtags[0].get("id")
                logger.info(f"Instagram: found hashtag ID: {hashtag_id}")

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
                        caption = media.get("caption", "")
                        if caption:
                            import re
                            found_tags = re.findall(r'#[\w가-힣]+', caption)
                            ig_hashtags.extend(found_tags)
                    logger.info(f"Instagram: got {content_count} media, {total_likes} likes, {total_comments} comments")
                else:
                    logger.warning(f"Instagram recent_media error: {media_resp.status_code} {media_resp.text[:200]}")
                    # Fallback to account media
                    return await self._fetch_ig_account_media(client, ig_user_id, keyword)

                # Deduplicate hashtags
                tag_counter: Dict[str, int] = {}
                for tag in ig_hashtags:
                    tag_counter[tag.lower()] = tag_counter.get(tag.lower(), 0) + 1
                top_ig_tags = [t[0] for t in sorted(tag_counter.items(), key=lambda x: x[1], reverse=True)[:15]]

                return {
                    "content_count": content_count,
                    "total_views": total_likes,
                    "total_comments": total_comments,
                    "hashtag_id": hashtag_id,
                    "tags": top_ig_tags,
                }
        except Exception as e:
            logger.error(f"Instagram API error for '{keyword}': {e}", exc_info=True)
            return None

    async def _fetch_ig_account_media(self, client: httpx.AsyncClient, ig_user_id: str, keyword: str) -> Optional[Dict[str, Any]]:
        """Fallback: fetch IG Business Account's own recent media when hashtag search is restricted."""
        try:
            # Get account's recent media
            media_resp = await client.get(
                f"{self.meta_graph_base}/{self.meta_api_version}/{ig_user_id}/media",
                params={
                    "fields": "id,caption,like_count,comments_count,media_type,timestamp",
                    "limit": 50,
                    "access_token": self.meta_token,
                },
            )
            if media_resp.status_code != 200:
                logger.warning(f"Instagram account media fallback error: {media_resp.status_code} {media_resp.text[:200]}")
                return None

            all_media = media_resp.json().get("data", [])
            # Filter media whose caption contains the keyword
            keyword_lower = keyword.lower()
            content_count = 0
            total_likes = 0
            total_comments = 0
            ig_hashtags: List[str] = []

            for media in all_media:
                caption = media.get("caption", "") or ""
                if keyword_lower in caption.lower():
                    content_count += 1
                    total_likes += media.get("like_count", 0)
                    total_comments += media.get("comments_count", 0)
                    import re
                    found_tags = re.findall(r'#[\w가-힣]+', caption)
                    ig_hashtags.extend(found_tags)

            # Even if no keyword match, return overall account stats
            if content_count == 0:
                content_count = len(all_media)
                for media in all_media:
                    total_likes += media.get("like_count", 0)
                    total_comments += media.get("comments_count", 0)
                    caption = media.get("caption", "") or ""
                    if caption:
                        import re
                        found_tags = re.findall(r'#[\w가-힣]+', caption)
                        ig_hashtags.extend(found_tags)

            tag_counter: Dict[str, int] = {}
            for tag in ig_hashtags:
                tag_counter[tag.lower()] = tag_counter.get(tag.lower(), 0) + 1
            top_ig_tags = [t[0] for t in sorted(tag_counter.items(), key=lambda x: x[1], reverse=True)[:15]]

            logger.info(f"Instagram fallback: {content_count} media, {total_likes} likes from account media")
            return {
                "content_count": content_count,
                "total_views": total_likes,
                "total_comments": total_comments,
                "tags": top_ig_tags,
            }
        except Exception as e:
            logger.error(f"Instagram account media fallback error: {e}")
            return None

    async def fetch_all(self, keyword: str, days: int = 30) -> Dict[str, Any]:
        """Fetch data from all available APIs and return combined result."""
        result = {
            "api_sources": [],
            "youtube": None,
            "instagram": None,
            "naver": None,
        }

        yt = await self.fetch_youtube_data(keyword, days=days)
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
