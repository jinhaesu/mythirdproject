'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Info, Loader2, Users2 } from 'lucide-react';
import {
  Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { kpiApi } from '@/lib/api';
import type { KPIDemographicRow } from '@/lib/api';
import { fmtNum, fmtWon } from './format';

const BAND_LABELS: Record<string, string> = {
  '13-17': '13~17세',
  '18-24': '18~24세',
  '25-34': '25~34세',
  '35-44': '35~44세',
  '45-54': '45~54세',
  '55-64': '55~64세',
  '65+': '65세+',
  F: '여성',
  M: '남성',
  unknown: '미상',
};

function bandLabel(b: string): string {
  return BAND_LABELS[b] || b;
}

export function DemographicsCard() {
  const [dim, setDim] = useState<'age' | 'gender'>('age');

  const { data, isLoading } = useQuery({
    queryKey: ['kpi-demographics'],
    queryFn: () => kpiApi.getDemographics(6),
    staleTime: 10 * 60 * 1000,
  });

  const months = data?.months ?? [];
  const [selMonth, setSelMonth] = useState<string>('');
  const activeMonth = selMonth || (months.length ? months[months.length - 1] : '');

  const rows: KPIDemographicRow[] = useMemo(() => {
    if (!data) return [];
    const src = dim === 'age' ? data.age : data.gender;
    return src.filter((r) => r.month === activeMonth);
  }, [data, dim, activeMonth]);

  // 표시할 밴드: 값이 전부 0/null인 밴드는 숨김 (미상은 데이터 있으면 표시)
  const visibleRows = useMemo(
    () => rows.filter((r) => r.new_customers > 0 || (r.ltv ?? 0) > 0 || (r.meta_spend ?? 0) > 0),
    [rows],
  );

  const chartData = useMemo(() => visibleRows.map((r) => ({
    band: bandLabel(r.band),
    meta_spend: r.meta_spend ?? 0,
    ltv: r.ltv,
    cac: r.cac,
  })), [visibleRows]);

  const birthyearCoverage = data && data.coverage.members_enriched > 0
    ? (data.coverage.birthyear_known / data.coverage.members_enriched) * 100
    : 0;
  const genderCoverage = data && data.coverage.members_enriched > 0
    ? (data.coverage.gender_known / data.coverage.members_enriched) * 100
    : 0;

  return (
    <div className="bg-[#0F1011] border border-[#23252A] rounded-xl p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h3 className="text-sm font-semibold text-[#D0D6E0] flex items-center gap-1.5">
          <Users2 size={14} className="text-[#F2994A]" />
          연령대·성별 CAC / LTV
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center bg-[#141516] rounded-lg p-0.5">
            {([{ k: 'age', label: '연령대' }, { k: 'gender', label: '성별' }] as const).map((t) => (
              <button
                key={t.k}
                onClick={() => setDim(t.k)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  dim === t.k ? 'bg-[#0F1011] text-[#7070FF] shadow-[0px_1px_3px_rgba(0,0,0,0.2)]' : 'text-[#8A8F98] hover:text-[#D0D6E0]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <select
            value={activeMonth}
            onChange={(e) => setSelMonth(e.target.value)}
            className="px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
          >
            {months.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 size={24} className="animate-spin text-[#7070FF]" />
        </div>
      ) : (
        <>
          {dim === 'age' && data.coverage.birthyear_known === 0 && (
            <p className="text-[11px] text-[#F0BF00] mb-3 leading-relaxed">
              ⚠ 카페24 회원 출생연도 데이터가 아직 없어 신규고객·LTV가 전부 &lsquo;미상&rsquo;으로 집계됩니다.
              아래 Meta 연령별 광고비는 Meta 실집행 데이터라 지금도 유효합니다. 연령별 고객 분석을 켜려면
              카페24 개인정보 읽기(mall.read_privacy) 권한 재동의가 필요합니다.
            </p>
          )}

          {visibleRows.length > 0 && (
            <div className="h-56 mb-3">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#23252A" />
                  <XAxis dataKey="band" tick={{ fontSize: 10, fill: '#8A8F98' }} />
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
                    formatter={(value: any, name: any) => [fmtWon(Number(value)), name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="left" dataKey="meta_spend" name="Meta 광고비" fill="#4EA7FC" radius={[3, 3, 0, 0]} maxBarSize={36} />
                  <Line yAxisId="right" type="monotone" dataKey="ltv" name="LTV" stroke="#27A644" strokeWidth={2} />
                  <Line yAxisId="right" type="monotone" dataKey="cac" name="CAC (Meta 기준)" stroke="#EB5757" strokeWidth={2} strokeDasharray="4 4" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[#23252A] text-[10px] text-[#62666D] uppercase tracking-wide">
                  <th className="px-3 py-2">{dim === 'age' ? '연령대' : '성별'}</th>
                  <th className="px-3 py-2 text-right">신규고객</th>
                  <th className="px-3 py-2 text-right">LTV 산정 고객수</th>
                  <th className="px-3 py-2 text-right">LTV</th>
                  <th className="px-3 py-2 text-right">Meta 광고비</th>
                  <th className="px-3 py-2 text-right">CAC (Meta 기준)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.band} className="border-b border-[#23252A]/60 hover:bg-[#141516]/40">
                    <td className="px-3 py-2 text-xs text-[#D0D6E0]">{bandLabel(r.band)}</td>
                    <td className="px-3 py-2 text-xs text-right text-[#D0D6E0]">{fmtNum(r.new_customers)}</td>
                    <td className="px-3 py-2 text-xs text-right text-[#8A8F98]">{fmtNum(r.ltv_customers)}</td>
                    <td className="px-3 py-2 text-xs text-right text-[#27A644]">{fmtWon(r.ltv)}</td>
                    <td className="px-3 py-2 text-xs text-right text-[#4EA7FC]">{r.meta_spend != null ? fmtWon(r.meta_spend) : '-'}</td>
                    <td className="px-3 py-2 text-xs text-right text-[#EB5757]">{fmtWon(r.cac)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-xs text-[#62666D]">데이터가 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* 산식 설명 */}
          <div className="mt-3 bg-[#141516] border border-[#23252A] rounded-lg p-3">
            <p className="text-[11px] font-semibold text-[#8A8F98] flex items-center gap-1 mb-1.5">
              <Info size={12} /> 계산 기준
            </p>
            <ul className="text-[10px] text-[#62666D] space-y-1 leading-relaxed list-disc pl-4">
              <li><b className="text-[#8A8F98]">신규고객</b>: {data.basis.new_customers}</li>
              <li><b className="text-[#8A8F98]">LTV</b>: {data.basis.ltv}</li>
              <li><b className="text-[#8A8F98]">CAC</b>: {data.basis.cac}</li>
              <li><b className="text-[#8A8F98]">연령대 기준</b>: {data.basis.age_band}</li>
              <li>
                <b className="text-[#8A8F98]">데이터 커버리지</b>: 회원 {fmtNum(data.coverage.members_enriched)}명 수집
                — 성별 확인 {genderCoverage.toFixed(0)}%, 출생연도 확인 {birthyearCoverage.toFixed(0)}%
                {!data.meta_available && ' · Meta 광고비 breakdown 조회 불가(자격증명 확인 필요)'}
              </li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
