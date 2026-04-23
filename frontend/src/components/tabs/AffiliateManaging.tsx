'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users, Link2, Share2, TrendingUp, DollarSign, Award, Plus, Search,
  Eye, Copy, CheckCircle, Clock, X, BarChart2, Gift, UserPlus, ExternalLink,
  Percent, ShoppingBag, Megaphone, Settings, Filter, Download, Loader2,
  AlertCircle, Coins, Tag, Store, ChevronDown, Trash2, Pencil, Phone,
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
import type { AffiliatePartner, AffiliateTimeseriesPoint, AffiliateByCampaign, AffiliateChannelKey, HourlyConversion, TopProduct, ConnectionsStatus } from '@/lib/api';

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
  { key: 'instagram', label: 'Instagram', badge: 'IG',   color: 'bg-pink-500/20 text-pink-400 border-pink-500/30' },
  { key: 'youtube',   label: 'YouTube',   badge: 'YT',   color: 'bg-red-500/20 text-red-400 border-red-500/30' },
  { key: 'tiktok',    label: 'TikTok',    badge: 'TK',   color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' },
  { key: 'blog',      label: '블로그',    badge: 'BLOG', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  { key: 'facebook',  label: 'Facebook',  badge: 'FB',   color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  { key: 'x',         label: 'X(Twitter)', badge: 'X',  color: 'bg-gray-500/20 text-gray-300 border-gray-500/30' },
  { key: 'kakao',     label: 'KakaoTalk', badge: 'KT',  color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  { key: 'other',     label: '기타',      badge: 'ETC', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
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
            className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${opt?.color ?? 'bg-gray-500/20 text-gray-400 border-gray-500/30'}`}
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

function campaignStatusBadge(status: AffiliateCampaign['status']) {
  if (status === 'active') return 'bg-emerald-500/20 text-emerald-400';
  if (status === 'paused') return 'bg-yellow-500/20 text-yellow-400';
  return 'bg-gray-500/20 text-gray-400';
}

function campaignStatusLabel(status: AffiliateCampaign['status']) {
  if (status === 'active') return '활성';
  if (status === 'paused') return '일시정지';
  return '종료';
}

function partnerStatusBadge(status: AffiliatePartner['status']) {
  if (status === 'approved') return 'bg-emerald-500/20 text-emerald-400';
  if (status === 'pending') return 'bg-yellow-500/20 text-yellow-400';
  return 'bg-red-500/20 text-red-400';
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
      <Loader2 size={24} className="text-emerald-400 animate-spin" />
    </div>
  );
}

function SectionError({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-2">
      <AlertCircle size={24} className="text-red-400" />
      <p className="text-sm text-gray-400">{message ?? '데이터를 불러오지 못했습니다'}</p>
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
      anyDisconnected ? 'bg-red-500/5 border-red-500/20' : anyWarning ? 'bg-amber-500/5 border-amber-500/20' : 'bg-[#1a1b1e] border-[#2a2d35]'
    }`}>
      <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider shrink-0">연결 상태</span>
      <div className="flex items-center gap-4 flex-wrap">
        {items.map((item) => {
          const color = item.warning ? 'bg-amber-400' : item.connected ? 'bg-emerald-400' : 'bg-red-400';
          const textColor = item.warning ? 'text-amber-300' : item.connected ? 'text-gray-300' : 'text-red-300';
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
                <span className="text-[10px] text-gray-500 hidden md:inline">({item.detail})</span>
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

  const { data: status, isLoading } = useQuery<Cafe24Status>({
    queryKey: ['cafe24', 'status'],
    queryFn: cafe24Api.getStatus,
    retry: 1,
    staleTime: 30_000,
    refetchInterval: 60_000, // 1분마다 연결 상태 재확인
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
    return (
      <div className="flex items-center justify-between px-4 py-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
        <div className="flex items-center gap-2">
          <Store size={15} className="text-emerald-400" />
          <span className="text-sm text-emerald-300 font-medium">Cafe24 연결됨</span>
          {status.mall_id && (
            <span className="text-xs text-emerald-400/70">({status.mall_id})</span>
          )}
        </div>
        <button
          onClick={() => disconnectMutation.mutate()}
          disabled={disconnectMutation.isPending}
          className="flex items-center gap-1 px-3 py-1.5 text-xs text-red-400 border border-red-400/30 hover:bg-red-400/10 rounded-lg transition-colors disabled:opacity-50"
        >
          {disconnectMutation.isPending && <Loader2 size={10} className="animate-spin" />}
          연결 해제
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 bg-red-500/10 border-2 border-red-500/40 rounded-xl space-y-2 animate-pulse-slow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-red-300 font-semibold">⚠️ Cafe24 스토어 연결이 필요합니다</p>
            <p className="text-xs text-gray-400 mt-0.5">토큰 만료 또는 갱신 실패로 연결이 끊어졌습니다. 재연결 전까지 상품 조회, 주문 폴링, 쿠폰 발급이 중단됩니다.</p>
          </div>
        </div>
        <button
          onClick={() => setShowMallInput(!showMallInput)}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded-lg transition-colors"
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
            className="flex-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-amber-500/50"
            onKeyDown={e => e.key === 'Enter' && handleConnect()}
          />
          <button
            onClick={handleConnect}
            className="px-4 py-2 text-xs bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg transition-colors"
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
      <div className="mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-xs text-gray-600">
        Cafe24 연결 후 사용 가능합니다
      </div>
    );
  }

  return (
    <div className="relative">
      {selectedNo ? (
        <div className="flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
          <Tag size={12} className="text-emerald-400 shrink-0" />
          <span className="text-xs text-emerald-300 flex-1 truncate">선택됨: {selectedName}</span>
          <button
            type="button"
            onClick={onClear}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      ) : (
        <div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                value={query}
                onChange={e => { setQuery(e.target.value); setOpen(true); }}
                onFocus={() => setOpen(true)}
                placeholder="상품명 검색..."
                className="w-full pl-8 pr-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-emerald-500/50"
              />
              {isFetching && (
                <Loader2 size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 animate-spin" />
              )}
            </div>
            <button
              type="button"
              onClick={() => setBrowserOpen(true)}
              className="shrink-0 px-3 py-2 bg-[#3B82F6] hover:bg-[#2563EB] rounded-lg text-xs font-medium text-white transition-colors flex items-center gap-1.5"
            >
              <ShoppingBag size={12} /> 상품 조회
            </button>
          </div>
          {open && displayProducts.length > 0 && (
            <div className="absolute z-20 top-full mt-1 w-full bg-[#1a1b1e] border border-[#2a2d35] rounded-xl shadow-xl max-h-64 overflow-y-auto">
              {displayProducts.map(p => (
                <button
                  key={`${p.product_no}-${p._idx}`}
                  type="button"
                  onClick={() => {
                    onSelect(p.product_no, p.product_name, p.price);
                    setOpen(false);
                    setQuery('');
                  }}
                  className="flex items-center gap-3 w-full px-3 py-2.5 hover:bg-white/5 transition-colors text-left"
                >
                  {p.list_image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.list_image} alt={p.product_name} className="w-10 h-10 rounded object-cover bg-[#141516] shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded bg-[#141516] shrink-0 flex items-center justify-center">
                      <ShoppingBag size={14} className="text-gray-600" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-white truncate">{p.product_name}</p>
                    <p className="text-[10px] text-gray-500">₩{p.price.toLocaleString()}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {open && displayProducts.length === 0 && !isFetching && query.length > 0 && (
            <div className="absolute z-20 top-full mt-1 w-full bg-[#1a1b1e] border border-[#2a2d35] rounded-xl shadow-xl px-3 py-4 text-center">
              <p className="text-xs text-gray-500">검색 결과가 없습니다</p>
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

// ─── Cafe24 전체 상품 조회 모달 ─────────────────────────────────────────────

interface Cafe24ProductBrowserModalProps {
  onClose: () => void;
  onPick: (no: number, name: string, price: number) => void;
}

function Cafe24ProductBrowserModal({ onClose, onPick }: Cafe24ProductBrowserModalProps) {
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
        className="bg-[#1a1b1e] border border-[#2a2d35] rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <ShoppingBag size={16} className="text-[#3B82F6]" />
            <h3 className="text-sm font-semibold text-white">Cafe24 상품 조회</h3>
            <span className="text-xs text-gray-500">({products.length}개)</span>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-3 border-b border-white/10">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="상품명으로 검색... (비워두면 전체 목록)"
              autoFocus
              className="w-full pl-9 pr-10 py-2.5 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-[#3B82F6]"
            />
            {isFetching && (
              <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 animate-spin" />
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {error ? (
            <div className="text-center py-12">
              <AlertCircle size={28} className="mx-auto text-red-500 mb-2" />
              <p className="text-sm text-red-400">상품 목록을 불러오지 못했습니다</p>
              <p className="text-xs text-gray-500 mt-1">{String((error as Error)?.message || error)}</p>
            </div>
          ) : isFetching && products.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="text-gray-500 animate-spin" />
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-12">
              <ShoppingBag size={28} className="mx-auto text-gray-700 mb-2" />
              <p className="text-sm text-gray-500">조회된 상품이 없습니다</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {products.map(p => (
                <button
                  key={`${p.product_no}-${p._idx}`}
                  type="button"
                  onClick={() => onPick(p.product_no, p.product_name, p.price)}
                  className="group text-left bg-[#141516] border border-[#2a2d35] rounded-xl p-3 hover:border-[#3B82F6] hover:bg-[#3B82F6]/5 transition-all"
                >
                  {p.list_image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.list_image} alt={p.product_name} className="w-full aspect-square rounded-lg object-cover bg-[#0f1011] mb-2" />
                  ) : (
                    <div className="w-full aspect-square rounded-lg bg-[#0f1011] mb-2 flex items-center justify-center">
                      <ShoppingBag size={24} className="text-gray-700" />
                    </div>
                  )}
                  <p className="text-xs font-medium text-white truncate">{p.product_name}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">₩{p.price.toLocaleString()}</p>
                  <p className="text-[10px] text-gray-600 mt-0.5">상품번호 {p.product_no}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard chart helpers ──────────────────────────────────────────────────

const DARK_TOOLTIP_STYLE = {
  backgroundColor: '#1E1F22',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  fontSize: 12,
  color: '#e5e7eb',
};

function ChartLoader() {
  return (
    <div className="flex items-center justify-center h-48 gap-2">
      <Loader2 size={18} className="text-blue-400 animate-spin" />
      <span className="text-xs text-gray-500">데이터 불러오는 중...</span>
    </div>
  );
}

function ChartEmpty({ message = '데이터가 없습니다' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-48 gap-2">
      <BarChart2 size={24} className="text-gray-600" />
      <p className="text-xs text-gray-500">{message}</p>
    </div>
  );
}

// ─── Dashboard chart helpers (heatmap) ──────────────────────────────────────

const HEATMAP_DAYS = ['월', '화', '수', '목', '금', '토', '일'];

/** 0~1 사이 비율을 emerald 팔레트 색상으로 변환 */
function heatColor(ratio: number): string {
  if (ratio <= 0) return 'rgba(255,255,255,0.04)';
  // emerald-900 → emerald-400 스펙트럼
  const r = Math.round(6 + ratio * (52 - 6));
  const g = Math.round(78 + ratio * (211 - 78));
  const b = Math.round(59 + ratio * (153 - 59));
  return `rgba(${r},${g},${b},${0.25 + ratio * 0.75})`;
}

// ─── Dashboard section ────────────────────────────────────────────────────────

function DashboardSection() {
  const [days, setDays] = useState<7 | 30 | 90>(7);
  const [heatmapDays, setHeatmapDays] = useState<7 | 30 | 90>(30);
  /** 히트맵 hover cell: "dow_hour" 키 */
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<DashboardData>({
    queryKey: ['affiliate', 'dashboard'],
    queryFn: affiliateApi.getDashboard,
    retry: 1,
  });

  const {
    data: timeseriesRaw = [],
    isLoading: tsLoading,
  } = useQuery<AffiliateTimeseriesPoint[]>({
    queryKey: ['affiliate-timeseries', days],
    queryFn: () => affiliateApi.getDashboardTimeseries(days),
    retry: 1,
  });

  // X축 고정: 데이터가 없는 날짜도 포함해 최근 N일을 빠짐없이 표시
  const timeseries = useMemo(() => {
    const byDate: Record<string, AffiliateTimeseriesPoint> = {};
    for (const row of timeseriesRaw) byDate[row.date] = row;
    const out: AffiliateTimeseriesPoint[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const key = `${yyyy}-${mm}-${dd}`;
      out.push(byDate[key] ?? {
        date: key,
        revenue: 0, commission: 0, clicks: 0, conversions: 0,
        refunded_count: 0, refunded_amount: 0,
        cancelled_count: 0, cancelled_amount: 0,
      });
    }
    return out;
  }, [timeseriesRaw, days]);

  const {
    data: byCampaign = [],
    isLoading: bcLoading,
  } = useQuery<AffiliateByCampaign[]>({
    queryKey: ['affiliate-by-campaign'],
    queryFn: affiliateApi.getDashboardByCampaign,
    retry: 1,
  });

  const {
    data: hourlyRaw = [],
    isLoading: hourlyLoading,
  } = useQuery<HourlyConversion[]>({
    queryKey: ['affiliate-hourly', heatmapDays],
    queryFn: () => affiliateApi.getDashboardHourly(heatmapDays),
    retry: 1,
  });

  const {
    data: topProducts = [],
    isLoading: topProductsLoading,
  } = useQuery<TopProduct[]>({
    queryKey: ['affiliate-top-products'],
    queryFn: () => affiliateApi.getTopProducts(10),
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
    { label: '총 매출', value: fmtMan(d.total_sales), icon: <ShoppingBag size={16} />, color: 'text-blue-400', bg: 'bg-blue-500/10', showRefund: true },
    { label: '총 커미션', value: fmtMan(d.total_commission), icon: <DollarSign size={16} />, color: 'text-green-400', bg: 'bg-green-500/10', showRefund: false },
    { label: '활성 파트너', value: `${d.active_partners}명`, icon: <Users size={16} />, color: 'text-purple-400', bg: 'bg-purple-500/10', showRefund: false },
    { label: '총 클릭', value: fmt(d.total_clicks), icon: <Eye size={16} />, color: 'text-cyan-400', bg: 'bg-cyan-500/10', showRefund: false },
    { label: '전환', value: fmt(d.total_conversions), icon: <CheckCircle size={16} />, color: 'text-emerald-400', bg: 'bg-emerald-500/10', showRefund: false },
    { label: '전환율', value: `${fmtPct(d.conversion_rate)}%`, icon: <Percent size={16} />, color: 'text-orange-400', bg: 'bg-orange-500/10', showRefund: false },
  ];

  const rankColors = [
    'bg-yellow-500/20 text-yellow-400',
    'bg-gray-300/20 text-gray-300',
    'bg-orange-500/20 text-orange-400',
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
        <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-lg">
          <AlertCircle size={14} className="text-red-400" />
          <p className="text-xs text-red-400">대시보드 데이터를 불러오지 못했습니다. 기본값으로 표시합니다.</p>
        </div>
      )}

      {/* KPI 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map((kpi, idx) => (
          <div key={idx} className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35]">
            <div className={`w-8 h-8 rounded-lg ${kpi.bg} flex items-center justify-center ${kpi.color} mb-2`}>
              {kpi.icon}
            </div>
            <p className="text-[10px] text-gray-500">{kpi.label}</p>
            <p className="text-lg font-bold text-white">{kpi.value}</p>
            {/* 환불/취소 배지 — 총 매출 카드에만 표시 */}
            {kpi.showRefund && hasRefunds && (
              <div className="mt-1.5 flex flex-col gap-0.5">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-yellow-500/15 border border-yellow-500/30 rounded text-[9px] text-yellow-400 leading-tight">
                  환불 {d.refunded_count}건 / ₩{fmt(refundDiff)} 제외
                </span>
                {d.cancelled_count > 0 && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-orange-500/10 border border-orange-500/20 rounded text-[9px] text-orange-400 leading-tight">
                    취소 {d.cancelled_count}건
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 기간 선택 */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">기간:</span>
        {([7, 30, 90] as const).map(d => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
              days === d
                ? 'bg-blue-600 text-white'
                : 'bg-[#1a1b1e] text-gray-400 border border-[#2a2d35] hover:text-white hover:border-gray-500'
            }`}
          >
            {d}일
          </button>
        ))}
      </div>

      {/* 차트 1: 매출/커미션 시계열 Area */}
      <div className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35]">
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <TrendingUp size={14} className="text-blue-400" /> 매출 · 커미션 추이
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
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="date"
                tick={{ fill: '#8A8F98', fontSize: 10 }}
                stroke="#8A8F98"
                tickFormatter={(v: string) => v.slice(5)}
              />
              <YAxis
                yAxisId="left"
                tick={{ fill: '#8A8F98', fontSize: 10 }}
                stroke="#8A8F98"
                tickFormatter={(v: number) => `₩${(v / 10000).toFixed(0)}만`}
                width={56}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fill: '#8A8F98', fontSize: 10 }}
                stroke="#8A8F98"
                tickFormatter={(v: number) => `₩${(v / 10000).toFixed(0)}만`}
                width={56}
              />
              <Tooltip
                contentStyle={DARK_TOOLTIP_STYLE}
                itemStyle={{ color: '#e5e7eb' }}
                labelStyle={{ color: '#d1d5db' }}
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
      <div className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35]">
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <Eye size={14} className="text-cyan-400" /> 클릭 · 전환 추이
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
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="date"
                tick={{ fill: '#8A8F98', fontSize: 10 }}
                stroke="#8A8F98"
                tickFormatter={(v: string) => v.slice(5)}
              />
              <YAxis
                yAxisId="left"
                tick={{ fill: '#8A8F98', fontSize: 10 }}
                stroke="#8A8F98"
                width={40}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fill: '#8A8F98', fontSize: 10 }}
                stroke="#8A8F98"
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
        <div className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35] min-h-[280px]">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Percent size={14} className="text-yellow-400" /> 캠페인별 매출 기여도 (Top 10)
          </h3>
          {bcLoading ? (
            <ChartLoader />
          ) : top10Campaigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2">
              <BarChart2 size={24} className="text-gray-600" />
              <p className="text-xs text-gray-500">데이터 없음</p>
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
                    className="group w-full text-left bg-[#141516] hover:bg-[#1a1d20] rounded-lg p-2.5 border border-[#2a2d35] hover:border-emerald-500/30 transition-all"
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[10px] font-bold text-gray-500 w-5 shrink-0">{idx + 1}.</span>
                      <span className="text-xs font-medium text-white truncate flex-1" title={c.campaign_name}>
                        {c.campaign_name}
                      </span>
                      <span className="text-[10px] text-emerald-400 font-semibold shrink-0">
                        ₩{fmt(c.revenue)}
                      </span>
                    </div>
                    <div className="relative h-1.5 bg-[#0f1011] rounded-full overflow-hidden">
                      <div
                        className="absolute inset-y-0 left-0 rounded-full transition-all"
                        style={{ width: `${barRatio}%`, backgroundColor: `rgba(16,185,129,${opacity})` }}
                      />
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-500 flex-wrap">
                      <span>전환 <span className="text-cyan-400 font-semibold">{c.conversions}건</span></span>
                      <span>클릭 <span className="text-gray-300">{c.clicks}</span></span>
                      <span>CR <span className="text-yellow-400">{cr}%</span></span>
                      <span className="ml-auto text-gray-600">커미션 ₩{fmt(c.commission)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 차트 4: 캠페인별 전환 + 커미션 더블 BarChart */}
        <div className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35]">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <BarChart2 size={14} className="text-blue-400" /> 캠페인별 전환 · 커미션
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
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="name"
                  tick={{ fill: '#8A8F98', fontSize: 10 }}
                  stroke="#8A8F98"
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fill: '#8A8F98', fontSize: 10 }}
                  stroke="#8A8F98"
                  width={36}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fill: '#8A8F98', fontSize: 10 }}
                  stroke="#8A8F98"
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
        <div className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35]">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Megaphone size={14} className="text-emerald-400" /> 활성 캠페인
          </h3>
          {d.active_campaigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <Megaphone size={20} className="text-gray-600" />
              <p className="text-xs text-gray-500">활성 캠페인이 없습니다</p>
              <p className="text-[10px] text-gray-600">캠페인 관리 탭에서 새 캠페인을 생성하세요</p>
            </div>
          ) : (
            <div className="space-y-3">
              {d.active_campaigns.map(c => (
                <div key={c.id} className="p-3 bg-[#141516] rounded-lg">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                      {c.cafe24_product_image && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.cafe24_product_image} alt={c.cafe24_product_name ?? c.product} className="w-8 h-8 rounded object-cover bg-[#1a1b1e]" />
                      )}
                      <div>
                        <p className="text-sm font-medium text-white">{c.name}</p>
                        <p className="text-[10px] text-gray-500">{c.cafe24_product_name ?? c.product}</p>
                      </div>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded">활성</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div><p className="text-[10px] text-gray-500">파트너</p><p className="text-xs font-medium text-white">{c.partner_count}</p></div>
                    <div><p className="text-[10px] text-gray-500">클릭</p><p className="text-xs font-medium text-white">{fmt(c.click_count)}</p></div>
                    <div><p className="text-[10px] text-gray-500">전환</p><p className="text-xs font-medium text-white">{c.conversion_count}건</p></div>
                    <div><p className="text-[10px] text-gray-500">매출</p><p className="text-xs font-medium text-white">{fmtMan(c.total_sales)}</p></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 상위 파트너 */}
        <div className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35]">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Award size={14} className="text-yellow-400" /> Top 파트너
          </h3>
          {d.top_partners.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <Users size={20} className="text-gray-600" />
              <p className="text-xs text-gray-500">등록된 파트너가 없습니다</p>
              <p className="text-[10px] text-gray-600">파트너 관리 탭에서 파트너를 초대하세요</p>
            </div>
          ) : (
            <div className="space-y-2">
              {d.top_partners.map((p, idx) => (
                <div key={p.id} className="flex items-center gap-3 p-2 bg-[#141516] rounded-lg">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${rankColors[idx] ?? 'bg-gray-500/20 text-gray-400'}`}>
                    {idx + 1}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm text-white font-medium">{p.name}</p>
                    <div className="flex items-center gap-1 flex-wrap">
                      <ChannelBadges channels={p.channels} channel={p.channel} />
                      <span className="text-[10px] text-gray-500">{fmt(p.followers)} followers</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-emerald-400">₩{fmt(p.total_sales)}</p>
                    <p className="text-[10px] text-gray-500">{p.conversion_count}건 전환</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── 취소/환불 현황 ── */}
      <div className="bg-[#1a1b1e] border border-[#2a2d35] rounded-xl p-4">
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <AlertCircle size={14} className="text-red-400" /> 취소 · 환불 현황
        </h3>

        {/* 2-A: KPI 카드 3개 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          {/* 환불 건수 */}
          <div className="bg-[#141516] rounded-lg p-3 border border-red-500/20">
            <p className="text-[10px] text-gray-500 mb-1">환불 건수</p>
            <p className="text-2xl font-bold text-red-400">{d.refunded_count}<span className="text-sm font-normal ml-0.5">건</span></p>
            <p className="text-[10px] text-gray-600 mt-0.5">결제 완료 후 환불 처리</p>
          </div>

          {/* 취소 건수 */}
          <div className="bg-[#141516] rounded-lg p-3 border border-orange-500/20">
            <p className="text-[10px] text-gray-500 mb-1">취소 건수</p>
            <p className="text-2xl font-bold text-orange-400">{d.cancelled_count}<span className="text-sm font-normal ml-0.5">건</span></p>
            <p className="text-[10px] text-gray-600 mt-0.5">결제 전 또는 배송 전 취소</p>
          </div>

          {/* 환불·취소 차액 (Gross - Net) */}
          <div className="bg-[#141516] rounded-lg p-3 border border-[#2a2d35]">
            <p className="text-[10px] text-gray-500 mb-1">환불·취소 차감액</p>
            <p className="text-2xl font-bold text-gray-300">
              {refundCancelDiff > 0 ? `₩${fmt(refundCancelDiff)}` : '₩0'}
            </p>
            <p className="text-[10px] text-gray-600 mt-0.5">Gross - Net 차이</p>
          </div>
        </div>

        {/* 2-B: 매출 구성 요약 바 */}
        {d.gross_sales > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] text-gray-500">매출 구성 비율</p>
            <div className="flex h-4 rounded-full overflow-hidden gap-0.5">
              {/* 순매출 */}
              <div
                className="bg-emerald-500 transition-all"
                style={{ width: `${d.gross_sales > 0 ? (d.net_sales / d.gross_sales) * 100 : 100}%` }}
                title={`순매출: ${formatCurrency(d.net_sales)}`}
              />
              {/* 환불·취소 차감 */}
              {refundCancelDiff > 0 && (
                <div
                  className="bg-red-500/70 transition-all"
                  style={{ width: `${(refundCancelDiff / d.gross_sales) * 100}%` }}
                  title={`차감: ${formatCurrency(refundCancelDiff)}`}
                />
              )}
            </div>
            <div className="flex items-center gap-4 text-[10px]">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" /> 순매출 {fmtMan(d.net_sales)}</span>
              {refundCancelDiff > 0 && (
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500/70 inline-block" /> 환불·취소 차감 {fmtMan(refundCancelDiff)}</span>
              )}
            </div>
          </div>
        )}

        {/* 환불/취소 모두 0인 경우 */}
        {d.refunded_count === 0 && d.cancelled_count === 0 && (
          <div className="flex items-center gap-2 mt-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
            <CheckCircle size={13} className="text-emerald-400 shrink-0" />
            <p className="text-xs text-emerald-400">환불·취소 내역이 없습니다</p>
          </div>
        )}
      </div>

      {/* ── 시간대별 전환 히트맵 ── */}
      <div className="bg-[#1a1b1e] border border-[#2a2d35] rounded-xl p-4">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <BarChart2 size={14} className="text-emerald-400" /> 시간대별 전환 히트맵
          </h3>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-gray-500">기간:</span>
            {([7, 30, 90] as const).map(hd => (
              <button
                key={hd}
                onClick={() => setHeatmapDays(hd)}
                className={`px-2.5 py-1 text-[10px] rounded font-medium transition-colors ${
                  heatmapDays === hd
                    ? 'bg-emerald-600 text-white'
                    : 'bg-[#141516] text-gray-400 border border-[#2a2d35] hover:text-white hover:border-gray-500'
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
                    <div key={h} className="w-5 text-center text-[8px] text-gray-600 shrink-0">
                      {h % 6 === 0 ? `${h}시` : ''}
                    </div>
                  ))}
                </div>

                {/* 히트맵 행 */}
                {HEATMAP_DAYS.map((dayLabel, dow) => (
                  <div key={dow} className="flex items-center mb-0.5">
                    <span className="w-7 text-[10px] text-gray-500 shrink-0 text-right pr-1">{dayLabel}</span>
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
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-20 pointer-events-none whitespace-nowrap bg-[#1E1F22] border border-[rgba(255,255,255,0.1)] rounded-lg px-2 py-1.5 text-[10px] text-white shadow-xl">
                              <p className="font-semibold text-emerald-400">{dayLabel} {h}시</p>
                              <p>전환 <span className="text-white font-medium">{conv}건</span></p>
                              {cell && cell.revenue > 0 && (
                                <p>매출 <span className="text-blue-300 font-medium">₩{fmt(cell.revenue)}</span></p>
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
                  <span className="text-[9px] text-gray-600">낮음</span>
                  <div className="flex gap-0.5">
                    {[0, 0.2, 0.4, 0.6, 0.8, 1].map(r => (
                      <div
                        key={r}
                        className="w-4 h-3 rounded-sm"
                        style={{ backgroundColor: heatColor(r) }}
                      />
                    ))}
                  </div>
                  <span className="text-[9px] text-gray-600">높음</span>
                </div>
              </div>
            </div>

            {/* TOP 3 시간대 요약 */}
            {top3Hours.length > 0 && (
              <div className="mt-4 pt-3 border-t border-[#2a2d35]">
                <p className="text-[10px] text-gray-500 mb-1.5">전환 많은 시간대 TOP {top3Hours.length}</p>
                <div className="flex flex-wrap gap-2">
                  {top3Hours.map((c, i) => (
                    <div
                      key={`${c.day_of_week}_${c.hour}_${i}`}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-lg"
                    >
                      <span className="text-[9px] font-bold text-emerald-300">#{i + 1}</span>
                      <span className="text-[10px] text-white">
                        {HEATMAP_DAYS[c.day_of_week]} {c.hour}시
                      </span>
                      <span className="text-[10px] text-emerald-400 font-medium">({c.conversions}건)</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── 상품별 TOP 10 ── */}
      <div className="bg-[#1a1b1e] border border-[#2a2d35] rounded-xl p-4">
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <TrendingUp size={14} className="text-blue-400" /> 상품별 TOP 10
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
                  className="relative flex items-center gap-3 px-3 py-2.5 bg-[#141516] rounded-lg overflow-hidden"
                >
                  {/* 배경 진행 막대 */}
                  <div
                    className="absolute inset-y-0 left-0 bg-blue-500/8 rounded-lg pointer-events-none"
                    style={{ width: `${barWidth}%` }}
                  />

                  {/* 순위 배지 */}
                  <span
                    className={`relative z-10 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                      idx === 0 ? 'bg-yellow-500/20 text-yellow-400' :
                      idx === 1 ? 'bg-gray-300/20 text-gray-300' :
                      idx === 2 ? 'bg-orange-500/20 text-orange-400' :
                      'bg-[#2a2d35] text-gray-500'
                    }`}
                  >
                    {idx + 1}
                  </span>

                  {/* 상품 이미지 */}
                  <div className="relative z-10 w-9 h-9 shrink-0 rounded overflow-hidden bg-[#2a2d35] flex items-center justify-center">
                    {p.product_image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.product_image}
                        alt={p.product_name}
                        className="w-full h-full object-cover"
                        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <ShoppingBag size={14} className="text-gray-600" />
                    )}
                  </div>

                  {/* 상품명 + 캠페인 수 */}
                  <div className="relative z-10 flex-1 min-w-0">
                    <p className="text-sm text-white font-medium truncate">{p.product_name}</p>
                    <p className="text-[10px] text-gray-500">캠페인 {p.campaign_count}개 연결</p>
                  </div>

                  {/* 수치 (우측 정렬) */}
                  <div className="relative z-10 flex items-center gap-4 shrink-0 text-right">
                    <div>
                      <p className="text-[10px] text-gray-500">전환</p>
                      <p className="text-xs font-medium text-white">{fmt(p.conversions)}건</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-500">매출</p>
                      <p className="text-xs font-medium text-blue-400">{fmtMan(p.revenue)}</p>
                    </div>
                    <div className="hidden sm:block">
                      <p className="text-[10px] text-gray-500">커미션</p>
                      <p className="text-xs font-medium text-emerald-400">{fmtMan(p.commission)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Campaigns section ────────────────────────────────────────────────────────

function CampaignsSection() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState<number | null>(null);
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
      setForm({ name: '', product: '', commission_type: 'percentage', commission_rate: 10, start_date: '', end_date: '', cafe24_product_no: undefined, cafe24_product_name: undefined, discount_type: 'percentage', discount_value: 0 });
    },
    onError: () => toast.error('캠페인 생성에 실패했습니다'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => affiliateApi.deleteCampaign(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['affiliate', 'campaigns'] });
      qc.invalidateQueries({ queryKey: ['affiliate', 'dashboard'] });
      toast.success('캠페인이 삭제되었습니다');
    },
    onError: () => toast.error('캠페인 삭제에 실패했습니다'),
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
      setForm({ name: '', product: '', commission_type: 'percentage', commission_rate: 10, start_date: '', end_date: '', cafe24_product_no: undefined, cafe24_product_name: undefined, discount_type: 'percentage', discount_value: 0 });
    },
    onError: () => toast.error('캠페인 수정에 실패했습니다'),
  });

  const handleCreate = () => {
    if (!form.name.trim()) { toast.error('캠페인명을 입력하세요'); return; }
    if (!form.start_date) { toast.error('시작일을 입력하세요'); return; }
    createMutation.mutate({
      ...form,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
    });
  };

  const handleStartEdit = (c: AffiliateCampaign) => {
    setEditingCampaignId(c.id);
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
    });
    setShowForm(true);
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
    setForm({ name: '', product: '', commission_type: 'percentage', commission_rate: 10, start_date: '', end_date: '', cafe24_product_no: undefined, cafe24_product_name: undefined, discount_type: 'percentage', discount_value: 0 });
  };

  const handleToggleStatus = (c: AffiliateCampaign) => {
    const newStatus = c.status === 'active' ? 'paused' : 'active';
    updateMutation.mutate({ id: c.id, data: { status: newStatus } });
  };

  if (isLoading) return <SectionLoader />;

  const isCafe24Connected = cafe24Status?.connected ?? false;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold text-white">어필리에이트 캠페인</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg transition-colors"
        >
          <Plus size={14} /> 새 캠페인
        </button>
      </div>

      {isError && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-lg">
          <AlertCircle size={14} className="text-red-400" />
          <p className="text-xs text-red-400">캠페인 목록을 불러오지 못했습니다</p>
        </div>
      )}

      {showForm && (
        <div className="bg-[#1a1b1e] rounded-xl p-4 border border-emerald-500/30 space-y-4">
          <h3 className="text-sm font-semibold text-white">
            {editingCampaignId !== null ? '캠페인 수정' : '새 캠페인 만들기'}
          </h3>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400">캠페인명 *</label>
              <input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="예: 여름 신상 프로모션"
                className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">대상 상품 (직접 입력)</label>
              <input
                value={form.product}
                onChange={e => setForm({ ...form, product: e.target.value })}
                placeholder="예: 저당 디저트 세트"
                className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-emerald-500/50"
              />
            </div>
          </div>

          {/* Cafe24 상품 셀렉터 — 편집 모드에서는 쿠폰이 이미 발급됐으므로 수정 불가 */}
          <div className="border border-[#2a2d35] rounded-xl p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Store size={13} className={isCafe24Connected ? 'text-emerald-400' : 'text-gray-600'} />
              <span className="text-xs font-medium text-gray-300">Cafe24 상품 연결</span>
              {!isCafe24Connected && <span className="text-[10px] text-amber-400/70">(연결 필요)</span>}
              {editingCampaignId !== null && (
                <span className="text-[10px] px-1.5 py-0.5 bg-gray-500/20 text-gray-400 rounded ml-auto">수정 불가 (쿠폰 발급 완료)</span>
              )}
            </div>
            {editingCampaignId !== null ? (
              <div className="px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-xs text-gray-500">
                {form.cafe24_product_name ? `연결됨: ${form.cafe24_product_name}` : '연결된 Cafe24 상품 없음'}
              </div>
            ) : (
              <Cafe24ProductSelector
                selectedNo={form.cafe24_product_no}
                selectedName={form.cafe24_product_name}
                disabled={!isCafe24Connected}
                onSelect={(no, name) => setForm({ ...form, cafe24_product_no: no, cafe24_product_name: name, product: name })}
                onClear={() => setForm({ ...form, cafe24_product_no: undefined, cafe24_product_name: undefined })}
              />
            )}
          </div>

          {/* 할인 설정 */}
          <div className="border border-[#2a2d35] rounded-xl p-3 space-y-2">
            <span className="text-xs font-medium text-gray-300 flex items-center gap-1.5">
              <Tag size={12} /> 쿠폰 할인 설정
              {editingCampaignId !== null && (
                <span className="text-[10px] px-1.5 py-0.5 bg-gray-500/20 text-gray-400 rounded ml-auto">수정 불가 (쿠폰 발급 완료)</span>
              )}
            </span>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400">할인 유형</label>
                <select
                  value={form.discount_type ?? 'percentage'}
                  onChange={e => setForm({ ...form, discount_type: e.target.value as 'percentage' | 'fixed' | 'shipping' })}
                  disabled={editingCampaignId !== null}
                  className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="percentage">비율 할인 (%)</option>
                  <option value="fixed">금액 할인 (₩)</option>
                  <option value="shipping">배송비 할인</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400">
                  {form.discount_type === 'percentage' ? '할인율 (%)' : form.discount_type === 'fixed' ? '할인 금액 (₩)' : '할인 금액 (₩, 배송비)'}
                </label>
                <input
                  type="number"
                  value={form.discount_value ?? 0}
                  onChange={e => setForm({ ...form, discount_value: Number(e.target.value) })}
                  readOnly={editingCampaignId !== null}
                  className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50 read-only:opacity-50 read-only:cursor-not-allowed"
                />
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400">커미션 유형</label>
              <select
                value={form.commission_type}
                onChange={e => setForm({ ...form, commission_type: e.target.value as 'percentage' | 'fixed' })}
                className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50"
              >
                <option value="percentage">매출 비율 (%)</option>
                <option value="fixed">건당 고정 금액 (₩)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400">
                {form.commission_type === 'percentage' ? '커미션 비율 (%)' : '건당 금액 (₩)'}
              </label>
              <input
                type="number"
                value={form.commission_rate}
                onChange={e => setForm({ ...form, commission_rate: Number(e.target.value) })}
                className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">시작일 *</label>
              <input
                type="date"
                value={form.start_date}
                onChange={e => setForm({ ...form, start_date: e.target.value })}
                className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">종료일 (선택)</label>
              <input
                type="date"
                value={form.end_date}
                onChange={e => setForm({ ...form, end_date: e.target.value })}
                className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={handleCancelForm}
              className="px-3 py-1.5 text-xs text-gray-400 border border-[#2a2d35] rounded-lg hover:text-white hover:border-gray-500 transition-colors"
            >
              취소
            </button>
            {editingCampaignId !== null ? (
              <button
                onClick={handleSaveEdit}
                disabled={editSaveMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
              >
                {editSaveMutation.isPending && <Loader2 size={12} className="animate-spin" />}
                변경사항 저장
              </button>
            ) : (
              <button
                onClick={handleCreate}
                disabled={createMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
              >
                {createMutation.isPending && <Loader2 size={12} className="animate-spin" />}
                캠페인 생성
              </button>
            )}
          </div>
        </div>
      )}

      {campaigns.length === 0 && !isError ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 bg-[#1a1b1e] rounded-xl border border-[#2a2d35]">
          <Megaphone size={28} className="text-gray-600" />
          <p className="text-sm text-gray-400">아직 생성된 캠페인이 없습니다</p>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg transition-colors"
          >
            <Plus size={14} /> 첫 캠페인 만들기
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map(c => (
            <div key={c.id} className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35]">
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-3">
                  {c.cafe24_product_image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.cafe24_product_image} alt={c.cafe24_product_name ?? c.product} className="w-12 h-12 rounded-lg object-cover bg-[#141516] shrink-0" />
                  )}
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-white">{c.name}</h3>
                      <span className={`text-[10px] px-2 py-0.5 rounded ${campaignStatusBadge(c.status)}`}>
                        {campaignStatusLabel(c.status)}
                      </span>
                      {c.cafe24_coupon_code && (
                        <span className="text-[10px] px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded flex items-center gap-1">
                          <Tag size={9} /> {c.cafe24_coupon_code}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {c.cafe24_product_name ?? c.product} · {c.commission_type === 'percentage' ? `${c.commission_rate}%` : `₩${fmt(c.commission_rate)}/건`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-xs text-gray-500 hidden md:block">{c.start_date} ~ {c.end_date ?? '진행중'}</p>
                  <button
                    onClick={() => handleToggleStatus(c)}
                    disabled={updateMutation.isPending}
                    className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                      c.status === 'active'
                        ? 'border border-yellow-400/30 text-yellow-400 hover:bg-yellow-400/10'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    }`}
                  >
                    {c.status === 'active' ? '일시정지' : '재개'}
                  </button>
                  <button
                    onClick={() => handleStartEdit(c)}
                    className="p-1 text-gray-500 hover:text-blue-400 transition-colors"
                    title="캠페인 수정"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate(c.id)}
                    disabled={deleteMutation.isPending}
                    className="p-1 text-gray-500 hover:text-red-400 transition-colors"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-5 gap-3 text-center bg-[#141516] rounded-lg p-3">
                <div><p className="text-[10px] text-gray-500">파트너</p><p className="text-sm font-bold text-white">{c.partner_count}명</p></div>
                <div><p className="text-[10px] text-gray-500">클릭</p><p className="text-sm font-bold text-white">{fmt(c.click_count)}</p></div>
                <div><p className="text-[10px] text-gray-500">전환</p><p className="text-sm font-bold text-cyan-400">{c.conversion_count}건</p></div>
                <div><p className="text-[10px] text-gray-500">매출</p><p className="text-sm font-bold text-emerald-400">₩{fmt(c.total_sales)}</p></div>
                <div><p className="text-[10px] text-gray-500">커미션</p><p className="text-sm font-bold text-yellow-400">₩{fmt(c.total_commission)}</p></div>
              </div>
              {c.referral_link && (
                <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg">
                  <Link2 size={12} className="text-blue-400 shrink-0" />
                  <input
                    readOnly
                    value={c.referral_link}
                    className="flex-1 bg-transparent text-xs text-gray-300 truncate focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => { navigator.clipboard.writeText(c.referral_link!); toast.success('링크가 복사되었습니다'); }}
                    className="shrink-0 px-2 py-1 bg-[#3B82F6] hover:bg-[#2563EB] rounded text-[10px] text-white transition-colors flex items-center gap-1"
                  >
                    <Copy size={10} /> 복사
                  </button>
                </div>
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

function PartnerDetailModal({ partner, campaigns, onClose }: PartnerDetailModalProps) {
  const qc = useQueryClient();
  const [selectedCampaignId, setSelectedCampaignId] = useState<number>(0);

  const { data: performance = [], isLoading: perfLoading } = useQuery<PartnerPerformanceRow[]>({
    queryKey: ['affiliate', 'partner-performance', partner.id],
    queryFn: () => affiliateApi.getPartnerPerformance(partner.id),
    retry: 1,
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
        className="w-full max-w-2xl bg-[#1a1b1e] rounded-2xl border border-[#2a2d35] shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between p-5 border-b border-[#2a2d35]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center text-white font-bold text-sm shrink-0">
              {partner.name[0]}
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">{partner.name}</h2>
              <div className="flex items-center gap-1.5 flex-wrap">
                <ChannelBadges channels={partner.channels} channel={partner.channel} />
                <span className="text-xs text-gray-500">{partner.email}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* 퍼포먼스 테이블 */}
          <div>
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <BarChart2 size={14} className="text-cyan-400" /> 캠페인별 성과
            </h3>
            {perfLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={20} className="text-emerald-400 animate-spin" />
              </div>
            ) : performance.length === 0 ? (
              <p className="text-xs text-gray-500 text-center py-6">참여 중인 캠페인이 없습니다</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-[#2a2d35]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-[#141516] text-gray-500 border-b border-[#2a2d35]">
                      <th className="text-left py-2.5 px-3">캠페인명</th>
                      <th className="text-left py-2.5 px-3">전용 링크</th>
                      <th className="text-right py-2.5 px-3">클릭</th>
                      <th className="text-right py-2.5 px-3">전환</th>
                      <th className="text-right py-2.5 px-3">매출</th>
                      <th className="text-right py-2.5 px-3">커미션</th>
                      <th className="py-2.5 px-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {performance.map(row => (
                      <tr key={row.pc_id} className="border-b border-[#2a2d35]/50 text-gray-300 hover:bg-white/[0.02]">
                        <td className="py-2.5 px-3 font-medium text-white">{row.campaign_name}</td>
                        <td className="py-2.5 px-3">
                          {row.referral_link ? (
                            <div className="flex items-center gap-1.5 max-w-[280px]">
                              <input
                                readOnly
                                value={row.referral_link}
                                className="flex-1 bg-[#141516] border border-[#2a2d35] px-2 py-1 rounded text-[10px] text-gray-300 truncate focus:outline-none"
                              />
                              <button
                                onClick={() => { navigator.clipboard.writeText(row.referral_link!); toast.success('링크 복사됨'); }}
                                className="shrink-0 p-1 bg-[#3B82F6] hover:bg-[#2563EB] rounded text-white"
                                title="복사"
                              >
                                <Copy size={10} />
                              </button>
                            </div>
                          ) : (
                            <span className="text-[10px] text-gray-600">(미생성)</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right">{fmt(row.clicks)}</td>
                        <td className="py-2.5 px-3 text-right text-cyan-400">{fmt(row.conversions)}</td>
                        <td className="py-2.5 px-3 text-right text-emerald-400">₩{fmt(row.sales)}</td>
                        <td className="py-2.5 px-3 text-right text-yellow-400">₩{fmt(row.commission)}</td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            onClick={() => {
                              if (window.confirm(`"${row.campaign_name}" 캠페인을 이 파트너에서 제거할까요?`)) {
                                removeCampaignMutation.mutate(row.pc_id);
                              }
                            }}
                            disabled={removeCampaignMutation.isPending}
                            className="p-1 text-gray-500 hover:text-red-400 transition-colors disabled:opacity-50"
                            title="제거"
                          >
                            <Trash2 size={11} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {/* 합계 행 */}
                    <tr className="bg-[#141516] font-semibold text-white text-xs">
                      <td className="py-2.5 px-3">합계</td>
                      <td />
                      <td className="py-2.5 px-3 text-right">{fmt(totals.clicks)}</td>
                      <td className="py-2.5 px-3 text-right text-cyan-400">{fmt(totals.conversions)}</td>
                      <td className="py-2.5 px-3 text-right text-emerald-400">₩{fmt(totals.sales)}</td>
                      <td className="py-2.5 px-3 text-right text-yellow-400">₩{fmt(totals.commission)}</td>
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
                className="flex-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50"
              >
                <option value={0}>캠페인 선택...</option>
                {availableCampaigns.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button
                onClick={() => { if (selectedCampaignId) addCampaignMutation.mutate(selectedCampaignId); }}
                disabled={!selectedCampaignId || addCampaignMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-2 text-xs bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
              >
                {addCampaignMutation.isPending && <Loader2 size={11} className="animate-spin" />}
                <Plus size={12} /> 캠페인 추가
              </button>
            </div>
          )}
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
    if (!editForm.email.trim()) { toast.error('이메일을 입력하세요'); return; }
    if (editForm.channels.length === 0) { toast.error('채널을 최소 1개 선택하세요'); return; }
    onSave(partner.id, {
      name: editForm.name,
      email: editForm.email,
      phone: editForm.phone || null,
      channels: editForm.channels,
      channel: editForm.channels[0],
      followers: editForm.followers,
      memo: editForm.memo,
      status: editForm.status,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-[#1a1b1e] rounded-2xl border border-[#2a2d35] shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-[#2a2d35]">
          <div className="flex items-center gap-2">
            <Pencil size={15} className="text-blue-400" />
            <h2 className="text-sm font-semibold text-white">파트너 수정</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400">파트너명 *</label>
              <input
                value={editForm.name}
                onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-blue-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">이메일 *</label>
              <input
                type="email"
                value={editForm.email}
                onChange={e => setEditForm({ ...editForm, email: e.target.value })}
                className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-blue-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">연락처</label>
              <input
                type="tel"
                value={editForm.phone}
                onChange={e => setEditForm({ ...editForm, phone: e.target.value })}
                placeholder="010-1234-5678"
                className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-blue-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">팔로워 수</label>
              <input
                type="number"
                value={editForm.followers}
                onChange={e => setEditForm({ ...editForm, followers: Number(e.target.value) })}
                className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">상태</label>
              <select
                value={editForm.status}
                onChange={e => setEditForm({ ...editForm, status: e.target.value as AffiliatePartner['status'] })}
                className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50"
              >
                <option value="pending">대기</option>
                <option value="approved">승인</option>
                <option value="rejected">거절</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-400 flex items-center gap-1.5">
              채널 *
              {editForm.channels.length > 0 && (
                <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded text-[10px]">
                  {editForm.channels.length}개 선택됨
                </span>
              )}
            </label>
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {CHANNEL_OPTIONS.map(opt => {
                const checked = editForm.channels.includes(opt.key);
                return (
                  <label
                    key={opt.key}
                    className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg border cursor-pointer transition-all text-xs select-none ${
                      checked
                        ? `${opt.color} border-opacity-60`
                        : 'border-[#2a2d35] text-gray-500 hover:border-gray-500 hover:text-gray-300'
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
            <label className="text-xs text-gray-400">메모</label>
            <input
              value={editForm.memo}
              onChange={e => setEditForm({ ...editForm, memo: e.target.value })}
              placeholder="내부 메모 (선택)"
              className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-blue-500/50"
            />
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-gray-400 border border-[#2a2d35] rounded-lg hover:text-white hover:border-gray-500 transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
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
  });
  const [selectedPartner, setSelectedPartner] = useState<AffiliatePartner | null>(null);
  const [editingPartner, setEditingPartner] = useState<AffiliatePartner | null>(null);
  const [showTrash, setShowTrash] = useState(false);

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
      setInviteForm({ name: '', email: '', phone: '', channel: 'instagram', channels: [], followers: 0, campaign_ids: [], memo: '' });
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
    if (!inviteForm.email.trim()) { toast.error('이메일을 입력하세요'); return; }
    if (inviteForm.channels.length === 0) { toast.error('채널을 최소 1개 선택하세요'); return; }
    // 하위 호환: channel 필드에 첫 번째 선택값 세팅
    createMutation.mutate({
      ...inviteForm,
      channel: inviteForm.channels[0],
      ...(inviteForm.phone ? { phone: inviteForm.phone } : {}),
    });
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
          <h2 className="text-lg font-bold text-white">파트너 관리</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowTrash(!showTrash)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors border ${
                showTrash
                  ? 'bg-red-500/10 border-red-500/30 text-red-400'
                  : 'border-[#2a2d35] text-gray-400 hover:text-white hover:border-gray-500'
              }`}
            >
              <Trash2 size={13} /> {showTrash ? '활성 파트너' : `휴지통${trashedPartners.length > 0 ? ` (${trashedPartners.length})` : ''}`}
            </button>
            {!showTrash && (
              <button
                onClick={() => setShowInviteForm(!showInviteForm)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg transition-colors"
              >
                <UserPlus size={14} /> 파트너 초대
              </button>
            )}
          </div>
        </div>

        {showTrash && (
          <div className="bg-[#1a1b1e] rounded-xl border border-red-500/20 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Trash2 size={14} className="text-red-400" />
              <h3 className="text-sm font-semibold text-white">휴지통</h3>
              <span className="text-xs text-gray-500">({trashedPartners.length}명)</span>
            </div>
            {trashedPartners.length === 0 ? (
              <p className="text-xs text-gray-500 py-4 text-center">휴지통이 비어있습니다.</p>
            ) : (
              <div className="space-y-2">
                {trashedPartners.map(p => (
                  <div key={p.id} className="flex items-center justify-between bg-[#141516] border border-[#2a2d35] rounded-lg px-3 py-2.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">{p.name}</p>
                        <p className="text-[10px] text-gray-500">{p.email || '이메일 없음'} · 원상태: {partnerStatusLabel(p.status)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => restorePartnerMutation.mutate(p.id)}
                        disabled={restorePartnerMutation.isPending}
                        className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded transition-colors"
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
                        className="px-2.5 py-1 text-[11px] border border-red-400/40 text-red-400 hover:bg-red-400/10 disabled:opacity-50 rounded transition-colors"
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
          <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-lg">
            <AlertCircle size={14} className="text-red-400" />
            <p className="text-xs text-red-400">파트너 목록을 불러오지 못했습니다</p>
          </div>
        )}

        {showInviteForm && (
          <div className="bg-[#1a1b1e] rounded-xl p-4 border border-emerald-500/30 space-y-4">
            <h3 className="text-sm font-semibold text-white">파트너 초대하기</h3>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400">파트너명 *</label>
                <input
                  value={inviteForm.name}
                  onChange={e => setInviteForm({ ...inviteForm, name: e.target.value })}
                  placeholder="예: 달콤리뷰"
                  className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-emerald-500/50"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">이메일 *</label>
                <input
                  type="email"
                  value={inviteForm.email}
                  onChange={e => setInviteForm({ ...inviteForm, email: e.target.value })}
                  placeholder="partner@example.com"
                  className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-emerald-500/50"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">연락처</label>
                <input
                  type="tel"
                  value={inviteForm.phone}
                  onChange={e => setInviteForm({ ...inviteForm, phone: e.target.value })}
                  placeholder="010-1234-5678"
                  className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-emerald-500/50"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-400 flex items-center gap-1.5">
                  채널 *
                  {inviteForm.channels.length > 0 && (
                    <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded text-[10px]">
                      {inviteForm.channels.length}개 선택됨
                    </span>
                  )}
                </label>
                <div className="mt-2 grid grid-cols-4 gap-1.5">
                  {CHANNEL_OPTIONS.map(opt => {
                    const checked = inviteForm.channels.includes(opt.key);
                    return (
                      <label
                        key={opt.key}
                        className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg border cursor-pointer transition-all text-xs select-none ${
                          checked
                            ? `${opt.color} border-opacity-60`
                            : 'border-[#2a2d35] text-gray-500 hover:border-gray-500 hover:text-gray-300'
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
                <label className="text-xs text-gray-400">팔로워 수</label>
                <input
                  type="number"
                  value={inviteForm.followers}
                  onChange={e => setInviteForm({ ...inviteForm, followers: Number(e.target.value) })}
                  className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-400">메모</label>
                <input
                  value={inviteForm.memo}
                  onChange={e => setInviteForm({ ...inviteForm, memo: e.target.value })}
                  placeholder="내부 메모 (선택)"
                  className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-emerald-500/50"
                />
              </div>
            </div>

            {/* 참여 캠페인 멀티셀렉트 */}
            {activeCampaigns.length > 0 && (
              <div className="border border-[#2a2d35] rounded-xl p-3 space-y-2">
                <p className="text-xs font-medium text-gray-300 flex items-center gap-1.5">
                  <Megaphone size={12} /> 참여 캠페인 선택
                  {inviteForm.campaign_ids.length > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded text-[10px]">
                      {inviteForm.campaign_ids.length}개 선택
                    </span>
                  )}
                </p>
                <div className="grid md:grid-cols-2 gap-1.5 max-h-36 overflow-y-auto">
                  {activeCampaigns.map(c => (
                    <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={inviteForm.campaign_ids.includes(c.id)}
                        onChange={() => toggleCampaign(c.id)}
                        className="w-3.5 h-3.5 rounded accent-emerald-500"
                      />
                      <span className="text-xs text-gray-300 truncate">{c.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowInviteForm(false)}
                className="px-3 py-1.5 text-xs text-gray-400 border border-[#2a2d35] rounded-lg hover:text-white hover:border-gray-500 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleInvite}
                disabled={createMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
              >
                {createMutation.isPending && <Loader2 size={12} className="animate-spin" />}
                초대 보내기
              </button>
            </div>
          </div>
        )}

        {partners.length === 0 && !isError ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 bg-[#1a1b1e] rounded-xl border border-[#2a2d35]">
            <Users size={28} className="text-gray-600" />
            <p className="text-sm text-gray-400">아직 등록된 파트너가 없습니다</p>
            <button
              onClick={() => setShowInviteForm(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg transition-colors"
            >
              <UserPlus size={14} /> 첫 파트너 초대하기
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {partners.map(p => (
              <div
                key={p.id}
                className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35] cursor-pointer hover:border-emerald-500/30 transition-colors"
                onClick={() => setSelectedPartner(p)}
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center text-white font-bold text-sm shrink-0">
                      {p.name[0]}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-white">{p.name}</p>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${partnerStatusBadge(p.status)}`}>
                          {partnerStatusLabel(p.status)}
                        </span>
                        {Array.isArray(p.campaign_ids) && p.campaign_ids.length > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded">
                            참여 캠페인 {p.campaign_ids.length}개
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                        <ChannelBadges channels={p.channels} channel={p.channel} />
                        <span className="text-[10px] text-gray-500">{fmt(p.followers)} followers · {p.email}</span>
                        {p.phone && (
                          <span className="flex items-center gap-0.5 text-[10px] text-gray-500">
                            <Phone size={9} className="text-gray-600" />
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
                          className="flex items-center gap-1 px-2 py-1 text-[10px] bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium rounded transition-colors"
                        >
                          {approveMutation.isPending && <Loader2 size={10} className="animate-spin" />}
                          승인
                        </button>
                        <button
                          onClick={() => rejectMutation.mutate(p.id)}
                          disabled={rejectMutation.isPending}
                          className="px-2 py-1 text-[10px] border border-red-400/30 text-red-400 hover:bg-red-400/10 disabled:opacity-50 rounded transition-colors"
                        >
                          거절
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => setEditingPartner(p)}
                      className="p-1 text-gray-500 hover:text-blue-400 transition-colors"
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
                      className="p-1 text-gray-500 hover:text-red-400 transition-colors disabled:opacity-50"
                      title="파트너 삭제 (휴지통으로 이동)"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                {p.status === 'approved' && (
                  <>
                    <div className="grid grid-cols-5 gap-3 text-center bg-[#141516] rounded-lg p-3 mb-2">
                      <div><p className="text-[10px] text-gray-500">클릭</p><p className="text-sm font-bold text-white">{fmt(p.click_count)}</p></div>
                      <div><p className="text-[10px] text-gray-500">전환</p><p className="text-sm font-bold text-cyan-400">{p.conversion_count}건</p></div>
                      <div><p className="text-[10px] text-gray-500">매출</p><p className="text-sm font-bold text-emerald-400">₩{fmt(p.total_sales)}</p></div>
                      <div><p className="text-[10px] text-gray-500">총 커미션</p><p className="text-sm font-bold text-yellow-400">₩{fmt(p.total_commission)}</p></div>
                      <div><p className="text-[10px] text-gray-500">미정산</p><p className="text-sm font-bold text-red-400">₩{fmt(p.unpaid_commission)}</p></div>
                    </div>
                    {p.campaign_links && p.campaign_links.length > 0 ? (
                      <div
                        className="space-y-1.5"
                        onClick={e => e.stopPropagation()}
                      >
                        {p.campaign_links.map((cl) => (
                          <div key={cl.pc_id} className="flex items-center gap-2 bg-[#141516] rounded-lg px-3 py-2">
                            <Link2 size={12} className="text-gray-500 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] text-gray-500 truncate">{cl.campaign_name || `캠페인 #${cl.campaign_id}`}</p>
                              <code className="text-[10px] text-gray-400 truncate block">{cl.referral_link}</code>
                            </div>
                            <button onClick={() => copyLink(cl.referral_link)} className="text-gray-400 hover:text-white transition-colors shrink-0" title="복사">
                              <Copy size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : p.referral_link ? (
                      <div
                        className="flex items-center gap-2 bg-[#141516] rounded-lg px-3 py-2"
                        onClick={e => e.stopPropagation()}
                      >
                        <Link2 size={12} className="text-gray-500 shrink-0" />
                        <code className="text-[10px] text-gray-400 flex-1 truncate">{p.referral_link}</code>
                        <button onClick={() => copyLink(p.referral_link)} className="text-gray-400 hover:text-white transition-colors">
                          <Copy size={12} />
                        </button>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
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
        <h2 className="text-lg font-bold text-white">친구추천 프로그램</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg transition-colors"
        >
          <Plus size={14} /> 프로그램 추가
        </button>
      </div>

      {isError && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-lg">
          <AlertCircle size={14} className="text-red-400" />
          <p className="text-xs text-red-400">프로그램 목록을 불러오지 못했습니다</p>
        </div>
      )}

      {showForm && (
        <div className="bg-[#1a1b1e] rounded-xl p-4 border border-emerald-500/30 space-y-3">
          <h3 className="text-sm font-semibold text-white">새 추천 프로그램 만들기</h3>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <label className="text-xs text-gray-400">프로그램명 *</label>
              <input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="예: 친구 추천 프로그램"
                className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">보상 유형</label>
              <select
                value={form.reward_type}
                onChange={e => setForm({ ...form, reward_type: e.target.value as 'points' | 'coupon' | 'cash' })}
                className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50"
              >
                <option value="points">포인트</option>
                <option value="coupon">쿠폰</option>
                <option value="cash">현금</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400">추천인 보상</label>
              <input
                type="number"
                value={form.referrer_reward}
                onChange={e => setForm({ ...form, referrer_reward: Number(e.target.value) })}
                className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">피추천인 보상</label>
              <input
                type="number"
                value={form.referee_reward}
                onChange={e => setForm({ ...form, referee_reward: Number(e.target.value) })}
                className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowForm(false)}
              className="px-3 py-1.5 text-xs text-gray-400 border border-[#2a2d35] rounded-lg hover:text-white hover:border-gray-500 transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleCreate}
              disabled={createMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
            >
              {createMutation.isPending && <Loader2 size={12} className="animate-spin" />}
              프로그램 생성
            </button>
          </div>
        </div>
      )}

      {programs.length === 0 && !isError ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 bg-[#1a1b1e] rounded-xl border border-[#2a2d35]">
          <Gift size={28} className="text-gray-600" />
          <p className="text-sm text-gray-400">아직 추천 프로그램이 없습니다</p>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg transition-colors"
          >
            <Plus size={14} /> 첫 프로그램 만들기
          </button>
        </div>
      ) : (
        programs.map(prog => (
          <div key={prog.id} className="bg-[#1a1b1e] rounded-xl p-5 border border-[#2a2d35]">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="text-sm font-semibold text-white">{prog.name}</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  보상: {prog.reward_type === 'points' ? '포인트' : prog.reward_type === 'coupon' ? '쿠폰' : '현금'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-1 rounded ${prog.status === 'active' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-gray-400'}`}>
                  {prog.status === 'active' ? '운영중' : '일시정지'}
                </span>
                <button
                  onClick={() => toggleMutation.mutate({ id: prog.id, status: prog.status === 'active' ? 'paused' : 'active' })}
                  disabled={toggleMutation.isPending}
                  className="text-[10px] px-2 py-1 border border-[#2a2d35] text-gray-400 hover:text-white hover:border-gray-500 rounded transition-colors disabled:opacity-50"
                >
                  {prog.status === 'active' ? '중지' : '재개'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="bg-[#141516] rounded-lg p-3 text-center">
                <p className="text-[10px] text-gray-500">추천인 보상</p>
                <p className="text-lg font-bold text-emerald-400">{fmt(prog.referrer_reward)}{prog.reward_type === 'points' ? 'P' : prog.reward_type === 'cash' ? '원' : ''}</p>
              </div>
              <div className="bg-[#141516] rounded-lg p-3 text-center">
                <p className="text-[10px] text-gray-500">피추천인 보상</p>
                <p className="text-lg font-bold text-cyan-400">{fmt(prog.referee_reward)}{prog.reward_type === 'points' ? 'P' : prog.reward_type === 'cash' ? '원' : ''}</p>
              </div>
              <div className="bg-[#141516] rounded-lg p-3 text-center">
                <p className="text-[10px] text-gray-500">총 추천</p>
                <p className="text-lg font-bold text-white">{prog.total_referrals}</p>
              </div>
              <div className="bg-[#141516] rounded-lg p-3 text-center">
                <p className="text-[10px] text-gray-500">가입 전환율</p>
                <p className="text-lg font-bold text-yellow-400">{fmtPct(prog.conversion_rate)}%</p>
              </div>
            </div>

            {prog.total_referrals > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-gray-400">전환 퍼널</p>
                {[
                  { label: '추천 링크 공유', value: prog.total_referrals, color: '#93c5fd' },
                  { label: '링크 클릭', value: Math.round(prog.total_referrals * 0.8), color: '#60a5fa' },
                  { label: '가입 완료', value: prog.total_signups, color: '#34d399' },
                ].map((step, idx) => (
                  <div key={idx} className="flex items-center gap-3">
                    <span className="text-[10px] text-gray-500 w-20 shrink-0">{step.label}</span>
                    <div className="flex-1 h-6 bg-[#141516] rounded overflow-hidden relative">
                      <div
                        className="h-full rounded"
                        style={{ width: `${(step.value / prog.total_referrals) * 100}%`, backgroundColor: step.color }}
                      />
                      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-white">
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
      <h2 className="text-lg font-bold text-white">내 포인트</h2>

      <div className="grid md:grid-cols-2 gap-4">
        {/* 포인트 잔액 카드 */}
        <div className="bg-[#1a1b1e] rounded-xl p-5 border border-[#2a2d35] flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 rounded-full bg-yellow-500/10 flex items-center justify-center mb-3">
            <Coins size={22} className="text-yellow-400" />
          </div>
          {pointsLoading ? (
            <Loader2 size={20} className="text-emerald-400 animate-spin" />
          ) : pointsError ? (
            <p className="text-xs text-red-400">잔액을 불러오지 못했습니다</p>
          ) : (
            <>
              <p className="text-[10px] text-gray-500 mb-1">보유 포인트</p>
              <p className="text-4xl font-bold text-yellow-400">{fmt(pointsData?.balance ?? 0)}</p>
              <p className="text-sm text-gray-500 mt-1">P</p>
            </>
          )}
        </div>

        {/* 내 추천 링크 카드 */}
        <div className="bg-[#1a1b1e] rounded-xl p-5 border border-[#2a2d35] space-y-3">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Share2 size={14} className="text-emerald-400" /> 내 추천 링크
          </h3>
          {referralLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 size={18} className="text-emerald-400 animate-spin" />
            </div>
          ) : referralError || !referralData ? (
            <p className="text-xs text-gray-500">추천 코드를 불러오지 못했습니다</p>
          ) : (
            <>
              <div className="flex items-center gap-2 bg-[#141516] rounded-lg px-3 py-2">
                <span className="text-xs text-gray-400 font-mono">코드: </span>
                <span className="text-xs text-emerald-300 font-mono font-medium flex-1">{referralData.referral_code}</span>
              </div>
              <div className="flex items-center gap-2 bg-[#141516] rounded-lg px-3 py-2">
                <Link2 size={12} className="text-gray-500 shrink-0" />
                <code className="text-[10px] text-gray-400 flex-1 truncate">{referralData.signup_link}</code>
                <button
                  onClick={() => copyLink(referralData.signup_link)}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white rounded transition-colors"
                >
                  <Copy size={10} /> 복사
                </button>
              </div>
              <p className="text-[10px] text-gray-600">친구가 이 링크로 가입하면 두 분 모두 포인트가 지급됩니다</p>
            </>
          )}
        </div>
      </div>

      {/* 거래 내역 */}
      <div className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35]">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <TrendingUp size={14} className="text-cyan-400" /> 포인트 거래 내역
        </h3>
        {pointsLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={18} className="text-emerald-400 animate-spin" />
          </div>
        ) : transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2">
            <Coins size={24} className="text-gray-600" />
            <p className="text-xs text-gray-500">거래 내역이 없습니다</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-[#2a2d35]">
                  <th className="text-left py-2 px-2">날짜</th>
                  <th className="text-left py-2 px-2">사유</th>
                  <th className="text-right py-2 px-2">금액</th>
                  <th className="text-left py-2 px-2">메모</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map(tx => (
                  <tr key={tx.id} className="border-b border-[#2a2d35]/50 text-gray-300">
                    <td className="py-2.5 px-2 text-gray-500 whitespace-nowrap">{tx.created_at?.slice(0, 10)}</td>
                    <td className="py-2.5 px-2 text-white">{reasonLabel(tx.reason)}</td>
                    <td className={`py-2.5 px-2 text-right font-medium ${tx.amount >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {tx.amount >= 0 ? '+' : ''}{fmt(tx.amount)}P
                    </td>
                    <td className="py-2.5 px-2 text-gray-500 truncate max-w-[160px]">{tx.memo ?? '-'}</td>
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

  const createSettlementMutation = useMutation({
    mutationFn: (partnerId: number) => affiliateApi.createSettlement({ partner_id: partnerId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['affiliate', 'settlements'] });
      toast.success('정산 요청이 생성되었습니다');
    },
    onError: () => toast.error('정산 요청 생성에 실패했습니다'),
  });

  const totalUnpaid = settlements.filter(s => s.status === 'pending').reduce((sum, s) => sum + s.amount, 0);
  const totalPaid = settlements.filter(s => s.status === 'paid').reduce((sum, s) => sum + s.amount, 0);
  const pendingCount = settlements.filter(s => s.status === 'pending').length;

  const approvedPartners = partners.filter(p => p.status === 'approved' && p.unpaid_commission > 0);

  if (isLoading) return <SectionLoader />;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-white">정산 관리</h2>

      {isError && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-lg">
          <AlertCircle size={14} className="text-red-400" />
          <p className="text-xs text-red-400">정산 데이터를 불러오지 못했습니다</p>
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35] text-center">
          <p className="text-xs text-gray-500">총 미정산 금액</p>
          <p className="text-2xl font-bold text-red-400 mt-1">₩{fmt(totalUnpaid)}</p>
          <p className="text-[10px] text-gray-600 mt-0.5">{pendingCount}건 대기중</p>
        </div>
        <div className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35] text-center">
          <p className="text-xs text-gray-500">이번 달 정산 예정</p>
          <p className="text-2xl font-bold text-yellow-400 mt-1">
            ₩{fmt(approvedPartners.reduce((s, p) => s + n(p.unpaid_commission), 0))}
          </p>
        </div>
        <div className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35] text-center">
          <p className="text-xs text-gray-500">누적 정산 완료</p>
          <p className="text-2xl font-bold text-emerald-400 mt-1">₩{fmt(totalPaid)}</p>
        </div>
      </div>

      {approvedPartners.length > 0 && (
        <div className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35]">
          <h3 className="text-sm font-semibold text-white mb-3">미정산 파트너</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-[#2a2d35]">
                  <th className="text-left py-2 px-2">파트너</th>
                  <th className="text-right py-2 px-2">총 매출</th>
                  <th className="text-right py-2 px-2">총 커미션</th>
                  <th className="text-right py-2 px-2">미정산</th>
                  <th className="text-center py-2 px-2">액션</th>
                </tr>
              </thead>
              <tbody>
                {approvedPartners.map(p => (
                  <tr key={p.id} className="border-b border-[#2a2d35]/50 text-gray-300">
                    <td className="py-2.5 px-2 font-medium text-white">{p.name}</td>
                    <td className="py-2.5 px-2 text-right">₩{fmt(p.total_sales)}</td>
                    <td className="py-2.5 px-2 text-right">₩{fmt(p.total_commission)}</td>
                    <td className="py-2.5 px-2 text-right text-red-400">₩{fmt(p.unpaid_commission)}</td>
                    <td className="py-2.5 px-2 text-center">
                      <button
                        onClick={() => createSettlementMutation.mutate(p.id)}
                        disabled={createSettlementMutation.isPending}
                        className="flex items-center gap-1 mx-auto px-2 py-0.5 text-[10px] bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded transition-colors"
                      >
                        {createSettlementMutation.isPending && <Loader2 size={8} className="animate-spin" />}
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

      <div className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35]">
        <h3 className="text-sm font-semibold text-white mb-3">정산 내역</h3>
        {settlements.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2">
            <DollarSign size={24} className="text-gray-600" />
            <p className="text-xs text-gray-500">정산 내역이 없습니다</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-[#2a2d35]">
                  <th className="text-left py-2 px-2">파트너</th>
                  <th className="text-right py-2 px-2">금액</th>
                  <th className="text-center py-2 px-2">상태</th>
                  <th className="text-left py-2 px-2">생성일</th>
                  <th className="text-left py-2 px-2">완료일</th>
                  <th className="text-center py-2 px-2">액션</th>
                </tr>
              </thead>
              <tbody>
                {settlements.map(s => (
                  <tr key={s.id} className="border-b border-[#2a2d35]/50 text-gray-300">
                    <td className="py-2.5 px-2 font-medium text-white">{s.partner_name}</td>
                    <td className="py-2.5 px-2 text-right text-emerald-400">₩{fmt(s.amount)}</td>
                    <td className="py-2.5 px-2 text-center">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${s.status === 'paid' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                        {s.status === 'paid' ? '완료' : '대기'}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-gray-500">{s.created_at?.slice(0, 10)}</td>
                    <td className="py-2.5 px-2 text-gray-500">{s.paid_at?.slice(0, 10) ?? '-'}</td>
                    <td className="py-2.5 px-2 text-center">
                      {s.status === 'pending' && (
                        <button
                          onClick={() => payMutation.mutate(s.id)}
                          disabled={payMutation.isPending}
                          className="flex items-center gap-1 mx-auto px-2 py-0.5 text-[10px] bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded transition-colors"
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
      <h2 className="text-lg font-bold text-white">어필리에이트 설정</h2>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35] space-y-3">
          <h3 className="text-sm font-semibold text-white">기본 설정</h3>
          <div>
            <label className="text-xs text-gray-400">기본 커미션 비율 (%)</label>
            <input
              type="number"
              value={settings.default_commission_rate}
              onChange={e => setSettings({ ...settings, default_commission_rate: Number(e.target.value) })}
              className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400">쿠키 유효기간 (일)</label>
            <input
              type="number"
              value={settings.cookie_lifetime_days}
              onChange={e => setSettings({ ...settings, cookie_lifetime_days: Number(e.target.value) })}
              className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400">최소 정산 금액 (₩)</label>
            <input
              type="number"
              value={settings.min_payout_amount}
              onChange={e => setSettings({ ...settings, min_payout_amount: Number(e.target.value) })}
              className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400">정산 주기</label>
            <select
              value={settings.payout_cycle}
              onChange={e => setSettings({ ...settings, payout_cycle: e.target.value as 'weekly' | 'biweekly' | 'monthly' })}
              className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50"
            >
              <option value="weekly">주간</option>
              <option value="biweekly">격주</option>
              <option value="monthly">월간</option>
            </select>
          </div>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="flex items-center justify-center gap-1.5 w-full py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {saveMutation.isPending && <Loader2 size={12} className="animate-spin" />}
            설정 저장
          </button>
        </div>

        <div className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35] space-y-3">
          <h3 className="text-sm font-semibold text-white">알림 설정</h3>
          {([
            { key: 'notify_new_partner' as const, label: '새 파트너 신청 알림' },
            { key: 'notify_conversion' as const, label: '전환 발생 알림' },
            { key: 'notify_payout' as const, label: '정산 예정일 알림' },
            { key: 'notify_daily_report' as const, label: '일일 리포트 이메일' },
          ]).map(item => (
            <label key={item.key} className="flex items-center justify-between cursor-pointer">
              <span className="text-xs text-gray-400">{item.label}</span>
              <input
                type="checkbox"
                checked={settings[item.key]}
                onChange={e => setSettings({ ...settings, [item.key]: e.target.checked })}
                className="w-4 h-4 rounded accent-emerald-500"
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

// Error boundary wrapper
function SafeSection({ children }: { children: React.ReactNode }) {
  const [hasError, setHasError] = useState(false);
  if (hasError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle size={32} className="text-red-400 mb-3" />
        <p className="text-sm text-gray-400">이 섹션을 로드하는 중 오류가 발생했습니다.</p>
        <button onClick={() => setHasError(false)} className="mt-2 text-xs text-emerald-400 hover:underline">다시 시도</button>
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

      {/* 탭 네비게이션 */}
      <div className="flex items-center gap-1 bg-[#1a1b1e] rounded-xl p-1 overflow-x-auto">
        {NAV_ITEMS.map(item => (
          <button
            key={item.key}
            onClick={() => setActiveSection(item.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
              activeSection === item.key
                ? 'bg-emerald-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
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
