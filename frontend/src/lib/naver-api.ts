import api from './api';

// ═══ Naver Search Ads API ═══
export const naverSearchAdsApi = {
  envCheck: async () => {
    const { data } = await api.get('/naver/search-ads/env-check');
    return data;
  },

  getOverview: async (dateRange = 'last_7_days', startDate?: string, endDate?: string) => {
    const params: any = { date_range: dateRange };
    if (dateRange === 'custom' && startDate && endDate) {
      params.start_date = startDate;
      params.end_date = endDate;
    }
    const { data } = await api.get('/naver/search-ads/overview', { params });
    return data;
  },

  getCampaigns: async (dateRange = 'last_7_days', startDate?: string, endDate?: string) => {
    const params: any = { date_range: dateRange };
    if (dateRange === 'custom' && startDate && endDate) {
      params.start_date = startDate;
      params.end_date = endDate;
    }
    const { data } = await api.get('/naver/search-ads/campaigns', { params });
    return data;
  },

  getCampaignAdgroups: async (campaignId: string, dateRange = 'last_7_days', startDate?: string, endDate?: string) => {
    const params: any = { date_range: dateRange };
    if (dateRange === 'custom' && startDate && endDate) {
      params.start_date = startDate;
      params.end_date = endDate;
    }
    const { data } = await api.get(`/naver/search-ads/campaign/${campaignId}/adgroups`, { params });
    return data;
  },

  getCampaignKeywords: async (campaignId: string, dateRange = 'last_7_days', startDate?: string, endDate?: string) => {
    const params: any = { date_range: dateRange };
    if (dateRange === 'custom' && startDate && endDate) {
      params.start_date = startDate;
      params.end_date = endDate;
    }
    const { data } = await api.get(`/naver/search-ads/campaign/${campaignId}/keywords`, { params });
    return data;
  },

  getCampaignKeywordRankings: async (campaignId: string) => {
    const { data } = await api.get(`/naver/search-ads/campaign/${campaignId}/keyword-rankings`);
    return data;
  },

  getTrend: async (dateRange = 'last_7_days', timeIncrement = 'daily', startDate?: string, endDate?: string) => {
    const params: any = { date_range: dateRange, time_increment: timeIncrement };
    if (dateRange === 'custom' && startDate && endDate) {
      params.start_date = startDate;
      params.end_date = endDate;
    }
    const { data } = await api.get('/naver/search-ads/trend', { params });
    return data;
  },

  getAIAnalysis: async (dateRange = 'last_7_days', overviewData?: any, startDate?: string, endDate?: string) => {
    const body: any = {
      date_range: dateRange,
      focus: null,
      custom_prompt: null,
    };
    if (dateRange === 'custom' && startDate && endDate) {
      body.start_date = startDate;
      body.end_date = endDate;
    }
    const { data } = await api.post('/naver/search-ads/ai-analysis', body);
    return data;
  },

  createCampaign: async (body: any) => {
    const { data } = await api.post('/naver/search-ads/campaign', body);
    return data;
  },

  updateCampaign: async (campaignId: string, body: any) => {
    const { data } = await api.put(`/naver/search-ads/campaign/${campaignId}`, body);
    return data;
  },

  createAdgroup: async (campaignId: string, body: any) => {
    const { data } = await api.post(`/naver/search-ads/campaign/${campaignId}/adgroup`, body);
    return data;
  },

  addKeywords: async (adgroupId: string, keywords: any[]) => {
    const { data } = await api.post('/naver/search-ads/keywords', {
      adgroup_id: adgroupId,
      keywords,
    });
    return data;
  },

  updateKeywordBid: async (keywordId: string, bidAmt: number) => {
    const { data } = await api.put(`/naver/search-ads/keyword/${keywordId}/bid`, { bid_amt: bidAmt });
    return data;
  },

  createAd: async (adgroupId: string, adData: any) => {
    // Ad creation is part of the wizard flow
    const { data } = await api.post('/naver/search-ads/ad-preview', adData);
    return data;
  },

  pauseCampaign: async (campaignId: string) => {
    const { data } = await api.put(`/naver/search-ads/campaign/${campaignId}`, { user_lock: true });
    return data;
  },

  resumeCampaign: async (campaignId: string) => {
    const { data } = await api.put(`/naver/search-ads/campaign/${campaignId}`, { user_lock: false });
    return data;
  },
};

// ═══ Naver GFA API ═══
export const naverGFAApi = {
  /** GFA 오픈API 연결 상태 (네이버 로그인 OAuth) */
  getStatus: async (): Promise<{ connected: boolean; ad_account_no?: string | null }> => {
    const { data } = await api.get('/naver/gfa/status');
    return data;
  },
  /** 네이버 로그인 동의 URL 발급 → 브라우저 이동용 */
  startAuth: async (): Promise<{ auth_url: string }> => {
    const { data } = await api.get('/naver/gfa/auth/start');
    return data;
  },

  getOverview: async (dateRange = 'last_7_days', startDate?: string, endDate?: string) => {
    const params: any = { date_range: dateRange };
    if (dateRange === 'custom' && startDate && endDate) {
      params.start_date = startDate;
      params.end_date = endDate;
    }
    const { data } = await api.get('/naver/gfa/overview', { params });
    return data;
  },

  getCampaigns: async (dateRange = 'last_7_days', startDate?: string, endDate?: string) => {
    const params: any = { date_range: dateRange };
    if (dateRange === 'custom' && startDate && endDate) {
      params.start_date = startDate;
      params.end_date = endDate;
    }
    const { data } = await api.get('/naver/gfa/campaigns', { params });
    return data;
  },

  getCampaignAdgroups: async (campaignId: string, dateRange = 'last_7_days', startDate?: string, endDate?: string) => {
    const params: any = { date_range: dateRange };
    if (dateRange === 'custom' && startDate && endDate) {
      params.start_date = startDate;
      params.end_date = endDate;
    }
    const { data } = await api.get(`/naver/gfa/campaign/${campaignId}/adgroups`, { params });
    return data;
  },

  getCampaignCreatives: async (campaignId: string) => {
    const { data } = await api.get(`/naver/gfa/campaign/${campaignId}/creatives`);
    return data;
  },

  getTrend: async (dateRange = 'last_7_days', timeIncrement = 'daily', startDate?: string, endDate?: string) => {
    const params: any = { date_range: dateRange, time_increment: timeIncrement };
    if (dateRange === 'custom' && startDate && endDate) {
      params.start_date = startDate;
      params.end_date = endDate;
    }
    const { data } = await api.get('/naver/gfa/trend', { params });
    return data;
  },

  getAIAnalysis: async (dateRange = 'last_7_days', overviewData?: any, startDate?: string, endDate?: string) => {
    const body: any = {
      date_range: dateRange,
      focus: null,
      custom_prompt: null,
    };
    if (dateRange === 'custom' && startDate && endDate) {
      body.start_date = startDate;
      body.end_date = endDate;
    }
    const { data } = await api.post('/naver/gfa/ai-analysis', body);
    return data;
  },

  createCampaign: async (body: any) => {
    const { data } = await api.post('/naver/gfa/campaign', body);
    return data;
  },

  updateCampaign: async (campaignId: string, body: any) => {
    const { data } = await api.put(`/naver/gfa/campaign/${campaignId}`, body);
    return data;
  },

  createAdgroup: async (campaignId: string, body: any) => {
    const { data } = await api.post(`/naver/gfa/campaign/${campaignId}/adgroup`, body);
    return data;
  },

  createCreative: async (adgroupId: string, body: any) => {
    const { data } = await api.post(`/naver/gfa/adgroup/${adgroupId}/creative`, body);
    return data;
  },

  getAudiences: async () => {
    const { data } = await api.get('/naver/gfa/audiences');
    return data;
  },

  getPlacements: async () => {
    const { data } = await api.get('/naver/gfa/placements');
    return data;
  },

  pauseCampaign: async (campaignId: string) => {
    const { data } = await api.put(`/naver/gfa/campaign/${campaignId}`, { status: 'PAUSED' });
    return data;
  },

  resumeCampaign: async (campaignId: string) => {
    const { data } = await api.put(`/naver/gfa/campaign/${campaignId}`, { status: 'ACTIVE' });
    return data;
  },

  // ─── 성과 파일 업로드 (API 미연결이어도 광고 관리자 보고서 파일로 대시보드) ───
  /** 파일 미리보기 — DB는 바뀌지 않는다 */
  uploadPreview: async (file: File, opts: GfaUploadOptions = {}): Promise<GfaUploadPreview> => {
    const { data } = await api.post('/naver/gfa/upload/preview', gfaUploadForm(file, opts), {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  },
  /** 반영 — 같은 (계정 이름, 날짜)의 예전 값은 파일 값으로 바뀐다 */
  uploadApply: async (file: File, opts: GfaUploadOptions = {}): Promise<GfaUploadApplyResult> => {
    const { data } = await api.post('/naver/gfa/upload/apply', gfaUploadForm(file, opts), {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  },
  uploadBatches: async (): Promise<{ batches: GfaUploadBatch[] }> => {
    const { data } = await api.get('/naver/gfa/upload/batches');
    return data;
  },
  deleteUploadBatch: async (id: number): Promise<{ deleted: number; rows: number }> => {
    const { data } = await api.delete(`/naver/gfa/upload/batches/${id}`);
    return data;
  },
  uploadStatus: async (): Promise<GfaUploadStatus> => {
    const { data } = await api.get('/naver/gfa/upload/status');
    return data;
  },
  uploadDashboard: async (dateRange: string, startDate?: string, endDate?: string, account?: string): Promise<GfaUploadDashboard> => {
    const params: any = { date_range: dateRange };
    if (dateRange === 'custom' && startDate && endDate) {
      params.start_date = startDate;
      params.end_date = endDate;
    }
    if (account !== undefined) params.account = account;
    const { data } = await api.get('/naver/gfa/upload/dashboard', { params });
    return data;
  },
};

// ─── GFA 성과 파일 업로드 타입 ───
export type GfaUploadOptions = {
  accountLabel?: string;
  sheet?: string;
  headerRow?: number;
  /** 사람이 고친 칸 연결만 — {항목: 칸 번호(0부터) | null(안 씀)} */
  mapping?: Record<string, number | null>;
};

const gfaUploadForm = (file: File, opts: GfaUploadOptions) => {
  const fd = new FormData();
  fd.append('file', file);
  if (opts.accountLabel && opts.accountLabel.trim()) fd.append('account_label', opts.accountLabel.trim());
  if (opts.sheet) fd.append('sheet', opts.sheet);
  if (opts.headerRow) fd.append('header_row', String(opts.headerRow));
  if (opts.mapping && Object.keys(opts.mapping).length > 0) fd.append('mapping', JSON.stringify(opts.mapping));
  return fd;
};

export type GfaGranularity = 'creative' | 'adgroup' | 'campaign' | 'account';

export type GfaUploadColumn = {
  index: number; letter: string; header: string;
  field: string | null; field_label: string | null; known: boolean;
  status: 'used' | 'ignored' | 'empty' | 'unknown';
};

export type GfaUploadSampleRow = {
  account: string; date: string;
  campaign_id: string | null; campaign_name: string | null; adgroup_id: string | null; adgroup_name: string | null;
  creative_id: string | null; creative_name: string | null; creative_type: string | null;
  product: string | null; promotion: string | null;
  impressions: number | null; clicks: number | null; spend: number;
  conversions: number | null; conv_sales: number | null; budget: number | null;
};

export type GfaUploadTotals = {
  spend: number; impressions: number | null; clicks: number | null;
  conversions: number | null; conv_sales: number | null; roas: number | null;
};

export type GfaUploadPreview = {
  file: {
    name: string | null; kind: 'xlsx' | 'csv' | 'html'; sheet: string | null;
    sheets: { name: string; usable: boolean }[]; encoding: string | null; delimiter: string | null; header_row: number;
  };
  columns: GfaUploadColumn[];
  fields: { key: string; label: string; required: boolean; columns: number[]; manual: boolean }[];
  missing: string[];
  spend_vat: 'incl' | 'excl' | null;
  budget_kind: 'daily' | 'total' | null;
  granularity: GfaGranularity;
  data_rows: number;
  record_count: number;
  skipped: Record<string, number>;
  date_from: string | null;
  date_to: string | null;
  days: number;
  totals: GfaUploadTotals;
  accounts: { account: string; days: number; rows: number; date_from: string; date_to: string; spend: number }[];
  warnings: string[];
  errors: string[];
  can_apply: boolean;
  sample: GfaUploadSampleRow[];
  replace: {
    rows: number; batches: number[];
    other_accounts: { account: string; rows: number; date_from: string; date_to: string }[];
  };
};

export type GfaUploadApplyResult = {
  batch_id: number; inserted: number; replaced: number;
  date_from: string | null; date_to: string | null; accounts: string[];
  totals: GfaUploadTotals; granularity: GfaGranularity; spend_vat: string | null;
};

export type GfaUploadBatch = {
  id: number; filename: string | null; sheet: string | null; account_label: string;
  granularity: GfaGranularity; spend_vat: string | null;
  date_from: string | null; date_to: string | null; row_count: number; replaced_rows: number;
  spend_total: number; conv_sales_total: number | null;
  live_rows: number; live_spend: number; live_date_from: string | null; live_date_to: string | null;
  uploaded_by: string | null; created_at: string | null;
};

export type GfaUploadStatus = {
  has_data: boolean; rows: number; date_min?: string; date_max?: string;
  accounts: { account: string; rows: number; date_min: string; date_max: string }[];
  last_upload?: { id: number; filename: string | null; uploaded_by: string | null; created_at: string | null; spend_vat: string | null } | null;
};

export type GfaPerf = {
  spend: number; impressions: number | null; clicks: number | null;
  conversions: number | null; conv_sales: number | null;
  roas: number | null; cpa: number | null; ctr: number | null; cpc: number | null; cvr: number | null; cpm: number | null;
  days: number;
};

export type GfaChangeKey = 'spend' | 'conv_sales' | 'roas' | 'conversions' | 'cpa' | 'ctr' | 'cpc' | 'cvr' | 'clicks' | 'impressions';

export type GfaSeriesPoint = GfaPerf & {
  key: string; label: string; start: string; end: string; partial: boolean;
  change: Partial<Record<GfaChangeKey, number | null>> | null;
};

export type GfaUploadDashboardData = {
  has_data: true;
  source: 'upload';
  period: { start: string; end: string; days: number; prev_start: string; prev_end: string };
  data_span: { min: string; max: string; rows: number };
  missing_days: number;
  account: string | null;
  accounts: string[];
  availability: Record<'impressions' | 'clicks' | 'conversions' | 'conv_sales' | 'campaign' | 'adgroup' | 'creative'
    | 'creative_type' | 'product' | 'promotion' | 'budget', boolean>;
  kpi: GfaPerf;
  kpi_prev: GfaPerf | null;
  kpi_change: Partial<Record<GfaChangeKey, number | null>> | null;
  series: { daily: GfaSeriesPoint[]; weekly: GfaSeriesPoint[]; monthly: GfaSeriesPoint[] };
  campaigns: (GfaPerf & {
    account: string; id: string | null; name: string;
    spend_share: number | null; sales_share: number | null;
    budget: number | null; budget_basis: 'daily' | 'total' | null; budget_util: number | null;
  })[];
  creatives: (GfaPerf & {
    account: string; campaign: string | null; adgroup: string | null; name: string | null; id: string | null;
    type: string | null; type_group: string | null;
  })[];
  creative_count: number;
  types: { groups: (GfaPerf & { group: string })[]; raw: (GfaPerf & { type: string })[] } | null;
  products: (GfaPerf & { name: string })[] | null;
  promotions: (GfaPerf & { name: string })[] | null;
  spend_vat: (string | null)[];
  last_upload: { filename: string | null; created_at: string | null; uploaded_by: string | null } | null;
};

export type GfaUploadDashboard = GfaUploadDashboardData | { has_data: false };

// ═══ Naver Report API ═══
export const naverReportApi = {
  generate: async (params: any) => {
    const { data } = await api.get('/naver/report/generate', {
      params: {
        platforms: Array.isArray(params.platforms) ? params.platforms.join(',') : 'NAVER_SEARCH,NAVER_GFA',
        date_range: params.date_range || 'last_7_days',
        report_type: params.report_type || 'weekly',
      },
    });
    return data;
  },

  sendEmail: async (params: any) => {
    const { data } = await api.post('/naver/report/email', {
      recipient_email: params.email,
      report_type: params.report_type || 'weekly',
      platforms: params.platforms || ['NAVER_SEARCH', 'NAVER_GFA'],
      date_range: params.date_range || 'last_7_days',
    });
    return data;
  },

  getSchedules: async () => {
    // Not a direct backend endpoint yet — return empty
    return { schedules: [] };
  },

  createSchedule: async (scheduleData: any) => {
    return { success: true, ...scheduleData };
  },

  updateSchedule: async (scheduleId: string, scheduleData: any) => {
    return { success: true };
  },

  deleteSchedule: async (scheduleId: string) => {
    return { success: true };
  },
};

// ═══ Naver Auto Rules API ═══
export const naverAutoRulesApi = {
  getRules: async () => {
    const { data } = await api.get('/naver/auto-rules');
    return data;
  },

  createRule: async (ruleData: any) => {
    const { data } = await api.post('/naver/auto-rules', ruleData);
    return data;
  },

  updateRule: async (ruleId: string, ruleData: any) => {
    const { data } = await api.put(`/naver/auto-rules/${ruleId}`, ruleData);
    return data;
  },

  deleteRule: async (ruleId: string) => {
    const { data } = await api.delete(`/naver/auto-rules/${ruleId}`);
    return data;
  },

  executeRules: async () => {
    const { data } = await api.post('/naver/auto-rules/execute');
    return data;
  },

  getRuleLogs: async (limit = 50) => {
    // Logs are returned from execute endpoint — placeholder
    return { logs: [] };
  },

  aiRecommendRules: async (overviewData?: any) => {
    // AI recommend endpoint — uses existing AI analysis
    const { data } = await api.post('/naver/search-ads/ai-analysis', {
      date_range: 'last_7_days',
      focus: 'optimization_rules',
      custom_prompt: '현재 성과 데이터를 기반으로 자동 관리 규칙을 추천해주세요.',
    });
    return data;
  },
};

// ═══ Naver Keyword Research / Shopping Ranking API ═══
export const naverKeywordResearchApi = {
  /**
   * Naver 쇼핑 검색 API — 키워드별 상품 랭킹/가격/브랜드 데이터
   * GET /naver/keyword-research/shopping
   */
  searchShopping: async (keyword: string, display: number = 40) => {
    const { data } = await api.get('/naver/keyword-research/shopping', {
      params: { keyword, display },
    });
    return data;
  },

  /**
   * Naver DataLab 검색어 트렌드 API — 키워드 검색량 추이
   * GET /naver/keyword-research/trend
   */
  getTrend: async (
    keyword: string,
    timeUnit: string = 'month',
    period: string = '1y',
  ) => {
    const { data } = await api.get('/naver/keyword-research/trend', {
      params: { keyword, time_unit: timeUnit, period },
    });
    return data;
  },

  /**
   * 쇼핑 검색 + 트렌드 통합 분석
   * GET /naver/keyword-research/analysis
   */
  getAnalysis: async (keyword: string) => {
    const { data } = await api.get('/naver/keyword-research/analysis', {
      params: { keyword },
    });
    return data;
  },

  /**
   * 절대 월간 검색량 조회 (검색광고 키워드 도구 API)
   * GET /naver/keyword-research/search-volume
   */
  getSearchVolume: async (keyword: string) => {
    const { data } = await api.get('/naver/keyword-research/search-volume', {
      params: { keyword },
    });
    return data;
  },

  /**
   * 브랜드 쇼핑 랭킹 AI 분석 (Claude)
   * POST /naver/keyword-research/ai-analysis
   */
  analyzeRanking: async (keyword: string, brand: string, shoppingResults: any[]) => {
    const { data } = await api.post('/naver/keyword-research/ai-analysis', {
      keyword, brand, shopping_results: shoppingResults,
    });
    return data;
  },

  // ── 키워드 순위 모니터링 ──

  checkRanks: async (keywordIds?: string[], brandName = '널담') => {
    const { data } = await api.post('/market/keywords/rank-check', {
      keyword_ids: keywordIds || null,
      brand_name: brandName,
    });
    return data;
  },

  createRankSchedule: async (scheduleData: {
    name?: string;
    brand_name?: string;
    schedule_type: string;
    day_of_week?: number;
    days_of_week?: number[];
    send_hour?: number;
    send_minute?: number;
    email_to: string;
  }) => {
    const { data } = await api.post('/market/keywords/rank-schedule', scheduleData);
    return data;
  },

  listRankSchedules: async () => {
    const { data } = await api.get('/market/keywords/rank-schedules');
    return data;
  },

  deleteRankSchedule: async (scheduleId: string) => {
    await api.delete(`/market/keywords/rank-schedule/${scheduleId}`);
  },

  runRankScheduleNow: async (scheduleId: string) => {
    const { data } = await api.post(`/market/keywords/rank-schedule/${scheduleId}/run-now`);
    return data;
  },
};

// ── 네이버 인사이트 (API HUB — 검색어트렌드/쇼핑인사이트/언급량/감성 마인드맵) ──

export interface TrendResult {
  title: string;
  data: { period: string; ratio: number; absolute?: number }[];
  /** 검색광고 키워드도구 월간 검색량 (검색어 트렌드에서만 제공) */
  monthly_volume?: { pc: number; mobile: number; total: number } | null;
}

export const naverInsightsApi = {
  getStatus: async (): Promise<{ configured: boolean }> => {
    const { data } = await api.get('/naver-insights/status');
    return data;
  },

  getShoppingCategories: async (): Promise<{ categories: { name: string; code: string }[] }> => {
    const { data } = await api.get('/naver-insights/shopping-categories');
    return data;
  },

  searchTrend: async (body: {
    keyword_groups: { name: string; keywords: string[] }[];
    start_date?: string;
    end_date?: string;
    time_unit?: string;
  }): Promise<{ results: TrendResult[]; startDate: string; endDate: string; as_of: string; absolute_available?: boolean }> => {
    const { data } = await api.post('/naver-insights/search-trend', body);
    return data;
  },

  shoppingCategoryTrend: async (body: {
    categories: { name: string; code: string }[];
    start_date?: string;
    end_date?: string;
    time_unit?: string;
  }): Promise<{ results: TrendResult[]; startDate: string; endDate: string; as_of: string }> => {
    const { data } = await api.post('/naver-insights/shopping-category-trend', body);
    return data;
  },

  shoppingKeywordTrend: async (body: {
    category_code: string;
    keywords: string[];
    start_date?: string;
    end_date?: string;
    time_unit?: string;
  }): Promise<{ results: TrendResult[]; startDate: string; endDate: string; as_of: string }> => {
    const { data } = await api.post('/naver-insights/shopping-keyword-trend', body);
    return data;
  },

  getMentions: async (keyword: string, display = 10, days?: number) => {
    const { data } = await api.get('/naver-insights/mentions', { params: { keyword, display, days } });
    return data;
  },

  getMentionHistory: async (keyword: string, days = 90) => {
    const { data } = await api.get('/naver-insights/mention-history', { params: { keyword, days } });
    return data;
  },

  sentimentMindmap: async (keyword: string, sample = 60, days?: number) => {
    const { data } = await api.post('/naver-insights/sentiment-mindmap', { keyword, sample, days });
    return data;
  },
};

// Currency & number formatting utilities for Naver (KRW only)
export function formatNaverCurrency(amount: number): string {
  return `\u20A9${Math.round(amount).toLocaleString('ko-KR')}`;
}

export function formatNaverNumber(num: number, decimals: number = 0): string {
  return num.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatNaverPercent(num: number, decimals: number = 2): string {
  return `${num.toFixed(decimals)}%`;
}
