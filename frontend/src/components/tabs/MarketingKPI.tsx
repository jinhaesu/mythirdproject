'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, DollarSign, Download,
  Layers, Loader2, Percent, Plus, RefreshCw, ShoppingCart, Target,
  Trash2, TrendingUp, Users,
} from 'lucide-react';
import {
  Bar, LineChart, Line, ComposedChart, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import { downloadFile, kpiApi } from '@/lib/api';
import type {
  KPIChannelSpend, KPIChannelSpendUpdatePayload, KPIGoal, KPIGoalUpdatePayload,
  KPIGranularity, KPIMonthSummary,
} from '@/lib/api';
import {
  CHANNEL_COLORS, CHANNEL_LABELS,
  achievementBadge, bucketLabel, fmtNum, fmtPercent, fmtRatio, fmtWon, targetText,
} from './kpi/format';
import { SignupHeatmapCard } from './kpi/SignupHeatmapCard';
import { DemographicsCard } from './kpi/DemographicsCard';

// ─── Constants ───

// 자사몰 화면: naver_sa/naver_gfa는 「그 외 마케팅 KPI」 탭으로 이동, meta는 자동 계산 + 수동 채널만 관리
const CHANNEL_KEYS = ['meta', 'kakao', 'google', 'etc'] as const;

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
    <div className="bg-bg-1 border border-border-primary rounded-xl p-3">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <div className="p-1 rounded-lg bg-brand/10 text-accent">{icon}</div>
          <span className="text-xs text-text-tertiary">{label}</span>
        </div>
        {showTarget && (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${badge.color}`}>
            {badge.label}
          </span>
        )}
      </div>
      {unavailable ? (
        <p className="text-xs text-yellow leading-snug mt-1.5">
          주문 데이터 없음<br />백필 필요
        </p>
      ) : (
        <>
          <p className="text-lg font-bold text-text-primary">{value}</p>
          {showTarget && <p className="text-[11px] text-text-quaternary mt-0.5">{targetLabel}</p>}
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
      <label className="text-xs text-text-tertiary block mb-1">{label}</label>
      <input
        type="number"
        step={step || '1'}
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        placeholder="미입력"
        className="w-full bg-bg-0 border border-border-primary rounded-lg px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-brand"
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
    <tr className="border-b border-border-primary hover:bg-bg-2/40">
      <td className="px-3 py-2 text-xs text-text-tertiary whitespace-nowrap">{month}</td>
      <td className="px-3 py-2 text-xs whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ background: CHANNEL_COLORS[item.channel] || '#8A8F98' }} />
          <span className="text-text-secondary">{CHANNEL_LABELS[item.channel] || item.channel}</span>
        </span>
      </td>
      <td className="px-3 py-2">
        <input
          value={planned}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setPlanned(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          type="number"
          className="w-28 bg-bg-0 border border-border-primary rounded-lg px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-brand"
          placeholder="0"
        />
      </td>
      <td className="px-3 py-2">
        {isAutoMeta ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-xs text-text-tertiary">{fmtWon(autoValue ?? null)}</span>
            <span className="text-[9px] font-semibold bg-blue/15 text-blue px-1.5 py-0.5 rounded-full">자동</span>
          </span>
        ) : (
          <input
            value={actual}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setActual(e.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
            type="number"
            className="w-28 bg-bg-0 border border-border-primary rounded-lg px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-brand"
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
          className="w-40 bg-bg-0 border border-border-primary rounded-lg px-2 py-1 text-xs text-text-secondary focus:outline-none focus:border-brand"
          placeholder="메모"
        />
      </td>
      <td className="px-3 py-2 text-right">
        {item.id != null && (
          <button onClick={() => onDelete(item.id!)} className="text-text-tertiary hover:text-red transition-colors">
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
    const row: Record<string, number | string | null> = { month: bucketLabel(m, granularity) };
    CHANNEL_KEYS.forEach((ch) => {
      if (ch === 'meta') {
        row.meta = m.meta_spend ?? 0;
      } else {
        const cs = m.channel_spends.find((c) => c.channel === ch);
        row[ch] = cs ? (cs.actual_amount ?? cs.planned_amount ?? 0) : 0;
      }
    });
    row.revenue = m.mall?.revenue ?? null;
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
    avg_orders: m.mall?.avg_orders_per_customer ?? null,
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
          <h2 className="text-xl font-bold text-text-primary">자사몰 마케팅 KPI</h2>
          <p className="text-xs text-text-tertiary mt-1">채널별 광고비, CAC/LTV, 자사몰 지표를 한눈에 관리합니다.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center bg-bg-2 rounded-lg p-0.5">
            {([
              { key: 'month', label: '월별' },
              { key: 'week', label: '주별' },
              { key: 'day', label: '일별' },
            ] as const).map((g) => (
              <button
                key={g.key}
                onClick={() => setGranularity(g.key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  granularity === g.key ? 'bg-bg-1 text-accent shadow-[0px_1px_3px_rgba(0,0,0,0.2)]' : 'text-text-tertiary hover:text-text-secondary'
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
          <div className="flex items-center bg-bg-2 rounded-lg p-0.5">
            {isMonthMode ? (
              ([3, 6, 12] as const).map((n) => (
                <button
                  key={n}
                  onClick={() => setMonthsRange(n)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    monthsRange === n ? 'bg-bg-1 text-accent shadow-[0px_1px_3px_rgba(0,0,0,0.2)]' : 'text-text-tertiary hover:text-text-secondary'
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
                    daysRange === d.v ? 'bg-bg-1 text-accent shadow-[0px_1px_3px_rgba(0,0,0,0.2)]' : 'text-text-tertiary hover:text-text-secondary'
                  }`}
                >
                  최근 {d.label}
                </button>
              ))
            )}
          </div>
          <button
            onClick={handleExportKpi}
            className="flex items-center gap-1.5 px-3 py-2 border border-border-primary rounded-lg text-sm text-text-secondary hover:bg-bg-2 transition-all"
          >
            <Download size={14} /> 엑셀
          </button>
          <button
            onClick={() => backfillMutation.mutate()}
            disabled={backfillMutation.isPending}
            className="flex items-center gap-1.5 px-4 py-2 bg-brand text-white text-sm font-medium rounded-lg hover:bg-accent-hover disabled:opacity-50 transition-all"
          >
            {backfillMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {backfillMutation.isPending ? '백필 중...' : '주문 백필'}
          </button>
        </div>
      </div>

      {summaryLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 size={32} className="animate-spin text-accent" />
          <span className="ml-3 text-text-tertiary">KPI 데이터 로딩 중...</span>
        </div>
      ) : summaryError ? (
        <div className="flex items-center justify-center h-40">
          <div className="text-center">
            <AlertTriangle size={32} className="text-red mx-auto mb-2" />
            <p className="text-sm text-text-tertiary mb-3">KPI 데이터를 불러오지 못했습니다.</p>
            <button onClick={() => refetchSummary()} className="text-xs bg-brand text-white px-4 py-2 rounded-lg hover:bg-accent-hover">
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
          <div className="bg-bg-1 border border-border-primary rounded-xl p-4">
            <h3 className="text-sm font-semibold text-text-secondary mb-3 flex items-center gap-1.5">
              <Layers size={14} className="text-blue" />
              채널 광고비
              <span className="text-[10px] font-normal text-text-quaternary">우측 축: 자사몰 매출</span>
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={channelChartData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }} />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }}
                    tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 10000)}만` : String(v))}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 10, fill: 'var(--color-green)' }}
                    tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 10000)}만` : String(v))}
                  />
                  <RechartsTooltip
                    contentStyle={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)', borderRadius: 8, fontSize: 11 }}
                    labelStyle={{ color: 'var(--color-text-secondary)' }}
                    formatter={(value: any, name: any) => [
                      fmtWon(Number(value)),
                      name === 'revenue' ? '자사몰 매출' : (CHANNEL_LABELS[name as string] || name),
                    ]}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11 }}
                    formatter={(value: string) => (value === 'revenue' ? '자사몰 매출' : (CHANNEL_LABELS[value] || value))}
                  />
                  {CHANNEL_KEYS.map((ch) => (
                    <Bar key={ch} yAxisId="left" dataKey={ch} name={ch} stackId="spend" fill={CHANNEL_COLORS[ch]} />
                  ))}
                  <Line yAxisId="right" type="monotone" dataKey="revenue" name="revenue" stroke="var(--color-green)" strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {isMonthMode && (
              <>
                <div className="overflow-x-auto mt-4">
                  <table className="w-full min-w-[640px] text-left">
                    <thead>
                      <tr className="border-b border-border-primary text-[10px] text-text-quaternary uppercase tracking-wide">
                        <th className="px-3 py-2 whitespace-nowrap">월</th>
                        <th className="px-3 py-2 whitespace-nowrap">채널</th>
                        <th className="px-3 py-2 whitespace-nowrap">예산</th>
                        <th className="px-3 py-2 whitespace-nowrap">실적</th>
                        <th className="px-3 py-2 whitespace-nowrap">메모</th>
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
                          <td colSpan={6} className="px-3 py-6 text-center text-xs text-text-quaternary">
                            등록된 채널 광고비가 없습니다.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border-primary flex-wrap">
                  <select
                    value={newChannel}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) => setNewChannel(e.target.value)}
                    className="px-2 py-1.5 bg-bg-0 border border-border-primary rounded-lg text-xs text-text-secondary focus:outline-none focus:border-brand"
                  >
                    {CHANNEL_KEYS.map((ch) => (
                      <option key={ch} value={ch}>{CHANNEL_LABELS[ch]}</option>
                    ))}
                  </select>
                  <input
                    type="month"
                    value={newMonth}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setNewMonth(e.target.value)}
                    className="px-2 py-1.5 bg-bg-0 border border-border-primary rounded-lg text-xs text-text-secondary focus:outline-none focus:border-brand"
                  />
                  <button
                    onClick={addSpend}
                    disabled={updateChannelSpendMutation.isPending}
                    className="flex items-center gap-1 px-3 py-1.5 bg-brand text-white text-xs font-medium rounded-lg hover:bg-accent-hover disabled:opacity-50"
                  >
                    <Plus size={12} /> 채널 추가
                  </button>
                </div>
              </>
            )}
          </div>

          {/* CAC / LTV 추이 */}
          <div className="bg-bg-1 border border-border-primary rounded-xl p-4">
            <h3 className="text-sm font-semibold text-text-secondary mb-3 flex items-center gap-1.5">
              <TrendingUp size={14} className="text-accent" />
              {isMonthMode ? 'CAC·LTV·평균 구매횟수 추이' : 'CAC·평균 구매횟수 추이'}
              {!isMonthMode && (
                <span className="text-[10px] font-normal text-text-quaternary">LTV·목표는 월별 모드에서 표시됩니다.</span>
              )}
            </h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                {isMonthMode ? (
                  <ComposedChart data={cacLtvChartData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }} />
                    <YAxis
                      yAxisId="left"
                      tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }}
                      tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 10000)}만` : String(v))}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fontSize: 10, fill: 'var(--color-yellow)' }}
                      tickFormatter={(v: number) => `${v.toFixed(1)}x`}
                    />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)', borderRadius: 8, fontSize: 11 }}
                      labelStyle={{ color: 'var(--color-text-secondary)' }}
                      formatter={(value: any, name: any) =>
                        name === 'LTV/CAC' ? [`${Number(value).toFixed(2)}x`, name]
                          : name === '평균 구매횟수' ? [`${Number(value).toFixed(2)}회`, name]
                            : [fmtWon(Number(value)), name]
                      }
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line yAxisId="left" type="monotone" dataKey="cac" name="CAC" stroke="var(--color-red)" strokeWidth={2} />
                    <Line yAxisId="left" type="monotone" dataKey="ltv" name="LTV" stroke="var(--color-green)" strokeWidth={2} />
                    <Line yAxisId="right" type="monotone" dataKey="ltv_cac" name="LTV/CAC" stroke="var(--color-yellow)" strokeWidth={2} strokeDasharray="4 4" />
                    <Line yAxisId="right" type="monotone" dataKey="avg_orders" name="평균 구매횟수" stroke="var(--color-blue)" strokeWidth={2} />
                    {latestGoal?.target_cac != null && (
                      <ReferenceLine yAxisId="left" y={latestGoal.target_cac} stroke="var(--color-red)" strokeDasharray="3 3"
                        label={{ value: '목표 CAC', fontSize: 10, fill: 'var(--color-red)', position: 'insideTopRight' }} />
                    )}
                    {latestGoal?.target_ltv != null && (
                      <ReferenceLine yAxisId="left" y={latestGoal.target_ltv} stroke="var(--color-green)" strokeDasharray="3 3"
                        label={{ value: '목표 LTV', fontSize: 10, fill: 'var(--color-green)', position: 'insideTopRight' }} />
                    )}
                    {latestGoal?.target_ltv_cac != null && (
                      <ReferenceLine yAxisId="right" y={latestGoal.target_ltv_cac} stroke="var(--color-yellow)" strokeDasharray="3 3"
                        label={{ value: '목표 LTV/CAC', fontSize: 10, fill: 'var(--color-yellow)', position: 'insideBottomRight' }} />
                    )}
                  </ComposedChart>
                ) : (
                  <LineChart data={cacLtvChartData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }} />
                    <YAxis
                      yAxisId="left"
                      tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }}
                      tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 10000)}만` : String(v))}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fontSize: 10, fill: 'var(--color-blue)' }}
                      tickFormatter={(v: number) => `${v.toFixed(1)}회`}
                    />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)', borderRadius: 8, fontSize: 11 }}
                      labelStyle={{ color: 'var(--color-text-secondary)' }}
                      formatter={(value: any, name: any) =>
                        name === '평균 구매횟수' ? [`${Number(value).toFixed(2)}회`, name] : [fmtWon(Number(value)), name]
                      }
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line yAxisId="left" type="monotone" dataKey="cac" name="CAC" stroke="var(--color-red)" strokeWidth={2} />
                    <Line yAxisId="right" type="monotone" dataKey="avg_orders" name="평균 구매횟수" stroke="var(--color-blue)" strokeWidth={2} />
                  </LineChart>
                )}
              </ResponsiveContainer>
            </div>
            <p className="text-[10px] text-text-quaternary mt-2 leading-relaxed">
              <b className="text-text-tertiary">계산 기준</b> — CAC = 총광고비(메타 자동 + 수동 채널) ÷ 신규고객(사상 첫 결제 회원) ·
              LTV = 기간 말일 기준 최근 180일 결제 회원 1인당 평균 매출(실현 매출 트레일링) ·
              평균 구매횟수 = 해당 기간 회원 주문수 ÷ 구매 회원수(비회원 주문 제외)
            </p>
          </div>

          {/* 회원가입 히트맵 + 연령·성별 인구통계 */}
          <SignupHeatmapCard />
          <DemographicsCard />

          {/* 자사몰 지표 추이 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-bg-1 border border-border-primary rounded-xl p-4">
              <h3 className="text-sm font-semibold text-text-secondary mb-3 flex items-center gap-1.5">
                <Users size={14} className="text-blue" />
                신규 고객수 vs 목표
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={newCustomersChartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }} />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }} />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)', borderRadius: 8, fontSize: 11 }}
                      labelStyle={{ color: 'var(--color-text-secondary)' }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="new_customers" name="신규 고객수" fill="var(--color-blue)" radius={[3, 3, 0, 0]} maxBarSize={30} />
                    <Line type="monotone" dataKey="target" name="목표" stroke="var(--color-yellow)" strokeWidth={2} strokeDasharray="4 4" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-bg-1 border border-border-primary rounded-xl p-4">
              <h3 className="text-sm font-semibold text-text-secondary mb-3 flex items-center gap-1.5">
                <DollarSign size={14} className="text-green" />
                매출 & AOV
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={revenueAovChartData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }} />
                    <YAxis
                      yAxisId="left"
                      tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }}
                      tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 10000)}만` : String(v))}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fontSize: 10, fill: 'var(--color-link-primary)' }}
                      tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 10000)}만` : String(v))}
                    />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)', borderRadius: 8, fontSize: 11 }}
                      labelStyle={{ color: 'var(--color-text-secondary)' }}
                      formatter={(value: any, name: any) => [fmtWon(Number(value)), name]}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="left" dataKey="revenue" name="매출" fill="var(--color-green)" radius={[3, 3, 0, 0]} maxBarSize={30} />
                    <Line yAxisId="right" type="monotone" dataKey="aov" name="AOV" stroke="var(--color-link-primary)" strokeWidth={2} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-bg-1 border border-border-primary rounded-xl p-4 md:col-span-2">
              <h3 className="text-sm font-semibold text-text-secondary mb-3 flex items-center gap-1.5">
                <Percent size={14} className="text-[#F2994A]" />
                방문자수 & 구매전환율
                <span className="text-[10px] font-normal text-text-quaternary">전환율 = 주문수 ÷ 방문자수 (카페24 접속통계 자동)</span>
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={conversionChartData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }} />
                    <YAxis
                      yAxisId="visits"
                      tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }}
                      tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 10000)}만` : String(v))}
                    />
                    <YAxis
                      yAxisId="rate"
                      orientation="right"
                      tick={{ fontSize: 10, fill: '#F2994A' }}
                      tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                    />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)', borderRadius: 8, fontSize: 11 }}
                      labelStyle={{ color: 'var(--color-text-secondary)' }}
                      formatter={(value: any, name: any) => {
                        if (name === '방문자수') return [Number(value).toLocaleString('ko-KR'), name];
                        return [`${Number(value).toFixed(2)}%`, name];
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="visits" dataKey="visits" name="방문자수" fill="var(--color-blue)" opacity={0.6} radius={[3, 3, 0, 0]} maxBarSize={30} />
                    <Line yAxisId="rate" type="monotone" dataKey="conversion_rate" name="구매전환율" stroke="#F2994A" strokeWidth={2} />
                    <Line yAxisId="rate" type="monotone" dataKey="target" name="목표 전환율" stroke="var(--color-yellow)" strokeWidth={2} strokeDasharray="4 4" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* 목표 설정 폼 (월별 모드 전용) */}
          {isMonthMode && (
            <div className="bg-bg-1 border border-border-primary rounded-xl p-4">
              <button onClick={() => setGoalFormOpen((v) => !v)} className="w-full flex items-center justify-between">
                <h3 className="text-sm font-semibold text-text-secondary flex items-center gap-1.5">
                  <Target size={14} className="text-accent" />
                  목표 설정
                </h3>
                {goalFormOpen ? <ChevronDown size={16} className="text-text-tertiary" /> : <ChevronRight size={16} className="text-text-tertiary" />}
              </button>
              {goalFormOpen && (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-text-tertiary w-20">대상 월</label>
                    <input
                      type="month"
                      value={goalMonth}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => setGoalMonth(e.target.value)}
                      className="px-2 py-1.5 bg-bg-0 border border-border-primary rounded-lg text-xs text-text-secondary focus:outline-none focus:border-brand"
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
                    <label className="text-xs text-text-tertiary block mb-1">메모</label>
                    <textarea
                      value={goalMemo}
                      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setGoalMemo(e.target.value)}
                      rows={2}
                      className="w-full bg-bg-0 border border-border-primary rounded-lg px-3 py-2 text-xs text-text-secondary focus:outline-none focus:border-brand"
                    />
                  </div>
                  <button
                    onClick={handleSaveGoal}
                    disabled={updateGoalMutation.isPending}
                    className="flex items-center gap-1.5 px-4 py-2 bg-brand text-white text-sm font-medium rounded-lg hover:bg-accent-hover disabled:opacity-50 transition-all"
                  >
                    {updateGoalMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} 저장
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
