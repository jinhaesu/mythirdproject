"""Campaign Planner endpoints for structure design, targeting, copywriting, UTM, and analytics."""
from typing import List, Optional
import json
import csv
import io
import re
from urllib.parse import urlencode, quote

import httpx
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.api.v1.endpoints.auth import get_current_user
from app.models.user import User
from app.services.ai import ClaudeService
from app.services.meta_ads_service import MetaAdsService
from app.schemas.campaign_planner import (
    # Structure
    CampaignStructureRequest, CampaignStructureResponse,
    CampaignGroupNode, AdSetSuggestion, CreativeApproach,
    # Targeting
    TargetingRequest, TargetingResponse, TargetSegment,
    # Copywriting
    CopywritingRequest, CopywritingResponse,
    ProductCopyResult, CopyVariation,
    # UTM
    UTMRequest, UTMResponse, UTMLink,
    # CSV Analysis
    CSVAnalysisResponse, ChartData, ChartDataPoint,
    # Creative Prediction
    PredictCreativeRequest, PredictCreativeResponse, SimilarCreative,
    # Enums
    CSVPlatform, AnalysisType,
)

router = APIRouter()


# ──────────────────────────────────────────────
# Helper: Parse JSON from Claude response
# ──────────────────────────────────────────────

def _parse_json_response(text: str) -> dict:
    """Extract and parse JSON from Claude's text response with robust error recovery."""
    import logging
    _logger = logging.getLogger(__name__)

    # 1. Try extracting from ```json ... ``` block first
    if "```json" in text:
        block = text.split("```json")[1].split("```")[0].strip()
        try:
            return json.loads(block)
        except json.JSONDecodeError:
            pass
    elif "```" in text:
        parts = text.split("```")
        if len(parts) >= 3:
            block = parts[1].strip()
            if block.startswith("json"):
                block = block[4:].strip()
            try:
                return json.loads(block)
            except json.JSONDecodeError:
                pass

    # 2. Balanced brace matching for nested JSON
    start = text.find("{")
    if start >= 0:
        depth = 0
        in_string = False
        escape = False
        for i in range(start, len(text)):
            c = text[i]
            if escape:
                escape = False
                continue
            if c == '\\':
                escape = True
                continue
            if c == '"' and not escape:
                in_string = not in_string
                continue
            if in_string:
                continue
            if c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:i + 1])
                    except json.JSONDecodeError:
                        break

    # 3. Aggressive cleanup: fix common JSON issues from AI
    cleaned = text
    # Remove markdown
    for prefix in ["```json", "```"]:
        cleaned = cleaned.replace(prefix, "")
    cleaned = cleaned.strip()

    start = cleaned.find("{")
    end = cleaned.rfind("}") + 1
    if start >= 0 and end > start:
        json_str = cleaned[start:end]
        # Fix trailing commas before } or ]
        json_str = re.sub(r',\s*([}\]])', r'\1', json_str)
        # Fix unquoted keys (simple cases)
        json_str = re.sub(r'(?<=\{|,)\s*(\w+)\s*:', r' "\1":', json_str)
        try:
            return json.loads(json_str)
        except json.JSONDecodeError as e:
            _logger.warning(f"JSON parse after cleanup failed: {e}")

    # 4. Try array
    start = text.find("[")
    end = text.rfind("]") + 1
    if start >= 0 and end > start:
        try:
            return json.loads(text[start:end])
        except json.JSONDecodeError:
            pass

    raise ValueError("JSON을 파싱할 수 없습니다.")


def _sanitize_utm(value: str) -> str:
    """Convert a string to a valid UTM parameter (snake_case, lowercase)."""
    value = value.lower().strip()
    value = re.sub(r"[^a-z0-9가-힣\s_-]", "", value)
    value = re.sub(r"[\s-]+", "_", value)
    value = re.sub(r"_+", "_", value)
    return value.strip("_")


# ──────────────────────────────────────────────
# 1. Campaign Structure Design
# ──────────────────────────────────────────────

@router.post("/structure", response_model=CampaignStructureResponse)
async def design_campaign_structure(
    request: CampaignStructureRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    AI 기반 캠페인 구조 설계.

    제품 리스트, 일정, 예산, 브랜드 정보를 받아
    카테고리별 캠페인 트리를 자동 생성합니다.
    """
    products_text = "\n".join([
        f"- {p.name} | 카테고리: {p.category.value} | 가격: {p.price:,.0f}원 | 프로모션: {p.promo_info or '없음'}"
        for p in request.product_list
    ])

    prompt = f"""당신은 Meta 광고 캠페인 전문 플래너입니다.
다음 정보를 바탕으로 캠페인 구조를 설계해주세요.

[브랜드] {request.brand_name}
[총 예산] {request.total_budget:,.0f}원
[프로모션 기간] {request.schedule.promo_start_date} ~ {request.schedule.promo_end_date}

[제품 리스트]
{products_text}

다음 규칙에 따라 캠페인 트리를 설계하세요:
1. 제품 카테고리별로 그룹핑 (신제품 런칭, 주력 매출, 소진 할인)
2. 각 그룹별 캠페인 목적 추천 (TRAFFIC, CONVERSIONS, LEAD_GENERATION)
3. 그룹별 예산 배분 (비율 및 금액)
4. 각 그룹 내 광고세트 구조 (타겟 오디언스 세그먼트별)
5. 각 그룹별 크리에이티브 접근법

JSON 형식으로 응답:
{{
    "campaign_tree": [
        {{
            "group_name": "신제품 런칭",
            "category": "신제품",
            "products": ["제품A"],
            "objective": "CONVERSIONS",
            "budget_allocation": 500000,
            "budget_ratio": 50,
            "ad_sets": [
                {{
                    "name": "관심사 타겟 - 뷰티",
                    "target_audience": "25-34세 여성, 뷰티 관심사",
                    "budget_ratio": 60,
                    "estimated_reach": 50000
                }}
            ],
            "creative_approach": {{
                "format": "이미지 + 영상",
                "concept": "신제품 언박싱 & 사용 후기",
                "key_message": "새로운 경험을 만나보세요"
            }},
            "reasoning": "신제품은 전환 최적화로 초기 구매 유도가 핵심입니다"
        }}
    ],
    "overall_strategy": "전체 전략 요약 설명",
    "expected_total_reach": 200000
}}"""

    claude = ClaudeService()

    try:
        response = claude.client.messages.create(
            model=claude.model,
            max_tokens=4000,
            messages=[{"role": "user", "content": prompt}],
        )
        result = _parse_json_response(response.content[0].text)
    except (json.JSONDecodeError, ValueError, IndexError) as e:
        raise HTTPException(status_code=500, detail=f"AI 응답 파싱 실패: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI 서비스 오류: {str(e)}")

    # Build response
    tree_nodes = []
    for node in result.get("campaign_tree", []):
        creative = None
        if node.get("creative_approach"):
            ca = node["creative_approach"]
            creative = CreativeApproach(
                format=ca.get("format", ""),
                concept=ca.get("concept", ""),
                key_message=ca.get("key_message", ""),
            )

        ad_sets = [
            AdSetSuggestion(
                name=a.get("name", ""),
                target_audience=a.get("target_audience", ""),
                budget_ratio=a.get("budget_ratio", 0),
                estimated_reach=a.get("estimated_reach"),
            )
            for a in node.get("ad_sets", [])
        ]

        tree_nodes.append(CampaignGroupNode(
            group_name=node.get("group_name", ""),
            category=node.get("category", ""),
            products=node.get("products", []),
            objective=node.get("objective", "CONVERSIONS"),
            budget_allocation=node.get("budget_allocation", 0),
            budget_ratio=node.get("budget_ratio", 0),
            ad_sets=ad_sets,
            creative_approach=creative,
            reasoning=node.get("reasoning"),
        ))

    return CampaignStructureResponse(
        brand_name=request.brand_name,
        total_budget=request.total_budget,
        schedule=request.schedule,
        campaign_tree=tree_nodes,
        overall_strategy=result.get("overall_strategy", ""),
        expected_total_reach=result.get("expected_total_reach"),
    )


# ──────────────────────────────────────────────
# 2. Target Audience Design
# ──────────────────────────────────────────────

@router.post("/targeting", response_model=TargetingResponse)
async def design_targeting(
    request: TargetingRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    AI 기반 타겟 오디언스 설계.

    제품 카테고리와 예산을 기반으로
    브로드/관심사/리타겟팅/유사 세그먼트 구조를 생성합니다.
    """
    past_data_text = ""
    if request.past_performance_data:
        pd = request.past_performance_data
        past_data_text = f"""
[과거 성과 데이터]
- 평균 CTR: {pd.avg_ctr or 'N/A'}%
- 평균 CPC: {pd.avg_cpc or 'N/A'}원
- 평균 ROAS: {pd.avg_roas or 'N/A'}
- 총 전환: {pd.total_conversions or 'N/A'}건
- 성과 좋은 오디언스: {', '.join(pd.top_audiences) if pd.top_audiences else 'N/A'}
"""

    prompt = f"""당신은 Meta 광고 타겟팅 전문가입니다.
다음 조건에 맞는 타겟 구조 테이블을 설계해주세요.

[제품 카테고리] {request.product_category.value}
[예산] {request.budget:,.0f}원
[브랜드 정보] {request.brand_info or '없음'}
{past_data_text}

4가지 타겟 세그먼트를 설계하세요:
1. 브로드 타겟 (Broad) - 넓은 타겟
2. 관심사 타겟 (Interest) - 관심사 기반
3. 리타겟팅 (Retargeting) - 기존 방문자/고객
4. 유사 타겟 (Lookalike) - 기존 고객과 유사한 사용자

제품 카테고리에 따라 각 세그먼트의 비중을 최적화해주세요.
- 신제품: 브로드와 관심사 비중 높게
- 주력: 리타겟팅과 유사 비중 높게
- 소진용: 리타겟팅 위주, 할인 소구

JSON 형식으로 응답:
{{
    "segments": [
        {{
            "segment_type": "브로드",
            "ratio": 20,
            "budget": 200000,
            "estimated_reach": 100000,
            "description": "25-45세 전체, 성별 무관",
            "interest_list": null,
            "retarget_audience": null,
            "lookalike_source": null
        }},
        {{
            "segment_type": "관심사",
            "ratio": 35,
            "budget": 350000,
            "estimated_reach": 60000,
            "description": "뷰티, 스킨케어 관심사 타겟",
            "interest_list": ["스킨케어", "뷰티", "화장품"],
            "retarget_audience": null,
            "lookalike_source": null
        }},
        {{
            "segment_type": "리타겟팅",
            "ratio": 25,
            "budget": 250000,
            "estimated_reach": 15000,
            "description": "최근 30일 웹사이트 방문자",
            "interest_list": null,
            "retarget_audience": "최근 30일 사이트 방문자 + 장바구니 이탈자",
            "lookalike_source": null
        }},
        {{
            "segment_type": "유사",
            "ratio": 20,
            "budget": 200000,
            "estimated_reach": 80000,
            "description": "구매 고객 기반 1-3% 유사 타겟",
            "interest_list": null,
            "retarget_audience": null,
            "lookalike_source": "구매 완료 고객 리스트 기반 1-3%"
        }}
    ],
    "strategy_summary": "전략 요약",
    "recommendations": ["추천1", "추천2"]
}}"""

    claude = ClaudeService()

    try:
        response = claude.client.messages.create(
            model=claude.model,
            max_tokens=3000,
            messages=[{"role": "user", "content": prompt}],
        )
        result = _parse_json_response(response.content[0].text)
    except (json.JSONDecodeError, ValueError, IndexError) as e:
        raise HTTPException(status_code=500, detail=f"AI 응답 파싱 실패: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI 서비스 오류: {str(e)}")

    segments = [
        TargetSegment(
            segment_type=s.get("segment_type", ""),
            ratio=s.get("ratio", 0),
            budget=s.get("budget", 0),
            estimated_reach=s.get("estimated_reach", 0),
            description=s.get("description", ""),
            interest_list=s.get("interest_list"),
            retarget_audience=s.get("retarget_audience"),
            lookalike_source=s.get("lookalike_source"),
        )
        for s in result.get("segments", [])
    ]

    return TargetingResponse(
        product_category=request.product_category.value,
        total_budget=request.budget,
        segments=segments,
        strategy_summary=result.get("strategy_summary", ""),
        recommendations=result.get("recommendations", []),
    )


# ──────────────────────────────────────────────
# 3. Copywriting Generation
# ──────────────────────────────────────────────

@router.post("/copywriting", response_model=CopywritingResponse)
async def generate_copywriting(
    request: CopywritingRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    AI 기반 광고 카피 생성.

    제품별 x 목적별로 헤드라인, 본문, 설명, CTA를 3개 변형씩 생성합니다.
    """
    products_text = "\n".join([
        f"- {p.name}: {p.description} | 가격: {p.price:,.0f}원 | 프로모션: {p.promo or '없음'}"
        for p in request.products
    ])

    prompt = f"""당신은 Meta 광고 카피라이터 전문가입니다.
다음 제품들에 대해 광고 카피를 생성해주세요.

[제품 리스트]
{products_text}

[카피 목적] {request.purpose.value}
[브랜드 보이스] {request.brand_voice or '기본 (자연스럽고 친근한)'}
[톤] {request.tone or '기본'}

각 제품에 대해 3개의 변형 카피를 생성하세요.
규칙:
- headline: 30자 이내
- primary_text: 125자 이내
- description: 30자 이내
- CTA: 적절한 CTA 버튼 텍스트 추천

목적별 가이드:
- 전환용: 구매 유도, 할인/혜택 강조, 긴급성
- 유입용: 호기심 유발, 클릭 유도, 정보 제공
- 잠재고객용: 문의 유도, 가치 제안, 신뢰 형성

JSON 형식으로 응답:
{{
    "results": [
        {{
            "product_name": "제품명",
            "purpose": "{request.purpose.value}",
            "variations": [
                {{
                    "headline": "헤드라인 텍스트",
                    "primary_text": "본문 텍스트",
                    "description": "설명 텍스트",
                    "cta": "지금 구매하기"
                }},
                {{
                    "headline": "헤드라인 변형2",
                    "primary_text": "본문 변형2",
                    "description": "설명 변형2",
                    "cta": "더 알아보기"
                }},
                {{
                    "headline": "헤드라인 변형3",
                    "primary_text": "본문 변형3",
                    "description": "설명 변형3",
                    "cta": "무료 체험하기"
                }}
            ]
        }}
    ]
}}"""

    claude = ClaudeService()

    try:
        response = claude.client.messages.create(
            model=claude.model,
            max_tokens=4000,
            messages=[{"role": "user", "content": prompt}],
        )
        result = _parse_json_response(response.content[0].text)
    except (json.JSONDecodeError, ValueError, IndexError) as e:
        raise HTTPException(status_code=500, detail=f"AI 응답 파싱 실패: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI 서비스 오류: {str(e)}")

    copy_results = []
    for item in result.get("results", []):
        variations = [
            CopyVariation(
                headline=v.get("headline", ""),
                primary_text=v.get("primary_text", ""),
                description=v.get("description", ""),
                cta=v.get("cta", "더 알아보기"),
            )
            for v in item.get("variations", [])
        ]
        copy_results.append(ProductCopyResult(
            product_name=item.get("product_name", ""),
            purpose=item.get("purpose", request.purpose.value),
            variations=variations,
        ))

    return CopywritingResponse(
        results=copy_results,
        brand_voice_applied=request.brand_voice,
    )


# ──────────────────────────────────────────────
# 4. UTM Generator
# ──────────────────────────────────────────────

@router.post("/utm", response_model=UTMResponse)
async def generate_utm_links(
    request: UTMRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    UTM 링크 자동 생성.

    제품, 캠페인명, 플랫폼 조합별 UTM 링크를 일괄 생성합니다.
    규칙: snake_case, lowercase, 일관된 네이밍.
    """
    platform_medium_map = {
        "meta": "paid_social",
        "naver": "paid_search",
        "google": "paid_search",
    }

    links = []

    for product in request.products:
        for campaign_name in request.campaign_names:
            for platform in request.platforms:
                utm_source = _sanitize_utm(platform.value)
                utm_medium = platform_medium_map.get(platform.value, "paid_social")
                utm_campaign = _sanitize_utm(campaign_name)
                utm_content = _sanitize_utm(product)
                utm_term = _sanitize_utm(f"{product}_{campaign_name}")

                params = {
                    "utm_source": utm_source,
                    "utm_medium": utm_medium,
                    "utm_campaign": utm_campaign,
                    "utm_content": utm_content,
                    "utm_term": utm_term,
                }

                separator = "&" if "?" in request.base_url else "?"
                full_url = f"{request.base_url}{separator}{urlencode(params, quote_via=quote)}"

                links.append(UTMLink(
                    product=product,
                    campaign=campaign_name,
                    platform=platform.value,
                    utm_source=utm_source,
                    utm_medium=utm_medium,
                    utm_campaign=utm_campaign,
                    utm_content=utm_content,
                    utm_term=utm_term,
                    full_url=full_url,
                ))

    return UTMResponse(
        base_url=request.base_url,
        total_links=len(links),
        links=links,
    )


# ──────────────────────────────────────────────
# 5. CSV Performance Analysis
# ──────────────────────────────────────────────

@router.post("/analyze-csv", response_model=CSVAnalysisResponse)
async def analyze_csv_performance(
    file: UploadFile = File(..., description="CSV 파일 (Meta/Naver 광고 관리자 내보내기)"),
    platform: CSVPlatform = Form(..., description="플랫폼 (meta/naver)"),
    analysis_type: AnalysisType = Form(..., description="분석 유형 (daily/creative/target)"),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    CSV 성과 데이터 분석.

    Meta/Naver 광고 관리자에서 내보낸 CSV를 업로드하면
    일별 추이, 소재 피로도, 타겟별 ROAS, 이상 탐지를 수행합니다.
    """
    # Read and parse CSV
    try:
        content = await file.read()
        # Try UTF-8 first, then cp949 (Korean encoding)
        try:
            text_content = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            text_content = content.decode("cp949")

        reader = csv.DictReader(io.StringIO(text_content))
        rows = list(reader)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"CSV 파일 파싱 실패: {str(e)}")

    if not rows:
        raise HTTPException(status_code=400, detail="CSV 파일에 데이터가 없습니다.")

    # Limit rows for AI prompt (avoid token overflow)
    sample_rows = rows[:100]
    columns = list(sample_rows[0].keys()) if sample_rows else []

    csv_preview = f"컬럼: {', '.join(columns)}\n"
    csv_preview += f"총 행 수: {len(rows)}\n\n"
    csv_preview += "샘플 데이터 (최대 20행):\n"
    for i, row in enumerate(sample_rows[:20]):
        csv_preview += f"행{i+1}: {json.dumps(row, ensure_ascii=False)}\n"

    # Build summary stats from the data
    numeric_summary = ""
    try:
        numeric_cols = []
        for col in columns:
            try:
                vals = [float(str(row.get(col, "0")).replace(",", "").replace("%", ""))
                        for row in rows if row.get(col)]
                if vals:
                    numeric_cols.append(f"- {col}: 평균={sum(vals)/len(vals):.2f}, 최소={min(vals):.2f}, 최대={max(vals):.2f}")
            except (ValueError, TypeError):
                continue
        numeric_summary = "\n".join(numeric_cols)
    except Exception:
        numeric_summary = "수치 요약 생성 불가"

    analysis_type_kr = {
        "daily": "일별 지출 vs 매출 추이",
        "creative": "소재별 성과 및 피로도 분석",
        "target": "타겟별 ROAS 분석",
    }

    prompt = f"""당신은 퍼포먼스 마케팅 분석 전문가입니다.
다음 {platform.value} 광고 데이터를 분석해주세요.

[분석 유형] {analysis_type_kr.get(analysis_type.value, analysis_type.value)}
[플랫폼] {platform.value}

[데이터 미리보기]
{csv_preview}

[수치 요약]
{numeric_summary}

다음 관점에서 분석하세요:
1. 일별 지출 vs 매출 추이 (daily)
2. 소재 피로도 감지 - CTR이 시간에 따라 하락하는 소재 (creative)
3. 타겟별 ROAS 편차 분석 (target)
4. 이상치 탐지 - 갑작스러운 성과 변동

실행 가능한 액션 아이템을 한국어로 구체적으로 제안하세요.
예: "이 광고세트 끄세요", "이 소재 교체 시점입니다", "예산 재분배 필요"

JSON 형식으로 응답:
{{
    "summary": "전체 분석 요약 (3-5문장)",
    "action_items": [
        "구체적인 액션1",
        "구체적인 액션2"
    ],
    "charts": [
        {{
            "chart_type": "line",
            "title": "일별 지출 추이",
            "data_points": [
                {{"label": "03/01", "value": 50000, "secondary_value": 120000}}
            ]
        }}
    ],
    "anomalies": [
        "3월 5일 CTR이 전일 대비 50% 급감 - 소재 피로도 의심"
    ],
    "raw_metrics": {{
        "total_spend": 1000000,
        "total_revenue": 3000000,
        "avg_roas": 3.0,
        "avg_ctr": 1.5
    }}
}}"""

    claude = ClaudeService()

    try:
        response = claude.client.messages.create(
            model=claude.model,
            max_tokens=4000,
            messages=[{"role": "user", "content": prompt}],
        )
        result = _parse_json_response(response.content[0].text)
    except (json.JSONDecodeError, ValueError, IndexError) as e:
        raise HTTPException(status_code=500, detail=f"AI 응답 파싱 실패: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI 서비스 오류: {str(e)}")

    # Build chart data
    charts = []
    for chart in result.get("charts", []):
        data_points = [
            ChartDataPoint(
                label=dp.get("label", ""),
                value=dp.get("value", 0),
                secondary_value=dp.get("secondary_value"),
            )
            for dp in chart.get("data_points", [])
        ]
        charts.append(ChartData(
            chart_type=chart.get("chart_type", "line"),
            title=chart.get("title", ""),
            data_points=data_points,
        ))

    return CSVAnalysisResponse(
        platform=platform.value,
        analysis_type=analysis_type.value,
        summary=result.get("summary", ""),
        action_items=result.get("action_items", []),
        charts=charts,
        anomalies=result.get("anomalies", []),
        raw_metrics=result.get("raw_metrics"),
    )


# ──────────────────────────────────────────────
# 6. Creative Performance Prediction
# ──────────────────────────────────────────────

@router.post("/predict-creative", response_model=PredictCreativeResponse)
async def predict_creative_performance(
    request: PredictCreativeRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    소재 성과 예측.

    과거 소재 성과 데이터를 분석하여
    새 소재의 예상 CTR/CVR 범위와 추천 사항을 제공합니다.
    """
    past_text = "\n".join([
        f"- 유형: {c.type} | 스타일: {c.style} | CTR: {c.ctr}% | CVR: {c.cvr}% | 지출: {c.spend:,.0f}원"
        for c in request.past_creatives
    ])

    prompt = f"""당신은 광고 소재 성과 분석 전문가입니다.
과거 소재 데이터를 분석하고, 새 소재의 성과를 예측해주세요.

[과거 소재 데이터]
{past_text}

[새 소재 설명]
{request.new_creative_description}

다음을 분석하세요:
1. 과거 데이터에서 패턴 추출 (어떤 유형/스타일이 성과가 좋았는지)
2. 새 소재와 유사한 과거 소재 식별
3. 예상 CTR/CVR 범위 산출
4. 신뢰도 평가
5. 성과 향상을 위한 구체적인 추천

JSON 형식으로 응답:
{{
    "predicted_ctr_range": [1.2, 2.5],
    "predicted_cvr_range": [0.5, 1.8],
    "confidence": 0.75,
    "similar_past_creatives": [
        {{
            "type": "이미지",
            "style": "감성적",
            "ctr": 2.1,
            "cvr": 1.2,
            "similarity_reason": "비슷한 감성적 톤의 이미지 소재"
        }}
    ],
    "recommendations": [
        "과거 데이터 기준 감성적 이미지가 CTR이 높으므로 감성 소구 강화 추천",
        "동영상 소재가 CVR이 높으므로 영상 버전도 제작 추천"
    ]
}}"""

    claude = ClaudeService()

    try:
        response = claude.client.messages.create(
            model=claude.model,
            max_tokens=3000,
            messages=[{"role": "user", "content": prompt}],
        )
        result = _parse_json_response(response.content[0].text)
    except (json.JSONDecodeError, ValueError, IndexError) as e:
        raise HTTPException(status_code=500, detail=f"AI 응답 파싱 실패: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI 서비스 오류: {str(e)}")

    similar = [
        SimilarCreative(
            type=s.get("type", ""),
            style=s.get("style", ""),
            ctr=s.get("ctr", 0),
            cvr=s.get("cvr", 0),
            similarity_reason=s.get("similarity_reason", ""),
        )
        for s in result.get("similar_past_creatives", [])
    ]

    return PredictCreativeResponse(
        predicted_ctr_range=result.get("predicted_ctr_range", [0, 0]),
        predicted_cvr_range=result.get("predicted_cvr_range", [0, 0]),
        confidence=result.get("confidence", 0.5),
        similar_past_creatives=similar,
        recommendations=result.get("recommendations", []),
    )


# ──────────────────────────────────────────────
# 7. One-Click Auto Plan (통합 캠페인 기획)
# ──────────────────────────────────────────────

class AutoPlanRequest(BaseModel):
    product_url: Optional[str] = Field(None, description="제품 URL (자동으로 정보 추출)")
    product_name: Optional[str] = Field(None, description="제품명 (URL 없을 경우)")
    product_description: Optional[str] = Field(None, description="제품 설명")
    product_price: Optional[float] = Field(None, description="제품 가격")
    budget: float = Field(..., description="총 예산 (원)")
    start_date: Optional[str] = Field(None, description="시작일 (YYYY-MM-DD)")
    end_date: Optional[str] = Field(None, description="종료일 (YYYY-MM-DD)")


class AutoPlanResponse(BaseModel):
    product_info: dict
    campaign_structure: dict
    targeting: dict
    copywriting: dict
    utm_links: List[dict] = []
    overall_strategy: str
    meta_recommendations: Optional[str] = None
    creative_recommendation: Optional[dict] = None


async def _scrape_product_info(url: str) -> dict:
    """Scrape product info from URL."""
    import logging
    logger = logging.getLogger(__name__)
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True, verify=True) as client:
            resp = await client.get(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
                "Accept-Encoding": "gzip, deflate, br",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Sec-Fetch-User": "?1",
                "Upgrade-Insecure-Requests": "1",
            })
            logger.info(f"Scrape {url}: status={resp.status_code}")
            html = resp.text[:80000]

            def extract_meta(property_name: str) -> Optional[str]:
                patterns = [
                    rf'<meta[^>]+(?:property|name)=["\'](?:og:)?{property_name}["\'][^>]+content=["\']([^"\']+)["\']',
                    rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\'](?:og:)?{property_name}["\']',
                ]
                for pattern in patterns:
                    m = re.search(pattern, html, re.IGNORECASE)
                    if m:
                        return m.group(1)
                return None

            title = extract_meta("title") or ""
            if not title:
                m = re.search(r'<title>([^<]+)</title>', html)
                title = m.group(1).strip() if m else ""

            description = extract_meta("description") or ""
            image = extract_meta("image") or ""

            # Try to find price - multiple patterns for Korean e-commerce
            price = None
            # 1. product:price meta tag (Naver Shopping, Coupang, etc.)
            price_meta = extract_meta("product:price:amount")
            if not price_meta:
                # og:price:amount
                price_meta = extract_meta("price:amount")
            if price_meta:
                price = re.sub(r'[^\d.]', '', price_meta)
            else:
                # 2. JSON-LD structured data (Schema.org)
                ld_match = re.search(r'"price"\s*:\s*"?([\d,]+(?:\.\d+)?)"?', html)
                if ld_match:
                    price = ld_match.group(1).replace(",", "")
                else:
                    # 3. Korean patterns: 39,900원, 가격: 39,900, ₩39,900, $39.99
                    price_patterns = [
                        r'([\d,]+)\s*원',                          # 39,900원
                        r'[\₩]\s?([\d,]+)',                        # ₩39,900
                        r'[\$]\s?([\d,.]+)',                        # $39.99
                        r'(?:price|가격)["\s:]*?([\d,]+)',         # price: 39900
                        r'class="[^"]*price[^"]*"[^>]*>([\d,]+)',  # <span class="price">39900</span>
                    ]
                    for pat in price_patterns:
                        pm = re.search(pat, html, re.IGNORECASE)
                        if pm:
                            price = pm.group(1).replace(",", "")
                            break

            return {
                "name": title,
                "description": description,
                "image_url": image,
                "price": float(price) if price else None,
                "source_url": url,
            }
    except httpx.ConnectError as e:
        logger.warning(f"Scrape connect error for {url}: {e}")
        return {"name": "", "description": "", "source_url": url, "scrape_error": "연결 실패"}
    except httpx.TimeoutException as e:
        logger.warning(f"Scrape timeout for {url}: {e}")
        return {"name": "", "description": "", "source_url": url, "scrape_error": "시간 초과"}
    except Exception as e:
        logger.warning(f"Scrape failed for {url}: {e}")
        return {"name": "", "description": "", "source_url": url, "scrape_error": str(e)}


@router.post("/auto-plan", response_model=AutoPlanResponse)
async def auto_plan_campaign(
    request: AutoPlanRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    One-Click 캠페인 기획: URL 또는 제품 정보만으로 전체 캠페인 생성.

    1. URL → 웹 스크래핑으로 제품 정보 추출
    2. Claude AI로 한 번에 생성: 구조 + 타겟 + 카피 + UTM
    3. Meta 연동 시 과거 성과 데이터 반영
    """
    # Step 1: Get product info
    product_info = {}
    if request.product_url:
        product_info = await _scrape_product_info(request.product_url)

    # Override with explicit params
    if request.product_name:
        product_info["name"] = request.product_name
    if request.product_description:
        product_info["description"] = request.product_description
    if request.product_price:
        product_info["price"] = request.product_price

    if not product_info.get("name"):
        raise HTTPException(status_code=400, detail="제품 정보를 확인할 수 없습니다. 제품명을 직접 입력해주세요.")

    # Step 2: Get deep Meta context if available
    svc = await MetaAdsService.create(current_user, db)
    meta_context_text = ""
    if svc.connected:
        try:
            meta_context_text = await svc.build_full_context_for_ai("last_30d")
        except Exception:
            meta_context_text = ""

    # Step 3: Generate full campaign plan via Claude
    claude = ClaudeService()

    prompt = f"""당신은 Meta 광고 캠페인 전문 플래너입니다.
다음 제품 정보와 예산으로 완전한 캠페인 기획을 한 번에 생성해주세요.

[제품 정보]
- 제품명: {product_info.get('name', 'N/A')}
- 설명: {product_info.get('description', 'N/A')}
- 가격: {product_info.get('price', 'N/A')}원
- URL: {product_info.get('source_url', request.product_url or 'N/A')}

[예산] {request.budget:,.0f}원
[기간] {request.start_date or '미정'} ~ {request.end_date or '미정'}

{f'[사용자 Meta 계정 정보] {meta_context_text}' if meta_context_text else ''}

다음 5가지를 한 번에 생성하세요:

JSON 형식으로 응답:
{{
    "campaign_structure": {{
        "campaign_name": "캠페인명",
        "objective": "CONVERSIONS/TRAFFIC/LEAD_GENERATION",
        "groups": [
            {{
                "name": "그룹명",
                "budget_ratio": 50,
                "budget_amount": 금액,
                "objective": "목적",
                "reasoning": "이유"
            }}
        ],
        "overall_strategy": "전체 전략 요약"
    }},
    "targeting": {{
        "segments": [
            {{
                "type": "브로드/관심사/리타겟팅/유사",
                "ratio": 비율,
                "budget": 금액,
                "description": "대상 설명",
                "interests": ["관심사1", "관심사2"],
                "age_range": "25-45"
            }}
        ],
        "strategy_summary": "타겟 전략 요약"
    }},
    "copywriting": {{
        "variations": [
            {{
                "name": "변형 A - 전환용",
                "headline": "헤드라인 (30자 이내)",
                "primary_text": "본문 (125자 이내)",
                "description": "설명 (30자 이내)",
                "cta": "CTA 버튼 텍스트"
            }}
        ]
    }},
    "utm": {{
        "base_url": "{request.product_url or 'https://example.com'}",
        "links": [
            {{
                "campaign": "캠페인명",
                "source": "facebook",
                "medium": "paid_social",
                "content": "소재설명",
                "full_url": "전체 UTM URL"
            }}
        ]
    }},
    "creative_recommendation": {{
        "recommended_type": "short_form_video 또는 image 또는 carousel 중 하나",
        "reason": "추천 이유를 한국어로 설명",
        "video_plan": {{
            "concept": "영상 컨셉 설명",
            "scenes": ["씬1 설명", "씬2 설명", "씬3 설명"],
            "script": "나레이션 스크립트 전문",
            "duration_seconds": 15,
            "music_mood": "energetic/calm/emotional 중 하나"
        }},
        "image_guidelines": {{
            "style": "이미지 스타일 설명",
            "key_elements": ["핵심 요소1", "핵심 요소2"],
            "text_overlay": "텍스트 오버레이 내용"
        }}
    }},
    "meta_recommendations": "Meta 광고 계정 데이터 기반 추가 추천 사항 (있는 경우)"
}}

creative_recommendation 규칙:
- recommended_type이 "short_form_video"인 경우 video_plan을 반드시 포함하고, image_guidelines는 null로 설정
- recommended_type이 "image"인 경우 image_guidelines를 반드시 포함하고, video_plan은 null로 설정
- recommended_type이 "carousel"인 경우 image_guidelines를 포함하고 video_plan은 null로 설정
- 제품 특성과 타겟에 맞는 최적의 소재 유형을 추천하세요

실무에서 바로 사용 가능한 수준으로 구체적으로 작성해주세요.
카피는 최소 3개 변형을 생성하세요.
JSON만 출력하세요."""

    import logging as _logging
    _log = _logging.getLogger(__name__)
    result = None
    last_error = None

    # Try with primary model, then fallback with smaller prompt if parsing fails
    models_to_try = [claude.model, "claude-sonnet-4-6"]
    for model_id in models_to_try:
        try:
            response = claude.client.messages.create(
                model=model_id,
                max_tokens=8192,
                messages=[{"role": "user", "content": prompt}],
            )
            raw_text = response.content[0].text
            _log.info(f"Campaign plan AI response length: {len(raw_text)} chars, model: {model_id}")
            result = _parse_json_response(raw_text)
            break
        except (json.JSONDecodeError, ValueError) as e:
            last_error = e
            _log.warning(f"JSON parse failed with {model_id}: {e}, raw[:500]={raw_text[:500] if 'raw_text' in dir() else 'N/A'}")
            continue
        except Exception as e:
            last_error = e
            _log.error(f"AI call failed with {model_id}: {e}")
            continue

    if result is None:
        raise HTTPException(status_code=500, detail=f"AI 응답 파싱 실패: {str(last_error)}")

    return AutoPlanResponse(
        product_info=product_info,
        campaign_structure=result.get("campaign_structure", {}),
        targeting=result.get("targeting", {}),
        copywriting=result.get("copywriting", {}),
        utm_links=result.get("utm", {}).get("links", []),
        overall_strategy=result.get("campaign_structure", {}).get("overall_strategy", ""),
        meta_recommendations=result.get("meta_recommendations"),
        creative_recommendation=result.get("creative_recommendation"),
    )
