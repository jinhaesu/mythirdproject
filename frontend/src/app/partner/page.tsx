'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ShoppingBag,
  Eye,
  CheckCircle,
  Percent,
  DollarSign,
  BarChart2,
  Coins,
  Clock,
  Copy,
  LogOut,
  Link2,
  Loader2,
  Mail,
  MessageSquare,
  TrendingUp,
  ArrowUpRight,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import toast from 'react-hot-toast';
import { partnerAuthApi, partnerDashboardApi } from '@/lib/partner-api';
import type { PartnerInfo, PartnerDashboard, PartnerCampaign, PartnerTimeseriesPoint } from '@/lib/partner-api';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtKRW(amount: number): string {
  return `₩${Math.round(amount).toLocaleString('ko-KR')}`;
}

function fmtKRWShort(amount: number): string {
  if (amount >= 100_000_000) return `${(amount / 100_000_000).toFixed(1)}억`;
  if (amount >= 10_000) return `${(amount / 10_000).toFixed(amount >= 100_000 ? 0 : 1)}만`;
  return `${Math.round(amount).toLocaleString('ko-KR')}`;
}

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('ko-KR');
}

function fmtMonthDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ─── Login Page (이메일 / 휴대폰 듀얼 모드) ──────────────────────────────────

type LoginMode = 'email' | 'phone';

function LoginView({ onTokenVerified }: { onTokenVerified: (partner: PartnerInfo, token: string) => void }) {
  const [mode, setMode] = useState<LoginMode>('phone');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  // suppress unused arg warning while preserving the prop API
  void onTokenVerified;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === 'email') {
        const trimmed = email.trim();
        if (!trimmed) {
          toast.error('이메일을 입력하세요');
          return;
        }
        await partnerAuthApi.sendMagicLink(trimmed);
      } else {
        const trimmed = phone.trim();
        if (!trimmed) {
          toast.error('휴대폰 번호를 입력하세요');
          return;
        }
        await partnerAuthApi.sendSmsLink(trimmed);
      }
      setSent(true);
      toast.success(
        mode === 'email'
          ? '등록된 이메일로 로그인 링크를 보냈습니다.'
          : '등록된 휴대폰 번호로 로그인 링크를 보냈습니다.',
      );
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        '로그인 링크 요청 실패';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#08090A] p-4 relative overflow-hidden">
      {/* Background ornament */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-[-15%] left-[-10%] w-[420px] h-[420px] rounded-full bg-emerald-500/10 blur-[120px]" />
        <div className="absolute bottom-[-15%] right-[-10%] w-[420px] h-[420px] rounded-full bg-cyan-500/10 blur-[120px]" />
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-3 mb-5">
            <div className="w-14 h-14 bg-gradient-to-br from-emerald-500 to-cyan-500 rounded-2xl flex items-center justify-center shadow-[0_8px_30px_rgba(16,185,129,0.35)]">
              <span className="text-white font-bold text-2xl tracking-tight">N</span>
            </div>
            <div className="text-left">
              <h1 className="text-3xl font-bold text-white tracking-tight leading-none">널담</h1>
              <p className="text-[11px] text-emerald-400/80 mt-1 font-medium tracking-wider uppercase">Affiliate Program</p>
            </div>
          </div>
          <p className="text-[#8A8F98] text-sm">파트너 전용 매출 현황 대시보드</p>
        </div>

        <div className="bg-gradient-to-b from-[#101113] to-[#0B0C0E] border border-white/[0.08] rounded-3xl p-7 shadow-[0_24px_60px_-15px_rgba(0,0,0,0.6)] backdrop-blur-xl">
          {!sent ? (
            <form onSubmit={handleSend} className="space-y-5">
              <div className="text-center mb-2">
                <h2 className="text-lg font-semibold text-white">파트너 로그인</h2>
                <p className="text-sm text-[#8A8F98] mt-1.5">
                  {mode === 'phone' ? '휴대폰으로 로그인 링크를 받습니다' : '이메일로 로그인 링크를 받습니다'}
                </p>
              </div>

              {/* 모드 토글 */}
              <div className="flex p-1 bg-[#141516] border border-white/[0.06] rounded-xl gap-1">
                <button
                  type="button"
                  onClick={() => setMode('phone')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg font-medium transition-all ${
                    mode === 'phone'
                      ? 'bg-emerald-600 text-white shadow-[0_2px_8px_rgba(16,185,129,0.3)]'
                      : 'text-[#8A8F98] hover:text-white'
                  }`}
                >
                  <MessageSquare size={13} /> 휴대폰
                </button>
                <button
                  type="button"
                  onClick={() => setMode('email')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg font-medium transition-all ${
                    mode === 'email'
                      ? 'bg-emerald-600 text-white shadow-[0_2px_8px_rgba(16,185,129,0.3)]'
                      : 'text-[#8A8F98] hover:text-white'
                  }`}
                >
                  <Mail size={13} /> 이메일
                </button>
              </div>

              {mode === 'phone' ? (
                <div>
                  <label className="block text-xs text-[#8A8F98] mb-2 font-medium">휴대폰 번호</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="010-1234-5678"
                    required
                    autoFocus
                    className="w-full px-4 py-3 bg-[#141516] border border-white/[0.08] rounded-xl text-sm text-white placeholder:text-[#4a4d55] focus:outline-none focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/15 transition-all"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs text-[#8A8F98] mb-2 font-medium">이메일</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="partner@example.com"
                    required
                    autoFocus
                    className="w-full px-4 py-3 bg-[#141516] border border-white/[0.08] rounded-xl text-sm text-white placeholder:text-[#4a4d55] focus:outline-none focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/15 transition-all"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all shadow-[0_4px_16px_rgba(16,185,129,0.3)] hover:shadow-[0_6px_24px_rgba(16,185,129,0.45)]"
              >
                {loading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <>{mode === 'phone' ? <MessageSquare size={16} /> : <Mail size={16} />}</>
                )}
                로그인 링크 받기
              </button>

              <p className="text-[11px] text-[#5a5d65] text-center leading-relaxed">
                관리자에게 등록된 {mode === 'phone' ? '휴대폰 번호' : '이메일'}로만 발송됩니다
              </p>
            </form>
          ) : (
            <div className="text-center py-2">
              <div className="w-16 h-16 bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 border border-emerald-500/30 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-[0_4px_16px_rgba(16,185,129,0.2)]">
                {mode === 'phone' ? (
                  <MessageSquare size={28} className="text-emerald-400" />
                ) : (
                  <Mail size={28} className="text-emerald-400" />
                )}
              </div>
              <h2 className="text-lg font-semibold text-white mb-2">
                {mode === 'phone' ? '문자를 확인하세요' : '이메일을 확인하세요'}
              </h2>
              <p className="text-sm text-[#8A8F98] mb-1">
                <span className="font-medium text-[#D0D6E0]">{mode === 'phone' ? phone : email}</span>
              </p>
              <p className="text-sm text-[#8A8F98] mb-6">로 로그인 링크를 보냈습니다</p>
              <button
                className="text-sm text-emerald-400 hover:text-emerald-300 font-medium transition-colors"
                onClick={() => { setSent(false); setEmail(''); setPhone(''); }}
              >
                다른 방법으로 시도
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-[11px] text-[#5a5d65] mt-6">
          © {new Date().getFullYear()} 널담은디저트 · 어필리에이트 파트너 시스템
        </p>
      </div>
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

interface KpiCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: 'default' | 'yellow' | 'red' | 'emerald' | 'cyan' | 'purple';
  trend?: { positive: boolean; text: string };
}

const ACCENT_THEME: Record<NonNullable<KpiCardProps['accent']>, { text: string; bg: string; ring: string; gradient: string }> = {
  default: {
    text: 'text-white',
    bg: 'bg-white/[0.04]',
    ring: 'ring-white/5',
    gradient: 'from-white/[0.06] to-transparent',
  },
  emerald: {
    text: 'text-emerald-300',
    bg: 'bg-emerald-500/[0.08]',
    ring: 'ring-emerald-500/20',
    gradient: 'from-emerald-500/15 to-transparent',
  },
  cyan: {
    text: 'text-cyan-300',
    bg: 'bg-cyan-500/[0.08]',
    ring: 'ring-cyan-500/20',
    gradient: 'from-cyan-500/15 to-transparent',
  },
  yellow: {
    text: 'text-amber-300',
    bg: 'bg-amber-500/[0.08]',
    ring: 'ring-amber-500/20',
    gradient: 'from-amber-500/15 to-transparent',
  },
  red: {
    text: 'text-rose-300',
    bg: 'bg-rose-500/[0.08]',
    ring: 'ring-rose-500/20',
    gradient: 'from-rose-500/15 to-transparent',
  },
  purple: {
    text: 'text-violet-300',
    bg: 'bg-violet-500/[0.08]',
    ring: 'ring-violet-500/20',
    gradient: 'from-violet-500/15 to-transparent',
  },
};

function KpiCard({ icon, label, value, sub, accent = 'default', trend }: KpiCardProps) {
  const theme = ACCENT_THEME[accent];
  return (
    <div className={`relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0F1011] p-4 ring-1 ${theme.ring} hover:border-white/[0.12] transition-all group`}>
      <div className={`pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-br ${theme.gradient}`} />
      <div className="relative">
        <div className="flex items-start justify-between mb-3">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${theme.bg}`}>
            <span className={theme.text}>{icon}</span>
          </div>
          {trend && (
            <span
              className={`flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-md ${
                trend.positive ? 'text-emerald-400 bg-emerald-500/10' : 'text-rose-400 bg-rose-500/10'
              }`}
            >
              <ArrowUpRight size={10} className={trend.positive ? '' : 'rotate-90'} />
              {trend.text}
            </span>
          )}
        </div>
        <p className="text-[11px] text-[#8A8F98] font-medium tracking-wide">{label}</p>
        <p className={`mt-1 text-xl font-bold ${theme.text} tabular-nums tracking-tight`}>{value}</p>
        {sub && <p className="text-[11px] text-[#6a6f78] mt-1">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Trends Chart ─────────────────────────────────────────────────────────────

function TrendsChart({ data }: { data: PartnerTimeseriesPoint[] }) {
  const sumLast = useMemo(
    () =>
      data.reduce(
        (acc, d) => ({
          sales: acc.sales + d.sales,
          clicks: acc.clicks + d.clicks,
          conversions: acc.conversions + d.conversions,
        }),
        { sales: 0, clicks: 0, conversions: 0 },
      ),
    [data],
  );

  const hasAnyData = sumLast.sales > 0 || sumLast.clicks > 0;

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-[#0F1011] p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-1.5">
            <TrendingUp size={14} className="text-emerald-400" />
            최근 30일 추이
          </h3>
          <p className="text-[11px] text-[#6a6f78] mt-0.5">매출은 결제 완료(취소·환불 제외) 기준</p>
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="flex items-center gap-1.5 text-[#8A8F98]">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            매출
          </span>
          <span className="flex items-center gap-1.5 text-[#8A8F98]">
            <span className="w-2 h-2 rounded-full bg-cyan-400" />
            클릭
          </span>
        </div>
      </div>

      {!hasAnyData ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-[#5a5d65]">
          <BarChart2 size={28} />
          <p className="text-sm">아직 추이 데이터가 없습니다</p>
        </div>
      ) : (
        <div className="h-[220px] -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10B981" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="clicksGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#06B6D4" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#06B6D4" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2025" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={fmtMonthDay}
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
                tickFormatter={(v: number) => fmtKRWShort(v)}
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
                contentStyle={{
                  background: '#0B0C0E',
                  border: '1px solid #23252A',
                  borderRadius: 12,
                  fontSize: 12,
                  padding: '8px 12px',
                }}
                labelStyle={{ color: '#8A8F98', fontSize: 11, marginBottom: 4 }}
                itemStyle={{ color: '#D0D6E0' }}
                labelFormatter={(d: string) => fmtMonthDay(d)}
                formatter={(value: number, name: string) => {
                  if (name === '매출') return [fmtKRW(value), name];
                  return [fmtNum(value), name];
                }}
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="sales"
                name="매출"
                stroke="#10B981"
                strokeWidth={2}
                fill="url(#salesGrad)"
              />
              <Area
                yAxisId="right"
                type="monotone"
                dataKey="clicks"
                name="클릭"
                stroke="#06B6D4"
                strokeWidth={1.5}
                fill="url(#clicksGrad)"
              />
              <Legend wrapperStyle={{ display: 'none' }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ─── Campaign Card ────────────────────────────────────────────────────────────

function CampaignCard({ campaign }: { campaign: PartnerCampaign }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(campaign.referral_link);
      setCopied(true);
      toast.success('링크가 복사되었습니다');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('복사에 실패했습니다');
    }
  };

  const commissionLabel =
    campaign.commission_type === 'percentage'
      ? `${campaign.commission_rate}%`
      : fmtKRW(campaign.commission_rate);

  const conversionRate = campaign.clicks > 0 ? ((campaign.conversions / campaign.clicks) * 100).toFixed(1) : '0.0';

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0F1011] hover:border-white/[0.12] transition-all">
      <div className="pointer-events-none absolute -inset-px rounded-2xl bg-gradient-to-br from-emerald-500/0 via-emerald-500/0 to-cyan-500/0 opacity-0 group-hover:from-emerald-500/10 group-hover:to-cyan-500/5 group-hover:opacity-100 transition-opacity" />
      <div className="relative p-5 space-y-4">
        {/* 상품 정보 */}
        <div className="flex items-start gap-3">
          {campaign.product_image ? (
            <img
              src={campaign.product_image}
              alt={campaign.product_name}
              className="w-14 h-14 rounded-xl object-cover bg-[#141516] border border-white/5 shrink-0 shadow-[0_4px_12px_rgba(0,0,0,0.4)]"
            />
          ) : (
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[#1A1B1E] to-[#0F1011] border border-white/[0.06] flex items-center justify-center shrink-0">
              <ShoppingBag size={20} className="text-[#5a5d65]" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate leading-tight">{campaign.product_name || '캠페인'}</p>
            <p className="text-[11px] text-[#8A8F98] truncate mt-0.5">{campaign.campaign_name}</p>
            <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 bg-emerald-500/10 text-emerald-400 text-[11px] rounded-full border border-emerald-500/20 font-medium">
              <Coins size={10} />
              커미션 {commissionLabel}
            </span>
          </div>
        </div>

        {/* 전용 링크 */}
        <div className="flex items-center gap-2 bg-[#141516] border border-white/[0.06] rounded-xl px-3 py-2.5 group/link hover:border-emerald-500/30 transition-colors">
          <Link2 size={13} className="text-[#6a6f78] shrink-0" />
          <input
            readOnly
            value={campaign.referral_link}
            className="flex-1 bg-transparent text-[11px] text-[#A0A6B0] outline-none truncate font-mono"
          />
          <button
            onClick={handleCopy}
            className={`shrink-0 px-2 py-1 rounded-md text-[11px] font-medium transition-all ${
              copied
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'bg-white/[0.05] text-[#8A8F98] hover:bg-emerald-500/15 hover:text-emerald-300'
            }`}
          >
            <span className="flex items-center gap-1">
              <Copy size={11} />
              {copied ? '복사됨' : '복사'}
            </span>
          </button>
        </div>

        {/* 성과 미니 그리드 */}
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-[#141516] border border-white/[0.04] rounded-xl px-2.5 py-2.5">
            <p className="text-[10px] text-[#6a6f78] font-medium">클릭</p>
            <p className="text-sm font-bold text-white mt-0.5 tabular-nums">{fmtNum(campaign.clicks)}</p>
          </div>
          <div className="bg-[#141516] border border-white/[0.04] rounded-xl px-2.5 py-2.5">
            <p className="text-[10px] text-[#6a6f78] font-medium">전환</p>
            <p className="text-sm font-bold text-cyan-300 mt-0.5 tabular-nums">{fmtNum(campaign.conversions)}</p>
            <p className="text-[10px] text-[#6a6f78] tabular-nums">{conversionRate}%</p>
          </div>
          <div className="bg-[#141516] border border-white/[0.04] rounded-xl px-2.5 py-2.5">
            <p className="text-[10px] text-[#6a6f78] font-medium">매출</p>
            <p className="text-sm font-bold text-emerald-300 mt-0.5 tabular-nums">{fmtKRWShort(campaign.sales)}</p>
          </div>
          <div className="bg-[#141516] border border-white/[0.04] rounded-xl px-2.5 py-2.5">
            <p className="text-[10px] text-[#6a6f78] font-medium">커미션</p>
            <p className="text-sm font-bold text-amber-300 mt-0.5 tabular-nums">{fmtKRWShort(campaign.commission)}</p>
          </div>
        </div>

        {/* 환불/취소 표시 — 데이터 있을 때만 */}
        {((campaign.refunded_count || 0) > 0 || (campaign.cancelled_count || 0) > 0) && (
          <div className="flex items-center gap-3 flex-wrap text-[11px] border-t border-white/[0.05] pt-3">
            {(campaign.refunded_count || 0) > 0 && (
              <span className="flex items-center gap-1 text-rose-400">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                환불 {fmtNum(campaign.refunded_count || 0)}건 · {fmtKRW(campaign.refunded_amount || 0)}
              </span>
            )}
            {(campaign.cancelled_count || 0) > 0 && (
              <span className="flex items-center gap-1 text-amber-400">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                취소 {fmtNum(campaign.cancelled_count || 0)}건 · {fmtKRW(campaign.cancelled_amount || 0)}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Share Link Card ──────────────────────────────────────────────────────────
// 파트너 본인이 "실시간 매출 확인 링크"를 즉시 발급/복사할 수 있는 고정 컴포넌트.
// 기존엔 마케팅팀이 알림톡/문자로 매번 보내야 했던 작업을 본인이 처리하도록 내재화.
// 매직링크는 10분 유효이므로 복사 후 즉시 전달하도록 안내.

function ShareLinkCard() {
  const [link, setLink] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [remainingSec, setRemainingSec] = useState<number>(0);
  const [issuing, setIssuing] = useState(false);
  const [copied, setCopied] = useState(false);

  const issue = useCallback(async () => {
    setIssuing(true);
    try {
      const res = await partnerAuthApi.issueShareLink();
      const exp = Date.now() + res.expires_in * 1000;
      setLink(res.magic_link);
      setExpiresAt(exp);
      setRemainingSec(res.expires_in);
      toast.success('실시간 매출 링크가 발급되었습니다 (10분 유효)');
    } catch {
      toast.error('링크 발급에 실패했습니다');
    } finally {
      setIssuing(false);
    }
  }, []);

  // 남은 시간 카운트다운 (1초마다)
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const left = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setRemainingSec(left);
      if (left === 0) {
        setLink(null);
        setExpiresAt(null);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const handleCopy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success('링크가 복사되었습니다');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('복사에 실패했습니다');
    }
  };

  const mmss = useMemo(() => {
    const m = Math.floor(remainingSec / 60);
    const s = remainingSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }, [remainingSec]);

  return (
    <div className="rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.08] via-[#0F1011] to-[#0F1011] p-5">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
            <Link2 size={18} className="text-emerald-300" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white">실시간 매출 확인 링크</h3>
            <p className="text-[11px] text-[#8A8F98] mt-0.5 leading-relaxed">
              본인 또는 동료에게 공유할 1회용 로그인 링크. 발급 후 10분간 유효합니다.
            </p>
          </div>
        </div>
        {link && remainingSec > 0 && (
          <span className="text-[11px] font-mono px-2 py-1 bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 rounded-md tabular-nums">
            {mmss} 남음
          </span>
        )}
      </div>

      {!link ? (
        <button
          onClick={issue}
          disabled={issuing}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all shadow-[0_4px_14px_rgba(16,185,129,0.25)]"
        >
          {issuing ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
          실시간 매출 링크 발급
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 bg-[#141516] border border-white/[0.08] rounded-xl px-3 py-2.5">
            <Link2 size={13} className="text-emerald-400 shrink-0" />
            <input
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 bg-transparent text-[11px] text-[#D0D6E0] outline-none truncate font-mono"
            />
            <button
              onClick={handleCopy}
              className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                copied
                  ? 'bg-emerald-500/25 text-emerald-200'
                  : 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
              }`}
            >
              <Copy size={11} />
              {copied ? '복사됨' : '링크 복사'}
            </button>
            <button
              onClick={issue}
              disabled={issuing}
              title="새 링크 발급 (이전 링크는 만료)"
              className="shrink-0 p-1.5 text-[#8A8F98] hover:text-white hover:bg-white/5 rounded-md transition-colors disabled:opacity-50"
            >
              <RefreshCw size={11} className={issuing ? 'animate-spin' : ''} />
            </button>
          </div>
          <p className="text-[10px] text-[#6a6f78] leading-relaxed pl-1">
            * 보안을 위해 10분 후 자동 만료됩니다. 복사 후 즉시 전달하세요. 받는 사람이 클릭하면 본인 명의로 매출 대시보드가 열립니다.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-white/[0.04] animate-pulse rounded-xl ${className}`} />;
}

function KpiSkeletonGrid() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-[108px]" />
      ))}
    </div>
  );
}

// ─── Dashboard View ───────────────────────────────────────────────────────────

function DashboardView({ partner, onLogout }: { partner: PartnerInfo; onLogout: () => void }) {
  const [dashboard, setDashboard] = useState<PartnerDashboard | null>(null);
  const [campaigns, setCampaigns] = useState<PartnerCampaign[]>([]);
  const [timeseries, setTimeseries] = useState<PartnerTimeseriesPoint[]>([]);
  const [loadingDash, setLoadingDash] = useState(true);
  const [loadingCamp, setLoadingCamp] = useState(true);
  const [loadingTs, setLoadingTs] = useState(true);
  const [dashError, setDashError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const [d, c, t] = await Promise.allSettled([
        partnerDashboardApi.getDashboard(),
        partnerDashboardApi.getCampaigns(),
        partnerDashboardApi.getTimeseries(30),
      ]);
      if (d.status === 'fulfilled') {
        setDashboard(d.value);
        setDashError(false);
      } else {
        setDashError(true);
      }
      if (c.status === 'fulfilled') setCampaigns(c.value);
      if (t.status === 'fulfilled') setTimeseries(t.value);
    } finally {
      setLoadingDash(false);
      setLoadingCamp(false);
      setLoadingTs(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const kpiItems: KpiCardProps[] = dashboard
    ? [
        {
          icon: <DollarSign size={16} />,
          label: '순매출 (취소·환불 제외)',
          value: fmtKRW(dashboard.total_sales),
          sub: dashboard.gross_sales !== undefined && dashboard.gross_sales !== dashboard.total_sales
            ? `총 ${fmtKRW(dashboard.gross_sales)} 중 결제완료`
            : undefined,
          accent: 'emerald',
        },
        {
          icon: <Coins size={16} />,
          label: '예상 정산액',
          value: fmtKRW(dashboard.total_commission),
          sub: `정산 완료: ${fmtKRW(dashboard.paid_commission)}`,
          accent: 'yellow',
        },
        {
          icon: <Clock size={16} />,
          label: '미정산 커미션',
          value: fmtKRW(dashboard.unpaid_commission),
          sub: dashboard.unpaid_commission > 0 ? '정산 대기 중' : '미정산 없음',
          accent: dashboard.unpaid_commission > 100000 ? 'red' : dashboard.unpaid_commission > 0 ? 'yellow' : 'default',
        },
        {
          icon: <BarChart2 size={16} />,
          label: '평균 객단가',
          value: fmtKRW(dashboard.avg_order_value),
          accent: 'purple',
        },
        {
          icon: <Eye size={16} />,
          label: '총 클릭',
          value: fmtNum(dashboard.total_clicks),
          accent: 'cyan',
        },
        {
          icon: <CheckCircle size={16} />,
          label: '결제 전환',
          value: `${fmtNum(dashboard.total_conversions)}건`,
          accent: 'cyan',
        },
        {
          icon: <Percent size={16} />,
          label: '전환율',
          value: `${dashboard.conversion_rate.toFixed(1)}%`,
          accent: 'default',
        },
        {
          icon: <ShoppingBag size={16} />,
          label: '판매 제품 수',
          value: `${fmtNum(dashboard.total_products)}개`,
          accent: 'default',
        },
      ]
    : [];

  const refundCancelItems: KpiCardProps[] = dashboard
    ? [
        {
          icon: <DollarSign size={16} />,
          label: '환불',
          value: `${fmtNum(dashboard.refunded_count || 0)}건`,
          sub: dashboard.refunded_amount ? fmtKRW(dashboard.refunded_amount) : '₩0',
          accent: (dashboard.refunded_count || 0) > 0 ? 'red' : 'default',
        },
        {
          icon: <DollarSign size={16} />,
          label: '취소',
          value: `${fmtNum(dashboard.cancelled_count || 0)}건`,
          sub: dashboard.cancelled_amount ? fmtKRW(dashboard.cancelled_amount) : '₩0',
          accent: (dashboard.cancelled_count || 0) > 0 ? 'yellow' : 'default',
        },
        {
          icon: <Coins size={16} />,
          label: '차감 합계',
          value: fmtKRW((dashboard.refunded_amount || 0) + (dashboard.cancelled_amount || 0)),
          sub: '환불 + 취소',
          accent: 'default',
        },
      ]
    : [];

  return (
    <div className="min-h-screen bg-[#08090A] relative">
      {/* Background subtle gradient */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full bg-emerald-500/[0.04] blur-[120px]" />
      </div>

      {/* 헤더 */}
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#0B0C0E]/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-cyan-500 rounded-xl flex items-center justify-center shrink-0 shadow-[0_4px_16px_rgba(16,185,129,0.3)]">
              <span className="text-white font-bold text-base">N</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-white leading-tight">{partner.name}</p>
              <p className="text-[11px] text-[#6a6f78] mt-0.5 flex items-center gap-1">
                <Sparkles size={10} className="text-emerald-400" />
                널담 어필리에이트 파트너
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadAll}
              disabled={refreshing}
              className="p-2 text-[#8A8F98] border border-white/[0.06] rounded-lg hover:text-white hover:border-white/20 transition-colors disabled:opacity-50"
              title="데이터 새로고침"
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 px-3 py-2 text-xs text-[#8A8F98] border border-white/[0.06] rounded-lg hover:text-white hover:border-white/20 transition-colors"
            >
              <LogOut size={13} />
              <span className="hidden sm:inline">로그아웃</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-10 relative">
        {/* 환영 인사 */}
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            안녕하세요, <span className="bg-gradient-to-r from-emerald-300 to-cyan-300 bg-clip-text text-transparent">{partner.name}</span>님
          </h1>
          <p className="text-sm text-[#8A8F98] mt-1.5">
            오늘도 멋진 하루 보내세요. 실시간 매출과 커미션 현황을 확인해보세요.
          </p>
        </div>

        {/* 실시간 매출 확인 링크 — 본인/동료 공유용 (마케팅팀 발송 업무 경감) */}
        <ShareLinkCard />

        {/* KPI 카드 */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <div className="h-5 w-1 rounded-full bg-gradient-to-b from-emerald-400 to-cyan-400" />
            <h2 className="text-xs font-semibold text-[#A0A6B0] uppercase tracking-wider">성과 요약</h2>
          </div>
          {loadingDash ? (
            <KpiSkeletonGrid />
          ) : dashError ? (
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-6 text-center">
              <p className="text-sm text-rose-300">대시보드 데이터를 불러오지 못했습니다</p>
              <button
                onClick={loadAll}
                className="mt-2 text-xs text-rose-400 hover:text-rose-300 underline"
              >
                다시 시도
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {kpiItems.map((item, i) => (
                <KpiCard key={i} {...item} />
              ))}
            </div>
          )}
        </section>

        {/* 추이 그래프 */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <div className="h-5 w-1 rounded-full bg-gradient-to-b from-cyan-400 to-violet-400" />
            <h2 className="text-xs font-semibold text-[#A0A6B0] uppercase tracking-wider">매출 추이</h2>
          </div>
          {loadingTs ? (
            <Skeleton className="h-[280px]" />
          ) : (
            <TrendsChart data={timeseries} />
          )}
        </section>

        {/* 환불·취소 현황 */}
        {dashboard && ((dashboard.refunded_count || 0) > 0 || (dashboard.cancelled_count || 0) > 0) && (
          <section>
            <div className="flex items-center gap-2 mb-4">
              <div className="h-5 w-1 rounded-full bg-gradient-to-b from-amber-400 to-rose-400" />
              <h2 className="text-xs font-semibold text-[#A0A6B0] uppercase tracking-wider">환불 · 취소 현황</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {refundCancelItems.map((item, i) => (
                <KpiCard key={i} {...item} />
              ))}
            </div>
          </section>
        )}

        {/* 캠페인 & 링크 */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <div className="h-5 w-1 rounded-full bg-gradient-to-b from-emerald-400 to-emerald-600" />
            <h2 className="text-xs font-semibold text-[#A0A6B0] uppercase tracking-wider">내 캠페인 &amp; 링크</h2>
            {!loadingCamp && (
              <span className="ml-1 px-2 py-0.5 bg-emerald-500/10 text-emerald-400 text-[11px] rounded-full border border-emerald-500/20 font-medium">
                {campaigns.length}개
              </span>
            )}
          </div>

          {loadingCamp ? (
            <div className="grid md:grid-cols-2 gap-4">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-[220px]" />
              ))}
            </div>
          ) : campaigns.length === 0 ? (
            <div className="rounded-2xl border border-white/[0.06] bg-[#0F1011] flex flex-col items-center justify-center py-14 gap-2">
              <ShoppingBag size={32} className="text-[#3a3d44]" />
              <p className="text-sm text-[#8A8F98]">아직 참여 중인 캠페인이 없습니다</p>
              <p className="text-[11px] text-[#5a5d65]">관리자가 캠페인을 배정하면 여기에 표시됩니다</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {campaigns.map((c) => (
                <CampaignCard key={c.campaign_id} campaign={c} />
              ))}
            </div>
          )}
        </section>

        <footer className="pt-6 pb-4 text-center">
          <p className="text-[11px] text-[#5a5d65]">
            © {new Date().getFullYear()} 널담은디저트 · 데이터는 결제 완료 기준으로 집계됩니다
          </p>
        </footer>
      </main>
    </div>
  );
}

// ─── Verifying Spinner ────────────────────────────────────────────────────────

function VerifyingView() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#08090A]">
      <div className="text-center">
        <div className="relative w-14 h-14 mx-auto mb-4">
          <div className="absolute inset-0 border-4 border-emerald-500/20 rounded-full" />
          <div className="absolute inset-0 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        </div>
        <p className="text-[#8A8F98] text-sm">로그인 확인 중...</p>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

// React strict mode의 effect double-invoke를 견디기 위한 module-level 플래그
// (verify 매직링크가 단일 토큰이라 두 번 호출되면 두 번째는 무조건 실패)
const _verifiedTokens = new Set<string>();

export default function PartnerPage() {
  const [partner, setPartner] = useState<PartnerInfo | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const logout = useCallback(() => {
    localStorage.removeItem('partner_token');
    setPartner(null);
    window.history.replaceState({}, '', '/partner');
  }, []);

  // 인터셉터가 401 발생 시 발사하는 이벤트 — DashboardView가 이미 마운트된 상태에서
  // 토큰이 만료되면 partner state를 null로 만들어 LoginView로 전환
  useEffect(() => {
    const onExpired = () => {
      setPartner(null);
      setVerifying(false);
      toast.error('로그인이 만료되었습니다. 다시 로그인해 주세요.');
    };
    window.addEventListener('partner-auth-expired', onExpired);
    return () => window.removeEventListener('partner-auth-expired', onExpired);
  }, []);

  // URL ?token= 처리 또는 기존 localStorage 토큰 복원
  useEffect(() => {
    const init = async () => {
      const params = new URLSearchParams(window.location.search);
      const urlToken = params.get('token');

      if (urlToken) {
        // 같은 토큰을 두 번 verify 시도 방지 (strict mode/뒤로가기 등)
        if (_verifiedTokens.has(urlToken)) {
          window.history.replaceState({}, '', '/partner');
          setInitialized(true);
          return;
        }
        _verifiedTokens.add(urlToken);
        // URL에서 token을 즉시 제거 — verify 실패하더라도 새로고침 시 같은 토큰으로 또
        // 시도하지 않게 차단
        window.history.replaceState({}, '', '/partner');

        setVerifying(true);
        try {
          const res = await partnerAuthApi.verify(urlToken);
          localStorage.setItem('partner_token', res.access_token);
          setPartner(res.partner);
          toast.success('로그인 되었습니다');
        } catch {
          toast.error('로그인 링크가 만료되었거나 유효하지 않습니다.');
        } finally {
          setVerifying(false);
        }
      } else {
        // 기존 토큰으로 복원
        const saved = localStorage.getItem('partner_token');
        if (saved) {
          try {
            const me = await partnerDashboardApi.getMe();
            setPartner(me);
          } catch {
            localStorage.removeItem('partner_token');
          }
        }
      }
      setInitialized(true);
    };

    init();
  }, []);

  if (verifying) return <VerifyingView />;
  if (!initialized) return <VerifyingView />;

  if (!partner) {
    return (
      <LoginView
        onTokenVerified={(p, token) => {
          localStorage.setItem('partner_token', token);
          setPartner(p);
        }}
      />
    );
  }

  return <DashboardView partner={partner} onLogout={logout} />;
}
