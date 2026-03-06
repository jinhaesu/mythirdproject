"""AI Command Center - Claude chat endpoint with Meta data integration."""
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_user
from app.core.config import get_settings
from app.db.database import get_db
from app.models.user import User
from app.services.meta_context import get_user_meta_context, build_ai_system_prompt_with_context

logger = logging.getLogger(__name__)
router = APIRouter()
settings = get_settings()


class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class ChatRequest(BaseModel):
    message: str
    history: List[ChatMessage] = []


class ChatResponse(BaseModel):
    reply: str
    suggested_questions: List[str] = []


SYSTEM_PROMPT = """당신은 Meta-Commander AI 어시스턴트입니다. 디지털 마케팅 전문가로서 사용자의 Meta(Facebook/Instagram) 광고 운영을 돕습니다.

당신이 할 수 있는 일:
1. **시장 분석**: 경쟁사 분석, 키워드 트렌드, 타겟 오디언스 인사이트
2. **소재 제작 가이드**: 광고 카피 작성, 이미지/영상 아이디어, A/B 테스트 전략
3. **캠페인 기획**: 캠페인 구조 설계, 예산 배분, 타겟팅 전략
4. **광고 집행 조언**: Meta 광고 세팅, 입찰 전략, 최적화 팁
5. **성과 분석**: KPI 해석, ROAS 개선, 성과 보고서 작성

대화 시 주의사항:
- 한국어로 답변합니다
- 실무에서 바로 적용할 수 있는 구체적인 조언을 제공합니다
- 데이터 기반의 근거를 포함합니다
- 마케팅 용어는 한글과 영어를 병기합니다 (예: 클릭률(CTR))
- 플랫폼의 각 기능(시장분석, 소재제작, 캠페인기획, 광고집행, 성과분석)을 안내합니다
- 답변은 간결하되 핵심을 놓치지 않습니다

중요: 매 응답의 마지막에 사용자가 이어서 질문할 수 있는 관련 질문 3개를 제안하세요.
형식: 응답 본문 후 "---SUGGESTED---" 구분자 후에 줄바꿈으로 구분된 3개 질문을 작성하세요."""


@router.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """AI Command Center - 마케팅 AI 어시스턴트와 대화 (Meta 데이터 연동 + 추천 질문)."""
    from anthropic import Anthropic

    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="AI 서비스가 설정되지 않았습니다.")

    client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    # Fetch Meta context for the user
    meta_context = await get_user_meta_context(current_user)
    system_prompt = build_ai_system_prompt_with_context(SYSTEM_PROMPT, meta_context)

    # Build message history
    messages = []
    for msg in request.history[-20:]:
        messages.append({"role": msg.role, "content": msg.content})
    messages.append({"role": "user", "content": request.message})

    try:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2048,
            system=system_prompt,
            messages=messages,
        )
        full_reply = response.content[0].text

        # Parse suggested questions from the response
        suggested_questions = []
        reply = full_reply

        if "---SUGGESTED---" in full_reply:
            parts = full_reply.split("---SUGGESTED---", 1)
            reply = parts[0].strip()
            questions_text = parts[1].strip()
            suggested_questions = [
                q.strip().lstrip("0123456789.-) ")
                for q in questions_text.split("\n")
                if q.strip() and len(q.strip()) > 5
            ][:3]

        # Fallback: generate default suggestions if none parsed
        if not suggested_questions:
            suggested_questions = [
                "이 전략을 실제로 적용하려면 어떻게 해야 하나요?",
                "예산이 제한적일 때 우선순위는 어떻게 정하나요?",
                "성과 측정은 어떤 지표를 봐야 하나요?",
            ]

        return ChatResponse(reply=reply, suggested_questions=suggested_questions)
    except Exception as e:
        logger.error(f"Chat error: {e}")
        raise HTTPException(status_code=500, detail=f"AI 응답 생성 실패: {str(e)}")
