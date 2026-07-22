'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Check, AlertTriangle, ChevronDown, ChevronRight, DollarSign, Download,
  Layers, Loader2, Plus, ShoppingCart, Target, Trash2, TrendingUp,
} from 'lucide-react';
import {
  Bar, BarChart, Line, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import { downloadFile, externalKpiApi, kpiApi } from '@/lib/api';
import type {
  KPIChannelSpend, KPIChannelSpendUpdatePayload, KPIExternalGoalUpdatePayload,
  KPIExternalMonthSummary,
} from '@/lib/api';
import {
  CHANNEL_COLORS, CHANNEL_LABELS,
  achievementBadge, fmtNum, fmtWon, targetText,
} from './kpi/format';
import { InfluencerSeedingCard } from './kpi/InfluencerSeedingCard';
import { SponsorshipCard } from './kpi/SponsorshipCard';
import { NaverQueriesCard } from './kpi/NaverQueriesCard';

// 그 외(자사몰 외) 채널: 네이버 SA/GFA 자동 채널 + 수동 채널 (스택 차트/테이블 전체 집계 대상)
const EXTERNAL_CHANNEL_KEYS = ['naver_sa', 'naver_gfa', 'kakao', 'google', 'meta', 'smartstore', 'coupang', 'etc'] as const;

// 채널 추가 폼 셀렉트 옵션 (네이버 SA는 자동 집계라 선택 불가 안내만 표시)
const ADDABLE_CHANNEL_OPTIONS: Array<{ value: string; label: string; disabled?: boolean }> = [
  { value: 'naver_sa', label: '네이버 SA (자동 집계, 선택 불가)', disabled: true },
  { value: 'naver_gfa', label: CHANNEL_LABELS.naver_gfa },
  { value: 'kakao', label: CHANNEL_LABELS.kakao },
  { value: 'google', label: CHANNEL_LABELS.google },
  { value: 'smartstore', label: CHANNEL_LABELS.smartstore },
  { value: 'coupang', label: CHANNEL_LABELS.coupang },
  { value: 'etc', label: CHANNEL_LABELS.etc },
];

const monthLabel = (m: string): string => `${parseInt((m.split('-')[1] || '0'), 10)}월`;

// ─── Small presentational components (자사몰 탭과 동일한 스타일 패턴) ───

function ExternalGoalCard({
  icon, label, value, targetLabel, badge, showTarget = true,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  targetLabel?: string;
  badge?: { label: string; color: string };
  showTarget?: boolean;
}) {
  return (
    <div className="bg-[#0F1011] border border-[#23252A] rounded-xl p-3">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <div className="p-1 rounded-lg bg-[#5E6AD2]/10 text-[#7070FF]">{icon}</div>
          <span className="text-xs text-[#8A8F98]">{label}</span>
        </div>
        {showTarget && badge && (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${badge.color}`}>
            {badge.label}
          </span>
        )}
      </div>
      <p className="text-lg font-bold text-[#F7F8F8]">{value}</p>
      {showTarget && targetLabel && <p className="text-[11px] text-[#62666D] mt-0.5">{targetLabel}</p>}
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

function ExternalChannelSpendRow({
  month, item, onSave, onDelete,
}: {
  month: string;
  item: KPIChannelSpend;
  onSave: (payload: KPIChannelSpendUpdatePayload) => void;
  onDelete: (id: number) => void;
}) {
  const [planned, setPlanned] = useState(item.planned_amount != null ? String(item.planned_amount) : '');
  const [actual, setActual] = useState(item.actual_amount != null ? String(item.actual_amount) : '');
  const [revenue, setRevenue] = useState(item.revenue != null ? String(item.revenue) : '');
  const [views, setViews] = useState(item.views != null ? String(item.views) : '');
  const [memo, setMemo] = useState(item.memo ?? '');

  useEffect(() => {
    setPlanned(item.planned_amount != null ? String(item.planned_amount) : '');
    setActual(item.actual_amount != null ? String(item.actual_amount) : '');
    setRevenue(item.revenue != null ? String(item.revenue) : '');
    setViews(item.views != null ? String(item.views) : '');
    setMemo(item.memo ?? '');
  }, [item.id, item.planned_amount, item.actual_amount, item.revenue, item.views, item.memo]);

  const isAuto = item.is_auto === true;
  const isRevenueLinked = item.revenue_linked === true;
  const displayLabel = (item.channel_label && item.channel_label.trim() !== '')
    ? item.channel_label
    : (CHANNEL_LABELS[item.channel] || item.channel);

  const commit = () => {
    onSave({
      month,
      channel: item.channel,
      planned_amount: planned.trim() === '' ? null : parseFloat(planned),
      actual_amount: isAuto ? undefined : (actual.trim() === '' ? null : parseFloat(actual)),
      revenue: isRevenueLinked ? (revenue.trim() === '' ? null : parseFloat(revenue)) : undefined,
      views: !isRevenueLinked ? (views.trim() === '' ? null : parseFloat(views)) : undefined,
      memo: memo.trim() === '' ? null : memo,
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
  };

  const actualNum = actual.trim() === '' ? null : parseFloat(actual);
  const revenueNum = isRevenueLinked && revenue.trim() !== '' ? parseFloat(revenue) : null;
  const roasText = (!isRevenueLinked || actualNum === null || !actualNum || revenueNum === null || Number.isNaN(actualNum) || Number.isNaN(revenueNum))
    ? '-'
    : `${(revenueNum / actualNum).toFixed(1)}x`;

  return (
    <tr className="border-b border-[#23252A] hover:bg-[#141516]/40">
      <td className="px-3 py-2 text-xs text-[#8A8F98] whitespace-nowrap">{month}</td>
      <td className="px-3 py-2 text-xs whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ background: CHANNEL_COLORS[item.channel] || '#8A8F98' }} />
          <span className="text-[#D0D6E0]">{displayLabel}</span>
        </span>
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        {isRevenueLinked ? (
          <span className="text-[9px] font-semibold bg-[#27A644]/15 text-[#27A644] px-1.5 py-0.5 rounded-full">매출 관여</span>
        ) : (
          <span className="text-[9px] font-semibold bg-[#23252A] text-[#8A8F98] px-1.5 py-0.5 rounded-full">비관여</span>
        )}
      </td>
      <td className="px-3 py-2">
        <input
          value={planned}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setPlanned(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          type="number"
          className="w-24 bg-[#08090A] border border-[#23252A] rounded-lg px-2 py-1 text-xs text-[#F7F8F8] focus:outline-none focus:border-[#5E6AD2]"
          placeholder="0"
        />
      </td>
      <td className="px-3 py-2">
        {isAuto ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-xs text-[#8A8F98]">{fmtWon(item.actual_amount ?? null)}</span>
            <span className="text-[9px] font-semibold bg-[#4EA7FC]/15 text-[#4EA7FC] px-1.5 py-0.5 rounded-full">자동</span>
          </span>
        ) : (
          <input
            value={actual}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setActual(e.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
            type="number"
            className="w-24 bg-[#08090A] border border-[#23252A] rounded-lg px-2 py-1 text-xs text-[#F7F8F8] focus:outline-none focus:border-[#5E6AD2]"
            placeholder="0"
          />
        )}
      </td>
      <td className="px-3 py-2">
        {isRevenueLinked ? (
          <input
            value={revenue}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setRevenue(e.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
            type="number"
            className="w-24 bg-[#08090A] border border-[#23252A] rounded-lg px-2 py-1 text-xs text-[#F7F8F8] focus:outline-none focus:border-[#5E6AD2]"
            placeholder="0"
          />
        ) : (
          <span className="inline-flex items-center gap-1">
            <input
              value={views}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setViews(e.target.value)}
              onBlur={commit}
              onKeyDown={onKeyDown}
              type="number"
              title="조회수(view) — 데이터 대시보드의 비관여 채널 지표로 표시됩니다"
              className="w-24 bg-[#08090A] border border-[#23252A] rounded-lg px-2 py-1 text-xs text-[#F7F8F8] focus:outline-none focus:border-[#F2994A]"
              placeholder="조회수"
            />
            <span className="text-[9px] text-[#8A8F98]">view</span>
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-[#8A8F98] whitespace-nowrap">{roasText}</td>
      <td className="px-3 py-2">
        <input
          value={memo}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setMemo(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          type="text"
          className="w-36 bg-[#08090A] border border-[#23252A] rounded-lg px-2 py-1 text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
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

export function ExternalMarketingKPI() {
  const queryClient = useQueryClient();
  const [monthsRange, setMonthsRange] = useState<6 | 12>(6);
  const defaultMonth = useMemo(() => new Date().toISOString().slice(0, 7), []);

  const {
    data: summaryData, isLoading: summaryLoading, isError: summaryError, refetch: refetchSummary,
  } = useQuery({
    queryKey: ['kpi-external-summary', monthsRange],
    queryFn: () => externalKpiApi.getSummary(monthsRange),
    staleTime: 60 * 1000,
  });

  const months: KPIExternalMonthSummary[] = summaryData?.months ?? [];
  const currentMonth = months.length > 0 ? months[months.length - 1] : null;
  const latestGoal = currentMonth?.goal ?? null;
  const topCampaigns = summaryData?.top_campaigns ?? [];

  const handleExportKpi = async () => {
    try {
      await downloadFile('/kpi/external-export', { months: monthsRange });
    } catch {
      toast.error('엑셀 다운로드에 실패했습니다.');
    }
  };

  // ─── Mutations ───

  const updateChannelSpendMutation = useMutation({
    mutationFn: (payload: KPIChannelSpendUpdatePayload) => kpiApi.updateChannelSpend({ ...payload, scope: 'external' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kpi-external-summary'] });
      toast.success('채널 광고비가 저장되었습니다.');
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || '저장 실패'),
  });

  const deleteChannelSpendMutation = useMutation({
    mutationFn: (id: number) => kpiApi.deleteChannelSpend(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kpi-external-summary'] });
      toast.success('삭제되었습니다.');
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || '삭제 실패'),
  });

  const updateGoalMutation = useMutation({
    mutationFn: ({ month, payload }: { month: string; payload: KPIExternalGoalUpdatePayload }) =>
      externalKpiApi.updateGoal(month, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kpi-external-summary'] });
      toast.success('목표가 저장되었습니다.');
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || '저장 실패'),
  });

  // ─── 채널 광고비 차트/테이블 데이터 ───

  const channelChartData = useMemo(() => months.map((m) => {
    const row: Record<string, number | string | null> = { month: monthLabel(m.month) };
    EXTERNAL_CHANNEL_KEYS.forEach((ch) => {
      const cs = m.channel_spends.find((c) => c.channel === ch);
      row[ch] = cs ? (cs.actual_amount ?? cs.planned_amount ?? 0) : 0;
    });
    row.revenue = m.total_revenue ?? null;
    return row;
  }), [months]);

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
  const [newChannel, setNewChannel] = useState<string>('naver_gfa');
  const [newChannelLabel, setNewChannelLabel] = useState('');
  const [newRevenueLinked, setNewRevenueLinked] = useState(true);
  const [newPlanned, setNewPlanned] = useState('');
  const [newActual, setNewActual] = useState('');
  const [newMemo, setNewMemo] = useState('');

  const addSpend = () => {
    if (!newMonth) return;
    if (newChannel === 'etc' && newChannelLabel.trim() === '') {
      toast.error('기타 채널의 채널명을 입력해주세요.');
      return;
    }
    // 광고비와 매출은 별도 기입 — 등록 시에는 매출을 받지 않는다 (아래 "채널 매출 기입" 폼 사용)
    updateChannelSpendMutation.mutate({
      month: newMonth,
      channel: newChannel,
      channel_label: newChannel === 'etc' ? newChannelLabel.trim() : null,
      planned_amount: newPlanned.trim() === '' ? null : parseFloat(newPlanned),
      actual_amount: newActual.trim() === '' ? null : parseFloat(newActual),
      revenue_linked: newRevenueLinked,
      memo: newMemo.trim() === '' ? null : newMemo,
    });
    setNewChannelLabel('');
    setNewPlanned('');
    setNewActual('');
    setNewMemo('');
  };

  // ─── 채널 매출 별도 기입 (매출 관여 채널 전용) ───
  const [revMonth, setRevMonth] = useState(defaultMonth);
  const [revChannel, setRevChannel] = useState('');
  const [revAmount, setRevAmount] = useState('');

  const revenueLinkedRows = useMemo(
    () => spendRows.filter((r) => r.month === revMonth && r.item.revenue_linked === true && !r.item.is_auto),
    [spendRows, revMonth],
  );

  const saveChannelRevenue = () => {
    if (!revMonth || !revChannel) {
      toast.error('월과 채널을 선택해주세요.');
      return;
    }
    if (revAmount.trim() === '') {
      toast.error('매출액을 입력해주세요.');
      return;
    }
    updateChannelSpendMutation.mutate({
      month: revMonth,
      channel: revChannel,
      scope: 'external',
      revenue: parseFloat(revAmount),
    });
    setRevAmount('');
  };

  // ─── 공동구매(어필리에이트) 매출 차트 데이터 ───

  const groupbuyChartData = useMemo(() => months.map((m) => ({
    month: monthLabel(m.month),
    groupbuy_revenue: m.groupbuy_revenue,
    groupbuy_orders: m.groupbuy_orders,
  })), [months]);

  const campaignChartData = useMemo(() => [...topCampaigns].slice(0, 10), [topCampaigns]);

  // ─── 목표 설정 폼 ───

  const [goalFormOpen, setGoalFormOpen] = useState(false);
  const [goalMonth, setGoalMonth] = useState(defaultMonth);
  const [targetSpend, setTargetSpend] = useState('');
  const [targetRevenue, setTargetRevenue] = useState('');
  const [actualRevenueManual, setActualRevenueManual] = useState('');
  const [goalMemo, setGoalMemo] = useState('');

  const goalForSelectedMonth = months.find((m) => m.month === goalMonth)?.goal ?? null;
  const goalSignature = goalForSelectedMonth ? JSON.stringify(goalForSelectedMonth) : 'null';

  useEffect(() => {
    const g = goalForSelectedMonth;
    setTargetSpend(g?.target_spend != null ? String(g.target_spend) : '');
    setTargetRevenue(g?.target_revenue != null ? String(g.target_revenue) : '');
    setActualRevenueManual(g?.actual_revenue_manual != null ? String(g.actual_revenue_manual) : '');
    setGoalMemo(g?.memo ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalMonth, goalSignature]);

  const handleSaveGoal = () => {
    const payload: KPIExternalGoalUpdatePayload = {
      target_spend: targetSpend.trim() === '' ? null : parseFloat(targetSpend),
      target_revenue: targetRevenue.trim() === '' ? null : parseFloat(targetRevenue),
      actual_revenue_manual: actualRevenueManual.trim() === '' ? null : parseFloat(actualRevenueManual),
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
          <h2 className="text-xl font-bold text-[#F7F8F8]">그 외 마케팅 KPI</h2>
          <p className="text-xs text-[#8A8F98] mt-1">외부 채널 광고비, 공동구매 매출, 시딩·협찬을 한눈에 관리합니다.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center bg-[#141516] rounded-lg p-0.5">
            {([6, 12] as const).map((n) => (
              <button
                key={n}
                onClick={() => setMonthsRange(n)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  monthsRange === n ? 'bg-[#0F1011] text-[#7070FF] shadow-[0px_1px_3px_rgba(0,0,0,0.2)]' : 'text-[#8A8F98] hover:text-[#D0D6E0]'
                }`}
              >
                최근 {n}개월
              </button>
            ))}
          </div>
          <button
            onClick={handleExportKpi}
            className="flex items-center gap-1.5 px-3 py-2 border border-[#23252A] rounded-lg text-sm text-[#D0D6E0] hover:bg-[#141516] transition-all"
          >
            <Download size={14} /> 엑셀
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
          {/* 당월 요약 카드 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <ExternalGoalCard
              icon={<Target size={16} />}
              label="외부 광고비"
              value={fmtWon(currentMonth?.total_spend ?? null)}
              targetLabel={targetText(latestGoal?.target_spend ?? null, fmtWon)}
              badge={achievementBadge(currentMonth?.total_spend ?? null, latestGoal?.target_spend ?? null)}
            />
            <ExternalGoalCard
              icon={<DollarSign size={16} />}
              label="공동구매 매출"
              value={fmtWon(currentMonth?.groupbuy_revenue ?? null)}
              targetLabel={targetText(latestGoal?.target_revenue ?? null, fmtWon)}
              badge={achievementBadge(currentMonth?.groupbuy_revenue ?? null, latestGoal?.target_revenue ?? null)}
            />
            <ExternalGoalCard
              icon={<ShoppingCart size={16} />}
              label="공동구매 주문수"
              value={fmtNum(currentMonth?.groupbuy_orders ?? null)}
              showTarget={false}
            />
            <ExternalGoalCard
              icon={<TrendingUp size={16} />}
              label="총 매출"
              value={fmtWon(currentMonth?.total_revenue ?? null)}
              targetLabel={`공동구매 ${fmtWon(currentMonth?.groupbuy_revenue ?? null)} + 채널 매출 ${fmtWon(currentMonth?.channel_revenue ?? null)}`}
            />
          </div>

          {/* 채널 광고비 관리 */}
          <div className="bg-[#0F1011] border border-[#23252A] rounded-xl p-4">
            <h3 className="text-sm font-semibold text-[#D0D6E0] mb-3 flex items-center gap-1.5">
              <Layers size={14} className="text-[#4EA7FC]" />
              채널 광고비 관리
              <span className="text-[10px] font-normal text-[#62666D]">우측 축: 총 매출</span>
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={channelChartData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
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
                    tick={{ fontSize: 10, fill: '#27A644' }}
                    tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 10000)}만` : String(v))}
                  />
                  <RechartsTooltip
                    contentStyle={{ backgroundColor: '#141516', border: '1px solid #23252A', borderRadius: 8, fontSize: 11 }}
                    labelStyle={{ color: '#D0D6E0' }}
                    formatter={(value: any, name: any) => [
                      fmtWon(Number(value)),
                      name === 'revenue' ? '총 매출' : (CHANNEL_LABELS[name as string] || name),
                    ]}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11 }}
                    formatter={(value: string) => (value === 'revenue' ? '총 매출' : (CHANNEL_LABELS[value] || value))}
                  />
                  {EXTERNAL_CHANNEL_KEYS.map((ch) => (
                    <Bar key={ch} yAxisId="left" dataKey={ch} name={ch} stackId="spend" fill={CHANNEL_COLORS[ch]} />
                  ))}
                  <Line yAxisId="right" type="monotone" dataKey="revenue" name="revenue" stroke="#27A644" strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="overflow-x-auto mt-4">
              <table className="w-full min-w-[880px] text-left">
                <thead>
                  <tr className="border-b border-[#23252A] text-[10px] text-[#62666D] uppercase tracking-wide">
                    <th className="px-3 py-2 whitespace-nowrap">월</th>
                    <th className="px-3 py-2 whitespace-nowrap">채널</th>
                    <th className="px-3 py-2 whitespace-nowrap">유형</th>
                    <th className="px-3 py-2 whitespace-nowrap">예산</th>
                    <th className="px-3 py-2 whitespace-nowrap">광고비</th>
                    <th className="px-3 py-2 whitespace-nowrap">매출 / 조회수</th>
                    <th className="px-3 py-2 whitespace-nowrap">ROAS</th>
                    <th className="px-3 py-2 whitespace-nowrap">메모</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {spendRows.map((row) => (
                    <ExternalChannelSpendRow
                      key={row.key}
                      month={row.month}
                      item={row.item}
                      onSave={(payload) => updateChannelSpendMutation.mutate(payload)}
                      onDelete={(id) => deleteChannelSpendMutation.mutate(id)}
                    />
                  ))}
                  {spendRows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-3 py-6 text-center text-xs text-[#62666D]">
                        등록된 채널 광고비가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-3 pt-3 border-t border-[#23252A] space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center bg-[#141516] rounded-lg p-0.5">
                  <button
                    type="button"
                    onClick={() => setNewRevenueLinked(true)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                      newRevenueLinked ? 'bg-[#27A644]/15 text-[#27A644]' : 'text-[#8A8F98] hover:text-[#D0D6E0]'
                    }`}
                  >
                    매출 관여
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewRevenueLinked(false)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                      !newRevenueLinked ? 'bg-[#23252A] text-[#D0D6E0]' : 'text-[#8A8F98] hover:text-[#D0D6E0]'
                    }`}
                  >
                    비관여
                  </button>
                </div>

                <select
                  value={newChannel}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setNewChannel(e.target.value)}
                  className="px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
                >
                  {ADDABLE_CHANNEL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value} disabled={opt.disabled}>{opt.label}</option>
                  ))}
                </select>

                {newChannel === 'etc' && (
                  <input
                    value={newChannelLabel}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setNewChannelLabel(e.target.value)}
                    type="text"
                    placeholder="채널명 입력"
                    className="w-32 px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
                  />
                )}

                <input
                  type="month"
                  value={newMonth}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setNewMonth(e.target.value)}
                  className="px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
                />
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <input
                  value={newPlanned}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setNewPlanned(e.target.value)}
                  type="number"
                  placeholder="예산 (₩)"
                  className="w-28 px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
                />
                <input
                  value={newActual}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setNewActual(e.target.value)}
                  type="number"
                  placeholder="광고비 (₩)"
                  className="w-28 px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
                />
                <input
                  value={newMemo}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setNewMemo(e.target.value)}
                  type="text"
                  placeholder="메모"
                  className="w-40 px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
                />
                <button
                  onClick={addSpend}
                  disabled={updateChannelSpendMutation.isPending}
                  className="flex items-center gap-1 px-3 py-1.5 bg-[#5E6AD2] text-white text-xs font-medium rounded-lg hover:bg-[#828FFF] disabled:opacity-50"
                >
                  <Plus size={12} /> 채널 추가
                </button>
                <span className="text-[10px] text-[#62666D]">매출은 아래 "채널 매출 기입"에서 별도 입력</span>
              </div>
            </div>

            {/* 채널 매출 별도 기입 — 광고비 등록과 분리 (월 마감 후 매출 확정 시 입력) */}
            <div className="mt-3 pt-3 border-t border-[#23252A]">
              <p className="text-[11px] font-medium text-[#27A644] mb-2">채널 매출 기입 (매출 관여 채널 전용)</p>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="month"
                  value={revMonth}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => { setRevMonth(e.target.value); setRevChannel(''); }}
                  className="px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
                />
                <select
                  value={revChannel}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setRevChannel(e.target.value)}
                  className="px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
                >
                  <option value="">채널 선택</option>
                  {revenueLinkedRows.map((r) => (
                    <option key={r.key} value={r.item.channel}>
                      {r.item.channel_label || CHANNEL_LABELS[r.item.channel] || r.item.channel}
                      {r.item.revenue != null ? ` (기입됨 ₩${Math.round(r.item.revenue).toLocaleString('ko-KR')})` : ''}
                    </option>
                  ))}
                </select>
                <input
                  value={revAmount}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setRevAmount(e.target.value)}
                  type="number"
                  placeholder="해당 월 매출 (₩)"
                  className="w-36 px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
                />
                <button
                  onClick={saveChannelRevenue}
                  disabled={updateChannelSpendMutation.isPending}
                  className="px-3 py-1.5 bg-[#27A644] text-white text-xs font-medium rounded-lg hover:bg-[#2FBF4F] disabled:opacity-50"
                >
                  매출 저장
                </button>
                {revenueLinkedRows.length === 0 && (
                  <span className="text-[10px] text-[#62666D]">
                    {revMonth}에 등록된 매출 관여 채널이 없습니다 — 먼저 위에서 채널을 추가하세요.
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 공동구매(어필리에이트) 매출 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-[#0F1011] border border-[#23252A] rounded-xl p-4">
              <h3 className="text-sm font-semibold text-[#D0D6E0] mb-3 flex items-center gap-1.5">
                <TrendingUp size={14} className="text-[#7070FF]" />
                공동구매 매출 & 주문수
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={groupbuyChartData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#23252A" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#8A8F98' }} />
                    <YAxis
                      yAxisId="left"
                      tick={{ fontSize: 10, fill: '#8A8F98' }}
                      tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 10000)}만` : String(v))}
                    />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#7070FF' }} />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: '#141516', border: '1px solid #23252A', borderRadius: 8, fontSize: 11 }}
                      labelStyle={{ color: '#D0D6E0' }}
                      formatter={(value: any, name: any) =>
                        name === '주문수' ? [fmtNum(Number(value)), name] : [fmtWon(Number(value)), name]
                      }
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="left" dataKey="groupbuy_revenue" name="매출" fill="#27A644" radius={[3, 3, 0, 0]} maxBarSize={30} />
                    <Line yAxisId="right" type="monotone" dataKey="groupbuy_orders" name="주문수" stroke="#7070FF" strokeWidth={2} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-[#0F1011] border border-[#23252A] rounded-xl p-4">
              <h3 className="text-sm font-semibold text-[#D0D6E0] mb-3 flex items-center gap-1.5">
                <DollarSign size={14} className="text-[#27A644]" />
                캠페인별 매출 TOP 10
              </h3>
              {campaignChartData.length === 0 ? (
                <div className="h-64 flex items-center justify-center">
                  <p className="text-xs text-[#62666D]">공동구매 캠페인 데이터가 없습니다.</p>
                </div>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={campaignChartData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#23252A" />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 10, fill: '#8A8F98' }}
                        tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 10000)}만` : String(v))}
                      />
                      <YAxis
                        type="category"
                        dataKey="campaign_name"
                        tick={{ fontSize: 10, fill: '#8A8F98' }}
                        tickFormatter={(v: string) => (v && v.length > 12 ? `${v.slice(0, 12)}…` : v)}
                        width={96}
                      />
                      <RechartsTooltip
                        contentStyle={{ backgroundColor: '#141516', border: '1px solid #23252A', borderRadius: 8, fontSize: 11 }}
                        labelStyle={{ color: '#D0D6E0' }}
                        formatter={(value: any, name: any) => (name === '매출' ? [fmtWon(Number(value)), name] : [fmtNum(Number(value)), name])}
                      />
                      <Bar dataKey="revenue" name="매출" fill="#7070FF" radius={[0, 3, 3, 0]} maxBarSize={20} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          {/* 목표 설정 폼 */}
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
                  <GoalInput label="목표 광고비 (₩)" value={targetSpend} onChange={setTargetSpend} />
                  <GoalInput label="목표 매출 (₩)" value={targetRevenue} onChange={setTargetRevenue} />
                  <GoalInput label="매출 보정(집계 외 수동 가산, ₩)" value={actualRevenueManual} onChange={setActualRevenueManual} />
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
        </>
      )}

      {/* 네이버 검색량 추이 */}
      <NaverQueriesCard />

      {/* 인플루언서 시딩 */}
      <InfluencerSeedingCard />

      {/* 협찬 관리 */}
      <SponsorshipCard />
    </div>
  );
}
