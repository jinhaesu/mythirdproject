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
    <div className="bg-[#0F1011] border border-[#23252A] rounded-xl p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h3 className="text-sm font-semibold text-[#D0D6E0] flex items-center gap-1.5">
          <Search size={14} className="text-[#03C75A]" />
          네이버 검색량 추이
          {naverData && (
            <span className="text-[10px] font-normal text-[#62666D]">
              {naverData.isAbsolute ? '월간 검색량(추정)' : '상대지수'}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          <input
            value={keywordsInput}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setKeywordsInput(e.target.value)}
            placeholder="키워드 (쉼표 구분, 최대 5개)"
            className="px-3 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] w-64 focus:outline-none focus:border-[#5E6AD2]"
          />
          <button
            onClick={() => refetchNaver()}
            disabled={naverLoading}
            className="flex items-center gap-1 px-3 py-1.5 bg-[#5E6AD2] text-white text-xs font-medium rounded-lg hover:bg-[#828FFF] disabled:opacity-50"
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
        <p className="text-xs text-[#8A8F98] py-6 text-center">네이버 데이터랩 연동이 설정되어 있지 않습니다.</p>
      ) : naverIsError ? (
        <p className="text-xs text-[#EB5757] py-6 text-center">검색량 데이터를 불러오지 못했습니다.</p>
      ) : naverLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 size={24} className="animate-spin text-[#7070FF]" />
        </div>
      ) : (naverData?.series?.length ?? 0) === 0 ? (
        <p className="text-xs text-[#62666D] py-6 text-center">검색량 데이터가 없습니다.</p>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={naverData?.series ?? []} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#23252A" />
              <XAxis dataKey="period" tick={{ fontSize: 10, fill: '#8A8F98' }} />
              <YAxis
                tick={{ fontSize: 10, fill: '#8A8F98' }}
                tickFormatter={(v: number) =>
                  naverData?.isAbsolute
                    ? (v >= 10000 ? `${Math.round(v / 10000)}만` : v.toLocaleString('ko-KR'))
                    : String(v)
                }
              />
              <RechartsTooltip
                contentStyle={{ backgroundColor: '#141516', border: '1px solid #23252A', borderRadius: 8, fontSize: 11 }}
                labelStyle={{ color: '#D0D6E0' }}
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
