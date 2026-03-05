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
} from '@/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

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
    targeting?: any;
    creative_ids: number[];
    start_date?: string;
    end_date?: string;
  }) => {
    const { data } = await api.post<Campaign>('/campaign', campaignData);
    return data;
  },

  publish: async (campaignId: number) => {
    const { data } = await api.post<{
      success: boolean;
      meta_campaign_id?: string;
      status: string;
      message: string;
    }>('/campaign/publish', { campaign_id: campaignId });
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
};

// Analytics API (TAB 4)
export const analyticsApi = {
  getDashboard: async (campaignId: number, days = 7) => {
    const { data } = await api.get<PerformanceDashboard>(`/analytics/dashboard/${campaignId}`, {
      params: { days },
    });
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
};

export default api;
