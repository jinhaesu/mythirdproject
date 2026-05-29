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
};

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
