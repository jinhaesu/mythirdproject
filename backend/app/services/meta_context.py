"""Common Meta context service for AI-powered features."""
import logging
from typing import Dict, Any, Optional

import httpx

from app.core.config import get_settings
from app.models.user import User

logger = logging.getLogger(__name__)
settings = get_settings()


async def get_user_meta_context(user: User) -> Dict[str, Any]:
    """
    Build a Meta account context summary for AI system prompts.

    Returns a dict with account info, active campaigns, recent performance, etc.
    If the user has no Meta connection, returns a minimal context.
    """
    context: Dict[str, Any] = {
        "meta_connected": bool(user.meta_access_token),
        "has_ig_account": bool(user.meta_ig_account_id),
        "has_ad_account": bool(user.meta_ad_account_id),
        "summary_text": "",
        "campaigns": [],
        "account_info": {},
    }

    if not user.meta_access_token:
        context["summary_text"] = "Meta 계정이 연결되지 않은 사용자입니다. 일반적인 마케팅 조언을 제공하세요."
        return context

    base_url = f"{settings.META_GRAPH_API_BASE}/{settings.META_API_VERSION}"

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            # Get ad account info
            if user.meta_ad_account_id:
                ad_account_id = user.meta_ad_account_id
                if not ad_account_id.startswith("act_"):
                    ad_account_id = f"act_{ad_account_id}"

                # Fetch active campaigns
                campaigns_resp = await client.get(
                    f"{base_url}/{ad_account_id}/campaigns",
                    params={
                        "access_token": user.meta_access_token,
                        "fields": "id,name,status,objective,daily_budget,lifetime_budget",
                        "limit": 10,
                        "effective_status": '["ACTIVE","PAUSED"]',
                    }
                )

                if campaigns_resp.status_code == 200:
                    campaigns_data = campaigns_resp.json().get("data", [])
                    context["campaigns"] = campaigns_data
                    active_count = sum(1 for c in campaigns_data if c.get("status") == "ACTIVE")
                    paused_count = sum(1 for c in campaigns_data if c.get("status") == "PAUSED")
                    context["account_info"]["active_campaigns"] = active_count
                    context["account_info"]["paused_campaigns"] = paused_count

                # Fetch recent account-level insights (last 7 days)
                insights_resp = await client.get(
                    f"{base_url}/{ad_account_id}/insights",
                    params={
                        "access_token": user.meta_access_token,
                        "fields": "spend,impressions,clicks,actions,cost_per_action_type",
                        "date_preset": "last_7d",
                    }
                )

                if insights_resp.status_code == 200:
                    insights_data = insights_resp.json().get("data", [])
                    if insights_data:
                        insight = insights_data[0]
                        context["account_info"]["last_7d_spend"] = insight.get("spend", "0")
                        context["account_info"]["last_7d_impressions"] = insight.get("impressions", "0")
                        context["account_info"]["last_7d_clicks"] = insight.get("clicks", "0")

            # Build summary text for AI prompt
            info = context["account_info"]
            parts = ["Meta 광고 계정이 연결된 사용자입니다."]

            if info.get("active_campaigns") is not None:
                parts.append(f"활성 캠페인: {info['active_campaigns']}개, 일시중지: {info.get('paused_campaigns', 0)}개")

            if info.get("last_7d_spend"):
                parts.append(f"최근 7일 지출: ₩{info['last_7d_spend']}, 노출: {info.get('last_7d_impressions', 'N/A')}, 클릭: {info.get('last_7d_clicks', 'N/A')}")

            if context["campaigns"]:
                campaign_names = [c.get("name", "N/A") for c in context["campaigns"][:5]]
                parts.append(f"캠페인 목록: {', '.join(campaign_names)}")

            context["summary_text"] = " ".join(parts)

    except Exception as e:
        logger.warning(f"Failed to fetch Meta context for user {user.id}: {e}")
        context["summary_text"] = "Meta 계정이 연결되어 있지만 현재 데이터를 가져올 수 없습니다."

    return context


def build_ai_system_prompt_with_context(base_prompt: str, meta_context: Dict[str, Any]) -> str:
    """Append Meta account context to an AI system prompt."""
    context_text = meta_context.get("summary_text", "")
    if not context_text:
        return base_prompt

    return f"""{base_prompt}

--- 사용자 계정 정보 ---
{context_text}

위 정보를 바탕으로 사용자의 실제 데이터와 상황에 맞는 구체적인 조언을 제공하세요."""
