'use client';

/**
 * 협찬 분석 — sponsorship/summary 기반 그래프·집계.
 *
 * 월별 협찬 건수·환산금액 추이, 종류별 분포, 품목별 수량, 결과물 현황.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis,
  Tooltip as RechartsTooltip, Legend, CartesianGrid,
} from 'recharts';
import { sponsorshipApi } from '@/lib/api';
import { fmtWon, fmtNum, LINE_PALETTE } from '@/components/tabs/kpi/format';

const RANGE_PRESETS = [
  { months: 6, label: '6개월' },
  { months: 12, label: '12개월' },
  { months: 24, label: '24개월' },
];

const wonTick = (v: number) =>
  v >= 100000000 ? `${(v / 100000000).toFixed(1)}억` : v >= 10000 ? `${Math.round(v / 10000)}만` : String(v);

export function SponsorshipAnalytics() {
  const [months, setMonths] = useState(12);

  const { data: s, isLoading } = useQuery({
    queryKey: ['sponsorship', 'summary', months],
    queryFn: () => sponsorshipApi.summary(months),
  });

  const monthly = (s?.by_month || []).map((m) => ({ ...m, label: m.month.slice(2) }));
  const byType = s?.by_event_type || [];
  const byProduct = (s?.by_product || []).slice(0, 10);
  const byKind = s?.by_outcome_kind || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h2 className="text-base font-semibold text-text-primary">협찬 분석</h2>
          <p className="text-xs text-text-tertiary mt-0.5">
            등록된 협찬을 종류·품목·결과물 축으로 집계합니다 — 환산 금액은 품목 기입값 기준
          </p>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          {RANGE_PRESETS.map((p) => (
            <button key={p.months} onClick={() => setMonths(p.months)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border ${
                months === p.months ? 'text-white border-transparent' : 'text-text-tertiary border-border-primary hover:text-text-primary'
              }`}
              style={months === p.months ? { backgroundColor: 'var(--color-brand-bg)' } : undefined}
            >{p.label}</button>
          ))}
        </div>
      </div>

      {/* 핵심 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: '협찬 건수', value: s ? `${fmtNum(s.total.count)}건` : '-' },
          { label: '품목 수량 합계', value: s ? `${fmtNum(s.total.quantity)}개` : '-' },
          { label: '환산 금액 합계', value: s ? fmtWon(s.total.estimated_value) : '-' },
          { label: '결과물', value: s ? `${fmtNum(s.total.outcomes)}건` : '-' },
          { label: '결과물 조회/노출 합', value: s ? fmtNum(s.total.views) : '-' },
        ].map((c) => (
          <div key={c.label} className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
            <p className="text-[11px] text-text-tertiary">{c.label}</p>
            <p className="text-lg font-bold text-text-primary tabular-nums mt-1">{c.value}</p>
          </div>
        ))}
      </div>

      {/* 월별 추이 */}
      <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
        <h3 className="text-sm font-semibold text-text-primary mb-3">월별 협찬 건수 · 환산 금액</h3>
        {isLoading ? (
          <p className="text-xs text-text-tertiary py-8 text-center">불러오는 중...</p>
        ) : monthly.length === 0 ? (
          <p className="text-xs text-text-tertiary py-8 text-center">데이터가 없습니다 — 협찬 등록·목록에서 먼저 기록해 주세요</p>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthly} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--color-text-quaternary)' }} tickLine={false} axisLine={false} />
                <YAxis yAxisId="left" allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--color-text-quaternary)' }} tickLine={false} axisLine={false} width={32} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#F0BF00' }} tickLine={false} axisLine={false}
                  tickFormatter={wonTick} width={48} />
                <RechartsTooltip
                  contentStyle={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)', borderRadius: 8, fontSize: 11 }}
                  formatter={(v: any, name: any) => (name === '환산 금액' ? [fmtWon(Number(v)), name] : [fmtNum(Number(v)), name])}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar yAxisId="left" dataKey="count" name="협찬 건수" fill={LINE_PALETTE[0]} maxBarSize={36} />
                <Bar yAxisId="left" dataKey="outcomes" name="결과물 수" fill={LINE_PALETTE[1]} maxBarSize={36} />
                <Line yAxisId="right" type="monotone" dataKey="estimated_value" name="환산 금액" stroke="#F0BF00" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 종류별 분포 */}
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
          <h3 className="text-sm font-semibold text-text-primary mb-3">종류별 협찬 (전시·마라톤·축제…)</h3>
          {byType.length === 0 ? (
            <p className="text-xs text-text-tertiary py-8 text-center">데이터가 없습니다</p>
          ) : (
            <>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byType} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
                    <XAxis dataKey="event_type" tick={{ fontSize: 10, fill: 'var(--color-text-quaternary)' }} tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--color-text-quaternary)' }} tickLine={false} axisLine={false} width={28} />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)', borderRadius: 8, fontSize: 11 }}
                      formatter={(v: any, name: any) => [fmtNum(Number(v)), name]}
                    />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="count" name="건수" fill={LINE_PALETTE[0]} maxBarSize={32} />
                    <Bar dataKey="outcomes" name="결과물" fill={LINE_PALETTE[1]} maxBarSize={32} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <table className="w-full text-[11px] mt-3">
                <thead>
                  <tr className="text-text-quaternary">
                    <th className="text-left py-1 font-medium">종류</th>
                    <th className="text-right py-1 font-medium">건수</th>
                    <th className="text-right py-1 font-medium">수량</th>
                    <th className="text-right py-1 font-medium">환산금액</th>
                    <th className="text-right py-1 font-medium">결과물</th>
                  </tr>
                </thead>
                <tbody>
                  {byType.map((t) => (
                    <tr key={t.event_type} style={{ borderTop: '1px solid rgb(var(--color-overlay-rgb) / 0.05)' }}>
                      <td className="py-1 text-text-primary">{t.event_type}</td>
                      <td className="py-1 text-right tabular-nums text-text-secondary">{fmtNum(t.count)}</td>
                      <td className="py-1 text-right tabular-nums text-text-secondary">{fmtNum(t.quantity)}</td>
                      <td className="py-1 text-right tabular-nums text-text-secondary">{fmtWon(t.estimated_value)}</td>
                      <td className="py-1 text-right tabular-nums text-text-secondary">{fmtNum(t.outcomes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        {/* 품목별 수량 */}
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
          <h3 className="text-sm font-semibold text-text-primary mb-3">품목별 협찬 수량 (상위 10)</h3>
          {byProduct.length === 0 ? (
            <p className="text-xs text-text-tertiary py-8 text-center">데이터가 없습니다</p>
          ) : (
            <div style={{ height: Math.max(192, byProduct.length * 30) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byProduct} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--color-text-quaternary)' }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="product" width={110}
                    tick={{ fontSize: 10, fill: 'var(--color-text-secondary)' }} tickLine={false} axisLine={false} />
                  <RechartsTooltip
                    contentStyle={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)', borderRadius: 8, fontSize: 11 }}
                    formatter={(v: any, name: any) => [fmtNum(Number(v)), name]}
                  />
                  <Bar dataKey="quantity" name="수량" fill={LINE_PALETTE[0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {/* 결과물 종류 현황 */}
          {byKind.length > 0 && (
            <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--color-border-primary)' }}>
              <p className="text-[11px] font-medium text-text-tertiary mb-1.5">결과물 종류별</p>
              <div className="flex flex-wrap gap-2">
                {byKind.map((k) => (
                  <span key={k.kind} className="px-2 py-1 rounded-lg text-[11px]" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.06)' }}>
                    <b className="text-text-primary">{k.kind}</b>
                    <span className="text-text-tertiary"> {fmtNum(k.count)}건{k.views ? ` · 조회 ${fmtNum(k.views)}` : ''}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {s && (
        <p className="text-[10px] text-text-quaternary text-right">
          집계 기간: 최근 {months}개월 · 기준(as-of): {s.as_of?.slice(0, 10)} · 환산 금액 = 등록 시 기입한 품목 환산값 합
        </p>
      )}
    </div>
  );
}
