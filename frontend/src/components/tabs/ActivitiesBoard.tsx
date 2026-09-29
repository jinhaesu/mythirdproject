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
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  activitiesApi, type MarketingActivityRow, type MarketingActivityInput, formatNumber,
} from '@/lib/api';
import { fmtWon, fmtNum, LINE_PALETTE } from '@/components/tabs/kpi/format';

const TYPE_LABELS: Record<string, string> = {
  content: '콘텐츠',
  influencer: '인플루언서',
  experience: '체험단',
  supporters: '서포터즈',
  etc: '기타',
};

const EMPTY_FORM: MarketingActivityInput = {
  activity_type: 'content',
  product: '', product_category: '', channel: '', purpose: '', status: '',
  period_month: new Date().toISOString().slice(0, 7),
  activity_date: null,
  quantity: 1, views: 0, reach: 0, likes: 0, comments: 0, saves: 0, shares: 0, follows: 0,
  cost: 0, notes: '',
};

export function ActivitiesBoard() {
  const qc = useQueryClient();
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [monthFrom, setMonthFrom] = useState<string>(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 11);
    return d.toISOString().slice(0, 7);
  });
  const [monthTo, setMonthTo] = useState<string>(new Date().toISOString().slice(0, 7));
  const [channelFilter, setChannelFilter] = useState('');
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<MarketingActivityRow | 'new' | null>(null);
  const PAGE = 50;

  const listParams = {
    activity_type: typeFilter || undefined,
    month_from: monthFrom || undefined,
    month_to: monthTo || undefined,
    channel: channelFilter || undefined,
    limit: PAGE, offset: page * PAGE,
  };
  const { data: list, isLoading } = useQuery({
    queryKey: ['activities', 'list', listParams],
    queryFn: () => activitiesApi.list(listParams),
  });
  const { data: summary } = useQuery({
    queryKey: ['activities', 'summary', typeFilter, monthFrom, monthTo],
    queryFn: () => activitiesApi.summary({
      activity_type: typeFilter || undefined,
      month_from: monthFrom || undefined,
      month_to: monthTo || undefined,
    }),
  });
  const { data: meta } = useQuery({ queryKey: ['activities', 'meta'], queryFn: activitiesApi.meta });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['activities'] });

  const removeMut = useMutation({
    mutationFn: activitiesApi.remove,
    onSuccess: () => { toast.success('삭제했습니다'); invalidate(); },
    onError: () => toast.error('삭제 실패'),
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
        <div className="flex items-center rounded-lg p-0.5" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.05)' }}>
          {['', 'content', 'influencer', 'experience', 'supporters', 'etc'].map((t) => (
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
          className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary"
        >
          <option value="">채널 전체</option>
          {(meta?.channels || []).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="flex-1" />
        <button
          onClick={() => setEditing('new')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--color-brand-bg)' }}
        >
          <Plus size={14} /> 기록 추가
        </button>
      </div>

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
          <h3 className="text-sm font-semibold text-text-primary mb-3">월별 채널별 조회수</h3>
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
          <h3 className="text-sm font-semibold text-text-primary mb-3">제품별 조회수 Top 10</h3>
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

      {/* 기록 테이블 */}
      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                {['월', '유형', '제품', '채널', '목적', '수량', '조회수', '비용', '뷰당 비용', ''].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-left font-medium text-text-tertiary whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-text-tertiary">불러오는 중...</td></tr>
              ) : (list?.items || []).length === 0 ? (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-text-tertiary">
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
                    <td className="px-3 py-2 text-text-primary max-w-[180px] truncate" title={row.product || ''}>{row.product || '-'}</td>
                    <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{row.channel || '-'}</td>
                    <td className="px-3 py-2 text-text-tertiary whitespace-nowrap">{row.purpose || '-'}</td>
                    <td className="px-3 py-2 text-text-secondary tabular-nums text-right">{fmtNum(row.quantity)}</td>
                    <td className="px-3 py-2 text-text-primary tabular-nums text-right">{fmtNum(row.views)}</td>
                    <td className="px-3 py-2 text-text-secondary tabular-nums text-right">{fmtWon(row.cost)}</td>
                    <td className="px-3 py-2 text-text-tertiary tabular-nums text-right">{row.cost_per_view != null ? `₩${row.cost_per_view}` : '-'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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

function ActivityFormModal({
  initial, meta, onClose, onSaved,
}: {
  initial: MarketingActivityRow | null;
  meta?: { channels: string[]; products: string[]; product_categories: string[]; purposes: string[] };
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

  const set = (k: keyof MarketingActivityInput, v: any) => setForm((f) => ({ ...f, [k]: v }));
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
