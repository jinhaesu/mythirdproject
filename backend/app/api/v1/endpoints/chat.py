"""AI Command Center - Claude chat with deep Meta account data."""
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_user
from app.core.config import get_settings
from app.db.database import get_db
from app.models.user import User
from app.services.meta_ads_service import MetaAdsService

logger = logging.getLogger(__name__)
router = APIRouter()
settings = get_settings()


class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    message: str
    history: List[ChatMessage] = []

class ChatResponse(BaseModel):
    reply: str
    suggested_questions: List[str] = []


SYSTEM_PROMPT = """당신은 Meta-Commander AI 어시스턴트입니다. 디지털 마케팅 전문가로서 사용자의 Meta(Facebook/Instagram) 광고 운영을 돕습니다.

핵심 역할:
1. **실시간 성과 분석**: 사용자의 실제 Meta 광고 계정 데이터를 알고 있습니다. 캠페인별 지출, CTR, CPC, 전환 등을 구체적으로 분석합니다.
2. **즉각적인 액션 추천**: "이 캠페인 예산 늘리세요", "이 광고 끄세요", "이 타겟 추가하세요" 같은 구체적 실행 조언
3. **캠페인 구조 설계**: 신제품/주력/소진용 구분, 광고 목적별 캠페인 트리
4. **타겟 설계**: Broad/관심사/리타겟 비중 배분, 성과 기반 타겟 추천
5. **카피라이팅**: 전환용/유입용/잠재고객용 카피 제품별 생성
6. **효율 모니터링**: 소재 피로도, 타겟별 ROAS 편차, 일별 광고비 대비 매출 분석
7. **소재 성과 예측**: CTR/CVR 패턴 분석, 신규 소재 방향 제안

대화 규칙:
- 한국어로 답변합니다
- 사용자의 실제 계정 데이터를 직접 언급하며 구체적으로 조언합니다 (예: "현재 A캠페인의 CTR이 1.2%인데, B캠페인은 2.8%입니다. A캠페인 예산을 B로 이전하는 것을 추천합니다")
- 데이터가 없는 영역은 솔직하게 말하고 일반적인 업계 벤치마크로 보완합니다
- 마케팅 용어는 한글+영어 병기 (예: 클릭률(CTR))
- 간결하되 핵심을 놓치지 않습니다

중요: 매 응답 마지막에 "---SUGGESTED---" 구분자 후 관련 후속 질문 3개를 줄바꿈으로 제안하세요."""


@router.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """AI chat with full Meta account context."""
    from anthropic import Anthropic

    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="AI 서비스가 설정되지 않았습니다.")

    client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    # Build deep Meta context (전체 계정 공유)
    svc = await MetaAdsService.create(current_user, db)
    meta_context = ""
    if svc.connected:
        try:
            meta_context = await svc.build_full_context_for_ai("last_7d")
        except Exception as e:
            logger.warning(f"Failed to build Meta context: {e}")
            meta_context = "Meta 계정이 연결되어 있지만 데이터를 가져오는 데 실패했습니다."
    else:
        meta_context = "Meta 광고 계정이 연결되지 않은 사용자입니다."

    system = f"""{SYSTEM_PROMPT}

--- 사용자의 실제 Meta 광고 계정 데이터 ---
{meta_context}

위 데이터를 바탕으로, 사용자의 질문에 실제 캠페인명/수치를 인용하며 구체적으로 답변하세요."""

    messages = []
    for msg in request.history[-20:]:
        messages.append({"role": msg.role, "content": msg.content})
    messages.append({"role": "user", "content": request.message})

    try:
        response = client.messages.create(
            model="claude-opus-4-8",
            max_tokens=3000,
            system=system,
            messages=messages,
        )
        full_reply = response.content[0].text

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

        if not suggested_questions:
            if svc.connected:
                suggested_questions = [
                    "현재 가장 성과가 좋은 캠페인은 뭐야?",
                    "예산을 어떻게 재배분하면 좋을까?",
                    "소재 피로도가 높은 광고가 있어?",
                ]
            else:
                suggested_questions = [
                    "Meta 계정 연동은 어떻게 하나요?",
                    "캠페인 구조를 어떻게 짜야 할까요?",
                    "광고 예산은 어떻게 설정하나요?",
                ]

        return ChatResponse(reply=reply, suggested_questions=suggested_questions)
    except Exception as e:
        logger.error(f"Chat error: {e}")
        raise HTTPException(status_code=500, detail=f"AI 응답 생성 실패: {str(e)}")
