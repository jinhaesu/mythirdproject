'use client';

/**
 * KPI 대시보드 — 광고비 일보의 유입채널 축으로 전 채널을 분석하는 통합 화면.
 *
 * - 기간 조회: 3/6/12개월 프리셋 + 커스텀 월 범위(최대 24개월)
 * - 채널 필터: 유입채널 멀티 선택 칩 — 선택 채널만의 흐름을 모든 차트·표에 반영
 * - 월별 추이: 채널 광고비 스택 + blended ROAS / 선택 시 채널별 ROAS 라인 비교
 * - 채널 × 월 흐름 매트릭스: 채널별 월 광고비·ROAS를 한 표에서 비교
 * - 채널 ROAS 표: 선택 월 상세(광고비·Limit·사용율·매출·ROAS, 매출 셀 클릭 기입)
 * 구 '채널 성과 분석'(소수 채널 수동 기입 기반)을 대체 (2026-09-30).
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ResponsiveContainer, ComposedChart, LineChart, Bar, Line, XAxis, YAxis,
  Tooltip as RechartsTooltip, Legend, CartesianGrid,
} from 'recharts';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { adspendApi, homeApi, activitiesApi } from '@/lib/api';
import { fmtWon, fmtNum, LINE_PALETTE } from '@/components/tabs/kpi/format';

const thisMonth = () => new Date().toISOString().slice(0, 7);

function monthAdd(month: string, delta: number): string {
  const y = parseInt(month.slice(0, 4), 10);
  const m = parseInt(month.slice(5, 7), 10);
  const t = y * 12 + (m - 1) + delta;
  return `${String(Math.floor(t / 12)).padStart(4, '0')}-${String((t % 12) + 1).padStart(2, '0')}`;
}

const PALETTE = [...LINE_PALETTE, '#FF8A3D', '#17BEBB', '#C06EF3', '#8A8F98', '#1EC800', '#FEE500', '#E5322D'];

const PRESETS = [
  { key: '3', label: '3개월' },
  { key: '6', label: '6개월' },
  { key: '12', label: '12개월' },
  { key: 'custom', label: '커스텀' },
] as const;
type PeriodKey = (typeof PRESETS)[number]['key'];

function ProgressBar({ pct }: { pct: number | null }) {
  if (pct === null) return <div className="h-1.5 rounded-full" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.07)' }} />;
  const color = pct > 100 ? '#EA4335' : pct >= 90 ? '#F0BF00' : '#27A644';
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.07)' }}>
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: color }} />
    </div>
  );
}

export function GoalOverview() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(thisMonth());
  const [editRev, setEditRev] = useState<string | null>(null); // inflow
  const [revValue, setRevValue] = useState('');
  const isThisMonth = month === thisMonth();

  // 기간 조회 (프리셋 + 커스텀 월 범위)
  const [period, setPeriod] = useState<PeriodKey>('6');
  const [customFrom, setCustomFrom] = useState(monthAdd(thisMonth(), -5));
  const [customTo, setCustomTo] = useState(thisMonth());
  const isCustom = period === 'custom';
  const boardParams = isCustom
    ? { monthFrom: customFrom <= customTo ? customFrom : customTo, monthTo: customFrom <= customTo ? customTo : customFrom }
    : { monthsBack: parseInt(period, 10) };

  // 채널 필터 (빈 배열 = 전체)
  const [sel, setSel] = useState<string[]>([]);
  const toggleInflow = (inf: string) =>
    setSel((prev) => (prev.includes(inf) ? prev.filter((x) => x !== inf) : [...prev, inf]));

  const { data: board, isLoading } = useQuery({
    queryKey: ['adspend', 'roas-board', boardParams],
    queryFn: () => adspendApi.roasBoard(boardParams),
  });
  const { data: briefing } = useQuery({
    queryKey: ['home', 'briefing'],
    queryFn: homeApi.getBriefing,
    staleTime: 5 * 60 * 1000,
    enabled: isThisMonth,
  });
  const { data: actActual } = useQuery({
    queryKey: ['activities', 'summary', 'goal', month, 'actual'],
    queryFn: () => activitiesApi.summary({ month_from: month, month_to: month }),
  });

  const revMut = useMutation({
    mutationFn: ({ inflow, revenue }: { inflow: string; revenue: number }) =>
      adspendApi.upsertRevenue(month, inflow, revenue),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['adspend', 'roas-board'] }); },
    onError: () => toast.error('매출 저장 실패'),
  });

  // 기간 내 광고비 큰 순 채널 목록 (칩 정렬·기본 표시 순서)
  const inflowsBySpend = useMemo(() => {
    const spendBy: Record<string, number> = {};
    (board?.cells || []).forEach((c) => { spendBy[c.inflow] = (spendBy[c.inflow] || 0) + c.spend; });
    return Object.entries(spendBy).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }, [board]);

  // 필터 적용된 셀 (선택 없으면 전체)
  const cells = useMemo(() => {
    const all = board?.cells || [];
    return sel.length ? all.filter((c) => sel.includes(c.inflow)) : all;
  }, [board, sel]);

  // 선택 월의 채널 행 (광고비 내림차순)
  const monthRows = useMemo(
    () => cells.filter((c) => c.month === month).sort((a, b) => b.spend - a.spend),
    [cells, month],
  );
  const totals = useMemo(() => {
    const spend = monthRows.reduce((s, r) => s + r.spend, 0);
    const limit = monthRows.reduce((s, r) => s + (r.limit || 0), 0);
    const revenue = monthRows.reduce((s, r) => s + (r.revenue || 0), 0);
    return {
      spend, limit, revenue,
      usage_pct: limit ? Math.round((spend / limit) * 1000) / 10 : null,
      roas: spend && revenue ? Math.round((revenue / spend) * 100) / 100 : null,
    };
  }, [monthRows]);

  // 기간 전체 합계 (필터 반영)
  const periodTotals = useMemo(() => {
    const spend = cells.reduce((s, c) => s + c.spend, 0);
    const revenue = cells.reduce((s, c) => s + (c.revenue || 0), 0);
    return { spend, revenue, roas: spend && revenue ? Math.round((revenue / spend) * 100) / 100 : null };
  }, [cells]);

  // 월별 추이 차트 (채널 스택 광고비 + blended ROAS) — 선택 채널만 반영
  const trend = useMemo(() => {
    if (!board) return { data: [] as any[], series: [] as string[] };
    const series = sel.length
      ? inflowsBySpend.filter((i) => sel.includes(i))
      : inflowsBySpend.slice(0, 6);
    const hasOthers = !sel.length && inflowsBySpend.length > 6;
    const data = board.months.map((m) => {
      const rows = cells.filter((c) => c.month === m);
      const row: any = { month: m.slice(2) };
      let others = 0;
      rows.forEach((c) => {
        if (series.includes(c.inflow)) row[c.inflow] = (row[c.inflow] || 0) + c.spend;
        else others += c.spend;
      });
      if (hasOthers && others) row['기타'] = others;
      const spend = rows.reduce((s, c) => s + c.spend, 0);
      const revenue = rows.reduce((s, c) => s + (c.revenue || 0), 0);
      row.roas = spend && revenue ? Math.round((revenue / spend) * 100) / 100 : null;
      return row;
    });
    return { data, series: hasOthers ? [...series, '기타'] : series };
  }, [board, cells, sel, inflowsBySpend]);

  // 채널별 ROAS 라인 비교 (선택 채널, 선택 없으면 기간 광고비 상위 5)
  const roasCompare = useMemo(() => {
    if (!board) return { data: [] as any[], series: [] as string[] };
    const series = (sel.length ? inflowsBySpend.filter((i) => sel.includes(i)) : inflowsBySpend.slice(0, 5)).slice(0, 10);
    const data = board.months.map((m) => {
      const row: any = { month: m.slice(2) };
      series.forEach((inf) => {
        const c = (board.cells || []).find((x) => x.month === m && x.inflow === inf);
        row[inf] = c?.roas ?? null;
      });
      return row;
    });
    return { data, series };
  }, [board, sel, inflowsBySpend]);

  // 채널 × 월 흐름 매트릭스 (선택 채널, 선택 없으면 상위 8)
  const matrix = useMemo(() => {
    if (!board) return { rows: [] as any[], months: [] as string[] };
    const chans = sel.length ? inflowsBySpend.filter((i) => sel.includes(i)) : inflowsBySpend.slice(0, 8);
    const rows = chans.map((inf) => {
      const byMonth: Record<string, { spend: number; roas: number | null }> = {};
      let spend = 0; let revenue = 0;
      board.months.forEach((m) => {
        const c = (board.cells || []).find((x) => x.month === m && x.inflow === inf);
        byMonth[m] = { spend: c?.spend || 0, roas: c?.roas ?? null };
        spend += c?.spend || 0;
        revenue += c?.revenue || 0;
      });
      return {
        inflow: inf, byMonth, spend, revenue,
        roas: spend && revenue ? Math.round((revenue / spend) * 100) / 100 : null,
      };
    });
    return { rows, months: board.months };
  }, [board, sel, inflowsBySpend]);

  const actTotals = (actActual?.by_type || []).reduce(
    (acc: any, t: any) => ({ views: acc.views + t.views, cost: acc.cost + t.cost, rows: acc.rows + t.rows }),
    { views: 0, cost: 0, rows: 0 },
  );

  const commitRevenue = (inflow: string) => {
    const raw = revValue.replace(/,/g, '').trim();
    const num = raw === '' ? 0 : Number(raw);
    if (Number.isNaN(num) || num < 0) { toast.error('숫자를 입력해 주세요 (원)'); return; }
    revMut.mutate({ inflow, revenue: num });
    setEditRev(null);
  };

  const periodLabel = board ? `${board.months[0]} ~ ${board.months[board.months.length - 1]}` : '';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h2 className="text-base font-semibold text-text-primary">KPI 대시보드</h2>
          <p className="text-xs text-text-tertiary mt-0.5">
            광고비 일보의 전 채널 기준 — 기간·채널을 골라 숫자의 흐름을 비교 분석합니다
          </p>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <button onClick={() => setMonth(monthAdd(month, -1))} className="p-1.5 rounded-lg border border-border-primary text-text-tertiary hover:text-text-primary"><ChevronLeft size={13} /></button>
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary" />
          <button onClick={() => setMonth(monthAdd(month, 1))} className="p-1.5 rounded-lg border border-border-primary text-text-tertiary hover:text-text-primary"><ChevronRight size={13} /></button>
        </div>
      </div>

      {/* 기간 프리셋 + 커스텀 범위 + 채널 필터 */}
      <div className="rounded-xl p-3 space-y-2.5" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium text-text-tertiary w-14 shrink-0">조회 기간</span>
          <div className="flex items-center gap-1">
            {PRESETS.map((p) => (
              <button key={p.key} onClick={() => setPeriod(p.key)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                  period === p.key ? 'text-white border-transparent' : 'text-text-tertiary border-border-primary hover:text-text-primary'
                }`}
                style={period === p.key ? { backgroundColor: 'var(--color-brand-bg)' } : undefined}
              >{p.label}</button>
            ))}
          </div>
          {isCustom && (
            <div className="flex items-center gap-1.5">
              <input type="month" value={customFrom} onChange={(e) => e.target.value && setCustomFrom(e.target.value)}
                className="px-2 py-1 rounded-lg text-[11px] bg-bg-2 border border-border-primary text-text-primary" />
              <span className="text-[11px] text-text-quaternary">~</span>
              <input type="month" value={customTo} onChange={(e) => e.target.value && setCustomTo(e.target.value)}
                className="px-2 py-1 rounded-lg text-[11px] bg-bg-2 border border-border-primary text-text-primary" />
              <span className="text-[10px] text-text-quaternary">최대 24개월</span>
            </div>
          )}
          {periodLabel && <span className="text-[10px] text-text-quaternary ml-auto">{periodLabel}</span>}
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <span className="text-[11px] font-medium text-text-tertiary w-14 shrink-0 mt-1">채널 필터</span>
          <div className="flex flex-wrap items-center gap-1 flex-1">
            {inflowsBySpend.map((inf) => {
              const on = sel.includes(inf);
              return (
                <button key={inf} onClick={() => toggleInflow(inf)}
                  className={`px-2 py-0.5 rounded-full text-[10.5px] border transition-colors ${
                    on ? 'font-semibold border-transparent text-white' : 'text-text-tertiary border-border-primary hover:text-text-primary'
                  }`}
                  style={on ? { backgroundColor: 'var(--color-brand-bg)' } : undefined}
                >{inf}</button>
              );
            })}
            {sel.length > 0 && (
              <button onClick={() => setSel([])}
                className="flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10.5px] text-red border border-red/40 hover:bg-red/10">
                <X size={10} /> 필터 해제 ({sel.length})
              </button>
            )}
          </div>
        </div>
        {/* 기간 합계 (필터 반영) */}
        <div className="flex flex-wrap gap-x-5 gap-y-1 pt-1.5" style={{ borderTop: '1px solid rgb(var(--color-overlay-rgb) / 0.05)' }}>
          <span className="text-[11px] text-text-tertiary">
            기간 합계{sel.length ? ` (선택 ${sel.length}채널)` : ' (전체)'} —
            광고비 <b className="text-text-primary tabular-nums">{fmtWon(periodTotals.spend)}</b>
          </span>
          <span className="text-[11px] text-text-tertiary">
            매출 <b className="text-text-primary tabular-nums">{fmtWon(periodTotals.revenue)}</b>
          </span>
          <span className="text-[11px] text-text-tertiary">
            Blended ROAS <b className={periodTotals.roas != null && periodTotals.roas >= 1 ? 'text-green' : 'text-yellow'}>
              {periodTotals.roas != null ? `${periodTotals.roas}x` : '-'}
            </b>
          </span>
        </div>
      </div>

      {/* 핵심 카드 (선택 월 기준) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl p-4 space-y-2" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
          <p className="text-[11px] text-text-tertiary">광고비 집행 vs Limit ({parseInt(month.slice(5), 10)}월{sel.length ? ' · 선택 채널' : ''})</p>
          <p className="text-lg font-bold text-text-primary tabular-nums">
            {fmtWon(totals.spend)}
            <span className="text-xs font-normal text-text-quaternary"> / {totals.limit ? fmtWon(totals.limit) : '-'}</span>
          </p>
          <ProgressBar pct={totals.usage_pct} />
          <p className="text-[11px] text-text-quaternary">사용율 {totals.usage_pct != null ? `${totals.usage_pct}%` : '-'}</p>
        </div>
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
          <p className="text-[11px] text-text-tertiary">채널 매출 합계 (기입+자동)</p>
          <p className="text-lg font-bold text-text-primary tabular-nums mt-1">{fmtWon(totals.revenue)}</p>
          <p className="text-[11px] text-text-quaternary mt-1.5">
            Blended ROAS <b className={totals.roas != null && totals.roas >= 1 ? 'text-green' : 'text-yellow'}>{totals.roas ?? '-'}</b>
          </p>
        </div>
        {isThisMonth && (
          <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
            <p className="text-[11px] text-text-tertiary">자사몰 매출 (이달)</p>
            <p className="text-lg font-bold text-text-primary tabular-nums mt-1">{briefing ? fmtWon(briefing.sales?.month_amount) : '-'}</p>
            <p className="text-[11px] text-text-quaternary mt-1.5">
              주문 {briefing ? fmtNum(briefing.sales?.month_orders) : '-'}건 · 어필 확정 {briefing ? fmtWon(briefing.affiliate?.confirmed_amount_30d) : '-'}
            </p>
          </div>
        )}
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
          <p className="text-[11px] text-text-tertiary">마케팅 활동 (실적)</p>
          <p className="text-lg font-bold text-text-primary tabular-nums mt-1">{fmtNum(actTotals.rows)}건</p>
          <p className="text-[11px] text-text-quaternary mt-1.5">조회수 {fmtNum(actTotals.views)} · 비용 {fmtWon(actTotals.cost)}</p>
        </div>
      </div>

      {/* 월별 추이: 채널 광고비 스택 + Blended ROAS */}
      <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
        <h3 className="text-sm font-semibold text-text-primary mb-3">
          월별 채널 광고비 · Blended ROAS {sel.length ? `(선택 ${sel.length}채널)` : `(전체 · 상위 6채널+기타)`}
        </h3>
        {trend.data.length === 0 ? (
          <p className="text-xs text-text-tertiary py-8 text-center">데이터가 없습니다</p>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trend.data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--color-text-quaternary)' }} tickLine={false} axisLine={false} />
                <YAxis yAxisId="left" tick={{ fontSize: 10, fill: 'var(--color-text-quaternary)' }} tickLine={false} axisLine={false}
                  tickFormatter={(v: number) => (v >= 100000000 ? `${(v / 100000000).toFixed(1)}억` : v >= 10000 ? `${Math.round(v / 10000)}만` : String(v))} width={48} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#F0BF00' }} tickLine={false} axisLine={false}
                  tickFormatter={(v: number) => `${v}x`} width={36} />
                <RechartsTooltip
                  contentStyle={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)', borderRadius: 8, fontSize: 11 }}
                  formatter={(v: any, name: any) => (name === 'Blended ROAS' ? [`${v}x`, name] : [fmtWon(Number(v)), name])}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {trend.series.map((inf, i) => (
                  <Bar key={inf} yAxisId="left" dataKey={inf} stackId="spend" fill={PALETTE[i % PALETTE.length]} maxBarSize={44} />
                ))}
                <Line yAxisId="right" type="monotone" dataKey="roas" name="Blended ROAS" stroke="#F0BF00" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* 채널별 ROAS 흐름 비교 라인 */}
      {roasCompare.series.length > 0 && roasCompare.data.length > 0 && (
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
          <h3 className="text-sm font-semibold text-text-primary mb-1">
            채널별 ROAS 흐름 비교 {sel.length ? `(선택 ${sel.length}채널)` : '(광고비 상위 5채널)'}
          </h3>
          <p className="text-[10px] text-text-quaternary mb-3">매출 데이터가 있는 채널·월만 라인이 그려집니다 — 위 칩에서 채널을 골라 비교하세요</p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={roasCompare.data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--color-text-quaternary)' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-quaternary)' }} tickLine={false} axisLine={false}
                  tickFormatter={(v: number) => `${v}x`} width={40} />
                <RechartsTooltip
                  contentStyle={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)', borderRadius: 8, fontSize: 11 }}
                  formatter={(v: any, name: any) => [v != null ? `${v}x` : '-', name]}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {roasCompare.series.map((inf, i) => (
                  <Line key={inf} type="monotone" dataKey={inf} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={{ r: 2.5 }} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* 채널 × 월 흐름 매트릭스 */}
      {matrix.rows.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
          <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
            <h3 className="text-sm font-semibold text-text-primary">
              채널 × 월 흐름 매트릭스 {sel.length ? `(선택 ${sel.length}채널)` : '(광고비 상위 8채널)'}
            </h3>
            <span className="text-[10px] text-text-quaternary">셀 = 광고비(천원) / ROAS</span>
          </div>
          <div className="overflow-x-auto">
            <table className="text-[11px] border-collapse" style={{ minWidth: `${180 + matrix.months.length * 86 + 110}px` }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                  <th className="sticky left-0 z-10 px-3 py-2 text-left font-medium text-text-tertiary min-w-[150px]" style={{ backgroundColor: 'var(--color-bg-level-1)' }}>유입 채널</th>
                  {matrix.months.map((m) => (
                    <th key={m} className="px-2 py-2 text-right font-medium text-text-quaternary min-w-[82px] whitespace-nowrap">{m.slice(2)}</th>
                  ))}
                  <th className="px-3 py-2 text-right font-semibold text-text-secondary min-w-[106px]">기간 합계</th>
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((r) => (
                  <tr key={r.inflow} style={{ borderBottom: '1px solid rgb(var(--color-overlay-rgb) / 0.04)' }}>
                    <td className="sticky left-0 z-10 px-3 py-1.5 text-text-primary whitespace-nowrap" style={{ backgroundColor: 'var(--color-bg-level-1)' }}>{r.inflow}</td>
                    {matrix.months.map((m) => {
                      const c = r.byMonth[m];
                      return (
                        <td key={m} className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                          <span className="text-text-secondary">{c.spend ? Math.round(c.spend / 1000).toLocaleString('ko-KR') : '·'}</span>
                          <span className={`block text-[10px] ${c.roas == null ? 'text-text-quaternary' : c.roas >= 1 ? 'text-green' : 'text-red'}`}>
                            {c.roas != null ? `${c.roas}x` : '-'}
                          </span>
                        </td>
                      );
                    })}
                    <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                      <span className="font-semibold text-text-primary">{fmtWon(r.spend)}</span>
                      <span className={`block text-[10px] font-medium ${r.roas == null ? 'text-text-quaternary' : r.roas >= 1 ? 'text-green' : 'text-red'}`}>
                        {r.roas != null ? `ROAS ${r.roas}x` : 'ROAS -'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 채널 ROAS 표 (선택 월) */}
      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
          <h3 className="text-sm font-semibold text-text-primary">
            {parseInt(month.slice(5), 10)}월 채널별 광고비·매출·ROAS{sel.length ? ` (선택 ${sel.length}채널)` : ''}
          </h3>
          <span className="text-[10px] text-text-quaternary">
            SALES 배지 = 매출 자동 연동(공급가·VAT별도) · 미연동 채널만 매출 칸 클릭 기입
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                {['유입 채널', '광고비', 'Limit', '사용율', '', '매출', 'ROAS'].map((h, i) => (
                  <th key={i} className="px-4 py-2.5 text-left font-medium text-text-tertiary whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-text-tertiary">불러오는 중...</td></tr>
              ) : monthRows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-text-tertiary">
                  {sel.length ? '선택 채널에 이 달의 데이터가 없습니다 — 필터를 해제하거나 다른 월을 선택해 보세요'
                    : '이 달의 광고비 데이터가 없습니다 — 광고비 일보에 기입하면 여기 채널이 나타납니다'}
                </td></tr>
              ) : monthRows.map((r) => (
                <tr key={r.inflow} style={{ borderBottom: '1px solid rgb(var(--color-overlay-rgb) / 0.04)' }}>
                  <td className="px-4 py-2 text-text-primary whitespace-nowrap">{r.inflow}</td>
                  <td className="px-4 py-2 text-text-primary font-medium tabular-nums text-right">{fmtWon(r.spend)}</td>
                  <td className="px-4 py-2 text-text-tertiary tabular-nums text-right">{r.limit ? fmtWon(r.limit) : '-'}</td>
                  <td className={`px-4 py-2 tabular-nums text-right font-medium ${
                    r.usage_pct === null ? 'text-text-quaternary' : r.usage_pct > 100 ? 'text-red' : r.usage_pct >= 90 ? 'text-yellow' : 'text-green'
                  }`}>{r.usage_pct !== null ? `${Math.round(r.usage_pct)}%` : '-'}</td>
                  <td className="px-2 py-2 w-32"><ProgressBar pct={r.usage_pct} /></td>
                  <td className="px-4 py-2 text-right">
                    {r.sales_linked ? (
                      <span className="tabular-nums text-text-primary" title="SALES 시스템(CSA) 매출 자동 연동 — 공급가(VAT별도)">
                        {r.revenue != null ? fmtWon(r.revenue) : <span className="text-text-quaternary">SALES 집계 전</span>}
                        <span className="ml-1 px-1 rounded text-[8px] font-bold bg-green/15 text-green align-middle">SALES</span>
                      </span>
                    ) : editRev === r.inflow ? (
                      <input
                        autoFocus
                        defaultValue={r.revenue != null ? String(Math.round(r.revenue)) : ''}
                        onChange={(e) => setRevValue(e.target.value)}
                        onBlur={() => commitRevenue(r.inflow)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRevenue(r.inflow);
                          if (e.key === 'Escape') setEditRev(null);
                        }}
                        className="w-28 px-2 py-1 text-right text-xs tabular-nums bg-bg-2 border border-brand rounded outline-none"
                      />
                    ) : (
                      <button
                        onClick={() => { setRevValue(r.revenue != null ? String(Math.round(r.revenue)) : ''); setEditRev(r.inflow); }}
                        className="tabular-nums text-text-secondary hover:text-text-primary hover:underline decoration-dotted"
                      >
                        {r.revenue != null ? fmtWon(r.revenue) : '기입'}
                      </button>
                    )}
                  </td>
                  <td className={`px-4 py-2 font-semibold tabular-nums text-right ${
                    r.roas == null ? 'text-text-quaternary' : r.roas >= 1 ? 'text-green' : 'text-red'
                  }`}>{r.roas != null ? `${r.roas}x` : '-'}</td>
                </tr>
              ))}
            </tbody>
            {monthRows.length > 0 && (
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--color-border-primary)' }}>
                  <td className="px-4 py-2.5 font-bold text-text-primary">합계</td>
                  <td className="px-4 py-2.5 font-bold text-text-primary tabular-nums text-right">{fmtWon(totals.spend)}</td>
                  <td className="px-4 py-2.5 text-text-tertiary tabular-nums text-right">{totals.limit ? fmtWon(totals.limit) : '-'}</td>
                  <td className="px-4 py-2.5 text-text-secondary tabular-nums text-right">{totals.usage_pct != null ? `${totals.usage_pct}%` : '-'}</td>
                  <td />
                  <td className="px-4 py-2.5 font-bold text-text-primary tabular-nums text-right">{fmtWon(totals.revenue)}</td>
                  <td className={`px-4 py-2.5 font-bold tabular-nums text-right ${totals.roas != null && totals.roas >= 1 ? 'text-green' : 'text-yellow'}`}>
                    {totals.roas != null ? `${totals.roas}x` : '-'}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      {board && (
        <p className="text-[10px] text-text-quaternary text-right">
          기준: {month} · 조회 기간 {periodLabel} · 광고비 = 일보 집계(VAT포함) · 매출 = SALES 시스템 공급가(VAT별도, 매칭 채널 자동) · ROAS = 매출 ÷ 광고비
        </p>
      )}
    </div>
  );
}
