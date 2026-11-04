'use client';

/**
 * 자사몰 › 상세 스크롤 이탈 (2026-11-04 대표 요청).
 *
 * 상품 상세를 연 손님이 어디까지 내려 보고 떠났는지 제품별로 본다.
 * 운영 상세는 [사진·가격] → [상세 설명(약 840px로 접힘, 「펼치기」)] → [상품정보 고시] → [리뷰] → [문의] 순서.
 *  - 페이지 깊이: 떠날 때까지 내려 본 가장 아래 위치 ÷ 페이지 전체 높이 (5% 단위)
 *  - 구역 도달: 그 구역이 화면에 조금이라도 들어왔나
 *  - 설명 펼침 / 펼친 설명 안 깊이
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, Legend,
} from 'recharts';
import { Loader2, ExternalLink } from 'lucide-react';
import { journeyApi, type JDevice, type JScroll, type JScrollSummary } from '@/lib/journey-api';
import { BRAND, Section, Notice, Seg, Tile, PeriodPicker, BarRow, fmtN, fmtP, kstToday, addDays, tooltipStyle, tick } from './ui';

const OVERALL = '#9AA0A8';
const DEVICE_OPTS: { v: JDevice; label: string }[] = [{ v: 'all', label: '전체 기기' }, { v: 'm', label: '휴대폰' }, { v: 'pc', label: 'PC' }];
const MIN_OPTS = [{ v: 10, label: '조회 10회+' }, { v: 30, label: '30회+' }, { v: 100, label: '100회+' }];

type SortKey = 'views' | 'top_stop' | 'expand_rate' | 'review' | 'click_rate' | 'median_page_pct';

export default function ScrollDepthDashboard() {
  const today = kstToday();
  const [range, setRange] = useState({ start: addDays(today, -13), end: today });
  const [device, setDevice] = useState<JDevice>('m');
  const [minViews, setMinViews] = useState(30);
  const [sel, setSel] = useState<number | null>(null);
  const [sort, setSort] = useState<SortKey>('views');

  const q = useQuery({
    queryKey: ['journey-scroll', range.start, range.end, device, minViews],
    queryFn: () => journeyApi.scroll(range.start, range.end, device, minViews),
    staleTime: 5 * 60_000,
  });
  const r = q.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">상세 스크롤 이탈</h1>
          <p className="text-[11px] text-text-tertiary">제품 상세를 어디까지 내려 보고 떠났나 · 기준 {range.start} ~ {range.end} (한국 시간)</p>
        </div>
        <div className="flex-1" />
        <PeriodPicker start={range.start} end={range.end} onChange={(s, e) => { setRange({ start: s, end: e }); }} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Seg value={device} options={DEVICE_OPTS} onChange={setDevice} />
        <Seg value={minViews} options={MIN_OPTS} onChange={setMinViews} />
      </div>

      {q.isLoading && <div className="flex items-center gap-2 text-sm text-text-tertiary py-10 justify-center"><Loader2 className="animate-spin" size={16} /> 불러오는 중…</div>}
      {q.isError && <Notice>불러오지 못했습니다: {(q.error as any)?.response?.data?.detail || '잠시 뒤 다시 열어 주세요'}</Notice>}
      {r && !r.overall && <Notice>이 기간에 잰 상세 조회가 없습니다. 기록은 2026-11-04 배포 이후부터 쌓입니다.</Notice>}
      {r && r.overall && <Body r={r} sel={sel} setSel={setSel} sort={sort} setSort={setSort} />}
    </div>
  );
}

function Body({ r, sel, setSel, sort, setSort }: {
  r: JScroll; sel: number | null; setSel: (n: number | null) => void; sort: SortKey; setSort: (s: SortKey) => void;
}) {
  const o = r.overall!;
  const picked = r.products.find((p) => p.product_no === sel) || null;
  const rows = useMemo(() => {
    const val = (p: JScrollSummary): number => {
      switch (sort) {
        case 'top_stop': return p.sections[0]?.stop ?? -1;
        case 'expand_rate': return p.expand_rate ?? -1;
        case 'review': return p.sections[3]?.reach ?? -1;
        case 'click_rate': return p.click_rate ?? -1;
        case 'median_page_pct': return p.median_page_pct ?? -1;
        default: return p.views;
      }
    };
    return [...r.products].sort((a, b) => (a.small_sample === b.small_sample ? val(b) - val(a) : a.small_sample ? 1 : -1));
  }, [r.products, sort]);

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Tile label="잰 상세 조회" value={fmtN(o.views)} sub={r.unmeasured ? `떠날 때 기록 안 온 ${fmtN(r.unmeasured)}회 제외` : '모두 잼'} />
        <Tile label="페이지 깊이 (가운데 값)" value={o.median_page_pct === null ? '-' : `${o.median_page_pct}%`} sub="절반이 이 위치 전에 떠남" />
        <Tile label="사진·가격만 보고 떠남" value={fmtP(o.sections[0]?.stop)} sub="설명이 화면에 안 들어옴" />
        <Tile label="설명 펼침" value={fmtP(o.expand_rate)} sub={o.median_desc_pct === null ? '펼친 사람 없음' : `펼친 사람은 설명의 ${o.median_desc_pct}%까지 (가운데 값)`} />
        <Tile label="리뷰까지 내려옴" value={fmtP(o.sections[3]?.reach)} />
        <Tile label="담기·구매 버튼" value={fmtP(o.click_rate)} sub={o.median_dwell_s === null ? '' : `머문 시간 가운데 값 ${o.median_dwell_s}초`} />
      </div>

      <div className="grid lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3">
          <Section
            title={picked ? `남은 비율 — ${picked.name}` : '남은 비율 (전체 상세)'}
            sub="가로 = 페이지를 내려 본 깊이, 세로 = 그 깊이까지 내려온 조회 비율. 선이 가파르게 떨어지는 곳에서 많이 떠남"
            right={picked && <button className="text-xs text-text-tertiary underline" onClick={() => setSel(null)}>전체로</button>}
          >
            <DepthChart overall={o} picked={picked} />
            {(picked || o).biggest_drop && (
              <div className="text-xs text-text-secondary mt-2">
                가장 많이 떠난 구간: <b className="text-text-primary">{(picked || o).biggest_drop!.from}~{(picked || o).biggest_drop!.to}%</b>
                {' '}(이 구간에서 조회의 {fmtP((picked || o).biggest_drop!.drop)} 가 떠남)
              </div>
            )}
          </Section>
        </div>
        <div className="lg:col-span-2">
          <Section title={picked ? '구역별 도달 — 이 상품' : '구역별 도달 — 전체'} sub="그 구역이 화면에 조금이라도 들어온 조회 비율 · 괄호 = 그 구역에서 멈춤">
            <div className="space-y-2">
              {(picked || o).sections.map((s) => (
                <BarRow key={s.k} label={s.name} share={s.reach}
                  right={<>{fmtP(s.reach)} <span className="text-text-tertiary">({fmtP(s.stop, 0)})</span></>} />
              ))}
            </div>
            <ClickCompare s={picked || o} />
          </Section>
        </div>
      </div>

      <Section title="제품별" sub={`조회 ${r.min_views}회 미만은 아래로 내리고 흐리게 (표본이 적어 해석하지 않음) · 줄을 누르면 위 그래프에 그 상품이 겹쳐짐`}>
        <ProductTable rows={rows} sel={sel} setSel={setSel} sort={sort} setSort={setSort} />
      </Section>

      <Notice>
        페이지 깊이는 리뷰가 긴 상품일수록 낮게 나옵니다(페이지가 길어서). 제품끼리 비교할 땐 「구역별 도달」(설명·정보 고시·리뷰)을 먼저 보세요.
        설명 펼침은 설명이 접혀 있다가 「펼치기」로 길어진 경우, 또는 처음부터 펼쳐진(스토리형) 상품입니다.
        앱을 강제로 닫는 등 떠날 때 기록이 안 오면 그 조회는 빠집니다.
      </Notice>
    </>
  );
}

function DepthChart({ overall, picked }: { overall: JScrollSummary; picked: JScrollSummary | null }) {
  const data = useMemo(() => overall.curve.map((c, i) => ({
    p: `${c.p}%`, overall: c.share, picked: picked ? picked.curve[i]?.share ?? null : undefined,
  })), [overall, picked]);
  return (
    <div style={{ height: 260 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: -6 }}>
          <CartesianGrid vertical={false} stroke="rgb(var(--color-overlay-rgb) / 0.06)" />
          <XAxis dataKey="p" tick={tick} axisLine={false} tickLine={false} interval={1} />
          <YAxis tick={tick} axisLine={false} tickLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
          <ReTooltip contentStyle={tooltipStyle} formatter={(v: any, name: any) => [fmtP(v), name]} labelFormatter={(l) => `${l} 깊이까지`} />
          {picked && <Legend wrapperStyle={{ fontSize: 11 }} />}
          <Line name="전체 상세" dataKey="overall" stroke={picked ? OVERALL : BRAND} strokeWidth={2} dot={false} isAnimationActive={false} />
          {picked && <Line name="이 상품" dataKey="picked" stroke={BRAND} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} connectNulls />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function ClickCompare({ s }: { s: JScrollSummary }) {
  return (
    <div className="mt-4 pt-3 grid grid-cols-2 gap-2 text-xs" style={{ borderTop: '1px solid rgb(var(--color-overlay-rgb) / 0.06)' }}>
      <div className="text-text-tertiary col-span-2">담기·구매 버튼을 누른 조회 vs 안 누른 조회</div>
      <div className="rounded-lg px-3 py-2" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.04)' }}>
        <div className="text-[11px] text-text-tertiary">누름</div>
        <div className="tabular-nums text-text-primary">깊이 {s.median_page_pct_clicked ?? '-'}% · 펼침 {fmtP(s.expand_rate_clicked, 0)}</div>
      </div>
      <div className="rounded-lg px-3 py-2" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.04)' }}>
        <div className="text-[11px] text-text-tertiary">안 누름</div>
        <div className="tabular-nums text-text-primary">깊이 {s.median_page_pct_not_clicked ?? '-'}% · 펼침 {fmtP(s.expand_rate_not_clicked, 0)}</div>
      </div>
    </div>
  );
}

function ProductTable({ rows, sel, setSel, sort, setSort }: {
  rows: JScroll['products']; sel: number | null; setSel: (n: number | null) => void; sort: SortKey; setSort: (s: SortKey) => void;
}) {
  const th = (k: SortKey | null, label: string) => (
    <th className="px-2 py-1.5 text-[11px] font-medium text-right whitespace-nowrap">
      {k ? (
        <button onClick={() => setSort(k)} style={{ color: sort === k ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)' }}>
          {label}{sort === k ? ' ▼' : ''}
        </button>
      ) : <span className="text-text-tertiary">{label}</span>}
    </th>
  );
  const td = 'px-2 py-1.5 text-xs text-right tabular-nums text-text-secondary';
  if (!rows.length) return <div className="text-xs text-text-tertiary">기록 없음</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
            <th className="px-2 py-1.5 text-[11px] font-medium text-text-tertiary text-left">상품</th>
            {th('views', '조회')}
            {th('top_stop', '사진·가격만 보고 떠남')}
            {th(null, '설명 도달')}
            {th('expand_rate', '설명 펼침')}
            {th('review', '리뷰 도달')}
            {th('median_page_pct', '깊이 가운데 값')}
            {th(null, '가장 많이 떠난 구간')}
            {th('click_rate', '담기·구매 버튼')}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const on = sel === p.product_no;
            return (
              <tr key={p.product_no} onClick={() => setSel(on ? null : p.product_no)}
                className="cursor-pointer"
                style={{
                  borderBottom: '1px solid rgb(var(--color-overlay-rgb) / 0.05)',
                  opacity: p.small_sample ? 0.5 : 1,
                  backgroundColor: on ? 'rgb(var(--color-overlay-rgb) / 0.06)' : undefined,
                }}>
                <td className="px-2 py-1.5 text-xs text-text-primary">
                  <div className="flex items-center gap-1.5 max-w-[260px]">
                    <span className="truncate" title={p.name}>{p.name}</span>
                    <a href={`https://nuldam.com/product/detail.html?product_no=${p.product_no}`} target="_blank" rel="noreferrer"
                      onClick={(e) => e.stopPropagation()} className="text-text-tertiary shrink-0" title="상세 열기">
                      <ExternalLink size={11} />
                    </a>
                  </div>
                </td>
                <td className={td}>{fmtN(p.views)}</td>
                <td className={td}>{fmtP(p.sections[0]?.stop)}</td>
                <td className={td}>{fmtP(p.sections[1]?.reach)}</td>
                <td className={td}>{fmtP(p.expand_rate)}</td>
                <td className={td}>{fmtP(p.sections[3]?.reach)}</td>
                <td className={td}>{p.median_page_pct === null ? '-' : `${p.median_page_pct}%`}</td>
                <td className={td}>{p.biggest_drop ? `${p.biggest_drop.from}~${p.biggest_drop.to}% (−${p.biggest_drop.drop}%p)` : '-'}</td>
                <td className={`${td} font-semibold text-text-primary`}>{fmtP(p.click_rate)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
