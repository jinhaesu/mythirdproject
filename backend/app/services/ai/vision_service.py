"""Vision AI service for image analysis."""
from typing import Dict, Any, Optional, List
import base64
import re
import httpx
import json
import logging

from openai import OpenAI

from app.core.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


class VisionService:
    """Service for image analysis using GPT-4 Vision."""

    def __init__(self):
        self.client = OpenAI(api_key=settings.OPENAI_API_KEY)

    async def resolve_image_url(self, url: str) -> Optional[str]:
        """
        Resolve a URL to an actual image URL.

        Handles:
        - Direct image URLs (.jpg, .png, .webp, etc.)
        - Instagram/Facebook URLs → oEmbed API
        - General web pages → OG image meta tag
        """
        # Direct image URL
        if re.search(r'\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$', url, re.IGNORECASE):
            return url

        try:
            async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
                # Instagram oEmbed
                if 'instagram.com' in url or 'instagr.am' in url:
                    return await self._resolve_instagram_url(client, url)

                # Facebook oEmbed
                if 'facebook.com' in url or 'fb.com' in url:
                    return await self._resolve_facebook_url(client, url)

                # General web page → OG image
                return await self._resolve_og_image(client, url)

        except Exception as e:
            logger.warning(f"Failed to resolve image URL from {url}: {e}")
            return None

    async def _resolve_instagram_url(self, client: httpx.AsyncClient, url: str) -> Optional[str]:
        """Extract image from Instagram post via oEmbed API."""
        try:
            oembed_url = f"https://graph.facebook.com/v21.0/instagram_oembed"
            params = {"url": url, "access_token": f"{settings.META_APP_ID}|{settings.META_APP_SECRET}"}

            resp = await client.get(oembed_url, params=params)
            if resp.status_code == 200:
                data = resp.json()
                thumbnail = data.get("thumbnail_url")
                if thumbnail:
                    return thumbnail

            # Fallback: try page scraping for OG image
            return await self._resolve_og_image(client, url)
        except Exception:
            return await self._resolve_og_image(client, url)

    async def _resolve_facebook_url(self, client: httpx.AsyncClient, url: str) -> Optional[str]:
        """Extract image from Facebook post via oEmbed API."""
        try:
            oembed_url = f"https://graph.facebook.com/v21.0/oembed_post"
            params = {"url": url, "access_token": f"{settings.META_APP_ID}|{settings.META_APP_SECRET}"}

            resp = await client.get(oembed_url, params=params)
            if resp.status_code == 200:
                data = resp.json()
                # Facebook oEmbed returns HTML; extract image from it
                html = data.get("html", "")
                img_match = re.search(r'src="(https?://[^"]+)"', html)
                if img_match:
                    return img_match.group(1)

            return await self._resolve_og_image(client, url)
        except Exception:
            return await self._resolve_og_image(client, url)

    async def _resolve_og_image(self, client: httpx.AsyncClient, url: str) -> Optional[str]:
        """Extract OG image meta tag from a web page."""
        try:
            resp = await client.get(url, headers={
                "User-Agent": "Mozilla/5.0 (compatible; MetaCommander/1.0)"
            })
            if resp.status_code != 200:
                return None

            html = resp.text[:50000]  # Limit to first 50KB

            # Try og:image first
            og_match = re.search(
                r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
                html, re.IGNORECASE
            )
            if not og_match:
                og_match = re.search(
                    r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
                    html, re.IGNORECASE
                )

            if og_match:
                img_url = og_match.group(1)
                if img_url.startswith("//"):
                    img_url = "https:" + img_url
                return img_url

            # Try twitter:image
            tw_match = re.search(
                r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)["\']',
                html, re.IGNORECASE
            )
            if tw_match:
                return tw_match.group(1)

            return None
        except Exception:
            return None

    async def analyze_image_style(
        self,
        image_url: str
    ) -> Dict[str, Any]:
        """Analyze visual style of an image."""
        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": """이 이미지의 시각적 스타일을 분석해주세요.

JSON 형식으로 응답해주세요:
{
    "visual_style": "미니멀리즘/맥시멀리즘/빈티지/모던/자연주의 등",
    "color_palette": ["#HEX1", "#HEX2", "#HEX3"],
    "dominant_color": "#HEX",
    "composition": "중앙정렬/삼분할/대칭/비대칭",
    "mood": "밝음/어두움/따뜻함/차가움",
    "text_overlay": true/false,
    "text_style": "폰트 스타일 설명 (있는 경우)",
    "key_visual_elements": ["요소1", "요소2"],
    "suitable_for": ["피드", "스토리", "릴스"]
}"""
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": image_url}
                        }
                    ]
                }
            ],
            max_tokens=1000
        )

        try:
            content = response.choices[0].message.content
            start = content.find("{")
            end = content.rfind("}") + 1
            if start >= 0 and end > start:
                return json.loads(content[start:end])
        except (json.JSONDecodeError, IndexError):
            pass

        return {
            "visual_style": "unknown",
            "color_palette": [],
            "composition": "unknown"
        }

    async def analyze_ad_creative(
        self,
        image_url: str
    ) -> Dict[str, Any]:
        """Analyze an advertisement creative for marketing insights."""
        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": """이 광고 이미지를 마케팅 관점에서 분석해주세요.

JSON 형식으로 응답:
{
    "product_category": "제품 카테고리",
    "target_audience": "추정 타겟 오디언스",
    "key_message": "핵심 메시지",
    "appeal_type": "이성적/감성적/공포/유머",
    "call_to_action": "CTA 유무 및 내용",
    "brand_positioning": "고급/가성비/트렌디 등",
    "strengths": ["강점1", "강점2"],
    "improvement_suggestions": ["개선점1", "개선점2"]
}"""
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": image_url}
                        }
                    ]
                }
            ],
            max_tokens=1000
        )

        try:
            content = response.choices[0].message.content
            start = content.find("{")
            end = content.rfind("}") + 1
            if start >= 0 and end > start:
                return json.loads(content[start:end])
        except (json.JSONDecodeError, IndexError):
            pass

        return {}

    async def extract_text_from_image(
        self,
        image_url: str
    ) -> Dict[str, Any]:
        """Extract and analyze text content from image."""
        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": """이 이미지에서 텍스트를 추출하고 분석해주세요.

JSON 형식으로 응답:
{
    "has_text": true/false,
    "extracted_text": "추출된 전체 텍스트",
    "headline": "메인 헤드라인",
    "subheadline": "서브 헤드라인 (있는 경우)",
    "body_text": "본문 텍스트",
    "cta_text": "CTA 텍스트",
    "font_style": "폰트 스타일 설명",
    "text_position": "텍스트 위치"
}"""
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": image_url}
                        }
                    ]
                }
            ],
            max_tokens=800
        )

        try:
            content = response.choices[0].message.content
            start = content.find("{")
            end = content.rfind("}") + 1
            if start >= 0 and end > start:
                return json.loads(content[start:end])
        except (json.JSONDecodeError, IndexError):
            pass

        return {"has_text": False}

    async def generate_image_prompt(
        self,
        style_reference: Dict[str, Any],
        product_description: str,
        brand_info: Optional[Dict[str, Any]] = None
    ) -> str:
        """Generate an image generation prompt based on style reference."""
        brand_context = ""
        if brand_info:
            brand_context = f"""
브랜드 정보:
- 로고: {brand_info.get('logo_url', 'N/A')}
- 메인 컬러: {brand_info.get('primary_color', '#3B82F6')}
- 브랜드 톤: {brand_info.get('brand_voice', 'professional')}
"""

        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "user",
                    "content": f"""다음 정보를 바탕으로 이미지 생성 프롬프트를 작성해주세요.

참조 스타일:
{json.dumps(style_reference, ensure_ascii=False, indent=2)}

제품/서비스 설명: {product_description}
{brand_context}

고품질 광고 이미지 생성을 위한 상세한 영문 프롬프트를 작성해주세요.
프롬프트만 출력하세요 (다른 설명 없이):"""
                }
            ],
            max_tokens=500
        )

        return response.choices[0].message.content.strip()

    async def compare_images(
        self,
        image_urls: List[str]
    ) -> Dict[str, Any]:
        """Compare multiple images for A/B testing insights."""
        content = [
            {
                "type": "text",
                "text": """이 광고 이미지들을 비교 분석해주세요.

JSON 형식으로 응답:
{
    "comparison": [
        {
            "image_index": 0,
            "strengths": ["강점들"],
            "weaknesses": ["약점들"],
            "predicted_performance": "high/medium/low"
        }
    ],
    "recommendation": "가장 효과적일 것으로 예상되는 이미지와 이유",
    "winner_index": 0
}"""
            }
        ]

        for url in image_urls[:4]:
            content.append({
                "type": "image_url",
                "image_url": {"url": url}
            })

        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": content}],
            max_tokens=1500
        )

        try:
            result = response.choices[0].message.content
            start = result.find("{")
            end = result.rfind("}") + 1
            if start >= 0 and end > start:
                return json.loads(result[start:end])
        except (json.JSONDecodeError, IndexError):
            pass

        return {}
