'use client';

/**
 * 자사몰 › 여정·전환 (2026-11-04 대표 요청).
 *
 * 출처: 자사몰 전 페이지의 tracker.js가 남긴 페이지 기록(무작위 방문자·방문 아이디, 개인정보 없음).
 * 방문 한 번(30분 쉬면 새 방문)이 도달한 가장 깊은 단계로 깔때기를 센다:
 *   방문 → 상품 상세 → 담기·구매 버튼(또는 장바구니) → 주문서 → 결제 완료
 * 신규/재구매는 결제 완료 페이지의 주문번호를 mall_orders(카페24 주문)와 맞춰 본다.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, Tooltip as ReTooltip, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { Loader2, AlertTriangle } from 'lucide-react';
import { journeyApi, type JEntry, type JDevice, type JFunnel, type JMix, type JSeg, type JSankeyNode } from '@/lib/journey-api';
import {
  BRAND, Section, Notice, Seg, Tile, PeriodPicker, BarRow, fmtN, fmtP, md, kstToday, addDays, tooltipStyle, tick,
} from './ui';

// 페이지 유형별 고정 색 (흐름도 노드) — 순서·색은 유형에 붙어 다니고 순위로 바뀌지 않는다
const TYPE_COLOR: Record<string, string> = {
  main: '#4EA7FC', list: '#A855F7', search: '#14B8A6', detail: '#7070FF', cart: '#F97316',
  order: '#E0A100', done: '#22C55E', brand: '#EC4899', _exit: '#9AA0A8',
};
const typeColor = (t: string) => TYPE_COLOR[t] || '#8A8F98';

const ENTRY_OPTS: { v: JEntry; label: string }[] = [
  { v: 'all', label: '전체 방문' }, { v: 'main', label: '메인으로 들어옴' }, { v: 'detail', label: '상세로 바로 들어옴' },
  { v: 'list', label: '목록·기획전으로 들어옴' }, { v: 'brand', label: '브랜드 페이지로 들어옴' }, { v: 'other', label: '그 외' },
];
const DEVICE_OPTS: { v: JDevice; label: string }[] = [{ v: 'all', label: '전체 기기' }, { v: 'm', label: '휴대폰' }, { v: 'pc', label: 'PC' }];

export default function JourneyDashboard() {
  const today = kstToday();
  const [range, setRange] = useState({ start: addDays(today, -6), end: today });
  const [entry, setEntry] = useState<JEntry>('all');
  const [device, setDevice] = useState<JDevice>('all');

  const statusQ = useQuery({ queryKey: ['journey-status'], queryFn: journeyApi.status, staleTime: 60_000 });
  const q = useQuery({
    queryKey: ['journey-funnel', range.start, range.end, entry, device],
    queryFn: () => journeyApi.funnel(range.start, range.end, entry, device),
    staleTime: 5 * 60_000,
  });
  const r = q.data;
  const st = statusQ.data;
  const last24 = st ? Object.values(st.last24h || {}).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">자사몰 여정·전환</h1>
          <p className="text-[11px] text-text-tertiary">
            nuldam.com 방문이 메인에서 결제까지 어디서 빠지는지 · 기준 {range.start} ~ {range.end} (한국 시간)
            {st?.first_kst && <> · 기록 시작 {st.first_kst.replace('T', ' ')}</>}
            {st && <> · 최근 24시간 기록 {fmtN(last24)}건</>}
          </p>
        </div>
        <div className="flex-1" />
        <PeriodPicker start={range.start} end={range.end} onChange={(s, e) => setRange({ start: s, end: e })} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Seg value={entry} options={ENTRY_OPTS} onChange={setEntry} />
        <Seg value={device} options={DEVICE_OPTS} onChange={setDevice} />
      </div>

      {q.isLoading && <div className="flex items-center gap-2 text-sm text-text-tertiary py-10 justify-center"><Loader2 className="animate-spin" size={16} /> 불러오는 중…</div>}
      {q.isError && <Notice>불러오지 못했습니다: {(q.error as any)?.response?.data?.detail || '잠시 뒤 다시 열어 주세요'}</Notice>}
      {r && r.sessions === 0 && (
        <Notice>이 기간에 쌓인 방문 기록이 없습니다. 기록은 2026-11-04 배포 이후부터 쌓입니다(카페24 전 페이지에 설치된 추적 스크립트가 1시간 안에 새 버전으로 바뀜).</Notice>
      )}
      {r && r.sessions > 0 && <Body r={r} />}
    </div>
  );
}

function Body({ r }: { r: JFunnel }) {
  const done = r.stages[4];
  const detail = r.stages[1];
  return (
    <>
      {r.truncated && <Notice><AlertTriangle size={12} className="inline mr-1" />기록이 너무 많아 앞부분 60만 줄만 셌습니다. 기간을 줄여 보세요.</Notice>}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Tile label="방문 수" value={fmtN(r.sessions)} sub={`방문자 ${fmtN(r.visitors)}명`} />
        <Tile label="결제 전환율" value={fmtP(done.of_start, 2)} sub={`결제 완료 ${fmtN(done.sessions)}회`} />
        <Tile label="상세 본 방문 중 결제" value={fmtP(detail.sessions ? (done.sessions / detail.sessions) * 100 : null, 2)} sub={`상세 본 방문 ${fmtN(detail.sessions)}회`} />
        <Tile label="주문서 → 결제 완료" value={fmtP(r.stages[4].of_prev)} sub="주문서까지 온 방문 중" />
        <Tile label="한 페이지만 보고 나감" value={fmtP(r.bounce_rate)} sub="버튼도 안 누른 방문" />
        <Tile label="방문당 페이지" value={r.pageviews_per_session ?? '-'} sub="같은 유형 연속은 한 번" />
      </div>

      <div className="grid lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3">
          <Section title="결제까지 가는 깔때기" sub="방문 한 번이 도달한 가장 깊은 단계 기준 · 막대 폭 = 방문 수 · 오른쪽 = 다음 단계로 못 간 방문">
            <Funnel r={r} />
          </Section>
        </div>
        <div className="lg:col-span-2">
          <Section title="단계마다 어디서 나갔나" sub="그 단계까지 와서 다음으로 못 간 방문이 마지막으로 본 페이지">
            <div className="space-y-4">
              {r.drop_where.map((d) => (
                <div key={d.stage}>
                  <div className="text-xs font-medium text-text-primary mb-1.5">
                    {d.stage}까지 오고 {d.next}(으)로 못 감 <span className="text-text-tertiary font-normal">· {fmtN(d.sessions)}회</span>
                  </div>
                  <div className="space-y-1">
                    {d.last_pages.length === 0 && <div className="text-[11px] text-text-tertiary">없음</div>}
                    {d.last_pages.map((p) => (
                      <BarRow key={p.page_type} label={p.label} share={p.share} color={typeColor(p.page_type)}
                        right={<>{fmtN(p.sessions)} <span className="text-text-tertiary">({fmtP(p.share, 0)})</span></>} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>

      <Section title="페이지 흐름 (처음 5걸음)" sub="왼쪽부터 첫 페이지 → 다음 페이지… 띠 굵기 = 방문 수 · '나감' = 거기서 떠남 · 같은 유형을 연달아 본 건 한 걸음으로 묶음 · 적은 흐름(0.2% 미만)은 생략">
        <FlowChart r={r} />
      </Section>

      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="신규 구매 vs 재구매" sub="재구매 = 같은 회원의 이전 결제 주문이 있음 (카페24 주문 기록 기준)">
          <div className="space-y-4">
            <MixBar title="이 화면이 추적한 결제 완료" m={r.purchase_tracked}
              note={r.purchase_tracked.pending ? `주문 기록이 아직 안 들어온 ${fmtN(r.purchase_tracked.pending)}건은 빼고 셈(주문 수집 주기 차이)` : undefined} />
            <MixBar title="같은 기간 자사몰 전체 결제 주문 (비교용)" m={r.purchase_all} />
          </div>
        </Section>
        <Section title="방문 유형별 전환" sub="첫 방문 = 이 브라우저로 처음 온 방문 · 다시 온 방문자 = 전에 온 적 있음">
          <SegTable rows={[...r.segments.visitor, ...r.segments.device]} />
        </Section>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="유입 출처별 전환" sub="첫 페이지 직전 사이트 또는 utm_source 기준">
          <SegTable rows={r.segments.source} />
        </Section>
        <Section title="들어온 페이지별 전환" sub="첫 페이지가 어디였나">
          <SegTable rows={r.segments.entry} />
        </Section>
      </div>

      <Trend r={r} />

      <Notice>
        담기·구매 버튼 = 상세에서 「장바구니·담기·구매하기·바로구매·선물하기」를 누른 것(옵션 창 안 버튼 포함) 또는 장바구니 페이지를 연 것.
        결제 완료 = 주문완료 페이지 도달. 앱 안 브라우저·광고 차단기 등으로 기록이 빠지는 방문이 있어 카페24 방문자 수보다 조금 적을 수 있습니다.
      </Notice>
    </>
  );
}

/** 깔때기: 단계마다 가운데 맞춘 막대 + 사이 사다리꼴, 오른쪽에 빠진 수 */
function Funnel({ r }: { r: JFunnel }) {
  const W = 640, ROW = 46, GAP = 30, LEFT = 0, BAR_W = 440;
  const max = r.stages[0].sessions || 1;
  const w = (n: number) => Math.max(6, (n / max) * BAR_W);
  const H = r.stages.length * ROW + (r.stages.length - 1) * GAP;
  const cx = LEFT + BAR_W / 2;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="결제까지 가는 깔때기">
      {r.stages.map((s, i) => {
        const y = i * (ROW + GAP);
        const bw = w(s.sessions);
        const next = r.stages[i + 1];
        return (
          <g key={s.key}>
            <title>{`${s.label}: ${fmtN(s.sessions)}회 (처음 대비 ${fmtP(s.of_start)})`}</title>
            <rect x={cx - bw / 2} y={y} width={bw} height={ROW} rx={6}
              fill={BRAND} fillOpacity={0.9 - i * 0.13} />
            <text x={cx} y={y + 19} textAnchor="middle" fontSize={12} fontWeight={600}
              fill={bw > 120 ? '#fff' : 'var(--color-text-primary)'} dx={bw > 120 ? 0 : bw / 2 + 64}>
              {s.label}
            </text>
            <text x={cx} y={y + 35} textAnchor="middle" fontSize={11} className="tabular-nums"
              fill={bw > 120 ? 'rgba(255,255,255,.88)' : 'var(--color-text-secondary)'} dx={bw > 120 ? 0 : bw / 2 + 64}>
              {fmtN(s.sessions)}회 · {fmtP(s.of_start)}
            </text>
            {next && (() => {
              const nb = w(next.sessions);
              const y2 = y + ROW + GAP;
              const lost = 100 - (next.of_prev ?? 0);
              return (
                <g>
                  <path d={`M${cx - bw / 2 + 4},${y + ROW} L${cx + bw / 2 - 4},${y + ROW} L${cx + nb / 2},${y2} L${cx - nb / 2},${y2} Z`}
                    fill={BRAND} fillOpacity={0.12} />
                  <text x={BAR_W + 24} y={y + ROW + GAP / 2 + 4} fontSize={11} fill="var(--color-text-secondary)" className="tabular-nums">
                    <tspan fill="#E5484D" fontWeight={600}>−{fmtN(s.sessions - next.sessions)}</tspan>
                    <tspan dx={6}>({fmtP(lost)} 빠짐)</tspan>
                  </text>
                </g>
              );
            })()}
          </g>
        );
      })}
    </svg>
  );
}

/** 흐름도: 걸음마다 한 열(고정), 노드 높이 = 방문 수, '나감'은 떠난 그 걸음 다음 열 맨 아래 */
const TYPE_ORDER = ['main', 'list', 'search', 'detail', 'cart', 'order', 'done', 'brand', 'member', 'myshop', 'board', 'other', '_exit'];

function FlowChart({ r }: { r: JFunnel }) {
  const layout = useMemo(() => {
    const { nodes, links } = r.sankey;
    if (!links.length) return null;
    const W = 1100, H = 440, NW = 10, PAD = 10, LABEL = 120;
    const inV = new Map<number, number>(), outV = new Map<number, number>();
    links.forEach((l) => {
      outV.set(l.source, (outV.get(l.source) || 0) + l.value);
      inV.set(l.target, (inV.get(l.target) || 0) + l.value);
    });
    const val = (id: number) => Math.max(inV.get(id) || 0, outV.get(id) || 0);
    const cols = Math.max(...nodes.map((n) => n.step)) + 1;
    const byCol: JSankeyNode[][] = Array.from({ length: cols }, () => []);
    nodes.forEach((n) => byCol[n.step].push(n));
    byCol.forEach((c) => c.sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)));
    const colTotal = byCol.map((c) => c.reduce((s, n) => s + val(n.id), 0));
    const maxN = Math.max(...byCol.map((c) => c.length));
    const k = (H - PAD * (maxN - 1)) / Math.max(...colTotal, 1);
    const colX = (c: number) => (cols === 1 ? 0 : (c * (W - LABEL - NW)) / (cols - 1));
    const pos = new Map<number, { x: number; y: number; h: number; n: JSankeyNode; v: number }>();
    byCol.forEach((c, ci) => {
      let y = 0;
      c.forEach((n) => { const h = Math.max(2, val(n.id) * k); pos.set(n.id, { x: colX(ci), y, h, n, v: val(n.id) }); y += h + PAD; });
    });
    // 띠: 출발 노드 안에서는 도착 위치 순, 도착 노드 안에서는 출발 위치 순으로 쌓는다
    const outOff = new Map<number, number>(), inOff = new Map<number, number>();
    const sorted = [...links].sort((a, b) => (pos.get(a.source)!.y - pos.get(b.source)!.y) || (pos.get(a.target)!.y - pos.get(b.target)!.y));
    const bands = sorted.map((l) => {
      const s = pos.get(l.source)!, t = pos.get(l.target)!, w = l.value * k;
      const so = outOff.get(l.source) || 0, to = inOff.get(l.target) || 0;
      outOff.set(l.source, so + w); inOff.set(l.target, to + w);
      return { l, s, t, w, sy: s.y + so + w / 2, ty: t.y + to + w / 2 };
    });
    // 들어오는 띠 순서도 출발 위치 순으로 다시 맞춤
    const inSorted = [...bands].sort((a, b) => (a.t.y - b.t.y) || (a.s.y - b.s.y) || (a.sy - b.sy));
    inOff.clear();
    inSorted.forEach((b) => { const to = inOff.get(b.l.target) || 0; inOff.set(b.l.target, to + b.w); b.ty = b.t.y + to + b.w / 2; });
    return { W, H, NW, pos: Array.from(pos.values()), bands };
  }, [r.sankey]);
  if (!layout) return <div className="text-xs text-text-tertiary py-6 text-center">흐름을 그릴 만큼 기록이 없습니다</div>;
  const { W, H, NW, pos, bands } = layout;
  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`-4 -4 ${W + 8} ${H + 8}`} style={{ minWidth: 720 }} className="w-full" role="img" aria-label="페이지 흐름">
        {bands.map((b, i) => {
          const x0 = b.s.x + NW, x1 = b.t.x, mx = (x0 + x1) / 2;
          const exit = b.t.n.type === '_exit';
          return (
            <path key={i} d={`M${x0},${b.sy} C${mx},${b.sy} ${mx},${b.ty} ${x1},${b.ty}`} fill="none"
              stroke={exit ? '#9AA0A8' : typeColor(b.s.n.type)} strokeOpacity={exit ? 0.2 : 0.3} strokeWidth={Math.max(1, b.w)}>
              <title>{`${b.s.n.name} → ${b.t.n.name}: ${fmtN(b.l.value)}회`}</title>
            </path>
          );
        })}
        {pos.map((p) => (
          <g key={p.n.id}>
            <rect x={p.x} y={p.y} width={NW} height={p.h} rx={2} fill={typeColor(p.n.type)}>
              <title>{`${p.n.step + 1}번째 걸음 · ${p.n.name}: ${fmtN(p.v)}회`}</title>
            </rect>
            {p.h >= 9 && (
              <text x={p.x + NW + 5} y={p.y + p.h / 2 + 4} fontSize={11} fill="var(--color-text-secondary)">
                {p.n.name} <tspan fill="var(--color-text-tertiary)">{fmtN(p.v)}</tspan>
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="flex flex-wrap gap-3 mt-2 text-[11px] text-text-tertiary">
        {Object.entries(r.page_labels).filter(([k]) => TYPE_COLOR[k]).map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: typeColor(k) }} />{v}</span>
        ))}
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#8A8F98' }} />그 외</span>
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: TYPE_COLOR._exit }} />나감</span>
      </div>
    </div>
  );
}
const MIX_COLORS = { new: '#4EA7FC', repeat: '#7070FF', guest: '#B4B9C1' };

function MixBar({ title, m, note }: { title: string; m: JMix; note?: string }) {
  const parts = [
    { k: 'new', label: '신규 구매', n: m.new, s: m.new_share },
    { k: 'repeat', label: '재구매', n: m.repeat, s: m.repeat_share },
    { k: 'guest', label: '비회원', n: m.guest, s: m.guest_share },
  ] as const;
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1.5">
        <div className="text-xs font-medium text-text-primary">{title}</div>
        <div className="text-[11px] text-text-tertiary">주문 {fmtN(m.total)}건 · 회원 주문 중 재구매 {fmtP(m.repeat_share_members)}</div>
      </div>
      {m.total === 0 ? <div className="text-[11px] text-text-tertiary">주문 없음</div> : (
        <div className="flex h-7 rounded-md overflow-hidden gap-[2px]" role="img" aria-label={title}>
          {parts.filter((p) => p.n > 0).map((p) => (
            <div key={p.k} title={`${p.label} ${fmtN(p.n)}건 (${fmtP(p.s)})`}
              className="h-full flex items-center justify-center text-[11px] font-medium text-white tabular-nums"
              style={{ width: `${p.s}%`, backgroundColor: MIX_COLORS[p.k] }}>
              {(p.s ?? 0) >= 18 ? `${p.label} ${fmtP(p.s, 0)}` : ''}
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-3 mt-1.5 text-[11px] text-text-secondary tabular-nums">
        {parts.map((p) => (
          <span key={p.k} className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: MIX_COLORS[p.k] }} />{p.label} {fmtN(p.n)}건 ({fmtP(p.s)})
          </span>
        ))}
      </div>
      {note && <div className="text-[11px] text-text-tertiary mt-1">{note}</div>}
    </div>
  );
}

function SegTable({ rows }: { rows: JSeg[] }) {
  if (!rows.length) return <div className="text-xs text-text-tertiary">기록 없음</div>;
  const th = 'px-2 py-1.5 text-[11px] font-medium text-text-tertiary text-right whitespace-nowrap';
  const td = 'px-2 py-1.5 text-xs text-right tabular-nums text-text-secondary';
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
            <th className={`${th} text-left`}>구분</th><th className={th}>방문</th><th className={th}>상세 도달</th>
            <th className={th}>담기·구매 버튼</th><th className={th}>결제 전환율</th><th className={th}>주문서→결제</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const small = s.sessions < 100;
            return (
              <tr key={s.name} style={{ borderBottom: '1px solid rgb(var(--color-overlay-rgb) / 0.05)' }}>
                <td className="px-2 py-1.5 text-xs text-text-primary whitespace-nowrap">{s.name}{small && <span className="text-[10px] text-text-tertiary ml-1">(표본 적음)</span>}</td>
                <td className={td}>{fmtN(s.sessions)}</td>
                <td className={td}>{fmtP(s.detail_rate)}</td>
                <td className={td}>{fmtP(s.sessions ? (s.stages[2] / s.sessions) * 100 : null)}</td>
                <td className={`${td} font-semibold text-text-primary`}>{fmtP(s.conv_rate, 2)}</td>
                <td className={td}>{fmtP(s.order_to_done)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Trend({ r }: { r: JFunnel }) {
  const data = useMemo(() => r.trend.map((t) => ({ ...t, d: md(t.date) })), [r.trend]);
  if (data.length < 2) return null;
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Section title="날짜별 방문 수" sub="한국 시간 날짜 기준">
        <div style={{ height: 200 }}>
          <ResponsiveContainer>
            <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid vertical={false} stroke="rgb(var(--color-overlay-rgb) / 0.06)" />
              <XAxis dataKey="d" tick={tick} axisLine={false} tickLine={false} />
              <YAxis tick={tick} axisLine={false} tickLine={false} />
              <ReTooltip contentStyle={tooltipStyle} formatter={(v: any) => [`${fmtN(v)}회`, '방문']} cursor={{ fill: 'rgb(var(--color-overlay-rgb) / 0.04)' }} />
              <Bar dataKey="sessions" fill={BRAND} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>
      <Section title="날짜별 결제 전환율" sub="그날 방문 중 결제 완료까지 간 비율">
        <div style={{ height: 200 }}>
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid vertical={false} stroke="rgb(var(--color-overlay-rgb) / 0.06)" />
              <XAxis dataKey="d" tick={tick} axisLine={false} tickLine={false} />
              <YAxis tick={tick} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
              <ReTooltip contentStyle={tooltipStyle} formatter={(v: any) => [fmtP(v, 2), '결제 전환율']} />
              <Line dataKey="conv_rate" stroke={BRAND} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Section>
    </div>
  );
}
