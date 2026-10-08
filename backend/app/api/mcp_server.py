"""사내 클로드(데스크톱)용 MCP 엔드포인트 — 마케팅 데이터 읽기 전용 분석 도구.

MCP Streamable HTTP(무상태, JSON 응답)를 최소 구현으로 제공한다.
  POST /mcp?key=<MARKETING_MCP_KEY>   — initialize / tools/list / tools/call
클로드 데스크톱 연동:
  ① 커스텀 커넥터 URL: https://web-production-d7b11.up.railway.app/mcp?key=...
  ② 또는 claude_desktop_config.json → npx -y mcp-remote <같은 URL>

도구는 모두 읽기 전용 — 내부적으로 localhost 자기 API를 10분짜리 자체 JWT로 호출
(인증·집계 로직 재사용, 사내 MCP 서버들의 백엔드 호출 패턴과 동일).
"""
import json
import logging
import os
from datetime import timedelta
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Query, Request, Response
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.core.security import create_access_token

logger = logging.getLogger(__name__)
router = APIRouter()
settings = get_settings()

PROTOCOL_FALLBACK = "2025-03-26"


def _api_base() -> str:
    return f"http://127.0.0.1:{os.environ.get('PORT', '8000')}/api/v1"


async def _get(path: str, params: Optional[dict] = None) -> Any:
    token = create_access_token({"sub": "1"}, timedelta(minutes=10))
    async with httpx.AsyncClient(timeout=300) as client:
        r = await client.get(f"{_api_base()}{path}", params=params or {},
                             headers={"Authorization": f"Bearer {token}"})
    if r.status_code != 200:
        raise RuntimeError(f"{path} -> {r.status_code}: {r.text[:300]}")
    return r.json()


# ─── 도구 정의 ───────────────────────────────────────────────────────────────

TOOLS: list[dict] = [
    {
        "name": "marketing_overview",
        "description": "마케팅 전체 브리핑 — 자사몰 매출(이달/7일), Meta 7일·이달 손익, 광고비 일보 집행/Limit, 어필리에이트, 활동기록, 협찬, 네이버 언급량. 분석 시작점으로 먼저 호출 권장.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "roas_board",
        "description": "유입채널별 월 광고비×매출×ROAS 보드 (광고비 일보 + SALES 매출 자동연동). 손익분기 ROAS 기준 3.1~3.3. months_back 또는 month_from/month_to(YYYY-MM, 최대 24개월) 지정.",
        "inputSchema": {"type": "object", "properties": {
            "months_back": {"type": "integer", "minimum": 1, "maximum": 24},
            "month_from": {"type": "string", "description": "YYYY-MM"},
            "month_to": {"type": "string", "description": "YYYY-MM"},
        }},
    },
    {
        "name": "adspend_month_summary",
        "description": "특정 월 광고비 일보 요약 — 유입채널별 집행/Limit/사업계획과 합계·사용율. 금액 원(VAT포함).",
        "inputSchema": {"type": "object", "properties": {
            "month": {"type": "string", "description": "YYYY-MM"},
        }, "required": ["month"]},
    },
    {
        "name": "kpi_summary",
        "description": "자사몰 KPI 월별 요약 — 매출·주문·AOV·신규고객·방문·전환율·CAC·LTV·광고비. 카페24 주문 데이터 기반.",
        "inputSchema": {"type": "object", "properties": {
            "months": {"type": "integer", "minimum": 1, "maximum": 12, "default": 6},
        }},
    },
    {
        "name": "meta_daily",
        "description": "Meta(페이스북/인스타) 광고 캠페인×일별 성과 — 지출/노출/클릭/CTR/CPC/CPM/구매/전환매출/ROAS. 기간 지정 조회.",
        "inputSchema": {"type": "object", "properties": {
            "since": {"type": "string", "description": "YYYY-MM-DD"},
            "until": {"type": "string", "description": "YYYY-MM-DD"},
            "campaign_q": {"type": "string", "description": "캠페인명 검색어(선택)"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 1000, "default": 500},
        }, "required": ["since", "until"]},
    },
    {
        "name": "activities_summary",
        "description": "마케팅 활동 기록(콘텐츠/인플루언서/체험단/크루) 기간 집계 — 유형별 건수·조회수·비용.",
        "inputSchema": {"type": "object", "properties": {
            "month_from": {"type": "string", "description": "YYYY-MM"},
            "month_to": {"type": "string", "description": "YYYY-MM"},
        }, "required": ["month_from", "month_to"]},
    },
    {
        "name": "sponsorship_summary",
        "description": "협찬 집계 — 월별/품목별/종류별(전시·마라톤 등)/결과물 종류별 건수·수량·환산금액.",
        "inputSchema": {"type": "object", "properties": {
            "months": {"type": "integer", "minimum": 1, "maximum": 60, "default": 12},
        }},
    },
    {
        "name": "youtube_video_stats",
        "description": "유튜브 영상 공개 통계 — URL/ID로 조회수·좋아요·댓글수 (PPL·인플루언서 영상 추적).",
        "inputSchema": {"type": "object", "properties": {
            "video": {"type": "string", "description": "영상 URL 또는 11자 ID"},
        }, "required": ["video"]},
    },
    {
        "name": "kpi_daily",
        "description": "자사몰(카페24) 일별/주별 상세 — 기간 내 매출·주문·구매자·신규·방문·전환율의 일 단위 흐름. 월 요약보다 세밀한 분석용.",
        "inputSchema": {"type": "object", "properties": {
            "days": {"type": "integer", "minimum": 7, "maximum": 180, "default": 30},
            "granularity": {"type": "string", "enum": ["day", "week"], "default": "day"},
        }},
    },
    {
        "name": "mall_demographics",
        "description": "자사몰(카페24) 구매자 인구통계 — 연령대×성별 분포와 구매 패턴.",
        "inputSchema": {"type": "object", "properties": {
            "months": {"type": "integer", "minimum": 1, "maximum": 12, "default": 3},
        }},
    },
    {
        "name": "adspend_board_detail",
        "description": "광고비 일보 전체 그리드 — 특정 월의 매체(90여 개)별 담당자·유입채널·월합계·Limit·사용율·비고. include_daily=true면 매체별 일별 금액까지(응답 큼).",
        "inputSchema": {"type": "object", "properties": {
            "month": {"type": "string", "description": "YYYY-MM"},
            "include_daily": {"type": "boolean", "default": False},
        }, "required": ["month"]},
    },
    {
        "name": "activities_list",
        "description": "마케팅 활동 기록 개별 행 조회 — 유형(content/influencer/experience/crew)·기간·채널·제품·검색어 필터. 조회수/좋아요/댓글/비용/링크 포함.",
        "inputSchema": {"type": "object", "properties": {
            "month_from": {"type": "string", "description": "YYYY-MM"},
            "month_to": {"type": "string", "description": "YYYY-MM"},
            "activity_type": {"type": "string"},
            "channel": {"type": "string"},
            "product": {"type": "string"},
            "q": {"type": "string", "description": "검색어"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 500, "default": 100},
        }},
    },
    {
        "name": "creator_pool",
        "description": "인스타 크리에이터 풀 조회 — 잠재풀·유상구좌(팔로워·평균 반응·참여율·상태·단가). status: candidate|contacted|working|done|excluded.",
        "inputSchema": {"type": "object", "properties": {
            "status": {"type": "string"},
            "is_paid": {"type": "boolean"},
            "q": {"type": "string"},
        }},
    },
    {
        "name": "sponsorship_events",
        "description": "협찬 개별 건 조회 — 협찬처·종류·일자·품목·수량·환산금액·결과물(링크·조회수) 목록.",
        "inputSchema": {"type": "object", "properties": {
            "event_type": {"type": "string", "description": "종류 필터(전시, 마라톤 등)"},
            "since": {"type": "string", "description": "YYYY-MM-DD"},
            "until": {"type": "string", "description": "YYYY-MM-DD"},
            "q": {"type": "string"},
        }},
    },
]


async def _call_tool(name: str, args: dict) -> Any:
    if name == "marketing_overview":
        return await _get("/home/briefing")
    if name == "roas_board":
        params: dict = {}
        if args.get("month_from") and args.get("month_to"):
            params = {"month_from": args["month_from"], "month_to": args["month_to"]}
        else:
            params = {"months_back": args.get("months_back", 6)}
        return await _get("/adspend/roas-board", params)
    if name == "adspend_month_summary":
        return await _get("/adspend/monthly-summary", {"month": args["month"]})
    if name == "kpi_summary":
        return await _get("/kpi/summary", {"months": args.get("months", 6)})
    if name == "meta_daily":
        return await _get("/insights/daily-table", {
            "since": args["since"], "until": args["until"], "days": 400,
            "campaign_q": args.get("campaign_q") or None,
            "limit": args.get("limit", 500),
        })
    if name == "activities_summary":
        return await _get("/activities/summary", {
            "month_from": args["month_from"], "month_to": args["month_to"],
        })
    if name == "sponsorship_summary":
        return await _get("/sponsorship/summary", {"months": args.get("months", 12)})
    if name == "youtube_video_stats":
        return await _get("/social/youtube/video", {"video": args["video"]})
    if name == "kpi_daily":
        return await _get("/kpi/summary", {
            "days": args.get("days", 30),
            "granularity": args.get("granularity", "day"),
        })
    if name == "mall_demographics":
        return await _get("/kpi/demographics", {"months": args.get("months", 3)})
    if name == "adspend_board_detail":
        data = await _get("/adspend/board", {"month": args["month"]})
        if not args.get("include_daily"):
            for row in data.get("rows", []):
                row.pop("daily", None)
        return data
    if name == "activities_list":
        params = {k: v for k, v in {
            "month_from": args.get("month_from"), "month_to": args.get("month_to"),
            "activity_type": args.get("activity_type"), "channel": args.get("channel"),
            "product": args.get("product"), "q": args.get("q"),
            "limit": args.get("limit", 100),
        }.items() if v is not None}
        return await _get("/activities", params)
    if name == "creator_pool":
        params = {k: v for k, v in {
            "status": args.get("status"), "is_paid": args.get("is_paid"),
            "q": args.get("q"),
        }.items() if v is not None}
        return await _get("/social/creators", params)
    if name == "sponsorship_events":
        params = {k: v for k, v in {
            "event_type": args.get("event_type"), "since": args.get("since"),
            "until": args.get("until"), "q": args.get("q"),
        }.items() if v is not None}
        return await _get("/sponsorship/events", params)
    raise RuntimeError(f"알 수 없는 도구: {name}")


# ─── MCP Streamable HTTP (무상태 최소 구현) ──────────────────────────────────

def _rpc_result(id_: Any, result: dict) -> JSONResponse:
    return JSONResponse({"jsonrpc": "2.0", "id": id_, "result": result},
                        headers={"Mcp-Session-Id": "stateless"})


def _rpc_error(id_: Any, code: int, message: str) -> JSONResponse:
    return JSONResponse({"jsonrpc": "2.0", "id": id_,
                         "error": {"code": code, "message": message}})


def _check_key(key: str) -> bool:
    return bool(settings.MARKETING_MCP_KEY) and key == settings.MARKETING_MCP_KEY


@router.get("/mcp")
async def mcp_get(key: str = Query(default="")):
    # SSE 스트림 미지원(무상태) — 스펙상 405 허용
    if not _check_key(key):
        return Response(status_code=401)
    return Response(status_code=405)


@router.post("/mcp")
async def mcp_post(request: Request, key: str = Query(default="")):
    if not _check_key(key):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    try:
        body = await request.json()
    except Exception:
        return _rpc_error(None, -32700, "Parse error")
    if isinstance(body, list):  # 배치는 첫 메시지만 처리(클로드 클라이언트는 단건 전송)
        body = body[0] if body else {}

    method = body.get("method", "")
    id_ = body.get("id")

    # 알림(notification)은 id가 없다 — 202로 수신 확인만
    if id_ is None:
        return Response(status_code=202)

    if method == "initialize":
        proto = (body.get("params") or {}).get("protocolVersion") or PROTOCOL_FALLBACK
        return _rpc_result(id_, {
            "protocolVersion": proto,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "nuldam-marketing-mcp", "version": "1.0.0"},
            "instructions": (
                "널담 마케팅 시스템(marketing.nuldam.com) 읽기 전용 데이터 도구. "
                "금액은 원 단위, 광고비는 VAT포함·SALES 매출은 공급가(VAT별도). "
                "ROAS 손익분기 기준 3.1~3.3 (그 밑은 공헌이익 적자)."
            ),
        })
    if method == "ping":
        return _rpc_result(id_, {})
    if method == "tools/list":
        return _rpc_result(id_, {"tools": TOOLS})
    if method == "tools/call":
        params = body.get("params") or {}
        name = params.get("name", "")
        args = params.get("arguments") or {}
        try:
            data = await _call_tool(name, args)
            text = json.dumps(data, ensure_ascii=False, default=str)
            # 과대 응답 방어 (클라이언트 컨텍스트 보호)
            if len(text) > 400_000:
                text = text[:400_000] + "\n...[truncated — 기간/limit을 줄여 다시 조회하세요]"
            return _rpc_result(id_, {"content": [{"type": "text", "text": text}],
                                     "isError": False})
        except Exception as e:
            logger.warning(f"[MCP] tools/call {name} 실패: {e}")
            return _rpc_result(id_, {"content": [{"type": "text", "text": f"오류: {e}"}],
                                     "isError": True})
    if method in ("resources/list", "prompts/list"):
        return _rpc_result(id_, {"resources": []} if method == "resources/list" else {"prompts": []})
    return _rpc_error(id_, -32601, f"Method not found: {method}")


@router.delete("/mcp")
async def mcp_delete(key: str = Query(default="")):
    return Response(status_code=200 if _check_key(key) else 401)
