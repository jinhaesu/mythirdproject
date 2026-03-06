"""Campaign Planner schemas for structure design, targeting, copywriting, UTM, and analytics."""
from typing import Optional, List, Dict, Any
from enum import Enum

from pydantic import BaseModel, Field


# ──────────────────────────────────────────────
# Enums
# ──────────────────────────────────────────────

class ProductCategory(str, Enum):
    """Product category for campaign grouping."""
    NEW_PRODUCT = "신제품"
    MAIN_PRODUCT = "주력"
    CLEARANCE = "소진용"


class CampaignObjectiveType(str, Enum):
    """Meta campaign objective types."""
    TRAFFIC = "TRAFFIC"
    CONVERSIONS = "CONVERSIONS"
    LEAD_GENERATION = "LEAD_GENERATION"


class CopyPurpose(str, Enum):
    """Purpose of ad copy."""
    CONVERSION = "전환용"
    TRAFFIC = "유입용"
    LEAD = "잠재고객용"


class Platform(str, Enum):
    """Advertising platform."""
    META = "meta"
    NAVER = "naver"
    GOOGLE = "google"


class CSVPlatform(str, Enum):
    """Platform for CSV analysis."""
    META = "meta"
    NAVER = "naver"


class AnalysisType(str, Enum):
    """Type of CSV analysis."""
    DAILY = "daily"
    CREATIVE = "creative"
    TARGET = "target"


# ──────────────────────────────────────────────
# 1. Campaign Structure Design
# ──────────────────────────────────────────────

class ProductItem(BaseModel):
    """Single product in a campaign plan."""
    name: str = Field(..., description="제품명")
    category: ProductCategory = Field(..., description="제품 카테고리 (신제품/주력/소진용)")
    price: float = Field(..., description="제품 가격")
    promo_info: Optional[str] = Field(None, description="프로모션 정보")


class CampaignSchedule(BaseModel):
    """Promotion schedule."""
    promo_start_date: str = Field(..., description="프로모션 시작일 (YYYY-MM-DD)")
    promo_end_date: str = Field(..., description="프로모션 종료일 (YYYY-MM-DD)")


class CampaignStructureRequest(BaseModel):
    """Request for campaign structure design."""
    product_list: List[ProductItem] = Field(..., description="제품 리스트")
    schedule: CampaignSchedule = Field(..., description="프로모션 일정")
    total_budget: float = Field(..., description="총 예산 (원)")
    brand_name: str = Field(..., description="브랜드명")


class CreativeApproach(BaseModel):
    """Suggested creative approach for a campaign group."""
    format: str = Field(..., description="소재 형식 (이미지/영상/캐러셀)")
    concept: str = Field(..., description="크리에이티브 컨셉")
    key_message: str = Field(..., description="핵심 메시지")


class AdSetSuggestion(BaseModel):
    """Suggested ad set within a campaign group."""
    name: str = Field(..., description="광고세트 이름")
    target_audience: str = Field(..., description="타겟 오디언스 설명")
    budget_ratio: float = Field(..., description="예산 비율 (%)")
    estimated_reach: Optional[int] = Field(None, description="예상 도달 수")


class CampaignGroupNode(BaseModel):
    """A campaign group node in the campaign tree."""
    group_name: str = Field(..., description="그룹명 (예: 신제품 런칭)")
    category: str = Field(..., description="제품 카테고리")
    products: List[str] = Field(..., description="포함 제품 목록")
    objective: str = Field(..., description="캠페인 목적 (TRAFFIC/CONVERSIONS/LEAD_GENERATION)")
    budget_allocation: float = Field(..., description="예산 배분 (원)")
    budget_ratio: float = Field(..., description="예산 비율 (%)")
    ad_sets: List[AdSetSuggestion] = Field(default_factory=list, description="광고세트 구조")
    creative_approach: Optional[CreativeApproach] = Field(None, description="크리에이티브 접근")
    reasoning: Optional[str] = Field(None, description="전략 근거")


class CampaignStructureResponse(BaseModel):
    """Response with full campaign tree structure."""
    brand_name: str
    total_budget: float
    schedule: CampaignSchedule
    campaign_tree: List[CampaignGroupNode] = Field(..., description="캠페인 트리 구조")
    overall_strategy: str = Field(..., description="전체 전략 요약")
    expected_total_reach: Optional[int] = Field(None, description="전체 예상 도달 수")


# ──────────────────────────────────────────────
# 2. Target Audience Design
# ──────────────────────────────────────────────

class PastPerformanceData(BaseModel):
    """Optional past performance data for targeting optimization."""
    avg_ctr: Optional[float] = Field(None, description="평균 CTR (%)")
    avg_cpc: Optional[float] = Field(None, description="평균 CPC (원)")
    avg_roas: Optional[float] = Field(None, description="평균 ROAS")
    top_audiences: Optional[List[str]] = Field(None, description="과거 성과 좋은 오디언스")
    total_conversions: Optional[int] = Field(None, description="총 전환 수")


class TargetingRequest(BaseModel):
    """Request for target audience design."""
    product_category: ProductCategory = Field(..., description="제품 카테고리")
    budget: float = Field(..., description="예산 (원)")
    past_performance_data: Optional[PastPerformanceData] = Field(None, description="과거 성과 데이터")
    brand_info: Optional[str] = Field(None, description="브랜드 정보")


class TargetSegment(BaseModel):
    """A single target audience segment."""
    segment_type: str = Field(..., description="세그먼트 유형 (브로드/관심사/리타겟팅/유사)")
    ratio: float = Field(..., description="비중 (%)")
    budget: float = Field(..., description="배정 예산 (원)")
    estimated_reach: int = Field(..., description="예상 도달 수")
    description: str = Field(..., description="상세 설명")
    interest_list: Optional[List[str]] = Field(None, description="관심사 리스트 (관심사 타겟 시)")
    retarget_audience: Optional[str] = Field(None, description="리타겟팅 대상 (리타겟팅 시)")
    lookalike_source: Optional[str] = Field(None, description="유사 소스 (유사 타겟 시)")


class TargetingResponse(BaseModel):
    """Response with target structure table."""
    product_category: str
    total_budget: float
    segments: List[TargetSegment] = Field(..., description="타겟 세그먼트 테이블")
    strategy_summary: str = Field(..., description="타겟팅 전략 요약")
    recommendations: List[str] = Field(default_factory=list, description="추가 추천 사항")


# ──────────────────────────────────────────────
# 3. Copywriting Generation
# ──────────────────────────────────────────────

class CopyProduct(BaseModel):
    """Product info for copywriting."""
    name: str = Field(..., description="제품명")
    description: str = Field(..., description="제품 설명")
    price: float = Field(..., description="가격")
    promo: Optional[str] = Field(None, description="프로모션 내용")


class CopywritingRequest(BaseModel):
    """Request for ad copy generation."""
    products: List[CopyProduct] = Field(..., description="제품 리스트")
    purpose: CopyPurpose = Field(..., description="카피 목적 (전환용/유입용/잠재고객용)")
    brand_voice: Optional[str] = Field(None, description="브랜드 보이스 (예: 친근한, 전문적인)")
    tone: Optional[str] = Field(None, description="톤 (예: 유머러스, 감성적, 정보적)")


class CopyVariation(BaseModel):
    """A single copy variation."""
    headline: str = Field(..., description="헤드라인 (30자)")
    primary_text: str = Field(..., description="본문 텍스트 (125자)")
    description: str = Field(..., description="설명 (30자)")
    cta: str = Field(..., description="CTA 추천")


class ProductCopyResult(BaseModel):
    """Copy results for a single product."""
    product_name: str = Field(..., description="제품명")
    purpose: str = Field(..., description="카피 목적")
    variations: List[CopyVariation] = Field(..., description="카피 변형 (3개)")


class CopywritingResponse(BaseModel):
    """Response with generated copy for all products."""
    results: List[ProductCopyResult] = Field(..., description="제품별 카피 결과")
    brand_voice_applied: Optional[str] = Field(None, description="적용된 브랜드 보이스")


# ──────────────────────────────────────────────
# 4. UTM Generator
# ──────────────────────────────────────────────

class UTMRequest(BaseModel):
    """Request for UTM link generation."""
    base_url: str = Field(..., description="기본 URL")
    products: List[str] = Field(..., description="제품명 리스트")
    campaign_names: List[str] = Field(..., description="캠페인명 리스트")
    platforms: List[Platform] = Field(..., description="플랫폼 리스트 (meta/naver/google)")


class UTMLink(BaseModel):
    """A single generated UTM link."""
    product: str = Field(..., description="제품명")
    campaign: str = Field(..., description="캠페인명")
    platform: str = Field(..., description="플랫폼")
    utm_source: str = Field(..., description="utm_source")
    utm_medium: str = Field(..., description="utm_medium")
    utm_campaign: str = Field(..., description="utm_campaign")
    utm_content: str = Field(..., description="utm_content")
    utm_term: str = Field(..., description="utm_term")
    full_url: str = Field(..., description="완성된 UTM URL")


class UTMResponse(BaseModel):
    """Response with all generated UTM links."""
    base_url: str
    total_links: int
    links: List[UTMLink] = Field(..., description="생성된 UTM 링크 목록")


# ──────────────────────────────────────────────
# 5. CSV Performance Analysis
# ──────────────────────────────────────────────

class ChartDataPoint(BaseModel):
    """Single data point for chart rendering."""
    label: str
    value: float
    secondary_value: Optional[float] = None


class ChartData(BaseModel):
    """Chart data for frontend rendering."""
    chart_type: str = Field(..., description="차트 유형 (line/bar/pie)")
    title: str = Field(..., description="차트 제목")
    data_points: List[ChartDataPoint] = Field(..., description="데이터 포인트")


class CSVAnalysisResponse(BaseModel):
    """Response from CSV performance analysis."""
    platform: str
    analysis_type: str
    summary: str = Field(..., description="분석 요약")
    action_items: List[str] = Field(..., description="실행 항목 리스트")
    charts: List[ChartData] = Field(default_factory=list, description="차트 데이터")
    anomalies: List[str] = Field(default_factory=list, description="이상 탐지 결과")
    raw_metrics: Optional[Dict[str, Any]] = Field(None, description="원본 지표 데이터")


# ──────────────────────────────────────────────
# 6. Creative Performance Prediction
# ──────────────────────────────────────────────

class PastCreative(BaseModel):
    """Past creative performance data."""
    type: str = Field(..., description="소재 유형 (이미지/영상/캐러셀)")
    style: str = Field(..., description="스타일 (감성적/정보적/유머 등)")
    ctr: float = Field(..., description="CTR (%)")
    cvr: float = Field(..., description="CVR (%)")
    spend: float = Field(..., description="사용 금액 (원)")


class PredictCreativeRequest(BaseModel):
    """Request for creative performance prediction."""
    past_creatives: List[PastCreative] = Field(..., description="과거 소재 성과 데이터")
    new_creative_description: str = Field(..., description="새 소재 설명")


class SimilarCreative(BaseModel):
    """Similar past creative for reference."""
    type: str
    style: str
    ctr: float
    cvr: float
    similarity_reason: str = Field(..., description="유사도 근거")


class PredictCreativeResponse(BaseModel):
    """Response with creative performance prediction."""
    predicted_ctr_range: List[float] = Field(..., description="예측 CTR 범위 [min, max]")
    predicted_cvr_range: List[float] = Field(..., description="예측 CVR 범위 [min, max]")
    confidence: float = Field(..., description="신뢰도 (0-1)")
    similar_past_creatives: List[SimilarCreative] = Field(
        default_factory=list, description="유사 과거 소재"
    )
    recommendations: List[str] = Field(default_factory=list, description="추천 사항")
