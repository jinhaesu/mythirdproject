'use client';

/**
 * 광고 채널 공통 기간 선택 — [Meta 성과] 탭의 날짜 설정과 동일한 UI/프리셋/기본값(최근 30일).
 * 모든 날짜는 한국시간(KST) 기준 YYYY-MM-DD 문자열로 계산한다.
 */
import { useCallback, useMemo, useState } from 'react';

export type AdDatePreset =
  | 'today' | 'yesterday' | 'last_3d' | 'last_7d' | 'last_14d' | 'last_30d'
  | 'this_month' | 'last_month' | 'custom';

export const AD_DATE_PRESETS: { value: AdDatePreset; label: string }[] = [
  { value: 'today', label: '오늘' },
  { value: 'yesterday', label: '어제' },
  { value: 'last_3d', label: '최근 3일' },
  { value: 'last_7d', label: '최근 7일' },
  { value: 'last_14d', label: '최근 14일' },
  { value: 'last_30d', label: '최근 30일' },
  { value: 'this_month', label: '이번달' },
  { value: 'last_month', label: '지난달' },
  { value: 'custom', label: '직접 지정' },
];

export const AD_DATE_DEFAULT: AdDatePreset = 'last_30d';

export interface AdDateRange { since: string; until: string }

/** 한국 날짜 YYYY-MM-DD */
export const kstToday = (): string =>
  new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

/** YYYY-MM-DD 문자열에 n일 더하기 (타임존 영향 없음) */
export const addDays = (ymd: string, n: number): string => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/**
 * 프리셋 → {since, until}. '최근 N일'은 오늘을 포함한 N일(KST).
 * custom 은 시작·종료가 모두 있고 시작<=종료일 때만 반환, 아니면 null.
 */
export function resolveAdDateRange(
  preset: AdDatePreset, customSince = '', customUntil = '',
): AdDateRange | null {
  const today = kstToday();
  switch (preset) {
    case 'today': return { since: today, until: today };
    case 'yesterday': { const y = addDays(today, -1); return { since: y, until: y }; }
    case 'last_3d': return { since: addDays(today, -2), until: today };
    case 'last_7d': return { since: addDays(today, -6), until: today };
    case 'last_14d': return { since: addDays(today, -13), until: today };
    case 'last_30d': return { since: addDays(today, -29), until: today };
    case 'this_month': return { since: `${today.slice(0, 7)}-01`, until: today };
    case 'last_month': {
      const lastOfPrev = addDays(`${today.slice(0, 7)}-01`, -1);
      return { since: `${lastOfPrev.slice(0, 7)}-01`, until: lastOfPrev };
    }
    case 'custom':
      return customSince && customUntil && customSince <= customUntil
        ? { since: customSince, until: customUntil } : null;
  }
}

/** 기간 상태 훅 — 기본값 최근 30일 */
export function useAdDateRange(initial: AdDatePreset = AD_DATE_DEFAULT) {
  const [preset, setPreset] = useState<AdDatePreset>(initial);
  const [customSince, setCustomSince] = useState('');
  const [customUntil, setCustomUntil] = useState('');
  /** 현재 선택의 실제 날짜 범위 (직접 지정이 미완성/역전이면 null) */
  const range = useMemo(
    () => resolveAdDateRange(preset, customSince, customUntil),
    [preset, customSince, customUntil],
  );
  /** 직접 지정 값을 한 번에 채우기 (월 보기 등 외부 단축 버튼용) */
  const setCustomRange = useCallback((since: string, until: string) => {
    setCustomSince(since); setCustomUntil(until); setPreset('custom');
  }, []);
  return {
    preset, setPreset, customSince, setCustomSince, customUntil, setCustomUntil,
    range, setCustomRange,
    pickerProps: {
      preset, customSince, customUntil,
      onPresetChange: setPreset, onSinceChange: setCustomSince, onUntilChange: setCustomUntil,
    },
  };
}

interface AdDatePickerProps {
  preset: AdDatePreset;
  customSince: string;
  customUntil: string;
  onPresetChange: (p: AdDatePreset) => void;
  onSinceChange: (v: string) => void;
  onUntilChange: (v: string) => void;
}

export function AdDatePicker({
  preset, customSince, customUntil, onPresetChange, onSinceChange, onUntilChange,
}: AdDatePickerProps) {
  return (
    <>
      <select
        value={preset}
        onChange={(e) => onPresetChange(e.target.value as AdDatePreset)}
        className="px-3 py-2 border border-border-primary rounded-lg text-sm"
      >
        {AD_DATE_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>{p.label}</option>
        ))}
      </select>
      {preset === 'custom' && (
        <>
          <input type="date" value={customSince} onChange={(e) => onSinceChange(e.target.value)} max={customUntil || undefined}
            className="px-3 py-2 border border-border-primary rounded-lg text-xs" />
          <span className="text-text-quaternary text-xs">~</span>
          <input type="date" value={customUntil} onChange={(e) => onUntilChange(e.target.value)} min={customSince || undefined}
            className="px-3 py-2 border border-border-primary rounded-lg text-xs" />
          {customSince && customUntil && customSince > customUntil && (
            <span className="text-red text-[10px]">시작일이 종료일보다 뒤입니다</span>
          )}
        </>
      )}
    </>
  );
}
