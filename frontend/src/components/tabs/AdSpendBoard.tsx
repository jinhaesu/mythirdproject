'use client';

/**
 * 광고비 일보 — 매체별 일별 광고비 기입 그리드 (구글시트 일보의 시스템화).
 *
 * 행 = 매체(유입채널 그룹핑), 열 = 1일~말일. 셀 클릭 → 기입(단위: 원).
 * 우측: 월 합계 / Limit(클릭 수정) / 사용율. 하단: 일별 합계.
 * meta/naver_sa 자동 연동 매체는 스냅샷에서 자동 채움(읽기 전용).
 * 저장·표시·입력 전부 원 단위(VAT 포함) — 팀이 원 단위로 기입하는 관행에 맞춰
 * 2026-10-06 천원 입력(×1000 저장)을 폐지. 천원 입력분은 ÷1000 복구 완료.
 */
import { Fragment, useMemo, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus, X, ChevronLeft, ChevronRight, Trash2, BarChart3, ChevronDown, ChevronUp } from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis,
  Tooltip as ReTooltip, Legend, CartesianGrid, Cell,
} from 'recharts';
import toast from 'react-hot-toast';
import { adspendApi, type AdMediaGroup, type AdMediaRow } from '@/lib/api';
import { fmtWon } from '@/components/tabs/kpi/format';

const thisMonth = () => new Date().toISOString().slice(0, 7);

function monthAdd(month: string, delta: number): string {
  const y = parseInt(month.slice(0, 4), 10);
  const m = parseInt(month.slice(5, 7), 10);
  const t = y * 12 + (m - 1) + delta;
  return `${String(Math.floor(t / 12)).padStart(4, '0')}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/** 원 단위 표시 (0·빈 값은 공백) */
const k = (v: number | null | undefined) =>
  v === null || v === undefined || v === 0 ? '' : Math.round(v).toLocaleString('ko-KR');

// 우측 고정 열 (합계/Limit/사용율/비고) — 가로 스크롤해도 항상 보이도록 sticky right
const COL_NOTE = 150; const COL_PCT = 56; const COL_LIMIT = 100; const COL_TOTAL = 104;
const R_NOTE = 0; const R_PCT = COL_NOTE; const R_LIMIT = COL_NOTE + COL_PCT; const R_TOTAL = COL_NOTE + COL_PCT + COL_LIMIT;
const stickyR = (right: number, w: number, bg: string, z = 10, divider = false): CSSProperties => ({
  position: 'sticky', right, minWidth: w, width: w, maxWidth: w, zIndex: z, backgroundColor: bg,
  ...(divider ? { borderLeft: '1px solid var(--color-border-primary)' } : {}),
});

// 비용 분석 차트 팔레트 (유입채널별)
const INFLOW_COLORS = ['#4EA7FC', '#8B5CF6', '#F0883E', '#3FB950', '#F85149', '#D29922', '#DB61A2', '#58A6FF', '#56D364', '#E3B341', '#79C0FF', '#FFA657'];
const fmtAxis = (v: number) =>
  Math.abs(v) >= 1e8 ? `${(v / 1e8).toFixed(1)}억` : Math.abs(v) >= 1e4 ? `${Math.round(v / 1e4).toLocaleString()}만` : String(v);

export function AdSpendBoard() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(thisMonth());
  const [editCell, setEditCell] = useState<{ mediaId: number; date: string } | null>(null);
  const [editLimit, setEditLimit] = useState<number | null>(null); // media_id
  const [editNote, setEditNote] = useState<number | null>(null); // media_id
  const [cellValue, setCellValue] = useState('');
  // 매체 추가 모달 — null=닫힘, ''=그룹 미선택으로 열기, '그룹명'=그 그룹 선택된 채로 열기
  const [addMediaGroup, setAddMediaGroup] = useState<string | null>(null);
  const [inflowF, setInflowF] = useState(''); // '' = 전체
  const [ownerF, setOwnerF] = useState(''); // '' = 전체
  const [scope, setScope] = useState<'month' | 'all'>('month'); // month=이달 거래 매체만

  const { data: board, isLoading } = useQuery({
    queryKey: ['adspend', 'board', month, scope],
    queryFn: () => adspendApi.board(month, scope),
  });

  // ── 비용 분석 (상단 그래프) — 기간은 보드 월과 독립적으로 선택 ──
  const [showAnalysis, setShowAnalysis] = useState(true);
  const [trendFrom, setTrendFrom] = useState(() => monthAdd(thisMonth(), -5));
  const [trendTo, setTrendTo] = useState(thisMonth());
  const { data: trend } = useQuery({
    queryKey: ['adspend', 'trend', trendFrom, trendTo],
    queryFn: () => adspendApi.trend(trendFrom, trendTo),
    enabled: showAnalysis,
  });
  const trendRows = useMemo(
    () => (trend?.series || []).map((s) => ({
      month: s.month.slice(2), total: s.total, limit: s.limit, plan: s.plan,
      usage_pct: s.usage_pct, ...s.by_inflow,
    })),
    [trend],
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: ['adspend'] });

  const entryMut = useMutation({
    mutationFn: ({ mediaId, date, amount }: { mediaId: number; date: string; amount: number }) =>
      adspendApi.upsertEntry(mediaId, date, amount),
    onSuccess: invalidate,
    onError: () => toast.error('저장 실패'),
  });
  const limitMut = useMutation({
    mutationFn: ({ mediaId, limit }: { mediaId: number; limit: number }) =>
      adspendApi.upsertBudget(mediaId, month, { limit_amount: limit }),
    onSuccess: invalidate,
    onError: () => toast.error('Limit 저장 실패'),
  });
  const noteMut = useMutation({
    mutationFn: ({ mediaId, note }: { mediaId: number; note: string }) =>
      adspendApi.upsertBudget(mediaId, month, { note }),
    onSuccess: invalidate,
    onError: () => toast.error('비고 저장 실패'),
  });
  const deleteMut = useMutation({
    mutationFn: (mediaId: number) => adspendApi.deleteMedia(mediaId),
    onSuccess: (d) => {
      toast.success(d.deleted ? '매체를 삭제했습니다' : (d.detail || '이력이 있어 비활성화했습니다 (데이터 보존)'));
      invalidate();
    },
    onError: () => toast.error('삭제 실패'),
  });

  const days = board?.days_in_month ?? 30;
  const dates = useMemo(
    () => Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
    [month, days],
  );
  const todayIso = new Date().toISOString().slice(0, 10);

  // 필터 옵션 (이달 전체 행 기준)
  const inflowOptions = useMemo(
    () => Array.from(new Set((board?.rows || []).map((r) => r.inflow || '기타'))),
    [board],
  );
  const ownerOptions = useMemo(
    () => Array.from(new Set((board?.rows || []).map((r) => r.owner).filter(Boolean))) as string[],
    [board],
  );

  // 필터 적용된 행
  const filteredRows = useMemo(
    () => (board?.rows || []).filter((r) =>
      (!inflowF || (r.inflow || '기타') === inflowF) && (!ownerF || r.owner === ownerF)),
    [board, inflowF, ownerF],
  );
  const isFiltered = !!(inflowF || ownerF);

  // 그룹(판매채널) 메타 — 시트 순서·색·담당자
  const groupMeta = useMemo(() => {
    const m = new Map<string, AdMediaGroup>();
    (board?.groups || []).forEach((g) => m.set(g.name, g));
    return m;
  }, [board]);
  const groupStyle = (name: string) => {
    const c = groupMeta.get(name)?.color;
    return c ? ({ '--gc': c } as CSSProperties) : undefined;
  };

  // 유입채널별 그룹핑 (서버가 시트 순서로 정렬해 보냄 → 등장 순서 유지)
  const groups = useMemo(() => {
    const map = new Map<string, AdMediaRow[]>();
    filteredRows.forEach((r) => {
      const key = r.inflow || '기타';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    });
    return Array.from(map.entries());
  }, [filteredRows]);

  // 필터 반영 합계 (필터 없으면 서버 totals 그대로)
  const view = useMemo(() => {
    if (!board) return null;
    if (!isFiltered) return { dayTotals: board.day_totals, ...board.totals };
    const dayTotals: Record<string, number> = {};
    let spend = 0; let limit = 0;
    filteredRows.forEach((r) => {
      Object.entries(r.daily).forEach(([d, v]) => { dayTotals[d] = (dayTotals[d] || 0) + v; });
      spend += r.month_total || 0;
      limit += r.limit_amount || 0;
    });
    return { dayTotals, spend, limit, plan: 0, usage_pct: limit ? Math.round((spend / limit) * 1000) / 10 : null };
  }, [board, filteredRows, isFiltered]);

  // 일별 집행 추이 (필터 반영, 빈 날 0 채움)
  const dailyRows = useMemo(() => {
    if (!board || !view) return [];
    const n = board.days_in_month || 31;
    const byDay: Record<number, number> = {};
    Object.entries(view.dayTotals || {}).forEach(([d, v]) => {
      byDay[parseInt(d.slice(8, 10), 10)] = (byDay[parseInt(d.slice(8, 10), 10)] || 0) + (v as number);
    });
    return Array.from({ length: n }, (_, i) => ({ d: i + 1, v: byDay[i + 1] || 0 }));
  }, [board, view]);

  // 이 달 유입채널별 구성 (필터 반영)
  const inflowComposition = useMemo(() => {
    const map = new Map<string, number>();
    filteredRows.forEach((r) => {
      const key = r.inflow || '기타';
      map.set(key, (map.get(key) || 0) + (r.month_total || 0));
    });
    return Array.from(map.entries()).map(([name, v]) => ({ name, v }))
      .filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
  }, [filteredRows]);

  const commitCell = () => {
    if (!editCell) return;
    const raw = cellValue.replace(/,/g, '').trim();
    const num = raw === '' ? 0 : Number(raw);
    if (Number.isNaN(num) || num < 0) { toast.error('숫자를 입력해 주세요 (원 단위)'); return; }
    entryMut.mutate({ mediaId: editCell.mediaId, date: editCell.date, amount: num });
    setEditCell(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h2 className="text-base font-semibold text-text-primary">광고비 일보</h2>
          <p className="text-xs text-text-tertiary mt-0.5">
            셀 클릭으로 기입 · 단위 <b className="text-text-secondary">원</b> (VAT 포함) · Limit 셀 클릭으로 월 한도 수정
          </p>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <button onClick={() => setMonth(monthAdd(month, -1))} className="p-1.5 rounded-lg border border-border-primary text-text-tertiary hover:text-text-primary"><ChevronLeft size={13} /></button>
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary" />
          <button onClick={() => setMonth(monthAdd(month, 1))} className="p-1.5 rounded-lg border border-border-primary text-text-tertiary hover:text-text-primary"><ChevronRight size={13} /></button>
        </div>
        <div className="flex items-center rounded-lg p-0.5" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.05)' }}>
          {([['month', '이달 거래 매체'], ['all', '전체 매체']] as const).map(([kv, label]) => (
            <button key={kv} onClick={() => setScope(kv)}
              title={kv === 'month' ? '이 달에 기입·Limit·자동수집이 있는 매체 + 신규 매체만 표시' : '활성 매체 전부 표시 — 과거 거래처에 새로 기입할 때'}
              className="px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors"
              style={scope === kv
                ? { backgroundColor: 'var(--color-brand-bg)', color: '#fff' }
                : { color: 'var(--color-text-tertiary)' }}>
              {label}
            </button>
          ))}
        </div>
        <select value={inflowF} onChange={(e) => setInflowF(e.target.value)}
          className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary max-w-[150px]">
          <option value="">유입채널 전체</option>
          {inflowOptions.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <select value={ownerF} onChange={(e) => setOwnerF(e.target.value)}
          className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary max-w-[120px]">
          <option value="">담당자 전체</option>
          {ownerOptions.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        {isFiltered && (
          <button onClick={() => { setInflowF(''); setOwnerF(''); }}
            className="px-2 py-1.5 rounded-lg text-xs text-red border border-red/40 hover:bg-red/10">필터 해제</button>
        )}
        <button
          onClick={async () => {
            try { await adspendApi.exportXlsx(month); toast.success('엑셀 다운로드 시작'); }
            catch { toast.error('다운로드 실패'); }
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-text-secondary border border-border-primary hover:text-text-primary"
        >
          <Download size={13} /> 엑셀
        </button>
        <button onClick={() => setAddMediaGroup('')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white hover:opacity-90"
          style={{ backgroundColor: 'var(--color-brand-bg)' }}>
          <Plus size={13} /> 매체 추가
        </button>
      </div>

      {/* 입력 단위 안내 — 2026-10-06 천원→원 전환 공지 */}
      <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-[11px]"
        style={{ backgroundColor: 'rgba(240,191,0,0.08)', border: '1px solid rgba(240,191,0,0.35)' }}>
        <span className="text-yellow font-bold shrink-0">₩ 입력 단위 확인</span>
        <span className="text-text-secondary">
          모든 금액은 <b className="text-text-primary">원 단위</b>로 입력합니다 — 150만 원이면 <b className="text-text-primary">1500000</b>,
          천원 단위(1500)로 적으면 1,000배 작게 저장됩니다. Limit·비고 옆 금액도 동일하게 원 단위입니다.
        </span>
      </div>

      {/* 월 요약 (필터 반영) */}
      {board && view && (
        <div className="flex flex-wrap gap-3">
          {[
            { label: `${parseInt(month.slice(5), 10)}월 집행${isFiltered ? ' (필터)' : ''}`, value: fmtWon(view.spend) },
            { label: 'Limit 합계', value: fmtWon(view.limit) },
            {
              label: '사용율',
              value: view.usage_pct != null ? `${view.usage_pct}%` : '-',
              cls: view.usage_pct != null && view.usage_pct > 100 ? 'text-red' :
                view.usage_pct != null && view.usage_pct > 90 ? 'text-yellow' : 'text-green',
            },
            {
              label: scope === 'month' ? '이달 거래 매체' : '매체 수',
              value: (isFiltered ? `${filteredRows.length} / ${board.rows.length}` : String(board.rows.length))
                + (scope === 'month' && board.total_active_media ? ` (전체 ${board.total_active_media})` : ''),
            },
          ].map((c) => (
            <div key={c.label} className="rounded-xl px-4 py-2.5" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
              <p className="text-[10px] text-text-quaternary">{c.label}</p>
              <p className={`text-base font-bold tabular-nums ${c.cls || 'text-text-primary'}`}>{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── 비용 분석 그래프 — 기간 선택 가능, 유입채널 스택 + Limit 라인 ── */}
      <div className="rounded-xl" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
          <button onClick={() => setShowAnalysis((s) => !s)}
            className="flex items-center gap-1.5 text-sm font-semibold text-text-primary">
            <BarChart3 size={14} className="text-brand" /> 비용 분석
            {showAnalysis ? <ChevronUp size={13} className="text-text-tertiary" /> : <ChevronDown size={13} className="text-text-tertiary" />}
          </button>
          {showAnalysis && (
            <>
              <div className="flex-1" />
              <span className="text-[11px] text-text-tertiary">기간</span>
              <input type="month" value={trendFrom} max={trendTo}
                onChange={(e) => e.target.value && setTrendFrom(e.target.value)}
                className="px-2 py-1 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary" />
              <span className="text-xs text-text-tertiary">~</span>
              <input type="month" value={trendTo} min={trendFrom}
                onChange={(e) => e.target.value && setTrendTo(e.target.value)}
                className="px-2 py-1 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary" />
              {[3, 6, 12].map((n) => (
                <button key={n}
                  onClick={() => { setTrendTo(thisMonth()); setTrendFrom(monthAdd(thisMonth(), -(n - 1))); }}
                  className="px-2 py-1 rounded-lg text-[11px] text-text-tertiary border border-border-primary hover:text-text-primary">
                  {n}개월
                </button>
              ))}
            </>
          )}
        </div>
        {showAnalysis && trend && (
          <div className="px-3 pb-3 space-y-3">
            {/* 월별 추이: 유입채널 스택 바 + Limit/사업계획 라인 */}
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <ComposedChart data={trendRows} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }} />
                  <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }} width={52} />
                  <ReTooltip
                    formatter={(val: number, name: string) => [fmtWon(Number(val) || 0), name]}
                    contentStyle={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: 'var(--color-text-secondary)' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {(trend.inflows || []).map((inf, i) => (
                    <Bar key={inf} dataKey={inf} stackId="spend" fill={INFLOW_COLORS[i % INFLOW_COLORS.length]} maxBarSize={48} />
                  ))}
                  <Line type="monotone" dataKey="limit" name="Limit" stroke="#F85149" strokeWidth={2} strokeDasharray="6 3" dot={{ r: 2.5 }} />
                  <Line type="monotone" dataKey="plan" name="사업계획" stroke="#3FB950" strokeWidth={1.5} strokeDasharray="2 3" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {/* 이 달 일별 집행 (보드 필터 반영) */}
              <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)' }}>
                <p className="text-xs font-medium text-text-secondary mb-2">
                  {parseInt(month.slice(5), 10)}월 일별 집행{isFiltered ? ' (필터 반영)' : ''}
                </p>
                <div style={{ width: '100%', height: 170 }}>
                  <ResponsiveContainer>
                    <BarChart data={dailyRows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <XAxis dataKey="d" tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }} interval={4} />
                      <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }} width={48} />
                      <ReTooltip
                        formatter={(val: number) => [fmtWon(Number(val) || 0), '집행']}
                        labelFormatter={(d) => `${parseInt(month.slice(5), 10)}/${d}`}
                        contentStyle={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)', borderRadius: 8, fontSize: 12 }}
                      />
                      <Bar dataKey="v" fill="#4EA7FC" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              {/* 이 달 유입채널별 구성 (보드 필터 반영) */}
              <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)' }}>
                <p className="text-xs font-medium text-text-secondary mb-2">
                  {parseInt(month.slice(5), 10)}월 유입채널별 구성{isFiltered ? ' (필터 반영)' : ''}
                </p>
                <div style={{ width: '100%', height: 170 }}>
                  <ResponsiveContainer>
                    <BarChart data={inflowComposition} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                      <XAxis type="number" tickFormatter={fmtAxis} tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }} />
                      <YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 10, fill: 'var(--color-text-secondary)' }} />
                      <ReTooltip
                        formatter={(val: number) => [fmtWon(Number(val) || 0), '집행']}
                        contentStyle={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)', borderRadius: 8, fontSize: 12 }}
                      />
                      <Bar dataKey="v" radius={[0, 2, 2, 0]} maxBarSize={18}>
                        {inflowComposition.map((x, i) => (
                          <Cell key={x.name} fill={INFLOW_COLORS[i % INFLOW_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><div className="w-7 h-7 border-2 border-brand border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            <table className="text-[11px] border-collapse" style={{ minWidth: `${520 + days * 76}px` }}>
              <thead className="sticky top-0 z-20" style={{ backgroundColor: 'var(--color-bg-level-2)' }}>
                <tr>
                  <th className="sticky left-0 z-30 px-2 py-2 text-left font-medium text-text-tertiary min-w-[190px]" style={{ backgroundColor: 'var(--color-bg-level-2)' }}>매체</th>
                  {dates.map((d) => (
                    <th key={d} className={`px-1 py-2 text-right font-medium min-w-[72px] ${d === todayIso ? 'text-text-primary' : 'text-text-quaternary'}`}>
                      {parseInt(d.slice(8), 10)}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right font-medium text-text-secondary" style={stickyR(R_TOTAL, COL_TOTAL, 'var(--color-bg-level-2)', 30, true)}>합계</th>
                  <th className="px-2 py-2 text-right font-medium text-text-quaternary" style={stickyR(R_LIMIT, COL_LIMIT, 'var(--color-bg-level-2)', 30)}>Limit</th>
                  <th className="px-2 py-2 text-right font-medium text-text-quaternary" style={stickyR(R_PCT, COL_PCT, 'var(--color-bg-level-2)', 30)}>사용율</th>
                  <th className="px-2 py-2 text-left font-medium text-text-quaternary" style={stickyR(R_NOTE, COL_NOTE, 'var(--color-bg-level-2)', 30)}>비고</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(([inflow, rows]) => {
                  const gs = groupStyle(inflow);
                  const owner = groupMeta.get(inflow)?.owner;
                  return (
                  <Fragment key={inflow}>
                    <tr className="group/gh">
                      <td colSpan={days + 5}
                        className={`p-0 text-[10px] font-bold ${gs ? 'adg-head' : ''}`}
                        style={gs || { backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.06)', color: 'var(--color-accent-hover)' }}>
                        {/* 그룹 헤더 클릭 → 이 그룹에 매체 추가 */}
                        <button
                          onClick={() => setAddMediaGroup(inflow === '기타' ? '' : inflow)}
                          title={`'${inflow}' 그룹에 매체 추가`}
                          className="sticky left-0 flex items-center gap-1.5 px-2 py-1.5 text-left hover:underline"
                        >
                          <span>{inflow}</span>
                          {owner && <span className="font-medium opacity-70">· {owner}</span>}
                          <span className="flex items-center gap-0.5 font-medium opacity-0 group-hover/gh:opacity-80 transition-opacity">
                            <Plus size={10} /> 매체 추가
                          </span>
                        </button>
                      </td>
                    </tr>
                    {rows.map((r) => (
                      <tr key={r.media_id} className="group" style={{ borderTop: '1px solid rgb(var(--color-overlay-rgb) / 0.04)' }}>
                        <td className={`sticky left-0 z-10 px-2 py-1 text-text-secondary max-w-[190px] ${gs ? 'adg-name' : ''}`}
                          style={{ backgroundColor: 'var(--color-bg-level-1)', ...(gs || {}) }}>
                          <div className="flex items-center gap-1">
                            <span className="truncate" title={`${r.group_name || ''} · ${r.name}${r.memo ? ` · ${r.memo}` : ''}`}>{r.name}</span>
                            {r.auto && <span className="shrink-0 px-1 rounded text-[8px] font-bold bg-green/15 text-green">자동</span>}
                            {!r.auto && (
                              <button
                                onClick={() => {
                                  if (window.confirm(`'${r.name}' 매체를 제거할까요?\n기입 이력이 있으면 삭제 대신 비활성화되어 과거 데이터는 보존됩니다.`)) {
                                    deleteMut.mutate(r.media_id);
                                  }
                                }}
                                title="매체 제거 (이력 있으면 비활성화)"
                                className="shrink-0 p-0.5 rounded text-text-quaternary opacity-0 group-hover:opacity-100 hover:text-red transition-opacity"
                              >
                                <Trash2 size={11} />
                              </button>
                            )}
                          </div>
                        </td>
                        {dates.map((d) => {
                          const v = r.daily[d];
                          const isEditing = editCell?.mediaId === r.media_id && editCell?.date === d;
                          return (
                            <td key={d} className="p-0 text-right">
                              {isEditing ? (
                                <input
                                  autoFocus
                                  defaultValue={v ? String(Math.round(v)) : ''}
                                  onChange={(e) => setCellValue(e.target.value)}
                                  onBlur={commitCell}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') commitCell();
                                    if (e.key === 'Escape') setEditCell(null);
                                  }}
                                  className="w-[72px] px-1 py-1 text-right text-[11px] tabular-nums bg-bg-2 border border-brand outline-none"
                                />
                              ) : (
                                <button
                                  disabled={r.auto}
                                  onClick={() => { setCellValue(v ? String(Math.round(v)) : ''); setEditCell({ mediaId: r.media_id, date: d }); }}
                                  className={`w-full px-1 py-1 text-right tabular-nums ${
                                    r.auto ? 'text-text-tertiary cursor-default' : 'text-text-secondary hover:bg-[rgb(var(--color-overlay-rgb)/0.07)] cursor-pointer'
                                  } ${d === todayIso ? 'bg-brand/5' : ''}`}
                                >
                                  {k(v) || '·'}
                                </button>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-2 py-1 text-right font-medium text-text-primary tabular-nums" style={stickyR(R_TOTAL, COL_TOTAL, 'var(--color-bg-level-1)', 10, true)}>{k(r.month_total) || '0'}</td>
                        <td className="p-0 text-right" style={stickyR(R_LIMIT, COL_LIMIT, 'var(--color-bg-level-1)')}>
                          {editLimit === r.media_id ? (
                            <input
                              autoFocus
                              defaultValue={r.limit_amount ? String(Math.round(r.limit_amount)) : ''}
                              onChange={(e) => setCellValue(e.target.value)}
                              onBlur={() => {
                                const num = Number(cellValue.replace(/,/g, '').trim() || '0');
                                if (!Number.isNaN(num) && num >= 0) limitMut.mutate({ mediaId: r.media_id, limit: num });
                                setEditLimit(null);
                              }}
                              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditLimit(null); }}
                              className="w-[90px] px-1 py-1 text-right text-[11px] tabular-nums bg-bg-2 border border-brand outline-none"
                            />
                          ) : (
                            <button
                              onClick={() => { setCellValue(r.limit_amount ? String(Math.round(r.limit_amount)) : ''); setEditLimit(r.media_id); }}
                              className="w-full px-2 py-1 text-right tabular-nums text-text-quaternary hover:text-text-primary hover:bg-[rgb(var(--color-overlay-rgb)/0.07)]"
                            >{k(r.limit_amount) || '설정'}</button>
                          )}
                        </td>
                        <td className={`px-2 py-1 text-right tabular-nums font-medium ${
                          r.usage_pct == null ? 'text-text-quaternary' :
                          r.usage_pct > 100 ? 'text-red' : r.usage_pct > 90 ? 'text-yellow' : 'text-green'
                        }`} style={stickyR(R_PCT, COL_PCT, 'var(--color-bg-level-1)')}>{r.usage_pct != null ? `${Math.round(r.usage_pct)}%` : '-'}</td>
                        <td className="p-0" style={stickyR(R_NOTE, COL_NOTE, 'var(--color-bg-level-1)')}>
                          {editNote === r.media_id ? (
                            <input
                              autoFocus
                              defaultValue={r.note || ''}
                              onChange={(e) => setCellValue(e.target.value)}
                              onBlur={() => { noteMut.mutate({ mediaId: r.media_id, note: cellValue.trim() }); setEditNote(null); }}
                              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditNote(null); }}
                              className="w-[140px] px-1.5 py-1 text-[11px] bg-bg-2 border border-brand outline-none"
                            />
                          ) : (
                            <button
                              onClick={() => { setCellValue(r.note || ''); setEditNote(r.media_id); }}
                              className="w-full max-w-[160px] px-1.5 py-1 text-left truncate text-text-tertiary hover:text-text-primary hover:bg-[rgb(var(--color-overlay-rgb)/0.07)]"
                              title={r.note || '비고 입력'}
                            >{r.note || '·'}</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                  );
                })}
              </tbody>
              <tfoot className="sticky bottom-0" style={{ backgroundColor: 'var(--color-bg-level-2)' }}>
                <tr style={{ borderTop: '2px solid var(--color-border-primary)' }}>
                  <td className="sticky left-0 px-2 py-1.5 font-bold text-text-primary" style={{ backgroundColor: 'var(--color-bg-level-2)' }}>일별 합계{isFiltered ? ' (필터)' : ''}</td>
                  {dates.map((d) => (
                    <td key={d} className="px-1 py-1.5 text-right font-medium text-text-secondary tabular-nums">{k(view?.dayTotals[d])}</td>
                  ))}
                  <td className="px-2 py-1.5 text-right font-bold text-text-primary tabular-nums" style={stickyR(R_TOTAL, COL_TOTAL, 'var(--color-bg-level-2)', 20, true)}>{k(view?.spend)}</td>
                  <td className="px-2 py-1.5 text-right text-text-quaternary tabular-nums" style={stickyR(R_LIMIT, COL_LIMIT, 'var(--color-bg-level-2)', 20)}>{k(view?.limit)}</td>
                  <td className="px-2 py-1.5 text-right text-text-quaternary tabular-nums" style={stickyR(R_PCT, COL_PCT, 'var(--color-bg-level-2)', 20)}>{view?.usage_pct != null ? `${view.usage_pct}%` : ''}</td>
                  <td style={stickyR(R_NOTE, COL_NOTE, 'var(--color-bg-level-2)', 20)} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {addMediaGroup !== null && (
        <AddMediaModal
          groups={board?.groups?.length ? board.groups : inflowOptions.filter((o) => o !== '기타').map((name) => ({ name, sort_order: null, color: null, owner: null }))}
          rows={board?.rows || []}
          initialInflow={addMediaGroup}
          onClose={() => setAddMediaGroup(null)}
          onSaved={() => { setAddMediaGroup(null); invalidate(); }}
        />
      )}
    </div>
  );
}

const inputCls = 'px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary';

/** 칩 하나 — 선택 시 그룹 색(시트 색) 하이라이트 */
function Chip({ label, color, on, onClick }: { label: string; color?: string | null; on: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] border transition-colors ${
        on ? (color ? 'adg-chip-on font-semibold' : 'font-semibold text-white') : 'text-text-secondary border-border-primary hover:text-text-primary'
      }`}
      style={{
        ...(color ? ({ '--gc': color } as CSSProperties) : {}),
        ...(on && !color ? { backgroundColor: 'var(--color-brand-bg)', borderColor: 'var(--color-brand-bg)' } : {}),
      }}>
      {color && <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: color }} />}
      {label}
    </button>
  );
}

function AddMediaModal({ groups, rows, initialInflow, onClose, onSaved }: {
  groups: AdMediaGroup[]; rows: AdMediaRow[]; initialInflow: string;
  onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({ name: '', inflow: initialInflow, group_name: '', memo: '' });
  const [newInflow, setNewInflow] = useState(false); // 새 그룹 직접 입력 모드
  const isExisting = groups.some((g) => g.name === form.inflow);
  // 선택한 판매채널에서 쓰는 광고분류 (칩 제안)
  const cats = useMemo(
    () => Array.from(new Set(rows.filter((r) => (r.inflow || '') === form.inflow).map((r) => r.group_name).filter(Boolean))) as string[],
    [rows, form.inflow],
  );
  const mut = useMutation({
    mutationFn: () => adspendApi.createMedia({
      name: form.name.trim(), inflow: form.inflow.trim() || undefined,
      group_name: form.group_name.trim() || undefined, memo: form.memo.trim() || undefined,
    }),
    onSuccess: () => {
      toast.success(form.inflow.trim() ? `'${form.inflow.trim()}' 그룹 맨 아래에 추가했습니다` : '매체를 추가했습니다');
      onSaved();
    },
    onError: () => toast.error('추가 실패'),
  });
  const submit = () => {
    if (!form.name.trim()) { toast.error('매체명을 입력해 주세요'); return; }
    if (!form.inflow.trim()) { toast.error('그룹(판매채널)을 선택하거나 입력해 주세요'); return; }
    mut.mutate();
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl p-5 max-h-[90vh] overflow-y-auto" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-text-primary">매체 추가</h3>
          <button onClick={onClose} className="p-1 text-text-tertiary hover:text-text-primary"><X size={16} /></button>
        </div>
        <div className="space-y-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] text-text-tertiary">
              그룹 (판매채널) * <span className="text-text-quaternary">— 클릭하면 그 그룹 맨 아래에 추가됩니다</span>
            </span>
            <div className="flex flex-wrap gap-1.5">
              {groups.map((g) => (
                <Chip key={g.name} label={g.name} color={g.color}
                  on={!newInflow && form.inflow === g.name}
                  onClick={() => { setNewInflow(false); setForm((v) => ({ ...v, inflow: g.name, group_name: '' })); }} />
              ))}
              <Chip label="+ 새 그룹" on={newInflow || (!!form.inflow && !isExisting)}
                onClick={() => { setNewInflow(true); setForm((v) => ({ ...v, inflow: isExisting ? '' : v.inflow, group_name: '' })); }} />
            </div>
            {(newInflow || (!!form.inflow && !isExisting)) && (
              <input autoFocus value={form.inflow}
                onChange={(e) => setForm((v) => ({ ...v, inflow: e.target.value }))}
                placeholder="새 그룹명 (예: 신규 채널명) — 보드 맨 아래에 새 그룹으로 생깁니다"
                className={inputCls} />
            )}
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-text-tertiary">매체명 *</span>
            <input autoFocus={!!initialInflow} value={form.name}
              onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              placeholder="예: 자사몰 토스 쿠폰광고" className={inputCls} />
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-text-tertiary">광고분류 (선택)</span>
            {cats.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {cats.map((c) => (
                  <Chip key={c} label={c} on={form.group_name === c}
                    onClick={() => setForm((v) => ({ ...v, group_name: v.group_name === c ? '' : c }))} />
                ))}
              </div>
            )}
            <input value={form.group_name}
              onChange={(e) => setForm((v) => ({ ...v, group_name: e.target.value }))}
              placeholder="예: 메타, 네이버, CRM, 바이럴" className={inputCls} />
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-text-tertiary">메모</span>
            <input value={form.memo} onChange={(e) => setForm((v) => ({ ...v, memo: e.target.value }))} className={inputCls} />
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs text-text-tertiary border border-border-primary">취소</button>
          <button
            onClick={submit}
            disabled={mut.isPending}
            className="px-4 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-brand-bg)' }}
          >추가</button>
        </div>
      </div>
    </div>
  );
}
