"""AI Command Center - Claude chat endpoint."""
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_user
from app.core.config import get_settings
from app.db.database import get_db
from app.models.user import User

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
- 답변은 간결하되 핵심을 놓치지 않습니다"""


@router.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    current_user: User = Depends(get_current_user),
):
    """AI Command Center - 마케팅 AI 어시스턴트와 대화."""
    from anthropic import Anthropic

    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="AI 서비스가 설정되지 않았습니다.")

    client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    # Build message history
    messages = []
    for msg in request.history[-20:]:  # Last 20 messages
        messages.append({"role": msg.role, "content": msg.content})
    messages.append({"role": "user", "content": request.message})

    try:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2048,
            system=SYSTEM_PROMPT,
            messages=messages,
        )
        reply = response.content[0].text
        return ChatResponse(reply=reply)
    except Exception as e:
        logger.error(f"Chat error: {e}")
        raise HTTPException(status_code=500, detail=f"AI 응답 생성 실패: {str(e)}")
