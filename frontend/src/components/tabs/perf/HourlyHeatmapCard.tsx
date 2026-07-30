'use client';

import { useCallback, useMemo, useState, useTransition } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Clock3, Loader2 } from 'lucide-react';
import { insightsApi } from '@/lib/api';
import { HeatmapGrid } from '@/components/ui/HeatmapGrid';

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];

type MetricKey = 'spend' | 'impressions' | 'clicks' | 'purchases' | 'revenue' | 'roas';

const METRIC_KEYS = ['spend', 'impressions', 'clicks', 'purchases', 'revenue'] as const;

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

export interface HourlyHeatmapParams {
  days?: number;
  since?: string;
  until?: string;
}

/** 성과분석 상단 기간 설정과 연동 — params는 트렌드 조회와 동일 기준으로 전달받는다. */
export function HourlyHeatmapCard({ params }: { params: HourlyHeatmapParams }) {
  const [metric, setMetric] = useState<MetricKey>('spend');
  const [isPending, startTransition] = useTransition();

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['insight-hourly-heatmap', params.days ?? null, params.since ?? null, params.until ?? null],
    queryFn: () => insightsApi.getHourlyHeatmap(params),
    placeholderData: keepPreviousData,
    staleTime: 30 * 60 * 1000,
  });

  // 지표 6종 매트릭스·최대값을 데이터 도착 시 1회 사전 계산 — 토글 클릭 시 계산 0
  const metricData = useMemo(() => {
    if (!data?.available || !data.matrices) return null;
    const out = {} as Record<MetricKey, { matrix: number[][]; max: number }>;
    METRIC_KEYS.forEach((k) => {
      const m = data.matrices![k];
      out[k] = { matrix: m, max: Math.max(0, ...m.flat()) };
    });
    const roas = data.matrices.spend.map((row, w) =>
      row.map((s, h) => (s > 0 ? (data.matrices!.revenue[w][h] || 0) / s : 0)),
    );
    out.roas = { matrix: roas, max: Math.max(0, ...roas.flat()) };
    return out;
  }, [data]);

  const current = metricData?.[metric] ?? null;

  const peak = useMemo(() => {
    if (!current || current.max <= 0) return null;
    for (let w = 0; w < 7; w += 1) {
      for (let h = 0; h < 24; h += 1) {
        if (current.matrix[w][h] === current.max) return { w, h };
      }
    }
    return null;
  }, [current]);

  const formatValue = useCallback((v: number) => fmtMetric(metric, v), [metric]);

  const visibleMetrics = METRICS.filter((m) => !m.needsActions || data?.actions_available !== false);
  const refreshing = isFetching && !!data;

  return (
    <div className="bg-bg-1 border border-border-primary rounded-xl p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h3 className="text-sm font-semibold text-text-secondary flex items-center gap-1.5">
          <Clock3 size={14} className="text-accent" />
          요일×시간대 광고 집행 히트맵
          <span className="text-[10px] font-normal text-text-quaternary">Meta 실집행 · KST · 상단 기간 연동</span>
          {refreshing && (
            <span className="flex items-center gap-1 text-[10px] font-normal text-accent">
              <Loader2 size={10} className="animate-spin" /> 기간 적용 중…
            </span>
          )}
        </h3>
        <div className="flex items-center bg-bg-2 rounded-lg p-0.5 flex-wrap">
          {visibleMetrics.map((m) => (
            <button
              key={m.key}
              onClick={() => startTransition(() => setMetric(m.key))}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                metric === m.key ? 'bg-bg-1 text-accent shadow-[0px_1px_3px_rgba(0,0,0,0.2)]' : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading || !data ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 size={24} className="animate-spin text-accent" />
        </div>
      ) : !data.available || !current ? (
        <p className="text-xs text-text-quaternary py-8 text-center">{data.reason || '데이터를 불러오지 못했습니다.'}</p>
      ) : (
        <>
          <div className={`transition-opacity duration-150 ${isPending || refreshing ? 'opacity-50' : 'opacity-100'}`}>
            <HeatmapGrid matrix={current.matrix} max={current.max} formatValue={formatValue} />
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2 mt-3 text-[11px] text-text-tertiary">
            <span>
              {data.since} ~ {data.until} 합산
              {peak && (
                <span className="text-text-secondary">
                  {' '}· 피크 {WEEKDAYS[peak.w]}요일 {peak.h}시 ({fmtMetric(metric, current.max)})
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

          {data.clamped && (
            <p className="text-[10px] text-yellow mt-2">
              ⚠ 시간대 분석은 최대 92일까지 지원되어 선택 기간이 최근 92일로 잘렸습니다.
            </p>
          )}

          {data.basis && (
            <div className="mt-3 bg-bg-2 border border-border-primary rounded-lg p-3 text-[10px] text-text-tertiary leading-relaxed space-y-1">
              <p><b className="text-text-secondary">광고비:</b> {data.basis.spend}</p>
              <p><b className="text-text-secondary">구매·매출 귀속:</b> {data.basis.attribution}</p>
              <p><b className="text-text-secondary">기간:</b> {data.basis.period}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
