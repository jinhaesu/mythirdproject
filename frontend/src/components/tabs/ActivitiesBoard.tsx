'use client';

/**
 * 활동 기록 — 콘텐츠/인플루언서/체험단/서포터즈 집행 데이터 기입 + 자동 집계.
 *
 * 팀이 구글시트("메타 데이터 정리")로 하던 기록을 시스템에 누적한다.
 * 시트의 차트 시트(월별 채널별 조회수 추이, 제품별 Top)를 자동 생성.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
} from 'recharts';
import {
  ExternalLink, Plus, Pencil, Trash2, X, RefreshCw,
  ChevronLeft, ChevronRight, ArrowUp, ArrowDown, Search,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  activitiesApi, socialApi, type MarketingActivityRow, type MarketingActivityInput, formatNumber,
} from '@/lib/api';
import { fmtWon, fmtNum, LINE_PALETTE } from '@/components/tabs/kpi/format';

const TYPE_LABELS: Record<string, string> = {
  content: '콘텐츠',
  influencer: '인플루언서',
  experience: '체험단',
  crew: '크루',
  supporters: '서포터즈',
  groupbuy: '공동구매',
  etc: '기타',
};

// 캘린더에 노출하는 유형 (팀 요청: 인플루언서·크루·공동구매만)
const CALENDAR_TYPES = ['influencer', 'crew', 'groupbuy'];
const TYPE_COLORS: Record<string, string> = {
  influencer: '#4EA7FC',
  crew: '#8B5CF6',
  groupbuy: '#F0883E',
};

const today = () => new Date().toISOString().slice(0, 10);

function monthAdd(month: string, delta: number): string {
  const y = parseInt(month.slice(0, 4), 10);
  const m = parseInt(month.slice(5, 7), 10);
  const t = y * 12 + (m - 1) + delta;
  return `${String(Math.floor(t / 12)).padStart(4, '0')}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/** 유튜브 링크가 있는 활동 기록의 조회수·좋아요·댓글수를 현재 값으로 일괄 갱신 */
function RefreshYtButton() {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: () => socialApi.refreshActivityMetrics(6),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['activities'] });
      toast.success(`유튜브 지표 갱신: ${d.updated}건 업데이트 (링크 매칭 ${d.matched}건)`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || '갱신 실패'),
  });
  return (
    <button
      onClick={() => mut.mutate()}
      disabled={mut.isPending}
      title="최근 6개월 기록 중 유튜브 링크가 있는 행의 조회수·좋아요·댓글수를 현재 값으로 갱신합니다"
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-text-secondary border border-border-primary hover:text-text-primary disabled:opacity-50"
    >
      <RefreshCw size={13} className={mut.isPending ? 'animate-spin' : ''} /> 유튜브 조회수 갱신
    </button>
  );
}

const EMPTY_FORM: MarketingActivityInput = {
  activity_type: 'content',
  entry_kind: 'actual',
  product: '', product_category: '', channel: '', purpose: '', status: '', creator: '',
  period_month: new Date().toISOString().slice(0, 7),
  activity_date: null,
  quantity: 1, views: 0, reach: 0, likes: 0, comments: 0, saves: 0, shares: 0, follows: 0,
  cost: 0, link: '', metrics_as_of: today(), notes: '',
};

// 이 필드들이 바뀌면 지표 기준일을 오늘로 자동 갱신 (조회수는 계속 오르는 값이라
// "언제 시점의 숫자인지"가 함께 기록돼야 함)
const METRIC_FIELDS: (keyof MarketingActivityInput)[] = [
  'views', 'reach', 'likes', 'comments', 'saves', 'shares', 'follows',
];

export function ActivitiesBoard() {
  const qc = useQueryClient();
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [kindFilter, setKindFilter] = useState<'actual' | 'plan'>('actual');
  const [monthFrom, setMonthFrom] = useState<string>(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 11);
    return d.toISOString().slice(0, 7);
  });
  const [monthTo, setMonthTo] = useState<string>(new Date().toISOString().slice(0, 7));
  const [channelFilter, setChannelFilter] = useState('');
  const [creatorFilter, setCreatorFilter] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [purposeFilter, setPurposeFilter] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [sortBy, setSortBy] = useState<string>('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [pivotBy, setPivotBy] = useState('channel');
  const [pivotMetric, setPivotMetric] = useState<'views' | 'cost' | 'rows' | 'cost_per_view'>('views');
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<MarketingActivityRow | 'new' | null>(null);
  const PAGE = 50;

  const commonFilters = {
    activity_type: typeFilter || undefined,
    month_from: monthFrom || undefined,
    month_to: monthTo || undefined,
    channel: channelFilter || undefined,
    creator: creatorFilter || undefined,
    product: productFilter || undefined,
    purpose: purposeFilter || undefined,
    q: searchQ.trim() || undefined,
  };
  const listParams = {
    ...commonFilters,
    entry_kind: kindFilter,
    sort_by: sortBy || undefined,
    sort_dir: sortBy ? sortDir : undefined,
    limit: PAGE, offset: page * PAGE,
  };
  const { data: list, isLoading } = useQuery({
    queryKey: ['activities', 'list', listParams],
    queryFn: () => activitiesApi.list(listParams),
  });
  // 집계·차트도 실적/계획 토글과 필터를 그대로 따른다 (계획 탭이면 예상치 집계)
  const { data: summary } = useQuery({
    queryKey: ['activities', 'summary', typeFilter, monthFrom, monthTo, kindFilter],
    queryFn: () => activitiesApi.summary({
      activity_type: typeFilter || undefined,
      month_from: monthFrom || undefined,
      month_to: monthTo || undefined,
      entry_kind: kindFilter,
    }),
  });
  const pivotParams = { ...commonFilters, entry_kind: kindFilter, group_by: pivotBy };
  const { data: pivot } = useQuery({
    queryKey: ['activities', 'pivot', pivotParams],
    queryFn: () => activitiesApi.pivot(pivotParams),
  });
  const { data: meta } = useQuery({ queryKey: ['activities', 'meta'], queryFn: activitiesApi.meta });

  const toggleSort = (key: string) => {
    setPage(0);
    if (sortBy !== key) { setSortBy(key); setSortDir('desc'); }
    else if (sortDir === 'desc') setSortDir('asc');
    else { setSortBy(''); setSortDir('desc'); } // 3번째 클릭 = 기본 정렬 복귀
  };

  const invalidate = () => qc.invalidateQueries({ queryKey: ['activities'] });

  const removeMut = useMutation({
    mutationFn: activitiesApi.remove,
    onSuccess: () => { toast.success('삭제했습니다'); invalidate(); },
    onError: () => toast.error('삭제 실패'),
  });
  const convertMut = useMutation({
    mutationFn: (row: MarketingActivityRow) =>
      activitiesApi.update(row.id, { ...row, entry_kind: 'actual', metrics_as_of: today() }),
    onSuccess: () => { toast.success('실적으로 전환했습니다 — 조회수 등 실제 값을 채워 주세요'); invalidate(); },
    onError: () => toast.error('전환 실패'),
  });

  // 월별×채널 스택 차트 데이터
  const monthChart = useMemo(() => {
    const rows = summary?.by_month_channel || [];
    const channels = Array.from(new Set(rows.map((r: any) => r.channel || '미지정')));
    const byMonth: Record<string, any> = {};
    rows.forEach((r: any) => {
      const m = byMonth[r.month] ?? (byMonth[r.month] = { month: r.month.slice(2) });
      m[r.channel || '미지정'] = (m[r.channel || '미지정'] || 0) + r.views;
    });
    return { data: Object.values(byMonth), channels };
  }, [summary]);

  const typeTotals = summary?.by_type || [];

  return (
    <div className="space-y-4">
      {/* 필터 + 추가 */}
      <div className="flex flex-wrap items-center gap-2">
        {/* 실적/계획 토글 */}
        <div className="flex items-center rounded-lg p-0.5" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.05)' }}>
          {([['actual', '실적'], ['plan', '계획']] as const).map(([kv, label]) => (
            <button key={kv} onClick={() => { setKindFilter(kv); setPage(0); }}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              style={kindFilter === kv
                ? { backgroundColor: kv === 'plan' ? '#b46900' : 'var(--color-brand-bg)', color: '#fff' }
                : { color: 'var(--color-text-tertiary)' }}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center rounded-lg p-0.5" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.05)' }}>
          {['', 'content', 'influencer', 'experience', 'crew', 'supporters', 'groupbuy', 'etc'].map((t) => (
            <button
              key={t || 'all'}
              onClick={() => { setTypeFilter(t); setPage(0); }}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              style={typeFilter === t
                ? { backgroundColor: 'var(--color-brand-bg)', color: '#fff' }
                : { color: 'var(--color-text-tertiary)' }}
            >
              {t ? TYPE_LABELS[t] : '전체'}
            </button>
          ))}
        </div>
        <input
          type="month" value={monthFrom} onChange={(e) => { setMonthFrom(e.target.value); setPage(0); }}
          className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary"
        />
        <span className="text-xs text-text-quaternary">~</span>
        <input
          type="month" value={monthTo} onChange={(e) => { setMonthTo(e.target.value); setPage(0); }}
          className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary"
        />
        <select
          value={channelFilter} onChange={(e) => { setChannelFilter(e.target.value); setPage(0); }}
          className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary max-w-[130px]"
        >
          <option value="">채널 전체</option>
          {(meta?.channels || []).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={creatorFilter} onChange={(e) => { setCreatorFilter(e.target.value); setPage(0); }}
          className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary max-w-[140px]"
        >
          <option value="">크리에이터 전체</option>
          {(meta?.creators || []).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={productFilter} onChange={(e) => { setProductFilter(e.target.value); setPage(0); }}
          className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary max-w-[150px]"
        >
          <option value="">제품 전체</option>
          {(meta?.products || []).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={purposeFilter} onChange={(e) => { setPurposeFilter(e.target.value); setPage(0); }}
          className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary max-w-[130px]"
        >
          <option value="">목적 전체</option>
          {(meta?.purposes || []).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-quaternary" />
          <input
            value={searchQ} onChange={(e) => { setSearchQ(e.target.value); setPage(0); }}
            placeholder="검색 (제품·메모·크리에이터)"
            className="pl-6 pr-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary w-44"
          />
        </div>
        {(channelFilter || creatorFilter || productFilter || purposeFilter || searchQ) && (
          <button
            onClick={() => { setChannelFilter(''); setCreatorFilter(''); setProductFilter(''); setPurposeFilter(''); setSearchQ(''); setPage(0); }}
            className="px-2 py-1.5 rounded-lg text-xs text-red border border-red/40 hover:bg-red/10"
          >필터 해제</button>
        )}
        <div className="flex-1" />
        <RefreshYtButton />
        <button
          onClick={() => setEditing('new')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--color-brand-bg)' }}
        >
          <Plus size={14} /> 기록 추가
        </button>
      </div>

      {/* 계획 캘린더 — 인플루언서·크루·공동구매 일정을 달력으로 */}
      {kindFilter === 'plan' && (
        <PlanCalendar onEdit={(row) => setEditing(row)} />
      )}

      {/* 유형별 합계 카드 */}
      {typeTotals.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {typeTotals.map((t: any) => (
            <div
              key={t.activity_type}
              className="rounded-xl p-3"
              style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}
            >
              <p className="text-[11px] text-text-tertiary">{TYPE_LABELS[t.activity_type] || t.activity_type}</p>
              <p className="text-base font-semibold text-text-primary tabular-nums">{fmtNum(t.views)} <span className="text-[10px] font-normal text-text-quaternary">조회</span></p>
              <p className="text-[11px] text-text-quaternary tabular-nums">
                {fmtWon(t.cost)}{t.cost_per_view != null && ` · 뷰당 ₩${t.cost_per_view}`}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 월별 채널별 조회수 */}
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
          <h3 className="text-sm font-semibold text-text-primary mb-3">월별 채널별 조회수{kindFilter === 'plan' ? ' (계획)' : ''}</h3>
          {monthChart.data.length === 0 ? (
            <p className="text-xs text-text-tertiary py-8 text-center">데이터가 없습니다</p>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthChart.data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--color-text-quaternary)' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-quaternary)' }} tickLine={false} axisLine={false} width={44}
                    tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 10000)}만` : String(v))} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)', borderRadius: 8, fontSize: 11 }}
                    formatter={(v: any, name: any) => [formatNumber(v), name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {monthChart.channels.map((c, i) => (
                    <Bar key={c} dataKey={c} stackId="v" fill={LINE_PALETTE[i % LINE_PALETTE.length]} radius={i === monthChart.channels.length - 1 ? [3, 3, 0, 0] : undefined} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* 제품별 Top */}
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
          <h3 className="text-sm font-semibold text-text-primary mb-3">제품별 조회수 Top 10{kindFilter === 'plan' ? ' (계획)' : ''}</h3>
          {(summary?.by_product || []).length === 0 ? (
            <p className="text-xs text-text-tertiary py-8 text-center">데이터가 없습니다</p>
          ) : (
            <div className="space-y-1.5">
              {(summary?.by_product || []).slice(0, 10).map((p: any, i: number) => {
                const max = summary!.by_product[0]?.views || 1;
                return (
                  <div key={p.product} className="flex items-center gap-2">
                    <span className="text-[10px] text-text-quaternary w-4 text-right">{i + 1}</span>
                    <span className="text-xs text-text-secondary w-36 truncate" title={p.product}>{p.product}</span>
                    <div className="flex-1 h-4 rounded overflow-hidden" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.05)' }}>
                      <div className="h-full rounded" style={{ width: `${Math.max(2, (p.views / max) * 100)}%`, backgroundColor: '#4EA7FC' }} />
                    </div>
                    <span className="text-[11px] text-text-tertiary tabular-nums w-16 text-right">{fmtNum(p.views)}</span>
                    <span className="text-[10px] text-text-quaternary tabular-nums w-20 text-right">{fmtWon(p.cost)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 다각도 분석 — 축·지표를 골라 즉석 집계 (위 필터가 그대로 적용됨) */}
      <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold text-text-primary">다각도 분석{kindFilter === 'plan' ? ' (계획)' : ''}</h3>
          <span className="text-[10px] text-text-quaternary">상단 필터·기간이 그대로 적용됩니다</span>
          <div className="flex-1" />
          <div className="flex items-center rounded-lg p-0.5" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.05)' }}>
            {([
              ['month', '월별'], ['activity_type', '유형별'], ['channel', '채널별'], ['product', '제품별'],
              ['product_category', '제품류별'], ['creator', '크리에이터별'], ['purpose', '목적별'],
            ] as const).map(([kv, label]) => (
              <button key={kv} onClick={() => setPivotBy(kv)}
                className="px-2 py-1 rounded-md text-[11px] font-medium transition-colors"
                style={pivotBy === kv
                  ? { backgroundColor: 'var(--color-brand-bg)', color: '#fff' }
                  : { color: 'var(--color-text-tertiary)' }}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center rounded-lg p-0.5" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.05)' }}>
            {([
              ['views', '조회수'], ['cost', '비용'], ['rows', '건수'], ['cost_per_view', '뷰당비용'],
            ] as const).map(([kv, label]) => (
              <button key={kv} onClick={() => setPivotMetric(kv)}
                className="px-2 py-1 rounded-md text-[11px] font-medium transition-colors"
                style={pivotMetric === kv
                  ? { backgroundColor: '#b46900', color: '#fff' }
                  : { color: 'var(--color-text-tertiary)' }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {(pivot?.groups || []).length === 0 ? (
          <p className="text-xs text-text-tertiary py-8 text-center">데이터가 없습니다</p>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={(pivot!.groups).map((g) => ({
                  ...g,
                  label: pivotBy === 'month' ? g.key.slice(2) : (g.key.length > 12 ? `${g.key.slice(0, 12)}…` : g.key),
                  value: g[pivotMetric] ?? 0,
                }))}
                margin={{ top: 4, right: 4, bottom: pivotBy === 'month' ? 0 : 36, left: 4 }}
              >
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--color-text-quaternary)' }}
                  tickLine={false} axisLine={false} interval={0}
                  angle={pivotBy === 'month' ? 0 : -35} textAnchor={pivotBy === 'month' ? 'middle' : 'end'} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-quaternary)' }} tickLine={false} axisLine={false} width={52}
                  tickFormatter={(v: number) => (pivotMetric === 'cost'
                    ? (v >= 10000000 ? `${Math.round(v / 10000000)}천만` : v >= 10000 ? `${Math.round(v / 10000)}만` : String(v))
                    : v >= 10000 ? `${Math.round(v / 10000)}만` : String(v))} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)', borderRadius: 8, fontSize: 11 }}
                  formatter={(v: any) => [
                    pivotMetric === 'cost' ? fmtWon(v) : pivotMetric === 'cost_per_view' ? `₩${v}` : formatNumber(v),
                    { views: '조회수', cost: '비용', rows: '건수', cost_per_view: '뷰당비용' }[pivotMetric],
                  ]}
                  labelFormatter={(_: any, payload: any) => payload?.[0]?.payload?.key ?? ''}
                />
                <Bar dataKey="value" fill="#4EA7FC" radius={[3, 3, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* 기록 테이블 */}
      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                {([
                  ['월', 'period_month'], ['유형', 'activity_type'], ['크리에이터', 'creator'],
                  ['제품', 'product'], ['채널', 'channel'], ['목적', 'purpose'], ['수량', 'quantity'],
                  ['조회수', 'views'], ['비용', 'cost'], ['뷰당 비용', 'cost_per_view'], ['', ''],
                ] as const).map(([h, key]) => (
                  <th key={h || '_act'} className="px-3 py-2.5 text-left font-medium text-text-tertiary whitespace-nowrap">
                    {key ? (
                      <button
                        onClick={() => toggleSort(key)}
                        title="클릭: 내림차순 → 오름차순 → 기본"
                        className={`inline-flex items-center gap-0.5 hover:text-text-primary ${sortBy === key ? 'text-text-primary' : ''}`}
                      >
                        {h}
                        {sortBy === key && (sortDir === 'desc' ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
                      </button>
                    ) : h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={11} className="px-3 py-8 text-center text-text-tertiary">불러오는 중...</td></tr>
              ) : (list?.items || []).length === 0 ? (
                <tr><td colSpan={11} className="px-3 py-8 text-center text-text-tertiary">
                  기록이 없습니다 — 우측 상단 &quot;기록 추가&quot;로 시작하세요
                </td></tr>
              ) : (
                list!.items.map((row) => (
                  <tr key={row.id} className="group" style={{ borderBottom: '1px solid rgb(var(--color-overlay-rgb) / 0.04)' }}>
                    <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{row.period_month}{row.activity_date ? ` (${row.activity_date.slice(5)})` : ''}</td>
                    <td className="px-3 py-2">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-brand/15" style={{ color: 'var(--color-accent-hover)' }}>
                        {TYPE_LABELS[row.activity_type] || row.activity_type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-text-primary max-w-[150px]">
                      <span className="block truncate font-medium" title={row.creator || ''}>{row.creator || '-'}</span>
                    </td>
                    <td className="px-3 py-2 text-text-primary max-w-[180px]">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="truncate" title={row.product || ''}>{row.product || '-'}</span>
                        {row.link && (
                          <a href={row.link} target="_blank" rel="noopener noreferrer"
                            className="shrink-0 text-text-quaternary hover:text-brand transition-colors" title="콘텐츠 열기"
                            onClick={(e) => e.stopPropagation()}>
                            <ExternalLink size={12} />
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{row.channel || '-'}</td>
                    <td className="px-3 py-2 text-text-tertiary whitespace-nowrap">{row.purpose || '-'}</td>
                    <td className="px-3 py-2 text-text-secondary tabular-nums text-right">{fmtNum(row.quantity)}</td>
                    <td className="px-3 py-2 text-right">
                      <span className="text-text-primary tabular-nums">{fmtNum(row.views)}</span>
                      {row.metrics_as_of && (
                        <span className="block text-[9px] text-text-quaternary leading-tight">
                          {row.metrics_as_of.slice(5).replace('-', '/')} 기준
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-text-secondary tabular-nums text-right">{fmtWon(row.cost)}</td>
                    <td className="px-3 py-2 text-text-tertiary tabular-nums text-right">{row.cost_per_view != null ? `₩${row.cost_per_view}` : '-'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {row.entry_kind === 'plan' && (
                          <button
                            onClick={() => convertMut.mutate(row)}
                            className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green/15 text-green hover:bg-green/25 whitespace-nowrap"
                            title="집행 완료 — 실적으로 전환"
                          >실적 전환</button>
                        )}
                        <button onClick={() => setEditing(row)} className="p-1 text-text-tertiary hover:text-text-primary" title="수정"><Pencil size={13} /></button>
                        <button
                          onClick={() => { if (confirm('이 기록을 삭제할까요?')) removeMut.mutate(row.id); }}
                          className="p-1 text-text-tertiary hover:text-red" title="삭제"
                        ><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {(list?.total || 0) > PAGE && (
          <div className="flex items-center justify-between px-3 py-2" style={{ borderTop: '1px solid var(--color-border-primary)' }}>
            <span className="text-[11px] text-text-quaternary">총 {fmtNum(list!.total)}건</span>
            <div className="flex gap-1">
              <button disabled={page === 0} onClick={() => setPage(page - 1)}
                className="px-2 py-1 rounded text-[11px] text-text-tertiary hover:text-text-primary disabled:opacity-30">이전</button>
              <button disabled={(page + 1) * PAGE >= (list?.total || 0)} onClick={() => setPage(page + 1)}
                className="px-2 py-1 rounded text-[11px] text-text-tertiary hover:text-text-primary disabled:opacity-30">다음</button>
            </div>
          </div>
        )}
      </div>

      {editing && (
        <ActivityFormModal
          initial={editing === 'new' ? null : editing}
          meta={meta}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); invalidate(); }}
        />
      )}
    </div>
  );
}

/** 계획 캘린더 — 인플루언서·크루·공동구매 계획을 달력에 크리에이터 + 예상 조회수로 표시 */
function PlanCalendar({ onEdit }: { onEdit: (row: MarketingActivityRow) => void }) {
  const [calMonth, setCalMonth] = useState<string>(new Date().toISOString().slice(0, 7));
  const todayIso = today();

  const { data: planList } = useQuery({
    queryKey: ['activities', 'calendar', 'plan', calMonth],
    queryFn: () => activitiesApi.list({ entry_kind: 'plan', month_from: calMonth, month_to: calMonth, limit: 500 }),
  });
  const { data: actualList } = useQuery({
    queryKey: ['activities', 'calendar', 'actual', calMonth],
    queryFn: () => activitiesApi.list({ entry_kind: 'actual', month_from: calMonth, month_to: calMonth, limit: 500 }),
  });

  const rows = useMemo(
    () => (planList?.items || []).filter((r) => CALENDAR_TYPES.includes(r.activity_type)),
    [planList],
  );
  const byDate = useMemo(() => {
    const m: Record<string, MarketingActivityRow[]> = {};
    rows.forEach((r) => { if (r.activity_date) (m[r.activity_date] ??= []).push(r); });
    return m;
  }, [rows]);
  const undated = useMemo(() => rows.filter((r) => !r.activity_date), [rows]);

  // 계획 vs 같은 유형 실적 비교 (해당 월)
  const planTotal = useMemo(() => rows.reduce(
    (a, r) => ({ views: a.views + (r.views || 0), cost: a.cost + (r.cost || 0) }), { views: 0, cost: 0 }), [rows]);
  const actualTotal = useMemo(() => (actualList?.items || [])
    .filter((r) => CALENDAR_TYPES.includes(r.activity_type))
    .reduce((a, r) => ({ n: a.n + 1, views: a.views + (r.views || 0), cost: a.cost + (r.cost || 0) }), { n: 0, views: 0, cost: 0 }),
    [actualList]);

  // 달력 격자 (일요일 시작)
  const y = parseInt(calMonth.slice(0, 4), 10);
  const mo = parseInt(calMonth.slice(5, 7), 10);
  const firstDow = new Date(y, mo - 1, 1).getDay();
  const daysInMonth = new Date(y, mo, 0).getDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${calMonth}-${String(i + 1).padStart(2, '0')}`),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const chip = (r: MarketingActivityRow, compact = false) => {
    const overdue = !!r.activity_date && r.activity_date < todayIso;
    return (
      <button
        key={r.id}
        onClick={() => onEdit(r)}
        title={`${TYPE_LABELS[r.activity_type]} · ${r.creator || r.product || '-'}${r.product ? ` · ${r.product}` : ''}\n예상 조회수 ${fmtNum(r.views)} · ${fmtWon(r.cost)}${overdue ? '\n⚠ 날짜가 지났는데 아직 계획 상태 — 실적 전환 필요' : ''}\n클릭해서 수정`}
        className={`w-full text-left px-1 py-0.5 rounded text-[10px] leading-tight truncate hover:opacity-80 ${overdue ? 'opacity-55' : ''}`}
        style={{
          backgroundColor: `${TYPE_COLORS[r.activity_type]}22`,
          borderLeft: `2px solid ${TYPE_COLORS[r.activity_type]}`,
          color: 'var(--color-text-secondary)',
        }}
      >
        {overdue && <span title="실적 전환 필요">⚠ </span>}
        <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>{r.creator || r.product || '미지정'}</span>
        {!compact && r.views > 0 && <span className="text-text-quaternary"> · {fmtNum(r.views)}</span>}
      </button>
    );
  };

  return (
    <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h3 className="text-sm font-semibold text-text-primary">계획 캘린더</h3>
        <span className="text-[10px] text-text-quaternary">인플루언서·크루·공동구매 일정 — 칩 클릭으로 수정</span>
        <div className="flex-1" />
        <div className="flex items-center gap-2 mr-2">
          {CALENDAR_TYPES.map((t) => (
            <span key={t} className="flex items-center gap-1 text-[10px] text-text-tertiary">
              <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: TYPE_COLORS[t] }} />{TYPE_LABELS[t]}
            </span>
          ))}
        </div>
        <button onClick={() => setCalMonth(monthAdd(calMonth, -1))} className="p-1.5 rounded-lg border border-border-primary text-text-tertiary hover:text-text-primary"><ChevronLeft size={13} /></button>
        <input type="month" value={calMonth} onChange={(e) => e.target.value && setCalMonth(e.target.value)}
          className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary" />
        <button onClick={() => setCalMonth(monthAdd(calMonth, 1))} className="p-1.5 rounded-lg border border-border-primary text-text-tertiary hover:text-text-primary"><ChevronRight size={13} /></button>
      </div>

      {/* 이달 계획 vs 실적 (같은 3개 유형 기준) */}
      <div className="flex flex-wrap gap-2 mb-3 text-[11px]">
        <span className="px-2 py-1 rounded-lg" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.05)' }}>
          <b className="text-text-primary">계획 {rows.length}건</b>
          <span className="text-text-tertiary"> · 예상 조회수 {fmtNum(planTotal.views)} · 예산 {fmtWon(planTotal.cost)}</span>
        </span>
        <span className="px-2 py-1 rounded-lg" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.05)' }}>
          <b className="text-text-primary">실적 {actualTotal.n}건</b>
          <span className="text-text-tertiary"> · 조회수 {fmtNum(actualTotal.views)} · 집행 {fmtWon(actualTotal.cost)}</span>
        </span>
        {planTotal.views > 0 && actualTotal.views > 0 && (
          <span className="px-2 py-1 rounded-lg text-text-tertiary" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.05)' }}>
            조회수 달성율 <b className={actualTotal.views >= planTotal.views ? 'text-green' : 'text-yellow'}>
              {Math.round((actualTotal.views / planTotal.views) * 100)}%</b>
          </span>
        )}
      </div>

      <div className="grid grid-cols-7 gap-px rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--color-border-primary)' }}>
        {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
          <div key={d} className={`px-1.5 py-1 text-[10px] font-medium text-center ${i === 0 ? 'text-red' : i === 6 ? 'text-blue' : 'text-text-tertiary'}`}
            style={{ backgroundColor: 'var(--color-bg-level-2)' }}>{d}</div>
        ))}
        {cells.map((date, i) => (
          <div key={i} className="min-h-[72px] p-1" style={{ backgroundColor: 'var(--color-bg-level-1)' }}>
            {date && (
              <>
                <div className={`text-[10px] mb-0.5 tabular-nums ${date === todayIso
                  ? 'inline-flex items-center justify-center w-4 h-4 rounded-full text-white font-bold'
                  : i % 7 === 0 ? 'text-red' : i % 7 === 6 ? 'text-blue' : 'text-text-quaternary'}`}
                  style={date === todayIso ? { backgroundColor: 'var(--color-brand-bg)' } : undefined}>
                  {parseInt(date.slice(8), 10)}
                </div>
                <div className="space-y-0.5">
                  {(byDate[date] || []).slice(0, 3).map((r) => chip(r))}
                  {(byDate[date] || []).length > 3 && (
                    <div className="text-[9px] text-text-quaternary px-1">+{(byDate[date] || []).length - 3}건 더</div>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {undated.length > 0 && (
        <div className="mt-2">
          <p className="text-[10px] text-text-quaternary mb-1">진행일 미정 ({undated.length}건) — 수정에서 진행일을 넣으면 달력에 표시됩니다</p>
          <div className="flex flex-wrap gap-1">
            {undated.map((r) => <span key={r.id} className="max-w-[160px]">{chip(r, true)}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}

function ActivityFormModal({
  initial, meta, onClose, onSaved,
}: {
  initial: MarketingActivityRow | null;
  meta?: { channels: string[]; products: string[]; product_categories: string[]; purposes: string[]; creators?: string[] };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<MarketingActivityInput>(() =>
    initial ? { ...initial } : { ...EMPTY_FORM });

  const saveMut = useMutation({
    mutationFn: (payload: MarketingActivityInput) =>
      initial ? activitiesApi.update(initial.id, payload) : activitiesApi.create(payload),
    onSuccess: () => { toast.success(initial ? '수정했습니다' : '추가했습니다'); onSaved(); },
    onError: () => toast.error('저장 실패 — 입력값을 확인해 주세요'),
  });

  const set = (k: keyof MarketingActivityInput, v: any) =>
    setForm((f) => ({
      ...f,
      [k]: v,
      // 지표를 고치면 기준일을 오늘로 자동 갱신 (직접 바꾸면 그 값 유지)
      ...(METRIC_FIELDS.includes(k) ? { metrics_as_of: today() } : {}),
    }));
  const numField = (k: keyof MarketingActivityInput, label: string) => (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-text-tertiary">{label}</span>
      <input
        type="number" value={(form as any)[k] ?? 0}
        onChange={(e) => set(k, Number(e.target.value) || 0)}
        className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary tabular-nums"
      />
    </label>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl p-5"
        style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-text-primary">{initial ? '기록 수정' : '새 활동 기록'}</h3>
          <button onClick={onClose} className="p-1 text-text-tertiary hover:text-text-primary"><X size={16} /></button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-text-tertiary">구분 *</span>
            <select value={form.entry_kind || 'actual'} onChange={(e) => set('entry_kind', e.target.value)}
              className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary">
              <option value="actual">실적 (집행 완료)</option>
              <option value="plan">계획 (예정)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-text-tertiary">유형 *</span>
            <select value={form.activity_type} onChange={(e) => set('activity_type', e.target.value)}
              className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary">
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-text-tertiary">진행월 *</span>
            <input type="month" value={form.period_month} onChange={(e) => set('period_month', e.target.value)}
              className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-text-tertiary">진행일 (선택)</span>
            <input type="date" value={form.activity_date || ''} onChange={(e) => set('activity_date', e.target.value || null)}
              className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary" />
          </label>
          <label className="flex flex-col gap-1 col-span-2 sm:col-span-1">
            <span className="text-[11px] text-text-tertiary">제품명</span>
            <input list="act-products" value={form.product || ''} onChange={(e) => set('product', e.target.value)}
              className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary" />
            <datalist id="act-products">{(meta?.products || []).map((p) => <option key={p} value={p} />)}</datalist>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-text-tertiary">제품류</span>
            <input list="act-cats" value={form.product_category || ''} onChange={(e) => set('product_category', e.target.value)}
              className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary" />
            <datalist id="act-cats">{(meta?.product_categories || []).map((p) => <option key={p} value={p} />)}</datalist>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-text-tertiary">크리에이터</span>
            <input list="act-creators" value={form.creator || ''} onChange={(e) => set('creator', e.target.value)}
              placeholder="인플루언서 이름 또는 @핸들"
              className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary" />
            <datalist id="act-creators">{(meta?.creators || []).map((p) => <option key={p} value={p} />)}</datalist>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-text-tertiary">채널</span>
            <input list="act-channels" value={form.channel || ''} onChange={(e) => set('channel', e.target.value)}
              placeholder="인스타그램, 유튜브…"
              className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary" />
            <datalist id="act-channels">{(meta?.channels || []).map((p) => <option key={p} value={p} />)}</datalist>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-text-tertiary">목적</span>
            <input list="act-purposes" value={form.purpose || ''} onChange={(e) => set('purpose', e.target.value)}
              placeholder="신제품홍보, 정보성…"
              className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary" />
            <datalist id="act-purposes">{(meta?.purposes || []).map((p) => <option key={p} value={p} />)}</datalist>
          </label>
          {numField('quantity', '수량')}
          {numField('cost', '비용 (₩)')}
          {numField('views', '조회수')}
          {numField('reach', '도달')}
          {numField('likes', '좋아요')}
          {numField('comments', '댓글')}
          {numField('saves', '저장')}
          {numField('shares', '공유')}
          {numField('follows', '팔로우')}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-text-tertiary">지표 기준일</span>
            <input type="date" value={form.metrics_as_of || ''} onChange={(e) => set('metrics_as_of', e.target.value || null)}
              className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary" />
            <span className="text-[10px] text-text-quaternary">조회수를 고치면 오늘로 자동 갱신</span>
          </label>
          <label className="flex flex-col gap-1 col-span-2">
            <span className="text-[11px] text-text-tertiary">콘텐츠 링크</span>
            <input type="url" value={form.link || ''} onChange={(e) => set('link', e.target.value)}
              placeholder="https:// 게시물·영상 주소"
              className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary" />
          </label>
          <label className="flex flex-col gap-1 col-span-2 sm:col-span-3">
            <span className="text-[11px] text-text-tertiary">메모</span>
            <input value={form.notes || ''} onChange={(e) => set('notes', e.target.value)}
              className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary" />
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs text-text-tertiary hover:text-text-primary border border-border-primary">취소</button>
          <button
            onClick={() => {
              if (!form.period_month || form.period_month.length !== 7) { toast.error('진행월을 선택해 주세요'); return; }
              saveMut.mutate(form);
            }}
            disabled={saveMut.isPending}
            className="px-4 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-brand-bg)' }}
          >
            {saveMut.isPending ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
