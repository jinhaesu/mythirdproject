import api from './api';

/** 자사몰 여정·상세 스크롤 — backend/app/api/v1/endpoints/journey.py */

export type JEntry = 'all' | 'main' | 'list' | 'detail' | 'brand' | 'other';
export type JDevice = 'all' | 'm' | 'pc';

export interface JStage {
  key: string; label: string; sessions: number;
  of_start: number | null; of_prev: number | null; drop: number;
}
export interface JSeg {
  name: string; key?: string; sessions: number; stages: number[];
  conv_rate: number | null; detail_rate: number | null; order_to_done: number | null;
}
export interface JMix {
  total: number; new: number; repeat: number; guest: number; pending?: number;
  new_share: number | null; repeat_share: number | null; guest_share: number | null; repeat_share_members: number | null;
}
export interface JSankeyNode { id: number; name: string; step: number; type: string }
export interface JFunnel {
  start: string; end: string; entry: JEntry; device: JDevice; truncated: boolean;
  sessions: number; visitors: number; pageviews_per_session: number | null; bounce_rate: number | null;
  stages: JStage[];
  drop_where: { stage: string; next: string; sessions: number;
    last_pages: { page_type: string; label: string; sessions: number; share: number | null }[] }[];
  segments: { visitor: JSeg[]; device: JSeg[]; entry: JSeg[]; source: JSeg[] };
  trend: { date: string; sessions: number; detail: number; intent: number; order: number; done: number; conv_rate: number | null }[];
  sankey: { nodes: JSankeyNode[]; links: { source: number; target: number; value: number }[]; steps: number };
  purchase_tracked: JMix; purchase_all: JMix;
  page_labels: Record<string, string>;
}
export interface JStatus {
  last24h: Record<string, number>; scroll_measured_24h: number;
  first_kst: string | null; last_kst: string | null;
}

export interface JCurvePt { p: number; share: number | null }
export interface JScrollSummary {
  views: number; median_page_pct: number | null;
  curve: JCurvePt[]; biggest_drop: { from: number; to: number; drop: number } | null;
  sections: { k: number; name: string; reach: number | null; stop: number | null }[];
  expand_rate: number | null; desc_views: number; desc_curve: JCurvePt[] | null; median_desc_pct: number | null;
  median_dwell_s: number | null; click_rate: number | null;
  median_page_pct_clicked: number | null; median_page_pct_not_clicked: number | null;
  expand_rate_clicked: number | null; expand_rate_not_clicked: number | null;
  small_sample: boolean;
}
export interface JScroll {
  start: string; end: string; unmeasured: number; min_views: number; section_names: string[];
  overall: JScrollSummary | null;
  products: (JScrollSummary & { product_no: number; name: string })[];
}

export const journeyApi = {
  status: async (): Promise<JStatus> => (await api.get('/journey/status')).data,
  funnel: async (start: string, end: string, entry: JEntry, device: JDevice): Promise<JFunnel> =>
    (await api.get('/journey/funnel', { params: { start, end, entry, device }, timeout: 120000 })).data,
  scroll: async (start: string, end: string, device: JDevice, min_views: number): Promise<JScroll> =>
    (await api.get('/journey/scroll', { params: { start, end, device, min_views }, timeout: 120000 })).data,
};
