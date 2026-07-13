'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, DollarSign, Download, ExternalLink,
  Layers, Loader2, Megaphone, Percent, Plus, RefreshCw, Search, ShoppingCart, Sparkles, Target,
  Trash2, TrendingUp, Users,
} from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, ComposedChart, ReferenceLine, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import { downloadFile, influencerApi, kpiApi } from '@/lib/api';
import type {
  InfluencerChannel, InfluencerSeeding, InfluencerSeedingCreatePayload,
  KPIChannelSpend, KPIChannelSpendUpdatePayload, KPIGoal, KPIGoalUpdatePayload,
  KPIGranularity, KPIMonthSummary,
} from '@/lib/api';

// ─── Constants ───

const CHANNEL_KEYS = ['meta', 'naver_sa', 'naver_gfa', 'kakao', 'google', 'etc'] as const;

const CHANNEL_LABELS: Record<string, string> = {
  meta: '메타',
  naver_sa: '네이버 SA',
  naver_gfa: '네이버 GFA',
  kakao: '카카오',
  google: '구글',
  etc: '기타',
};

const CHANNEL_COLORS: Record<string, string> = {
  meta: '#4EA7FC',
  naver_sa: '#03C75A',
  naver_gfa: '#00B36B',
  kakao: '#FEE500',
  google: '#EA4335',
  etc: '#8A8F98',
};

const LINE_PALETTE = ['#4EA7FC', '#27A644', '#F0BF00', '#EA4335', '#7070FF'];

const INFLUENCER_CHANNEL_OPTIONS: Array<{ value: InfluencerChannel; label: string; color: string }> = [
  { value: 'instagram', label: '인스타그램', color: '#E1306C' },
  { value: 'youtube', label: '유튜브', color: '#FF0000' },
  { value: 'blog', label: '블로그', color: '#03C75A' },
  { value: 'tiktok', label: '틱톡', color: '#69C9D0' },
  { value: 'etc', label: '기타', color: '#8A8F98' },
];

const INFLUENCER_CHANNEL_LABELS: Record<string, string> = Object.fromEntries(
  INFLUENCER_CHANNEL_OPTIONS.map((o) => [o.value, o.label]),
);
const INFLUENCER_CHANNEL_COLORS: Record<string, string> = Object.fromEntries(
  INFLUENCER_CHANNEL_OPTIONS.map((o) => [o.value, o.color]),
);

// ─── Formatting helpers ───

const fmtWon = (v: number | null | undefined): string =>
  v === null || v === undefined ? '-' : `₩${Math.round(v).toLocaleString('ko-KR')}`;

const fmtRatio = (v: number | null | undefined): string =>
  v === null || v === undefined ? '-' : v.toFixed(2);

const fmtPercent = (v: number | null | undefined): string =>
  v === null || v === undefined ? '-' : `${v.toFixed(2)}%`;

const fmtNum = (v: number | null | undefined): string =>
  v === null || v === undefined ? '-' : Math.round(v).toLocaleString('ko-KR');

const shortMonth = (m: string): string => m.slice(2).replace('-', '.');

/** granularity별 차트 X축 라벨. month="M월", week="MM-DD~MM-DD"(bucket_end 활용), day="MM-DD" */
const bucketLabel = (m: KPIMonthSummary, granularity: KPIGranularity): string => {
  if (granularity === 'month') {
    const mm = parseInt((m.month.split('-')[1] || '0'), 10);
    return `${mm}월`;
  }
  const start = m.month.slice(5, 10); // MM-DD
  if (granularity === 'week') {
    const end = (m.bucket_end || '').slice(5, 10);
    return end ? `${start}~${end}` : start;
  }
  return start; // day
};

const targetText = (v: number | null | undefined, fmt: (n: number) => string): string =>
  v === null || v === undefined ? '목표 미설정' : `목표 ${fmt(v)}`;

function achievementBadge(
  actual: number | null | undefined,
  target: number | null | undefined,
  inverse = false,
): { label: string; color: string } {
  if (target === null || target === undefined) {
    return { label: '목표 미설정', color: 'bg-[#23252A] text-[#8A8F98]' };
  }
  if (actual === null || actual === undefined) {
    return { label: '실적 없음', color: 'bg-[#23252A] text-[#8A8F98]' };
  }
  const divisor = inverse ? actual : target;
  if (!divisor) {
    return { label: '-', color: 'bg-[#23252A] text-[#8A8F98]' };
  }
  const pct = inverse ? (target / actual) * 100 : (actual / target) * 100;
  const color =
    pct >= 100 ? 'bg-[#27A644]/15 text-[#27A644]' :
    pct >= 80 ? 'bg-[#F0BF00]/15 text-[#F0BF00]' : 'bg-[#EB5757]/15 text-[#EB5757]';
  return { label: `${pct.toFixed(0)}%`, color };
}

// ─── Small presentational components ───

function KPIGoalCard({
  icon, label, value, targetLabel, badge, unavailable, showTarget = true,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  targetLabel: string;
  badge: { label: string; color: string };
  unavailable?: boolean;
  /** false면 목표 뱃지/목표 라벨을 숨긴다 (주/일별 모드 — 목표는 월 단위로만 관리) */
  showTarget?: boolean;
}) {
  return (
    <div className="bg-[#0F1011] border border-[#23252A] rounded-xl p-3">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <div className="p-1 rounded-lg bg-[#5E6AD2]/10 text-[#7070FF]">{icon}</div>
          <span className="text-xs text-[#8A8F98]">{label}</span>
        </div>
        {showTarget && (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${badge.color}`}>
            {badge.label}
          </span>
        )}
      </div>
      {unavailable ? (
        <p className="text-xs text-[#F0BF00] leading-snug mt-1.5">
          주문 데이터 없음<br />백필 필요
        </p>
      ) : (
        <>
          <p className="text-lg font-bold text-[#F7F8F8]">{value}</p>
          {showTarget && <p className="text-[11px] text-[#62666D] mt-0.5">{targetLabel}</p>}
        </>
      )}
    </div>
  );
}

function GoalInput({
  label, value, onChange, step,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
}) {
  return (
    <div>
      <label className="text-xs text-[#8A8F98] block mb-1">{label}</label>
      <input
        type="number"
        step={step || '1'}
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        placeholder="미입력"
        className="w-full bg-[#08090A] border border-[#23252A] rounded-lg px-2 py-1.5 text-xs text-[#F7F8F8] focus:outline-none focus:border-[#5E6AD2]"
      />
    </div>
  );
}

function ChannelSpendRow({
  month, item, autoValue, onSave, onDelete,
}: {
  month: string;
  item: KPIChannelSpend;
  autoValue?: number;
  onSave: (payload: KPIChannelSpendUpdatePayload) => void;
  onDelete: (id: number) => void;
}) {
  const [planned, setPlanned] = useState(item.planned_amount != null ? String(item.planned_amount) : '');
  const [actual, setActual] = useState(item.actual_amount != null ? String(item.actual_amount) : '');
  const [memo, setMemo] = useState(item.memo ?? '');

  useEffect(() => {
    setPlanned(item.planned_amount != null ? String(item.planned_amount) : '');
    setActual(item.actual_amount != null ? String(item.actual_amount) : '');
    setMemo(item.memo ?? '');
  }, [item.id, item.planned_amount, item.actual_amount, item.memo]);

  const isAutoMeta = item.is_auto === true || (item.channel === 'meta' && item.actual_amount === null);

  const commit = () => {
    onSave({
      month,
      channel: item.channel,
      planned_amount: planned.trim() === '' ? null : parseFloat(planned),
      actual_amount: isAutoMeta ? undefined : (actual.trim() === '' ? null : parseFloat(actual)),
      memo: memo.trim() === '' ? null : memo,
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
  };

  return (
    <tr className="border-b border-[#23252A] hover:bg-[#141516]/40">
      <td className="px-3 py-2 text-xs text-[#8A8F98] whitespace-nowrap">{month}</td>
      <td className="px-3 py-2 text-xs whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ background: CHANNEL_COLORS[item.channel] || '#8A8F98' }} />
          <span className="text-[#D0D6E0]">{CHANNEL_LABELS[item.channel] || item.channel}</span>
        </span>
      </td>
      <td className="px-3 py-2">
        <input
          value={planned}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setPlanned(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          type="number"
          className="w-28 bg-[#08090A] border border-[#23252A] rounded-lg px-2 py-1 text-xs text-[#F7F8F8] focus:outline-none focus:border-[#5E6AD2]"
          placeholder="0"
        />
      </td>
      <td className="px-3 py-2">
        {isAutoMeta ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-xs text-[#8A8F98]">{fmtWon(autoValue ?? null)}</span>
            <span className="text-[9px] font-semibold bg-[#4EA7FC]/15 text-[#4EA7FC] px-1.5 py-0.5 rounded-full">자동</span>
          </span>
        ) : (
          <input
            value={actual}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setActual(e.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
            type="number"
            className="w-28 bg-[#08090A] border border-[#23252A] rounded-lg px-2 py-1 text-xs text-[#F7F8F8] focus:outline-none focus:border-[#5E6AD2]"
            placeholder="0"
          />
        )}
      </td>
      <td className="px-3 py-2">
        <input
          value={memo}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setMemo(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          type="text"
          className="w-40 bg-[#08090A] border border-[#23252A] rounded-lg px-2 py-1 text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
          placeholder="메모"
        />
      </td>
      <td className="px-3 py-2 text-right">
        {item.id != null && (
          <button onClick={() => onDelete(item.id!)} className="text-[#8A8F98] hover:text-[#EB5757] transition-colors">
            <Trash2 size={14} />
          </button>
        )}
      </td>
    </tr>
  );
}

// ─── Main component ───

export function MarketingKPI() {
  const queryClient = useQueryClient();
  const [granularity, setGranularity] = useState<KPIGranularity>('month');
  const [monthsRange, setMonthsRange] = useState<3 | 6 | 12>(6);
  const [daysRange, setDaysRange] = useState<30 | 90>(30);
  const isMonthMode = granularity === 'month';

  const defaultMonth = useMemo(() => new Date().toISOString().slice(0, 7), []);

  const {
    data: summaryData, isLoading: summaryLoading, isError: summaryError, refetch: refetchSummary,
  } = useQuery({
    queryKey: ['kpi-summary', granularity, isMonthMode ? monthsRange : daysRange],
    queryFn: () => kpiApi.getSummary(
      isMonthMode ? { granularity, months: monthsRange } : { granularity, days: daysRange },
    ),
    staleTime: 60 * 1000,
  });

  const months: KPIMonthSummary[] = summaryData?.months ?? [];
  const currentMonth = months.length > 0 ? months[months.length - 1] : null;
  const latestGoal: KPIGoal | null = isMonthMode ? (currentMonth?.goal ?? null) : null;

  const exportParams = isMonthMode
    ? { granularity, months: monthsRange }
    : { granularity, days: daysRange };

  const handleExportKpi = async () => {
    try {
      await downloadFile('/kpi/export', exportParams);
    } catch {
      toast.error('엑셀 다운로드에 실패했습니다.');
    }
  };

  // ─── Mutations ───

  const backfillMutation = useMutation({
    mutationFn: () => kpiApi.backfillOrders('2026-01-01'),
    onSuccess: (res) => {
      toast.success(`주문 백필 완료: ${res.upserted.toLocaleString('ko-KR')}건 upsert (${res.months.length}개월)`);
      queryClient.invalidateQueries({ queryKey: ['kpi-summary'] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || '백필 실패. 잠시 후 다시 시도해주세요.'),
  });

  const updateChannelSpendMutation = useMutation({
    mutationFn: (payload: KPIChannelSpendUpdatePayload) => kpiApi.updateChannelSpend(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kpi-summary'] });
      toast.success('채널 광고비가 저장되었습니다.');
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || '저장 실패'),
  });

  const deleteChannelSpendMutation = useMutation({
    mutationFn: (id: number) => kpiApi.deleteChannelSpend(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kpi-summary'] });
      toast.success('삭제되었습니다.');
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || '삭제 실패'),
  });

  const updateGoalMutation = useMutation({
    mutationFn: ({ month, payload }: { month: string; payload: KPIGoalUpdatePayload }) =>
      kpiApi.updateGoal(month, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kpi-summary'] });
      toast.success('목표가 저장되었습니다.');
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || '저장 실패'),
  });

  // ─── Channel spend table data ───

  const channelChartData = useMemo(() => months.map((m) => {
    const row: Record<string, number | string> = { month: bucketLabel(m, granularity) };
    CHANNEL_KEYS.forEach((ch) => {
      if (ch === 'meta') {
        row.meta = m.meta_spend ?? 0;
      } else {
        const cs = m.channel_spends.find((c) => c.channel === ch);
        row[ch] = cs ? (cs.actual_amount ?? cs.planned_amount ?? 0) : 0;
      }
    });
    return row;
  }), [months, granularity]);

  const spendRows = useMemo(() => {
    const rows: Array<{ key: string; month: string; channel: string; item: KPIChannelSpend }> = [];
    months.forEach((m) => {
      m.channel_spends.forEach((cs) => {
        rows.push({ key: `${m.month}-${cs.channel}`, month: m.month, channel: cs.channel, item: cs });
      });
    });
    return rows.sort((a, b) => (a.month === b.month ? a.channel.localeCompare(b.channel) : b.month.localeCompare(a.month)));
  }, [months]);

  const [newMonth, setNewMonth] = useState(defaultMonth);
  const [newChannel, setNewChannel] = useState<string>('meta');

  const addSpend = () => {
    if (!newMonth) return;
    updateChannelSpendMutation.mutate({ month: newMonth, channel: newChannel });
  };

  // ─── CAC / LTV trend data ───

  const cacLtvChartData = useMemo(() => months.map((m) => ({
    month: bucketLabel(m, granularity),
    cac: m.cac,
    ltv: m.ltv,
    ltv_cac: m.ltv_cac,
  })), [months, granularity]);

  // ─── Mall metrics chart data ───

  const newCustomersChartData = useMemo(() => months.map((m) => ({
    month: bucketLabel(m, granularity),
    new_customers: m.mall?.new_customers ?? null,
    target: m.goal?.target_new_customers ?? null,
  })), [months, granularity]);

  const revenueAovChartData = useMemo(() => months.map((m) => ({
    month: bucketLabel(m, granularity),
    revenue: m.mall?.revenue ?? null,
    aov: m.mall?.aov ?? null,
  })), [months, granularity]);

  const conversionChartData = useMemo(() => months.map((m) => ({
    month: bucketLabel(m, granularity),
    visits: m.mall?.visits ?? null,
    conversion_rate: m.mall?.conversion_rate ?? null,
    target: m.goal?.target_conversion_rate ?? null,
  })), [months, granularity]);

  // ─── Naver search volume ───

  const [keywordsInput, setKeywordsInput] = useState('널담,널담은디저트');
  const keywordsList = useMemo(
    () => keywordsInput.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 5),
    [keywordsInput],
  );

  const {
    data: naverData, isLoading: naverLoading, isError: naverIsError, error: naverErrorRaw, refetch: refetchNaver,
  } = useQuery({
    queryKey: ['kpi-naver-queries', keywordsList, monthsRange],
    queryFn: () => kpiApi.getNaverQueries(keywordsList, monthsRange),
    enabled: keywordsList.length > 0,
    retry: 1,
  });

  const naverIs503 = (naverErrorRaw as any)?.response?.status === 503;

  // ─── Goal form ───

  const [goalFormOpen, setGoalFormOpen] = useState(false);
  const [goalMonth, setGoalMonth] = useState(defaultMonth);
  const [targetCac, setTargetCac] = useState('');
  const [targetLtv, setTargetLtv] = useState('');
  const [targetLtvCac, setTargetLtvCac] = useState('');
  const [targetConversionRate, setTargetConversionRate] = useState('');
  const [targetAov, setTargetAov] = useState('');
  const [targetNewCustomers, setTargetNewCustomers] = useState('');
  const [actualConversionRate, setActualConversionRate] = useState('');
  const [goalMemo, setGoalMemo] = useState('');

  const goalForSelectedMonth = months.find((m) => m.month === goalMonth)?.goal ?? null;
  const goalSignature = goalForSelectedMonth ? JSON.stringify(goalForSelectedMonth) : 'null';

  useEffect(() => {
    const g = goalForSelectedMonth;
    setTargetCac(g?.target_cac != null ? String(g.target_cac) : '');
    setTargetLtv(g?.target_ltv != null ? String(g.target_ltv) : '');
    setTargetLtvCac(g?.target_ltv_cac != null ? String(g.target_ltv_cac) : '');
    setTargetConversionRate(g?.target_conversion_rate != null ? String(g.target_conversion_rate) : '');
    setTargetAov(g?.target_aov != null ? String(g.target_aov) : '');
    setTargetNewCustomers(g?.target_new_customers != null ? String(g.target_new_customers) : '');
    setActualConversionRate(g?.actual_conversion_rate != null ? String(g.actual_conversion_rate) : '');
    setGoalMemo(g?.memo ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalMonth, goalSignature]);

  const handleSaveGoal = () => {
    const payload: KPIGoalUpdatePayload = {
      target_cac: targetCac.trim() === '' ? null : parseFloat(targetCac),
      target_ltv: targetLtv.trim() === '' ? null : parseFloat(targetLtv),
      target_ltv_cac: targetLtvCac.trim() === '' ? null : parseFloat(targetLtvCac),
      target_conversion_rate: targetConversionRate.trim() === '' ? null : parseFloat(targetConversionRate),
      target_aov: targetAov.trim() === '' ? null : parseFloat(targetAov),
      target_new_customers: targetNewCustomers.trim() === '' ? null : parseFloat(targetNewCustomers),
      actual_conversion_rate: actualConversionRate.trim() === '' ? null : parseFloat(actualConversionRate),
      memo: goalMemo.trim() === '' ? null : goalMemo,
    };
    updateGoalMutation.mutate({ month: goalMonth, payload });
  };

  // ─── Render ───

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-[#F7F8F8]">마케팅 KPI · 목표 관리</h2>
          <p className="text-xs text-[#8A8F98] mt-1">채널별 광고비, CAC/LTV, 자사몰 지표를 한눈에 관리합니다.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center bg-[#141516] rounded-lg p-0.5">
            {([
              { key: 'month', label: '월별' },
              { key: 'week', label: '주별' },
              { key: 'day', label: '일별' },
            ] as const).map((g) => (
              <button
                key={g.key}
                onClick={() => setGranularity(g.key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  granularity === g.key ? 'bg-[#0F1011] text-[#7070FF] shadow-[0px_1px_3px_rgba(0,0,0,0.2)]' : 'text-[#8A8F98] hover:text-[#D0D6E0]'
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
          <div className="flex items-center bg-[#141516] rounded-lg p-0.5">
            {isMonthMode ? (
              ([3, 6, 12] as const).map((n) => (
                <button
                  key={n}
                  onClick={() => setMonthsRange(n)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    monthsRange === n ? 'bg-[#0F1011] text-[#7070FF] shadow-[0px_1px_3px_rgba(0,0,0,0.2)]' : 'text-[#8A8F98] hover:text-[#D0D6E0]'
                  }`}
                >
                  최근 {n}개월
                </button>
              ))
            ) : (
              ([{ v: 30, label: '1개월' }, { v: 90, label: '3개월' }] as const).map((d) => (
                <button
                  key={d.v}
                  onClick={() => setDaysRange(d.v)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    daysRange === d.v ? 'bg-[#0F1011] text-[#7070FF] shadow-[0px_1px_3px_rgba(0,0,0,0.2)]' : 'text-[#8A8F98] hover:text-[#D0D6E0]'
                  }`}
                >
                  최근 {d.label}
                </button>
              ))
            )}
          </div>
          <button
            onClick={handleExportKpi}
            className="flex items-center gap-1.5 px-3 py-2 border border-[#23252A] rounded-lg text-sm text-[#D0D6E0] hover:bg-[#141516] transition-all"
          >
            <Download size={14} /> 엑셀
          </button>
          <button
            onClick={() => backfillMutation.mutate()}
            disabled={backfillMutation.isPending}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#5E6AD2] text-white text-sm font-medium rounded-lg hover:bg-[#828FFF] disabled:opacity-50 transition-all"
          >
            {backfillMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {backfillMutation.isPending ? '백필 중...' : '주문 백필'}
          </button>
        </div>
      </div>

      {summaryLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 size={32} className="animate-spin text-[#7070FF]" />
          <span className="ml-3 text-[#8A8F98]">KPI 데이터 로딩 중...</span>
        </div>
      ) : summaryError ? (
        <div className="flex items-center justify-center h-40">
          <div className="text-center">
            <AlertTriangle size={32} className="text-[#EB5757] mx-auto mb-2" />
            <p className="text-sm text-[#8A8F98] mb-3">KPI 데이터를 불러오지 못했습니다.</p>
            <button onClick={() => refetchSummary()} className="text-xs bg-[#5E6AD2] text-white px-4 py-2 rounded-lg hover:bg-[#828FFF]">
              다시 시도
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* 당월 목표 vs 실적 카드 */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
            <KPIGoalCard
              icon={<Target size={16} />}
              label="CAC"
              unavailable={!currentMonth?.mall}
              value={fmtWon(currentMonth?.cac ?? null)}
              targetLabel={targetText(latestGoal?.target_cac ?? null, fmtWon)}
              badge={achievementBadge(currentMonth?.cac ?? null, latestGoal?.target_cac ?? null, true)}
              showTarget={isMonthMode}
            />
            <KPIGoalCard
              icon={<DollarSign size={16} />}
              label="LTV"
              unavailable={!currentMonth?.mall}
              value={fmtWon(currentMonth?.ltv ?? null)}
              targetLabel={targetText(latestGoal?.target_ltv ?? null, fmtWon)}
              badge={achievementBadge(currentMonth?.ltv ?? null, latestGoal?.target_ltv ?? null)}
              showTarget={isMonthMode}
            />
            <KPIGoalCard
              icon={<TrendingUp size={16} />}
              label="LTV/CAC"
              unavailable={!currentMonth?.mall}
              value={fmtRatio(currentMonth?.ltv_cac ?? null)}
              targetLabel={targetText(latestGoal?.target_ltv_cac ?? null, fmtRatio)}
              badge={achievementBadge(currentMonth?.ltv_cac ?? null, latestGoal?.target_ltv_cac ?? null)}
              showTarget={isMonthMode}
            />
            <KPIGoalCard
              icon={<Percent size={16} />}
              label="구매전환율"
              value={fmtPercent(currentMonth?.mall?.conversion_rate ?? latestGoal?.actual_conversion_rate ?? null)}
              targetLabel={targetText(latestGoal?.target_conversion_rate ?? null, fmtPercent)}
              badge={achievementBadge(currentMonth?.mall?.conversion_rate ?? latestGoal?.actual_conversion_rate ?? null, latestGoal?.target_conversion_rate ?? null)}
              showTarget={isMonthMode}
            />
            <KPIGoalCard
              icon={<ShoppingCart size={16} />}
              label="AOV"
              unavailable={!currentMonth?.mall}
              value={fmtWon(currentMonth?.mall?.aov ?? null)}
              targetLabel={targetText(latestGoal?.target_aov ?? null, fmtWon)}
              badge={achievementBadge(currentMonth?.mall?.aov ?? null, latestGoal?.target_aov ?? null)}
              showTarget={isMonthMode}
            />
            <KPIGoalCard
              icon={<Users size={16} />}
              label="신규 고객수"
              unavailable={!currentMonth?.mall}
              value={fmtNum(currentMonth?.mall?.new_customers ?? null)}
              targetLabel={targetText(latestGoal?.target_new_customers ?? null, fmtNum)}
              badge={achievementBadge(currentMonth?.mall?.new_customers ?? null, latestGoal?.target_new_customers ?? null)}
              showTarget={isMonthMode}
            />
          </div>

          {/* 채널 광고비 */}
          <div className="bg-[#0F1011] border border-[#23252A] rounded-xl p-4">
            <h3 className="text-sm font-semibold text-[#D0D6E0] mb-3 flex items-center gap-1.5">
              <Layers size={14} className="text-[#4EA7FC]" />
              채널 광고비
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={channelChartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#23252A" />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#8A8F98' }} />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#8A8F98' }}
                    tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 10000)}만` : String(v))}
                  />
                  <RechartsTooltip
                    contentStyle={{ backgroundColor: '#141516', border: '1px solid #23252A', borderRadius: 8, fontSize: 11 }}
                    labelStyle={{ color: '#D0D6E0' }}
                    formatter={(value: any, name: any) => [fmtWon(Number(value)), CHANNEL_LABELS[name as string] || name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} formatter={(value: string) => CHANNEL_LABELS[value] || value} />
                  {CHANNEL_KEYS.map((ch) => (
                    <Bar key={ch} dataKey={ch} name={ch} stackId="spend" fill={CHANNEL_COLORS[ch]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            {isMonthMode && (
              <>
                <div className="overflow-x-auto mt-4">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-[#23252A] text-[10px] text-[#62666D] uppercase tracking-wide">
                        <th className="px-3 py-2">월</th>
                        <th className="px-3 py-2">채널</th>
                        <th className="px-3 py-2">예산</th>
                        <th className="px-3 py-2">실적</th>
                        <th className="px-3 py-2">메모</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {spendRows.map((row) => (
                        <ChannelSpendRow
                          key={row.key}
                          month={row.month}
                          item={row.item}
                          autoValue={row.channel === 'meta' ? months.find((m) => m.month === row.month)?.meta_spend : undefined}
                          onSave={(payload) => updateChannelSpendMutation.mutate(payload)}
                          onDelete={(id) => deleteChannelSpendMutation.mutate(id)}
                        />
                      ))}
                      {spendRows.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-3 py-6 text-center text-xs text-[#62666D]">
                            등록된 채널 광고비가 없습니다.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#23252A] flex-wrap">
                  <select
                    value={newChannel}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) => setNewChannel(e.target.value)}
                    className="px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
                  >
                    {CHANNEL_KEYS.map((ch) => (
                      <option key={ch} value={ch}>{CHANNEL_LABELS[ch]}</option>
                    ))}
                  </select>
                  <input
                    type="month"
                    value={newMonth}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setNewMonth(e.target.value)}
                    className="px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
                  />
                  <button
                    onClick={addSpend}
                    disabled={updateChannelSpendMutation.isPending}
                    className="flex items-center gap-1 px-3 py-1.5 bg-[#5E6AD2] text-white text-xs font-medium rounded-lg hover:bg-[#828FFF] disabled:opacity-50"
                  >
                    <Plus size={12} /> 채널 추가
                  </button>
                </div>
              </>
            )}
          </div>

          {/* CAC / LTV 추이 */}
          <div className="bg-[#0F1011] border border-[#23252A] rounded-xl p-4">
            <h3 className="text-sm font-semibold text-[#D0D6E0] mb-3 flex items-center gap-1.5">
              <TrendingUp size={14} className="text-[#7070FF]" />
              {isMonthMode ? 'CAC·LTV 추이' : 'CAC 추이'}
              {!isMonthMode && (
                <span className="text-[10px] font-normal text-[#62666D]">LTV·목표는 월별 모드에서 표시됩니다.</span>
              )}
            </h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                {isMonthMode ? (
                  <ComposedChart data={cacLtvChartData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#23252A" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#8A8F98' }} />
                    <YAxis
                      yAxisId="left"
                      tick={{ fontSize: 10, fill: '#8A8F98' }}
                      tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 10000)}만` : String(v))}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fontSize: 10, fill: '#F0BF00' }}
                      tickFormatter={(v: number) => `${v.toFixed(1)}x`}
                    />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: '#141516', border: '1px solid #23252A', borderRadius: 8, fontSize: 11 }}
                      labelStyle={{ color: '#D0D6E0' }}
                      formatter={(value: any, name: any) =>
                        name === 'LTV/CAC' ? [`${Number(value).toFixed(2)}x`, name] : [fmtWon(Number(value)), name]
                      }
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line yAxisId="left" type="monotone" dataKey="cac" name="CAC" stroke="#EB5757" strokeWidth={2} />
                    <Line yAxisId="left" type="monotone" dataKey="ltv" name="LTV" stroke="#27A644" strokeWidth={2} />
                    <Line yAxisId="right" type="monotone" dataKey="ltv_cac" name="LTV/CAC" stroke="#F0BF00" strokeWidth={2} strokeDasharray="4 4" />
                    {latestGoal?.target_cac != null && (
                      <ReferenceLine yAxisId="left" y={latestGoal.target_cac} stroke="#EB5757" strokeDasharray="3 3"
                        label={{ value: '목표 CAC', fontSize: 10, fill: '#EB5757', position: 'insideTopRight' }} />
                    )}
                    {latestGoal?.target_ltv != null && (
                      <ReferenceLine yAxisId="left" y={latestGoal.target_ltv} stroke="#27A644" strokeDasharray="3 3"
                        label={{ value: '목표 LTV', fontSize: 10, fill: '#27A644', position: 'insideTopRight' }} />
                    )}
                    {latestGoal?.target_ltv_cac != null && (
                      <ReferenceLine yAxisId="right" y={latestGoal.target_ltv_cac} stroke="#F0BF00" strokeDasharray="3 3"
                        label={{ value: '목표 LTV/CAC', fontSize: 10, fill: '#F0BF00', position: 'insideBottomRight' }} />
                    )}
                  </ComposedChart>
                ) : (
                  <LineChart data={cacLtvChartData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#23252A" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#8A8F98' }} />
                    <YAxis
                      tick={{ fontSize: 10, fill: '#8A8F98' }}
                      tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 10000)}만` : String(v))}
                    />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: '#141516', border: '1px solid #23252A', borderRadius: 8, fontSize: 11 }}
                      labelStyle={{ color: '#D0D6E0' }}
                      formatter={(value: any, name: any) => [fmtWon(Number(value)), name]}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="cac" name="CAC" stroke="#EB5757" strokeWidth={2} />
                  </LineChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>

          {/* 자사몰 지표 추이 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-[#0F1011] border border-[#23252A] rounded-xl p-4">
              <h3 className="text-sm font-semibold text-[#D0D6E0] mb-3 flex items-center gap-1.5">
                <Users size={14} className="text-[#4EA7FC]" />
                신규 고객수 vs 목표
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={newCustomersChartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#23252A" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#8A8F98' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#8A8F98' }} />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: '#141516', border: '1px solid #23252A', borderRadius: 8, fontSize: 11 }}
                      labelStyle={{ color: '#D0D6E0' }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="new_customers" name="신규 고객수" fill="#4EA7FC" radius={[3, 3, 0, 0]} maxBarSize={30} />
                    <Line type="monotone" dataKey="target" name="목표" stroke="#F0BF00" strokeWidth={2} strokeDasharray="4 4" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-[#0F1011] border border-[#23252A] rounded-xl p-4">
              <h3 className="text-sm font-semibold text-[#D0D6E0] mb-3 flex items-center gap-1.5">
                <DollarSign size={14} className="text-[#27A644]" />
                매출 & AOV
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={revenueAovChartData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#23252A" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#8A8F98' }} />
                    <YAxis
                      yAxisId="left"
                      tick={{ fontSize: 10, fill: '#8A8F98' }}
                      tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 10000)}만` : String(v))}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fontSize: 10, fill: '#7070FF' }}
                      tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 10000)}만` : String(v))}
                    />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: '#141516', border: '1px solid #23252A', borderRadius: 8, fontSize: 11 }}
                      labelStyle={{ color: '#D0D6E0' }}
                      formatter={(value: any, name: any) => [fmtWon(Number(value)), name]}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="left" dataKey="revenue" name="매출" fill="#27A644" radius={[3, 3, 0, 0]} maxBarSize={30} />
                    <Line yAxisId="right" type="monotone" dataKey="aov" name="AOV" stroke="#7070FF" strokeWidth={2} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-[#0F1011] border border-[#23252A] rounded-xl p-4 md:col-span-2">
              <h3 className="text-sm font-semibold text-[#D0D6E0] mb-3 flex items-center gap-1.5">
                <Percent size={14} className="text-[#F2994A]" />
                방문자수 & 구매전환율
                <span className="text-[10px] font-normal text-[#62666D]">전환율 = 주문수 ÷ 방문자수 (카페24 접속통계 자동)</span>
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={conversionChartData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#23252A" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#8A8F98' }} />
                    <YAxis
                      yAxisId="visits"
                      tick={{ fontSize: 10, fill: '#8A8F98' }}
                      tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 10000)}만` : String(v))}
                    />
                    <YAxis
                      yAxisId="rate"
                      orientation="right"
                      tick={{ fontSize: 10, fill: '#F2994A' }}
                      tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                    />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: '#141516', border: '1px solid #23252A', borderRadius: 8, fontSize: 11 }}
                      labelStyle={{ color: '#D0D6E0' }}
                      formatter={(value: any, name: any) => {
                        if (name === '방문자수') return [Number(value).toLocaleString('ko-KR'), name];
                        return [`${Number(value).toFixed(2)}%`, name];
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="visits" dataKey="visits" name="방문자수" fill="#4EA7FC" opacity={0.6} radius={[3, 3, 0, 0]} maxBarSize={30} />
                    <Line yAxisId="rate" type="monotone" dataKey="conversion_rate" name="구매전환율" stroke="#F2994A" strokeWidth={2} />
                    <Line yAxisId="rate" type="monotone" dataKey="target" name="목표 전환율" stroke="#F0BF00" strokeWidth={2} strokeDasharray="4 4" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* 네이버 검색량 추이 */}
          <div className="bg-[#0F1011] border border-[#23252A] rounded-xl p-4">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <h3 className="text-sm font-semibold text-[#D0D6E0] flex items-center gap-1.5">
                <Search size={14} className="text-[#03C75A]" />
                네이버 검색량 추이
                {naverData && (
                  <span className="text-[10px] font-normal text-[#62666D]">
                    {naverData.isAbsolute ? '월간 검색량(추정)' : '상대지수'}
                  </span>
                )}
              </h3>
              <div className="flex items-center gap-2">
                <input
                  value={keywordsInput}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setKeywordsInput(e.target.value)}
                  placeholder="키워드 (쉼표 구분, 최대 5개)"
                  className="px-3 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] w-64 focus:outline-none focus:border-[#5E6AD2]"
                />
                <button
                  onClick={() => refetchNaver()}
                  disabled={naverLoading}
                  className="flex items-center gap-1 px-3 py-1.5 bg-[#5E6AD2] text-white text-xs font-medium rounded-lg hover:bg-[#828FFF] disabled:opacity-50"
                >
                  {naverLoading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />} 조회
                </button>
              </div>
            </div>

            {naverData?.isAbsolute && naverData.volumes && (
              <div className="flex items-center gap-1.5 flex-wrap mb-3">
                {Object.entries(naverData.volumes).map(([kw, v]) => (
                  <span
                    key={kw}
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#03C75A]/15 text-[#03C75A] whitespace-nowrap"
                  >
                    {kw} 최근 검색량 {v.total.toLocaleString('ko-KR')}회
                  </span>
                ))}
              </div>
            )}

            {naverIs503 ? (
              <p className="text-xs text-[#8A8F98] py-6 text-center">네이버 데이터랩 연동이 설정되어 있지 않습니다.</p>
            ) : naverIsError ? (
              <p className="text-xs text-[#EB5757] py-6 text-center">검색량 데이터를 불러오지 못했습니다.</p>
            ) : naverLoading ? (
              <div className="flex items-center justify-center h-40">
                <Loader2 size={24} className="animate-spin text-[#7070FF]" />
              </div>
            ) : (naverData?.series?.length ?? 0) === 0 ? (
              <p className="text-xs text-[#62666D] py-6 text-center">검색량 데이터가 없습니다.</p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={naverData?.series ?? []} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#23252A" />
                    <XAxis dataKey="period" tick={{ fontSize: 10, fill: '#8A8F98' }} />
                    <YAxis
                      tick={{ fontSize: 10, fill: '#8A8F98' }}
                      tickFormatter={(v: number) =>
                        naverData?.isAbsolute
                          ? (v >= 10000 ? `${Math.round(v / 10000)}만` : v.toLocaleString('ko-KR'))
                          : String(v)
                      }
                    />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: '#141516', border: '1px solid #23252A', borderRadius: 8, fontSize: 11 }}
                      labelStyle={{ color: '#D0D6E0' }}
                      formatter={(value: any, name: any) =>
                        naverData?.isAbsolute ? [`${Number(value).toLocaleString('ko-KR')}회`, name] : [value, name]
                      }
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {(naverData?.keywords ?? keywordsList).map((kw: string, i: number) => (
                      <Line key={kw} type="monotone" dataKey={kw} name={kw} stroke={LINE_PALETTE[i % LINE_PALETTE.length]} strokeWidth={2} dot={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* 목표 설정 폼 (월별 모드 전용) */}
          {isMonthMode && (
            <div className="bg-[#0F1011] border border-[#23252A] rounded-xl p-4">
              <button onClick={() => setGoalFormOpen((v) => !v)} className="w-full flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[#D0D6E0] flex items-center gap-1.5">
                  <Target size={14} className="text-[#7070FF]" />
                  목표 설정
                </h3>
                {goalFormOpen ? <ChevronDown size={16} className="text-[#8A8F98]" /> : <ChevronRight size={16} className="text-[#8A8F98]" />}
              </button>
              {goalFormOpen && (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-[#8A8F98] w-20">대상 월</label>
                    <input
                      type="month"
                      value={goalMonth}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => setGoalMonth(e.target.value)}
                      className="px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
                    />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <GoalInput label="목표 CAC (₩)" value={targetCac} onChange={setTargetCac} />
                    <GoalInput label="목표 LTV (₩)" value={targetLtv} onChange={setTargetLtv} />
                    <GoalInput label="목표 LTV/CAC" value={targetLtvCac} onChange={setTargetLtvCac} step="0.01" />
                    <GoalInput label="목표 구매전환율 (%)" value={targetConversionRate} onChange={setTargetConversionRate} step="0.01" />
                    <GoalInput label="목표 AOV (₩)" value={targetAov} onChange={setTargetAov} />
                    <GoalInput label="목표 신규 고객수" value={targetNewCustomers} onChange={setTargetNewCustomers} />
                    <GoalInput label="실적 구매전환율 (%)" value={actualConversionRate} onChange={setActualConversionRate} step="0.01" />
                  </div>
                  <div>
                    <label className="text-xs text-[#8A8F98] block mb-1">메모</label>
                    <textarea
                      value={goalMemo}
                      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setGoalMemo(e.target.value)}
                      rows={2}
                      className="w-full bg-[#08090A] border border-[#23252A] rounded-lg px-3 py-2 text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
                    />
                  </div>
                  <button
                    onClick={handleSaveGoal}
                    disabled={updateGoalMutation.isPending}
                    className="flex items-center gap-1.5 px-4 py-2 bg-[#5E6AD2] text-white text-sm font-medium rounded-lg hover:bg-[#828FFF] disabled:opacity-50 transition-all"
                  >
                    {updateGoalMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} 저장
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* 인플루언서 시딩 */}
      <InfluencerSeedingCard />
    </div>
  );
}

// ─── 인플루언서 시딩 카드 ───

function InfluencerChannelBadge({ channel }: { channel: string }) {
  const color = INFLUENCER_CHANNEL_COLORS[channel] || '#8A8F98';
  const label = INFLUENCER_CHANNEL_LABELS[channel] || channel;
  return (
    <span
      className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ backgroundColor: `${color}26`, color }}
    >
      {label}
    </span>
  );
}

function segmentTickFormatter(v: string): string {
  return v && v.length > 12 ? `${v.slice(0, 12)}…` : v;
}

function InfluencerSeedingCard() {
  const queryClient = useQueryClient();
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const {
    data: seedings, isLoading: seedingsLoading, isError: seedingsError,
  } = useQuery({
    queryKey: ['influencer-seedings'],
    queryFn: () => influencerApi.listSeedings(undefined, 200),
    staleTime: 60 * 1000,
  });

  const { data: summary } = useQuery({
    queryKey: ['influencer-summary'],
    queryFn: () => influencerApi.getSummary(12),
    staleTime: 60 * 1000,
  });

  const createMutation = useMutation({
    mutationFn: (payload: InfluencerSeedingCreatePayload) => influencerApi.createSeeding(payload),
    onSuccess: () => {
      toast.success('시딩이 등록되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['influencer-seedings'] });
      queryClient.invalidateQueries({ queryKey: ['influencer-summary'] });
      setName(''); setUrl(''); setCost(''); setProduct(''); setSeededAt(todayStr);
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || '등록 실패'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => influencerApi.deleteSeeding(id),
    onSuccess: () => {
      toast.success('삭제되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['influencer-seedings'] });
      queryClient.invalidateQueries({ queryKey: ['influencer-summary'] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || '삭제 실패'),
  });

  const analyzeMutation = useMutation({
    mutationFn: (id: number) => influencerApi.analyzeSeeding(id),
    onSuccess: () => {
      toast.success('AI 분석이 완료되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['influencer-seedings'] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'AI 분석 실패'),
  });

  const [name, setName] = useState('');
  const [channel, setChannel] = useState<InfluencerChannel>('instagram');
  const [url, setUrl] = useState('');
  const [cost, setCost] = useState('');
  const [seededAt, setSeededAt] = useState(todayStr);
  const [product, setProduct] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const handleAdd = () => {
    if (!name.trim()) { toast.error('이름을 입력해주세요.'); return; }
    if (!seededAt) { toast.error('시딩 일자를 입력해주세요.'); return; }
    createMutation.mutate({
      name: name.trim(),
      channel,
      url: url.trim() || undefined,
      cost: cost.trim() === '' ? undefined : parseFloat(cost),
      seeded_at: seededAt,
      product: product.trim() || undefined,
    });
  };

  const handleExport = async () => {
    try {
      await downloadFile('/influencer/export');
    } catch {
      toast.error('엑셀 다운로드에 실패했습니다.');
    }
  };

  const rows = useMemo(
    () => [...(seedings ?? [])].sort((a, b) => (a.seeded_at < b.seeded_at ? 1 : -1)),
    [seedings],
  );

  const byChannelData = summary?.by_channel ?? [];
  const bySegmentData = summary?.by_segment ?? [];
  const byMonthData = (summary?.by_month ?? []).map((m) => ({ ...m, monthLabel: shortMonth(m.month) }));

  return (
    <div className="bg-[#0F1011] border border-[#23252A] rounded-xl p-4">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-[#D0D6E0] flex items-center gap-1.5">
            <Megaphone size={14} className="text-[#E1306C]" />
            인플루언서 시딩
          </h3>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <span className="text-xs text-[#8A8F98]">
              총 비용 <b className="text-[#F7F8F8]">{fmtWon(summary?.total?.cost ?? 0)}</b>
            </span>
            <span className="text-xs text-[#8A8F98]">
              총 건수 <b className="text-[#F7F8F8]">{fmtNum(summary?.total?.count ?? 0)}건</b>
            </span>
            <span className="text-xs text-[#8A8F98]">
              분석완료 <b className="text-[#F7F8F8]">{fmtNum(summary?.total?.analyzed_count ?? 0)}건</b>
            </span>
          </div>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 px-3 py-2 border border-[#23252A] rounded-lg text-sm text-[#D0D6E0] hover:bg-[#141516] transition-all"
        >
          <Download size={14} /> 엑셀
        </button>
      </div>

      {/* 등록 폼 */}
      <div className="flex items-center gap-2 flex-wrap mb-4 pb-4 border-b border-[#23252A]">
        <input
          value={name}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
          placeholder="이름"
          className="w-32 px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
        />
        <select
          value={channel}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setChannel(e.target.value as InfluencerChannel)}
          className="px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
        >
          {INFLUENCER_CHANNEL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <input
          value={url}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
          placeholder="URL"
          className="w-40 px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
        />
        <input
          value={cost}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setCost(e.target.value)}
          type="number"
          placeholder="비용"
          className="w-24 px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
        />
        <input
          value={seededAt}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setSeededAt(e.target.value)}
          type="date"
          className="px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
        />
        <input
          value={product}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setProduct(e.target.value)}
          placeholder="제품"
          className="w-32 px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
        />
        <button
          onClick={handleAdd}
          disabled={createMutation.isPending}
          className="flex items-center gap-1 px-3 py-1.5 bg-[#5E6AD2] text-white text-xs font-medium rounded-lg hover:bg-[#828FFF] disabled:opacity-50"
        >
          {createMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} 추가
        </button>
      </div>

      {/* 목록 테이블 */}
      {seedingsLoading ? (
        <div className="flex items-center justify-center h-24">
          <Loader2 size={24} className="animate-spin text-[#7070FF]" />
        </div>
      ) : seedingsError ? (
        <p className="text-xs text-[#EB5757] py-6 text-center">시딩 데이터를 불러오지 못했습니다.</p>
      ) : (
        <div className="overflow-x-auto mb-4">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#23252A] text-[10px] text-[#62666D] uppercase tracking-wide">
                <th className="px-3 py-2">일자</th>
                <th className="px-3 py-2">이름</th>
                <th className="px-3 py-2">채널</th>
                <th className="px-3 py-2">팔로워</th>
                <th className="px-3 py-2">비용</th>
                <th className="px-3 py-2">제품</th>
                <th className="px-3 py-2">AI 타겟</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((item: InfluencerSeeding) => {
                const isAnalyzing = analyzeMutation.isPending && analyzeMutation.variables === item.id;
                const isExpanded = expandedId === item.id;
                return (
                  <Fragment key={item.id}>
                    <tr
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      className="border-b border-[#23252A] hover:bg-[#141516]/40 cursor-pointer"
                    >
                      <td className="px-3 py-2 text-xs text-[#8A8F98] whitespace-nowrap">{item.seeded_at}</td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap">
                        {item.url ? (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-[#4EA7FC] hover:underline inline-flex items-center gap-1"
                          >
                            {item.name} <ExternalLink size={10} />
                          </a>
                        ) : (
                          <span className="text-[#D0D6E0]">{item.name}</span>
                        )}
                      </td>
                      <td className="px-3 py-2"><InfluencerChannelBadge channel={item.channel} /></td>
                      <td className="px-3 py-2 text-xs text-[#D0D6E0] whitespace-nowrap">{fmtNum(item.follower_count ?? null)}</td>
                      <td className="px-3 py-2 text-xs text-[#D0D6E0] whitespace-nowrap">{fmtWon(item.cost ?? null)}</td>
                      <td className="px-3 py-2 text-xs text-[#D0D6E0] whitespace-nowrap">{item.product || '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {item.ai_target_segment ? (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#7070FF]/15 text-[#7070FF]">
                            {item.ai_target_segment}
                          </span>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); analyzeMutation.mutate(item.id); }}
                            disabled={isAnalyzing}
                            className="flex items-center gap-1 px-2 py-1 border border-[#23252A] rounded-lg text-[10px] text-[#D0D6E0] hover:bg-[#141516] disabled:opacity-50"
                          >
                            {isAnalyzing ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                            {isAnalyzing ? '분석 중...' : 'AI 분석'}
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(item.id); }}
                          className="text-[#8A8F98] hover:text-[#EB5757] transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b border-[#23252A] bg-[#141516]/30">
                        <td colSpan={8} className="px-3 py-3 text-xs text-[#8A8F98] leading-relaxed">
                          {item.ai_audience_summary || (item.notes ? item.notes : '오디언스 요약이 없습니다. AI 분석을 실행해주세요.')}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-xs text-[#62666D]">
                    등록된 시딩이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 채널별 / 세그먼트별 비용 차트 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-[#08090A] border border-[#23252A] rounded-xl p-3">
          <h4 className="text-xs font-semibold text-[#D0D6E0] mb-2">채널별 시딩 비용</h4>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byChannelData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#23252A" />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fill: '#8A8F98' }}
                  tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 10000)}만` : String(v))}
                />
                <YAxis
                  type="category"
                  dataKey="channel"
                  tick={{ fontSize: 10, fill: '#8A8F98' }}
                  tickFormatter={(v: string) => INFLUENCER_CHANNEL_LABELS[v] || v}
                  width={64}
                />
                <RechartsTooltip
                  contentStyle={{ backgroundColor: '#141516', border: '1px solid #23252A', borderRadius: 8, fontSize: 11 }}
                  labelStyle={{ color: '#D0D6E0' }}
                  formatter={(value: any) => [fmtWon(Number(value)), '비용']}
                  labelFormatter={(v: string) => INFLUENCER_CHANNEL_LABELS[v] || v}
                />
                <Bar dataKey="total_cost" radius={[0, 3, 3, 0]} maxBarSize={20}>
                  {byChannelData.map((d, i) => (
                    <Cell key={`ch-${i}`} fill={INFLUENCER_CHANNEL_COLORS[d.channel] || '#8A8F98'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-[#08090A] border border-[#23252A] rounded-xl p-3">
          <h4 className="text-xs font-semibold text-[#D0D6E0] mb-2">타겟 세그먼트별 비용</h4>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bySegmentData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#23252A" />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fill: '#8A8F98' }}
                  tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 10000)}만` : String(v))}
                />
                <YAxis
                  type="category"
                  dataKey="segment"
                  tick={{ fontSize: 10, fill: '#8A8F98' }}
                  tickFormatter={segmentTickFormatter}
                  width={80}
                />
                <RechartsTooltip
                  contentStyle={{ backgroundColor: '#141516', border: '1px solid #23252A', borderRadius: 8, fontSize: 11 }}
                  labelStyle={{ color: '#D0D6E0' }}
                  formatter={(value: any) => [fmtWon(Number(value)), '비용']}
                />
                <Bar dataKey="total_cost" fill="#7070FF" radius={[0, 3, 3, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 월별 시딩 비용 추이 */}
      <div className="bg-[#08090A] border border-[#23252A] rounded-xl p-3 mt-4">
        <h4 className="text-xs font-semibold text-[#D0D6E0] mb-2">월별 시딩 비용 추이</h4>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byMonthData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#23252A" />
              <XAxis dataKey="monthLabel" tick={{ fontSize: 10, fill: '#8A8F98' }} />
              <YAxis
                tick={{ fontSize: 10, fill: '#8A8F98' }}
                tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 10000)}만` : String(v))}
              />
              <RechartsTooltip
                contentStyle={{ backgroundColor: '#141516', border: '1px solid #23252A', borderRadius: 8, fontSize: 11 }}
                labelStyle={{ color: '#D0D6E0' }}
                formatter={(value: any) => [fmtWon(Number(value)), '비용']}
              />
              <Bar dataKey="total_cost" fill="#E1306C" radius={[3, 3, 0, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
