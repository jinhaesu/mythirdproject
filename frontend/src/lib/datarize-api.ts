import api from './api';

/** 데이터라이즈(CRM) 구글시트 연동 — backend/app/api/v1/endpoints/datarize.py */

export type DatarizeBasis = 'visit' | 'click';

export interface DzMetrics {
  attempts: number; sent: number; cost: number;
  reach_rate: number | null; cost_per_reach: number | null;
  days: number; rows: number; small_sample: boolean;
  visitors?: number; clickers?: number | null;
  conv_users?: number | null; orders?: number | null; revenue?: number | null;
  visit_rate?: number | null; click_rate?: number | null; conv_rate?: number | null;
  roas?: number | null; revenue_per_reach?: number | null; aov?: number | null; cost_per_order?: number | null;
}
export type DzDelta = Partial<Record<keyof DzMetrics, number | null>>;

export interface DzMonthInfo {
  month: string; start: string; end: string; days_in_month: number; data_days: number;
  first: string | null; last: string | null; in_progress: boolean; partial: boolean;
}

export interface DzDailyRow {
  attempts?: number; sent?: number; cost?: number; visitors?: number; clickers?: number | null;
  conv_users?: number | null; orders?: number | null; revenue?: number | null;
}

export interface DatarizeReport {
  empty: boolean; basis: DatarizeBasis; month: string; prev_month: string; months: string[]; channels: string[];
  month_info: DzMonthInfo; prev_month_info: DzMonthInfo;
  totals: { cur: DzMetrics; prev: DzMetrics | null; delta: DzDelta };
  by_channel: { channel: string; cur: DzMetrics | null; prev: DzMetrics | null; delta: DzDelta }[];
  trend: {
    month: string; partial: boolean; data_days: number; in_progress: boolean;
    channels: Record<string, { source: 'message' | 'cost_only'; cost: number; sent: number | null;
      revenue: number | null; roas: number | null; small_sample: boolean }>;
  }[];
  cost_history: { month: string; channels: Record<string, number> }[];
  daily: { date: string; prev_date: string; weekday: string; cur: Record<string, DzDailyRow>; prev: Record<string, DzDailyRow> }[];
  campaigns: (DzMetrics & { channel: string; campaign_id: string; name: string })[];
  campaign_count: number;
  insights: { channel: string; tone: 'up' | 'down' | 'neutral' | 'info'; text: string }[];
  members: {
    cur: { date: string; total: number; email_opt_in: number; sms_opt_in: number; any_opt_in: number;
      email_rate: number | null; sms_rate: number | null } | null;
    prev: { date: string; total: number } | null;
    delta: { total?: number | null; email_opt_in?: number | null; sms_opt_in?: number | null };
  };
  segments: {
    date: string | null; compare_date: string | null;
    rows: { segment: string; classification: string | null; members: number; ratio: number | null;
      median_days_no_visit: number | null; median_days_no_purchase: number | null; avg_order_value: number | null;
      members_delta: number | null }[];
  };
  data_range: { first: string | null; last: string | null };
}

export interface DatarizeStatus {
  sheet_id: string; sheet_url: string; schedule_kst: string[]; next_run_kst: string;
  running: boolean; can_sync: boolean;
  ranges: Record<string, { from: string | null; to: string | null; rows: number }>;
  logs: { started_kst: string; finished_kst: string | null; status: string; trigger: string;
    tabs: Record<string, { ok: boolean; rows?: number; error?: string }> | null }[];
}

export const datarizeApi = {
  status: async (): Promise<DatarizeStatus> => (await api.get('/crm/datarize/status')).data,
  report: async (month: string | null, basis: DatarizeBasis): Promise<DatarizeReport> =>
    (await api.get('/crm/datarize/report', { params: { month: month || undefined, basis } })).data,
  sync: async (): Promise<{ status: string; tabs: Record<string, { ok: boolean; rows?: number; error?: string }> }> =>
    (await api.post('/crm/datarize/sync', null, { timeout: 180000 })).data,
};
