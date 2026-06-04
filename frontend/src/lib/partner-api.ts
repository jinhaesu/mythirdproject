import axios from 'axios';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PartnerInfo {
  id: number;
  name: string;
  email: string;
  phone?: string | null;
  channel: string;
  channels?: string[];
}

export interface PartnerVerifyResponse {
  access_token: string;
  token_type: string;
  partner: PartnerInfo;
}

export interface PartnerDashboard {
  total_products: number;
  total_clicks: number;
  total_conversions: number;
  conversion_rate: number;
  total_sales: number;
  avg_order_value: number;
  total_commission: number;
  unpaid_commission: number;
  paid_commission: number;
  refunded_count?: number;
  refunded_amount?: number;
  cancelled_count?: number;
  cancelled_amount?: number;
  gross_sales?: number;
}

export interface PartnerTimeseriesPoint {
  date: string;
  clicks: number;
  conversions: number;
  sales: number;
  commission: number;
}

export interface PartnerCampaign {
  campaign_id: number;
  campaign_name: string;
  product_name: string;
  product_image?: string | null;
  referral_link: string;
  clicks: number;
  conversions: number;
  sales: number;
  commission: number;
  commission_type: 'percentage' | 'fixed';
  commission_rate: number;
  refunded_count?: number;
  refunded_amount?: number;
  cancelled_count?: number;
  cancelled_amount?: number;
}

// ─── Axios instance ───────────────────────────────────────────────────────────

const partnerApi = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
});

partnerApi.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('partner_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// 401 처리 — passive cleanup. window.location.href = '/partner' 강제 navigate가
// 무한 새로고침 루프의 원인이었음 (만료된 ?token=URL 접속 → verify 401 → navigate
// → URL의 ?token= 그대로 → 다시 verify → 무한). 토큰만 제거하고 URL의 token 파라미터도
// 같이 정리. 컴포넌트가 partner state null 감지하면 자연스럽게 LoginView 렌더.
let _partner_last401At = 0;
partnerApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      const now = Date.now();
      if (now - _partner_last401At > 500) {
        _partner_last401At = now;
        try {
          localStorage.removeItem('partner_token');
          if (window.location.search.includes('token=')) {
            const u = new URL(window.location.href);
            u.searchParams.delete('token');
            window.history.replaceState({}, '', u.pathname + (u.search || ''));
          }
          // 컴포넌트에 인증 만료 알림 — DashboardView 등이 이미 마운트된 상태에서
          // 401이 떨어지면 setPartner(null)로 LoginView로 자연스럽게 전환
          window.dispatchEvent(new CustomEvent('partner-auth-expired'));
        } catch { /* ignore */ }
      }
    }
    return Promise.reject(error);
  },
);

// ─── Auth API ─────────────────────────────────────────────────────────────────

export const partnerAuthApi = {
  sendMagicLink: async (email: string): Promise<{ success: boolean }> => {
    const { data } = await partnerApi.post('/partner/auth/send-magic-link', { email });
    return data;
  },
  sendSmsLink: async (phone: string): Promise<{ success: boolean }> => {
    const { data } = await partnerApi.post('/partner/auth/send-sms-link', { phone });
    return data;
  },
  verify: async (token: string): Promise<PartnerVerifyResponse> => {
    const { data } = await partnerApi.post('/partner/auth/verify', { token });
    return data;
  },
  // 로그인된 파트너가 자신의 실시간 매출 확인 매직링크를 즉시 발급
  // (마케팅팀 발송 업무 경감용 — 본인/동료 공유)
  issueShareLink: async (): Promise<{ magic_link: string; expires_in: number }> => {
    const { data } = await partnerApi.post('/partner/auth/issue-share-link', {});
    return data;
  },
};

// ─── Dashboard API ────────────────────────────────────────────────────────────

export const partnerDashboardApi = {
  getMe: async (): Promise<PartnerInfo> => {
    const { data } = await partnerApi.get('/partner/me');
    return data;
  },
  getDashboard: async (): Promise<PartnerDashboard> => {
    const { data } = await partnerApi.get('/partner/dashboard');
    return data;
  },
  getCampaigns: async (): Promise<PartnerCampaign[]> => {
    const { data } = await partnerApi.get('/partner/campaigns');
    return data;
  },
  getTimeseries: async (days = 30): Promise<PartnerTimeseriesPoint[]> => {
    const { data } = await partnerApi.get('/partner/timeseries', { params: { days } });
    return data;
  },
};

export default partnerApi;
