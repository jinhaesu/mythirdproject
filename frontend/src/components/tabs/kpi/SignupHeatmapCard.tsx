'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Loader2 } from 'lucide-react';
import { kpiApi } from '@/lib/api';
import { fmtNum } from './format';

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];

/** 값 → 배경색 (0=투명, max=보라 최대 농도) */
function cellColor(value: number, max: number): string {
  if (!value || max <= 0) return 'rgba(255,255,255,0.02)';
  const t = Math.min(1, value / max);
  // #5E6AD2 기반 알파 스케일 (0.12 ~ 0.95)
  const alpha = 0.12 + t * 0.83;
  return `rgba(94,106,210,${alpha.toFixed(2)})`;
}

export function SignupHeatmapCard() {
  const [months, setMonths] = useState<1 | 3 | 6>(3);

  const { data, isLoading } = useQuery({
    queryKey: ['kpi-signup-heatmap', months],
    queryFn: () => kpiApi.getSignupHeatmap(months),
    staleTime: 5 * 60 * 1000,
  });

  const max = useMemo(() => {
    if (!data) return 0;
    return Math.max(0, ...data.matrix.flat());
  }, [data]);

  const peak = useMemo(() => {
    if (!data || max <= 0) return null;
    for (let w = 0; w < 7; w += 1) {
      for (let h = 0; h < 24; h += 1) {
        if (data.matrix[w][h] === max) return { w, h };
      }
    }
    return null;
  }, [data, max]);

  return (
    <div className="bg-[#0F1011] border border-[#23252A] rounded-xl p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h3 className="text-sm font-semibold text-[#D0D6E0] flex items-center gap-1.5">
          <CalendarClock size={14} className="text-[#7070FF]" />
          회원가입 시간대 히트맵
          <span className="text-[10px] font-normal text-[#62666D]">요일 × 시간 (KST)</span>
        </h3>
        <div className="flex items-center bg-[#141516] rounded-lg p-0.5">
          {([1, 3, 6] as const).map((n) => (
            <button
              key={n}
              onClick={() => setMonths(n)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                months === n ? 'bg-[#0F1011] text-[#7070FF] shadow-[0px_1px_3px_rgba(0,0,0,0.2)]' : 'text-[#8A8F98] hover:text-[#D0D6E0]'
              }`}
            >
              최근 {n}개월
            </button>
          ))}
        </div>
      </div>

      {isLoading || !data ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 size={24} className="animate-spin text-[#7070FF]" />
        </div>
      ) : data.total === 0 ? (
        <p className="text-xs text-[#62666D] py-8 text-center">
          해당 기간의 가입 데이터가 없습니다. 회원 정보 수집(백필)이 진행 중일 수 있습니다.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              {/* 시간 라벨 */}
              <div className="grid mb-1" style={{ gridTemplateColumns: '28px repeat(24, 1fr)' }}>
                <div />
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="text-center text-[9px] text-[#62666D]">
                    {h % 3 === 0 ? h : ''}
                  </div>
                ))}
              </div>
              {WEEKDAYS.map((day, w) => (
                <div key={day} className="grid gap-[2px] mb-[2px]" style={{ gridTemplateColumns: '28px repeat(24, 1fr)' }}>
                  <div className="text-[10px] text-[#8A8F98] flex items-center">{day}</div>
                  {Array.from({ length: 24 }, (_, h) => {
                    const v = data.matrix[w][h];
                    return (
                      <div
                        key={h}
                        title={`${day}요일 ${h}시: ${v.toLocaleString('ko-KR')}명`}
                        className="h-5 rounded-[3px] cursor-default"
                        style={{ background: cellColor(v, max) }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2 mt-3 text-[11px] text-[#8A8F98]">
            <span>
              기간 가입 {fmtNum(data.total)}명
              {peak && (
                <span className="text-[#D0D6E0]">
                  {' '}· 피크 {WEEKDAYS[peak.w]}요일 {peak.h}시 ({fmtNum(max)}명)
                </span>
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

          {!data.coverage.full_signup_data && (
            <p className="text-[10px] text-[#F0BF00] mt-2 leading-relaxed">
              ⚠ 현재는 <b>구매 이력이 있는 회원</b>의 가입 시각만 집계됩니다 (보강 완료{' '}
              {fmtNum(data.coverage.members_with_join)} / 구매회원 {fmtNum(data.coverage.buyers_total)}명).
              비구매 가입자까지 포함하려면 카페24 개인정보 읽기 권한 재동의가 필요합니다.
            </p>
          )}
        </>
      )}
    </div>
  );
}
