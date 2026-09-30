'use client';

/**
 * KPI 달성 현황 — 목표(기입값) vs 실적(자동 집계) 한눈 비교.
 * 매출·광고비(일보 연동)·어필리에이트·활동 기록을 이달 기준으로 모아 보여준다.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { adspendApi, homeApi, activitiesApi } from '@/lib/api';
import { fmtWon, fmtNum } from '@/components/tabs/kpi/format';

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
  const [month, setMonth] = useState(thisMonth());
  const isThisMonth = month === thisMonth();

  const { data: spend } = useQuery({
    queryKey: ['adspend', 'monthly-summary', month],
    queryFn: () => adspendApi.monthlySummary(month),
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
  const { data: planList } = useQuery({
    queryKey: ['activities', 'plan-count', month],
    queryFn: () => activitiesApi.list({ entry_kind: 'plan', month_from: month, limit: 1 }),
  });

  const spendTotals = spend?.totals;
  const actTotals = (actActual?.by_type || []).reduce(
    (acc: any, t: any) => ({ views: acc.views + t.views, cost: acc.cost + t.cost, rows: acc.rows + t.rows }),
    { views: 0, cost: 0, rows: 0 },
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h2 className="text-base font-semibold text-text-primary">달성 현황</h2>
          <p className="text-xs text-text-tertiary mt-0.5">기입한 목표·계획 대비 실제 결과 — 광고비는 광고비 일보와 실시간 연동</p>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="rounded-xl p-4 space-y-2" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
          <p className="text-[11px] text-text-tertiary">광고비 — 집행 vs Limit</p>
          <p className="text-xl font-bold text-text-primary tabular-nums">
            {spendTotals ? fmtWon(spendTotals.spend) : '-'}
            <span className="text-xs font-normal text-text-quaternary"> / {spendTotals ? fmtWon(spendTotals.limit) : '-'}</span>
          </p>
          <ProgressBar pct={spendTotals?.usage_pct ?? null} />
          <p className="text-[11px] text-text-quaternary">사용율 {spendTotals?.usage_pct != null ? `${spendTotals.usage_pct}%` : '-'}</p>
        </div>

        {isThisMonth && (
          <div className="rounded-xl p-4 space-y-2" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
            <p className="text-[11px] text-text-tertiary">자사몰 매출 (이달, 취소·환불 제외)</p>
            <p className="text-xl font-bold text-text-primary tabular-nums">{briefing ? fmtWon(briefing.sales?.month_amount) : '-'}</p>
            <p className="text-[11px] text-text-quaternary">주문 {briefing ? fmtNum(briefing.sales?.month_orders) : '-'}건 · 어필 확정 {briefing ? fmtWon(briefing.affiliate?.confirmed_amount_30d) : '-'} (30일)</p>
          </div>
        )}

        <div className="rounded-xl p-4 space-y-2" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
          <p className="text-[11px] text-text-tertiary">마케팅 활동 (실적)</p>
          <p className="text-xl font-bold text-text-primary tabular-nums">{fmtNum(actTotals.rows)}건</p>
          <p className="text-[11px] text-text-quaternary">
            조회수 {fmtNum(actTotals.views)} · 비용 {fmtWon(actTotals.cost)}
            {planList != null && ` · 계획 대기 ${fmtNum(planList.total)}건`}
          </p>
        </div>
      </div>

      {/* 유입채널별 광고비 */}
      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
          <h3 className="text-sm font-semibold text-text-primary">유입채널별 광고비 — 집행 vs Limit</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                {['유입 채널', '집행', 'Limit', '사용율', ''].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left font-medium text-text-tertiary whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(spend?.by_inflow || []).sort((a, b) => b.spend - a.spend).map((r) => {
                const pct = r.limit ? Math.round((r.spend / r.limit) * 100) : null;
                return (
                  <tr key={r.inflow} style={{ borderBottom: '1px solid rgb(var(--color-overlay-rgb) / 0.04)' }}>
                    <td className="px-4 py-2 text-text-primary">{r.inflow}</td>
                    <td className="px-4 py-2 text-text-primary font-medium tabular-nums text-right">{fmtWon(r.spend)}</td>
                    <td className="px-4 py-2 text-text-tertiary tabular-nums text-right">{r.limit ? fmtWon(r.limit) : '-'}</td>
                    <td className={`px-4 py-2 tabular-nums text-right font-medium ${
                      pct === null ? 'text-text-quaternary' : pct > 100 ? 'text-red' : pct >= 90 ? 'text-yellow' : 'text-green'
                    }`}>{pct !== null ? `${pct}%` : '-'}</td>
                    <td className="px-4 py-2 w-44"><ProgressBar pct={pct} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {spend && (
        <p className="text-[10px] text-text-quaternary text-right">기준: {month} · 광고비 일보 실시간 집계 (VAT 포함)</p>
      )}
    </div>
  );
}
