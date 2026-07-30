'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users, Link2, Share2, TrendingUp, DollarSign, Award, Plus, Search,
  Eye, Copy, CheckCircle, Clock, X, BarChart2, Gift, UserPlus, ExternalLink,
  Percent, ShoppingBag, Megaphone, Settings, Filter, Download, Loader2,
  AlertCircle, Coins, Tag, Store, ChevronDown, Trash2, Pencil, Phone, Briefcase,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
  LabelList,
  ComposedChart,
} from 'recharts';
import { affiliateApi, authApi, cafe24Api, formatCurrency } from '@/lib/api';
import type { AffiliatePartner, AffiliateTimeseriesPoint, AffiliateByCampaign, AffiliateChannelKey, HourlyConversion, TopProduct, ConnectionsStatus, PartnerGroupKey } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AffiliateCampaign {
  id: number;
  name: string;
  product: string;
  commission_type: 'percentage' | 'fixed';
  commission_rate: number;
  status: 'active' | 'paused' | 'ended';
  start_date: string;
  end_date?: string;
  total_sales: number;
  total_commission: number;
  partner_count: number;
  click_count: number;
  conversion_count: number;
  conversion_rate: number;
  // Cafe24 확장 필드
  cafe24_product_no?: number;
  cafe24_product_name?: string;
  cafe24_product_image?: string;
  cafe24_coupon_code?: string;
  base_product_url?: string;
  discount_type?: 'percentage' | 'fixed' | 'shipping';
  discount_value?: number;
  // Phase 6 — 비공개 카테고리 필드
  cafe24_category_no?: number | null;
  cafe24_category_name?: string | null;
  cafe24_category_url?: string | null;
  cafe24_product_nos?: string | null;  // JSON array string
  // 캠페인 추적 링크
  referral_link?: string | null;
}

// AffiliatePartner is imported from @/lib/api

interface ReferralProgram {
  id: number;
  name: string;
  reward_type: 'points' | 'coupon' | 'cash';
  referrer_reward: number;
  referee_reward: number;
  status: 'active' | 'paused';
  total_referrals: number;
  total_signups: number;
  conversion_rate: number;
}

interface Settlement {
  id: number;
  partner_id: number;
  partner_name: string;
  amount: number;
  status: 'pending' | 'paid';
  created_at: string;
  paid_at?: string;
}

interface DashboardData {
  total_sales: number;
  total_commission: number;
  active_partners: number;
  total_clicks: number;
  total_conversions: number;
  conversion_rate: number;
  active_campaigns: AffiliateCampaign[];
  top_partners: AffiliatePartner[];
  // 환불/취소 필드 (백엔드 확장)
  refunded_count?: number;
  cancelled_count?: number;
  gross_sales?: number;
  net_sales?: number;
}

interface NewCampaignForm {
  name: string;
  product: string;
  commission_type: 'percentage' | 'fixed';
  commission_rate: number;
  start_date: string;
  end_date: string;
  cafe24_product_no?: number;
  cafe24_product_name?: string;
  discount_type?: 'percentage' | 'fixed' | 'shipping';
  discount_value?: number;
  // Phase 6 — 비공개 카테고리 다중 상품 모드
  cafe24_product_nos?: number[];
  cafe24_product_meta?: Array<{ no: number; name: string; image?: string }>;
  auto_create_category?: boolean;
  cafe24_category_name?: string;
}

interface NewPartnerForm {
  name: string;
  email: string;
  phone: string;
  /** 대표 채널 (하위 호환용, channels[0] 로 채워짐) */
  channel: string;
  /** 다중 채널 선택 */
  channels: string[];
  followers: number;
  campaign_ids: number[];
  memo: string;
  /** 활동 그룹 분류 (크루/공구/광고/기타) */
  partner_group: PartnerGroupKey;
}

interface NewReferralProgramForm {
  name: string;
  reward_type: 'points' | 'coupon' | 'cash';
  referrer_reward: number;
  referee_reward: number;
}

interface AffiliateSettingsForm {
  default_commission_rate: number;
  cookie_lifetime_days: number;
  min_payout_amount: number;
  payout_cycle: 'weekly' | 'biweekly' | 'monthly';
  notify_new_partner: boolean;
  notify_conversion: boolean;
  notify_payout: boolean;
  notify_daily_report: boolean;
}

interface Cafe24Status {
  connected: boolean;
  mall_id?: string;
  scopes?: string;
  needs_reauth?: boolean;
  missing_scopes?: string[];
  required_scopes?: string[];
}

function priceToNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

interface Cafe24Product {
  product_no: number;
  product_name: string;
  price: number | string;
  list_image: string;
  sellers_price?: number | string;
  retail_price?: number | string;
}

interface PointTransaction {
  id: number;
  amount: number;
  reason: string;
  memo: string;
  related_user_id?: number;
  created_at: string;
}

interface PointsData {
  balance: number;
  transactions: PointTransaction[];
}

interface ReferralCodeData {
  referral_code: string;
  signup_link: string;
}

interface PartnerPerformanceRow {
  campaign_id: number;
  campaign_name: string;
  clicks: number;
  conversions: number;
  sales: number;
  commission: number;
  pc_id: number;
  referral_code?: string | null;
  referral_link?: string | null;
  coupon_code?: string | null;
}

type SectionKey = 'dashboard' | 'campaigns' | 'partners' | 'referral' | 'points' | 'settlement' | 'settings';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function n(val: unknown): number { return Number(val) || 0; }
function fmt(val: unknown): string { return n(val).toLocaleString(); }
function fmtPct(val: unknown, decimals = 1): string { return n(val).toFixed(decimals); }
function fmtMan(val: unknown): string { return n(val) > 0 ? `₩${(n(val) / 10000).toFixed(0)}만` : '₩0'; }

// ─── Channel helpers ──────────────────────────────────────────────────────────

interface ChannelOption {
  key: AffiliateChannelKey;
  label: string;
  badge: string;
  color: string;
}

const CHANNEL_OPTIONS: ChannelOption[] = [
  { key: 'instagram', label: 'Instagram', badge: 'IG',   color: 'bg-red/20 text-red border-red/30' },
  { key: 'youtube',   label: 'YouTube',   badge: 'YT',   color: 'bg-red/20 text-red border-red/30' },
  { key: 'tiktok',    label: 'TikTok',    badge: 'TK',   color: 'bg-teal/20 text-teal border-teal/30' },
  { key: 'blog',      label: '블로그',    badge: 'BLOG', color: 'bg-green/20 text-green border-green/30' },
  { key: 'facebook',  label: 'Facebook',  badge: 'FB',   color: 'bg-blue/20 text-blue border-blue/30' },
  { key: 'x',         label: 'X(Twitter)', badge: 'X',  color: 'bg-bg-3/20 text-text-secondary border-border-tertiary/30' },
  { key: 'kakao',     label: 'KakaoTalk', badge: 'KT',  color: 'bg-yellow/20 text-yellow border-yellow/30' },
  { key: 'other',     label: '기타',      badge: 'ETC', color: 'bg-brand/20 text-accent border-brand/30' },
];

const CHANNEL_MAP = Object.fromEntries(CHANNEL_OPTIONS.map(c => [c.key, c])) as Record<string, ChannelOption>;

/** 채널 키(또는 임의 문자열)를 배지 배열로 변환 */
function ChannelBadges({ channels, channel }: { channels?: string[]; channel?: string }) {
  const list: string[] = channels && channels.length > 0 ? channels : channel ? [channel] : [];
  if (list.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {list.map(ch => {
        const opt = CHANNEL_MAP[ch];
        return (
          <span
            key={ch}
            className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${opt?.color ?? 'bg-bg-3/20 text-text-tertiary border-border-tertiary/30'}`}
          >
            {opt?.badge ?? ch.toUpperCase()}
          </span>
        );
      })}
    </span>
  );
}

const REASON_LABEL: Record<string, string> = {
  referral_bonus_referrer: '추천 보상',
  referral_bonus_referee: '가입 보상',
  manual: '수동 지급',
};
function reasonLabel(reason: string): string {
  return REASON_LABEL[reason] ?? reason;
}

// ─── Partner group options (활동 그룹 분류) ────────────────────────────────────

interface PartnerGroupOption {
  key: PartnerGroupKey;
  label: string;
  color: string;            // badge color (셀/배지)
  tabColor: string;         // active tab color
}

const PARTNER_GROUP_OPTIONS: PartnerGroupOption[] = [
  { key: 'crew',  label: '크루', color: 'bg-green/15 text-green border-green/30', tabColor: 'border-green/50 text-green' },
  { key: 'gongu', label: '공구', color: 'bg-blue/15 text-blue border-blue/30',           tabColor: 'border-blue/50 text-blue' },
  { key: 'ad',    label: '광고', color: 'bg-yellow/15 text-yellow border-yellow/30',     tabColor: 'border-yellow/50 text-yellow' },
  { key: 'other', label: '기타', color: 'bg-bg-3/15 text-text-secondary border-border-tertiary/30',         tabColor: 'border-border-secondary text-text-secondary' },
];
const PARTNER_GROUP_MAP = Object.fromEntries(PARTNER_GROUP_OPTIONS.map(g => [g.key, g])) as Record<PartnerGroupKey, PartnerGroupOption>;
function normalizePartnerGroup(g?: string | null): PartnerGroupKey {
  if (g === 'crew' || g === 'gongu' || g === 'ad' || g === 'other') return g;
  return 'crew'; // 기본값 — DB default와 동일
}

// ─── Shared UI: SearchBar / DateRangeFilter / FilterTabs ──────────────────────

function SearchBar({
  value,
  onChange,
  placeholder,
  hint,
  width = 'w-64',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  hint?: string;
  width?: string;
}) {
  return (
    <div className={`relative ${width}`}>
      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-7 pr-7 py-1.5 bg-bg-2 border border-border-primary rounded-lg text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-green/50"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          title="검색어 지우기"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-text-tertiary hover:text-text-primary rounded"
        >
          <X size={11} />
        </button>
      )}
      {hint && !value && (
        <p className="absolute top-full left-0 mt-1 text-[10px] text-text-tertiary truncate">{hint}</p>
      )}
    </div>
  );
}

// ─── Date range filter ────────────────────────────────────────────────────────

export interface DateRange {
  start: string;  // YYYY-MM-DD (포함 시작), '' 이면 미설정
  end: string;    // YYYY-MM-DD (포함 끝), '' 이면 미설정
}

function todayStr(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function firstOfMonth(offsetMonths = 0): string {
  const d = new Date();
  d.setMonth(d.getMonth() + offsetMonths, 1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}-01`;
}

function lastOfMonth(offsetMonths = 0): string {
  const d = new Date();
  d.setMonth(d.getMonth() + offsetMonths + 1, 0);  // 다음 달의 0일 = 이번 달 마지막 날
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function DateRangeFilter({
  value,
  onChange,
  align = 'left',
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
  align?: 'left' | 'right';
}) {
  const today = todayStr();
  const presets = [
    { label: '오늘',   range: { start: today, end: today } },
    { label: '이번 달', range: { start: firstOfMonth(0), end: lastOfMonth(0) } },
    { label: '지난달', range: { start: firstOfMonth(-1), end: lastOfMonth(-1) } },
  ];

  const matchesPreset = (label: string) => {
    const p = presets.find(x => x.label === label);
    return !!p && p.range.start === value.start && p.range.end === value.end;
  };
  const isAll = !value.start && !value.end;

  return (
    <div className={`flex items-center gap-1.5 flex-wrap ${align === 'right' ? 'justify-end' : ''}`}>
      <button
        type="button"
        onClick={() => onChange({ start: '', end: '' })}
        className={`px-2 py-1 text-[11px] rounded border transition-colors ${
          isAll
            ? 'bg-green/15 border-green/40 text-green'
            : 'border-border-primary text-text-tertiary hover:text-text-primary hover:border-border-tertiary'
        }`}
      >
        전체
      </button>
      {presets.map(p => (
        <button
          key={p.label}
          type="button"
          onClick={() => onChange(p.range)}
          className={`px-2 py-1 text-[11px] rounded border transition-colors ${
            matchesPreset(p.label)
              ? 'bg-green/15 border-green/40 text-green'
              : 'border-border-primary text-text-tertiary hover:text-text-primary hover:border-border-tertiary'
          }`}
        >
          {p.label}
        </button>
      ))}
      <div className="flex items-center gap-1 ml-1 pl-2 border-l border-border-primary">
        <input
          type="date"
          value={value.start}
          onChange={(e) => onChange({ ...value, start: e.target.value })}
          className="px-2 py-1 bg-bg-2 border border-border-primary rounded text-[11px] text-text-primary focus:outline-none focus:border-green/50"
          title="시작일"
        />
        <span className="text-text-tertiary text-[11px]">~</span>
        <input
          type="date"
          value={value.end}
          onChange={(e) => onChange({ ...value, end: e.target.value })}
          className="px-2 py-1 bg-bg-2 border border-border-primary rounded text-[11px] text-text-primary focus:outline-none focus:border-green/50"
          title="종료일"
        />
      </div>
    </div>
  );
}

// ─── Filter tabs (대분류 탭) ───────────────────────────────────────────────────

function FilterTabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ key: T; label: string; count?: number; tabColor?: string }>;
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="flex items-center gap-0 border-b border-border-primary overflow-x-auto">
      {options.map(opt => {
        const active = opt.key === value;
        const colorCls = active
          ? (opt.tabColor || 'border-green/50 text-green')
          : 'border-transparent text-text-tertiary hover:text-text-primary';
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${colorCls}`}
          >
            {opt.label}
            {opt.count !== undefined && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                active ? 'bg-[rgb(var(--color-overlay-rgb)/0.15)] text-text-primary' : 'bg-[rgb(var(--color-overlay-rgb)/0.05)] text-text-tertiary'
              }`}>
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// 기간 필터링 헬퍼 — date가 [start, end] 범위(포함)에 속하면 true.
// start/end가 비어있으면 해당 경계 제한 없음.
function isInRange(dateIso: string | null | undefined, range: DateRange): boolean {
  if (!range.start && !range.end) return true;
  if (!dateIso) return false;
  const ymd = dateIso.length >= 10 ? dateIso.substring(0, 10) : dateIso;
  if (range.start && ymd < range.start) return false;
  if (range.end && ymd > range.end) return false;
  return true;
}

// 캠페인 진행 기간이 필터 기간과 1일이라도 겹치면 true
function campaignOverlapsRange(c: { start_date?: string | null; end_date?: string | null }, range: DateRange): boolean {
  if (!range.start && !range.end) return true;
  const cStart = c.start_date ? c.start_date.substring(0, 10) : '';
  const cEnd = c.end_date ? c.end_date.substring(0, 10) : '9999-12-31';
  // 캠페인 [cStart, cEnd] vs 필터 [range.start, range.end] 의 교집합 여부
  const fStart = range.start || '0000-01-01';
  const fEnd = range.end || '9999-12-31';
  if (!cStart) return true;  // 시작일 모르면 범위 미정 → 포함
  return cStart <= fEnd && cEnd >= fStart;
}

function campaignStatusBadge(status: AffiliateCampaign['status']) {
  if (status === 'active') return 'bg-green/20 text-green';
  if (status === 'paused') return 'bg-yellow/20 text-yellow';
  return 'bg-bg-3/20 text-text-tertiary';
}

function campaignStatusLabel(status: AffiliateCampaign['status']) {
  if (status === 'active') return '활성';
  if (status === 'paused') return '일시정지';
  return '종료';
}

function partnerStatusBadge(status: AffiliatePartner['status']) {
  if (status === 'approved') return 'bg-green/20 text-green';
  if (status === 'pending') return 'bg-yellow/20 text-yellow';
  return 'bg-red/20 text-red';
}

function partnerStatusLabel(status: AffiliatePartner['status']) {
  if (status === 'approved') return '승인';
  if (status === 'pending') return '대기';
  return '거절';
}

// ─── Loading / Error helpers ──────────────────────────────────────────────────

function SectionLoader() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 size={24} className="text-green animate-spin" />
    </div>
  );
}

function SectionError({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-2">
      <AlertCircle size={24} className="text-red" />
      <p className="text-sm text-text-tertiary">{message ?? '데이터를 불러오지 못했습니다'}</p>
    </div>
  );
}

// ─── Cafe24 Status Banner ─────────────────────────────────────────────────────

// ─── 연결 상태등 위젯 ─────────────────────────────────────────────────────────

function ConnectionStatusIndicator() {
  const { data } = useQuery<ConnectionsStatus>({
    queryKey: ['connections-status'],
    queryFn: authApi.getConnectionsStatus,
    retry: 1,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  if (!data) return null;

  const items = [
    {
      label: 'Cafe24',
      connected: data.cafe24.connected,
      warning: data.cafe24.expiring_soon && data.cafe24.connected,
      detail: data.cafe24.mall_id || undefined,
    },
    {
      label: 'Meta',
      connected: data.meta.connected,
      detail: data.meta.ad_account_id || undefined,
    },
    {
      label: 'Naver',
      connected: data.naver.connected,
      detail: [data.naver.search_ads ? '검색' : null, data.naver.gfa ? 'GFA' : null].filter(Boolean).join(' · ') || undefined,
    },
  ];

  const anyDisconnected = items.some(i => !i.connected);
  const anyWarning = items.some(i => i.warning);

  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border ${
      anyDisconnected ? 'bg-red/5 border-red/20' : anyWarning ? 'bg-yellow/5 border-yellow/20' : 'bg-bg-3 border-border-primary'
    }`}>
      <span className="text-[10px] font-medium text-text-tertiary uppercase tracking-wider shrink-0">연결 상태</span>
      <div className="flex items-center gap-4 flex-wrap">
        {items.map((item) => {
          const color = item.warning ? 'bg-yellow/20' : item.connected ? 'bg-green/20' : 'bg-red/20';
          const textColor = item.warning ? 'text-yellow' : item.connected ? 'text-text-secondary' : 'text-red';
          return (
            <div
              key={item.label}
              className="flex items-center gap-1.5 group relative"
              title={
                item.warning
                  ? `${item.label}: 토큰 만료 임박`
                  : item.connected
                    ? `${item.label}: 연결됨${item.detail ? ` (${item.detail})` : ''}`
                    : `${item.label}: 연결 안 됨`
              }
            >
              <span className={`w-2 h-2 rounded-full ${color} ${!item.connected || item.warning ? 'animate-pulse' : ''}`} />
              <span className={`text-xs font-medium ${textColor}`}>{item.label}</span>
              {item.detail && item.connected && !item.warning && (
                <span className="text-[10px] text-text-tertiary hidden md:inline">({item.detail})</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


function Cafe24Banner() {
  const qc = useQueryClient();
  const [mallIdInput, setMallIdInput] = useState('');
  const [showMallInput, setShowMallInput] = useState(false);
  const [showScopeDetail, setShowScopeDetail] = useState(false);

  const { data: status, isLoading, refetch: refetchStatus } = useQuery<Cafe24Status>({
    queryKey: ['cafe24', 'status'],
    queryFn: cafe24Api.getStatus,
    retry: 1,
    staleTime: 5_000,
    refetchInterval: 60_000, // 1분마다 연결 상태 재확인
    refetchOnMount: 'always',
  });

  const disconnectMutation = useMutation({
    mutationFn: cafe24Api.disconnect,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cafe24', 'status'] });
      toast.success('Cafe24 연결이 해제되었습니다');
    },
    onError: () => toast.error('연결 해제에 실패했습니다'),
  });

  const handleConnect = async () => {
    const mid = mallIdInput.trim();
    if (!mid) { toast.error('쇼핑몰 ID를 입력하세요'); return; }
    try {
      const result = await cafe24Api.startAuth(mid);
      if (result?.auth_url) {
        window.location.href = result.auth_url;
      } else {
        toast.error('인증 URL을 받지 못했습니다');
      }
    } catch {
      toast.error('Cafe24 인증 시작에 실패했습니다');
    }
  };

  if (isLoading) return null;

  if (status?.connected) {
    const required = status.required_scopes ?? [];
    const grantedSet = new Set((status.scopes ?? '').split(',').map(s => s.trim()).filter(Boolean));
    const missing = status.missing_scopes ?? [];
    const grantedCount = required.filter(s => grantedSet.has(s)).length;
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between px-4 py-3 bg-green/10 border border-green/20 rounded-xl">
          <div className="flex items-center gap-2 flex-wrap">
            <Store size={15} className="text-green" />
            <span className="text-sm text-green font-medium">Cafe24 연결됨</span>
            {status.mall_id && (
              <span className="text-xs text-green/70">({status.mall_id})</span>
            )}
            {required.length > 0 && (
              <button
                type="button"
                onClick={() => setShowScopeDetail(v => !v)}
                className={`text-[10px] px-2 py-0.5 rounded-md border font-mono transition-colors ${
                  missing.length > 0
                    ? 'bg-yellow/10 border-yellow/30 text-yellow hover:bg-yellow/20'
                    : 'bg-[rgb(var(--color-overlay-rgb)/0.05)] border-[rgb(var(--color-overlay-rgb)/0.1)] text-text-tertiary hover:text-text-primary'
                }`}
                title="권한 상세 보기"
              >
                권한 {grantedCount}/{required.length}
                {missing.length > 0 && ` · ${missing.length}개 누락`}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => refetchStatus()}
              className="p-1.5 text-text-tertiary hover:text-text-primary border border-[rgb(var(--color-overlay-rgb)/0.1)] rounded-lg transition-colors"
              title="상태 새로고침"
            >
              <Loader2 size={11} />
            </button>
            <button
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
              className="flex items-center gap-1 px-3 py-1.5 text-xs text-red border border-red/30 hover:bg-red/10 rounded-lg transition-colors disabled:opacity-50"
            >
              {disconnectMutation.isPending && <Loader2 size={10} className="animate-spin" />}
              연결 해제
            </button>
          </div>
        </div>

        {status.needs_reauth && missing.length > 0 && (
          <div className="px-4 py-3 bg-yellow/10 border border-yellow/30 rounded-xl flex items-start gap-2">
            <AlertCircle size={14} className="text-yellow shrink-0 mt-0.5" />
            <div className="flex-1 text-xs">
              <p className="text-yellow font-medium">새로운 기능을 위한 권한이 부족합니다 — 재연결 권장</p>
              <p className="text-text-tertiary mt-1">
                누락:{' '}
                <code className="text-yellow">{missing.join(', ')}</code>
              </p>
              <p className="text-[11px] text-text-tertiary mt-1">
                위의 &quot;연결 해제&quot;를 누른 뒤 다시 연결하면 새 권한이 적용됩니다.
              </p>
            </div>
          </div>
        )}

        {showScopeDetail && (
          <div className="px-4 py-3 bg-bg-2 border border-border-primary rounded-xl space-y-2 text-[11px]">
            <p className="font-medium text-text-secondary">서버가 요구하는 권한 (CAFE24_SCOPES env)</p>
            <div className="flex flex-wrap gap-1.5">
              {required.length === 0 ? (
                <span className="text-text-tertiary">서버에서 권한 정보를 받지 못했습니다 (배포 진행 중일 수 있음)</span>
              ) : required.map(s => {
                const has = grantedSet.has(s);
                return (
                  <span
                    key={s}
                    className={`px-1.5 py-0.5 rounded font-mono ${
                      has
                        ? 'bg-green/15 text-green border border-green/30'
                        : 'bg-yellow/15 text-yellow border border-yellow/30'
                    }`}
                  >
                    {has ? '✓' : '✗'} {s}
                  </span>
                );
              })}
            </div>
            <p className="text-text-tertiary pt-1">
              실제 토큰에 부여된 권한:{' '}
              <code className="text-text-secondary break-all">{status.scopes || '(없음)'}</code>
            </p>
            <p className="text-text-tertiary leading-relaxed">
              ✗ 표시된 권한이 1개라도 있으면 재연결 필요.
              아무것도 표시되지 않으면 백엔드 배포(Railway)가 아직 끝나지 않았거나
              <code className="text-yellow mx-1">CAFE24_SCOPES</code>
              환경변수가 옛날 값으로 설정돼 있어 코드의 기본값을 덮어쓰는 중입니다.
              Railway → Variables에서 해당 env를 삭제하거나 최신 값으로 갱신하세요.
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="px-4 py-3 bg-red/10 border-2 border-red/40 rounded-xl space-y-2 animate-pulse-slow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <AlertCircle size={16} className="text-red shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-red font-semibold">⚠️ Cafe24 스토어 연결이 필요합니다</p>
            <p className="text-xs text-text-tertiary mt-0.5">토큰 만료 또는 갱신 실패로 연결이 끊어졌습니다. 재연결 전까지 상품 조회, 주문 폴링, 쿠폰 발급이 중단됩니다.</p>
          </div>
        </div>
        <button
          onClick={() => setShowMallInput(!showMallInput)}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-yellow/20 hover:bg-yellow/30 text-yellow border border-yellow/30 rounded-lg transition-colors"
        >
          <Store size={12} /> 연결하기
        </button>
      </div>
      {showMallInput && (
        <div className="flex gap-2 mt-1">
          <input
            value={mallIdInput}
            onChange={e => setMallIdInput(e.target.value)}
            placeholder="쇼핑몰 ID (예: mymall)"
            className="flex-1 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-yellow/50"
            onKeyDown={e => e.key === 'Enter' && handleConnect()}
          />
          <button
            onClick={handleConnect}
            className="px-4 py-2 text-xs bg-yellow hover:bg-yellow text-white font-medium rounded-lg transition-colors"
          >
            인증 시작
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Cafe24 Product Selector ──────────────────────────────────────────────────

interface Cafe24ProductSelectorProps {
  selectedNo: number | undefined;
  selectedName: string | undefined;
  onSelect: (no: number, name: string, price: number) => void;
  onClear: () => void;
  disabled?: boolean;
}

function Cafe24ProductSelector({ selectedNo, selectedName, onSelect, onClear, disabled }: Cafe24ProductSelectorProps) {
  const [query, setQuery] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [open, setOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebouncedQ(query), 300);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query]);

  const { data: rawProducts = [], isFetching } = useQuery<unknown[]>({
    queryKey: ['cafe24', 'products', debouncedQ],
    queryFn: () => cafe24Api.listProducts(debouncedQ || undefined),
    enabled: open && !disabled,
    staleTime: 60_000,
    retry: 0,
  });

  // 방어적 정규화
  const normalized = (Array.isArray(rawProducts) ? rawProducts : []).map((raw, idx) => {
    const p = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
    const s = (v: unknown): string => typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
    const num = (v: unknown): number => {
      if (typeof v === 'number') return v;
      if (typeof v === 'string') { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
      return 0;
    };
    return {
      _idx: idx,
      product_no: num(p.product_no),
      product_name: s(p.product_name) || `(상품번호 ${p.product_no ?? ''})`,
      price: num(p.price ?? p.sellers_price ?? p.retail_price),
      list_image: s(p.list_image),
    };
  });
  const displayProducts = normalized.slice(0, 10);

  if (disabled) {
    return (
      <div className="mt-1 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-xs text-text-tertiary">
        Cafe24 연결 후 사용 가능합니다
      </div>
    );
  }

  return (
    <div className="relative">
      {selectedNo ? (
        <div className="flex items-center gap-2 px-3 py-2 bg-green/10 border border-green/30 rounded-lg">
          <Tag size={12} className="text-green shrink-0" />
          <span className="text-xs text-green flex-1 truncate">선택됨: {selectedName}</span>
          <button
            type="button"
            onClick={onClear}
            className="text-text-tertiary hover:text-text-primary transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      ) : (
        <div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input
                value={query}
                onChange={e => { setQuery(e.target.value); setOpen(true); }}
                onFocus={() => setOpen(true)}
                placeholder="상품명 검색..."
                className="w-full pl-8 pr-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-green/50"
              />
              {isFetching && (
                <Loader2 size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary animate-spin" />
              )}
            </div>
            <button
              type="button"
              onClick={() => setBrowserOpen(true)}
              className="shrink-0 px-3 py-2 bg-[#3B82F6] hover:bg-[#2563EB] rounded-lg text-xs font-medium text-text-primary transition-colors flex items-center gap-1.5"
            >
              <ShoppingBag size={12} /> 상품 조회
            </button>
          </div>
          {open && displayProducts.length > 0 && (
            <div className="absolute z-20 top-full mt-1 w-full bg-bg-3 border border-border-primary rounded-xl shadow-xl max-h-64 overflow-y-auto">
              {displayProducts.map(p => (
                <button
                  key={`${p.product_no}-${p._idx}`}
                  type="button"
                  onClick={() => {
                    onSelect(p.product_no, p.product_name, p.price);
                    setOpen(false);
                    setQuery('');
                  }}
                  className="flex items-center gap-3 w-full px-3 py-2.5 hover:bg-[rgb(var(--color-overlay-rgb)/0.05)] transition-colors text-left"
                >
                  {p.list_image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.list_image} alt={p.product_name} className="w-10 h-10 rounded object-cover bg-bg-2 shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded bg-bg-2 shrink-0 flex items-center justify-center">
                      <ShoppingBag size={14} className="text-text-tertiary" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-text-primary truncate">{p.product_name}</p>
                    <p className="text-[10px] text-text-tertiary">₩{p.price.toLocaleString()}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {open && displayProducts.length === 0 && !isFetching && query.length > 0 && (
            <div className="absolute z-20 top-full mt-1 w-full bg-bg-3 border border-border-primary rounded-xl shadow-xl px-3 py-4 text-center">
              <p className="text-xs text-text-tertiary">검색 결과가 없습니다</p>
            </div>
          )}
        </div>
      )}
      {browserOpen && (
        <Cafe24ProductBrowserModal
          onClose={() => setBrowserOpen(false)}
          onPick={(no, name, price) => {
            onSelect(no, name, price);
            setBrowserOpen(false);
            setQuery('');
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ─── Cafe24 다중 상품 셀렉터 (Phase 6 — 비공개 카테고리용) ────────────────────

interface Cafe24MultiProductSelectorProps {
  selected: Array<{ no: number; name: string; image?: string }>;
  onChange: (next: Array<{ no: number; name: string; image?: string }>) => void;
  disabled?: boolean;
}

function Cafe24MultiProductSelector({ selected, onChange, disabled }: Cafe24MultiProductSelectorProps) {
  const [browserOpen, setBrowserOpen] = useState(false);

  const addProduct = (no: number, name: string, _price: number, image?: string) => {
    if (selected.some(s => s.no === no)) return;
    onChange([...selected, { no, name, image }]);
  };

  const removeProduct = (no: number) => {
    onChange(selected.filter(s => s.no !== no));
  };

  if (disabled) {
    return (
      <div className="px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-xs text-text-tertiary">
        Cafe24 연결 후 사용 가능합니다
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-text-tertiary">
          선택된 상품 <span className="text-green font-semibold">{selected.length}개</span>
        </span>
        <button
          type="button"
          onClick={() => setBrowserOpen(true)}
          className="px-3 py-1.5 bg-[#3B82F6] hover:bg-[#2563EB] rounded-lg text-[11px] font-medium text-text-primary transition-colors flex items-center gap-1.5"
        >
          <ShoppingBag size={12} /> 상품 추가
        </button>
      </div>
      {selected.length === 0 ? (
        <div className="px-3 py-4 bg-bg-2 border border-dashed border-border-primary rounded-lg text-center">
          <p className="text-[11px] text-text-tertiary">상품 추가 버튼을 눌러 카테고리에 묶을 상품들을 선택하세요</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
          {selected.map(p => (
            <div key={p.no} className="flex items-center gap-2 px-2.5 py-2 bg-green/10 border border-green/30 rounded-lg">
              {p.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.image} alt={p.name} className="w-8 h-8 rounded object-cover bg-bg-2 shrink-0" />
              ) : (
                <div className="w-8 h-8 rounded bg-bg-2 shrink-0 flex items-center justify-center">
                  <ShoppingBag size={12} className="text-text-tertiary" />
                </div>
              )}
              <span className="flex-1 text-[11px] text-green truncate">{p.name}</span>
              <button
                type="button"
                onClick={() => removeProduct(p.no)}
                className="text-text-tertiary hover:text-red transition-colors shrink-0"
                title="제거"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      {browserOpen && (
        <Cafe24ProductBrowserModal
          onClose={() => setBrowserOpen(false)}
          onPick={(no, name, price) => {
            addProduct(no, name, price);
            // 다중 선택은 모달을 닫지 않음 — 여러 개 연속 추가 가능
          }}
          multi
          alreadySelected={selected.map(s => s.no)}
        />
      )}
    </div>
  );
}

// ─── Cafe24 전체 상품 조회 모달 ─────────────────────────────────────────────

interface Cafe24ProductBrowserModalProps {
  onClose: () => void;
  onPick: (no: number, name: string, price: number) => void;
  multi?: boolean;
  alreadySelected?: number[];
}

function Cafe24ProductBrowserModal({ onClose, onPick, multi = false, alreadySelected = [] }: Cafe24ProductBrowserModalProps) {
  const [query, setQuery] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebouncedQ(query), 300);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query]);

  const { data: rawProducts = [], isFetching, error } = useQuery<unknown[]>({
    queryKey: ['cafe24', 'products', 'browser', debouncedQ],
    queryFn: () => cafe24Api.listProducts(debouncedQ || undefined, 100),
    staleTime: 60_000,
    retry: 0,
  });

  // 방어적 정규화 — Cafe24 필드가 누락/타입 달라도 crash 안 나게
  const products = (Array.isArray(rawProducts) ? rawProducts : []).map((raw, idx) => {
    const p = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
    const pickStr = (v: unknown): string => {
      if (typeof v === 'string') return v;
      if (typeof v === 'number') return String(v);
      return '';
    };
    const pickNum = (v: unknown): number => {
      if (typeof v === 'number') return v;
      if (typeof v === 'string') { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
      return 0;
    };
    return {
      _idx: idx,
      product_no: pickNum(p.product_no),
      product_name: pickStr(p.product_name) || `(상품번호 ${p.product_no ?? ''})`,
      price: pickNum(p.price ?? p.sellers_price ?? p.retail_price),
      list_image: pickStr(p.list_image),
    };
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="bg-bg-3 border border-border-primary rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[rgb(var(--color-overlay-rgb)/0.1)]">
          <div className="flex items-center gap-2">
            <ShoppingBag size={16} className="text-[#3B82F6]" />
            <h3 className="text-sm font-semibold text-text-primary">Cafe24 상품 조회</h3>
            <span className="text-xs text-text-tertiary">({products.length}개)</span>
          </div>
          <button type="button" onClick={onClose} className="text-text-tertiary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-3 border-b border-[rgb(var(--color-overlay-rgb)/0.1)]">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="상품명으로 검색... (비워두면 전체 목록)"
              autoFocus
              className="w-full pl-9 pr-10 py-2.5 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-[#3B82F6]"
            />
            {isFetching && (
              <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary animate-spin" />
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {error ? (
            <div className="text-center py-12">
              <AlertCircle size={28} className="mx-auto text-red mb-2" />
              <p className="text-sm text-red">상품 목록을 불러오지 못했습니다</p>
              <p className="text-xs text-text-tertiary mt-1">{String((error as Error)?.message || error)}</p>
            </div>
          ) : isFetching && products.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="text-text-tertiary animate-spin" />
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-12">
              <ShoppingBag size={28} className="mx-auto text-text-primary mb-2" />
              <p className="text-sm text-text-tertiary">조회된 상품이 없습니다</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {products.map(p => {
                const isSelected = alreadySelected.includes(p.product_no);
                return (
                  <button
                    key={`${p.product_no}-${p._idx}`}
                    type="button"
                    onClick={() => onPick(p.product_no, p.product_name, p.price)}
                    disabled={isSelected && !multi}
                    className={`group text-left rounded-xl p-3 transition-all relative ${
                      isSelected
                        ? 'bg-green/10 border border-green/40'
                        : 'bg-bg-2 border border-border-primary hover:border-blue/50 hover:bg-[rgb(var(--color-overlay-rgb)/0.06)]'
                    }`}
                  >
                    {isSelected && (
                      <span className="absolute top-2 right-2 px-1.5 py-0.5 bg-green/20 text-green text-[9px] font-medium rounded">
                        선택됨
                      </span>
                    )}
                    {p.list_image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.list_image} alt={p.product_name} className="w-full aspect-square rounded-lg object-cover bg-bg-1 mb-2" />
                    ) : (
                      <div className="w-full aspect-square rounded-lg bg-bg-1 mb-2 flex items-center justify-center">
                        <ShoppingBag size={24} className="text-text-primary" />
                      </div>
                    )}
                    <p className="text-xs font-medium text-text-primary truncate">{p.product_name}</p>
                    <p className="text-[11px] text-text-tertiary mt-0.5">₩{p.price.toLocaleString()}</p>
                    <p className="text-[10px] text-text-tertiary mt-0.5">상품번호 {p.product_no}</p>
                  </button>
                );
              })}
            </div>
          )}
          {multi && (
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-green hover:bg-green text-white text-xs font-medium rounded-lg transition-colors"
              >
                완료 ({alreadySelected.length}개 선택)
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard chart helpers ──────────────────────────────────────────────────

const DARK_TOOLTIP_STYLE = {
  backgroundColor: 'var(--color-bg-level-2)',
  border: '1px solid var(--color-border-primary)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--color-text-primary)',
};

function ChartLoader() {
  return (
    <div className="flex items-center justify-center h-48 gap-2">
      <Loader2 size={18} className="text-blue animate-spin" />
      <span className="text-xs text-text-tertiary">데이터 불러오는 중...</span>
    </div>
  );
}

function ChartEmpty({ message = '데이터가 없습니다' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-48 gap-2">
      <BarChart2 size={24} className="text-text-tertiary" />
      <p className="text-xs text-text-tertiary">{message}</p>
    </div>
  );
}

// ─── Dashboard chart helpers (heatmap) ──────────────────────────────────────

const HEATMAP_DAYS = ['월', '화', '수', '목', '금', '토', '일'];

/** 0~1 사이 비율을 emerald 팔레트 색상으로 변환 */
function heatColor(ratio: number): string {
  if (ratio <= 0) return 'rgb(var(--color-overlay-rgb) / 0.04)';
  // emerald-900 → emerald-400 스펙트럼
  const r = Math.round(6 + ratio * (52 - 6));
  const g = Math.round(78 + ratio * (211 - 78));
  const b = Math.round(59 + ratio * (153 - 59));
  return `rgba(${r},${g},${b},${0.25 + ratio * 0.75})`;
}

// ─── Dashboard section ────────────────────────────────────────────────────────

function DashboardSection() {
  const [days, setDays] = useState<7 | 30 | 90>(7);
  /** 커스텀 기간 (직접 지정) — 활성 시 days 대신 since/until 사용 */
  const [customMode, setCustomMode] = useState(false);
  const [customSince, setCustomSince] = useState('');
  const [customUntil, setCustomUntil] = useState('');
  /** 전환 귀속 기준: 전환(주문) 발생일 vs 클릭 발생일 */
  const [basis, setBasis] = useState<'converted' | 'clicked'>('converted');
  /** 집계 기준: 확정 귀속만(기본) vs 추정 포함(참고 — 주문완료 추적 설치 전 과거 데이터 조회용) */
  const [attribution, setAttribution] = useState<'confirmed' | 'all'>('confirmed');
  const [heatmapDays, setHeatmapDays] = useState<7 | 30 | 90>(30);
  /** 히트맵 hover cell: "dow_hour" 키 */
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);

  const range = customMode && customSince && customUntil && customSince <= customUntil
    ? { since: customSince, until: customUntil }
    : undefined;
  const rangeKey = range ? `${range.since}~${range.until}` : days;

  const { data, isLoading, isError } = useQuery<DashboardData>({
    queryKey: ['affiliate', 'dashboard', rangeKey, basis, attribution],
    queryFn: () => affiliateApi.getDashboard(days, basis, range, attribution),
    retry: 1,
  });

  const {
    data: timeseriesRaw = [],
    isLoading: tsLoading,
  } = useQuery<AffiliateTimeseriesPoint[]>({
    queryKey: ['affiliate-timeseries', rangeKey, attribution],
    queryFn: () => affiliateApi.getDashboardTimeseries(days, range, attribution),
    retry: 1,
  });

  // X축 고정: 데이터가 없는 날짜도 포함해 선택 기간을 빠짐없이 표시
  const timeseries = useMemo(() => {
    const byDate: Record<string, AffiliateTimeseriesPoint> = {};
    for (const row of timeseriesRaw) byDate[row.date] = row;
    const out: AffiliateTimeseriesPoint[] = [];
    const fmt = (d: Date) => {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    };
    let start: Date;
    let end: Date;
    if (range) {
      start = new Date(range.since + 'T00:00:00');
      end = new Date(range.until + 'T00:00:00');
      // 과도한 포인트 방지 (1년 상한)
      if ((end.getTime() - start.getTime()) / 86400000 > 366) return timeseriesRaw;
    } else {
      end = new Date();
      end.setHours(0, 0, 0, 0);
      start = new Date(end);
      start.setDate(end.getDate() - (days - 1));
    }
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = fmt(d);
      out.push(byDate[key] ?? {
        date: key,
        revenue: 0, commission: 0, clicks: 0, conversions: 0,
        refunded_count: 0, refunded_amount: 0,
        cancelled_count: 0, cancelled_amount: 0,
      });
    }
    return out;
  }, [timeseriesRaw, days, range?.since, range?.until]);

  const {
    data: byCampaign = [],
    isLoading: bcLoading,
  } = useQuery<AffiliateByCampaign[]>({
    queryKey: ['affiliate-by-campaign', rangeKey, basis, attribution],
    queryFn: () => affiliateApi.getDashboardByCampaign(days, basis, range, attribution),
    retry: 1,
  });

  const {
    data: hourlyRaw = [],
    isLoading: hourlyLoading,
  } = useQuery<HourlyConversion[]>({
    queryKey: ['affiliate-hourly', heatmapDays, attribution],
    queryFn: () => affiliateApi.getDashboardHourly(heatmapDays, attribution),
    retry: 1,
  });

  const {
    data: topProducts = [],
    isLoading: topProductsLoading,
  } = useQuery<TopProduct[]>({
    queryKey: ['affiliate-top-products', rangeKey, basis, attribution],
    queryFn: () => affiliateApi.getTopProducts(10, days, basis, range, attribution),
    retry: 1,
  });

  const d = {
    total_sales: n(data?.total_sales),
    total_commission: n(data?.total_commission),
    active_partners: n(data?.active_partners),
    total_clicks: n(data?.total_clicks),
    total_conversions: n(data?.total_conversions),
    conversion_rate: n(data?.conversion_rate),
    active_campaigns: Array.isArray(data?.active_campaigns) ? data!.active_campaigns : [],
    top_partners: Array.isArray(data?.top_partners) ? data!.top_partners : [],
    refunded_count: n(data?.refunded_count),
    cancelled_count: n(data?.cancelled_count),
    gross_sales: n(data?.gross_sales ?? data?.total_sales),
    net_sales: n(data?.net_sales ?? data?.total_sales),
  };

  // 환불 차이 금액
  const refundDiff = d.gross_sales - d.net_sales;
  const hasRefunds = d.refunded_count > 0;

  const kpis = [
    { label: attribution === 'all' ? '순매출 (추정 포함 · 참고용)' : '순매출 (확정 귀속만, 취소·환불 제외)', value: fmtMan(d.total_sales), icon: <ShoppingBag size={16} />, color: 'text-blue', bg: 'bg-blue/10', ring: 'ring-blue/20', glow: 'from-blue/15', showRefund: true },
    { label: '총 커미션', value: fmtMan(d.total_commission), icon: <DollarSign size={16} />, color: 'text-green', bg: 'bg-green/10', ring: 'ring-green/20', glow: 'from-green/15', showRefund: false },
    { label: '활성 파트너', value: `${d.active_partners}명`, icon: <Users size={16} />, color: 'text-accent', bg: 'bg-brand/10', ring: 'ring-brand/20', glow: 'from-brand/15', showRefund: false },
    { label: '총 클릭', value: fmt(d.total_clicks), icon: <Eye size={16} />, color: 'text-teal', bg: 'bg-teal/10', ring: 'ring-teal/20', glow: 'from-teal/15', showRefund: false },
    { label: '전환', value: fmt(d.total_conversions), icon: <CheckCircle size={16} />, color: 'text-teal', bg: 'bg-teal/10', ring: 'ring-teal/20', glow: 'from-teal/15', showRefund: false },
    { label: '전환율', value: `${fmtPct(d.conversion_rate)}%`, icon: <Percent size={16} />, color: 'text-yellow', bg: 'bg-yellow/10', ring: 'ring-yellow/20', glow: 'from-yellow/15', showRefund: false },
  ];

  const rankColors = [
    'bg-yellow/20 text-yellow',
    'bg-bg-3/20 text-text-secondary',
    'bg-orange/20 text-orange',
  ];

  // 상위 10개 캠페인 (매출 기준)
  const top10Campaigns = [...byCampaign]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  // 환불/취소 차액
  const refundCancelDiff = d.gross_sales - d.net_sales;

  // ── 히트맵 데이터 처리 ──
  const heatmap: HourlyConversion[] = Array.isArray(hourlyRaw) ? hourlyRaw : [];
  const heatmapMax = Math.max(1, ...heatmap.map(c => c.conversions));
  const byCell = new Map(heatmap.map(c => [`${c.day_of_week}_${c.hour}`, c]));

  // TOP 3 시간대
  const top3Hours = [...heatmap]
    .sort((a, b) => b.conversions - a.conversions)
    .slice(0, 3)
    .filter(c => c.conversions > 0);

  // ── TOP 상품 데이터 처리 ──
  const products: TopProduct[] = Array.isArray(topProducts) ? topProducts : [];
  const maxProductRevenue = Math.max(1, ...products.map(p => p.revenue));

  if (isLoading) return <SectionLoader />;

  return (
    <div className="space-y-6">
      {isError && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red/10 border border-red/20 rounded-lg">
          <AlertCircle size={14} className="text-red" />
          <p className="text-xs text-red">대시보드 데이터를 불러오지 못했습니다. 기본값으로 표시합니다.</p>
        </div>
      )}

      {/* 기간 선택 — KPI 카드·캠페인 기여도·탑 파트너·차트 전체에 적용 */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-text-tertiary">기간:</span>
        {([7, 30, 90] as const).map(dd => (
          <button
            key={dd}
            onClick={() => { setDays(dd); setCustomMode(false); }}
            className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
              !customMode && days === dd
                ? 'bg-blue text-white'
                : 'bg-bg-3 text-text-tertiary border border-border-primary hover:text-text-primary hover:border-border-tertiary'
            }`}
          >
            {dd}일
          </button>
        ))}
        <button
          onClick={() => setCustomMode(true)}
          className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
            customMode
              ? 'bg-blue text-white'
              : 'bg-bg-3 text-text-tertiary border border-border-primary hover:text-text-primary hover:border-border-tertiary'
          }`}
        >
          직접 지정
        </button>
        {customMode && (
          <>
            <input
              type="date"
              value={customSince}
              onChange={(e) => setCustomSince(e.target.value)}
              max={customUntil || undefined}
              className="px-2 py-1 text-xs rounded-lg bg-bg-3 text-text-secondary border border-border-primary focus:outline-none focus:border-blue/50"
            />
            <span className="text-text-tertiary text-xs">~</span>
            <input
              type="date"
              value={customUntil}
              onChange={(e) => setCustomUntil(e.target.value)}
              min={customSince || undefined}
              className="px-2 py-1 text-xs rounded-lg bg-bg-3 text-text-secondary border border-border-primary focus:outline-none focus:border-blue/50"
            />
            {customSince && customUntil && customSince > customUntil && (
              <span className="text-[10px] text-red">시작일이 종료일보다 뒤입니다</span>
            )}
            {customMode && !range && !(customSince && customUntil) && (
              <span className="text-[10px] text-text-tertiary">시작일·종료일을 선택하세요</span>
            )}
          </>
        )}
        <span className="mx-1 h-4 w-px bg-border-primary" />
        <span className="text-xs text-text-tertiary">귀속:</span>
        {([
          { key: 'converted', label: '전환일 기준' },
          { key: 'clicked', label: '클릭일 기준' },
        ] as const).map(b => (
          <button
            key={b.key}
            onClick={() => setBasis(b.key)}
            title={b.key === 'clicked'
              ? '최근 N일 내 발생한 클릭에서 나온 전환으로 집계 (주문일이 기간 밖이어도 포함)'
              : '최근 N일 내 발생한 주문(전환)으로 집계'}
            className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
              basis === b.key
                ? 'bg-brand text-white'
                : 'bg-bg-3 text-text-tertiary border border-border-primary hover:text-text-primary hover:border-border-tertiary'
            }`}
          >
            {b.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-border-primary" />
        <span className="text-xs text-text-tertiary">집계:</span>
        {([
          { key: 'confirmed', label: '확정 귀속' },
          { key: 'all', label: '추정 포함 (참고)' },
        ] as const).map(a => (
          <button
            key={a.key}
            onClick={() => setAttribution(a.key)}
            title={a.key === 'all'
              ? '주문완료 추적 설치(2026-07-20) 이전 과거 데이터 조회용 — 라스트클릭 추정이 섞여 실제보다 부풀려질 수 있습니다'
              : '주문완료 바인딩·ref코드·회원연결로 확정된 전환만 집계 (정확한 기여분)'}
            className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
              attribution === a.key
                ? a.key === 'all' ? 'bg-yellow text-white' : 'bg-green text-white'
                : 'bg-bg-3 text-text-tertiary border border-border-primary hover:text-text-primary hover:border-border-tertiary'
            }`}
          >
            {a.label}
          </button>
        ))}
        <span className="text-[10px] text-text-tertiary ml-1">
          아래 모든 지표는 {range ? `${range.since} ~ ${range.until}` : `최근 ${days}일`} · {basis === 'clicked' ? '클릭일' : '전환일'} 기준
        </span>
      </div>

      {attribution === 'all' && (
        <div className="flex items-center gap-2 px-4 py-2 bg-yellow/10 border border-yellow/20 rounded-lg">
          <AlertCircle size={14} className="text-yellow shrink-0" />
          <p className="text-xs text-yellow">
            추정 포함 모드입니다. 주문완료 추적 설치(2026-07-20) 이전 데이터는 라스트클릭 추정이라 오가닉·메타 주문이 섞여
            실제 기여보다 부풀려질 수 있습니다 — 과거 추세 참고용으로만 사용하고, 정산·의사결정은 확정 귀속 기준을 사용하세요.
          </p>
        </div>
      )}

      {/* KPI 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map((kpi, idx) => (
          <div
            key={idx}
            className={`group relative overflow-hidden bg-bg-3 rounded-2xl p-4 border border-[rgb(var(--color-overlay-rgb)/0.06)] ring-1 ${kpi.ring} hover:border-[rgb(var(--color-overlay-rgb)/0.12)] transition-all`}
          >
            <div className={`pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-br ${kpi.glow} to-transparent`} />
            <div className="relative">
              <div className={`w-9 h-9 rounded-xl ${kpi.bg} flex items-center justify-center ${kpi.color} mb-2.5`}>
                {kpi.icon}
              </div>
              <p className="text-[10px] text-text-tertiary font-medium tracking-wide">{kpi.label}</p>
              <p className="text-lg font-bold text-text-primary tabular-nums tracking-tight mt-0.5">{kpi.value}</p>
              {/* 환불/취소 배지 — 순매출 카드에만 표시 */}
              {kpi.showRefund && hasRefunds && (
                <div className="mt-2 flex flex-col gap-0.5">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-yellow/15 border border-yellow/30 rounded-md text-[9px] text-yellow leading-tight">
                    환불 {d.refunded_count}건 / ₩{fmt(refundDiff)} 제외
                  </span>
                  {d.cancelled_count > 0 && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-orange/10 border border-orange/20 rounded-md text-[9px] text-orange leading-tight">
                      취소 {d.cancelled_count}건
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 차트 1: 매출/커미션 시계열 Area */}
      <div className="bg-bg-3 rounded-xl p-4 border border-border-primary">
        <h3 className="text-sm font-semibold text-text-primary mb-4 flex items-center gap-2">
          <TrendingUp size={14} className="text-blue" /> 매출 · 커미션 추이
        </h3>
        {tsLoading ? <ChartLoader /> : timeseries.length === 0 ? <ChartEmpty /> : (
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={timeseries} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradCommission" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--color-overlay-rgb) / 0.05)" />
              <XAxis
                dataKey="date"
                tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }}
                stroke="var(--color-text-tertiary)"
                tickFormatter={(v: string) => v.slice(5)}
              />
              <YAxis
                yAxisId="left"
                tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }}
                stroke="var(--color-text-tertiary)"
                tickFormatter={(v: number) => `₩${(v / 10000).toFixed(0)}만`}
                width={56}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }}
                stroke="var(--color-text-tertiary)"
                tickFormatter={(v: number) => `₩${(v / 10000).toFixed(0)}만`}
                width={56}
              />
              <Tooltip
                contentStyle={DARK_TOOLTIP_STYLE}
                itemStyle={{ color: 'var(--color-text-primary)' }}
                labelStyle={{ color: 'var(--color-text-secondary)' }}
                formatter={(value: number, name: string) => {
                  const labelMap: Record<string, string> = {
                    revenue: '매출',
                    commission: '커미션',
                    refunded_amount: '환불액',
                    cancelled_amount: '취소액',
                  };
                  return [formatCurrency(value), labelMap[name] || name];
                }}
                labelFormatter={(label: string) => `날짜: ${label}`}
              />
              <Legend
                formatter={(value: string) => {
                  const labelMap: Record<string, string> = {
                    revenue: '매출', commission: '커미션',
                    refunded_amount: '환불', cancelled_amount: '취소',
                  };
                  return labelMap[value] || value;
                }}
                wrapperStyle={{ fontSize: 11, color: '#9ca3af' }}
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="revenue"
                stroke="#3B82F6"
                strokeWidth={2}
                fill="url(#gradRevenue)"
                dot={false}
              />
              <Area
                yAxisId="right"
                type="monotone"
                dataKey="commission"
                stroke="#10B981"
                strokeWidth={2}
                fill="url(#gradCommission)"
                dot={false}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="refunded_amount"
                stroke="#EF4444"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="cancelled_amount"
                stroke="#F97316"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* 차트 2: 클릭 vs 전환 BarChart + 전환율 Line */}
      <div className="bg-bg-3 rounded-xl p-4 border border-border-primary">
        <h3 className="text-sm font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Eye size={14} className="text-teal" /> 클릭 · 전환 추이
        </h3>
        {tsLoading ? <ChartLoader /> : timeseries.length === 0 ? <ChartEmpty /> : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={timeseries.map(row => ({
                ...row,
                cvr: row.clicks > 0 ? parseFloat(((row.conversions / row.clicks) * 100).toFixed(1)) : 0,
              }))}
              margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--color-overlay-rgb) / 0.05)" />
              <XAxis
                dataKey="date"
                tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }}
                stroke="var(--color-text-tertiary)"
                tickFormatter={(v: string) => v.slice(5)}
              />
              <YAxis
                yAxisId="left"
                tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }}
                stroke="var(--color-text-tertiary)"
                width={40}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }}
                stroke="var(--color-text-tertiary)"
                tickFormatter={(v: number) => `${v}%`}
                width={44}
              />
              <Tooltip
                contentStyle={DARK_TOOLTIP_STYLE}
                formatter={(value: number, name: string) => {
                  if (name === 'cvr') return [`${value}%`, '전환율'];
                  if (name === 'clicks') return [value.toLocaleString(), '클릭'];
                  if (name === 'conversions') return [value.toLocaleString(), '전환'];
                  return [value, name];
                }}
                labelFormatter={(label: string) => `날짜: ${label}`}
              />
              <Legend
                formatter={(value: string) => ({ clicks: '클릭', conversions: '전환', cvr: '전환율(%)' }[value] ?? value)}
                wrapperStyle={{ fontSize: 11, color: '#9ca3af' }}
              />
              <Bar yAxisId="left" dataKey="clicks" fill="#22D3EE" opacity={0.8} radius={[2, 2, 0, 0]} />
              <Bar yAxisId="left" dataKey="conversions" fill="#34D399" opacity={0.9} radius={[2, 2, 0, 0]} />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="cvr"
                stroke="#F59E0B"
                strokeWidth={2}
                dot={false}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* 차트 3: 캠페인별 매출 기여도 가로 BarChart (Top 10) */}
        <div className="bg-bg-3 rounded-xl p-4 border border-border-primary min-h-[280px]">
          <h3 className="text-sm font-semibold text-text-primary mb-4 flex items-center gap-2">
            <Percent size={14} className="text-yellow" /> 캠페인별 매출 기여도 (Top 10)
          </h3>
          {bcLoading ? (
            <ChartLoader />
          ) : top10Campaigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2">
              <BarChart2 size={24} className="text-text-tertiary" />
              <p className="text-xs text-text-tertiary">데이터 없음</p>
            </div>
          ) : (
            <div className="space-y-2">
              {top10Campaigns.map((c, idx) => {
                const maxRevenue = Math.max(...top10Campaigns.map(x => x.revenue), 1);
                const barRatio = (c.revenue / maxRevenue) * 100;
                const cr = c.clicks > 0 ? ((c.conversions / c.clicks) * 100).toFixed(1) : '0.0';
                const opacity = 1 - (idx / Math.max(top10Campaigns.length - 1, 1)) * 0.55;
                return (
                  <button
                    type="button"
                    key={c.campaign_id}
                    onClick={() => {
                      const el = document.getElementById(`campaign-card-${c.campaign_id}`);
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }}
                    className="group w-full text-left bg-bg-2 hover:bg-[rgb(var(--color-overlay-rgb)/0.06)] rounded-lg p-2.5 border border-border-primary hover:border-green/30 transition-all"
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[10px] font-bold text-text-tertiary w-5 shrink-0">{idx + 1}.</span>
                      <span className="text-xs font-medium text-text-primary truncate flex-1" title={c.campaign_name}>
                        {c.campaign_name}
                      </span>
                      <span className="text-[10px] text-green font-semibold shrink-0">
                        ₩{fmt(c.revenue)}
                      </span>
                    </div>
                    <div className="relative h-1.5 bg-bg-1 rounded-full overflow-hidden">
                      <div
                        className="absolute inset-y-0 left-0 rounded-full transition-all"
                        style={{ width: `${barRatio}%`, backgroundColor: `rgba(16,185,129,${opacity})` }}
                      />
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-text-tertiary flex-wrap">
                      <span>전환 <span className="text-teal font-semibold">{c.conversions}건</span></span>
                      <span>클릭 <span className="text-text-secondary">{c.clicks}</span></span>
                      <span>CR <span className="text-yellow">{cr}%</span></span>
                      <span className="ml-auto text-text-tertiary">커미션 ₩{fmt(c.commission)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 차트 4: 캠페인별 전환 + 커미션 더블 BarChart */}
        <div className="bg-bg-3 rounded-xl p-4 border border-border-primary">
          <h3 className="text-sm font-semibold text-text-primary mb-4 flex items-center gap-2">
            <BarChart2 size={14} className="text-blue" /> 캠페인별 전환 · 커미션
          </h3>
          {bcLoading ? <ChartLoader /> : byCampaign.length === 0 ? <ChartEmpty /> : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={byCampaign.slice(0, 8).map(c => ({
                  ...c,
                  name: c.campaign_name.length > 7 ? c.campaign_name.slice(0, 7) + '…' : c.campaign_name,
                }))}
                margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--color-overlay-rgb) / 0.05)" />
                <XAxis
                  dataKey="name"
                  tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }}
                  stroke="var(--color-text-tertiary)"
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }}
                  stroke="var(--color-text-tertiary)"
                  width={36}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }}
                  stroke="var(--color-text-tertiary)"
                  tickFormatter={(v: number) => `₩${(v / 10000).toFixed(0)}만`}
                  width={52}
                />
                <Tooltip
                  contentStyle={DARK_TOOLTIP_STYLE}
                  formatter={(value: number, name: string) => {
                    if (name === 'conversions') return [value.toLocaleString() + '건', '전환'];
                    if (name === 'commission') return [formatCurrency(value), '커미션'];
                    return [value, name];
                  }}
                />
                <Legend
                  formatter={(value: string) => ({ conversions: '전환', commission: '커미션' }[value] ?? value)}
                  wrapperStyle={{ fontSize: 11, color: '#9ca3af' }}
                />
                <Bar yAxisId="left" dataKey="conversions" fill="#3B82F6" radius={[2, 2, 0, 0]} />
                <Bar yAxisId="right" dataKey="commission" fill="#F97316" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* 활성 캠페인 요약 */}
        <div className="bg-bg-3 rounded-xl p-4 border border-border-primary">
          <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
            <Megaphone size={14} className="text-green" /> 활성 캠페인
          </h3>
          {d.active_campaigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <Megaphone size={20} className="text-text-tertiary" />
              <p className="text-xs text-text-tertiary">활성 캠페인이 없습니다</p>
              <p className="text-[10px] text-text-tertiary">캠페인 관리 탭에서 새 캠페인을 생성하세요</p>
            </div>
          ) : (
            <div className="space-y-3">
              {d.active_campaigns.map(c => (
                <div key={c.id} className="p-3 bg-bg-2 rounded-lg">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                      {c.cafe24_product_image && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.cafe24_product_image} alt={c.cafe24_product_name ?? c.product} className="w-8 h-8 rounded object-cover bg-bg-3" />
                      )}
                      <div>
                        <p className="text-sm font-medium text-text-primary">{c.name}</p>
                        <p className="text-[10px] text-text-tertiary">{c.cafe24_product_name ?? c.product}</p>
                      </div>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 bg-green/20 text-green rounded">활성</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                    <div><p className="text-[10px] text-text-tertiary">파트너</p><p className="text-xs font-medium text-white">{c.partner_count}</p></div>
                    <div><p className="text-[10px] text-text-tertiary">클릭</p><p className="text-xs font-medium text-white">{fmt(c.click_count)}</p></div>
                    <div><p className="text-[10px] text-text-tertiary">전환</p><p className="text-xs font-medium text-white">{c.conversion_count}건</p></div>
                    <div><p className="text-[10px] text-text-tertiary">매출</p><p className="text-xs font-medium text-white">{fmtMan(c.total_sales)}</p></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 상위 파트너 */}
        <div className="bg-bg-3 rounded-xl p-4 border border-border-primary">
          <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
            <Award size={14} className="text-yellow" /> Top 파트너
          </h3>
          {d.top_partners.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <Users size={20} className="text-text-tertiary" />
              <p className="text-xs text-text-tertiary">등록된 파트너가 없습니다</p>
              <p className="text-[10px] text-text-tertiary">파트너 관리 탭에서 파트너를 초대하세요</p>
            </div>
          ) : (
            <div className="space-y-2">
              {d.top_partners.map((p, idx) => (
                <div key={p.id} className="flex items-center gap-3 p-2 bg-bg-2 rounded-lg">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${rankColors[idx] ?? 'bg-bg-3/20 text-text-tertiary'}`}>
                    {idx + 1}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm text-text-primary font-medium">{p.name}</p>
                    <div className="flex items-center gap-1 flex-wrap">
                      <ChannelBadges channels={p.channels} channel={p.channel} />
                      <span className="text-[10px] text-text-tertiary">{fmt(p.followers)} followers</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-green">₩{fmt(p.total_sales)}</p>
                    <p className="text-[10px] text-text-tertiary">{p.conversion_count}건 전환</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── 취소/환불 현황 ── */}
      <div className="bg-bg-3 border border-border-primary rounded-xl p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-4 flex items-center gap-2">
          <AlertCircle size={14} className="text-red" /> 취소 · 환불 현황
        </h3>

        {/* 2-A: KPI 카드 3개 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          {/* 환불 건수 */}
          <div className="bg-bg-2 rounded-lg p-3 border border-red/20">
            <p className="text-[10px] text-text-tertiary mb-1">환불 건수</p>
            <p className="text-2xl font-bold text-red">{d.refunded_count}<span className="text-sm font-normal ml-0.5">건</span></p>
            <p className="text-[10px] text-text-tertiary mt-0.5">결제 완료 후 환불 처리</p>
          </div>

          {/* 취소 건수 */}
          <div className="bg-bg-2 rounded-lg p-3 border border-orange/20">
            <p className="text-[10px] text-text-tertiary mb-1">취소 건수</p>
            <p className="text-2xl font-bold text-orange">{d.cancelled_count}<span className="text-sm font-normal ml-0.5">건</span></p>
            <p className="text-[10px] text-text-tertiary mt-0.5">결제 전 또는 배송 전 취소</p>
          </div>

          {/* 환불·취소 차액 (Gross - Net) */}
          <div className="bg-bg-2 rounded-lg p-3 border border-border-primary">
            <p className="text-[10px] text-text-tertiary mb-1">환불·취소 차감액</p>
            <p className="text-2xl font-bold text-text-secondary">
              {refundCancelDiff > 0 ? `₩${fmt(refundCancelDiff)}` : '₩0'}
            </p>
            <p className="text-[10px] text-text-tertiary mt-0.5">Gross - Net 차이</p>
          </div>
        </div>

        {/* 2-B: 매출 구성 요약 바 */}
        {d.gross_sales > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] text-text-tertiary">매출 구성 비율</p>
            <div className="flex h-4 rounded-full overflow-hidden gap-0.5">
              {/* 순매출 */}
              <div
                className="bg-green/20 transition-all"
                style={{ width: `${d.gross_sales > 0 ? (d.net_sales / d.gross_sales) * 100 : 100}%` }}
                title={`순매출: ${formatCurrency(d.net_sales)}`}
              />
              {/* 환불·취소 차감 */}
              {refundCancelDiff > 0 && (
                <div
                  className="bg-red/70 transition-all"
                  style={{ width: `${(refundCancelDiff / d.gross_sales) * 100}%` }}
                  title={`차감: ${formatCurrency(refundCancelDiff)}`}
                />
              )}
            </div>
            <div className="flex items-center gap-4 text-[10px]">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-green/20 inline-block" /> 순매출 {fmtMan(d.net_sales)}</span>
              {refundCancelDiff > 0 && (
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red/70 inline-block" /> 환불·취소 차감 {fmtMan(refundCancelDiff)}</span>
              )}
            </div>
          </div>
        )}

        {/* 환불/취소 모두 0인 경우 */}
        {d.refunded_count === 0 && d.cancelled_count === 0 && (
          <div className="flex items-center gap-2 mt-2 px-3 py-2 bg-green/10 border border-green/20 rounded-lg">
            <CheckCircle size={13} className="text-green shrink-0" />
            <p className="text-xs text-green">환불·취소 내역이 없습니다</p>
          </div>
        )}
      </div>

      {/* ── 시간대별 전환 히트맵 ── */}
      <div className="bg-bg-3 border border-border-primary rounded-xl p-4">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <BarChart2 size={14} className="text-green" /> 시간대별 전환 히트맵
          </h3>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-text-tertiary">기간:</span>
            {([7, 30, 90] as const).map(hd => (
              <button
                key={hd}
                onClick={() => setHeatmapDays(hd)}
                className={`px-2.5 py-1 text-[10px] rounded font-medium transition-colors ${
                  heatmapDays === hd
                    ? 'bg-green text-white'
                    : 'bg-bg-2 text-text-tertiary border border-border-primary hover:text-text-primary hover:border-border-tertiary'
                }`}
              >
                {hd}일
              </button>
            ))}
          </div>
        </div>

        {hourlyLoading ? (
          <ChartLoader />
        ) : heatmap.length === 0 ? (
          <ChartEmpty message="시간대별 데이터가 없습니다" />
        ) : (
          <>
            {/* 축 레이블 + 그리드 */}
            <div className="overflow-x-auto">
              <div className="min-w-[600px]">
                {/* 시간 축 (상단) */}
                <div className="flex items-center mb-1 pl-8">
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} className="w-5 text-center text-[8px] text-text-tertiary shrink-0">
                      {h % 6 === 0 ? `${h}시` : ''}
                    </div>
                  ))}
                </div>

                {/* 히트맵 행 */}
                {HEATMAP_DAYS.map((dayLabel, dow) => (
                  <div key={dow} className="flex items-center mb-0.5">
                    <span className="w-7 text-[10px] text-text-tertiary shrink-0 text-right pr-1">{dayLabel}</span>
                    {Array.from({ length: 24 }, (_, h) => {
                      const cellKey = `${dow}_${h}`;
                      const cell = byCell.get(cellKey);
                      const conv = cell?.conversions ?? 0;
                      const ratio = conv / heatmapMax;
                      const isHovered = hoveredCell === cellKey;
                      return (
                        <div
                          key={h}
                          className="w-5 h-5 rounded-sm shrink-0 cursor-pointer relative transition-transform"
                          style={{
                            backgroundColor: heatColor(ratio),
                            transform: isHovered ? 'scale(1.3)' : undefined,
                            zIndex: isHovered ? 10 : undefined,
                          }}
                          onMouseEnter={() => setHoveredCell(cellKey)}
                          onMouseLeave={() => setHoveredCell(null)}
                        >
                          {isHovered && (
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-20 pointer-events-none whitespace-nowrap bg-bg-2 border border-[rgb(var(--color-overlay-rgb)/0.1)] rounded-lg px-2 py-1.5 text-[10px] text-text-primary shadow-xl">
                              <p className="font-semibold text-green">{dayLabel} {h}시</p>
                              <p>전환 <span className="text-text-primary font-medium">{conv}건</span></p>
                              {cell && cell.revenue > 0 && (
                                <p>매출 <span className="text-blue font-medium">₩{fmt(cell.revenue)}</span></p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}

                {/* 컬러 범례 */}
                <div className="flex items-center gap-2 mt-3 pl-8">
                  <span className="text-[9px] text-text-tertiary">낮음</span>
                  <div className="flex gap-0.5">
                    {[0, 0.2, 0.4, 0.6, 0.8, 1].map(r => (
                      <div
                        key={r}
                        className="w-4 h-3 rounded-sm"
                        style={{ backgroundColor: heatColor(r) }}
                      />
                    ))}
                  </div>
                  <span className="text-[9px] text-text-tertiary">높음</span>
                </div>
              </div>
            </div>

            {/* TOP 3 시간대 요약 */}
            {top3Hours.length > 0 && (
              <div className="mt-4 pt-3 border-t border-border-primary">
                <p className="text-[10px] text-text-tertiary mb-1.5">전환 많은 시간대 TOP {top3Hours.length}</p>
                <div className="flex flex-wrap gap-2">
                  {top3Hours.map((c, i) => (
                    <div
                      key={`${c.day_of_week}_${c.hour}_${i}`}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-green/10 border border-green/20 rounded-lg"
                    >
                      <span className="text-[9px] font-bold text-green">#{i + 1}</span>
                      <span className="text-[10px] text-white">
                        {HEATMAP_DAYS[c.day_of_week]} {c.hour}시
                      </span>
                      <span className="text-[10px] text-green font-medium">({c.conversions}건)</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── 상품별 TOP 10 ── */}
      <div className="bg-bg-3 border border-border-primary rounded-xl p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-4 flex items-center gap-2">
          <TrendingUp size={14} className="text-blue" /> 상품별 TOP 10
        </h3>

        {topProductsLoading ? (
          <ChartLoader />
        ) : products.length === 0 ? (
          <ChartEmpty message="상품 데이터가 없습니다" />
        ) : (
          <div className="space-y-2">
            {products.map((p, idx) => {
              const barWidth = maxProductRevenue > 0 ? (p.revenue / maxProductRevenue) * 100 : 0;
              return (
                <div
                  key={p.product_no}
                  className="relative flex items-center gap-3 px-3 py-2.5 bg-bg-2 rounded-lg overflow-hidden"
                >
                  {/* 배경 진행 막대 */}
                  <div
                    className="absolute inset-y-0 left-0 bg-blue/8 rounded-lg pointer-events-none"
                    style={{ width: `${barWidth}%` }}
                  />

                  {/* 순위 배지 */}
                  <span
                    className={`relative z-10 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                      idx === 0 ? 'bg-yellow/20 text-yellow' :
                      idx === 1 ? 'bg-bg-3/20 text-text-secondary' :
                      idx === 2 ? 'bg-orange/20 text-orange' :
                      'bg-border-primary text-text-tertiary'
                    }`}
                  >
                    {idx + 1}
                  </span>

                  {/* 상품 이미지 */}
                  <div className="relative z-10 w-9 h-9 shrink-0 rounded overflow-hidden bg-border-primary flex items-center justify-center">
                    {p.product_image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.product_image}
                        alt={p.product_name}
                        className="w-full h-full object-cover"
                        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <ShoppingBag size={14} className="text-text-tertiary" />
                    )}
                  </div>

                  {/* 상품명 + 캠페인 수 */}
                  <div className="relative z-10 flex-1 min-w-0">
                    <p className="text-sm text-white font-medium truncate">{p.product_name}</p>
                    <p className="text-[10px] text-text-tertiary">캠페인 {p.campaign_count}개 연결</p>
                  </div>

                  {/* 수치 (우측 정렬) */}
                  <div className="relative z-10 flex items-center gap-4 shrink-0 text-right">
                    <div>
                      <p className="text-[10px] text-text-tertiary">전환</p>
                      <p className="text-xs font-medium text-white">{fmt(p.conversions)}건</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-text-tertiary">매출</p>
                      <p className="text-xs font-medium text-blue">{fmtMan(p.revenue)}</p>
                    </div>
                    <div className="hidden sm:block">
                      <p className="text-[10px] text-text-tertiary">커미션</p>
                      <p className="text-xs font-medium text-green">{fmtMan(p.commission)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 과거 회고 — 추정치 상·하한 + 캘리브레이션 보정 */}
      <RetroAnalysisCard />
    </div>
  );
}

// ─── 과거 회고 카드 ───────────────────────────────────────────────────────────
// 추적 설치(2026-07-20) 이전 기간의 어필리에이트 성과를 상한(추정)·하한(체인 순신호)·
// 보정치(설치 후 확정/추정 배율 백캐스팅)로 표시.
function RetroAnalysisCard() {
  const { data: retro } = useQuery({
    queryKey: ['affiliate', 'retro-analysis'],
    queryFn: () => affiliateApi.getRetroAnalysis(),
    staleTime: 3600_000,
    retry: 1,
  });
  if (!retro) return null;

  const cal = retro.calibration;
  return (
    <div className="bg-bg-3 rounded-2xl p-5 border border-[rgb(var(--color-overlay-rgb)/0.06)]">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h3 className="text-sm font-semibold text-text-primary">과거 회고 — 추적 설치({retro.tracker_installed_at}) 이전 성과</h3>
        {cal.ready ? (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-green/10 text-green ring-1 ring-green/20">
            보정 배율 실측됨: 추정의 {(cal.ratio! * 100).toFixed(1)}%가 실제 기여
          </span>
        ) : (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-yellow/10 text-yellow ring-1 ring-yellow/20">
            캘리브레이션 대기 — 확정 전환 {cal.confirmed_count}/{cal.min_required_confirmed}건
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-text-tertiary border-b border-[rgb(var(--color-overlay-rgb)/0.05)]">
              <th className="text-left py-1.5 pr-3 font-medium">월</th>
              <th className="text-right py-1.5 px-3 font-medium">추정 매출 (상한)</th>
              <th className="text-right py-1.5 px-3 font-medium">추정 주문</th>
              <th className="text-right py-1.5 pl-3 font-medium">보정 추정치</th>
            </tr>
          </thead>
          <tbody>
            {retro.months.map(m => (
              <tr key={m.month} className="border-b border-[rgb(var(--color-overlay-rgb)/0.05)] last:border-0">
                <td className="py-1.5 pr-3 text-text-secondary">{m.month}</td>
                <td className="py-1.5 px-3 text-right text-yellow/80">₩{m.estimated_revenue.toLocaleString()}</td>
                <td className="py-1.5 px-3 text-right text-text-tertiary">{m.estimated_orders.toLocaleString()}</td>
                <td className="py-1.5 pl-3 text-right">
                  {m.corrected_revenue != null
                    ? <span className="text-green font-medium">₩{m.corrected_revenue.toLocaleString()}</span>
                    : <span className="text-text-tertiary">배율 실측 대기</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-text-tertiary">
        <span className="text-text-tertiary font-medium">읽는 법:</span> 추정 매출은 라스트클릭 추정이라 오가닉·메타 주문이 섞인
        <span className="text-yellow/80"> 상한선</span>입니다. 하한선은 클릭 5분 내 가입 체인의 순신호
        (실제 {retro.chain_bounds.real.members.toLocaleString()}명 − 플라시보 {retro.chain_bounds.placebo_72h.members.toLocaleString()}명 =
        순 {retro.chain_bounds.net_members.toLocaleString()}명, 매출 ~₩{Math.round(retro.chain_bounds.net_revenue_30d).toLocaleString()}) 수준입니다.
        {cal.ready
          ? ' 보정 추정치는 추적 설치 이후 실측한 확정/추정 배율을 과거 추정치에 곱한 값으로, 파트너·월 총량 수준의 근사치입니다.'
          : ` 설치 이후 확정 전환이 ${cal.min_required_confirmed}건 이상 쌓이면 실측 배율로 월별 보정 추정치가 자동 계산됩니다.`}
      </p>
    </div>
  );
}

// ─── Campaign debug panel ─────────────────────────────────────────────────────

interface Cafe24DebugInfo {
  mode: 'category' | 'single_product' | 'none_or_legacy';
  domain: string;
  db_state: {
    id: number;
    name: string;
    referral_code?: string;
    cafe24_product_no?: number | null;
    cafe24_product_name?: string | null;
    cafe24_category_no?: number | null;
    cafe24_category_name?: string | null;
    cafe24_category_url?: string | null;
    cafe24_product_nos_raw?: string | null;
    cafe24_coupon_code?: string | null;
    landing_url?: string | null;
    base_product_url?: string | null;
  };
  live_category: {
    exists?: boolean;
    error?: string;
    category_no?: number;
    category_name?: string;
    use_display?: string;
    display_type?: string;
    use_main?: string;
    access_authority?: string;
    display_pc_yn?: string;
    display_mobile_yn?: string;
    all_keys?: string[];
    computed_display_ok?: boolean;
  } | null;
  storefront_probes?: Array<{
    url: string;
    ok?: boolean;
    redirected_to_home?: boolean;
    final_url?: string;
    final_status?: number;
    chain?: Array<{ url: string; status: number; location?: string | null }>;
    error?: string;
  }>;
  live_category_products?: Array<{ product_no: number; product_name?: string; display_order?: number }>;
  expected_product_nos?: number[];
  live_product_nos?: number[];
  missing_in_category?: number[];
  extra_in_category?: number[];
  simulated_destination: string | null;
  recommendation: string | null;
}

function CampaignDebugPanel({
  campaignId,
  onRepublish,
  republishing,
  onReattach,
  reattaching,
}: {
  campaignId: number;
  onRepublish: () => void;
  republishing: boolean;
  onReattach: () => void;
  reattaching: boolean;
}) {
  const { data, isLoading, isError, error, refetch } = useQuery<Cafe24DebugInfo>({
    queryKey: ['affiliate', 'campaign-cafe24-debug', campaignId],
    queryFn: () => affiliateApi.cafe24DebugCampaign(campaignId),
    retry: 0,
    staleTime: 5_000,
  });

  if (isLoading) {
    return (
      <div className="mt-2 px-3 py-3 bg-bg-2 border border-border-primary rounded-lg flex items-center gap-2">
        <Loader2 size={12} className="text-accent animate-spin" />
        <span className="text-xs text-text-tertiary">진단 중...</span>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mt-2 px-3 py-3 bg-red/10 border border-red/30 rounded-lg text-xs text-red">
        진단 실패: {(error as Error)?.message || '알 수 없는 오류'}
        <button onClick={() => refetch()} className="ml-2 text-red underline">재시도</button>
      </div>
    );
  }

  const live = data.live_category;
  const liveOk = !!live?.exists && live?.computed_display_ok === true;
  const needsRepublish = data.mode === 'category' && !liveOk;
  const workingProbe = data.storefront_probes?.find(p => p.ok);
  const expectedCount = data.expected_product_nos?.length ?? 0;
  const liveCount = data.live_product_nos?.length ?? 0;
  const needsReattach = data.mode === 'category' && expectedCount > 0 && liveCount < expectedCount;

  return (
    <div className="mt-2 px-3 py-3 bg-bg-2 border border-brand/30 rounded-lg space-y-2 text-[11px]">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-text-tertiary">모드:</span>
        <span className={`px-1.5 py-0.5 rounded font-mono ${
          data.mode === 'category' ? 'bg-brand/20 text-accent'
          : data.mode === 'single_product' ? 'bg-green/20 text-green'
          : 'bg-red/20 text-red'
        }`}>{data.mode}</span>
        <span className="text-text-tertiary">도메인:</span>
        <code className="text-text-secondary">{data.domain || '(없음)'}</code>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
        <div><span className="text-text-tertiary">cafe24_category_no:</span> <code className={data.db_state.cafe24_category_no ? 'text-green' : 'text-red'}>{String(data.db_state.cafe24_category_no ?? 'NULL')}</code></div>
        <div><span className="text-text-tertiary">cafe24_product_no:</span> <code className="text-text-secondary">{String(data.db_state.cafe24_product_no ?? 'NULL')}</code></div>
        <div><span className="text-text-tertiary">cafe24_category_name:</span> <code className="text-text-secondary">{data.db_state.cafe24_category_name ?? 'NULL'}</code></div>
        <div><span className="text-text-tertiary">coupon:</span> <code className="text-text-secondary">{data.db_state.cafe24_coupon_code ?? 'NULL'}</code></div>
        <div className="col-span-2"><span className="text-text-tertiary">cafe24_product_nos:</span> <code className="text-text-secondary break-all">{data.db_state.cafe24_product_nos_raw ?? 'NULL'}</code></div>
        <div className="col-span-2"><span className="text-text-tertiary">cafe24_category_url:</span> <code className="text-text-secondary break-all">{data.db_state.cafe24_category_url ?? 'NULL'}</code></div>
      </div>

      {live ? (
        <div className="border-t border-border-primary pt-2">
          <p className="font-medium text-text-secondary mb-1">카페24 라이브 상태 (PUT/GET 결과)</p>
          {live.exists === false ? (
            <p className="text-red">카테고리가 카페24에 존재하지 않음 — {live.error}</p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
                <div>use_display: <code className={live.use_display === 'T' ? 'text-green' : 'text-red'}>{live.use_display ?? '?'}</code></div>
                <div>display_type: <code className="text-text-secondary">{live.display_type ?? '?'}</code></div>
                <div>use_main: <code className="text-text-secondary">{live.use_main ?? '?'}</code></div>
                <div>access_authority: <code className={live.access_authority === 'A' || !live.access_authority ? 'text-green' : 'text-yellow'}>{live.access_authority ?? '?'}</code></div>
                <div>display_pc_yn(legacy): <code className="text-text-tertiary">{live.display_pc_yn ?? 'null'}</code></div>
                <div>display_mobile_yn(legacy): <code className="text-text-tertiary">{live.display_mobile_yn ?? 'null'}</code></div>
              </div>
              {live.all_keys && live.all_keys.length > 0 && (
                <details className="mt-2">
                  <summary className="text-text-tertiary cursor-pointer">카페24 응답 전체 키 ({live.all_keys.length}개)</summary>
                  <code className="block mt-1 text-[10px] text-text-tertiary break-all">{live.all_keys.join(', ')}</code>
                </details>
              )}
            </>
          )}
        </div>
      ) : data.mode === 'category' ? (
        <p className="text-yellow">cafe24_category_no는 있는데 라이브 조회 실패</p>
      ) : null}

      {data.mode === 'category' && (data.expected_product_nos !== undefined) && (
        <div className="border-t border-border-primary pt-2">
          <p className="font-medium text-text-secondary mb-1">카테고리 상품 첨부 상태</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-3 gap-y-1">
            <div>예상(DB): <code className="text-text-secondary">{data.expected_product_nos?.length ?? 0}개</code></div>
            <div>실제(카페24): <code className={(data.live_product_nos?.length ?? 0) > 0 ? 'text-green' : 'text-red'}>{data.live_product_nos?.length ?? 0}개</code></div>
            <div>누락: <code className={(data.missing_in_category?.length ?? 0) > 0 ? 'text-yellow' : 'text-green'}>{data.missing_in_category?.length ?? 0}개</code></div>
          </div>
          {(data.missing_in_category?.length ?? 0) > 0 && (
            <p className="text-[10px] text-yellow mt-1">
              누락된 상품 번호: <code className="break-all">{data.missing_in_category?.join(', ')}</code>
            </p>
          )}
        </div>
      )}

      {data.storefront_probes && data.storefront_probes.length > 0 && (
        <div className="border-t border-border-primary pt-2">
          <p className="font-medium text-text-secondary mb-1">URL 패턴별 실제 응답 테스트</p>
          <div className="space-y-1">
            {data.storefront_probes.map((p, i) => (
              <div key={i} className="flex items-start gap-2 text-[10px]">
                <span className={`px-1.5 py-0.5 rounded font-mono shrink-0 ${
                  p.ok ? 'bg-green/20 text-green'
                  : p.redirected_to_home ? 'bg-red/20 text-red'
                  : 'bg-yellow/20 text-yellow'
                }`}>
                  {p.ok ? '✓ OK' : p.redirected_to_home ? '✗ 홈리다이렉트' : `${p.final_status ?? '?'}`}
                </span>
                <code className="text-text-secondary break-all flex-1">{p.url}</code>
              </div>
            ))}
          </div>
          {workingProbe && (
            <p className="text-[10px] text-green mt-1">
              → 동작하는 URL 패턴이 있습니다. 코드가 자동으로 이 패턴을 사용하도록 갱신됩니다.
            </p>
          )}
        </div>
      )}

      <div className="border-t border-border-primary pt-2">
        <span className="text-text-tertiary">실제 리다이렉트 목적지:</span>
        <code className="text-text-secondary break-all ml-1">{data.simulated_destination ?? 'NULL'}</code>
      </div>

      {data.recommendation && (
        <div className="border-t border-border-primary pt-2 bg-yellow/5 -mx-3 -mb-3 px-3 py-2 rounded-b-lg">
          <p className="text-yellow font-medium">권장 조치</p>
          <p className="text-text-secondary mt-0.5 leading-relaxed">{data.recommendation}</p>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1 flex-wrap">
        {needsReattach && (
          <button
            onClick={onReattach}
            disabled={reattaching}
            className="px-3 py-1.5 text-xs bg-yellow/20 hover:bg-yellow/30 border border-yellow/50 text-yellow rounded font-semibold disabled:opacity-50 flex items-center gap-1.5 shadow-[0_0_12px_rgba(245,158,11,0.2)]"
          >
            {reattaching ? <Loader2 size={12} className="animate-spin" /> : <ShoppingBag size={12} />}
            상품 재첨부 ({liveCount}→{expectedCount}개)
          </button>
        )}
        {needsRepublish && (
          <button
            onClick={onRepublish}
            disabled={republishing}
            className="px-3 py-1.5 text-xs bg-brand/20 hover:bg-brand/30 border border-brand/50 text-accent rounded font-semibold disabled:opacity-50 flex items-center gap-1.5"
          >
            {republishing ? <Loader2 size={12} className="animate-spin" /> : <Store size={12} />}
            URL 활성화
          </button>
        )}
        {liveOk && liveCount === expectedCount && (
          <span className="px-2.5 py-1 text-[10px] bg-green/20 text-green rounded">정상 동작 중</span>
        )}
        <button
          onClick={() => refetch()}
          className="px-2.5 py-1 text-[10px] text-text-tertiary border border-border-primary hover:text-text-primary hover:border-border-tertiary rounded"
        >
          새로고침
        </button>
        {data.simulated_destination && (
          <a
            href={data.simulated_destination}
            target="_blank"
            rel="noreferrer"
            className="px-2.5 py-1 text-[10px] text-blue border border-blue/30 hover:bg-blue/10 rounded flex items-center gap-1"
          >
            🔗 직접 열어보기
          </a>
        )}
      </div>
    </div>
  );
}

// ─── Campaigns section ────────────────────────────────────────────────────────

type CampaignStatusTab = 'all' | 'pending' | 'active' | 'ended';

function CampaignsSection() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState<number | null>(null);
  // 필터 상태 — 기본 탭은 [진행 중] (기획 의도: 과거 데이터로 스크롤 길어지는 현상 방지)
  const [statusTab, setStatusTab] = useState<CampaignStatusTab>('active');
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>({ start: '', end: '' });
  const [form, setForm] = useState<NewCampaignForm>({
    name: '',
    product: '',
    commission_type: 'percentage',
    commission_rate: 10,
    start_date: '',
    end_date: '',
    cafe24_product_no: undefined,
    cafe24_product_name: undefined,
    discount_type: 'percentage',
    discount_value: 0,
  });

  const { data: cafe24Status } = useQuery<Cafe24Status>({
    queryKey: ['cafe24', 'status'],
    queryFn: cafe24Api.getStatus,
    retry: 1,
    staleTime: 30_000,
  });

  const { data: campaigns = [], isLoading, isError } = useQuery<AffiliateCampaign[]>({
    queryKey: ['affiliate', 'campaigns'],
    queryFn: affiliateApi.getCampaigns,
    retry: 1,
  });

  const createMutation = useMutation({
    mutationFn: affiliateApi.createCampaign,
    onSuccess: (result: AffiliateCampaign) => {
      qc.invalidateQueries({ queryKey: ['affiliate', 'campaigns'] });
      qc.invalidateQueries({ queryKey: ['affiliate', 'dashboard'] });
      if (result?.cafe24_coupon_code) {
        toast.success(`캠페인 생성 완료! 쿠폰 코드: ${result.cafe24_coupon_code}`);
      } else {
        toast.success('캠페인이 생성되었습니다');
      }
      setShowForm(false);
      setForm({ name: '', product: '', commission_type: 'percentage', commission_rate: 10, start_date: '', end_date: '', cafe24_product_no: undefined, cafe24_product_name: undefined, discount_type: 'percentage', discount_value: 0, cafe24_product_nos: undefined, cafe24_product_meta: undefined, auto_create_category: false, cafe24_category_name: undefined });
    },
    onError: () => toast.error('캠페인 생성에 실패했습니다'),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, skipCafe24 = false }: { id: number; skipCafe24?: boolean }) =>
      affiliateApi.deleteCampaign(id, { skipCafe24 }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['affiliate', 'campaigns'] });
      qc.invalidateQueries({ queryKey: ['affiliate', 'dashboard'] });
      toast.success(
        vars.skipCafe24 ? '강제 삭제 완료 (카페24 카테고리는 그대로 둠)' : '캠페인이 삭제되었습니다',
      );
    },
    onError: (e: { response?: { data?: { detail?: string } } }, vars) => {
      const detail = e?.response?.data?.detail || '캠페인 삭제에 실패했습니다';
      toast.error(detail, { duration: 7000 });
      // 첫 시도가 일반 삭제이고 실패했다면 강제 삭제 옵션 제안
      if (!vars.skipCafe24) {
        setTimeout(() => {
          if (window.confirm(
            `삭제 실패 원인: ${detail}\n\n` +
            `강제 삭제로 다시 시도하시겠습니까?\n` +
            `(카페24 카테고리 cleanup을 건너뛰고 DB에서만 삭제합니다)`
          )) {
            deleteMutation.mutate({ id: vars.id, skipCafe24: true });
          }
        }, 100);
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => affiliateApi.updateCampaign(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['affiliate', 'campaigns'] });
      qc.invalidateQueries({ queryKey: ['affiliate', 'dashboard'] });
      toast.success('캠페인이 업데이트되었습니다');
    },
    onError: () => toast.error('캠페인 업데이트에 실패했습니다'),
  });

  const editSaveMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => affiliateApi.updateCampaign(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['affiliate', 'campaigns'] });
      qc.invalidateQueries({ queryKey: ['affiliate', 'dashboard'] });
      toast.success('캠페인이 수정되었습니다');
      setEditingCampaignId(null);
      setShowForm(false);
      setForm({ name: '', product: '', commission_type: 'percentage', commission_rate: 10, start_date: '', end_date: '', cafe24_product_no: undefined, cafe24_product_name: undefined, discount_type: 'percentage', discount_value: 0, cafe24_product_nos: undefined, cafe24_product_meta: undefined, auto_create_category: false, cafe24_category_name: undefined });
    },
    onError: () => toast.error('캠페인 수정에 실패했습니다'),
  });

  const republishMutation = useMutation({
    mutationFn: (id: number) => affiliateApi.republishCampaignCategory(id),
    onSuccess: (data: { category_url?: string }) => {
      qc.invalidateQueries({ queryKey: ['affiliate', 'campaigns'] });
      qc.invalidateQueries({ queryKey: ['affiliate', 'campaign-cafe24-debug'] });
      toast.success(`카테고리 공개 URL 활성화 완료. 이제 링크가 동작합니다.${data?.category_url ? '\n' + data.category_url : ''}`);
    },
    onError: (e: { response?: { data?: { detail?: string } } }) => {
      toast.error(e?.response?.data?.detail || '카테고리 활성화에 실패했습니다');
    },
  });

  const reattachMutation = useMutation({
    mutationFn: (id: number) => affiliateApi.reattachCampaignProducts(id),
    onSuccess: (data: { live_count_after?: number; expected_count?: number; errors?: Array<{ product_no: number; error: string }> }) => {
      qc.invalidateQueries({ queryKey: ['affiliate', 'campaign-cafe24-debug'] });
      const errCount = data?.errors?.length ?? 0;
      if (errCount > 0) {
        toast.error(
          `재첨부 부분 성공: ${data?.live_count_after}/${data?.expected_count}개. ${errCount}개 실패 — 진단 로그 확인.`,
          { duration: 6000 },
        );
      } else {
        toast.success(
          `상품 재첨부 완료: 카테고리에 ${data?.live_count_after ?? '?'}/${data?.expected_count ?? '?'}개`,
        );
      }
    },
    onError: (e: { response?: { data?: { detail?: string } } }) => {
      toast.error(e?.response?.data?.detail || '상품 재첨부에 실패했습니다');
    },
  });

  const [debugOpenIds, setDebugOpenIds] = useState<Set<number>>(new Set());
  const toggleDebug = (id: number) => {
    setDebugOpenIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleCreate = () => {
    if (!form.name.trim()) { toast.error('캠페인명을 입력하세요'); return; }
    if (!form.start_date) { toast.error('시작일을 입력하세요'); return; }
    if (form.auto_create_category && (!form.cafe24_product_nos || form.cafe24_product_nos.length === 0)) {
      toast.error('카테고리에 묶을 상품을 1개 이상 선택하세요');
      return;
    }
    // 백엔드 페이로드: cafe24_product_meta는 표시용이라 제외
    const { cafe24_product_meta: _meta, ...payload } = form;
    void _meta;
    createMutation.mutate({
      ...payload,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
    });
  };

  const handleStartEdit = (c: AffiliateCampaign) => {
    setEditingCampaignId(c.id);
    let productNos: number[] | undefined;
    if (c.cafe24_product_nos) {
      try {
        const parsed = JSON.parse(c.cafe24_product_nos);
        if (Array.isArray(parsed)) productNos = parsed.map(n => Number(n)).filter(Boolean);
      } catch { /* ignore */ }
    }
    setForm({
      name: c.name,
      product: c.cafe24_product_name ?? c.product,
      commission_type: c.commission_type,
      commission_rate: c.commission_rate,
      start_date: c.start_date ?? '',
      end_date: c.end_date ?? '',
      cafe24_product_no: c.cafe24_product_no,
      cafe24_product_name: c.cafe24_product_name,
      discount_type: c.discount_type ?? 'percentage',
      discount_value: c.discount_value ?? 0,
      cafe24_product_nos: productNos,
      cafe24_category_name: c.cafe24_category_name ?? undefined,
      auto_create_category: !!c.cafe24_category_no,
    });
    setShowForm(true);
  };

  // 캠페인 복사 — 기존 캠페인의 모든 설정값을 새 캠페인 폼에 자동 채움
  // 사용자는 캠페인명/진행 기간만 수정하면 즉시 생성 가능
  const handleDuplicate = (c: AffiliateCampaign) => {
    setEditingCampaignId(null);  // 생성 모드 (수정 아님 — 새 쿠폰/카테고리가 발급됨)
    let productNos: number[] | undefined;
    if (c.cafe24_product_nos) {
      try {
        const parsed = JSON.parse(c.cafe24_product_nos);
        if (Array.isArray(parsed)) productNos = parsed.map(n => Number(n)).filter(Boolean);
      } catch { /* ignore */ }
    }
    // 카테고리 모드면 메타 정보(상품 이미지/이름)는 비워두고 product_no만 유지
    // → Cafe24 셀렉터가 product_no로 다시 조회해서 채워주거나, 사용자가 다시 선택
    const productMeta: Array<{ no: number; name: string; image?: string }> | undefined =
      c.cafe24_category_no && productNos
        ? productNos.map(no => ({ no, name: `상품 #${no}` }))
        : undefined;

    setForm({
      name: `[복사] ${c.name}`,           // 사용자가 변경하기 쉽게 접두사
      product: c.cafe24_product_name ?? c.product,
      commission_type: c.commission_type,
      commission_rate: c.commission_rate,
      start_date: '',                      // 사용자 입력 필수 (의도적으로 비움)
      end_date: '',                        // 사용자 입력 (선택)
      cafe24_product_no: c.cafe24_category_no ? undefined : c.cafe24_product_no,
      cafe24_product_name: c.cafe24_category_no ? undefined : c.cafe24_product_name,
      discount_type: c.discount_type ?? 'percentage',
      discount_value: c.discount_value ?? 0,
      cafe24_product_nos: productNos,
      cafe24_product_meta: productMeta,
      auto_create_category: !!c.cafe24_category_no,
      cafe24_category_name: c.cafe24_category_name
        ? `[복사] ${c.cafe24_category_name}`
        : undefined,
    });
    setShowForm(true);
    toast.success('설정값이 복사되었습니다. 캠페인명과 진행 기간만 수정하세요.', { duration: 4000 });
    // 폼이 화면 상단에 있을 수 있으므로 스크롤 업
    setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 50);
  };

  const handleSaveEdit = () => {
    if (!form.name.trim()) { toast.error('캠페인명을 입력하세요'); return; }
    if (!form.start_date) { toast.error('시작일을 입력하세요'); return; }
    if (editingCampaignId === null) return;
    editSaveMutation.mutate({
      id: editingCampaignId,
      data: {
        name: form.name,
        description: form.product,
        commission_type: form.commission_type,
        commission_rate: form.commission_rate,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        discount_type: form.discount_type,
        discount_value: form.discount_value,
      },
    });
  };

  const handleCancelForm = () => {
    setShowForm(false);
    setEditingCampaignId(null);
    setForm({ name: '', product: '', commission_type: 'percentage', commission_rate: 10, start_date: '', end_date: '', cafe24_product_no: undefined, cafe24_product_name: undefined, discount_type: 'percentage', discount_value: 0, cafe24_product_nos: undefined, cafe24_product_meta: undefined, auto_create_category: false, cafe24_category_name: undefined });
  };

  const handleToggleStatus = (c: AffiliateCampaign) => {
    const newStatus = c.status === 'active' ? 'paused' : 'active';
    updateMutation.mutate({ id: c.id, data: { status: newStatus } });
  };

  if (isLoading) return <SectionLoader />;

  const isCafe24Connected = cafe24Status?.connected ?? false;

  // 탭별 카운트 — 필터링 전 전체 캠페인 기준
  const tabCounts = {
    all: campaigns.length,
    pending: campaigns.filter(c => c.status === 'paused').length,
    active: campaigns.filter(c => c.status === 'active').length,
    ended: campaigns.filter(c => c.status === 'ended').length,
  };

  // 실제 화면에 표시될 캠페인 (탭 + 검색 + 기간 필터)
  const filteredCampaigns = campaigns.filter(c => {
    // 1. 상태 탭
    if (statusTab === 'pending' && c.status !== 'paused') return false;
    if (statusTab === 'active'  && c.status !== 'active') return false;
    if (statusTab === 'ended'   && c.status !== 'ended')  return false;

    // 2. 검색어 (캠페인명 + 상품명)
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const haystacks = [
        c.name,
        c.product,
        c.cafe24_product_name,
        c.cafe24_category_name,
      ].filter(Boolean).map(s => String(s).toLowerCase());
      if (!haystacks.some(s => s.includes(q))) return false;
    }

    // 3. 기간 필터 — 캠페인 진행 기간이 선택 범위와 겹치는지
    if (!campaignOverlapsRange(c, dateRange)) return false;

    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold text-text-primary">어필리에이트 캠페인</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-green hover:bg-green text-white text-xs font-medium rounded-lg transition-colors"
        >
          <Plus size={14} /> 새 캠페인
        </button>
      </div>

      {/* 진행 상태 탭 */}
      <FilterTabs<CampaignStatusTab>
        options={[
          { key: 'all',     label: '전체',     count: tabCounts.all },
          { key: 'pending', label: '진행 대기', count: tabCounts.pending, tabColor: 'border-yellow/50 text-yellow' },
          { key: 'active',  label: '진행 중',   count: tabCounts.active,  tabColor: 'border-green/50 text-green' },
          { key: 'ended',   label: '종료',     count: tabCounts.ended,   tabColor: 'border-border-secondary text-text-secondary' },
        ]}
        value={statusTab}
        onChange={setStatusTab}
      />

      {/* 검색 + 기간 필터 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="캠페인명·상품명 검색"
        />
        <DateRangeFilter value={dateRange} onChange={setDateRange} align="right" />
      </div>

      {isError && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red/10 border border-red/20 rounded-lg">
          <AlertCircle size={14} className="text-red" />
          <p className="text-xs text-red">캠페인 목록을 불러오지 못했습니다</p>
        </div>
      )}

      {showForm && (
        <div className="bg-bg-3 rounded-xl p-4 border border-green/30 space-y-4">
          <h3 className="text-sm font-semibold text-text-primary">
            {editingCampaignId !== null ? '캠페인 수정' : '새 캠페인 만들기'}
          </h3>
          {editingCampaignId === null && form.name.startsWith('[복사] ') && (
            <div className="flex items-start gap-2 px-3 py-2 bg-green/10 border border-green/30 rounded-lg">
              <Copy size={13} className="text-green mt-0.5 shrink-0" />
              <div className="text-[11px] text-green leading-relaxed">
                기존 캠페인 설정값이 복사되었습니다. <span className="font-semibold">캠페인명</span>과 <span className="font-semibold">진행 기간</span>만 수정한 뒤 생성하세요.
                상품·할인·커미션 설정은 그대로 유지되며, 새 쿠폰{form.auto_create_category ? '과 새 비공개 카테고리' : ''}이/가 발급됩니다.
              </div>
            </div>
          )}
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-text-tertiary">캠페인명 *</label>
              <input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="예: 여름 신상 프로모션"
                className="w-full mt-1 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-green/50"
              />
            </div>
            <div>
              <label className="text-xs text-text-tertiary">대상 상품 (직접 입력)</label>
              <input
                value={form.product}
                onChange={e => setForm({ ...form, product: e.target.value })}
                placeholder="예: 저당 디저트 세트"
                className="w-full mt-1 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-green/50"
              />
            </div>
          </div>

          {/* Cafe24 상품 셀렉터 — 단일 / 다중(카테고리) 모드 토글 */}
          <div className="border border-border-primary rounded-xl p-3 space-y-3">
            <div className="flex items-center gap-2">
              <Store size={13} className={isCafe24Connected ? 'text-green' : 'text-text-tertiary'} />
              <span className="text-xs font-medium text-text-secondary">Cafe24 상품 연결</span>
              {!isCafe24Connected && <span className="text-[10px] text-yellow/70">(연결 필요)</span>}
              {editingCampaignId !== null && (
                <span className="text-[10px] px-1.5 py-0.5 bg-bg-3/20 text-text-tertiary rounded ml-auto">수정 불가 (쿠폰 발급 완료)</span>
              )}
            </div>

            {editingCampaignId !== null ? (
              <div className="px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-xs text-text-tertiary">
                {form.cafe24_category_name
                  ? `비공개 카테고리: ${form.cafe24_category_name} (${(form.cafe24_product_meta?.length ?? form.cafe24_product_nos?.length ?? 0)}개 상품)`
                  : form.cafe24_product_name
                  ? `연결된 상품: ${form.cafe24_product_name}`
                  : '연결된 Cafe24 상품 없음'}
              </div>
            ) : (
              <>
                {/* 모드 토글 */}
                <div className="flex p-1 bg-bg-2 border border-border-primary rounded-lg gap-1">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, auto_create_category: false, cafe24_product_nos: undefined, cafe24_product_meta: undefined, cafe24_category_name: undefined })}
                    className={`flex-1 py-1.5 text-[11px] rounded-md font-medium transition-all ${
                      !form.auto_create_category
                        ? 'bg-green text-white shadow-[0_2px_8px_rgba(16,185,129,0.3)]'
                        : 'text-text-tertiary hover:text-text-primary'
                    }`}
                  >
                    단일 상품
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, auto_create_category: true, cafe24_product_no: undefined, cafe24_product_name: undefined })}
                    disabled={!isCafe24Connected}
                    className={`flex-1 py-1.5 text-[11px] rounded-md font-medium transition-all disabled:opacity-50 ${
                      form.auto_create_category
                        ? 'bg-brand text-white shadow-[0_2px_8px_rgba(139,92,246,0.3)]'
                        : 'text-text-tertiary hover:text-text-primary'
                    }`}
                  >
                    비공개 카테고리 (다중 상품)
                  </button>
                </div>

                {!form.auto_create_category ? (
                  <Cafe24ProductSelector
                    selectedNo={form.cafe24_product_no}
                    selectedName={form.cafe24_product_name}
                    disabled={!isCafe24Connected}
                    onSelect={(no, name) => setForm({ ...form, cafe24_product_no: no, cafe24_product_name: name, product: name })}
                    onClear={() => setForm({ ...form, cafe24_product_no: undefined, cafe24_product_name: undefined })}
                  />
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="text-[11px] text-text-tertiary">카테고리명 (선택, 비워두면 캠페인명 사용)</label>
                      <input
                        value={form.cafe24_category_name ?? ''}
                        onChange={e => setForm({ ...form, cafe24_category_name: e.target.value })}
                        placeholder={`예: [비공개] ${form.name || '캠페인명'}`}
                        className="w-full mt-1 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-brand/50"
                      />
                      <p className="text-[10px] text-text-tertiary mt-1">
                        카페24에 진열되지 않는 비공개 카테고리가 자동 생성됩니다. 인플루언서는 링크로만 접근 가능.
                      </p>
                    </div>
                    <Cafe24MultiProductSelector
                      selected={form.cafe24_product_meta ?? []}
                      disabled={!isCafe24Connected}
                      onChange={list => setForm({
                        ...form,
                        cafe24_product_meta: list,
                        cafe24_product_nos: list.map(p => p.no),
                      })}
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {/* 할인 설정 */}
          <div className="border border-border-primary rounded-xl p-3 space-y-2">
            <span className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
              <Tag size={12} /> 쿠폰 할인 설정
              {editingCampaignId !== null && (
                <span className="text-[10px] px-1.5 py-0.5 bg-bg-3/20 text-text-tertiary rounded ml-auto">수정 불가 (쿠폰 발급 완료)</span>
              )}
            </span>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-text-tertiary">할인 유형</label>
                <select
                  value={form.discount_type ?? 'percentage'}
                  onChange={e => setForm({ ...form, discount_type: e.target.value as 'percentage' | 'fixed' | 'shipping' })}
                  disabled={editingCampaignId !== null}
                  className="w-full mt-1 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary focus:outline-none focus:border-green/50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="percentage">비율 할인 (%)</option>
                  <option value="fixed">금액 할인 (₩)</option>
                  <option value="shipping">배송비 할인</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-text-tertiary">
                  {form.discount_type === 'percentage' ? '할인율 (%)' : form.discount_type === 'fixed' ? '할인 금액 (₩)' : '할인 금액 (₩, 배송비)'}
                </label>
                <input
                  type="number"
                  value={form.discount_value ?? 0}
                  onChange={e => setForm({ ...form, discount_value: Number(e.target.value) })}
                  readOnly={editingCampaignId !== null}
                  className="w-full mt-1 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary focus:outline-none focus:border-green/50 read-only:opacity-50 read-only:cursor-not-allowed"
                />
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-text-tertiary">커미션 유형</label>
              <select
                value={form.commission_type}
                onChange={e => setForm({ ...form, commission_type: e.target.value as 'percentage' | 'fixed' })}
                className="w-full mt-1 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary focus:outline-none focus:border-green/50"
              >
                <option value="percentage">매출 비율 (%)</option>
                <option value="fixed">건당 고정 금액 (₩)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-text-tertiary">
                {form.commission_type === 'percentage' ? '커미션 비율 (%)' : '건당 금액 (₩)'}
              </label>
              <input
                type="number"
                value={form.commission_rate}
                onChange={e => setForm({ ...form, commission_rate: Number(e.target.value) })}
                className="w-full mt-1 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary focus:outline-none focus:border-green/50"
              />
            </div>
            <div>
              <label className="text-xs text-text-tertiary">시작일 *</label>
              <input
                type="date"
                value={form.start_date}
                onChange={e => setForm({ ...form, start_date: e.target.value })}
                className="w-full mt-1 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary focus:outline-none focus:border-green/50"
              />
            </div>
            <div>
              <label className="text-xs text-text-tertiary">종료일 (선택)</label>
              <input
                type="date"
                value={form.end_date}
                onChange={e => setForm({ ...form, end_date: e.target.value })}
                className="w-full mt-1 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary focus:outline-none focus:border-green/50"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={handleCancelForm}
              className="px-3 py-1.5 text-xs text-text-tertiary border border-border-primary rounded-lg hover:text-text-primary hover:border-border-tertiary transition-colors"
            >
              취소
            </button>
            {editingCampaignId !== null ? (
              <button
                onClick={handleSaveEdit}
                disabled={editSaveMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue hover:bg-blue disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
              >
                {editSaveMutation.isPending && <Loader2 size={12} className="animate-spin" />}
                변경사항 저장
              </button>
            ) : (
              <button
                onClick={handleCreate}
                disabled={createMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green hover:bg-green disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
              >
                {createMutation.isPending && <Loader2 size={12} className="animate-spin" />}
                캠페인 생성
              </button>
            )}
          </div>
        </div>
      )}

      {campaigns.length === 0 && !isError ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 bg-bg-3 rounded-xl border border-border-primary">
          <Megaphone size={28} className="text-text-tertiary" />
          <p className="text-sm text-text-tertiary">아직 생성된 캠페인이 없습니다</p>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-green hover:bg-green text-white text-xs font-medium rounded-lg transition-colors"
          >
            <Plus size={14} /> 첫 캠페인 만들기
          </button>
        </div>
      ) : filteredCampaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2 bg-bg-3 rounded-xl border border-border-primary">
          <Filter size={24} className="text-text-tertiary" />
          <p className="text-sm text-text-tertiary">필터 조건에 해당하는 캠페인이 없습니다</p>
          <button
            onClick={() => { setStatusTab('all'); setSearch(''); setDateRange({ start: '', end: '' }); }}
            className="text-[11px] text-green hover:text-green underline mt-1"
          >
            필터 초기화
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredCampaigns.map(c => (
            <div key={c.id} className="bg-bg-3 rounded-xl p-4 border border-border-primary">
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-3">
                  {c.cafe24_product_image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.cafe24_product_image} alt={c.cafe24_product_name ?? c.product} className="w-12 h-12 rounded-lg object-cover bg-bg-2 shrink-0" />
                  )}
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-text-primary">{c.name}</h3>
                      <span className={`text-[10px] px-2 py-0.5 rounded ${campaignStatusBadge(c.status)}`}>
                        {campaignStatusLabel(c.status)}
                      </span>
                      {c.cafe24_category_no && (
                        <span className="text-[10px] px-2 py-0.5 bg-brand/20 text-accent border border-brand/30 rounded flex items-center gap-1">
                          <Store size={9} /> 비공개 카테고리 #{c.cafe24_category_no}
                        </span>
                      )}
                      {c.cafe24_coupon_code && (
                        <span className="text-[10px] px-2 py-0.5 bg-blue/20 text-blue rounded flex items-center gap-1">
                          <Tag size={9} /> {c.cafe24_coupon_code}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-text-tertiary mt-0.5">
                      {c.cafe24_category_name
                        ? `${c.cafe24_category_name} · ${c.commission_type === 'percentage' ? `${c.commission_rate}%` : `₩${fmt(c.commission_rate)}/건`}`
                        : `${c.cafe24_product_name ?? c.product} · ${c.commission_type === 'percentage' ? `${c.commission_rate}%` : `₩${fmt(c.commission_rate)}/건`}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-xs text-text-tertiary hidden md:block">{c.start_date} ~ {c.end_date ?? '진행중'}</p>
                  <button
                    onClick={() => toggleDebug(c.id)}
                    className={`px-2 py-0.5 text-[10px] rounded transition-colors border flex items-center gap-1 ${
                      debugOpenIds.has(c.id)
                        ? 'bg-brand/20 border-brand/50 text-accent'
                        : 'border-brand/40 text-accent hover:bg-brand/10'
                    }`}
                    title="DB와 카페24 라이브 상태 진단"
                  >
                    <Search size={10} /> 진단
                  </button>
                  <button
                    onClick={() => handleToggleStatus(c)}
                    disabled={updateMutation.isPending}
                    className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                      c.status === 'active'
                        ? 'border border-yellow/30 text-yellow hover:bg-yellow/10'
                        : 'bg-green hover:bg-green text-white'
                    }`}
                  >
                    {c.status === 'active' ? '일시정지' : '재개'}
                  </button>
                  <button
                    onClick={() => handleStartEdit(c)}
                    className="p-1 text-text-tertiary hover:text-blue transition-colors"
                    title="캠페인 수정"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => handleDuplicate(c)}
                    className="p-1 text-text-tertiary hover:text-green transition-colors"
                    title="이 캠페인 설정으로 새 캠페인 만들기 (복사)"
                  >
                    <Copy size={12} />
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`"${c.name}" 캠페인을 삭제하시겠습니까?\n\n관련 클릭/전환 기록도 함께 삭제됩니다.${c.cafe24_category_no ? '\n카페24 카테고리도 같이 정리합니다.' : ''}`)) {
                        deleteMutation.mutate({ id: c.id });
                      }
                    }}
                    disabled={deleteMutation.isPending}
                    className="p-1 text-text-tertiary hover:text-red transition-colors"
                    title="캠페인 삭제"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center bg-bg-2 rounded-lg p-3">
                <div><p className="text-[10px] text-text-tertiary">파트너</p><p className="text-sm font-bold text-text-primary">{c.partner_count}명</p></div>
                <div><p className="text-[10px] text-text-tertiary">클릭</p><p className="text-sm font-bold text-text-primary">{fmt(c.click_count)}</p></div>
                <div><p className="text-[10px] text-text-tertiary">전환</p><p className="text-sm font-bold text-teal">{c.conversion_count}건</p></div>
                <div><p className="text-[10px] text-text-tertiary">매출</p><p className="text-sm font-bold text-green">₩{fmt(c.total_sales)}</p></div>
                <div><p className="text-[10px] text-text-tertiary">커미션</p><p className="text-sm font-bold text-yellow">₩{fmt(c.total_commission)}</p></div>
              </div>
              {c.referral_link && (
                <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg">
                  <Link2 size={12} className="text-blue shrink-0" />
                  <input
                    readOnly
                    value={c.referral_link}
                    className="flex-1 bg-transparent text-xs text-text-secondary truncate focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => { navigator.clipboard.writeText(c.referral_link!); toast.success('링크가 복사되었습니다'); }}
                    className="shrink-0 px-2 py-1 bg-[#3B82F6] hover:bg-[#2563EB] rounded text-[10px] text-text-primary transition-colors flex items-center gap-1"
                  >
                    <Copy size={10} /> 복사
                  </button>
                </div>
              )}
              {debugOpenIds.has(c.id) && (
                <CampaignDebugPanel
                  campaignId={c.id}
                  onRepublish={() => republishMutation.mutate(c.id)}
                  republishing={republishMutation.isPending}
                  onReattach={() => reattachMutation.mutate(c.id)}
                  reattaching={reattachMutation.isPending}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Partner Detail Modal ─────────────────────────────────────────────────────

interface PartnerDetailModalProps {
  partner: AffiliatePartner;
  campaigns: AffiliateCampaign[];
  onClose: () => void;
}

interface PartnerAuditResponse {
  partner: { id: number; name: string; phone: string | null; email: string | null };
  summary: { net_sales_paid_only: number; gross_sales_all_status: number; diff: number };
  status_breakdown: Array<{ status_raw: string | null; status_normalized: string; count: number; order_amount_sum: number; commission_sum: number }>;
  conversions_recent_200: Array<{ id: number; campaign_id: number | null; cafe24_order_id: string | null; order_amount: number; commission_amount?: number; status: string | null; created_at?: string | null; converted_at?: string | null; refunded_amount?: number; refunded_at?: string | null }>;
}

interface PartnerTimeseriesPoint {
  date: string;
  clicks: number;
  conversions: number;
  sales: number;
  commission: number;
  refunded_count: number;
  refunded_amount: number;
  cancelled_count: number;
  cancelled_amount: number;
}

// ─── 파트너 일별 매출 시계열 차트 ─────────────────────────────────────────────

function PartnerTimeseriesChart({
  data,
  loading,
  days,
  onChangeDays,
}: {
  data: PartnerTimeseriesPoint[];
  loading: boolean;
  days: 7 | 30 | 90;
  onChangeDays: (d: 7 | 30 | 90) => void;
}) {
  const totals = useMemo(
    () =>
      data.reduce(
        (acc, d) => ({
          sales: acc.sales + d.sales,
          conversions: acc.conversions + d.conversions,
          clicks: acc.clicks + d.clicks,
          refunded: acc.refunded + d.refunded_amount,
          cancelled: acc.cancelled + d.cancelled_amount,
        }),
        { sales: 0, conversions: 0, clicks: 0, refunded: 0, cancelled: 0 },
      ),
    [data],
  );
  const peakDay = useMemo(() => {
    if (!data || data.length === 0) return null;
    const max = data.reduce((best, d) => (d.sales > (best?.sales ?? -1) ? d : best), data[0]);
    return max.sales > 0 ? max : null;
  }, [data]);

  return (
    <div className="rounded-xl border border-border-primary bg-bg-2 p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <TrendingUp size={14} className="text-green" /> 파트너 일별 매출 추이
        </h3>
        <div className="flex items-center gap-1 bg-bg-1 border border-border-primary rounded-lg p-0.5">
          {([7, 30, 90] as const).map(d => (
            <button
              key={d}
              onClick={() => onChangeDays(d)}
              className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
                days === d
                  ? 'bg-green text-white'
                  : 'text-text-tertiary hover:text-text-primary'
              }`}
            >
              {d}일
            </button>
          ))}
        </div>
      </div>

      {/* 요약 KPI 라인 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[11px]">
        <div className="bg-bg-1 rounded-lg px-2.5 py-1.5">
          <p className="text-text-tertiary">기간 매출</p>
          <p className="text-green font-bold tabular-nums">₩{fmt(totals.sales)}</p>
        </div>
        <div className="bg-bg-1 rounded-lg px-2.5 py-1.5">
          <p className="text-text-tertiary">전환</p>
          <p className="text-teal font-bold tabular-nums">{fmt(totals.conversions)}건</p>
        </div>
        <div className="bg-bg-1 rounded-lg px-2.5 py-1.5">
          <p className="text-text-tertiary">클릭</p>
          <p className="text-text-primary font-bold tabular-nums">{fmt(totals.clicks)}</p>
        </div>
        <div className="bg-bg-1 rounded-lg px-2.5 py-1.5">
          <p className="text-text-tertiary">환불·취소</p>
          <p className="text-red font-bold tabular-nums">₩{fmt(totals.refunded + totals.cancelled)}</p>
        </div>
        <div className="bg-bg-1 rounded-lg px-2.5 py-1.5">
          <p className="text-text-tertiary">최고 매출일</p>
          <p className="text-yellow font-bold tabular-nums">
            {peakDay ? `${peakDay.date.slice(5)} (₩${fmt(peakDay.sales)})` : '—'}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 size={18} className="text-green animate-spin" />
        </div>
      ) : totals.clicks === 0 && totals.sales === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-2 text-text-tertiary">
          <BarChart2 size={24} />
          <p className="text-xs">기간 내 활동 데이터가 없습니다</p>
        </div>
      ) : (
        <div className="h-56 -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="salesGradPartner" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10B981" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(v: string) => v.slice(5)}
                stroke="#5a5d65"
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                minTickGap={20}
              />
              <YAxis
                yAxisId="left"
                stroke="#5a5d65"
                tick={{ fontSize: 10 }}
                tickFormatter={(v: number) =>
                  v >= 10000 ? `${(v / 10000).toFixed(0)}만` : `${v}`
                }
                tickLine={false}
                axisLine={false}
                width={48}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#5a5d65"
                tick={{ fontSize: 10 }}
                tickFormatter={(v: number) => `${v}`}
                tickLine={false}
                axisLine={false}
                width={28}
              />
              <Tooltip
                contentStyle={DARK_TOOLTIP_STYLE}
                labelStyle={{ color: 'var(--color-text-tertiary)', fontSize: 11 }}
                formatter={(value: number, name: string) => {
                  if (name === '매출' || name === '환불' || name === '취소') return [`₩${fmt(value)}`, name];
                  return [fmt(value), name];
                }}
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="sales"
                name="매출"
                stroke="#10B981"
                strokeWidth={2}
                fill="url(#salesGradPartner)"
              />
              <Bar yAxisId="right" dataKey="conversions" name="전환" fill="#06B6D4" opacity={0.6} radius={[2, 2, 0, 0]} />
              <Bar yAxisId="right" dataKey="refunded_count" name="환불" fill="#F43F5E" opacity={0.6} radius={[2, 2, 0, 0]} />
              <Bar yAxisId="right" dataKey="cancelled_count" name="취소" fill="#F59E0B" opacity={0.6} radius={[2, 2, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ─── 일별 주문 로그 ───────────────────────────────────────────────────────────

function PartnerDailyLog({
  audit,
  loading,
  isOpen,
  onToggle,
  campaigns,
}: {
  audit?: PartnerAuditResponse;
  loading: boolean;
  isOpen: boolean;
  onToggle: () => void;
  campaigns: AffiliateCampaign[];
}) {
  const campaignNameById = useMemo(
    () => new Map(campaigns.map(c => [c.id, c.name])),
    [campaigns],
  );

  // conversions를 일자별로 group
  const grouped = useMemo(() => {
    const list = audit?.conversions_recent_200 ?? [];
    const map = new Map<string, typeof list>();
    for (const c of list) {
      const dt = c.converted_at || c.created_at || '';
      const day = dt.slice(0, 10) || '미상';
      const arr = map.get(day) ?? [];
      arr.push(c);
      map.set(day, arr);
    }
    // 일자 내림차순
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [audit]);

  const totalCount = audit?.conversions_recent_200?.length ?? 0;

  return (
    <div className="rounded-xl border border-border-primary bg-bg-2">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:bg-[rgb(var(--color-overlay-rgb)/0.02)] transition-colors"
      >
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <BarChart2 size={14} className="text-teal" />
          일자별 주문 로그
          {audit && totalCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 bg-teal/20 text-teal rounded">
              최근 {totalCount}건
            </span>
          )}
        </h3>
        <ChevronDown
          size={16}
          className={`text-text-tertiary transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="p-4 pt-0">
          {loading || !audit ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 size={16} className="text-teal animate-spin" />
            </div>
          ) : grouped.length === 0 ? (
            <p className="text-xs text-text-tertiary text-center py-4">
              주문 데이터가 없습니다
            </p>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              {grouped.map(([day, items]) => {
                const dayPaid = items.filter(i => (i.status || '').toLowerCase() === 'paid');
                const dayRefunded = items.filter(i => (i.status || '').toLowerCase() === 'refunded');
                const dayCancelled = items.filter(i => (i.status || '').toLowerCase() === 'cancelled');
                const dayPaidSum = dayPaid.reduce((s, i) => s + (i.order_amount || 0), 0);
                return (
                  <div key={day} className="rounded-lg border border-border-primary overflow-hidden">
                    <div className="flex items-center justify-between bg-bg-1 px-3 py-2 text-[11px]">
                      <span className="font-mono text-text-secondary font-medium">{day}</span>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-green">매출 ₩{fmt(dayPaidSum)}</span>
                        <span className="text-teal">{dayPaid.length}건</span>
                        {dayRefunded.length > 0 && (
                          <span className="text-red">환불 {dayRefunded.length}</span>
                        )}
                        {dayCancelled.length > 0 && (
                          <span className="text-yellow">취소 {dayCancelled.length}</span>
                        )}
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                    <table className="w-full text-[11px] min-w-[560px]">
                      <thead>
                        <tr className="bg-bg-2 text-text-tertiary border-b border-border-primary">
                          <th className="text-left py-1.5 px-3 whitespace-nowrap">시각</th>
                          <th className="text-left py-1.5 px-3 whitespace-nowrap">주문번호</th>
                          <th className="text-left py-1.5 px-3 whitespace-nowrap">캠페인</th>
                          <th className="text-right py-1.5 px-3 whitespace-nowrap">주문액</th>
                          <th className="text-right py-1.5 px-3 whitespace-nowrap">커미션</th>
                          <th className="text-right py-1.5 px-3 whitespace-nowrap">상태</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map(c => {
                          const st = (c.status || '').toLowerCase();
                          const dt = c.converted_at || c.created_at || '';
                          const time = dt.length >= 19 ? dt.slice(11, 16) : '—';
                          const cname = c.campaign_id ? (campaignNameById.get(c.campaign_id) || `#${c.campaign_id}`) : '—';
                          return (
                            <tr key={c.id} className="border-b border-border-primary/50 text-text-secondary hover:bg-[rgb(var(--color-overlay-rgb)/0.02)]">
                              <td className="py-1.5 px-3 font-mono text-text-tertiary">{time}</td>
                              <td className="py-1.5 px-3 font-mono text-text-tertiary truncate max-w-[120px]" title={c.cafe24_order_id || ''}>
                                {c.cafe24_order_id || '—'}
                              </td>
                              <td className="py-1.5 px-3 truncate max-w-[140px]" title={cname}>{cname}</td>
                              <td className="py-1.5 px-3 text-right text-green tabular-nums">₩{fmt(c.order_amount)}</td>
                              <td className="py-1.5 px-3 text-right text-yellow tabular-nums">₩{fmt(c.commission_amount || 0)}</td>
                              <td className="py-1.5 px-3 text-right">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                  st === 'paid' ? 'bg-green/20 text-green'
                                  : st === 'refunded' ? 'bg-red/20 text-red'
                                  : st === 'cancelled' ? 'bg-yellow/20 text-yellow'
                                  : 'bg-bg-3/20 text-text-tertiary'
                                }`}>
                                  {st || '—'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-[10px] text-text-tertiary mt-2">
            카페24 실주문 기준 (cafe24_order_id) · 최근 200건 표시 · status: paid=정상, refunded=환불, cancelled=취소
          </p>
        </div>
      )}
    </div>
  );
}

function PartnerDetailModal({ partner, campaigns, onClose }: PartnerDetailModalProps) {
  const qc = useQueryClient();
  const [selectedCampaignId, setSelectedCampaignId] = useState<number>(0);
  const [showAudit, setShowAudit] = useState(false);
  const [tsDays, setTsDays] = useState<7 | 30 | 90>(30);
  const [showDailyLog, setShowDailyLog] = useState(false);

  const { data: performance = [], isLoading: perfLoading } = useQuery<PartnerPerformanceRow[]>({
    queryKey: ['affiliate', 'partner-performance', partner.id],
    queryFn: () => affiliateApi.getPartnerPerformance(partner.id),
    retry: 1,
  });

  const { data: timeseries = [], isLoading: tsLoading } = useQuery<PartnerTimeseriesPoint[]>({
    queryKey: ['affiliate', 'partner-timeseries', partner.id, tsDays],
    queryFn: () => affiliateApi.getPartnerTimeseries(partner.id, tsDays),
    retry: 1,
    staleTime: 30_000,
  });

  const { data: audit, isLoading: auditLoading, isError: auditError, error: auditErrObj, refetch: refetchAudit } = useQuery<PartnerAuditResponse>({
    queryKey: ['affiliate', 'partner-audit', partner.id],
    queryFn: () => affiliateApi.auditPartner(partner.id),
    enabled: showAudit || showDailyLog,
    retry: 0,
  });

  const addCampaignMutation = useMutation({
    mutationFn: (campaignId: number) => affiliateApi.addPartnerCampaign(partner.id, campaignId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['affiliate', 'partner-performance', partner.id] });
      qc.invalidateQueries({ queryKey: ['affiliate', 'partners'] });
      toast.success('캠페인이 추가되었습니다');
      setSelectedCampaignId(0);
    },
    onError: () => toast.error('캠페인 추가에 실패했습니다'),
  });

  const removeCampaignMutation = useMutation({
    mutationFn: (pcId: number) => affiliateApi.removePartnerCampaign(partner.id, pcId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['affiliate', 'partner-performance', partner.id] });
      qc.invalidateQueries({ queryKey: ['affiliate', 'partners'] });
      toast.success('캠페인이 제거되었습니다');
    },
    onError: () => toast.error('캠페인 제거에 실패했습니다'),
  });

  const couponMutation = useMutation({
    mutationFn: ({ pcId, code }: { pcId: number; code: string | null }) =>
      affiliateApi.setPartnerCampaignCoupon(partner.id, pcId, code),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['affiliate', 'partner-performance', partner.id] });
      toast.success('전용 쿠폰이 저장되었습니다 — 이 쿠폰 사용 주문은 확정 귀속됩니다');
    },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || '쿠폰 저장에 실패했습니다');
    },
  });

  const totals = performance.reduce(
    (acc, r) => ({
      clicks: acc.clicks + n(r.clicks),
      conversions: acc.conversions + n(r.conversions),
      sales: acc.sales + n(r.sales),
      commission: acc.commission + n(r.commission),
    }),
    { clicks: 0, conversions: 0, sales: 0, commission: 0 },
  );

  const existingCampaignIds = new Set(performance.map(r => r.campaign_id));
  const availableCampaigns = campaigns.filter(c => !existingCampaignIds.has(c.id) && c.status === 'active');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-4xl bg-bg-3 rounded-2xl border border-border-primary shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between p-5 border-b border-border-primary">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green to-teal flex items-center justify-center text-white font-bold text-sm shrink-0">
              {partner.name[0]}
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">{partner.name}</h2>
              <div className="flex items-center gap-1.5 flex-wrap">
                <ChannelBadges channels={partner.channels} channel={partner.channel} />
                <span className="text-xs text-text-tertiary">{partner.email}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-text-tertiary hover:text-text-primary transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* 일별 매출 시계열 차트 */}
          <PartnerTimeseriesChart
            data={timeseries}
            loading={tsLoading}
            days={tsDays}
            onChangeDays={setTsDays}
          />

          {/* 일별 주문 로그 (audit endpoint의 conversions 200건 기반) */}
          <PartnerDailyLog
            audit={audit}
            loading={auditLoading}
            isOpen={showDailyLog}
            onToggle={() => setShowDailyLog(v => !v)}
            campaigns={campaigns}
          />

          {/* 퍼포먼스 테이블 */}
          <div>
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <BarChart2 size={14} className="text-teal" /> 캠페인별 성과
            </h3>
            {perfLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={20} className="text-green animate-spin" />
              </div>
            ) : performance.length === 0 ? (
              <p className="text-xs text-text-tertiary text-center py-6">참여 중인 캠페인이 없습니다</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border-primary">
                <table className="w-full text-xs min-w-[640px]">
                  <thead>
                    <tr className="bg-bg-2 text-text-tertiary border-b border-border-primary">
                      <th className="text-left py-2.5 px-3 whitespace-nowrap">캠페인명</th>
                      <th className="text-left py-2.5 px-3 whitespace-nowrap">전용 링크</th>
                      <th className="text-left py-2.5 px-3 whitespace-nowrap">전용 쿠폰</th>
                      <th className="text-right py-2.5 px-3 whitespace-nowrap">클릭</th>
                      <th className="text-right py-2.5 px-3 whitespace-nowrap">전환</th>
                      <th className="text-right py-2.5 px-3 whitespace-nowrap">매출</th>
                      <th className="text-right py-2.5 px-3 whitespace-nowrap">커미션</th>
                      <th className="py-2.5 px-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {performance.map(row => (
                      <tr key={row.pc_id} className="border-b border-border-primary/50 text-text-secondary hover:bg-[rgb(var(--color-overlay-rgb)/0.02)]">
                        <td className="py-2.5 px-3 font-medium text-text-primary">{row.campaign_name}</td>
                        <td className="py-2.5 px-3">
                          {row.referral_link ? (
                            <div className="flex items-center gap-1.5 max-w-[280px]">
                              <input
                                readOnly
                                value={row.referral_link}
                                className="flex-1 bg-bg-2 border border-border-primary px-2 py-1 rounded text-[10px] text-text-secondary truncate focus:outline-none"
                              />
                              <button
                                onClick={() => { navigator.clipboard.writeText(row.referral_link!); toast.success('링크 복사됨'); }}
                                className="shrink-0 p-1 bg-[#3B82F6] hover:bg-[#2563EB] rounded text-text-primary"
                                title="복사"
                              >
                                <Copy size={10} />
                              </button>
                            </div>
                          ) : (
                            <span className="text-[10px] text-text-tertiary">(미생성)</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <button
                            onClick={() => {
                              if (row.pc_id === -1) { toast.error('레거시 연결에는 쿠폰을 걸 수 없습니다 — 캠페인을 다시 연결해주세요'); return; }
                              const code = window.prompt(
                                '이 파트너 전용 카페24 쿠폰 코드를 입력하세요.\n(카페24 어드민에서 발급한 쿠폰 코드. 비우고 확인하면 해제)',
                                row.coupon_code || ''
                              );
                              if (code === null) return;
                              couponMutation.mutate({ pcId: row.pc_id, code: code.trim() || null });
                            }}
                            disabled={couponMutation.isPending}
                            className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                              row.coupon_code
                                ? 'bg-green/10 text-green ring-1 ring-green/20 hover:bg-green/20'
                                : 'bg-bg-2 text-text-tertiary border border-border-primary hover:text-text-primary'
                            }`}
                            title="이 쿠폰을 사용한 주문은 클릭 추적 없이도 이 파트너에 확정 귀속됩니다"
                          >
                            {row.coupon_code || '+ 쿠폰 연결'}
                          </button>
                        </td>
                        <td className="py-2.5 px-3 text-right">{fmt(row.clicks)}</td>
                        <td className="py-2.5 px-3 text-right text-teal">{fmt(row.conversions)}</td>
                        <td className="py-2.5 px-3 text-right text-green">₩{fmt(row.sales)}</td>
                        <td className="py-2.5 px-3 text-right text-yellow">₩{fmt(row.commission)}</td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            onClick={() => {
                              if (window.confirm(`"${row.campaign_name}" 캠페인을 이 파트너에서 제거할까요?`)) {
                                removeCampaignMutation.mutate(row.pc_id);
                              }
                            }}
                            disabled={removeCampaignMutation.isPending}
                            className="p-1 text-text-tertiary hover:text-red transition-colors disabled:opacity-50"
                            title="제거"
                          >
                            <Trash2 size={11} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {/* 합계 행 */}
                    <tr className="bg-bg-2 font-semibold text-text-primary text-xs">
                      <td className="py-2.5 px-3">합계</td>
                      <td />
                      <td />
                      <td className="py-2.5 px-3 text-right">{fmt(totals.clicks)}</td>
                      <td className="py-2.5 px-3 text-right text-teal">{fmt(totals.conversions)}</td>
                      <td className="py-2.5 px-3 text-right text-green">₩{fmt(totals.sales)}</td>
                      <td className="py-2.5 px-3 text-right text-yellow">₩{fmt(totals.commission)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 캠페인 추가 */}
          {availableCampaigns.length > 0 && (
            <div className="flex items-center gap-2">
              <select
                value={selectedCampaignId}
                onChange={e => setSelectedCampaignId(Number(e.target.value))}
                className="flex-1 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary focus:outline-none focus:border-green/50"
              >
                <option value={0}>캠페인 선택...</option>
                {availableCampaigns.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button
                onClick={() => { if (selectedCampaignId) addCampaignMutation.mutate(selectedCampaignId); }}
                disabled={!selectedCampaignId || addCampaignMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-2 text-xs bg-green hover:bg-green disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
              >
                {addCampaignMutation.isPending && <Loader2 size={11} className="animate-spin" />}
                <Plus size={12} /> 캠페인 추가
              </button>
            </div>
          )}

          {/* 데이터 정합성 진단 — 관리자 vs 파트너 화면 매출 불일치 추적 */}
          <div className="border-t border-border-primary pt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <AlertCircle size={14} className="text-yellow" /> 매출 정합성 진단
              </h3>
              <button
                onClick={() => setShowAudit(v => !v)}
                className="text-xs px-2.5 py-1 bg-yellow/10 border border-yellow/30 text-yellow hover:bg-yellow/20 rounded-md transition-colors"
              >
                {showAudit ? '닫기' : '진단 열기'}
              </button>
            </div>
            {showAudit && (
              <div className="mt-3 space-y-3">
                {auditLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 size={16} className="text-yellow animate-spin" />
                  </div>
                ) : auditError || !audit ? (
                  <div className="bg-red/10 border border-red/30 rounded-lg p-3 text-xs text-red space-y-2">
                    <p className="font-medium">진단 데이터를 불러오지 못했습니다.</p>
                    <p className="text-red/80 break-all">
                      {(auditErrObj as { response?: { status?: number; data?: { detail?: string } }; message?: string })?.response?.data?.detail
                        || (auditErrObj as { response?: { status?: number } })?.response?.status
                          ? `HTTP ${(auditErrObj as { response?: { status?: number } }).response?.status}`
                          : (auditErrObj as { message?: string })?.message || '알 수 없는 오류'}
                    </p>
                    <button
                      onClick={() => refetchAudit()}
                      className="px-2 py-1 bg-red/20 hover:bg-red/30 text-red rounded text-[11px] font-medium"
                    >
                      다시 시도
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div className="bg-bg-2 border border-border-primary rounded-lg p-2.5">
                        <p className="text-[10px] text-text-tertiary">순매출 (paid only)</p>
                        <p className="text-sm font-bold text-green mt-0.5">₩{fmt(audit.summary.net_sales_paid_only)}</p>
                      </div>
                      <div className="bg-bg-2 border border-border-primary rounded-lg p-2.5">
                        <p className="text-[10px] text-text-tertiary">총합 (all status)</p>
                        <p className="text-sm font-bold text-blue mt-0.5">₩{fmt(audit.summary.gross_sales_all_status)}</p>
                      </div>
                      <div className="bg-bg-2 border border-border-primary rounded-lg p-2.5">
                        <p className="text-[10px] text-text-tertiary">차이 (취소+환불+기타)</p>
                        <p className="text-sm font-bold text-yellow mt-0.5">₩{fmt(audit.summary.diff)}</p>
                      </div>
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-border-primary">
                      <table className="w-full text-xs min-w-[560px]">
                        <thead>
                          <tr className="bg-bg-2 text-text-tertiary border-b border-border-primary">
                            <th className="text-left py-2 px-3 whitespace-nowrap">상태값(raw)</th>
                            <th className="text-left py-2 px-3 whitespace-nowrap">정규화</th>
                            <th className="text-right py-2 px-3 whitespace-nowrap">건수</th>
                            <th className="text-right py-2 px-3 whitespace-nowrap">order_amount 합</th>
                            <th className="text-right py-2 px-3 whitespace-nowrap">commission 합</th>
                          </tr>
                        </thead>
                        <tbody>
                          {audit.status_breakdown.map((b, i) => (
                            <tr key={i} className="border-b border-border-primary/50 text-text-secondary">
                              <td className="py-2 px-3 font-mono text-[11px]">
                                {b.status_raw === null ? <span className="text-red">NULL</span> : `"${b.status_raw}"`}
                              </td>
                              <td className="py-2 px-3 font-mono text-[11px]">{b.status_normalized}</td>
                              <td className="py-2 px-3 text-right">{fmt(b.count)}</td>
                              <td className="py-2 px-3 text-right text-green">₩{fmt(b.order_amount_sum)}</td>
                              <td className="py-2 px-3 text-right text-yellow">₩{fmt(b.commission_sum)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[11px] text-text-tertiary leading-relaxed">
                      관리자 화면의 &quot;매출&quot;은 status가 정확히 <code className="text-green">paid</code>인 건의 합입니다.
                      파트너 포털도 동일한 기준으로 통일되었으니 다음 수집 후 일치할 것입니다.
                      위 표에서 정규화 컬럼이 <code className="text-yellow">refunded/cancelled/(empty)</code>로 표시된 행이 차이의 원인입니다.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Partners section ─────────────────────────────────────────────────────────

interface PartnerEditForm {
  name: string;
  email: string;
  phone: string;
  channels: string[];
  followers: number;
  memo: string;
  status: AffiliatePartner['status'];
  partner_group: PartnerGroupKey;
}

interface PartnerEditModalProps {
  partner: AffiliatePartner;
  onClose: () => void;
  onSave: (id: number, data: Record<string, unknown>) => void;
  isSaving: boolean;
}

function PartnerEditModal({ partner, onClose, onSave, isSaving }: PartnerEditModalProps) {
  const [editForm, setEditForm] = useState<PartnerEditForm>({
    name: partner.name,
    email: partner.email,
    phone: partner.phone ?? '',
    channels: partner.channels && partner.channels.length > 0 ? partner.channels : partner.channel ? [partner.channel] : [],
    followers: partner.followers,
    memo: partner.memo ?? '',
    status: partner.status,
    partner_group: normalizePartnerGroup(partner.partner_group as string | null | undefined),
  });

  const toggleChannel = (key: string) => {
    setEditForm(prev => ({
      ...prev,
      channels: prev.channels.includes(key)
        ? prev.channels.filter(c => c !== key)
        : [...prev.channels, key],
    }));
  };

  const handleSubmit = () => {
    if (!editForm.name.trim()) { toast.error('파트너명을 입력하세요'); return; }
    if (!editForm.phone.trim()) { toast.error('연락처를 입력하세요 (문자 웹링크 발송용)'); return; }
    if (editForm.channels.length === 0) { toast.error('채널을 최소 1개 선택하세요'); return; }
    onSave(partner.id, {
      name: editForm.name,
      email: editForm.email || null,
      phone: editForm.phone,
      channels: editForm.channels,
      channel: editForm.channels[0],
      followers: editForm.followers,
      memo: editForm.memo,
      status: editForm.status,
      partner_group: editForm.partner_group,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-bg-3 rounded-2xl border border-border-primary shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-border-primary">
          <div className="flex items-center gap-2">
            <Pencil size={15} className="text-blue" />
            <h2 className="text-sm font-semibold text-text-primary">파트너 수정</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-text-tertiary hover:text-text-primary transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-text-tertiary">파트너명 *</label>
              <input
                value={editForm.name}
                onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                className="w-full mt-1 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-blue/50"
              />
            </div>
            <div>
              <label className="text-xs text-text-tertiary flex items-center gap-1.5">
                연락처 *
                <span className="text-[10px] text-green/80">문자 웹링크</span>
              </label>
              <input
                type="tel"
                value={editForm.phone}
                onChange={e => setEditForm({ ...editForm, phone: e.target.value })}
                placeholder="010-1234-5678"
                className="w-full mt-1 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-blue/50"
              />
            </div>
            <div>
              <label className="text-xs text-text-tertiary flex items-center gap-1.5">
                이메일 <span className="text-[10px] text-text-tertiary">(선택)</span>
              </label>
              <input
                type="email"
                value={editForm.email}
                onChange={e => setEditForm({ ...editForm, email: e.target.value })}
                placeholder="partner@example.com (선택)"
                className="w-full mt-1 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-blue/50"
              />
            </div>
            <div>
              <label className="text-xs text-text-tertiary">팔로워 수</label>
              <input
                type="number"
                value={editForm.followers}
                onChange={e => setEditForm({ ...editForm, followers: Number(e.target.value) })}
                className="w-full mt-1 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary focus:outline-none focus:border-blue/50"
              />
            </div>
            <div>
              <label className="text-xs text-text-tertiary">상태</label>
              <select
                value={editForm.status}
                onChange={e => setEditForm({ ...editForm, status: e.target.value as AffiliatePartner['status'] })}
                className="w-full mt-1 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary focus:outline-none focus:border-blue/50"
              >
                <option value="pending">대기</option>
                <option value="approved">승인</option>
                <option value="rejected">거절</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-text-tertiary flex items-center gap-1.5">
                활동 그룹 *
                <span className="text-[10px] text-text-tertiary">(계약 형태)</span>
              </label>
              <div className="mt-1 flex gap-1.5">
                {PARTNER_GROUP_OPTIONS.map(opt => {
                  const active = editForm.partner_group === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setEditForm({ ...editForm, partner_group: opt.key })}
                      className={`flex-1 px-2 py-2 text-xs rounded-lg border transition-colors ${
                        active
                          ? opt.color
                          : 'border-border-primary text-text-tertiary hover:border-border-tertiary hover:text-text-secondary'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs text-text-tertiary flex items-center gap-1.5">
              채널 *
              {editForm.channels.length > 0 && (
                <span className="px-1.5 py-0.5 bg-blue/20 text-blue rounded text-[10px]">
                  {editForm.channels.length}개 선택됨
                </span>
              )}
            </label>
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {CHANNEL_OPTIONS.map(opt => {
                const checked = editForm.channels.includes(opt.key);
                return (
                  <label
                    key={opt.key}
                    className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg border cursor-pointer transition-all text-xs select-none ${
                      checked
                        ? `${opt.color} border-opacity-60`
                        : 'border-border-primary text-text-tertiary hover:border-border-tertiary hover:text-text-secondary'
                    }`}
                  >
                    <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggleChannel(opt.key)} />
                    <span className="font-semibold">{opt.badge}</span>
                    <span className="truncate hidden sm:inline">{opt.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-xs text-text-tertiary">메모</label>
            <input
              value={editForm.memo}
              onChange={e => setEditForm({ ...editForm, memo: e.target.value })}
              placeholder="내부 메모 (선택)"
              className="w-full mt-1 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-blue/50"
            />
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-text-tertiary border border-border-primary rounded-lg hover:text-text-primary hover:border-border-tertiary transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue hover:bg-blue disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
            >
              {isSaving && <Loader2 size={12} className="animate-spin" />}
              변경사항 저장
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type PartnerGroupTab = 'all' | PartnerGroupKey;

function PartnersSection() {
  const qc = useQueryClient();
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteForm, setInviteForm] = useState<NewPartnerForm>({
    name: '',
    email: '',
    phone: '',
    channel: 'instagram',
    channels: [],
    followers: 0,
    campaign_ids: [],
    memo: '',
    partner_group: 'crew',
  });
  const [selectedPartner, setSelectedPartner] = useState<AffiliatePartner | null>(null);
  const [editingPartner, setEditingPartner] = useState<AffiliatePartner | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  // 필터 상태
  const [groupTab, setGroupTab] = useState<PartnerGroupTab>('all');
  const [search, setSearch] = useState('');

  const { data: partners = [], isLoading, isError } = useQuery<AffiliatePartner[]>({
    queryKey: ['affiliate', 'partners'],
    queryFn: affiliateApi.getPartners,
    retry: 1,
  });

  const { data: trashedPartners = [] } = useQuery<AffiliatePartner[]>({
    queryKey: ['affiliate', 'partners-trash'],
    queryFn: affiliateApi.listTrashedPartners,
    enabled: showTrash,
    retry: 1,
  });

  const restorePartnerMutation = useMutation({
    mutationFn: (id: number) => affiliateApi.restorePartner(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['affiliate', 'partners'] });
      qc.invalidateQueries({ queryKey: ['affiliate', 'partners-trash'] });
      qc.invalidateQueries({ queryKey: ['affiliate', 'dashboard'] });
      toast.success('파트너를 복원했습니다');
    },
    onError: () => toast.error('복원에 실패했습니다'),
  });

  const permanentDeleteMutation = useMutation({
    mutationFn: (id: number) => affiliateApi.permanentDeletePartner(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['affiliate', 'partners-trash'] });
      qc.invalidateQueries({ queryKey: ['affiliate', 'dashboard'] });
      toast.success('영구 삭제되었습니다');
    },
    onError: () => toast.error('영구 삭제에 실패했습니다'),
  });

  const { data: campaigns = [] } = useQuery<AffiliateCampaign[]>({
    queryKey: ['affiliate', 'campaigns'],
    queryFn: affiliateApi.getCampaigns,
    retry: 1,
  });

  const activeCampaigns = campaigns.filter(c => c.status === 'active');

  const createMutation = useMutation({
    mutationFn: affiliateApi.createPartnerMulti,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['affiliate', 'partners'] });
      qc.invalidateQueries({ queryKey: ['affiliate', 'dashboard'] });
      toast.success('파트너 초대가 완료되었습니다');
      setShowInviteForm(false);
      setInviteForm({ name: '', email: '', phone: '', channel: 'instagram', channels: [], followers: 0, campaign_ids: [], memo: '', partner_group: 'crew' });
    },
    onError: () => toast.error('파트너 초대에 실패했습니다'),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => affiliateApi.approvePartner(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['affiliate', 'partners'] });
      qc.invalidateQueries({ queryKey: ['affiliate', 'dashboard'] });
      toast.success('파트너를 승인했습니다');
    },
    onError: () => toast.error('승인에 실패했습니다'),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: number) => affiliateApi.rejectPartner(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['affiliate', 'partners'] });
      toast.success('파트너 신청을 거절했습니다');
    },
    onError: () => toast.error('거절 처리에 실패했습니다'),
  });

  const updatePartnerMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      affiliateApi.updatePartner(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['affiliate', 'partners'] });
      qc.invalidateQueries({ queryKey: ['affiliate', 'dashboard'] });
      toast.success('파트너 정보가 수정되었습니다');
      setEditingPartner(null);
    },
    onError: () => toast.error('파트너 수정에 실패했습니다'),
  });

  const deletePartnerMutation = useMutation({
    mutationFn: (id: number) => affiliateApi.deletePartner(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['affiliate', 'partners'] });
      qc.invalidateQueries({ queryKey: ['affiliate', 'partners-trash'] });
      qc.invalidateQueries({ queryKey: ['affiliate', 'dashboard'] });
      toast.success('파트너를 휴지통으로 이동했습니다');
    },
    onError: () => toast.error('파트너 삭제에 실패했습니다'),
  });

  const copyLink = (link: string) => {
    navigator.clipboard.writeText(link);
    toast.success('링크가 복사되었습니다');
  };

  const handleInvite = () => {
    if (!inviteForm.name.trim()) { toast.error('파트너명을 입력하세요'); return; }
    if (!inviteForm.phone.trim()) { toast.error('연락처를 입력하세요 (문자 웹링크 발송용)'); return; }
    if (inviteForm.channels.length === 0) { toast.error('채널을 최소 1개 선택하세요'); return; }
    // 이메일은 선택 — 빈 값이면 payload에 포함하지 않음
    const payload: Record<string, unknown> = {
      ...inviteForm,
      channel: inviteForm.channels[0],
      phone: inviteForm.phone,
    };
    if (!inviteForm.email.trim()) {
      delete payload.email;
    }
    createMutation.mutate(payload as Parameters<typeof affiliateApi.createPartnerMulti>[0]);
  };

  const toggleCampaign = (id: number) => {
    setInviteForm(prev => ({
      ...prev,
      campaign_ids: prev.campaign_ids.includes(id)
        ? prev.campaign_ids.filter(c => c !== id)
        : [...prev.campaign_ids, id],
    }));
  };

  const toggleChannel = (key: string) => {
    setInviteForm(prev => ({
      ...prev,
      channels: prev.channels.includes(key)
        ? prev.channels.filter(c => c !== key)
        : [...prev.channels, key],
    }));
  };

  if (isLoading) return <SectionLoader />;

  return (
    <>
      {selectedPartner && (
        <PartnerDetailModal
          partner={selectedPartner}
          campaigns={campaigns}
          onClose={() => setSelectedPartner(null)}
        />
      )}
      {editingPartner && (
        <PartnerEditModal
          partner={editingPartner}
          onClose={() => setEditingPartner(null)}
          onSave={(id, data) => updatePartnerMutation.mutate({ id, data })}
          isSaving={updatePartnerMutation.isPending}
        />
      )}

      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold text-text-primary">파트너 관리</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowTrash(!showTrash)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors border ${
                showTrash
                  ? 'bg-red/10 border-red/30 text-red'
                  : 'border-border-primary text-text-tertiary hover:text-text-primary hover:border-border-tertiary'
              }`}
            >
              <Trash2 size={13} /> {showTrash ? '활성 파트너' : `휴지통${trashedPartners.length > 0 ? ` (${trashedPartners.length})` : ''}`}
            </button>
            {!showTrash && (
              <button
                onClick={() => setShowInviteForm(!showInviteForm)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-green hover:bg-green text-white text-xs font-medium rounded-lg transition-colors"
              >
                <UserPlus size={14} /> 파트너 초대
              </button>
            )}
          </div>
        </div>

        {showTrash && (
          <div className="bg-bg-3 rounded-xl border border-red/20 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Trash2 size={14} className="text-red" />
              <h3 className="text-sm font-semibold text-text-primary">휴지통</h3>
              <span className="text-xs text-text-tertiary">({trashedPartners.length}명)</span>
            </div>
            {trashedPartners.length === 0 ? (
              <p className="text-xs text-text-tertiary py-4 text-center">휴지통이 비어있습니다.</p>
            ) : (
              <div className="space-y-2">
                {trashedPartners.map(p => (
                  <div key={p.id} className="flex items-center justify-between bg-bg-2 border border-border-primary rounded-lg px-3 py-2.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">{p.name}</p>
                        <p className="text-[10px] text-text-tertiary">{p.email || '이메일 없음'} · 원상태: {partnerStatusLabel(p.status)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => restorePartnerMutation.mutate(p.id)}
                        disabled={restorePartnerMutation.isPending}
                        className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-green hover:bg-green disabled:opacity-50 text-white rounded transition-colors"
                      >
                        <Loader2 size={10} className={restorePartnerMutation.isPending ? 'animate-spin' : 'hidden'} />
                        복원
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(`"${p.name}" 파트너를 영구 삭제할까요?\n\n이 작업은 되돌릴 수 없으며, 관련된 모든 기록(캠페인 연결/클릭/전환/정산)이 함께 삭제됩니다.`)) {
                            permanentDeleteMutation.mutate(p.id);
                          }
                        }}
                        disabled={permanentDeleteMutation.isPending}
                        className="px-2.5 py-1 text-[11px] border border-red/40 text-red hover:bg-red/10 disabled:opacity-50 rounded transition-colors"
                      >
                        영구 삭제
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-2 px-4 py-2 bg-red/10 border border-red/20 rounded-lg">
            <AlertCircle size={14} className="text-red" />
            <p className="text-xs text-red">파트너 목록을 불러오지 못했습니다</p>
          </div>
        )}

        {showInviteForm && (
          <div className="bg-bg-3 rounded-xl p-4 border border-green/30 space-y-4">
            <h3 className="text-sm font-semibold text-text-primary">파트너 초대하기</h3>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-text-tertiary">파트너명 *</label>
                <input
                  value={inviteForm.name}
                  onChange={e => setInviteForm({ ...inviteForm, name: e.target.value })}
                  placeholder="예: 달콤리뷰"
                  className="w-full mt-1 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-green/50"
                />
              </div>
              <div>
                <label className="text-xs text-text-tertiary flex items-center gap-1.5">
                  연락처 *
                  <span className="text-[10px] text-green/80">문자 웹링크 발송</span>
                </label>
                <input
                  type="tel"
                  value={inviteForm.phone}
                  onChange={e => setInviteForm({ ...inviteForm, phone: e.target.value })}
                  placeholder="010-1234-5678"
                  className="w-full mt-1 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-green/50"
                />
              </div>
              <div>
                <label className="text-xs text-text-tertiary flex items-center gap-1.5">
                  이메일
                  <span className="text-[10px] text-text-tertiary">(선택)</span>
                </label>
                <input
                  type="email"
                  value={inviteForm.email}
                  onChange={e => setInviteForm({ ...inviteForm, email: e.target.value })}
                  placeholder="partner@example.com (선택)"
                  className="w-full mt-1 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-green/50"
                />
              </div>
              <div>
                <label className="text-xs text-text-tertiary flex items-center gap-1.5">
                  활동 그룹 *
                  <span className="text-[10px] text-text-tertiary">(계약 형태)</span>
                </label>
                <div className="mt-1 flex gap-1.5">
                  {PARTNER_GROUP_OPTIONS.map(opt => {
                    const active = inviteForm.partner_group === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setInviteForm({ ...inviteForm, partner_group: opt.key })}
                        className={`flex-1 px-2 py-2 text-xs rounded-lg border transition-colors ${
                          active
                            ? opt.color
                            : 'border-border-primary text-text-tertiary hover:border-border-tertiary hover:text-text-secondary'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-text-tertiary flex items-center gap-1.5">
                  채널 *
                  {inviteForm.channels.length > 0 && (
                    <span className="px-1.5 py-0.5 bg-green/20 text-green rounded text-[10px]">
                      {inviteForm.channels.length}개 선택됨
                    </span>
                  )}
                </label>
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {CHANNEL_OPTIONS.map(opt => {
                    const checked = inviteForm.channels.includes(opt.key);
                    return (
                      <label
                        key={opt.key}
                        className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg border cursor-pointer transition-all text-xs select-none ${
                          checked
                            ? `${opt.color} border-opacity-60`
                            : 'border-border-primary text-text-tertiary hover:border-border-tertiary hover:text-text-secondary'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={checked}
                          onChange={() => toggleChannel(opt.key)}
                        />
                        <span className="font-semibold">{opt.badge}</span>
                        <span className="truncate hidden sm:inline">{opt.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="text-xs text-text-tertiary">팔로워 수</label>
                <input
                  type="number"
                  value={inviteForm.followers}
                  onChange={e => setInviteForm({ ...inviteForm, followers: Number(e.target.value) })}
                  className="w-full mt-1 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary focus:outline-none focus:border-green/50"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-text-tertiary">메모</label>
                <input
                  value={inviteForm.memo}
                  onChange={e => setInviteForm({ ...inviteForm, memo: e.target.value })}
                  placeholder="내부 메모 (선택)"
                  className="w-full mt-1 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-green/50"
                />
              </div>
            </div>

            {/* 참여 캠페인 멀티셀렉트 */}
            {activeCampaigns.length > 0 && (
              <div className="border border-border-primary rounded-xl p-3 space-y-2">
                <p className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
                  <Megaphone size={12} /> 참여 캠페인 선택
                  {inviteForm.campaign_ids.length > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 bg-green/20 text-green rounded text-[10px]">
                      {inviteForm.campaign_ids.length}개 선택
                    </span>
                  )}
                </p>
                <div className="grid md:grid-cols-2 gap-1.5 max-h-36 overflow-y-auto">
                  {activeCampaigns.map(c => (
                    <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[rgb(var(--color-overlay-rgb)/0.05)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={inviteForm.campaign_ids.includes(c.id)}
                        onChange={() => toggleCampaign(c.id)}
                        className="w-3.5 h-3.5 rounded accent-green"
                      />
                      <span className="text-xs text-text-secondary truncate">{c.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowInviteForm(false)}
                className="px-3 py-1.5 text-xs text-text-tertiary border border-border-primary rounded-lg hover:text-text-primary hover:border-border-tertiary transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleInvite}
                disabled={createMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green hover:bg-green disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
              >
                {createMutation.isPending && <Loader2 size={12} className="animate-spin" />}
                초대 보내기
              </button>
            </div>
          </div>
        )}

        {/* 활동 그룹 탭 + 검색 — 휴지통 모드가 아닐 때만 노출 */}
        {!showTrash && partners.length > 0 && (
          <>
            <FilterTabs<PartnerGroupTab>
              options={[
                { key: 'all',   label: '전체', count: partners.length },
                ...PARTNER_GROUP_OPTIONS.map(g => ({
                  key: g.key as PartnerGroupTab,
                  label: g.label,
                  count: partners.filter(p => normalizePartnerGroup(p.partner_group as string | null | undefined) === g.key).length,
                  tabColor: g.tabColor,
                })),
              ]}
              value={groupTab}
              onChange={setGroupTab}
            />
            <SearchBar
              value={search}
              onChange={setSearch}
              placeholder="파트너명·인플루언서 ID 검색"
              width="w-full sm:w-80"
            />
          </>
        )}

        {partners.length === 0 && !isError ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 bg-bg-3 rounded-xl border border-border-primary">
            <Users size={28} className="text-text-tertiary" />
            <p className="text-sm text-text-tertiary">아직 등록된 파트너가 없습니다</p>
            <button
              onClick={() => setShowInviteForm(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-green hover:bg-green text-white text-xs font-medium rounded-lg transition-colors"
            >
              <UserPlus size={14} /> 첫 파트너 초대하기
            </button>
          </div>
        ) : (() => {
          const filteredPartners = partners.filter(p => {
            // 1. 그룹 탭
            if (groupTab !== 'all') {
              if (normalizePartnerGroup(p.partner_group as string | null | undefined) !== groupTab) return false;
            }
            // 2. 검색어 (파트너명 + ID + 이메일 + 휴대폰 마지막 4자리)
            if (search.trim()) {
              const q = search.trim().toLowerCase();
              const haystacks = [
                p.name,
                String(p.id),
                p.email,
                p.phone,
                p.referral_link,
              ].filter(Boolean).map(s => String(s).toLowerCase());
              if (!haystacks.some(s => s.includes(q))) return false;
            }
            return true;
          });

          if (filteredPartners.length === 0) {
            return (
              <div className="flex flex-col items-center justify-center py-12 gap-2 bg-bg-3 rounded-xl border border-border-primary">
                <Filter size={24} className="text-text-tertiary" />
                <p className="text-sm text-text-tertiary">필터 조건에 해당하는 파트너가 없습니다</p>
                <button
                  onClick={() => { setGroupTab('all'); setSearch(''); }}
                  className="text-[11px] text-green hover:text-green underline mt-1"
                >
                  필터 초기화
                </button>
              </div>
            );
          }

          return (
          <div className="space-y-3">
            {filteredPartners.map(p => (
              <div
                key={p.id}
                className="bg-bg-3 rounded-xl p-4 border border-border-primary cursor-pointer hover:border-green/30 transition-colors"
                onClick={() => setSelectedPartner(p)}
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green to-teal flex items-center justify-center text-white font-bold text-sm shrink-0">
                      {p.name[0]}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-white">{p.name}</p>
                        <span className="text-[10px] text-text-tertiary font-mono">#{p.id}</span>
                        {(() => {
                          const g = PARTNER_GROUP_MAP[normalizePartnerGroup(p.partner_group as string | null | undefined)];
                          return (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${g.color}`}>
                              {g.label}
                            </span>
                          );
                        })()}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${partnerStatusBadge(p.status)}`}>
                          {partnerStatusLabel(p.status)}
                        </span>
                        {Array.isArray(p.campaign_ids) && p.campaign_ids.length > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-blue/20 text-blue rounded">
                            참여 캠페인 {p.campaign_ids.length}개
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                        <ChannelBadges channels={p.channels} channel={p.channel} />
                        <span className="text-[10px] text-text-tertiary">{fmt(p.followers)} followers · {p.email}</span>
                        {p.phone && (
                          <span className="flex items-center gap-0.5 text-[10px] text-text-tertiary">
                            <Phone size={9} className="text-text-tertiary" />
                            {p.phone}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                    {p.status === 'pending' && (
                      <>
                        <button
                          onClick={() => approveMutation.mutate(p.id)}
                          disabled={approveMutation.isPending}
                          className="flex items-center gap-1 px-2 py-1 text-[10px] bg-green hover:bg-green disabled:opacity-50 text-white font-medium rounded transition-colors"
                        >
                          {approveMutation.isPending && <Loader2 size={10} className="animate-spin" />}
                          승인
                        </button>
                        <button
                          onClick={() => rejectMutation.mutate(p.id)}
                          disabled={rejectMutation.isPending}
                          className="px-2 py-1 text-[10px] border border-red/30 text-red hover:bg-red/10 disabled:opacity-50 rounded transition-colors"
                        >
                          거절
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => setEditingPartner(p)}
                      className="p-1 text-text-tertiary hover:text-blue transition-colors"
                      title="파트너 수정"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`"${p.name}" 파트너를 휴지통으로 보낼까요?\n\n관련 기록(캠페인 연결/클릭/전환/정산)은 그대로 보존되며 휴지통에서 복원 가능합니다.\n영구 삭제는 휴지통에서 따로 진행할 수 있습니다.`)) {
                          deletePartnerMutation.mutate(p.id);
                        }
                      }}
                      disabled={deletePartnerMutation.isPending}
                      className="p-1 text-text-tertiary hover:text-red transition-colors disabled:opacity-50"
                      title="파트너 삭제 (휴지통으로 이동)"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                {p.status === 'approved' && (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center bg-bg-2 rounded-lg p-3 mb-2">
                      <div><p className="text-[10px] text-text-tertiary">클릭</p><p className="text-sm font-bold text-text-primary">{fmt(p.click_count)}</p></div>
                      <div><p className="text-[10px] text-text-tertiary">전환</p><p className="text-sm font-bold text-teal">{p.conversion_count}건</p></div>
                      <div><p className="text-[10px] text-text-tertiary">매출</p><p className="text-sm font-bold text-green">₩{fmt(p.total_sales)}</p></div>
                      <div><p className="text-[10px] text-text-tertiary">총 커미션</p><p className="text-sm font-bold text-yellow">₩{fmt(p.total_commission)}</p></div>
                      <div><p className="text-[10px] text-text-tertiary">미정산</p><p className="text-sm font-bold text-red">₩{fmt(p.unpaid_commission)}</p></div>
                    </div>
                    {p.campaign_links && p.campaign_links.length > 0 ? (
                      <div
                        className="space-y-1.5"
                        onClick={e => e.stopPropagation()}
                      >
                        {p.campaign_links.map((cl) => (
                          <div key={cl.pc_id} className="flex items-center gap-2 bg-bg-2 rounded-lg px-3 py-2">
                            <Link2 size={12} className="text-text-tertiary shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] text-text-tertiary truncate">{cl.campaign_name || `캠페인 #${cl.campaign_id}`}</p>
                              <code className="text-[10px] text-text-tertiary truncate block">{cl.referral_link}</code>
                            </div>
                            <button onClick={() => copyLink(cl.referral_link)} className="text-text-tertiary hover:text-text-primary transition-colors shrink-0" title="복사">
                              <Copy size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : p.referral_link ? (
                      <div
                        className="flex items-center gap-2 bg-bg-2 rounded-lg px-3 py-2"
                        onClick={e => e.stopPropagation()}
                      >
                        <Link2 size={12} className="text-text-tertiary shrink-0" />
                        <code className="text-[10px] text-text-tertiary flex-1 truncate">{p.referral_link}</code>
                        <button onClick={() => copyLink(p.referral_link)} className="text-text-tertiary hover:text-text-primary transition-colors">
                          <Copy size={12} />
                        </button>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            ))}
          </div>
          );
        })()}
      </div>
    </>
  );
}

// ─── Referral section ─────────────────────────────────────────────────────────

function ReferralSection() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<NewReferralProgramForm>({
    name: '',
    reward_type: 'points',
    referrer_reward: 3000,
    referee_reward: 2000,
  });

  const { data: programs = [], isLoading, isError } = useQuery<ReferralProgram[]>({
    queryKey: ['affiliate', 'referral-programs'],
    queryFn: affiliateApi.getReferralPrograms,
    retry: 1,
  });

  const createMutation = useMutation({
    mutationFn: affiliateApi.createReferralProgram,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['affiliate', 'referral-programs'] });
      toast.success('프로그램이 생성되었습니다');
      setShowForm(false);
      setForm({ name: '', reward_type: 'points', referrer_reward: 3000, referee_reward: 2000 });
    },
    onError: () => toast.error('프로그램 생성에 실패했습니다'),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'active' | 'paused' }) =>
      affiliateApi.updateReferralProgram(id, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['affiliate', 'referral-programs'] });
      toast.success('프로그램 상태가 변경되었습니다');
    },
    onError: () => toast.error('상태 변경에 실패했습니다'),
  });

  const handleCreate = () => {
    if (!form.name.trim()) { toast.error('프로그램명을 입력하세요'); return; }
    createMutation.mutate(form);
  };

  if (isLoading) return <SectionLoader />;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold text-text-primary">친구추천 프로그램</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-green hover:bg-green text-white text-xs font-medium rounded-lg transition-colors"
        >
          <Plus size={14} /> 프로그램 추가
        </button>
      </div>

      {isError && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red/10 border border-red/20 rounded-lg">
          <AlertCircle size={14} className="text-red" />
          <p className="text-xs text-red">프로그램 목록을 불러오지 못했습니다</p>
        </div>
      )}

      {showForm && (
        <div className="bg-bg-3 rounded-xl p-4 border border-green/30 space-y-3">
          <h3 className="text-sm font-semibold text-text-primary">새 추천 프로그램 만들기</h3>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <label className="text-xs text-text-tertiary">프로그램명 *</label>
              <input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="예: 친구 추천 프로그램"
                className="w-full mt-1 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-green/50"
              />
            </div>
            <div>
              <label className="text-xs text-text-tertiary">보상 유형</label>
              <select
                value={form.reward_type}
                onChange={e => setForm({ ...form, reward_type: e.target.value as 'points' | 'coupon' | 'cash' })}
                className="w-full mt-1 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary focus:outline-none focus:border-green/50"
              >
                <option value="points">포인트</option>
                <option value="coupon">쿠폰</option>
                <option value="cash">현금</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-text-tertiary">추천인 보상</label>
              <input
                type="number"
                value={form.referrer_reward}
                onChange={e => setForm({ ...form, referrer_reward: Number(e.target.value) })}
                className="w-full mt-1 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary focus:outline-none focus:border-green/50"
              />
            </div>
            <div>
              <label className="text-xs text-text-tertiary">피추천인 보상</label>
              <input
                type="number"
                value={form.referee_reward}
                onChange={e => setForm({ ...form, referee_reward: Number(e.target.value) })}
                className="w-full mt-1 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary focus:outline-none focus:border-green/50"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowForm(false)}
              className="px-3 py-1.5 text-xs text-text-tertiary border border-border-primary rounded-lg hover:text-text-primary hover:border-border-tertiary transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleCreate}
              disabled={createMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green hover:bg-green disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
            >
              {createMutation.isPending && <Loader2 size={12} className="animate-spin" />}
              프로그램 생성
            </button>
          </div>
        </div>
      )}

      {programs.length === 0 && !isError ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 bg-bg-3 rounded-xl border border-border-primary">
          <Gift size={28} className="text-text-tertiary" />
          <p className="text-sm text-text-tertiary">아직 추천 프로그램이 없습니다</p>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-green hover:bg-green text-white text-xs font-medium rounded-lg transition-colors"
          >
            <Plus size={14} /> 첫 프로그램 만들기
          </button>
        </div>
      ) : (
        programs.map(prog => (
          <div key={prog.id} className="bg-bg-3 rounded-xl p-5 border border-border-primary">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="text-sm font-semibold text-text-primary">{prog.name}</h3>
                <p className="text-xs text-text-tertiary mt-0.5">
                  보상: {prog.reward_type === 'points' ? '포인트' : prog.reward_type === 'coupon' ? '쿠폰' : '현금'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-1 rounded ${prog.status === 'active' ? 'bg-green/20 text-green' : 'bg-bg-3/20 text-text-tertiary'}`}>
                  {prog.status === 'active' ? '운영중' : '일시정지'}
                </span>
                <button
                  onClick={() => toggleMutation.mutate({ id: prog.id, status: prog.status === 'active' ? 'paused' : 'active' })}
                  disabled={toggleMutation.isPending}
                  className="text-[10px] px-2 py-1 border border-border-primary text-text-tertiary hover:text-text-primary hover:border-border-tertiary rounded transition-colors disabled:opacity-50"
                >
                  {prog.status === 'active' ? '중지' : '재개'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="bg-bg-2 rounded-lg p-3 text-center">
                <p className="text-[10px] text-text-tertiary">추천인 보상</p>
                <p className="text-lg font-bold text-green">{fmt(prog.referrer_reward)}{prog.reward_type === 'points' ? 'P' : prog.reward_type === 'cash' ? '원' : ''}</p>
              </div>
              <div className="bg-bg-2 rounded-lg p-3 text-center">
                <p className="text-[10px] text-text-tertiary">피추천인 보상</p>
                <p className="text-lg font-bold text-teal">{fmt(prog.referee_reward)}{prog.reward_type === 'points' ? 'P' : prog.reward_type === 'cash' ? '원' : ''}</p>
              </div>
              <div className="bg-bg-2 rounded-lg p-3 text-center">
                <p className="text-[10px] text-text-tertiary">총 추천</p>
                <p className="text-lg font-bold text-text-primary">{prog.total_referrals}</p>
              </div>
              <div className="bg-bg-2 rounded-lg p-3 text-center">
                <p className="text-[10px] text-text-tertiary">가입 전환율</p>
                <p className="text-lg font-bold text-yellow">{fmtPct(prog.conversion_rate)}%</p>
              </div>
            </div>

            {prog.total_referrals > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-text-tertiary">전환 퍼널</p>
                {[
                  { label: '추천 링크 공유', value: prog.total_referrals, color: '#93c5fd' },
                  { label: '링크 클릭', value: Math.round(prog.total_referrals * 0.8), color: '#60a5fa' },
                  { label: '가입 완료', value: prog.total_signups, color: '#34d399' },
                ].map((step, idx) => (
                  <div key={idx} className="flex items-center gap-3">
                    <span className="text-[10px] text-text-tertiary w-20 shrink-0">{step.label}</span>
                    <div className="flex-1 h-6 bg-bg-2 rounded overflow-hidden relative">
                      <div
                        className="h-full rounded"
                        style={{ width: `${(step.value / prog.total_referrals) * 100}%`, backgroundColor: step.color }}
                      />
                      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-text-primary">
                        {step.value}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ─── My Points section ────────────────────────────────────────────────────────

function MyPointsSection() {
  const { data: pointsData, isLoading: pointsLoading, isError: pointsError } = useQuery<PointsData>({
    queryKey: ['affiliate', 'my-points'],
    queryFn: affiliateApi.getMyPoints,
    retry: 1,
  });

  const { data: referralData, isLoading: referralLoading, isError: referralError } = useQuery<ReferralCodeData>({
    queryKey: ['affiliate', 'my-referral-code'],
    queryFn: affiliateApi.getMyReferralCode,
    retry: 1,
  });

  const copyLink = (link: string) => {
    navigator.clipboard.writeText(link);
    toast.success('추천 링크가 복사되었습니다');
  };

  const transactions = pointsData?.transactions ?? [];

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold text-text-primary">내 포인트</h2>

      <div className="grid md:grid-cols-2 gap-4">
        {/* 포인트 잔액 카드 */}
        <div className="bg-bg-3 rounded-xl p-5 border border-border-primary flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 rounded-full bg-yellow/10 flex items-center justify-center mb-3">
            <Coins size={22} className="text-yellow" />
          </div>
          {pointsLoading ? (
            <Loader2 size={20} className="text-green animate-spin" />
          ) : pointsError ? (
            <p className="text-xs text-red">잔액을 불러오지 못했습니다</p>
          ) : (
            <>
              <p className="text-[10px] text-text-tertiary mb-1">보유 포인트</p>
              <p className="text-4xl font-bold text-yellow">{fmt(pointsData?.balance ?? 0)}</p>
              <p className="text-sm text-text-tertiary mt-1">P</p>
            </>
          )}
        </div>

        {/* 내 추천 링크 카드 */}
        <div className="bg-bg-3 rounded-xl p-5 border border-border-primary space-y-3">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <Share2 size={14} className="text-green" /> 내 추천 링크
          </h3>
          {referralLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 size={18} className="text-green animate-spin" />
            </div>
          ) : referralError || !referralData ? (
            <p className="text-xs text-text-tertiary">추천 코드를 불러오지 못했습니다</p>
          ) : (
            <>
              <div className="flex items-center gap-2 bg-bg-2 rounded-lg px-3 py-2">
                <span className="text-xs text-text-tertiary font-mono">코드: </span>
                <span className="text-xs text-green font-mono font-medium flex-1">{referralData.referral_code}</span>
              </div>
              <div className="flex items-center gap-2 bg-bg-2 rounded-lg px-3 py-2">
                <Link2 size={12} className="text-text-tertiary shrink-0" />
                <code className="text-[10px] text-text-tertiary flex-1 truncate">{referralData.signup_link}</code>
                <button
                  onClick={() => copyLink(referralData.signup_link)}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] bg-green hover:bg-green text-white rounded transition-colors"
                >
                  <Copy size={10} /> 복사
                </button>
              </div>
              <p className="text-[10px] text-text-tertiary">친구가 이 링크로 가입하면 두 분 모두 포인트가 지급됩니다</p>
            </>
          )}
        </div>
      </div>

      {/* 거래 내역 */}
      <div className="bg-bg-3 rounded-xl p-4 border border-border-primary">
        <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
          <TrendingUp size={14} className="text-teal" /> 포인트 거래 내역
        </h3>
        {pointsLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={18} className="text-green animate-spin" />
          </div>
        ) : transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2">
            <Coins size={24} className="text-text-tertiary" />
            <p className="text-xs text-text-tertiary">거래 내역이 없습니다</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[420px]">
              <thead>
                <tr className="text-text-tertiary border-b border-border-primary">
                  <th className="text-left py-2 px-2 whitespace-nowrap">날짜</th>
                  <th className="text-left py-2 px-2 whitespace-nowrap">사유</th>
                  <th className="text-right py-2 px-2 whitespace-nowrap">금액</th>
                  <th className="text-left py-2 px-2 whitespace-nowrap">메모</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map(tx => (
                  <tr key={tx.id} className="border-b border-border-primary/50 text-text-secondary">
                    <td className="py-2.5 px-2 text-text-tertiary whitespace-nowrap">{tx.created_at?.slice(0, 10)}</td>
                    <td className="py-2.5 px-2 text-text-primary">{reasonLabel(tx.reason)}</td>
                    <td className={`py-2.5 px-2 text-right font-medium ${tx.amount >= 0 ? 'text-green' : 'text-red'}`}>
                      {tx.amount >= 0 ? '+' : ''}{fmt(tx.amount)}P
                    </td>
                    <td className="py-2.5 px-2 text-text-tertiary truncate max-w-[160px]">{tx.memo ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Settlement section ───────────────────────────────────────────────────────

function SettlementSection() {
  const qc = useQueryClient();
  // 매출 발생 기간(정산 생성일) 기준 필터 + 파트너명 검색
  const [dateRange, setDateRange] = useState<DateRange>({ start: '', end: '' });
  const [search, setSearch] = useState('');

  const { data: settlements = [], isLoading, isError } = useQuery<Settlement[]>({
    queryKey: ['affiliate', 'settlements'],
    queryFn: affiliateApi.getSettlements,
    retry: 1,
  });

  const { data: partners = [] } = useQuery<AffiliatePartner[]>({
    queryKey: ['affiliate', 'partners'],
    queryFn: affiliateApi.getPartners,
    retry: 1,
  });

  const payMutation = useMutation({
    mutationFn: (id: number) => affiliateApi.paySettlement(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['affiliate', 'settlements'] });
      qc.invalidateQueries({ queryKey: ['affiliate', 'partners'] });
      qc.invalidateQueries({ queryKey: ['affiliate', 'dashboard'] });
      toast.success('정산이 처리되었습니다');
    },
    onError: () => toast.error('정산 처리에 실패했습니다'),
  });

  // 정산서 다운로드 — 클릭 시 판매자 유형(프리랜서/사업자) 선택 모달 → 선택 후 export.
  // dateRange 필터를 그대로 적용.
  const [exportTarget, setExportTarget] = useState<AffiliatePartner | null>(null);
  const exportMutation = useMutation({
    mutationFn: async (args: { partner: AffiliatePartner; sellerType: 'freelancer' | 'business' }) => {
      await affiliateApi.downloadSettlementExport(args.partner.id, {
        start: dateRange.start || undefined,
        end: dateRange.end || undefined,
        partnerName: args.partner.name,
        sellerType: args.sellerType,
      });
      return args.partner.id;
    },
    onSuccess: () => {
      toast.success('정산서 엑셀이 다운로드되었습니다');
      setExportTarget(null);
    },
    onError: () => toast.error('정산서 다운로드에 실패했습니다'),
  });

  // 기간/검색 필터 적용된 정산 내역 (매출 발생 기간 = 정산 생성일 기준)
  const filteredSettlements = settlements.filter(s => {
    if (!isInRange(s.created_at, dateRange)) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!s.partner_name?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // 통계는 필터링된 데이터 기준으로 표시 → 기간 분석 가능
  const totalUnpaid = filteredSettlements.filter(s => s.status === 'pending').reduce((sum, s) => sum + s.amount, 0);
  const totalPaid = filteredSettlements.filter(s => s.status === 'paid').reduce((sum, s) => sum + s.amount, 0);
  const pendingCount = filteredSettlements.filter(s => s.status === 'pending').length;

  const approvedPartners = partners.filter(p => p.status === 'approved' && p.unpaid_commission > 0);

  if (isLoading) return <SectionLoader />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-bold text-text-primary">정산 관리</h2>
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="파트너명 검색"
          width="w-56"
        />
      </div>

      {/* 매출 발생 기간 필터 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-[11px] text-text-tertiary">매출 발생 기간</span>
        <DateRangeFilter value={dateRange} onChange={setDateRange} align="right" />
      </div>

      {isError && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red/10 border border-red/20 rounded-lg">
          <AlertCircle size={14} className="text-red" />
          <p className="text-xs text-red">정산 데이터를 불러오지 못했습니다</p>
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-bg-3 rounded-xl p-4 border border-border-primary text-center">
          <p className="text-xs text-text-tertiary">총 미정산 금액</p>
          <p className="text-2xl font-bold text-red mt-1">₩{fmt(totalUnpaid)}</p>
          <p className="text-[10px] text-text-tertiary mt-0.5">{pendingCount}건 대기중</p>
        </div>
        <div className="bg-bg-3 rounded-xl p-4 border border-border-primary text-center">
          <p className="text-xs text-text-tertiary">이번 달 정산 예정</p>
          <p className="text-2xl font-bold text-yellow mt-1">
            ₩{fmt(approvedPartners.reduce((s, p) => s + n(p.unpaid_commission), 0))}
          </p>
        </div>
        <div className="bg-bg-3 rounded-xl p-4 border border-border-primary text-center">
          <p className="text-xs text-text-tertiary">누적 정산 완료</p>
          <p className="text-2xl font-bold text-green mt-1">₩{fmt(totalPaid)}</p>
        </div>
      </div>

      {approvedPartners.length > 0 && (
        <div className="bg-bg-3 rounded-xl p-4 border border-border-primary">
          <h3 className="text-sm font-semibold text-text-primary mb-3">미정산 파트너</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[520px]">
              <thead>
                <tr className="text-text-tertiary border-b border-border-primary">
                  <th className="text-left py-2 px-2 whitespace-nowrap">파트너</th>
                  <th className="text-right py-2 px-2 whitespace-nowrap">총 매출</th>
                  <th className="text-right py-2 px-2 whitespace-nowrap">총 커미션</th>
                  <th className="text-right py-2 px-2 whitespace-nowrap">미정산</th>
                  <th className="text-center py-2 px-2 whitespace-nowrap">액션</th>
                </tr>
              </thead>
              <tbody>
                {approvedPartners.map(p => (
                  <tr key={p.id} className="border-b border-border-primary/50 text-text-secondary">
                    <td className="py-2.5 px-2 font-medium text-text-primary">{p.name}</td>
                    <td className="py-2.5 px-2 text-right">₩{fmt(p.total_sales)}</td>
                    <td className="py-2.5 px-2 text-right">₩{fmt(p.total_commission)}</td>
                    <td className="py-2.5 px-2 text-right text-red">₩{fmt(p.unpaid_commission)}</td>
                    <td className="py-2.5 px-2 text-center">
                      <button
                        onClick={() => setExportTarget(p)}
                        disabled={exportMutation.isPending && exportMutation.variables?.partner.id === p.id}
                        title="판매자 유형 선택 후 정산서(요약·전체주문·취소건) 엑셀 다운로드"
                        className="flex items-center gap-1 mx-auto px-2 py-0.5 text-[10px] bg-green hover:bg-green disabled:opacity-50 text-white rounded transition-colors"
                      >
                        {exportMutation.isPending && exportMutation.variables?.partner.id === p.id
                          ? <Loader2 size={10} className="animate-spin" />
                          : <Download size={10} />}
                        정산 요청
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-bg-3 rounded-xl p-4 border border-border-primary">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-text-primary">정산 내역</h3>
          <span className="text-[11px] text-text-tertiary">
            {filteredSettlements.length}건
            {(dateRange.start || dateRange.end || search) && ` (전체 ${settlements.length}건 중)`}
          </span>
        </div>
        {filteredSettlements.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2">
            <DollarSign size={24} className="text-text-tertiary" />
            <p className="text-xs text-text-tertiary">
              {settlements.length === 0 ? '정산 내역이 없습니다' : '조건에 해당하는 정산 내역이 없습니다'}
            </p>
            {settlements.length > 0 && (dateRange.start || dateRange.end || search) && (
              <button
                onClick={() => { setDateRange({ start: '', end: '' }); setSearch(''); }}
                className="text-[11px] text-green hover:text-green underline mt-1"
              >
                필터 초기화
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[560px]">
              <thead>
                <tr className="text-text-tertiary border-b border-border-primary">
                  <th className="text-left py-2 px-2 whitespace-nowrap">파트너</th>
                  <th className="text-right py-2 px-2 whitespace-nowrap">금액</th>
                  <th className="text-center py-2 px-2 whitespace-nowrap">상태</th>
                  <th className="text-left py-2 px-2 whitespace-nowrap">생성일</th>
                  <th className="text-left py-2 px-2 whitespace-nowrap">완료일</th>
                  <th className="text-center py-2 px-2">액션</th>
                </tr>
              </thead>
              <tbody>
                {filteredSettlements.map(s => (
                  <tr key={s.id} className="border-b border-border-primary/50 text-text-secondary">
                    <td className="py-2.5 px-2 font-medium text-text-primary">{s.partner_name}</td>
                    <td className="py-2.5 px-2 text-right text-green">₩{fmt(s.amount)}</td>
                    <td className="py-2.5 px-2 text-center">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${s.status === 'paid' ? 'bg-green/20 text-green' : 'bg-yellow/20 text-yellow'}`}>
                        {s.status === 'paid' ? '완료' : '대기'}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-text-tertiary">{s.created_at?.slice(0, 10)}</td>
                    <td className="py-2.5 px-2 text-text-tertiary">{s.paid_at?.slice(0, 10) ?? '-'}</td>
                    <td className="py-2.5 px-2 text-center">
                      {s.status === 'pending' && (
                        <button
                          onClick={() => payMutation.mutate(s.id)}
                          disabled={payMutation.isPending}
                          className="flex items-center gap-1 mx-auto px-2 py-0.5 text-[10px] bg-green hover:bg-green disabled:opacity-50 text-white rounded transition-colors"
                        >
                          {payMutation.isPending && <Loader2 size={8} className="animate-spin" />}
                          정산하기
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 판매자 유형 선택 모달 — 정산서 양식이 유형별로 다름 (소득세 차감 vs 사업자 세금계산서 발행) */}
      {exportTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => !exportMutation.isPending && setExportTarget(null)}
        >
          <div
            className="bg-bg-3 border border-border-primary rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-base font-bold text-text-primary">판매자 유형 선택</h3>
                <p className="text-xs text-text-tertiary mt-1">
                  <span className="text-text-primary">{exportTarget.name}</span> 님의 정산서 양식을 선택해주세요
                </p>
              </div>
              <button
                onClick={() => setExportTarget(null)}
                disabled={exportMutation.isPending}
                className="text-text-tertiary hover:text-text-primary text-lg leading-none disabled:opacity-30"
                aria-label="닫기"
              >
                ×
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-4">
              <button
                onClick={() => exportMutation.mutate({ partner: exportTarget, sellerType: 'freelancer' })}
                disabled={exportMutation.isPending}
                className="group flex flex-col items-center gap-2 p-4 bg-bg-2 border border-border-primary hover:border-green/50 rounded-xl transition-colors disabled:opacity-50"
              >
                <div className="w-10 h-10 rounded-full bg-green/10 flex items-center justify-center group-hover:bg-green/20 transition-colors">
                  <Users size={18} className="text-green" />
                </div>
                <div className="text-sm font-semibold text-white">프리랜서</div>
                <div className="text-[10px] text-text-tertiary text-center leading-tight">
                  공급가 기준 정산<br/>소득세 3% + 주민세 0.3% 차감
                </div>
              </button>

              <button
                onClick={() => exportMutation.mutate({ partner: exportTarget, sellerType: 'business' })}
                disabled={exportMutation.isPending}
                className="group flex flex-col items-center gap-2 p-4 bg-bg-2 border border-border-primary hover:border-blue/50 rounded-xl transition-colors disabled:opacity-50"
              >
                <div className="w-10 h-10 rounded-full bg-blue/10 flex items-center justify-center group-hover:bg-blue/20 transition-colors">
                  <Briefcase size={18} className="text-blue" />
                </div>
                <div className="text-sm font-semibold text-white">사업자</div>
                <div className="text-[10px] text-text-tertiary text-center leading-tight">
                  주문금액 기준 정산<br/>세금 차감 없음 (세금계산서 발행)
                </div>
              </button>
            </div>

            {exportMutation.isPending && (
              <div className="flex items-center justify-center gap-2 mt-4 text-xs text-green">
                <Loader2 size={12} className="animate-spin" />
                <span>정산서 생성 중…</span>
              </div>
            )}

            <p className="text-[10px] text-text-tertiary mt-4 text-center">
              {dateRange.start || dateRange.end
                ? `기간 필터: ${dateRange.start || '전체'} ~ ${dateRange.end || '전체'}`
                : '기간 필터 미적용 (전체 기간)'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Settings section ─────────────────────────────────────────────────────────

function SettingsSection() {
  const [settings, setSettings] = useState<AffiliateSettingsForm>({
    default_commission_rate: 10,
    cookie_lifetime_days: 30,
    min_payout_amount: 50000,
    payout_cycle: 'monthly',
    notify_new_partner: true,
    notify_conversion: true,
    notify_payout: true,
    notify_daily_report: false,
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      return fetch('/api/v1/affiliate/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
    },
    onSuccess: () => toast.success('설정이 저장되었습니다'),
    onError: () => toast.error('설정 저장에 실패했습니다'),
  });

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-text-primary">어필리에이트 설정</h2>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-bg-3 rounded-xl p-4 border border-border-primary space-y-3">
          <h3 className="text-sm font-semibold text-text-primary">기본 설정</h3>
          <div>
            <label className="text-xs text-text-tertiary">기본 커미션 비율 (%)</label>
            <input
              type="number"
              value={settings.default_commission_rate}
              onChange={e => setSettings({ ...settings, default_commission_rate: Number(e.target.value) })}
              className="w-full mt-1 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary focus:outline-none focus:border-green/50"
            />
          </div>
          <div>
            <label className="text-xs text-text-tertiary">쿠키 유효기간 (일)</label>
            <input
              type="number"
              value={settings.cookie_lifetime_days}
              onChange={e => setSettings({ ...settings, cookie_lifetime_days: Number(e.target.value) })}
              className="w-full mt-1 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary focus:outline-none focus:border-green/50"
            />
          </div>
          <div>
            <label className="text-xs text-text-tertiary">최소 정산 금액 (₩)</label>
            <input
              type="number"
              value={settings.min_payout_amount}
              onChange={e => setSettings({ ...settings, min_payout_amount: Number(e.target.value) })}
              className="w-full mt-1 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary focus:outline-none focus:border-green/50"
            />
          </div>
          <div>
            <label className="text-xs text-text-tertiary">정산 주기</label>
            <select
              value={settings.payout_cycle}
              onChange={e => setSettings({ ...settings, payout_cycle: e.target.value as 'weekly' | 'biweekly' | 'monthly' })}
              className="w-full mt-1 px-3 py-2 bg-bg-2 border border-border-primary rounded-lg text-sm text-text-primary focus:outline-none focus:border-green/50"
            >
              <option value="weekly">주간</option>
              <option value="biweekly">격주</option>
              <option value="monthly">월간</option>
            </select>
          </div>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="flex items-center justify-center gap-1.5 w-full py-2 text-xs font-medium bg-green hover:bg-green disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {saveMutation.isPending && <Loader2 size={12} className="animate-spin" />}
            설정 저장
          </button>
        </div>

        <div className="bg-bg-3 rounded-xl p-4 border border-border-primary space-y-3">
          <h3 className="text-sm font-semibold text-text-primary">알림 설정</h3>
          {([
            { key: 'notify_new_partner' as const, label: '새 파트너 신청 알림' },
            { key: 'notify_conversion' as const, label: '전환 발생 알림' },
            { key: 'notify_payout' as const, label: '정산 예정일 알림' },
            { key: 'notify_daily_report' as const, label: '일일 리포트 이메일' },
          ]).map(item => (
            <label key={item.key} className="flex items-center justify-between cursor-pointer">
              <span className="text-xs text-text-tertiary">{item.label}</span>
              <input
                type="checkbox"
                checked={settings[item.key]}
                onChange={e => setSettings({ ...settings, [item.key]: e.target.checked })}
                className="w-4 h-4 rounded accent-green"
              />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const NAV_ITEMS: { key: SectionKey; label: string; icon: React.ReactNode }[] = [
  { key: 'dashboard', label: '대시보드', icon: <BarChart2 size={14} /> },
  { key: 'campaigns', label: '캠페인 관리', icon: <Megaphone size={14} /> },
  { key: 'partners', label: '파트너 관리', icon: <Users size={14} /> },
  { key: 'referral', label: '친구추천', icon: <Gift size={14} /> },
  { key: 'points', label: '내 포인트', icon: <Coins size={14} /> },
  { key: 'settlement', label: '정산 관리', icon: <DollarSign size={14} /> },
  { key: 'settings', label: '설정', icon: <Settings size={14} /> },
];

// ─── 구매자 식별 추적 현황 카드 ───────────────────────────────────────────────
// tracker.js 주문완료 바인딩 적재 추이 + 귀속 모드(추정 허용/자동 엄격) 모니터링.
// 바인딩이 임계치 이상 쌓이면 서버가 자동으로 추정 귀속을 중단한다.
function TrackingStatusCard() {
  const { data: ts } = useQuery({
    queryKey: ['affiliate', 'tracking-status'],
    queryFn: () => affiliateApi.getTrackingStatus(),
    refetchInterval: 300000,
    retry: 1,
  });
  if (!ts) return null;

  const modeInfo = {
    strict_env: { label: '엄격 (추정 기록도 중단)', cls: 'bg-green/10 text-green ring-green/20' },
    strict_auto: { label: '엄격 (자동 전환됨)', cls: 'bg-green/10 text-green ring-green/20' },
    loose: { label: '추정 허용 (바인딩 적재 대기)', cls: 'bg-yellow/10 text-yellow ring-yellow/20' },
    confirmed_first: { label: '확정 우선 (추정은 참고 기록만)', cls: 'bg-green/10 text-green ring-green/20' },
  }[ts.mode] || { label: ts.mode, cls: 'bg-bg-3/10 text-text-secondary ring-border-tertiary/20' };

  return (
    <div className="bg-bg-3 rounded-xl p-4 ring-1 ring-[rgb(var(--color-overlay-rgb)/0.05)]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-sm font-semibold text-text-primary">구매자 식별 추적</span>
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 ${modeInfo.cls}`}>
          귀속 모드: {modeInfo.label}
        </span>
        <span className="text-xs text-text-tertiary">
          확정 바인딩 <span className="text-text-primary font-semibold">{ts.binds_total.toLocaleString()}</span>건
          <span className="text-text-tertiary"> · 최근 7일 </span>
          <span className="text-text-primary font-semibold">{ts.binds_7d.toLocaleString()}</span>
          <span className="text-text-tertiary">/{ts.auto_threshold_7d}건 (자동 엄격 전환 기준)</span>
        </span>
        <span className="text-xs text-text-tertiary">
          최근 30일 매출귀속 중 확정 비중{' '}
          <span className={ts.confirmed_share_30d >= 50 ? 'text-green font-semibold' : 'text-yellow font-semibold'}>
            {ts.confirmed_share_30d}%
          </span>
        </span>
      </div>
      {ts.mode !== 'strict_env' && (
        <p className="mt-2 text-[11px] leading-relaxed text-text-tertiary">
          모든 매출·전환·커미션 집계는 <span className="text-text-secondary">확정 귀속(주문완료 바인딩·ref코드·파트너 쿠폰·회원연결)만</span> 포함합니다.
          추정 귀속(라스트클릭)은 집계·정산에서 영구 제외되지만, 기록은 계속 쌓입니다 —
          과거 성과 보정(캘리브레이션)의 분모와 &quot;추정 포함(참고)&quot; 조회에 사용됩니다.
        </p>
      )}
      {ts.binds_by_day.length > 0 && (
        <div className="mt-2 flex items-end gap-1 h-8">
          {ts.binds_by_day.map((b) => {
            const max = Math.max(...ts.binds_by_day.map((x) => x.count), 1);
            return (
              <div key={b.date} className="flex-1 max-w-[24px] bg-green/40 rounded-sm" title={`${b.date}: ${b.count}건`}
                style={{ height: `${Math.max(8, (b.count / max) * 100)}%` }} />
            );
          })}
        </div>
      )}
    </div>
  );
}

// Error boundary wrapper
function SafeSection({ children }: { children: React.ReactNode }) {
  const [hasError, setHasError] = useState(false);
  if (hasError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle size={32} className="text-red mb-3" />
        <p className="text-sm text-text-tertiary">이 섹션을 로드하는 중 오류가 발생했습니다.</p>
        <button onClick={() => setHasError(false)} className="mt-2 text-xs text-green hover:underline">다시 시도</button>
      </div>
    );
  }
  try {
    return <>{children}</>;
  } catch {
    setHasError(true);
    return null;
  }
}

export function AffiliateManaging() {
  const [activeSection, setActiveSection] = useState<SectionKey>('dashboard');

  return (
    <div className="space-y-4">
      {/* 연결 상태등 + Cafe24 연결 배너 */}
      <ConnectionStatusIndicator />
      <Cafe24Banner />
      <TrackingStatusCard />

      {/* 탭 네비게이션 */}
      <div className="flex items-center gap-1 bg-bg-3 rounded-xl p-1 overflow-x-auto">
        {NAV_ITEMS.map(item => (
          <button
            key={item.key}
            onClick={() => setActiveSection(item.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
              activeSection === item.key
                ? 'bg-green text-white'
                : 'text-text-tertiary hover:text-text-primary hover:bg-[rgb(var(--color-overlay-rgb)/0.05)]'
            }`}
          >
            {item.icon} {item.label}
          </button>
        ))}
      </div>

      <SafeSection>
        {activeSection === 'dashboard' && <DashboardSection />}
        {activeSection === 'campaigns' && <CampaignsSection />}
        {activeSection === 'partners' && <PartnersSection />}
        {activeSection === 'referral' && <ReferralSection />}
        {activeSection === 'points' && <MyPointsSection />}
        {activeSection === 'settlement' && <SettlementSection />}
        {activeSection === 'settings' && <SettingsSection />}
      </SafeSection>
    </div>
  );
}
