'use client';

import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import {
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import { kpiApi } from '@/lib/api';
import { LINE_PALETTE } from './format';

/** 조회 기간(개월) — 별도 UI 토글 없이 자립형 카드 내부 기본값으로 고정 */
const NAVER_QUERY_MONTHS = 6;

/** 네이버 검색량 추이 카드 — 자립형(자체 state/query 포함), 마케팅 KPI 각 탭에서 재사용 */
export function NaverQueriesCard() {
  const [keywordsInput, setKeywordsInput] = useState('널담,널담은디저트');
  const keywordsList = useMemo(
    () => keywordsInput.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 5),
    [keywordsInput],
  );

  const {
    data: naverData, isLoading: naverLoading, isError: naverIsError, error: naverErrorRaw, refetch: refetchNaver,
  } = useQuery({
    queryKey: ['kpi-naver-queries', keywordsList, NAVER_QUERY_MONTHS],
    queryFn: () => kpiApi.getNaverQueries(keywordsList, NAVER_QUERY_MONTHS),
    enabled: keywordsList.length > 0,
    retry: 1,
  });

  const naverIs503 = (naverErrorRaw as any)?.response?.status === 503;

  return (
    <div className="bg-bg-1 border border-border-primary rounded-xl p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h3 className="text-sm font-semibold text-text-secondary flex items-center gap-1.5">
          <Search size={14} className="text-[#03C75A]" />
          네이버 검색량 추이
          {naverData && (
            <span className="text-[10px] font-normal text-text-quaternary">
              {naverData.isAbsolute ? '월간 검색량(추정)' : '상대지수'}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={keywordsInput}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setKeywordsInput(e.target.value)}
            placeholder="키워드 (쉼표 구분, 최대 5개)"
            className="px-3 py-1.5 bg-bg-0 border border-border-primary rounded-lg text-xs text-text-secondary w-full sm:w-64 focus:outline-none focus:border-brand"
          />
          <button
            onClick={() => refetchNaver()}
            disabled={naverLoading}
            className="flex items-center gap-1 px-3 py-1.5 bg-brand text-white text-xs font-medium rounded-lg hover:bg-accent-hover disabled:opacity-50"
          >
            {naverLoading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />} 조회
          </button>
        </div>
      </div>

      {naverData?.isAbsolute && naverData.volumes && (
        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          {Object.entries(naverData.volumes).map(([kw, v]) => (
            <span
              key={kw}
              className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#03C75A]/15 text-[#03C75A] whitespace-nowrap"
            >
              {kw} 최근 검색량 {v.total.toLocaleString('ko-KR')}회
            </span>
          ))}
        </div>
      )}

      {naverIs503 ? (
        <p className="text-xs text-text-tertiary py-6 text-center">네이버 데이터랩 연동이 설정되어 있지 않습니다.</p>
      ) : naverIsError ? (
        <p className="text-xs text-red py-6 text-center">검색량 데이터를 불러오지 못했습니다.</p>
      ) : naverLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 size={24} className="animate-spin text-accent" />
        </div>
      ) : (naverData?.series?.length ?? 0) === 0 ? (
        <p className="text-xs text-text-quaternary py-6 text-center">검색량 데이터가 없습니다.</p>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={naverData?.series ?? []} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
              <XAxis dataKey="period" tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }} />
              <YAxis
                tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }}
                tickFormatter={(v: number) =>
                  naverData?.isAbsolute
                    ? (v >= 10000 ? `${Math.round(v / 10000)}만` : v.toLocaleString('ko-KR'))
                    : String(v)
                }
              />
              <RechartsTooltip
                contentStyle={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)', borderRadius: 8, fontSize: 11 }}
                labelStyle={{ color: 'var(--color-text-secondary)' }}
                formatter={(value: any, name: any) =>
                  naverData?.isAbsolute ? [`${Number(value).toLocaleString('ko-KR')}회`, name] : [value, name]
                }
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {(naverData?.keywords ?? keywordsList).map((kw: string, i: number) => (
                <Line key={kw} type="monotone" dataKey={kw} name={kw} stroke={LINE_PALETTE[i % LINE_PALETTE.length]} strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
