"""Vision AI service for image analysis."""
from typing import Dict, Any, Optional, List
import base64
import httpx
import json

from openai import OpenAI

from app.core.config import get_settings

settings = get_settings()


class VisionService:
    """Service for image analysis using GPT-4 Vision."""

    def __init__(self):
        self.client = OpenAI(api_key=settings.OPENAI_API_KEY)

    async def analyze_image_style(
        self,
        image_url: str
    ) -> Dict[str, Any]:
        """
        Analyze visual style of an image.

        Returns style attributes: composition, colors, mood, etc.
        """
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
        """
        Analyze an advertisement creative for marketing insights.
        """
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
        """
        Extract and analyze text content from image.
        """
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
        """
        Generate an image generation prompt based on style reference.
        """
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
        """
        Compare multiple images for A/B testing insights.
        """
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

        for url in image_urls[:4]:  # Max 4 images
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
