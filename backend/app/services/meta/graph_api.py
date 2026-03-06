"""Meta Graph API integration for organic content."""
from typing import Optional, List, Dict, Any
import httpx

from app.core.config import get_settings

settings = get_settings()


class MetaGraphAPI:
    """Client for Meta Graph API (Instagram/Facebook organic content)."""

    def __init__(self, access_token: str):
        self.access_token = access_token
        self.base_url = f"{settings.META_GRAPH_API_BASE}/{settings.META_API_VERSION}"

    async def _request(
        self,
        method: str,
        endpoint: str,
        params: Optional[Dict] = None,
        data: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """Make API request to Meta Graph API."""
        params = params or {}
        params["access_token"] = self.access_token

        async with httpx.AsyncClient(timeout=15.0) as client:
            url = f"{self.base_url}/{endpoint}"
            response = await client.request(method, url, params=params, json=data)
            response.raise_for_status()
            return response.json()

    async def get_user_profile(self, user_id: str = "me") -> Dict[str, Any]:
        """Get user profile information."""
        return await self._request(
            "GET",
            user_id,
            params={"fields": "id,name,email"}
        )

    async def get_instagram_account(self, page_id: str) -> Dict[str, Any]:
        """Get connected Instagram Business account."""
        return await self._request(
            "GET",
            f"{page_id}",
            params={"fields": "instagram_business_account"}
        )

    async def business_discovery(
        self,
        ig_account_id: str,
        username: str,
        fields: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Use Business Discovery API to get competitor account info.

        Args:
            ig_account_id: Your Instagram Business Account ID
            username: Target account username (without @)
            fields: Fields to retrieve
        """
        default_fields = [
            "business_discovery.username({username}){",
            "followers_count,media_count,",
            "media{id,caption,media_type,media_url,thumbnail_url,",
            "timestamp,like_count,comments_count,permalink}}"
        ]
        fields_str = "".join(default_fields).format(username=username)

        return await self._request(
            "GET",
            ig_account_id,
            params={"fields": fields_str}
        )

    async def search_hashtag(
        self,
        ig_account_id: str,
        hashtag: str
    ) -> Dict[str, Any]:
        """
        Search for hashtag ID.

        Args:
            ig_account_id: Your Instagram Business Account ID
            hashtag: Hashtag to search (without #)
        """
        return await self._request(
            "GET",
            "ig_hashtag_search",
            params={
                "user_id": ig_account_id,
                "q": hashtag
            }
        )

    async def get_hashtag_recent_media(
        self,
        ig_account_id: str,
        hashtag_id: str,
        limit: int = 50
    ) -> Dict[str, Any]:
        """
        Get recent media for a hashtag.

        Args:
            ig_account_id: Your Instagram Business Account ID
            hashtag_id: Hashtag ID from search
            limit: Number of posts to retrieve
        """
        return await self._request(
            "GET",
            f"{hashtag_id}/recent_media",
            params={
                "user_id": ig_account_id,
                "fields": "id,caption,media_type,media_url,permalink,like_count,comments_count,timestamp",
                "limit": limit
            }
        )

    async def get_media_comments(
        self,
        media_id: str,
        limit: int = 100
    ) -> Dict[str, Any]:
        """Get comments on a media post."""
        return await self._request(
            "GET",
            f"{media_id}/comments",
            params={
                "fields": "id,text,timestamp,like_count,username",
                "limit": limit
            }
        )

    async def get_media_insights(
        self,
        media_id: str,
        metrics: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """Get insights for a media post (own content only)."""
        metrics = metrics or ["impressions", "reach", "engagement", "saved"]
        return await self._request(
            "GET",
            f"{media_id}/insights",
            params={"metric": ",".join(metrics)}
        )
