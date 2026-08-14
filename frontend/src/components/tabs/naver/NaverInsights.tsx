'use client';

import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Loader2, Search, TrendingUp, ShoppingBag, MessageCircle, Brain, ExternalLink, RefreshCw,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import toast from 'react-hot-toast';
import { naverInsightsApi, type TrendResult } from '@/lib/naver-api';
import { LINE_PALETTE } from '@/components/tabs/kpi/format';

const BRAND_NAME = '널담';

const PERIOD_OPTIONS = [
  { label: '1개월', days: 30 },
  { label: '3개월', days: 90 },
  { label: '6개월', days: 180 },
  { label: '1년', days: 365 },
  { label: '2년', days: 730 },
  { label: '3년', days: 1095 },
];

const TIME_UNITS = [
  { label: '일별', value: 'date' },
  { label: '주별', value: 'week' },
  { label: '월별', value: 'month' },
];

function rangeFor(days: number) {
  const end = new Date();
  end.setDate(end.getDate() - 1); // 데이터랩은 전일까지
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start_date: fmt(start), end_date: fmt(end) };
}

/** 데이터랩 results[] → recharts 시리즈 [{period, [title]: 값}] — useAbsolute면 절대 쿼리수 우선 */
function mergeSeries(results: TrendResult[], useAbsolute = false) {
  const periods = new Set<string>();
  results.forEach((r) => r.data.forEach((p) => periods.add(p.period)));
  const sorted = Array.from(periods).sort();
  return sorted.map((period) => {
    const row: Record<string, string | number> = { period };
    results.forEach((r) => {
      const found = r.data.find((p) => p.period === period);
      if (found) row[r.title] = useAbsolute ? (found.absolute ?? found.ratio) : found.ratio;
    });
    return row;
  });
}

/** 축 눈금용 축약 표기 (12000 → 1.2만) */
function compactNum(v: number): string {
  if (Math.abs(v) >= 100000000) return `${(v / 100000000).toFixed(1)}억`;
  if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(1)}만`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}천`;
  return String(Math.round(v));
}

/** 최근 7포인트 vs 이전 7포인트 평균 변화율(%) */
function recentDelta(data: { ratio: number }[]): number | null {
  if (data.length < 14) return null;
  const recent = data.slice(-7).reduce((s, p) => s + p.ratio, 0) / 7;
  const prev = data.slice(-14, -7).reduce((s, p) => s + p.ratio, 0) / 7;
  if (prev === 0) return null;
  return ((recent - prev) / prev) * 100;
}

function TrendLineChart({ results, useAbsolute = false }: { results: TrendResult[]; useAbsolute?: boolean }) {
  const series = useMemo(() => mergeSeries(results, useAbsolute), [results, useAbsolute]);
  if (series.length === 0) {
    return <p className="text-xs text-text-quaternary py-6 text-center">데이터가 없습니다.</p>;
  }
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
          <XAxis dataKey="period" tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }} />
          <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }}
            tickFormatter={useAbsolute ? (v: number) => compactNum(v) : undefined}
            width={useAbsolute ? 52 : 40} />
          <RechartsTooltip
            contentStyle={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)', borderRadius: 8, fontSize: 11 }}
            labelStyle={{ color: 'var(--color-text-secondary)' }}
            formatter={useAbsolute
              ? (value: number | string, name: string) => [`${Number(value).toLocaleString('ko-KR')}회`, name]
              : undefined}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {results.map((r, i) => (
            <Line key={r.title} type="monotone" dataKey={r.title} name={r.title} stroke={LINE_PALETTE[i % LINE_PALETTE.length]} strokeWidth={2} dot={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── 감성 마인드맵 (SVG) ──────────────────────────────────────────────────────

interface SentimentWord { word: string; weight: number; context?: string }

function SentimentMindmap({ keyword, positive, negative }: {
  keyword: string;
  positive: SentimentWord[];
  negative: SentimentWord[];
}) {
  const W = 940, H = 560, CX = W / 2, CY = H / 2;

  const layout = (words: SentimentWord[], side: 'right' | 'left') => {
    const n = words.length;
    if (n === 0) return [];
    return words.map((w, i) => {
      // 부채꼴 분산 — 우측(긍정) -65°~65°, 좌측(부정) 115°~245°
      const t = n === 1 ? 0.5 : i / (n - 1);
      const deg = side === 'right' ? -65 + t * 130 : 115 + t * 130;
      const rad = (deg * Math.PI) / 180;
      const r = 170 + (i % 2) * 95; // 두 겹 링으로 겹침 방지
      return {
        ...w,
        x: CX + r * Math.cos(rad),
        y: CY + r * Math.sin(rad),
        r: 16 + Math.min(w.weight, 10) * 2.4,
        fs: 10 + Math.min(w.weight, 10) * 0.7,
      };
    });
  };

  const pos = layout(positive, 'right');
  const neg = layout(negative, 'left');

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[640px]" style={{ maxHeight: 560 }}>
        {/* 연결선 */}
        {[...pos.map(p => ({ ...p, c: 'var(--color-green)' })), ...neg.map(p => ({ ...p, c: 'var(--color-red)' }))].map((p, i) => (
          <line key={`l${i}`} x1={CX} y1={CY} x2={p.x} y2={p.y} stroke={p.c} strokeOpacity={0.25} strokeWidth={1.5} />
        ))}
        {/* 긍정 노드 */}
        {pos.map((p, i) => (
          <g key={`p${i}`}>
            <title>{p.context ? `${p.word} — ${p.context}` : p.word}</title>
            <circle cx={p.x} cy={p.y} r={p.r} fill="var(--color-green)" fillOpacity={0.13} stroke="var(--color-green)" strokeOpacity={0.55} strokeWidth={1.5} />
            <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={p.fs} fontWeight={600} fill="var(--color-green)">{p.word}</text>
          </g>
        ))}
        {/* 부정 노드 */}
        {neg.map((p, i) => (
          <g key={`n${i}`}>
            <title>{p.context ? `${p.word} — ${p.context}` : p.word}</title>
            <circle cx={p.x} cy={p.y} r={p.r} fill="var(--color-red)" fillOpacity={0.13} stroke="var(--color-red)" strokeOpacity={0.55} strokeWidth={1.5} />
            <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={p.fs} fontWeight={600} fill="var(--color-red)">{p.word}</text>
          </g>
        ))}
        {/* 중심 노드 */}
        <rect x={CX - 78} y={CY - 26} width={156} height={52} rx={26} fill="var(--color-bg-level-2)" stroke="var(--color-border-primary)" strokeWidth={1.5} />
        <text x={CX} y={CY + 5} textAnchor="middle" fontSize={16} fontWeight={700} fill="var(--color-text-primary)">{keyword}</text>
        {/* 범례 */}
        <text x={W - 12} y={22} textAnchor="end" fontSize={11} fill="var(--color-green)">● 긍정</text>
        <text x={W - 70} y={22} textAnchor="end" fontSize={11} fill="var(--color-red)">● 부정</text>
      </svg>
    </div>
  );
}

// ── 메인 탭 ──────────────────────────────────────────────────────────────────

export function NaverInsights() {
  return (
    <div className="space-y-6">
      <StatusBanner />
      <SearchTrendPanel />
      <ShoppingCategoryPanel />
      <ShoppingKeywordPanel />
      <MentionPanel />
      <SentimentPanel />
    </div>
  );
}

function StatusBanner() {
  const { data } = useQuery({ queryKey: ['ni-status'], queryFn: naverInsightsApi.getStatus, staleTime: 300_000 });
  if (!data || data.configured) return null;
  return (
    <div className="bg-red/10 border border-red/30 rounded-xl px-4 py-3">
      <p className="text-xs text-red">NAVER API HUB 키가 서버에 설정되지 않았습니다. Railway 환경변수 NAVER_HUB_CLIENT_ID / SECRET을 확인하세요.</p>
    </div>
  );
}

function PeriodButtons({ days, setDays }: { days: number; setDays: (d: number) => void }) {
  return (
    <>
      {PERIOD_OPTIONS.map((p) => (
        <button key={p.days} onClick={() => setDays(p.days)}
          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border ${days === p.days ? 'bg-brand text-white border-transparent' : 'bg-bg-0 text-text-tertiary border-border-primary'}`}>
          {p.label}
        </button>
      ))}
    </>
  );
}

function PeriodPicker({ days, setDays, unit, setUnit }: {
  days: number; setDays: (d: number) => void;
  unit: string; setUnit: (u: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <PeriodButtons days={days} setDays={setDays} />
      <span className="w-px h-4 bg-border-primary mx-1" />
      {TIME_UNITS.map((t) => (
        <button key={t.value} onClick={() => setUnit(t.value)}
          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border ${unit === t.value ? 'bg-brand text-white border-transparent' : 'bg-bg-0 text-text-tertiary border-border-primary'}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// 1) 검색어 트렌드
function SearchTrendPanel() {
  const [input, setInput] = useState(`${BRAND_NAME},마카롱,휘낭시에`);
  const [days, setDays] = useState(90);
  const [unit, setUnit] = useState('date');

  const keywords = useMemo(() => input.split(',').map(s => s.trim()).filter(Boolean).slice(0, 5), [input]);

  const m = useMutation({
    mutationFn: () => naverInsightsApi.searchTrend({
      keyword_groups: keywords.map(k => ({ name: k, keywords: [k] })),
      ...rangeFor(days),
      time_unit: unit,
    }),
    onError: (e: any) => toast.error(e?.response?.data?.detail || '검색어 트렌드 조회 실패'),
  });

  return (
    <div className="bg-bg-1 border border-border-primary rounded-xl p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h3 className="text-sm font-semibold text-text-secondary flex items-center gap-1.5">
          <TrendingUp size={14} className="text-[#03C75A]" /> 검색어 트렌드
          <span className="text-[10px] font-normal text-text-quaternary">절대 검색량(월간 쿼리수 환산) — 데이터랩 × 검색광고 키워드도구</span>
        </h3>
        <PeriodPicker days={days} setDays={setDays} unit={unit} setUnit={setUnit} />
      </div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <input value={input} onChange={(e: ChangeEvent<HTMLInputElement>) => setInput(e.target.value)}
          placeholder="키워드 (쉼표 구분, 최대 5개)"
          className="px-3 py-1.5 bg-bg-0 border border-border-primary rounded-lg text-xs text-text-secondary w-full sm:w-72 focus:outline-none focus:border-brand" />
        <button onClick={() => keywords.length ? m.mutate() : toast.error('키워드를 입력하세요')} disabled={m.isPending}
          className="flex items-center gap-1 px-3 py-1.5 bg-brand text-white text-xs font-medium rounded-lg hover:bg-accent-hover disabled:opacity-50">
          {m.isPending ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />} 조회
        </button>
      </div>
      {m.data && (
        <>
          <VolumeChips results={m.data.results} />
          <DeltaChips results={m.data.results} />
          <TrendLineChart results={m.data.results} useAbsolute={m.data.absolute_available === true} />
          {m.data.absolute_available === true ? (
            <p className="text-[10px] text-text-quaternary mt-2">
              데이터 기준일: {m.data.endDate} · 절대값은 검색광고 키워드도구의 최근 30일 검색량을 기준으로 데이터랩 상대지수를 환산한 추정 쿼리수입니다.
            </p>
          ) : (
            <p className="text-[10px] text-yellow mt-2">
              키워드도구 검색량을 가져오지 못해 상대지수(최대 100)로 표시 중입니다. 데이터 기준일: {m.data.endDate}
            </p>
          )}
        </>
      )}
      {!m.data && !m.isPending && (
        <p className="text-xs text-text-quaternary py-4 text-center">키워드를 입력하고 조회를 눌러주세요.</p>
      )}
    </div>
  );
}

function VolumeChips({ results }: { results: TrendResult[] }) {
  const withVol = results.filter((r) => r.monthly_volume?.total);
  if (withVol.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap mb-2">
      {withVol.map((r) => (
        <span key={r.title} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#03C75A]/10 text-[#03C75A] border border-[#03C75A]/30">
          {r.title} 월간 {r.monthly_volume!.total.toLocaleString('ko-KR')}회
          <span className="opacity-70"> (PC {r.monthly_volume!.pc.toLocaleString('ko-KR')} · 모바일 {r.monthly_volume!.mobile.toLocaleString('ko-KR')})</span>
        </span>
      ))}
    </div>
  );
}

function DeltaChips({ results }: { results: TrendResult[] }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap mb-2">
      {results.map((r) => {
        const d = recentDelta(r.data);
        if (d === null) return null;
        const up = d >= 0;
        return (
          <span key={r.title} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${up ? 'bg-green/15 text-green' : 'bg-red/15 text-red'}`}>
            {r.title} 최근 7구간 {up ? '▲' : '▼'} {Math.abs(d).toFixed(1)}%
          </span>
        );
      })}
    </div>
  );
}

function AsOf({ date }: { date: string }) {
  return <p className="text-[10px] text-text-quaternary mt-2">데이터 기준일: {date} (네이버 데이터랩, 전일까지 제공)</p>;
}

// 2) 쇼핑인사이트 분야 트렌드
function ShoppingCategoryPanel() {
  const [days, setDays] = useState(90);
  const [unit, setUnit] = useState('date');
  const [selected, setSelected] = useState<string[]>(['50022959', '50022619']);

  const { data: catData } = useQuery({
    queryKey: ['ni-categories'],
    queryFn: naverInsightsApi.getShoppingCategories,
    staleTime: Infinity,
  });
  const categories = catData?.categories ?? [];

  const m = useMutation({
    mutationFn: () => naverInsightsApi.shoppingCategoryTrend({
      categories: categories.filter(c => selected.includes(c.code)),
      ...rangeFor(days),
      time_unit: unit,
    }),
    onError: (e: any) => toast.error(e?.response?.data?.detail || '쇼핑인사이트 조회 실패'),
  });

  const toggle = (code: string) => {
    setSelected(prev => prev.includes(code)
      ? prev.filter(c => c !== code)
      : prev.length >= 3 ? (toast.error('최대 3개 분야까지 비교 가능합니다'), prev) : [...prev, code]);
  };

  return (
    <div className="bg-bg-1 border border-border-primary rounded-xl p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h3 className="text-sm font-semibold text-text-secondary flex items-center gap-1.5">
          <ShoppingBag size={14} className="text-[#03C75A]" /> 쇼핑인사이트 분야 트렌드
          <span className="text-[10px] font-normal text-text-quaternary">네이버쇼핑 클릭 상대지수 — 빵류·과자류 수요 사이클</span>
        </h3>
        <PeriodPicker days={days} setDays={setDays} unit={unit} setUnit={setUnit} />
      </div>
      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        {categories.map((c) => (
          <button key={c.code} onClick={() => toggle(c.code)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium border ${selected.includes(c.code) ? 'bg-[#03C75A]/15 text-[#03C75A] border-[#03C75A]/40' : 'bg-bg-0 text-text-tertiary border-border-primary'}`}>
            {c.name}
          </button>
        ))}
        <button onClick={() => selected.length ? m.mutate() : toast.error('분야를 선택하세요')} disabled={m.isPending}
          className="flex items-center gap-1 px-3 py-1.5 bg-brand text-white text-xs font-medium rounded-lg hover:bg-accent-hover disabled:opacity-50">
          {m.isPending ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />} 조회
        </button>
      </div>
      {m.data && (
        <>
          <DeltaChips results={m.data.results} />
          <TrendLineChart results={m.data.results} />
          <AsOf date={m.data.endDate} />
        </>
      )}
      {!m.data && !m.isPending && (
        <p className="text-xs text-text-quaternary py-4 text-center">분야를 선택(최대 3개)하고 조회를 눌러주세요.</p>
      )}
    </div>
  );
}

// 3) 분야 내 키워드 검색 트렌드
function ShoppingKeywordPanel() {
  const [days, setDays] = useState(90);
  const [unit, setUnit] = useState('date');
  const [catCode, setCatCode] = useState('50022959');
  const [input, setInput] = useState('마카롱,휘낭시에,베이글');

  const { data: catData } = useQuery({
    queryKey: ['ni-categories'],
    queryFn: naverInsightsApi.getShoppingCategories,
    staleTime: Infinity,
  });
  const categories = catData?.categories ?? [];
  const keywords = useMemo(() => input.split(',').map(s => s.trim()).filter(Boolean).slice(0, 5), [input]);

  const m = useMutation({
    mutationFn: () => naverInsightsApi.shoppingKeywordTrend({
      category_code: catCode,
      keywords,
      ...rangeFor(days),
      time_unit: unit,
    }),
    onError: (e: any) => toast.error(e?.response?.data?.detail || '키워드 트렌드 조회 실패'),
  });

  return (
    <div className="bg-bg-1 border border-border-primary rounded-xl p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h3 className="text-sm font-semibold text-text-secondary flex items-center gap-1.5">
          <Search size={14} className="text-[#03C75A]" /> 분야 내 키워드 검색 분석
          <span className="text-[10px] font-normal text-text-quaternary">선택 분야에서 키워드별 클릭 트렌드</span>
        </h3>
        <PeriodPicker days={days} setDays={setDays} unit={unit} setUnit={setUnit} />
      </div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <select value={catCode} onChange={(e) => setCatCode(e.target.value)}
          className="px-2.5 py-1.5 bg-bg-0 border border-border-primary rounded-lg text-xs text-text-secondary focus:outline-none focus:border-brand">
          {categories.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
        <input value={input} onChange={(e: ChangeEvent<HTMLInputElement>) => setInput(e.target.value)}
          placeholder="키워드 (쉼표 구분, 최대 5개)"
          className="px-3 py-1.5 bg-bg-0 border border-border-primary rounded-lg text-xs text-text-secondary w-full sm:w-64 focus:outline-none focus:border-brand" />
        <button onClick={() => keywords.length ? m.mutate() : toast.error('키워드를 입력하세요')} disabled={m.isPending}
          className="flex items-center gap-1 px-3 py-1.5 bg-brand text-white text-xs font-medium rounded-lg hover:bg-accent-hover disabled:opacity-50">
          {m.isPending ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />} 조회
        </button>
      </div>
      {m.data && (
        <>
          <DeltaChips results={m.data.results} />
          <TrendLineChart results={m.data.results} />
          <AsOf date={m.data.endDate} />
        </>
      )}
      {!m.data && !m.isPending && (
        <p className="text-xs text-text-quaternary py-4 text-center">분야와 키워드를 선택하고 조회를 눌러주세요.</p>
      )}
    </div>
  );
}

// 4) 블로그/카페 언급량 모니터링
function MentionPanel() {
  const [keyword, setKeyword] = useState(BRAND_NAME);
  const [submitted, setSubmitted] = useState(BRAND_NAME);
  const [days, setDays] = useState(90);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['ni-mentions', submitted, days],
    queryFn: () => naverInsightsApi.getMentions(submitted, 30, days),
    retry: 1,
  });
  const { data: history } = useQuery({
    queryKey: ['ni-mention-history', submitted, days],
    queryFn: () => naverInsightsApi.getMentionHistory(submitted, days),
    retry: 1,
  });

  const historyRows = history?.history ?? [];
  const periodLabel = PERIOD_OPTIONS.find(p => p.days === days)?.label ?? `${days}일`;

  return (
    <div className="bg-bg-1 border border-border-primary rounded-xl p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h3 className="text-sm font-semibold text-text-secondary flex items-center gap-1.5">
          <MessageCircle size={14} className="text-[#03C75A]" /> 블로그/카페 언급량 모니터링
          <span className="text-[10px] font-normal text-text-quaternary">6시간마다 자동 스냅샷 → 추이 누적</span>
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5"><PeriodButtons days={days} setDays={setDays} /></div>
          <input value={keyword} onChange={(e: ChangeEvent<HTMLInputElement>) => setKeyword(e.target.value)}
            className="px-3 py-1.5 bg-bg-0 border border-border-primary rounded-lg text-xs text-text-secondary w-40 focus:outline-none focus:border-brand" />
          <button onClick={() => { setSubmitted(keyword.trim()); refetch(); }} disabled={isFetching}
            className="flex items-center gap-1 px-3 py-1.5 bg-brand text-white text-xs font-medium rounded-lg hover:bg-accent-hover disabled:opacity-50">
            {isFetching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} 조회
          </button>
        </div>
      </div>

      {data && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-bg-0 border border-[#03C75A]/30 rounded-lg p-3">
            <p className="text-[10px] text-text-quaternary mb-1">최근 {periodLabel} 블로그 신규 글</p>
            <p className="text-xl font-bold text-[#03C75A]">
              {data.blog_period
                ? `${data.blog_period.count.toLocaleString('ko-KR')}${data.blog_period.exact ? '' : '+'}`
                : '–'}
              {data.blog_period && <span className="text-xs font-normal text-text-quaternary ml-1">건</span>}
            </p>
          </div>
          <div className="bg-bg-0 border border-border-primary rounded-lg p-3">
            <p className="text-[10px] text-text-quaternary mb-1">블로그 누적 언급</p>
            <p className="text-xl font-bold text-text-primary">
              {data.blog?.total >= 0 ? data.blog.total.toLocaleString('ko-KR') : '수집 실패'}
              {data.blog?.total >= 0 && <span className="text-xs font-normal text-text-quaternary ml-1">건</span>}
            </p>
          </div>
          <div className="bg-bg-0 border border-border-primary rounded-lg p-3">
            <p className="text-[10px] text-text-quaternary mb-1">카페 누적 언급</p>
            <p className="text-xl font-bold text-text-primary">
              {data.cafe?.total >= 0 ? data.cafe.total.toLocaleString('ko-KR') : '수집 실패'}
              {data.cafe?.total >= 0 && <span className="text-xs font-normal text-text-quaternary ml-1">건</span>}
            </p>
            <p className="text-[9px] text-text-quaternary mt-0.5">카페는 API가 작성일 미제공 → 누적만</p>
          </div>
        </div>
      )}

      {historyRows.length >= 2 && (
        <div className="h-44 mb-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={historyRows} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }} domain={['auto', 'auto']} />
              <RechartsTooltip
                contentStyle={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)', borderRadius: 8, fontSize: 11 }}
                labelStyle={{ color: 'var(--color-text-secondary)' }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="blog_total" name="블로그" stroke={LINE_PALETTE[0]} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="cafe_total" name="카페" stroke={LINE_PALETTE[1]} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {historyRows.length < 2 && (
        <p className="text-[10px] text-text-quaternary mb-3">추이 차트는 스냅샷이 2일 이상 쌓이면 표시됩니다 (6시간마다 자동 수집 중).</p>
      )}

      <div className="grid md:grid-cols-2 gap-3">
        {(['blog', 'cafe'] as const).map((kind) => (
          <div key={kind}>
            <p className="text-[11px] font-semibold text-text-tertiary mb-1.5">{kind === 'blog' ? '최근 블로그 글' : '최근 카페 글'}</p>
            <div className="space-y-1.5">
              {(data?.[kind]?.items ?? []).slice(0, 8).map((it: any, i: number) => (
                <a key={i} href={it.link} target="_blank" rel="noreferrer"
                  className="block bg-bg-0 border border-border-primary rounded-lg px-3 py-2 hover:border-brand transition-colors">
                  <p className="text-xs text-text-secondary line-clamp-1 flex items-center gap-1">
                    {it.title} <ExternalLink size={10} className="shrink-0 text-text-quaternary" />
                  </p>
                  <p className="text-[10px] text-text-quaternary line-clamp-1 mt-0.5">{it.description}</p>
                </a>
              ))}
              {data && (data[kind]?.items ?? []).length === 0 && (
                <p className="text-[10px] text-text-quaternary">게시물이 없습니다.</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// 5) 긍정/부정 마인드맵
function SentimentPanel() {
  const [keyword, setKeyword] = useState(BRAND_NAME);
  const [days, setDays] = useState(90);

  const m = useMutation({
    mutationFn: () => naverInsightsApi.sentimentMindmap(keyword.trim(), 60, days),
    onError: (e: any) => toast.error(e?.response?.data?.detail || '감성 분석 실패'),
  });

  return (
    <div className="bg-bg-1 border border-border-primary rounded-xl p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h3 className="text-sm font-semibold text-text-secondary flex items-center gap-1.5">
          <Brain size={14} className="text-[#03C75A]" /> 블로그 여론 마인드맵
          <span className="text-[10px] font-normal text-text-quaternary">기간 내 블로그 글 AI 분석 (표본 최대 60건) — 긍정/부정 단어 도식화</span>
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5"><PeriodButtons days={days} setDays={setDays} /></div>
          <input value={keyword} onChange={(e: ChangeEvent<HTMLInputElement>) => setKeyword(e.target.value)}
            className="px-3 py-1.5 bg-bg-0 border border-border-primary rounded-lg text-xs text-text-secondary w-40 focus:outline-none focus:border-brand" />
          <button onClick={() => keyword.trim() ? m.mutate() : toast.error('키워드를 입력하세요')} disabled={m.isPending}
            className="flex items-center gap-1 px-3 py-1.5 bg-brand text-white text-xs font-medium rounded-lg hover:bg-accent-hover disabled:opacity-50">
            {m.isPending ? <Loader2 size={12} className="animate-spin" /> : <Brain size={12} />}
            {m.isPending ? 'AI 분석 중...' : 'AI 분석'}
          </button>
        </div>
      </div>

      {m.isPending && (
        <p className="text-xs text-text-quaternary py-8 text-center">최근 블로그 글을 수집하고 AI가 여론을 분석하고 있습니다 (10~30초)...</p>
      )}

      {m.data && (
        <>
          <div className="bg-bg-0 border border-border-primary rounded-lg p-3 mb-3">
            <p className="text-xs text-text-secondary leading-relaxed">{m.data.summary}</p>
            <p className="text-[10px] text-text-quaternary mt-1.5">
              분석 표본: {m.data.period_days ? `최근 ${m.data.period_days}일 ` : ''}블로그 글 {m.data.sample_size}건 · 기준: {String(m.data.as_of).slice(0, 10)}
            </p>
          </div>
          {(m.data.themes ?? []).length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mb-3">
              {m.data.themes.map((t: any, i: number) => (
                <span key={i}
                  className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${t.sentiment === 'positive' ? 'bg-green/15 text-green' : t.sentiment === 'negative' ? 'bg-red/15 text-red' : 'bg-bg-0 text-text-tertiary border border-border-primary'}`}>
                  {t.name} ×{t.count}
                </span>
              ))}
            </div>
          )}
          <SentimentMindmap keyword={m.data.keyword} positive={m.data.positive ?? []} negative={m.data.negative ?? []} />
        </>
      )}

      {!m.data && !m.isPending && (
        <p className="text-xs text-text-quaternary py-4 text-center">키워드를 입력하고 AI 분석을 눌러주세요. 최근 블로그 글에서 긍정·부정 표현을 추출해 마인드맵으로 보여줍니다.</p>
      )}
    </div>
  );
}
