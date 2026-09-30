'use client';

/**
 * KPI 대시보드 — 광고비 일보의 유입채널 축으로 전 채널을 분석하는 통합 화면.
 *
 * - 채널 ROAS 표: 채널별 광고비(일보 자동 합산)·Limit·사용율·매출(셀 클릭
 *   기입, 자사몰은 주문 데이터 자동)·ROAS
 * - 월별 추이: 채널 광고비 스택 + blended ROAS 라인 (최근 6개월)
 * 구 '채널 성과 분석'(소수 채널 수동 기입 기반)을 대체 (2026-09-30).
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  Tooltip as RechartsTooltip, Legend, CartesianGrid,
} from 'recharts';
import { ChevronLeft, ChevronRight } from 'lucide-react';
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

  const { data: board, isLoading } = useQuery({
    queryKey: ['adspend', 'roas-board'],
    queryFn: () => adspendApi.roasBoard(6),
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

  // 선택 월의 채널 행 (광고비 내림차순)
  const monthRows = useMemo(
    () => (board?.cells || []).filter((c) => c.month === month).sort((a, b) => b.spend - a.spend),
    [board, month],
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

  // 월별 추이 차트 (채널 스택 광고비 + blended ROAS)
  const trend = useMemo(() => {
    if (!board) return { data: [] as any[], topInflows: [] as string[] };
    const spendByInflow: Record<string, number> = {};
    board.cells.forEach((c) => { spendByInflow[c.inflow] = (spendByInflow[c.inflow] || 0) + c.spend; });
    const topInflows = Object.entries(spendByInflow).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k);
    const data = board.months.map((m) => {
      const rows = board.cells.filter((c) => c.month === m);
      const row: any = { month: m.slice(2) };
      let others = 0;
      rows.forEach((c) => {
        if (topInflows.includes(c.inflow)) row[c.inflow] = (row[c.inflow] || 0) + c.spend;
        else others += c.spend;
      });
      if (others) row['기타'] = others;
      const spend = rows.reduce((s, c) => s + c.spend, 0);
      const revenue = rows.reduce((s, c) => s + (c.revenue || 0), 0);
      row.roas = spend && revenue ? Math.round((revenue / spend) * 100) / 100 : null;
      return row;
    });
    return { data, topInflows: [...topInflows, '기타'] };
  }, [board]);

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h2 className="text-base font-semibold text-text-primary">KPI 대시보드</h2>
          <p className="text-xs text-text-tertiary mt-0.5">
            광고비 일보의 전 채널 기준 — 광고비는 자동 합산, 매출 셀을 클릭해 기입하면 ROAS가 계산됩니다 (자사몰은 자동)
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

      {/* 핵심 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl p-4 space-y-2" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
          <p className="text-[11px] text-text-tertiary">광고비 집행 vs Limit</p>
          <p className="text-lg font-bold text-text-primary tabular-nums">
            {fmtWon(totals.spend)}
            <span className="text-xs font-normal text-text-quaternary"> / {totals.limit ? fmtWon(totals.limit) : '-'}</span>
          </p>
          <ProgressBar pct={totals.usage_pct} />
          <p className="text-[11px] text-text-quaternary">사용율 {totals.usage_pct != null ? `${totals.usage_pct}%` : '-'}</p>
        </div>
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
          <p className="text-[11px] text-text-tertiary">채널 매출 합계 (기입+자사몰 자동)</p>
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
        <h3 className="text-sm font-semibold text-text-primary mb-3">월별 채널 광고비 · Blended ROAS (최근 6개월)</h3>
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
                {trend.topInflows.map((inf, i) => (
                  <Bar key={inf} yAxisId="left" dataKey={inf} stackId="spend" fill={LINE_PALETTE[i % LINE_PALETTE.length]} maxBarSize={44} />
                ))}
                <Line yAxisId="right" type="monotone" dataKey="roas" name="Blended ROAS" stroke="#F0BF00" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* 채널 ROAS 표 (선택 월) */}
      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
          <h3 className="text-sm font-semibold text-text-primary">{parseInt(month.slice(5), 10)}월 채널별 광고비·매출·ROAS</h3>
          <span className="text-[10px] text-text-quaternary">매출 칸 클릭 → 기입 (원 단위, VAT 포함 기준 통일)</span>
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
                  이 달의 광고비 데이터가 없습니다 — 광고비 일보에 기입하면 여기 채널이 나타납니다
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
                    {r.revenue_auto ? (
                      <span className="tabular-nums text-text-primary" title="자사몰 주문 데이터 자동 집계">
                        {r.revenue != null ? fmtWon(r.revenue) : '-'}
                        <span className="ml-1 px-1 rounded text-[8px] font-bold bg-green/15 text-green align-middle">자동</span>
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
          기준: {month} · 광고비 일보 실시간 집계 · ROAS = 채널 매출 ÷ 채널 광고비 (매출 미기입 채널은 표시 안 됨)
        </p>
      )}
    </div>
  );
}
