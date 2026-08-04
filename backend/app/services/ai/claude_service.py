"""Claude AI service for text analysis and generation."""
from typing import List, Dict, Any, Optional
import json

from anthropic import Anthropic

from app.core.config import get_settings

settings = get_settings()


def extract_text(response) -> str:
    """Messages API 응답에서 텍스트 블록만 모아 반환한다.

    Fable 5 계열은 응답 앞에 thinking 등 비텍스트 블록이 올 수 있어
    content[0].text 직접 접근은 None/AttributeError가 난다.
    """
    parts = []
    for block in (getattr(response, "content", None) or []):
        if getattr(block, "type", None) == "text" and getattr(block, "text", None):
            parts.append(block.text)
    return "\n".join(parts).strip()


class ClaudeService:
    """Service for Claude AI text operations."""

    def __init__(self):
        self.client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        self.model = "claude-fable-5"

    async def analyze_content_trends(
        self,
        posts: List[Dict[str, Any]],
        query: str
    ) -> Dict[str, Any]:
        """
        Analyze content trends from collected posts.

        Returns AI summary with key insights.
        """
        posts_text = "\n".join([
            f"- Caption: {p.get('caption', '')[:200]}... | Likes: {p.get('likes', 0)} | Comments: {p.get('comments', 0)}"
            for p in posts[:20]
        ])

        prompt = f"""다음은 '{query}' 키워드/계정의 최근 인기 게시물들입니다:

{posts_text}

다음 형식으로 분석해주세요:
1. 전체 요약 (2-3문장)
2. 주요 인사이트 (3-5개 bullet points)
3. 성공 요인 분석
4. 추천 전략 (3개)
5. 현재 트렌딩 토픽/키워드 (5개)

JSON 형식으로 응답해주세요:
{{
    "summary": "...",
    "key_insights": ["...", "..."],
    "success_factors": "...",
    "recommendations": ["...", "..."],
    "trending_topics": ["...", "..."]
}}"""

        response = self.client.messages.create(
            model=self.model,
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}]
        )

        try:
            content = extract_text(response)
            # Extract JSON from response
            start = content.find("{")
            end = content.rfind("}") + 1
            if start >= 0 and end > start:
                return json.loads(content[start:end])
        except (json.JSONDecodeError, IndexError):
            pass

        return {
            "summary": extract_text(response),
            "key_insights": [],
            "success_factors": "",
            "recommendations": [],
            "trending_topics": []
        }

    async def analyze_sentiment(
        self,
        comments: List[str]
    ) -> Dict[str, Any]:
        """
        Analyze sentiment from comments.

        Returns positive/negative keywords and overall sentiment.
        """
        comments_text = "\n".join([f"- {c[:150]}" for c in comments[:50]])

        prompt = f"""다음 댓글들의 감성을 분석해주세요:

{comments_text}

JSON 형식으로 응답해주세요:
{{
    "overall_sentiment": "positive/negative/neutral",
    "positive_keywords": [{{"keyword": "예쁨", "count": 5, "sentiment": "positive"}}],
    "negative_keywords": [{{"keyword": "배송지연", "count": 3, "sentiment": "negative"}}],
    "word_cloud_data": [{{"word": "디자인", "weight": 10, "sentiment": "positive"}}]
}}"""

        response = self.client.messages.create(
            model=self.model,
            max_tokens=1500,
            messages=[{"role": "user", "content": prompt}]
        )

        try:
            content = extract_text(response)
            start = content.find("{")
            end = content.rfind("}") + 1
            if start >= 0 and end > start:
                return json.loads(content[start:end])
        except (json.JSONDecodeError, IndexError):
            pass

        return {
            "overall_sentiment": "neutral",
            "positive_keywords": [],
            "negative_keywords": [],
            "word_cloud_data": []
        }

    async def extract_text_style(
        self,
        caption: str,
        context: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Extract tone and manner from text content.
        """
        prompt = f"""다음 텍스트의 톤앤매너를 분석해주세요:

텍스트: {caption}
{f'컨텍스트: {context}' if context else ''}

JSON 형식으로 응답해주세요:
{{
    "tone": "유머러스/진지함/감성적/정보적",
    "appeal_type": "이성적/감성적/사회적증거",
    "language_style": "casual/formal/trendy",
    "key_phrases": ["주요 표현들"],
    "copywriting_pattern": "패턴 설명"
}}"""

        response = self.client.messages.create(
            model=self.model,
            max_tokens=1000,
            messages=[{"role": "user", "content": prompt}]
        )

        try:
            content = extract_text(response)
            start = content.find("{")
            end = content.rfind("}") + 1
            if start >= 0 and end > start:
                return json.loads(content[start:end])
        except (json.JSONDecodeError, IndexError):
            pass

        return {"tone": "neutral", "appeal_type": "rational", "language_style": "casual"}

    async def generate_ad_copy(
        self,
        product_info: str,
        style_reference: Dict[str, Any],
        promotion: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Generate ad copy based on style reference.
        """
        prompt = f"""다음 스타일을 참고하여 광고 카피를 생성해주세요:

제품/서비스 정보: {product_info}
참조 스타일: {json.dumps(style_reference, ensure_ascii=False)}
{f'프로모션 내용: {promotion}' if promotion else ''}

3가지 버전의 카피를 생성해주세요.

JSON 형식으로 응답:
{{
    "variations": [
        {{
            "headline": "헤드라인 (30자 이내)",
            "primary_text": "본문 텍스트 (125자 이내)",
            "cta_text": "CTA 텍스트"
        }}
    ]
}}"""

        response = self.client.messages.create(
            model=self.model,
            max_tokens=1500,
            messages=[{"role": "user", "content": prompt}]
        )

        try:
            content = extract_text(response)
            start = content.find("{")
            end = content.rfind("}") + 1
            if start >= 0 and end > start:
                return json.loads(content[start:end])
        except (json.JSONDecodeError, IndexError):
            pass

        return {"variations": []}

    async def generate_strategy_recommendation(
        self,
        budget: float,
        creatives: List[Dict[str, Any]],
        historical_data: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Generate campaign strategy recommendation.
        """
        creative_info = "\n".join([
            f"- {c.get('name')}: {c.get('type')} ({c.get('format')})"
            for c in creatives
        ])

        prompt = f"""다음 조건으로 Meta 광고 캠페인 전략을 추천해주세요:

총 예산: {budget:,.0f}원
사용 가능한 소재:
{creative_info}

{f'과거 성과 데이터: {json.dumps(historical_data, ensure_ascii=False)}' if historical_data else ''}

JSON 형식으로 응답:
{{
    "recommended_duration_days": 7,
    "allocations": [
        {{
            "creative_name": "소재명",
            "allocation_percentage": 70,
            "recommended_placement": "reels/feed/story",
            "reasoning": "이유"
        }}
    ],
    "target_audience_summary": "25-34세 여성, 뷰티/패션 관심사",
    "expected_reach": 50000,
    "expected_ctr": 1.5,
    "overall_reasoning": "전체 전략 설명"
}}"""

        response = self.client.messages.create(
            model=self.model,
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}]
        )

        try:
            content = extract_text(response)
            start = content.find("{")
            end = content.rfind("}") + 1
            if start >= 0 and end > start:
                return json.loads(content[start:end])
        except (json.JSONDecodeError, IndexError):
            pass

        return {}

    async def analyze_performance(
        self,
        performance_data: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """
        Generate AI insights from performance data.
        """
        prompt = f"""다음 광고 성과 데이터를 분석하고 인사이트를 제공해주세요:

{json.dumps(performance_data, ensure_ascii=False, indent=2)}

3-5개의 실행 가능한 인사이트를 JSON 형식으로 응답:
{{
    "insights": [
        {{
            "insight_type": "performance/optimization/trend",
            "title": "인사이트 제목",
            "description": "상세 설명",
            "action_available": true,
            "action_type": "reallocate_budget/pause_ad/increase_budget",
            "action_params": {{}}
        }}
    ]
}}"""

        response = self.client.messages.create(
            model=self.model,
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}]
        )

        try:
            content = extract_text(response)
            start = content.find("{")
            end = content.rfind("}") + 1
            if start >= 0 and end > start:
                result = json.loads(content[start:end])
                return result.get("insights", [])
        except (json.JSONDecodeError, IndexError):
            pass

        return []

    async def analyze_marketing_performance(
        self,
        data_summary: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Comprehensive AI analysis of marketing performance across platforms.
        """
        prompt = f"""다음 마케팅 성과 데이터를 종합 분석해주세요:

{json.dumps(data_summary, ensure_ascii=False, indent=2)}

다음 형식으로 분석 결과를 JSON으로 응답해주세요:
{{
    "summary": "전체 성과에 대한 2-3문장 요약",
    "insights": [
        {{
            "insight_type": "TREND/ANOMALY/RECOMMENDATION/ALERT",
            "title": "인사이트 제목",
            "description": "상세 설명",
            "severity": "INFO/WARNING/CRITICAL",
            "platform": "META/GOOGLE/NAVER/KAKAO (해당시)",
            "metric_name": "관련 지표명",
            "metric_change": 변화율
        }}
    ],
    "recommendations": [
        "실행 가능한 추천 액션 1",
        "실행 가능한 추천 액션 2"
    ],
    "predicted_trends": {{
        "next_week_spend": 예상 광고비,
        "next_week_revenue": 예상 매출,
        "trend_direction": "up/down/stable",
        "confidence": 0.8
    }}
}}"""

        response = self.client.messages.create(
            model=self.model,
            max_tokens=3000,
            messages=[{"role": "user", "content": prompt}]
        )

        try:
            content = extract_text(response)
            start = content.find("{")
            end = content.rfind("}") + 1
            if start >= 0 and end > start:
                return json.loads(content[start:end])
        except (json.JSONDecodeError, IndexError):
            pass

        return {
            "summary": "분석을 수행할 수 없습니다.",
            "insights": [],
            "recommendations": [],
            "predicted_trends": {}
        }

    async def generate_report_summary(
        self,
        kpi_data: Dict[str, Any],
        report_type: str
    ) -> Dict[str, Any]:
        """
        Generate AI summary for performance reports.
        """
        period_name = {
            "DAILY": "일간",
            "WEEKLY": "주간",
            "MONTHLY": "월간"
        }.get(report_type, "기간")

        prompt = f"""다음 {period_name} 마케팅 성과 데이터를 분석하고 리포트를 생성해주세요:

KPI 데이터:
{json.dumps(kpi_data, ensure_ascii=False, indent=2)}

다음 형식으로 JSON 응답:
{{
    "summary": "{period_name} 성과에 대한 종합 요약 (3-4문장)",
    "insights": [
        {{
            "title": "주요 인사이트",
            "description": "상세 내용",
            "impact": "high/medium/low"
        }}
    ],
    "recommendations": [
        "다음 기간 추천 액션 1",
        "다음 기간 추천 액션 2"
    ],
    "highlights": [
        "주요 성과 하이라이트 1",
        "주요 성과 하이라이트 2"
    ]
}}"""

        response = self.client.messages.create(
            model=self.model,
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}]
        )

        try:
            content = extract_text(response)
            start = content.find("{")
            end = content.rfind("}") + 1
            if start >= 0 and end > start:
                return json.loads(content[start:end])
        except (json.JSONDecodeError, IndexError):
            pass

        return {
            "summary": f"{period_name} 리포트가 생성되었습니다.",
            "insights": [],
            "recommendations": []
        }

    async def analyze_influencer_target(
        self,
        name: str,
        channel: str,
        url: Optional[str] = None,
        page_text: Optional[str] = None,
        follower_count: Optional[int] = None,
        product: Optional[str] = None,
        notes: Optional[str] = None,
        data_quality: str = "unknown",
    ) -> Dict[str, Any]:
        """
        인플루언서 시딩 대상의 타겟 고객층을 분석 (널담은디저트 브랜드 관점).

        data_quality: rich(설명+최근 콘텐츠 제목 확보) | partial(메타데이터 일부) | none(실데이터 없음)
        """
        info_lines = [f"이름/핸들: {name}", f"채널: {channel}"]
        if url:
            info_lines.append(f"URL: {url}")
        if follower_count:
            info_lines.append(f"팔로워수: {follower_count:,}")
        if product:
            info_lines.append(f"시딩 제품: {product}")
        if notes:
            info_lines.append(f"메모: {notes}")
        if page_text:
            info_lines.append(f"수집된 채널 실데이터:\n{page_text[:4000]}")
        else:
            info_lines.append("수집된 채널 실데이터: 없음")

        prompt = f"""당신은 '널담은디저트'(비건/건강 디저트 브랜드, nuldam.com)의 인플루언서 마케팅 담당자입니다.
아래 인플루언서에게 제품을 시딩할 때의 관점에서 이 인플루언서/채널의 예상 타겟 고객층을 분석해주세요.

{chr(10).join(info_lines)}

[분석 규칙 — 반드시 지킬 것]
1. 분석은 반드시 위 **수집된 채널 실데이터**(채널 설명, 최근 콘텐츠 제목, 구독자수 등)에 근거해야 합니다.
2. 이름·핸들·이모지만으로 성별, 연령대, 콘텐츠 주제를 추측하는 것은 절대 금지입니다. 핸들명은 근거가 아닙니다.
3. 실데이터가 없거나 콘텐츠 주제를 판단하기에 불충분하면 추측으로 채우지 말고
   target_segment를 "정보 부족 — 채널 데이터 확인 불가"로 반환하고,
   audience_summary에는 어떤 데이터가 없어서 분석이 불가한지만 간결히 적으세요.
4. 최근 콘텐츠 제목이 있으면 그 제목들에서 실제 다루는 주제와 화자 단서를 우선 근거로 삼으세요.
5. audience_summary 첫 문장에 어떤 실데이터를 근거로 판단했는지 명시하세요.

JSON 형식으로만 응답해주세요 (다른 텍스트 없이):
{{
    "target_segment": "한 줄 요약 (연령대·성별·관심사) 또는 '정보 부족 — 채널 데이터 확인 불가'",
    "audience_summary": "3~5문장 상세 분석 (근거 데이터 명시, 구독자 특성, 콘텐츠 톤, 우리 브랜드 적합도, 예상 전환 포인트)",
    "follower_estimate": null 또는 숫자
}}"""

        response = self.client.messages.create(
            model=self.model,
            max_tokens=1000,
            messages=[{"role": "user", "content": prompt}]
        )

        try:
            content = extract_text(response)
            start = content.find("{")
            end = content.rfind("}") + 1
            if start >= 0 and end > start:
                return json.loads(content[start:end])
        except (json.JSONDecodeError, IndexError):
            pass

        return {
            "target_segment": None,
            "audience_summary": extract_text(response) or None,
            "follower_estimate": None,
        }
