import axios from 'axios';
import type {
  User,
  BenchmarkQuery,
  BenchmarkResponse,
  AISummary,
  SentimentAnalysis,
  StyleExtraction,
  Creative,
  GenerationJob,
  Campaign,
  StrategyRecommendation,
  PerformanceDashboard,
  AutoPlanRequest,
  AutoPlanResponse,
  ChatResponse,
  PublishOptions,
  TargetingSegment,
  PerformanceFeedback,
} from '@/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

// Resolve media URLs (e.g. /uploads/file.jpg -> http://backend:8000/uploads/file.jpg)
export function resolveMediaUrl(url?: string | null): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url;
  // Extract backend host from API_BASE (remove /api/v1 suffix)
  const backendHost = API_BASE.replace(/\/api\/v1\/?$/, '');
  if (backendHost && backendHost !== '/api/v1' && backendHost !== '') {
    return `${backendHost}${url.startsWith('/') ? url : `/${url}`}`;
  }
  // Fallback: use relative path (handled by Next.js rewrites)
  return url.startsWith('/') ? url : `/${url}`;
}

const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 — token expired → clear and redirect to login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.reload();
    }
    return Promise.reject(error);
  },
);

// Auth API
export const authApi = {
  sendMagicLink: async (email: string) => {
    const { data } = await api.post('/auth/send-magic-link', { email });
    return data;
  },

  verifyMagicLink: async (token: string) => {
    const { data } = await api.post<{ access_token: string; token_type: string }>('/auth/verify-magic-link', { token });
    return data;
  },

  getMe: async () => {
    const { data } = await api.get<User>('/auth/me');
    return data;
  },

  connectMeta: async (accessToken: string, adAccountId?: string) => {
    const { data } = await api.post('/auth/connect-meta', {
      access_token: accessToken,
      ad_account_id: adAccountId,
    });
    return data;
  },

  getMetaLoginUrl: async () => {
    const { data } = await api.get<{ login_url: string; redirect_uri: string }>('/auth/meta/login-url');
    return data;
  },

  metaCallback: async (code: string) => {
    const { data } = await api.post('/auth/meta/callback', null, { params: { code } });
    return data;
  },

  selectAdAccount: async (adAccountId: string) => {
    const { data } = await api.post('/auth/meta/select-ad-account', null, {
      params: { ad_account_id: adAccountId },
    });
    return data;
  },

  getMetaStatus: async () => {
    const { data } = await api.get('/auth/meta/status');
    return data;
  },

  disconnectMeta: async () => {
    const { data } = await api.post('/auth/meta/disconnect');
    return data;
  },
};

// Benchmark API (TAB 1)
export const benchmarkApi = {
  search: async (query: BenchmarkQuery) => {
    const { data } = await api.post<BenchmarkResponse>('/benchmark/search', query);
    return data;
  },

  getAISummary: async (benchmarkId: number) => {
    const { data } = await api.post<AISummary>(`/benchmark/${benchmarkId}/ai-summary`);
    return data;
  },

  getSentiment: async (benchmarkId: number) => {
    const { data } = await api.post<SentimentAnalysis>(`/benchmark/${benchmarkId}/sentiment`);
    return data;
  },

  extractStyle: async (url: string) => {
    const { data } = await api.post<{ style: StyleExtraction; prompt_template: string; preview_description: string }>(
      '/benchmark/extract-style',
      { url }
    );
    return data;
  },

  getHistory: async (limit = 20) => {
    const { data } = await api.get<BenchmarkResponse[]>('/benchmark/history', { params: { limit } });
    return data;
  },
};

// Creative API (TAB 2)
export const creativeApi = {
  generateImages: async (request: {
    prompt?: string;
    style_reference?: string;
    brand_info?: Record<string, any>;
    highlight_text?: string;
    format?: string;
    variations?: number;
    reference_url?: string;
    product_url?: string;
    product_image_url?: string;
    description?: string;
  }) => {
    const { data } = await api.post<GenerationJob>('/creative/generate/image', request);
    return data;
  },

  generateVideo: async (request: {
    prompt?: string;
    style_reference?: string;
    script?: string;
    voice_style?: string;
    include_subtitles?: boolean;
    duration_seconds?: number;
    reference_url?: string;
    product_url?: string;
    product_image_url?: string;
    description?: string;
  }) => {
    const { data } = await api.post<GenerationJob>('/creative/generate/video', request);
    return data;
  },

  getJobStatus: async (jobId: string) => {
    const { data } = await api.get<GenerationJob>(`/creative/job/${jobId}`);
    return data;
  },

  rewriteText: async (creativeId: number, newText: string, position?: string) => {
    const { data } = await api.post<Creative>('/creative/rewrite-text', {
      creative_id: creativeId,
      new_text: newText,
      position,
    });
    return data;
  },

  extendBackground: async (creativeId: number, targetFormat: string) => {
    const { data } = await api.post<Creative>('/creative/extend-background', {
      creative_id: creativeId,
      target_format: targetFormat,
    });
    return data;
  },

  getLibrary: async (creativeType?: string, limit = 50) => {
    const { data } = await api.get<Creative[]>('/creative/library', {
      params: { creative_type: creativeType, limit },
    });
    return data;
  },

  delete: async (creativeId: number) => {
    const { data } = await api.delete(`/creative/${creativeId}`);
    return data;
  },

  upload: async (file: File, options?: {
    name?: string;
    headline?: string;
    primary_text?: string;
    call_to_action?: string;
    link_url?: string;
  }) => {
    const formData = new FormData();
    formData.append('file', file);
    if (options?.name) formData.append('name', options.name);
    if (options?.headline) formData.append('headline', options.headline);
    if (options?.primary_text) formData.append('primary_text', options.primary_text);
    if (options?.call_to_action) formData.append('call_to_action', options.call_to_action);
    if (options?.link_url) formData.append('link_url', options.link_url);
    const { data } = await api.post<Creative>('/creative/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  },

  getMetaGuidelines: async () => {
    const { data } = await api.get('/creative/meta-guidelines');
    return data;
  },

  validateSpecs: async (creativeId: number) => {
    const { data } = await api.post('/creative/validate-specs', { creative_id: creativeId });
    return data;
  },
};

// Campaign API (TAB 3)
export const campaignApi = {
  getStrategy: async (budget: number, creativeIds: number[]) => {
    const { data } = await api.post<StrategyRecommendation>('/campaign/strategy', null, {
      params: { budget, creative_ids: creativeIds.join(',') },
    });
    return data;
  },

  create: async (campaignData: {
    name: string;
    objective: string;
    total_budget: number;
    daily_budget?: number;
    budget_type?: string;
    targeting?: any;
    targeting_segments?: TargetingSegment[];
    creative_ids: number[];
    start_date?: string;
    end_date?: string;
    advantage_plus?: boolean;
    advantage_plus_audience?: boolean;
    advantage_plus_creative?: boolean;
    dataset_id?: string;
    pixel_id?: string;
    primary_text?: string;
    headline?: string;
    call_to_action?: string;
    link_url?: string;
  }) => {
    const { data } = await api.post<Campaign>('/campaign', campaignData);
    return data;
  },

  delete: async (campaignId: number) => {
    const { data } = await api.delete(`/campaign/${campaignId}`);
    return data;
  },

  publish: async (campaignId: number, options?: Partial<PublishOptions>) => {
    const { data } = await api.post<{
      success: boolean;
      meta_campaign_id?: string;
      status: string;
      message: string;
    }>('/campaign/publish', {
      campaign_id: campaignId,
      ...options,
    });
    return data;
  },

  list: async (status?: string, limit = 20) => {
    const { data } = await api.get<Campaign[]>('/campaign', {
      params: { status, limit },
    });
    return data;
  },

  update: async (campaignId: number, updateData: Partial<Campaign>) => {
    const { data } = await api.patch<Campaign>(`/campaign/${campaignId}`, updateData);
    return data;
  },

  getInterestSuggestions: async (query: string) => {
    const { data } = await api.get('/campaign/interests/suggest', { params: { query } });
    return data;
  },

  activate: async (campaignId: number) => {
    const { data } = await api.post(`/campaign/${campaignId}/activate`);
    return data;
  },

  pause: async (campaignId: number) => {
    const { data } = await api.post(`/campaign/${campaignId}/pause`);
    return data;
  },

  updateBudget: async (campaignId: number, dailyBudget?: number, totalBudget?: number) => {
    const { data } = await api.post(`/campaign/${campaignId}/budget`, null, {
      params: { daily_budget: dailyBudget, total_budget: totalBudget },
    });
    return data;
  },

  toggleAd: async (campaignId: number, adId: number, action: 'activate' | 'pause') => {
    const { data } = await api.post(`/campaign/${campaignId}/ads/${adId}/toggle`, null, {
      params: { action },
    });
    return data;
  },

  syncInsights: async (campaignId: number, datePreset = 'last_7d') => {
    const { data } = await api.post(`/campaign/${campaignId}/sync-insights`, null, {
      params: { date_preset: datePreset },
    });
    return data;
  },

  getCustomAudiences: async () => {
    const { data } = await api.get<{ audiences: Array<{ id: string; name: string; subtype?: string; approximate_count_lower_bound?: number; approximate_count_upper_bound?: number }>; error?: string }>('/campaign/custom-audiences');
    return data;
  },
};

// Analytics API (TAB 4)
export const analyticsApi = {
  getAccountOverview: async (datePreset = 'last_7d', since?: string, until?: string) => {
    const params: any = { date_preset: datePreset };
    if (since && until) { params.since = since; params.until = until; }
    const { data } = await api.get('/analytics/account-overview', { params });
    return data;
  },

  getCampaignAdsets: async (campaignId: string, datePreset = 'last_7d') => {
    const { data } = await api.get(`/analytics/campaign/${campaignId}/adsets`, { params: { date_preset: datePreset } });
    return data;
  },

  getCampaignDeep: async (campaignId: string, datePreset = 'last_7d') => {
    const { data } = await api.get(`/analytics/campaign/${campaignId}/deep`, { params: { date_preset: datePreset } });
    return data;
  },

  getAIAnalysis: async (datePreset = 'last_7d', overviewData?: any, statusFilter?: string) => {
    const cacheKey = `ai-analysis_${datePreset}_${statusFilter || 'ALL'}`;
    const cached = getCachedData(cacheKey);
    if (cached) return cached;
    const { data } = await api.post('/analytics/ai-analysis', {
      overview_data: overviewData || null,
      status_filter: statusFilter || null,
    }, { params: { date_preset: datePreset } });
    setCachedData(cacheKey, data);
    return data;
  },

  updateStatus: async (objectId: string, objectType: string, status: string) => {
    const { data } = await api.post('/analytics/manage/status', { object_id: objectId, object_type: objectType, status });
    return data;
  },

  updateBudgetMeta: async (objectId: string, objectType: string, dailyBudget?: number, lifetimeBudget?: number) => {
    const { data } = await api.post('/analytics/manage/budget', {
      object_id: objectId, object_type: objectType, daily_budget: dailyBudget, lifetime_budget: lifetimeBudget,
    });
    return data;
  },

  getAccountTrend: async (days = 30, since?: string, until?: string, timeIncrement = 1) => {
    const params: any = { days, time_increment: timeIncrement };
    if (since && until) { params.since = since; params.until = until; }
    const { data } = await api.get('/analytics/account-trend', { params });
    return data;
  },

  getDashboard: async (campaignId: number, days = 7) => {
    const { data } = await api.get<PerformanceDashboard>(`/analytics/dashboard/${campaignId}`, {
      params: { days },
    });
    return data;
  },

  getMetaCampaigns: async (datePreset = 'last_7d') => {
    const { data } = await api.get('/analytics/meta-campaigns', { params: { date_preset: datePreset } });
    return data;
  },

  generateReport: async (request: {
    campaign_id?: number;
    meta_campaign_id?: string;
    start_date: string;
    end_date: string;
  }) => {
    const { data } = await api.post('/analytics/report', request);
    return data;
  },

  sendReportEmail: async (request: {
    campaign_id?: number;
    meta_campaign_id?: string;
    start_date: string;
    end_date: string;
    email: string;
    report_data?: any;
  }) => {
    const { data } = await api.post('/analytics/report/email', request);
    return data;
  },

  testEmail: async () => {
    const { data } = await api.post('/analytics/report/email/test');
    return data;
  },

  reallocateBudget: async (campaignId: number, pauseUnderperforming = true, reallocateToWinner = true) => {
    const { data } = await api.post('/analytics/reallocate-budget', {
      campaign_id: campaignId,
      pause_underperforming: pauseUnderperforming,
      reallocate_to_winner: reallocateToWinner,
    });
    return data;
  },

  learnFromPerformance: async (campaignId: number, applyToFuture = true) => {
    const { data } = await api.post('/analytics/learn-from-performance', {
      campaign_id: campaignId,
      apply_to_future: applyToFuture,
    });
    return data;
  },

  getSummary: async (days = 30) => {
    const { data } = await api.get('/analytics/summary', { params: { days } });
    return data;
  },

  // 자동 관리 룰
  getRules: async () => {
    const { data } = await api.get('/analytics/rules');
    return data;
  },
  createRule: async (ruleData: any) => {
    const { data } = await api.post('/analytics/rules', ruleData);
    return data;
  },
  updateRule: async (ruleId: string, ruleData: any) => {
    const { data } = await api.put(`/analytics/rules/${ruleId}`, ruleData);
    return data;
  },
  deleteRule: async (ruleId: string) => {
    const { data } = await api.delete(`/analytics/rules/${ruleId}`);
    return data;
  },
  executeRules: async () => {
    const { data } = await api.post('/analytics/rules/execute');
    return data;
  },
  getRuleLogs: async (limit = 50) => {
    const { data } = await api.get('/analytics/rules/logs', { params: { limit } });
    return data;
  },
  aiRecommendRules: async (overviewData?: any) => {
    const { data } = await api.post('/analytics/rules/ai-recommend', { overview_data: overviewData || null });
    return data;
  },

  // 스케줄 리포트
  getSchedules: async () => {
    const { data } = await api.get('/analytics/schedules');
    return data;
  },
  createSchedule: async (schedData: any) => {
    const { data } = await api.post('/analytics/schedules', schedData);
    return data;
  },
  updateSchedule: async (schedId: string, schedData: any) => {
    const { data } = await api.put(`/analytics/schedules/${schedId}`, schedData);
    return data;
  },
  deleteSchedule: async (schedId: string) => {
    const { data } = await api.delete(`/analytics/schedules/${schedId}`);
    return data;
  },
  runScheduleNow: async (schedId: string) => {
    const { data } = await api.post(`/analytics/schedules/${schedId}/run-now`);
    return data;
  },
  getSchedulerStatus: async () => {
    // scheduler/status is at root level, not under /api/v1
    const backendBase = API_BASE.replace(/\/api\/v1\/?$/, '');
    const url = backendBase ? `${backendBase}/scheduler/status` : '/scheduler/status';
    const { data } = await axios.get(url);
    return data;
  },

  // 성과 피드백 API
  getPerformanceFeedback: async (campaignId: string, datePreset = 'last_7d') => {
    const cacheKey = `perf-feedback_${campaignId}_${datePreset}`;
    const cached = getCachedData<any>(cacheKey);
    // Only use cache if it has valid feedback data
    if (cached) {
      const fb = cached?.feedback || cached;
      if (fb?.conversion_analysis) return cached;
      // Invalid cache — remove it
      localStorage.removeItem(CACHE_PREFIX + cacheKey);
    }
    const { data } = await api.post<PerformanceFeedback>('/analytics/performance-feedback', {
      campaign_id: campaignId,
      date_preset: datePreset,
    });
    setCachedData(cacheKey, data);
    return data;
  },

  // 광고 댓글 관리
  getAdComments: async (adId: string, limit = 100) => {
    const { data } = await api.get(`/analytics/ad/${adId}/comments`, { params: { limit } });
    return data;
  },

  getAdPostInfo: async (adId: string) => {
    const { data } = await api.get(`/analytics/ad/${adId}/post-info`);
    return data;
  },

  // 소재별 일별 트렌드
  getAdTrend: async (adId: string, days = 7) => {
    const { data } = await api.get(`/analytics/ad/${adId}/trend`, { params: { days } });
    return data;
  },
};

// Campaign Planner API
export const campaignPlannerApi = {
  autoPlan: async (request: AutoPlanRequest) => {
    const { data } = await api.post<AutoPlanResponse>('/campaign-planner/auto-plan', request);
    return data;
  },

  designStructure: async (request: {
    product_list: Array<{ name: string; category: string; price: number; promo_info?: string }>;
    schedule: { promo_start_date: string; promo_end_date: string };
    total_budget: number;
    brand_name: string;
  }) => {
    const { data } = await api.post('/campaign-planner/structure', request);
    return data;
  },

  designTargeting: async (request: {
    product_category: string;
    budget: number;
    past_performance_data?: any;
    brand_info?: string;
  }) => {
    const { data } = await api.post('/campaign-planner/targeting', request);
    return data;
  },

  generateCopywriting: async (request: {
    products: Array<{ name: string; description: string; price: number; promo?: string }>;
    purpose: string;
    brand_voice?: string;
    tone?: string;
  }) => {
    const { data } = await api.post('/campaign-planner/copywriting', request);
    return data;
  },

  generateUTM: async (request: {
    base_url: string;
    products: string[];
    campaign_names: string[];
    platforms: string[];
  }) => {
    const { data } = await api.post('/campaign-planner/utm', request);
    return data;
  },

  analyzeCSV: async (file: File, platform: string, analysisType: string) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('platform', platform);
    formData.append('analysis_type', analysisType);
    const { data } = await api.post('/campaign-planner/analyze-csv', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  },

  predictCreative: async (request: {
    past_creatives: Array<{ type: string; style: string; ctr: number; cvr: number; spend: number }>;
    new_creative_description: string;
  }) => {
    const { data } = await api.post('/campaign-planner/predict-creative', request);
    return data;
  },
};

// Market Keywords API (TAB 1 - Keyword Monitoring)
export const marketApi = {
  registerKeyword: async (keyword: string) => {
    const { data } = await api.post('/market/keywords', { keyword });
    return data;
  },

  listKeywords: async () => {
    const { data } = await api.get('/market/keywords');
    return data;
  },

  removeKeyword: async (keywordId: string) => {
    await api.delete(`/market/keywords/${keywordId}`);
  },

  analyzeKeyword: async (keywordId: string, days?: number) => {
    const { data } = await api.post(`/market/keywords/${keywordId}/analyze`, days ? { days } : undefined);
    return data;
  },

  compareKeywords: async (keywordIds: string[]) => {
    const { data } = await api.post('/market/keywords/compare', { keyword_ids: keywordIds });
    return data;
  },

  // 키워드 순위 체크
  checkKeywordRanks: async (keywordIds?: string[], brandName = '널담') => {
    const { data } = await api.post('/market/keywords/rank-check', {
      keyword_ids: keywordIds || null,
      brand_name: brandName,
    });
    return data;
  },

  // 순위 스케줄 CRUD
  createRankSchedule: async (scheduleData: {
    name?: string;
    brand_name?: string;
    keyword_filter?: string;
    schedule_type: string;
    day_of_week?: number;
    day_of_month?: number;
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

// AI Chat API
export const chatApi = {
  send: async (message: string, history: { role: string; content: string }[] = []) => {
    const { data } = await api.post<ChatResponse>('/ai/chat', { message, history });
    return data;
  },
};

// ─── localStorage cache helpers (survives F5 / tab switch) ───
const CACHE_PREFIX = 'mc_cache_';
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

function getCachedData<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > THREE_HOURS_MS) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return data as T;
  } catch { return null; }
}

function setCachedData(key: string, data: unknown): void {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ data, ts: Date.now() }));
  } catch { /* quota exceeded — ignore */ }
}

export function clearAnalysisCache(datePreset?: string): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CACHE_PREFIX)) {
        if (!datePreset || key.includes(datePreset)) {
          keysToRemove.push(key);
        }
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

// Currency & number formatting utilities
export function formatCurrency(amount: number, currency: string = 'KRW'): string {
  if (currency === 'KRW') {
    return `₩${Math.round(amount).toLocaleString('ko-KR')}`;
  }
  return `$${amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export function formatNumber(num: number, decimals: number = 0): string {
  return num.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatPercent(num: number, decimals: number = 2): string {
  return `${num.toFixed(decimals)}%`;
}

export default api;
