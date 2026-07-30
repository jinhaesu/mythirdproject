import type { KPIGranularity, KPIMonthSummary } from '@/lib/api';

// ─── Channel constants (마케팅 KPI 탭 전반에서 공용) ───

export const CHANNEL_LABELS: Record<string, string> = {
  meta: '메타',
  naver_sa: '네이버 SA',
  naver_gfa: '네이버 GFA',
  kakao: '카카오',
  google: '구글',
  smartstore: '스마트스토어',
  coupang: '쿠팡',
  etc: '기타',
};

export const CHANNEL_COLORS: Record<string, string> = {
  meta: '#4EA7FC',
  naver_sa: '#03C75A',
  naver_gfa: '#00B36B',
  kakao: '#FEE500',
  google: '#EA4335',
  smartstore: '#1EC800',
  coupang: '#E5322D',
  etc: '#8A8F98',
};

export const LINE_PALETTE = ['#4EA7FC', '#27A644', '#F0BF00', '#EA4335', '#7070FF'];

// ─── Formatting helpers ───

export const fmtWon = (v: number | null | undefined): string =>
  v === null || v === undefined ? '-' : `₩${Math.round(v).toLocaleString('ko-KR')}`;

export const fmtRatio = (v: number | null | undefined): string =>
  v === null || v === undefined ? '-' : v.toFixed(2);

export const fmtPercent = (v: number | null | undefined): string =>
  v === null || v === undefined ? '-' : `${v.toFixed(2)}%`;

export const fmtNum = (v: number | null | undefined): string =>
  v === null || v === undefined ? '-' : Math.round(v).toLocaleString('ko-KR');

export const shortMonth = (m: string): string => m.slice(2).replace('-', '.');

/** granularity별 차트 X축 라벨. month="M월", week="MM-DD~MM-DD"(bucket_end 활용), day="MM-DD" */
export const bucketLabel = (m: KPIMonthSummary, granularity: KPIGranularity): string => {
  if (granularity === 'month') {
    const mm = parseInt((m.month.split('-')[1] || '0'), 10);
    return `${mm}월`;
  }
  const start = m.month.slice(5, 10); // MM-DD
  if (granularity === 'week') {
    const end = (m.bucket_end || '').slice(5, 10);
    return end ? `${start}~${end}` : start;
  }
  return start; // day
};

export const targetText = (v: number | null | undefined, fmt: (n: number) => string): string =>
  v === null || v === undefined ? '목표 미설정' : `목표 ${fmt(v)}`;

export function achievementBadge(
  actual: number | null | undefined,
  target: number | null | undefined,
  inverse = false,
): { label: string; color: string } {
  if (target === null || target === undefined) {
    return { label: '목표 미설정', color: 'bg-border-primary text-text-tertiary' };
  }
  if (actual === null || actual === undefined) {
    return { label: '실적 없음', color: 'bg-border-primary text-text-tertiary' };
  }
  const divisor = inverse ? actual : target;
  if (!divisor) {
    return { label: '-', color: 'bg-border-primary text-text-tertiary' };
  }
  const pct = inverse ? (target / actual) * 100 : (actual / target) * 100;
  const color =
    pct >= 100 ? 'bg-green/15 text-green' :
    pct >= 80 ? 'bg-yellow/15 text-yellow' : 'bg-red/15 text-red';
  return { label: `${pct.toFixed(0)}%`, color };
}
