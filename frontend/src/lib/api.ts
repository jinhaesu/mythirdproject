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

// Handle 401 — passive cleanup only. Navigation/reload was causing infinite
// loops when 매직링크 verify가 401일 때 인터셉터가 reload → 같은 URL의 ?token=
// 으로 다시 verify → 401 → reload ... 무한 반복.
// 인증 상태는 zustand store(auth-storage)와 localStorage 'token' 양쪽에 있어
// 둘 다 정리. 컴포넌트가 isAuthenticated=false 감지하면 자연스럽게 LoginPage 렌더.
let _last401At = 0;
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // 짧은 시간 내 다중 401(여러 in-flight 요청이 동시에 401)을 1회로 합침
      const now = Date.now();
      if (now - _last401At > 500) {
        _last401At = now;
        try {
          localStorage.removeItem('token');
          // zustand persist도 동기화
          const raw = localStorage.getItem('auth-storage');
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (parsed && parsed.state) {
                parsed.state.user = null;
                parsed.state.token = null;
                parsed.state.isAuthenticated = false;
                localStorage.setItem('auth-storage', JSON.stringify(parsed));
              }
            } catch { /* ignore */ }
          }
          // 매직링크 토큰이 URL에 남아 있으면 제거 (재시도 루프 방지)
          if (typeof window !== 'undefined' && window.location.search.includes('token=')) {
            const u = new URL(window.location.href);
            u.searchParams.delete('token');
            window.history.replaceState({}, '', u.pathname + (u.search || ''));
          }
          // 컴포넌트에 인증 만료 알림 — Home 컴포넌트가 useAuthStore.logout() 호출
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('auth-expired'));
          }
        } catch { /* swallow */ }
      }
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

  verifyMagicLink: async (token: string, ref?: string) => {
    const { data } = await api.post<{ access_token: string; token_type: string }>('/auth/verify-magic-link', { token, ref });
    return data;
  },

  sso: async (token: string) => {
    const { data } = await api.post<{ access_token: string; token_type: string }>('/auth/sso', { token });
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

  updateMetaSettings: async (settings: { page_id?: string; instagram_account_id?: string }) => {
    const { data } = await api.put('/auth/meta/settings', settings);
    return data;
  },

  getConnectionsStatus: async (): Promise<ConnectionsStatus> => {
    const { data } = await api.get<ConnectionsStatus>('/auth/connections-status');
    return data;
  },
};

export interface ConnectionsStatus {
  cafe24: { connected: boolean; mall_id?: string | null; expires_at?: string | null; expiring_soon?: boolean };
  meta: { connected: boolean; user_id?: string | null; ad_account_id?: string | null; token_expired?: boolean; token_expires_at?: string | null };
  naver: { connected: boolean; search_ads: boolean; gfa: boolean };
}

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

  getCatalogs: async () => {
    const { data } = await api.get<Array<{ id: string; name: string }>>('/campaign/catalogs');
    return data;
  },

  getProductSets: async (catalogId: string) => {
    const { data } = await api.get<Array<{ id: string; name: string }>>(`/campaign/catalogs/${catalogId}/product-sets`);
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

// ─── Insights API (DB 스냅샷 기반 추세 — /insights 라우터) ───

/** GET /insights/trend 응답 타입 */
export interface InsightTrendPoint {
  date: string;
  date_end: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  roas: number;
  cpa: number;
  cpc: number;
  ctr: number;
}

export interface InsightTrendParams {
  days?: number;
  since?: string;   // YYYY-MM-DD
  until?: string;   // YYYY-MM-DD
  granularity?: 'daily' | 'weekly';
}

export interface InsightTrendCampaign {
  campaign_id: string;
  campaign_name: string;
  series: InsightTrendPoint[];
}

export interface InsightTrendResponse {
  as_of: string | null;
  account: { series: InsightTrendPoint[] };
  campaigns: InsightTrendCampaign[];
}

export interface InsightStatusResponse {
  as_of: string | null;
  total_rows: number;
  token_expired: boolean;
  last_error: string | null;
}

export interface InsightRefreshResponse {
  collected_rows: number;
  as_of: string;
}

/** GET /insights/hourly-heatmap 응답 */
export interface InsightHourlyHeatmapResponse {
  available: boolean;
  reason?: string;
  since?: string;
  until?: string;
  days?: number;
  /** 요청 범위가 92일을 초과해 최근 92일로 잘렸는지 */
  clamped?: boolean;
  /** 각 지표별 7(월~일)×24 매트릭스 */
  matrices?: {
    spend: number[][];
    impressions: number[][];
    clicks: number[][];
    purchases: number[][];
    revenue: number[][];
  };
  actions_available?: boolean;
  totals?: { spend: number; impressions: number; clicks: number; purchases: number; revenue: number };
  weekday_spend?: number[];
  hour_spend?: number[];
  basis?: { spend: string; attribution: string; period: string };
}

export const insightsApi = {
  /** DB 스냅샷 기반 추세 데이터 조회 — days 또는 since/until 커스텀 범위 + daily/weekly */
  getTrend: async (params: number | InsightTrendParams = 30): Promise<InsightTrendResponse> => {
    const p: InsightTrendParams = typeof params === 'number' ? { days: params } : params;
    const { data } = await api.get<InsightTrendResponse>('/insights/trend', { params: p });
    return data;
  },

  /** 즉시 수집 실행 (백필 포함) */
  refresh: async (): Promise<InsightRefreshResponse> => {
    const { data } = await api.post<InsightRefreshResponse>('/insights/refresh');
    return data;
  },

  /** 수집기 상태 조회 (토큰 만료 여부 포함) */
  getStatus: async (): Promise<InsightStatusResponse> => {
    const { data } = await api.get<InsightStatusResponse>('/insights/status');
    return data;
  },

  /** 요일×시간대별 실집행 히트맵 (Meta 라이브, 6h 서버 캐시) — days 또는 since/until */
  getHourlyHeatmap: async (
    params: { days?: number; since?: string; until?: string } = {},
  ): Promise<InsightHourlyHeatmapResponse> => {
    const { data } = await api.get<InsightHourlyHeatmapResponse>('/insights/hourly-heatmap', {
      params,
    });
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

// ─── Affiliate types ──────────────────────────────────────────────────────────

export type AffiliateChannelKey =
  | 'instagram'
  | 'youtube'
  | 'tiktok'
  | 'blog'
  | 'facebook'
  | 'x'
  | 'kakao'
  | 'other';

export interface PartnerCampaignLink {
  pc_id: number;
  campaign_id: number;
  campaign_name: string;
  referral_code: string;
  referral_link: string;
}

export type PartnerGroupKey = 'crew' | 'gongu' | 'ad' | 'other';

export interface AffiliatePartner {
  id: number;
  name: string;
  email: string;
  /** @deprecated prefer channels[] */
  channel: string;
  /** 다중 채널 (백엔드 JSON 파싱 후 반환) */
  channels?: string[];
  phone?: string | null;
  followers: number;
  status: 'pending' | 'approved' | 'rejected';
  total_sales: number;
  total_commission: number;
  unpaid_commission: number;
  /** 파트너에 연결된 캠페인별 링크 목록 (list_partners 응답) */
  campaign_links?: PartnerCampaignLink[];
  referral_link: string;
  click_count: number;
  conversion_count: number;
  joined_date: string;
  campaign_ids?: number[];
  memo?: string;
  /** 활동 그룹 분류 — crew(크루)/gongu(공구)/ad(광고)/other(기타) */
  partner_group?: PartnerGroupKey | string | null;
}

export interface AffiliateTimeseriesPoint {
  date: string;
  revenue: number;
  commission: number;
  clicks: number;
  conversions: number;
  refunded_count?: number;
  refunded_amount?: number;
  cancelled_count?: number;
  cancelled_amount?: number;
}

export interface AffiliateByCampaign {
  campaign_id: number;
  campaign_name: string;
  revenue: number;
  commission: number;
  clicks: number;
  conversions: number;
  partners: number;
}

export interface HourlyConversion {
  hour: number;
  day_of_week: number;
  conversions: number;
  revenue: number;
}

export interface TopProduct {
  product_no: number;
  product_name: string;
  product_image?: string | null;
  campaign_count: number;
  conversions: number;
  revenue: number;
  commission: number;
}

// Affiliate API (TAB: 어필리에이트 관리)
export const affiliateApi = {
  getDashboard: async (days?: number, basis?: 'converted' | 'clicked', range?: { since: string; until: string }, attribution?: 'confirmed' | 'all') => {
    const { data } = await api.get('/affiliate/dashboard', {
      params: {
        ...(range ? { since: range.since, until: range.until } : days ? { days } : {}),
        ...(basis === 'clicked' ? { basis } : {}),
        ...(attribution === 'all' ? { attribution } : {}),
      },
    });
    return data;
  },
  getCampaigns: async () => { const { data } = await api.get('/affiliate/campaigns'); return data; },
  createCampaign: async (d: any) => { const { data } = await api.post('/affiliate/campaigns', d); return data; },
  updateCampaign: async (id: number, d: any) => { const { data } = await api.put(`/affiliate/campaigns/${id}`, d); return data; },
  deleteCampaign: async (id: number, options?: { skipCafe24?: boolean }) => {
    const qs = options?.skipCafe24 ? '?skip_cafe24=true' : '';
    const { data } = await api.delete(`/affiliate/campaigns/${id}${qs}`);
    return data;
  },
  getPartners: async (): Promise<AffiliatePartner[]> => { const { data } = await api.get('/affiliate/partners'); return data; },
  createPartner: async (d: any) => { const { data } = await api.post('/affiliate/partners', d); return data; },
  approvePartner: async (id: number) => { const { data } = await api.post(`/affiliate/partners/${id}/approve`); return data; },
  rejectPartner: async (id: number) => { const { data } = await api.post(`/affiliate/partners/${id}/reject`); return data; },
  deletePartner: async (id: number) => { await api.delete(`/affiliate/partners/${id}`); },
  listTrashedPartners: async (): Promise<AffiliatePartner[]> => {
    const { data } = await api.get('/affiliate/partners/trash');
    return Array.isArray(data) ? data : [];
  },
  restorePartner: async (id: number) => {
    const { data } = await api.post(`/affiliate/partners/${id}/restore`);
    return data;
  },
  permanentDeletePartner: async (id: number) => {
    await api.delete(`/affiliate/partners/${id}/permanent`);
  },
  getSettlements: async () => { const { data } = await api.get('/affiliate/settlements'); return data; },
  createSettlement: async (d: any) => { const { data } = await api.post('/affiliate/settlements', d); return data; },
  paySettlement: async (id: number) => { const { data } = await api.post(`/affiliate/settlements/${id}/pay`); return data; },
  // 파트너별 정산서 엑셀 (3탭: 요약, 전체주문건, 취소건) 다운로드
  // sellerType: 'freelancer' → 세금 차감 / 'business' → 세금 차감 없음
  downloadSettlementExport: async (
    partnerId: number,
    opts?: {
      start?: string;
      end?: string;
      partnerName?: string;
      sellerType?: 'freelancer' | 'business';
    },
  ): Promise<void> => {
    const params: Record<string, string> = {};
    if (opts?.start) params.start = opts.start;
    if (opts?.end) params.end = opts.end;
    params.seller_type = opts?.sellerType ?? 'freelancer';
    const response = await api.get(`/affiliate/partners/${partnerId}/settlement-export`, {
      params,
      responseType: 'blob',
    });
    // Content-Disposition에서 파일명 추출 (RFC 5987 UTF-8 인코딩 대응)
    const cd: string | undefined = response.headers?.['content-disposition'] || response.headers?.['Content-Disposition'];
    let filename = `정산서_${opts?.partnerName ?? `partner${partnerId}`}.xlsx`;
    if (cd) {
      const m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
      if (m && m[1]) {
        try { filename = decodeURIComponent(m[1]); } catch { /* keep default */ }
      } else {
        const m2 = /filename="?([^";]+)"?/i.exec(cd);
        if (m2 && m2[1]) filename = m2[1];
      }
    }
    const blob = new Blob([response.data], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },
  getReferralPrograms: async () => { const { data } = await api.get('/affiliate/referral-programs'); return data; },
  createReferralProgram: async (d: any) => { const { data } = await api.post('/affiliate/referral-programs', d); return data; },
  updateReferralProgram: async (id: number, d: any) => { const { data } = await api.put(`/affiliate/referral-programs/${id}`, d); return data; },
  getMyPoints: async () => { const { data } = await api.get('/affiliate/my-points'); return data; },
  getMyReferralCode: async () => { const { data } = await api.get('/affiliate/my-referral-code'); return data; },
  createPartnerMulti: async (d: {
    name: string;
    email?: string;
    phone?: string | null;
    channel: string;
    channels: string[];
    followers: number;
    campaign_ids: number[];
    memo?: string;
  }) => { const { data } = await api.post('/affiliate/partners', d); return data; },
  updatePartner: async (id: number, d: Record<string, unknown>) => { const { data } = await api.put(`/affiliate/partners/${id}`, d); return data; },
  addPartnerCampaign: async (partnerId: number, campaignId: number) => { const { data } = await api.post(`/affiliate/partners/${partnerId}/campaigns`, { campaign_id: campaignId }); return data; },
  removePartnerCampaign: async (partnerId: number, pcId: number) => { await api.delete(`/affiliate/partners/${partnerId}/campaigns/${pcId}`); },
  getPartnerPerformance: async (partnerId: number) => { const { data } = await api.get(`/affiliate/partners/${partnerId}/performance`); return data; },
  auditPartner: async (partnerId: number) => { const { data } = await api.get(`/affiliate/partners/${partnerId}/audit`); return data; },
  getPartnerTimeseries: async (partnerId: number, days = 30) => {
    const { data } = await api.get(`/affiliate/partners/${partnerId}/timeseries`, { params: { days } });
    return data;
  },
  republishCampaignCategory: async (campaignId: number) => {
    const { data } = await api.post(`/affiliate/campaigns/${campaignId}/republish-category`);
    return data;
  },
  cafe24DebugCampaign: async (campaignId: number) => {
    const { data } = await api.get(`/affiliate/campaigns/${campaignId}/cafe24-debug`);
    return data;
  },
  reattachCampaignProducts: async (campaignId: number) => {
    const { data } = await api.post(`/affiliate/campaigns/${campaignId}/reattach-products`);
    return data;
  },
  getDashboardTimeseries: async (days = 30, range?: { since: string; until: string }, attribution?: 'confirmed' | 'all'): Promise<AffiliateTimeseriesPoint[]> => {
    const { data } = await api.get('/affiliate/dashboard/timeseries', {
      params: {
        ...(range ? { days, since: range.since, until: range.until } : { days }),
        ...(attribution === 'all' ? { attribution } : {}),
      },
    });
    return data;
  },
  getDashboardByCampaign: async (days?: number, basis?: 'converted' | 'clicked', range?: { since: string; until: string }, attribution?: 'confirmed' | 'all'): Promise<AffiliateByCampaign[]> => {
    const { data } = await api.get('/affiliate/dashboard/by-campaign', {
      params: {
        ...(range ? { since: range.since, until: range.until } : days ? { days } : {}),
        ...(basis === 'clicked' ? { basis } : {}),
        ...(attribution === 'all' ? { attribution } : {}),
      },
    });
    return data;
  },
  getDashboardHourly: async (days = 30, attribution?: 'confirmed' | 'all'): Promise<HourlyConversion[]> => {
    const { data } = await api.get('/affiliate/dashboard/hourly', {
      params: { days, ...(attribution === 'all' ? { attribution } : {}) },
    });
    return data;
  },
  getTopProducts: async (limit = 10, days?: number, basis?: 'converted' | 'clicked', range?: { since: string; until: string }, attribution?: 'confirmed' | 'all'): Promise<TopProduct[]> => {
    const { data } = await api.get('/affiliate/dashboard/top-products', {
      params: {
        limit,
        ...(range ? { since: range.since, until: range.until } : days ? { days } : {}),
        ...(basis === 'clicked' ? { basis } : {}),
        ...(attribution === 'all' ? { attribution } : {}),
      },
    });
    return data;
  },
  getTrackingStatus: async (): Promise<AffiliateTrackingStatus> => {
    const { data } = await api.get('/affiliate/tracking-status');
    return data;
  },
  getRetroAnalysis: async (refresh = false): Promise<AffiliateRetroAnalysis> => {
    const { data } = await api.get('/affiliate/retro-analysis', { params: refresh ? { refresh: true } : {} });
    return data;
  },
  setPartnerCampaignCoupon: async (partnerId: number, pcId: number, couponCode: string | null) => {
    const { data } = await api.patch(`/affiliate/partners/${partnerId}/campaigns/${pcId}/coupon`, { coupon_code: couponCode });
    return data;
  },
};

export interface AffiliateRetroAnalysis {
  as_of: string;
  tracker_installed_at: string;
  calibration: {
    window_start: string;
    confirmed_revenue: number;
    confirmed_count: number;
    shadow_total_revenue: number;
    shadow_total_count: number;
    min_required_confirmed: number;
    ready: boolean;
    ratio: number | null;
  };
  months: { month: string; estimated_orders: number; estimated_revenue: number; corrected_revenue: number | null }[];
  chain_bounds: {
    window_minutes: number;
    real: { members: number; revenue_30d: number };
    placebo_72h: { members: number; revenue_30d: number };
    net_members: number;
    net_revenue_30d: number;
    note: string;
  };
}

export interface AffiliateTrackingStatus {
  mode: 'strict_env' | 'strict_auto' | 'loose' | 'confirmed_first';
  auto_threshold_7d: number;
  binds_total: number;
  binds_7d: number;
  binds_by_day: { date: string; count: number }[];
  sources_30d: { source: string; confirmed: boolean; count: number; order_amount: number }[];
  confirmed_share_30d: number;
}

// Cafe24 API
export const cafe24Api = {
  getStatus: async () => { const { data } = await api.get('/cafe24/status'); return data; },
  startAuth: async (mallId: string) => { const { data } = await api.get('/cafe24/auth/start', { params: { mall_id: mallId } }); return data; },
  disconnect: async () => { const { data } = await api.post('/cafe24/disconnect'); return data; },
  listProducts: async (q?: string, limit = 50) => {
    const { data } = await api.get('/cafe24/products', { params: { q, limit } });
    return Array.isArray(data) ? data : (data?.products ?? []);
  },
};

// AI Chat API
export const chatApi = {
  send: async (message: string, history: { role: string; content: string }[] = []) => {
    const { data } = await api.post<ChatResponse>('/ai/chat', { message, history });
    return data;
  },
};

// ─── 공통 파일 다운로드 헬퍼 (엑셀 export 등) ───

/** GET 요청으로 blob을 받아 Content-Disposition의 filename*(UTF-8)을 파싱해 다운로드시킨다. */
export async function downloadFile(path: string, params?: Record<string, any>): Promise<void> {
  const response = await api.get(path, { params, responseType: 'blob' });
  const cd: string | undefined = response.headers?.['content-disposition'] || response.headers?.['Content-Disposition'];
  let filename = (path.split('/').pop() || 'download') + '.xlsx';
  if (cd) {
    const m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    if (m && m[1]) {
      try { filename = decodeURIComponent(m[1]); } catch { /* keep default */ }
    } else {
      const m2 = /filename="?([^";]+)"?/i.exec(cd);
      if (m2 && m2[1]) filename = m2[1];
    }
  }
  const blob = new Blob([response.data], {
    type: response.headers?.['content-type'] || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

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

// ─── KPI API (마케팅 KPI 탭 — /kpi 라우터) ───

export interface KPIChannelSpend {
  id: number | null; // null = meta 자동계산 가상 행 (DB row 없음)
  month: string;
  channel: string;
  planned_amount: number | null;
  actual_amount: number | null;
  is_auto?: boolean; // meta 자동계산 여부
  memo: string | null;
  /** 기타(etc) 등 채널의 표시명. 지정 시 CHANNEL_LABELS보다 우선 표시 */
  channel_label?: string | null;
  /** 이 채널이 매출에 관여하는지 여부 (그 외 마케팅 KPI 채널 광고비 전용) */
  revenue_linked?: boolean;
  /** 매출 관여 채널의 채널 매출 (revenue_linked=true일 때만 유효) */
  revenue?: number | null;
  /** 비관여(브랜딩) 채널의 월 조회수 */
  views?: number | null;
}

export interface KPIMallMetrics {
  orders_count: number;
  revenue: number;
  buyers: number;
  guest_orders: number;
  aov: number;
  new_customers: number;
  visits?: number | null;            // 월 방문자수 (카페24 Analytics, 미수집 시 null)
  conversion_rate?: number | null;   // 구매전환율 % = 주문수/방문자수 (자동 산출)
  /** 고객 1인당 평균 구매횟수 = 회원 주문수 ÷ 구매 회원수 (비회원 주문 제외) */
  avg_orders_per_customer?: number | null;
}

export interface KPIGoal {
  month: string;
  target_cac: number | null;
  target_ltv: number | null;
  target_ltv_cac: number | null;
  target_conversion_rate: number | null;
  target_aov: number | null;
  target_new_customers: number | null;
  actual_conversion_rate: number | null;
  memo: string | null;
}

export interface KPIMonthSummary {
  /** granularity='month'이면 "YYYY-MM", week/day면 버킷 시작일 ISO("YYYY-MM-DD") */
  month: string;
  /** week/day 모드에서만 존재 — 버킷 종료일 ISO */
  bucket_end?: string | null;
  meta_spend: number;
  channel_spends: KPIChannelSpend[];
  total_ad_spend: number;
  mall: KPIMallMetrics | null;
  cac: number | null;
  ltv: number | null;
  ltv_cac: number | null;
  goal: KPIGoal | null;
}

export type KPIGranularity = 'month' | 'week' | 'day';

export interface KPISummaryResponse {
  months: KPIMonthSummary[];
  granularity?: KPIGranularity;
}

export interface KPISummaryParams {
  granularity?: KPIGranularity;
  /** granularity='month'일 때: 3 | 6 | 12 */
  months?: number;
  /** granularity='week' | 'day'일 때: 30 | 90 */
  days?: number;
}

export interface KPIGoalUpdatePayload {
  target_cac?: number | null;
  target_ltv?: number | null;
  target_ltv_cac?: number | null;
  target_conversion_rate?: number | null;
  target_aov?: number | null;
  target_new_customers?: number | null;
  actual_conversion_rate?: number | null;
  memo?: string | null;
}

export interface KPIChannelSpendUpdatePayload {
  month: string;
  channel: string;
  planned_amount?: number | null;
  actual_amount?: number | null;
  memo?: string | null;
  /** 'mall'(자사몰, 기본값) | 'external'(그 외 채널). 미전달 시 백엔드가 'mall'로 처리 */
  scope?: 'mall' | 'external';
  /** 기타(etc) 등 채널의 표시명 */
  channel_label?: string | null;
  /** 이 채널이 매출에 관여하는지 여부 (그 외 마케팅 KPI 채널 광고비 전용) */
  revenue_linked?: boolean;
  /** 매출 관여 채널의 채널 매출 (revenue_linked=true일 때만 유효) */
  revenue?: number | null;
  /** 비관여(브랜딩) 채널의 월 조회수 */
  views?: number | null;
}

export interface KPIBackfillOrdersResponse {
  fetched: number;
  upserted: number;
  months: string[]; // 처리된 월 목록 ["2026-01", ...]
}

export interface KPINaverVolumeStat {
  total: number;
  pc: number;
  mobile: number;
}

export interface KPINaverQueriesResponse {
  keywords: string[];
  series: Array<Record<string, any>>;
  /** true면 절대 검색량(results_absolute) 기반, false면 상대지수(results) fallback */
  isAbsolute: boolean;
  /** isAbsolute=true일 때만 존재 — 키워드별 최근 기간 총검색량 */
  volumes?: Record<string, KPINaverVolumeStat>;
}

export interface KPISignupHeatmapResponse {
  since: string;
  until: string;
  /** 7(요일, 월=0) × 24(시간) 가입자 수 매트릭스 */
  matrix: number[][];
  total: number;
  weekday_totals: number[];
  hour_totals: number[];
  monthly_counts: Array<{ month: string; count: number }>;
  coverage: {
    members_enriched: number;
    members_with_join: number;
    buyers_total: number;
    privacy_source: number;
    /** true면 비구매 가입자 포함 전체 가입 데이터 (개인정보 스코프 백필 완료) */
    full_signup_data: boolean;
    members_with_gender?: number;
    members_with_birthyear?: number;
  };
}

export interface KPIDemographicRow {
  month: string;
  band: string;
  new_customers: number;
  ltv_customers: number;
  ltv: number | null;
  meta_spend: number | null;
  cac: number | null;
}

export interface KPIDemographicsResponse {
  months: string[];
  age_bands: string[];
  gender_bands: string[];
  age: KPIDemographicRow[];
  gender: KPIDemographicRow[];
  meta_available: boolean;
  coverage: {
    members_enriched: number;
    gender_known: number;
    birthyear_known: number;
  };
  basis: Record<string, string>;
}

export interface DataDashboardInvolvedEntry {
  channel: string;
  label: string;
  spend: number;
  revenue: number | null;
  roas: number | null;
  is_auto: boolean;
}

export interface DataDashboardUninvolvedEntry {
  channel: string;
  label: string;
  spend: number;
  views: number | null;
}

export interface DataDashboardMonth {
  month: string;
  involved: DataDashboardInvolvedEntry[];
  uninvolved: DataDashboardUninvolvedEntry[];
  totals: {
    involved_spend: number;
    involved_revenue: number;
    blended_roas: number | null;
    uninvolved_spend: number;
    uninvolved_views: number;
    total_spend: number;
    mall_revenue: number;
  };
}

export interface DataDashboardResponse {
  months: DataDashboardMonth[];
}

export const kpiApi = {
  /** KPI 요약 (채널 광고비, 자사몰 지표, CAC/LTV, 목표). granularity=month|week|day */
  getSummary: async (params: KPISummaryParams = { granularity: 'month', months: 6 }): Promise<KPISummaryResponse> => {
    const { data } = await api.get<KPISummaryResponse>('/kpi/summary', { params });
    return data;
  },

  /** 데이터 대시보드 — 판매채널 월별 ROAS(관여) + 브랜딩 채널 광고비·조회수(비관여) */
  getDataDashboard: async (months = 6): Promise<DataDashboardResponse> => {
    const { data } = await api.get<DataDashboardResponse>('/kpi/data-dashboard', { params: { months } });
    return data;
  },

  /** 월별 목표 upsert */
  listGoals: async (months = 12, includeFuture = 0): Promise<KPIGoal[]> => {
    // 응답은 {goals: [...]} 래핑 — 배열로 언래핑해서 반환
    const { data } = await api.get<any>('/kpi/goals', { params: { months, include_future: includeFuture } });
    return data?.goals ?? data ?? [];
  },
  updateGoal: async (month: string, payload: KPIGoalUpdatePayload): Promise<KPIGoal> => {
    const { data } = await api.put<KPIGoal>(`/kpi/goals/${month}`, payload);
    return data;
  },

  /** 채널 광고비 upsert (month + channel 기준) */
  updateChannelSpend: async (payload: KPIChannelSpendUpdatePayload): Promise<KPIChannelSpend> => {
    const { data } = await api.put<KPIChannelSpend>('/kpi/channel-spend', payload);
    return data;
  },

  /** 채널 광고비 삭제 */
  deleteChannelSpend: async (id: number): Promise<void> => {
    await api.delete(`/kpi/channel-spend/${id}`);
  },

  /** 자사몰 주문 백필 (CAC/LTV 계산용 원천 데이터 수집) */
  backfillOrders: async (since = '2026-01-01'): Promise<KPIBackfillOrdersResponse> => {
    const { data } = await api.post<KPIBackfillOrdersResponse>('/kpi/backfill-orders', null, { params: { since } });
    return data;
  },

  /** 회원가입 시간대 히트맵 (요일×시간) */
  getSignupHeatmap: async (
    months = 3,
    gender: 'all' | 'M' | 'F' = 'all',
    ageBand = 'all',
  ): Promise<KPISignupHeatmapResponse> => {
    const { data } = await api.get<KPISignupHeatmapResponse>('/kpi/signup-heatmap', {
      params: { months, gender, age_band: ageBand },
    });
    return data;
  },

  /** 연령대·성별 LTV/CAC/신규고객 (Meta 연령별 광고비 결합) */
  getDemographics: async (months = 6): Promise<KPIDemographicsResponse> => {
    const { data } = await api.get<KPIDemographicsResponse>('/kpi/demographics', { params: { months } });
    return data;
  },

  /** 네이버 데이터랩 검색량 추이 (키워드 최대 5개, 쉼표 구분).
   * 백엔드가 절대 검색량(results_absolute: [{title, data: [{period, count}]}]) + volumes를
   * 제공하면 그걸로 시리즈를 구성하고 isAbsolute=true 반환. 없으면 상대지수(results:
   * [{title, data: [{period, ratio}]}]) 기반 fallback으로 isAbsolute=false 반환. */
  getNaverQueries: async (keywords: string[], months = 6): Promise<KPINaverQueriesResponse> => {
    const { data } = await api.get<any>('/kpi/naver-queries', {
      params: { keywords: keywords.join(','), months },
    });

    const resultsAbsolute: Array<{ title: string; data: Array<{ period: string; count: number }> }> | undefined =
      data?.results_absolute;

    if (resultsAbsolute && resultsAbsolute.length > 0) {
      const byPeriod: Record<string, Record<string, any>> = {};
      for (const r of resultsAbsolute) {
        for (const point of r.data ?? []) {
          const period = (point.period || '').slice(0, 7); // YYYY-MM
          if (!period) continue;
          byPeriod[period] = byPeriod[period] || { period };
          byPeriod[period][r.title] = point.count;
        }
      }
      const series = Object.values(byPeriod).sort((a, b) =>
        String(a.period).localeCompare(String(b.period))
      );
      return {
        keywords: data?.keywords ?? resultsAbsolute.map((r) => r.title),
        series,
        isAbsolute: true,
        volumes: data?.volumes,
      };
    }

    const results: Array<{ title: string; data: Array<{ period: string; ratio: number }> }> =
      data?.results ?? [];
    const byPeriod: Record<string, Record<string, any>> = {};
    for (const r of results) {
      for (const point of r.data ?? []) {
        const period = (point.period || '').slice(0, 7); // YYYY-MM
        if (!period) continue;
        byPeriod[period] = byPeriod[period] || { period };
        byPeriod[period][r.title] = point.ratio;
      }
    }
    const series = Object.values(byPeriod).sort((a, b) =>
      String(a.period).localeCompare(String(b.period))
    );
    return { keywords: data?.keywords ?? results.map((r) => r.title), series, isAbsolute: false };
  },
};

// ─── 그 외 마케팅 KPI (자사몰 외 채널) API (/kpi/external-* 라우터) ───

export interface KPIExternalGoal {
  month: string;
  target_spend: number | null;
  target_revenue: number | null;
  actual_revenue_manual: number | null;
  memo: string | null;
}

export interface KPIExternalMonthSummary {
  month: string;
  channel_spends: KPIChannelSpend[];
  total_spend: number;
  groupbuy_revenue: number;
  groupbuy_orders: number;
  manual_revenue: number;
  /** 매출 관여(revenue_linked) 채널들의 매출 합 */
  channel_revenue: number;
  /** groupbuy_revenue + channel_revenue + (manual_revenue||0) */
  total_revenue: number;
  goal: KPIExternalGoal | null;
}

export interface KPIExternalTopCampaign {
  campaign_id: number;
  campaign_name: string;
  revenue: number;
  orders: number;
}

export interface KPIExternalSummaryResponse {
  months: KPIExternalMonthSummary[];
  top_campaigns: KPIExternalTopCampaign[];
}

export interface KPIExternalGoalUpdatePayload {
  target_spend?: number | null;
  target_revenue?: number | null;
  actual_revenue_manual?: number | null;
  memo?: string | null;
}

export const externalKpiApi = {
  /** 그 외(자사몰 외) 마케팅 KPI 요약 — 외부 채널 광고비 + 공동구매(어필리에이트) 매출 */
  getSummary: async (months = 12): Promise<KPIExternalSummaryResponse> => {
    const { data } = await api.get<KPIExternalSummaryResponse>('/kpi/external-summary', { params: { months } });
    return data;
  },

  listGoals: async (months = 12, includeFuture = 0): Promise<KPIExternalGoal[]> => {
    const { data } = await api.get<any>('/kpi/external-goals', { params: { months, include_future: includeFuture } });
    return data?.goals ?? data ?? [];
  },
  /** 월별 그 외 채널 목표 upsert (목표 광고비/목표 매출/기타 판매채널 매출) */
  updateGoal: async (month: string, payload: KPIExternalGoalUpdatePayload): Promise<KPIExternalGoal> => {
    const { data } = await api.put<KPIExternalGoal>(`/kpi/external-goals/${month}`, payload);
    return data;
  },
};

// ─── Influencer 시딩 API (/influencer 라우터) ───

export type InfluencerChannel = 'instagram' | 'youtube' | 'blog' | 'tiktok' | 'etc';

export interface InfluencerSeeding {
  id: number;
  name: string;
  channel: string;
  url?: string | null;
  follower_count?: number | null;
  cost?: number | null;
  seeded_at: string; // YYYY-MM-DD
  product?: string | null;
  notes?: string | null;
  ai_target_segment?: string | null;
  ai_audience_summary?: string | null;
  ai_analyzed_at?: string | null;
}

export interface InfluencerSeedingCreatePayload {
  name: string;
  channel: string;
  url?: string;
  follower_count?: number;
  cost?: number;
  seeded_at: string;
  product?: string;
  notes?: string;
}

export type InfluencerSeedingUpdatePayload = Partial<InfluencerSeedingCreatePayload>;

export interface InfluencerSummaryByChannel { channel: string; total_cost: number; count: number; }
export interface InfluencerSummaryBySegment { segment: string; total_cost: number; count: number; }
export interface InfluencerSummaryByMonth { month: string; total_cost: number; count: number; }

export interface InfluencerSummaryResponse {
  by_channel: InfluencerSummaryByChannel[];
  by_segment: InfluencerSummaryBySegment[];
  by_month: InfluencerSummaryByMonth[];
  total: { cost: number; count: number; analyzed_count: number };
}

export const influencerApi = {
  /** 시딩 목록 조회 */
  listSeedings: async (channel?: string, limit = 200): Promise<InfluencerSeeding[]> => {
    // 백엔드는 {seedings: [...], count} 래핑으로 응답
    const { data } = await api.get<{ seedings: InfluencerSeeding[]; count: number }>('/influencer/seedings', {
      params: { channel: channel || undefined, limit },
    });
    return Array.isArray(data) ? data : (data?.seedings ?? []);
  },

  /** 시딩 등록 */
  createSeeding: async (payload: InfluencerSeedingCreatePayload): Promise<InfluencerSeeding> => {
    const { data } = await api.post<InfluencerSeeding>('/influencer/seedings', payload);
    return data;
  },

  /** 시딩 부분 수정 */
  updateSeeding: async (id: number, payload: InfluencerSeedingUpdatePayload): Promise<InfluencerSeeding> => {
    const { data } = await api.put<InfluencerSeeding>(`/influencer/seedings/${id}`, payload);
    return data;
  },

  /** 시딩 삭제 */
  deleteSeeding: async (id: number): Promise<void> => {
    await api.delete(`/influencer/seedings/${id}`);
  },

  /** AI 타겟 세그먼트/오디언스 요약 분석 (10~30초 소요) */
  analyzeSeeding: async (id: number): Promise<InfluencerSeeding> => {
    const { data } = await api.post<InfluencerSeeding>(`/influencer/seedings/${id}/analyze`);
    return data;
  },

  /** 채널별/세그먼트별/월별 시딩 비용 요약 */
  getSummary: async (months = 12): Promise<InfluencerSummaryResponse> => {
    const { data } = await api.get<InfluencerSummaryResponse>('/influencer/summary', { params: { months } });
    return data;
  },
};

// ─── 홈 브리핑 (업무 중심 개편 2026-09) ─────────────────────────────────────
export const homeApi = {
  /** 전 채널 통합 브리핑 — DB 로컬 집계라 즉시 로딩 */
  getBriefing: async (): Promise<any> => {
    const { data } = await api.get('/home/briefing');
    return data;
  },
};

// ─── 마케팅 활동 기록 (콘텐츠/인플루언서/체험단/서포터즈) ────────────────────
export interface MarketingActivityRow {
  id: number;
  activity_type: string;
  entry_kind: string; // actual(실적) | plan(계획)
  product?: string | null;
  product_category?: string | null;
  channel?: string | null;
  purpose?: string | null;
  status?: string | null;
  period_month: string;
  activity_date?: string | null;
  quantity: number;
  views: number;
  reach: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  follows: number;
  cost: number;
  cost_per_view?: number | null;
  link?: string | null;
  metrics_as_of?: string | null; // 조회수 등 지표 기준일
  notes?: string | null;
  source: string;
}

export type MarketingActivityInput = Omit<MarketingActivityRow, 'id' | 'cost_per_view' | 'source'> & {
  source?: string;
};

export const activitiesApi = {
  list: async (params: {
    activity_type?: string; entry_kind?: string; month_from?: string; month_to?: string;
    channel?: string; product?: string; q?: string; limit?: number; offset?: number;
  } = {}): Promise<{ total: number; items: MarketingActivityRow[] }> => {
    const { data } = await api.get('/activities', { params });
    return data;
  },
  create: async (payload: MarketingActivityInput): Promise<MarketingActivityRow> => {
    const { data } = await api.post('/activities', payload);
    return data;
  },
  update: async (id: number, payload: MarketingActivityInput): Promise<MarketingActivityRow> => {
    const { data } = await api.patch(`/activities/${id}`, payload);
    return data;
  },
  remove: async (id: number): Promise<void> => {
    await api.delete(`/activities/${id}`);
  },
  meta: async (): Promise<{
    activity_types: string[]; channels: string[]; products: string[];
    product_categories: string[]; purposes: string[];
  }> => {
    const { data } = await api.get('/activities/meta');
    return data;
  },
  summary: async (params: { month_from?: string; month_to?: string; activity_type?: string } = {}): Promise<{
    by_month_channel: any[]; by_product: any[]; by_type: any[];
  }> => {
    const { data } = await api.get('/activities/summary', { params });
    return data;
  },
};

// ─── 공구 보드 ───────────────────────────────────────────────────────────────
export interface GroupBuyInput {
  name: string;
  description?: string | null;
  status: string; // planned|active|done
  start_date?: string | null;
  end_date?: string | null;
  target_revenue?: number | null;
  memo?: string | null;
  campaign_ids?: number[];
}

export const groupbuysApi = {
  list: async (): Promise<any[]> => {
    const { data } = await api.get('/groupbuys');
    return data;
  },
  detail: async (id: number): Promise<any> => {
    const { data } = await api.get(`/groupbuys/${id}`);
    return data;
  },
  create: async (payload: GroupBuyInput): Promise<any> => {
    const { data } = await api.post('/groupbuys', payload);
    return data;
  },
  update: async (id: number, payload: GroupBuyInput): Promise<any> => {
    const { data } = await api.patch(`/groupbuys/${id}`, payload);
    return data;
  },
  remove: async (id: number): Promise<void> => {
    await api.delete(`/groupbuys/${id}`);
  },
  attachCampaigns: async (id: number, campaign_ids: number[]): Promise<any> => {
    const { data } = await api.post(`/groupbuys/${id}/campaigns`, { campaign_ids });
    return data;
  },
  detachCampaign: async (id: number, campaignId: number): Promise<void> => {
    await api.delete(`/groupbuys/${id}/campaigns/${campaignId}`);
  },
  candidates: async (q: string, excludeGroupBuy?: number): Promise<{ id: number; name: string; status: string }[]> => {
    const { data } = await api.get('/groupbuys/candidates', {
      params: { q: q || undefined, exclude_group_buy: excludeGroupBuy },
    });
    return data;
  },
};

// ─── Meta 일별 원본 테이블 (MAIN SHEET 대체) ─────────────────────────────────
export const insightsDailyApi = {
  table: async (params: {
    days?: number; since?: string; until?: string; campaign_q?: string;
    limit?: number; offset?: number;
  } = {}): Promise<{ total: number; since: string; until: string; items: any[] }> => {
    const { data } = await api.get('/insights/daily-table', { params });
    return data;
  },
  exportCsv: (params: { days?: number; since?: string; until?: string; campaign_q?: string } = {}) =>
    downloadFile('/insights/daily-export', params),
};

// ─── 광고비 일보 (매체별 일별 광고비) ────────────────────────────────────────
export interface AdMediaRow {
  media_id: number; name: string; group_name?: string | null; inflow?: string | null;
  owner?: string | null;
  auto: boolean; auto_source?: string | null; memo?: string | null;
  daily: Record<string, number>;
  month_total: number; limit_amount?: number | null; plan_amount?: number | null;
  note?: string | null;
  usage_pct?: number | null;
}

export const adspendApi = {
  board: async (month: string): Promise<{
    month: string; days_in_month: number; rows: AdMediaRow[];
    day_totals: Record<string, number>;
    totals: { spend: number; limit: number; plan: number; usage_pct: number | null };
    as_of: string;
  }> => {
    const { data } = await api.get('/adspend/board', { params: { month } });
    return data;
  },
  upsertEntry: async (media_id: number, date: string, amount: number) => {
    const { data } = await api.put('/adspend/entry', { media_id, date, amount });
    return data;
  },
  upsertBudget: async (media_id: number, month: string, payload: { limit_amount?: number; plan_amount?: number; note?: string }) => {
    const { data } = await api.put('/adspend/budget', { media_id, month, ...payload });
    return data;
  },
  createMedia: async (payload: {
    name: string; group_name?: string; inflow?: string; auto_source?: string | null;
    sort_order?: number; memo?: string;
  }) => {
    const { data } = await api.post('/adspend/media', payload);
    return data;
  },
  updateMedia: async (id: number, payload: any, active?: boolean) => {
    const { data } = await api.patch(`/adspend/media/${id}`, payload, { params: { active } });
    return data;
  },
  roasBoard: async (opts: number | { monthsBack?: number; monthFrom?: string; monthTo?: string } = 6): Promise<{
    months: string[]; this_month: string; inflows: string[]; as_of: string;
    cells: {
      month: string; inflow: string; spend: number; limit: number | null;
      usage_pct: number | null; revenue: number | null; revenue_auto: boolean;
      revenue_source?: 'sales' | 'manual' | null; sales_linked?: boolean; roas: number | null;
    }[];
  }> => {
    const o = typeof opts === 'number' ? { monthsBack: opts } : opts;
    const params: Record<string, any> = {};
    if (o.monthFrom && o.monthTo) { params.month_from = o.monthFrom; params.month_to = o.monthTo; }
    else params.months_back = o.monthsBack ?? 6;
    const { data } = await api.get('/adspend/roas-board', { params });
    return data;
  },
  upsertRevenue: async (month: string, inflow: string, revenue: number) => {
    const { data } = await api.put('/adspend/revenue', { month, inflow, revenue });
    return data;
  },
  exportXlsx: (month: string) => downloadFile('/adspend/export', { month }),
  monthlySummary: async (month: string): Promise<{
    month: string; by_inflow: { inflow: string; spend: number; limit: number; plan: number }[];
    totals: { spend: number; limit: number; plan: number; usage_pct: number | null };
  }> => {
    const { data } = await api.get('/adspend/monthly-summary', { params: { month } });
    return data;
  },
};

// ─── 협찬 관리 (sponsorship) ─────────────────────────────────────────────────
export interface SponsorshipItemRow {
  id?: number; product: string; quantity: number;
  estimated_value?: number | null; note?: string | null;
}
export interface SponsorshipOutcomeRow {
  id: number; kind: string; link?: string | null; views?: number | null;
  note?: string | null; occurred_at?: string | null;
}
export interface SponsorshipRow {
  id: number; target_name: string; event_type: string; event_type_label?: string;
  sponsored_at: string | null; product: string; quantity: number;
  estimated_value?: number | null; reason?: string | null; expected_effect?: string | null;
  conditions?: string | null; notes?: string | null;
  items: SponsorshipItemRow[]; outcomes: SponsorshipOutcomeRow[];
}

export const sponsorshipApi = {
  list: async (params?: { event_type?: string; since?: string; until?: string; q?: string }):
    Promise<{ events: SponsorshipRow[]; count: number }> => {
    const { data } = await api.get('/sponsorship/events', { params });
    return data;
  },
  create: async (payload: any): Promise<SponsorshipRow> => {
    const { data } = await api.post('/sponsorship/events', payload);
    return data;
  },
  update: async (id: number, payload: any): Promise<SponsorshipRow> => {
    const { data } = await api.put(`/sponsorship/events/${id}`, payload);
    return data;
  },
  remove: async (id: number) => {
    const { data } = await api.delete(`/sponsorship/events/${id}`);
    return data;
  },
  addOutcome: async (eventId: number, payload: any): Promise<SponsorshipOutcomeRow> => {
    const { data } = await api.post(`/sponsorship/events/${eventId}/outcomes`, payload);
    return data;
  },
  updateOutcome: async (outcomeId: number, payload: any): Promise<SponsorshipOutcomeRow> => {
    const { data } = await api.put(`/sponsorship/outcomes/${outcomeId}`, payload);
    return data;
  },
  removeOutcome: async (outcomeId: number) => {
    const { data } = await api.delete(`/sponsorship/outcomes/${outcomeId}`);
    return data;
  },
  summary: async (months = 12): Promise<{
    as_of: string;
    by_month: { month: string; count: number; quantity: number; estimated_value: number; outcomes: number }[];
    by_product: { product: string; count: number; quantity: number; estimated_value: number }[];
    by_event_type: { event_type: string; count: number; quantity: number; estimated_value: number; outcomes: number }[];
    by_condition: { condition: string; count: number }[];
    by_outcome_kind: { kind: string; count: number; views: number }[];
    total: { count: number; quantity: number; estimated_value: number; outcomes: number; views: number };
  }> => {
    const { data } = await api.get('/sponsorship/summary', { params: { months } });
    return data;
  },
  meta: async (): Promise<{ event_types: string[]; products: string[]; outcome_kinds: string[] }> => {
    const { data } = await api.get('/sponsorship/meta');
    return data;
  },
  exportXlsx: () => downloadFile('/sponsorship/export'),
};

// ─── 소셜 채널 오가닉 (유튜브 공개 데이터 · 인스타 자사 계정) ─────────────────
export const socialApi = {
  ytVideo: async (video: string): Promise<any> => {
    const { data } = await api.get('/social/youtube/video', { params: { video } });
    return data;
  },
  ytComments: async (video: string, limit = 20, order: 'relevance' | 'time' = 'relevance'): Promise<any> => {
    const { data } = await api.get('/social/youtube/video/comments', { params: { video, limit, order } });
    return data;
  },
  ytChannel: async (channel: string, videos = 10): Promise<any> => {
    const { data } = await api.get('/social/youtube/channel', { params: { channel, videos } });
    return data;
  },
  igAuthStart: async (): Promise<{ auth_url: string; redirect_uri: string }> => {
    const { data } = await api.get('/social/instagram/auth/start');
    return data;
  },
  igStatus: async (): Promise<{ connected: boolean; mode: string | null; expires_at: string | null; app_configured: boolean }> => {
    const { data } = await api.get('/social/instagram/status');
    return data;
  },
  igSetToken: async (accessToken: string): Promise<{ connected: boolean; username?: string; followers?: number }> => {
    const { data } = await api.post('/social/instagram/token', { access_token: accessToken });
    return data;
  },
  igDisconnect: async () => {
    const { data } = await api.delete('/social/instagram/token');
    return data;
  },
  igMedia: async (limit = 24): Promise<any> => {
    const { data } = await api.get('/social/instagram/media', { params: { limit } });
    return data;
  },
  igComments: async (mediaId: string, limit = 30): Promise<any> => {
    const { data } = await api.get(`/social/instagram/media/${mediaId}/comments`, { params: { limit } });
    return data;
  },
  refreshActivityMetrics: async (monthsBack = 3): Promise<any> => {
    const { data } = await api.post('/social/refresh-activity-metrics', null, { params: { months_back: monthsBack } });
    return data;
  },
  igAccountInsights: async (days = 30): Promise<any> => {
    const { data } = await api.get('/social/instagram/account-insights', { params: { days } });
    return data;
  },
  igHashtag: async (tag: string, mode: 'top' | 'recent' = 'top'): Promise<any> => {
    const { data } = await api.get('/social/instagram/hashtag', { params: { tag, mode } });
    return data;
  },
  igTagged: async (limit = 30): Promise<any> => {
    const { data } = await api.get('/social/instagram/tagged', { params: { limit } });
    return data;
  },
  igCommentReply: async (commentId: string, message: string): Promise<any> => {
    const { data } = await api.post(`/social/instagram/comments/${commentId}/reply`, { message });
    return data;
  },
  igDiscover: async (username: string): Promise<any> => {
    const { data } = await api.get('/social/instagram/discover', { params: { username } });
    return data;
  },
};

// ─── 크리에이터 풀 (잠재풀·유상구좌) ─────────────────────────────────────────
export interface CreatorRow {
  id: number; username: string; name?: string | null;
  followers?: number | null; media_count?: number | null;
  avg_likes?: number | null; avg_comments?: number | null; engagement_rate?: number | null;
  biography?: string | null; picture_url?: string | null;
  category?: string | null; status: string; is_paid: boolean; fee?: number | null;
  source?: string | null; memo?: string | null;
  last_checked_at?: string | null; profile_url: string;
  snapshot_error?: string;
}

export const creatorsApi = {
  list: async (params?: { status?: string; is_paid?: boolean; q?: string }):
    Promise<{ creators: CreatorRow[]; count: number }> => {
    const { data } = await api.get('/social/creators', { params });
    return data;
  },
  add: async (payload: any): Promise<CreatorRow> => {
    const { data } = await api.post('/social/creators', payload);
    return data;
  },
  update: async (id: number, payload: any): Promise<CreatorRow> => {
    const { data } = await api.patch(`/social/creators/${id}`, payload);
    return data;
  },
  refresh: async (id: number): Promise<CreatorRow> => {
    const { data } = await api.post(`/social/creators/${id}/refresh`);
    return data;
  },
  remove: async (id: number) => {
    const { data } = await api.delete(`/social/creators/${id}`);
    return data;
  },
};

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
