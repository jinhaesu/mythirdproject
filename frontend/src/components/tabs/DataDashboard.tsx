'use client';

/**
 * 데이터 대시보드 — 판매/집행 채널 통합 월별 뷰 (성과분석 앞 단).
 *
 * - 지표 관여 채널: 월별 광고비·매출·ROAS (메타·네이버 자동 + KPI 탭 수기 입력 연동)
 * - 지표 비관여 채널: 유튜브·브랜딩 등 월별 광고비·조회수(view)
 * 자사몰 마케팅 KPI / 그 외 마케팅 KPI 탭에서 입력한 값과 실시간 연동된다.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar, ComposedChart, Line, ResponsiveContainer,
  Tooltip as RechartsTooltip, XAxis, YAxis, Legend, CartesianGrid,
} from 'recharts';
import { Database, TrendingUp, Eye, Wallet } from 'lucide-react';
import { kpiApi, DataDashboardMonth } from '@/lib/api';

const STACK_COLORS = ['#5E6AD2', '#27A644', '#F2994A', '#EB5757', '#56CCF2', '#BB6BD9', '#F2C94C', '#6FCF97'];

function fmtWon(v: number | null | undefined): string {
  if (v == null) return '—';
  if (Math.abs(v) >= 100000000) return `₩${(v / 100000000).toFixed(1)}억`;
  if (Math.abs(v) >= 10000) return `₩${Math.round(v / 10000).toLocaleString()}만`;
  return `₩${Math.round(v).toLocaleString()}`;
}

function fmtViews(v: number | null | undefined): string {
  if (v == null || v === 0) return '—';
  if (v >= 10000) return `${(v / 10000).toFixed(1)}만`;
  return Math.round(v).toLocaleString();
}

export function DataDashboard() {
  const [months, setMonths] = useState<3 | 6 | 12>(6);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['kpi', 'data-dashboard', months],
    queryFn: () => kpiApi.getDataDashboard(months),
    staleTime: 300_000,
    retry: 1,
  });

  const monthsData: DataDashboardMonth[] = useMemo(() => data?.months || [], [data]);
  const latest = monthsData.length ? monthsData[monthsData.length - 1] : null;

  // 관여 채널 목록 (전체 월 union, 지출 큰 순)
  const involvedChannels = useMemo(() => {
    const agg = new Map<string, { label: string; spend: number }>();
    for (const m of monthsData) {
      for (const e of m.involved) {
        const cur = agg.get(e.channel) || { label: e.label, spend: 0 };
        cur.spend += e.spend;
        cur.label = e.label;
        agg.set(e.channel, cur);
      }
    }
    return Array.from(agg.entries()).sort((a, b) => b[1].spend - a[1].spend).map(([channel, v]) => ({ channel, label: v.label }));
  }, [monthsData]);

  const uninvolvedChannels = useMemo(() => {
    const agg = new Map<string, { label: string; spend: number }>();
    for (const m of monthsData) {
      for (const e of m.uninvolved) {
        const cur = agg.get(e.channel) || { label: e.label, spend: 0 };
        cur.spend += e.spend;
        cur.label = e.label;
        agg.set(e.channel, cur);
      }
    }
    return Array.from(agg.entries()).sort((a, b) => b[1].spend - a[1].spend).map(([channel, v]) => ({ channel, label: v.label }));
  }, [monthsData]);

  // 차트 데이터 — 채널별 관여 광고비 스택 + blended ROAS 라인
  const chartRows = useMemo(() => monthsData.map(m => {
    const row: Record<string, number | string | null> = {
      month: m.month.slice(2),
      roas: m.totals.blended_roas,
    };
    for (const ch of involvedChannels) {
      row[ch.channel] = m.involved.find(e => e.channel === ch.channel)?.spend ?? 0;
    }
    return row;
  }), [monthsData, involvedChannels]);

  if (isLoading) {
    return <div className="flex items-center justify-center py-24 text-gray-500 text-sm">데이터 대시보드 로딩 중…</div>;
  }
  if (isError || !latest) {
    return <div className="flex items-center justify-center py-24 text-gray-500 text-sm">데이터를 불러오지 못했습니다.</div>;
  }

  const kpis = [
    { label: `총 광고비 (${latest.month})`, value: fmtWon(latest.totals.total_spend), sub: `관여 ${fmtWon(latest.totals.involved_spend)} · 비관여 ${fmtWon(latest.totals.uninvolved_spend)}`, icon: <Wallet size={16} />, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { label: '블렌디드 ROAS (관여 채널)', value: latest.totals.blended_roas != null ? latest.totals.blended_roas.toFixed(2) : '—', sub: `귀속 매출 ${fmtWon(latest.totals.involved_revenue)}`, icon: <TrendingUp size={16} />, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { label: `자사몰 총매출 (${latest.month})`, value: fmtWon(latest.totals.mall_revenue), sub: '카페24 결제 완료 기준', icon: <Database size={16} />, color: 'text-violet-400', bg: 'bg-violet-500/10' },
    { label: '브랜딩 조회수 (비관여)', value: fmtViews(latest.totals.uninvolved_views), sub: `브랜딩 광고비 ${fmtWon(latest.totals.uninvolved_spend)}`, icon: <Eye size={16} />, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  ];

  return (
    <div className="space-y-4">
      {/* 헤더 + 기간 선택 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold text-white">데이터 대시보드</h2>
          <p className="text-xs text-gray-500">채널별 월간 광고비·ROAS·조회수 — 자사몰/그 외 마케팅 KPI 탭 입력과 자동 연동</p>
        </div>
        <div className="flex items-center gap-1">
          {([3, 6, 12] as const).map(mm => (
            <button
              key={mm}
              onClick={() => setMonths(mm)}
              className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                months === mm ? 'bg-blue-600 text-white' : 'bg-[#1a1b1e] text-gray-400 border border-[#2a2d35] hover:text-white'
              }`}
            >
              {mm}개월
            </button>
          ))}
        </div>
      </div>

      {/* KPI 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k, i) => (
          <div key={i} className="bg-[#1a1b1e] rounded-2xl p-4 border border-white/[0.06]">
            <div className={`inline-flex items-center justify-center w-8 h-8 rounded-lg ${k.bg} ${k.color} mb-2`}>{k.icon}</div>
            <p className="text-[11px] text-gray-500">{k.label}</p>
            <p className="text-lg font-semibold text-white mt-0.5">{k.value}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* 차트 — 관여 광고비 스택 + 블렌디드 ROAS */}
      <div className="bg-[#1a1b1e] rounded-2xl p-4 border border-white/[0.06]">
        <h3 className="text-sm font-semibold text-white mb-3">월별 광고비 (지표 관여 채널) · 블렌디드 ROAS</h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartRows} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#23252A" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: '#8A8F98', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="spend" tickFormatter={(v: number) => `${Math.round(v / 10000).toLocaleString()}만`} tick={{ fill: '#8A8F98', fontSize: 10 }} axisLine={false} tickLine={false} width={52} />
              <YAxis yAxisId="roas" orientation="right" tick={{ fill: '#27A644', fontSize: 10 }} axisLine={false} tickLine={false} width={34} />
              <RechartsTooltip
                isAnimationActive={false}
                contentStyle={{ backgroundColor: '#141516', border: '1px solid #2a2d35', borderRadius: 8, fontSize: 11 }}
                formatter={(value, name) => {
                  const num = value == null ? null : Number(value);
                  if (name === '블렌디드 ROAS') return [num != null && !Number.isNaN(num) ? num.toFixed(2) : '—', name];
                  return [fmtWon(num), String(name)];
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {involvedChannels.map((ch, i) => (
                <Bar key={ch.channel} yAxisId="spend" dataKey={ch.channel} name={ch.label} stackId="spend" fill={STACK_COLORS[i % STACK_COLORS.length]} isAnimationActive={false} />
              ))}
              <Line yAxisId="roas" type="monotone" dataKey="roas" name="블렌디드 ROAS" stroke="#27A644" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 표 0 — 전 채널 월별 광고비 매트릭스 */}
      <div className="bg-[#1a1b1e] rounded-2xl p-4 border border-white/[0.06]">
        <h3 className="text-sm font-semibold text-white mb-1">채널별 월별 광고비</h3>
        <p className="text-[11px] text-gray-500 mb-3">집행 채널 전체(관여 + 비관여)의 월별 광고비. 자동 집계 채널은 실집행액 기준.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[560px]">
            <thead>
              <tr className="text-gray-500 border-b border-white/5">
                <th className="text-left py-2 pr-3 font-medium whitespace-nowrap">채널</th>
                {monthsData.map(m => (
                  <th key={m.month} className="text-right py-2 px-3 font-medium whitespace-nowrap">{m.month.slice(2)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {involvedChannels.map(ch => (
                <tr key={`inv-${ch.channel}`} className="border-b border-white/5">
                  <td className="py-2 pr-3 text-gray-300 whitespace-nowrap">
                    {ch.label}
                    <span className="ml-1.5 text-[9px] font-semibold bg-emerald-500/10 text-emerald-300 px-1.5 py-0.5 rounded-full">관여</span>
                  </td>
                  {monthsData.map(m => {
                    const e = m.involved.find(x => x.channel === ch.channel);
                    return (
                      <td key={m.month} className="py-2 px-3 text-right whitespace-nowrap">
                        {e ? <span className="text-white font-medium">{fmtWon(e.spend)}</span> : <span className="text-gray-700">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {uninvolvedChannels.map(ch => (
                <tr key={`uni-${ch.channel}`} className="border-b border-white/5">
                  <td className="py-2 pr-3 text-gray-300 whitespace-nowrap">
                    {ch.label}
                    <span className="ml-1.5 text-[9px] font-semibold bg-amber-500/10 text-amber-300 px-1.5 py-0.5 rounded-full">비관여</span>
                  </td>
                  {monthsData.map(m => {
                    const e = m.uninvolved.find(x => x.channel === ch.channel);
                    return (
                      <td key={m.month} className="py-2 px-3 text-right whitespace-nowrap">
                        {e ? <span className="text-white font-medium">{fmtWon(e.spend)}</span> : <span className="text-gray-700">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="bg-white/[0.03] font-semibold">
                <td className="py-2 pr-3 text-white">합계 (전체 광고비)</td>
                {monthsData.map(m => (
                  <td key={m.month} className="py-2 px-3 text-right whitespace-nowrap text-blue-300">
                    {fmtWon(m.totals.total_spend)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 표 1 — 지표 관여 채널: 월별 ROAS·광고비·매출 */}
      <div className="bg-[#1a1b1e] rounded-2xl p-4 border border-white/[0.06]">
        <h3 className="text-sm font-semibold text-white mb-1">지표 관여 채널 — 월별 ROAS</h3>
        <p className="text-[11px] text-gray-500 mb-3">셀: ROAS (광고비 → 매출). 메타·네이버 검색광고는 자동 집계, 그 외는 KPI 탭 수기 입력.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[560px]">
            <thead>
              <tr className="text-gray-500 border-b border-white/5">
                <th className="text-left py-2 pr-3 font-medium whitespace-nowrap">채널</th>
                {monthsData.map(m => (
                  <th key={m.month} className="text-right py-2 px-3 font-medium whitespace-nowrap">{m.month.slice(2)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {involvedChannels.map(ch => (
                <tr key={ch.channel} className="border-b border-white/5">
                  <td className="py-2 pr-3 text-gray-300 whitespace-nowrap">{ch.label}</td>
                  {monthsData.map(m => {
                    const e = m.involved.find(x => x.channel === ch.channel);
                    return (
                      <td key={m.month} className="py-2 px-3 text-right whitespace-nowrap">
                        {e ? (
                          <>
                            <span className={`font-semibold ${e.roas == null ? 'text-gray-600' : e.roas >= 3 ? 'text-emerald-300' : e.roas >= 1 ? 'text-white' : 'text-red-400'}`}>
                              {e.roas != null ? e.roas.toFixed(2) : (e.revenue == null ? '매출 미입력' : '—')}
                            </span>
                            <span className="block text-[10px] text-gray-500">{fmtWon(e.spend)} → {fmtWon(e.revenue)}</span>
                          </>
                        ) : <span className="text-gray-700">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="bg-white/[0.03] font-semibold">
                <td className="py-2 pr-3 text-white">합계 (블렌디드)</td>
                {monthsData.map(m => (
                  <td key={m.month} className="py-2 px-3 text-right whitespace-nowrap">
                    <span className="text-emerald-300">{m.totals.blended_roas != null ? m.totals.blended_roas.toFixed(2) : '—'}</span>
                    <span className="block text-[10px] text-gray-500 font-normal">{fmtWon(m.totals.involved_spend)} → {fmtWon(m.totals.involved_revenue)}</span>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 표 2 — 지표 비관여(브랜딩) 채널: 월별 광고비·조회수 */}
      <div className="bg-[#1a1b1e] rounded-2xl p-4 border border-white/[0.06]">
        <h3 className="text-sm font-semibold text-white mb-1">지표 비관여 채널 (브랜딩) — 월별 광고비 · 조회수</h3>
        <p className="text-[11px] text-gray-500 mb-3">유튜브·메타 브랜딩 등 매출 비관여 집행. &quot;그 외 마케팅 KPI&quot; 탭에서 채널 광고비를 매출 비관여로 입력하고 조회수를 함께 기록하면 여기 반영됩니다.</p>
        {uninvolvedChannels.length === 0 ? (
          <p className="text-xs text-gray-600 py-4 text-center">
            비관여 채널 입력이 아직 없습니다 — &quot;그 외 마케팅 KPI&quot; 탭 → 채널 광고비에서 매출 관여를 끄고 광고비·조회수를 입력하세요.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[560px]">
              <thead>
                <tr className="text-gray-500 border-b border-white/5">
                  <th className="text-left py-2 pr-3 font-medium whitespace-nowrap">채널</th>
                  {monthsData.map(m => (
                    <th key={m.month} className="text-right py-2 px-3 font-medium whitespace-nowrap">{m.month.slice(2)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {uninvolvedChannels.map(ch => (
                  <tr key={ch.channel} className="border-b border-white/5">
                    <td className="py-2 pr-3 text-gray-300 whitespace-nowrap">{ch.label}</td>
                    {monthsData.map(m => {
                      const e = m.uninvolved.find(x => x.channel === ch.channel);
                      return (
                        <td key={m.month} className="py-2 px-3 text-right whitespace-nowrap">
                          {e ? (
                            <>
                              <span className="text-white font-medium">{fmtWon(e.spend)}</span>
                              <span className="block text-[10px] text-amber-300/70">view {fmtViews(e.views)}</span>
                            </>
                          ) : <span className="text-gray-700">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="bg-white/[0.03] font-semibold">
                  <td className="py-2 pr-3 text-white">합계</td>
                  {monthsData.map(m => (
                    <td key={m.month} className="py-2 px-3 text-right whitespace-nowrap">
                      <span className="text-white">{fmtWon(m.totals.uninvolved_spend)}</span>
                      <span className="block text-[10px] text-amber-300/70 font-normal">view {fmtViews(m.totals.uninvolved_views)}</span>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
