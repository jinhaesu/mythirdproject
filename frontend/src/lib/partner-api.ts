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

partnerApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('partner_token');
        window.location.href = '/partner';
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
  verify: async (token: string): Promise<PartnerVerifyResponse> => {
    const { data } = await partnerApi.post('/partner/auth/verify', { token });
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
};

export default partnerApi;
