'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock3, Loader2 } from 'lucide-react';
import { insightsApi } from '@/lib/api';
import { HeatmapGrid } from '@/components/ui/HeatmapGrid';

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];

type MetricKey = 'spend' | 'impressions' | 'clicks' | 'purchases' | 'revenue' | 'roas';

const METRICS: { key: MetricKey; label: string; needsActions: boolean }[] = [
  { key: 'spend', label: '광고비', needsActions: false },
  { key: 'impressions', label: '노출', needsActions: false },
  { key: 'clicks', label: '클릭', needsActions: false },
  { key: 'purchases', label: '구매', needsActions: true },
  { key: 'revenue', label: '매출', needsActions: true },
  { key: 'roas', label: 'ROAS', needsActions: true },
];

function fmtMetric(metric: MetricKey, v: number): string {
  if (metric === 'spend' || metric === 'revenue') return `${Math.round(v).toLocaleString('ko-KR')}원`;
  if (metric === 'roas') return v > 0 ? `${v.toFixed(2)}x` : '-';
  const unit = metric === 'purchases' ? '건' : '회';
  return `${Math.round(v).toLocaleString('ko-KR')}${unit}`;
}

export function HourlyHeatmapCard() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [metric, setMetric] = useState<MetricKey>('spend');

  const { data, isLoading } = useQuery({
    queryKey: ['insight-hourly-heatmap', days],
    queryFn: () => insightsApi.getHourlyHeatmap(days),
    staleTime: 30 * 60 * 1000,
  });

  const matrix = useMemo<number[][] | null>(() => {
    if (!data?.available || !data.matrices) return null;
    if (metric === 'roas') {
      return data.matrices.spend.map((row, w) =>
        row.map((s, h) => (s > 0 ? (data.matrices!.revenue[w][h] || 0) / s : 0)),
      );
    }
    return data.matrices[metric];
  }, [data, metric]);

  const max = useMemo(() => (matrix ? Math.max(0, ...matrix.flat()) : 0), [matrix]);

  const peak = useMemo(() => {
    if (!matrix || max <= 0) return null;
    for (let w = 0; w < 7; w += 1) {
      for (let h = 0; h < 24; h += 1) {
        if (matrix[w][h] === max) return { w, h };
      }
    }
    return null;
  }, [matrix, max]);

  const formatValue = useCallback((v: number) => fmtMetric(metric, v), [metric]);

  const visibleMetrics = METRICS.filter((m) => !m.needsActions || data?.actions_available !== false);

  return (
    <div className="bg-[#0F1011] border border-[#23252A] rounded-xl p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h3 className="text-sm font-semibold text-[#D0D6E0] flex items-center gap-1.5">
          <Clock3 size={14} className="text-[#7070FF]" />
          요일×시간대 광고 집행 히트맵
          <span className="text-[10px] font-normal text-[#62666D]">Meta 실집행 · KST</span>
        </h3>
        <div className="flex items-center flex-wrap gap-y-2 gap-x-2">
          <div className="flex items-center bg-[#141516] rounded-lg p-0.5 flex-wrap">
            {visibleMetrics.map((m) => (
              <button
                key={m.key}
                onClick={() => setMetric(m.key)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                  metric === m.key ? 'bg-[#0F1011] text-[#7070FF] shadow-[0px_1px_3px_rgba(0,0,0,0.2)]' : 'text-[#8A8F98] hover:text-[#D0D6E0]'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="flex items-center bg-[#141516] rounded-lg p-0.5">
            {([7, 30, 90] as const).map((n) => (
              <button
                key={n}
                onClick={() => setDays(n)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                  days === n ? 'bg-[#0F1011] text-[#7070FF] shadow-[0px_1px_3px_rgba(0,0,0,0.2)]' : 'text-[#8A8F98] hover:text-[#D0D6E0]'
                }`}
              >
                {n}일
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 size={24} className="animate-spin text-[#7070FF]" />
        </div>
      ) : !data.available || !matrix ? (
        <p className="text-xs text-[#62666D] py-8 text-center">{data.reason || '데이터를 불러오지 못했습니다.'}</p>
      ) : (
        <>
          <HeatmapGrid matrix={matrix} max={max} formatValue={formatValue} />

          <div className="flex items-center justify-between flex-wrap gap-2 mt-3 text-[11px] text-[#8A8F98]">
            <span>
              {data.since} ~ {data.until} 합산
              {peak && (
                <span className="text-[#D0D6E0]">
                  {' '}· 피크 {WEEKDAYS[peak.w]}요일 {peak.h}시 ({fmtMetric(metric, max)})
                </span>
              )}
              {metric === 'spend' && data.totals && (
                <span> · 총 {fmtMetric('spend', data.totals.spend)}</span>
              )}
            </span>
            <span className="flex items-center gap-1">
              적음
              {[0.15, 0.35, 0.6, 0.85, 1].map((t) => (
                <span key={t} className="w-3.5 h-3.5 rounded-[3px] inline-block" style={{ background: `rgba(94,106,210,${(0.12 + t * 0.83).toFixed(2)})` }} />
              ))}
              많음
            </span>
          </div>

          {data.basis && (
            <div className="mt-3 bg-[#141516] border border-[#23252A] rounded-lg p-3 text-[10px] text-[#8A8F98] leading-relaxed space-y-1">
              <p><b className="text-[#D0D6E0]">광고비:</b> {data.basis.spend}</p>
              <p><b className="text-[#D0D6E0]">구매·매출 귀속:</b> {data.basis.attribution}</p>
              <p><b className="text-[#D0D6E0]">기간:</b> {data.basis.period}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
