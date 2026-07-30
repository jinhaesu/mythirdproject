'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Loader2 } from 'lucide-react';
import { kpiApi } from '@/lib/api';
import { HeatmapGrid } from '@/components/ui/HeatmapGrid';
import { fmtNum } from './format';

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];
const AGE_BANDS = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'];

function fmtMembers(v: number): string {
  return `${v.toLocaleString('ko-KR')}명`;
}

export function SignupHeatmapCard() {
  const [months, setMonths] = useState<1 | 3 | 6>(3);
  const [gender, setGender] = useState<'all' | 'F' | 'M'>('all');
  const [ageBand, setAgeBand] = useState('all');

  const { data, isLoading } = useQuery({
    queryKey: ['kpi-signup-heatmap', months, gender, ageBand],
    queryFn: () => kpiApi.getSignupHeatmap(months, gender, ageBand),
    staleTime: 5 * 60 * 1000,
  });

  const filtered = gender !== 'all' || ageBand !== 'all';

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
    <div className="bg-bg-1 border border-border-primary rounded-xl p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h3 className="text-sm font-semibold text-text-secondary flex items-center gap-1.5">
          <CalendarClock size={14} className="text-accent" />
          회원가입 시간대 히트맵
          <span className="text-[10px] font-normal text-text-quaternary">요일 × 시간 (KST)</span>
        </h3>
        <div className="flex items-center flex-wrap gap-y-2 gap-x-2">
          <div className="flex items-center bg-bg-2 rounded-lg p-0.5">
            {(
              [
                ['all', '전체'],
                ['F', '여성'],
                ['M', '남성'],
              ] as const
            ).map(([g, label]) => (
              <button
                key={g}
                onClick={() => setGender(g)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                  gender === g ? 'bg-bg-1 text-accent shadow-[0px_1px_3px_rgba(0,0,0,0.2)]' : 'text-text-tertiary hover:text-text-secondary'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <select
            value={ageBand}
            onChange={(e) => setAgeBand(e.target.value)}
            className="bg-bg-2 border border-border-primary rounded-lg px-2 py-1.5 text-xs text-text-secondary focus:outline-none"
          >
            <option value="all">전체 연령</option>
            {AGE_BANDS.map((b) => (
              <option key={b} value={b}>{b}세</option>
            ))}
          </select>
          <div className="flex items-center bg-bg-2 rounded-lg p-0.5">
            {([1, 3, 6] as const).map((n) => (
              <button
                key={n}
                onClick={() => setMonths(n)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  months === n ? 'bg-bg-1 text-accent shadow-[0px_1px_3px_rgba(0,0,0,0.2)]' : 'text-text-tertiary hover:text-text-secondary'
                }`}
              >
                최근 {n}개월
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 size={24} className="animate-spin text-accent" />
        </div>
      ) : data.total === 0 ? (
        <p className="text-xs text-text-quaternary py-8 text-center">
          {filtered
            ? '선택한 성별·연령 조건의 가입 데이터가 없습니다. 개인정보 보강이 진행 중일 수 있습니다.'
            : '해당 기간의 가입 데이터가 없습니다. 회원 정보 수집(백필)이 진행 중일 수 있습니다.'}
        </p>
      ) : (
        <>
          <HeatmapGrid matrix={data.matrix} max={max} formatValue={fmtMembers} />

          <div className="flex items-center justify-between flex-wrap gap-2 mt-3 text-[11px] text-text-tertiary">
            <span>
              기간 가입 {fmtNum(data.total)}명
              {peak && (
                <span className="text-text-secondary">
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

          {filtered && (
            <p className="text-[10px] text-text-quaternary mt-2">
              성별·연령 필터는 개인정보가 보강된 회원(성별 {fmtNum(data.coverage.members_with_gender ?? 0)}명
              {ageBand !== 'all' && ` · 생년 ${fmtNum(data.coverage.members_with_birthyear ?? 0)}명`})만 집계합니다.
            </p>
          )}

          {!data.coverage.full_signup_data && (
            <p className="text-[10px] text-yellow mt-2 leading-relaxed">
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
