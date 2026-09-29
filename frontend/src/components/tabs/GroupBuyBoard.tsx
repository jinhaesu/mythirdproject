'use client';

/**
 * 공구 보드 — 공구(행사)를 카드로 등록하고, 대학별 캠페인·링크·쿠폰·매출을
 * 한 화면에서 묶어 보는 운영 화면 (2단계 개편의 핵심).
 *
 * 매출은 확정 귀속만 집계 (정산 기준과 동일). 상품을 대학 수만큼 만들 필요
 * 없이 상품 1개 + 대학별 캠페인 링크/쿠폰으로 구분 집계된다.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ResponsiveContainer, ComposedChart, Bar, XAxis, YAxis, Tooltip,
} from 'recharts';
import {
  Plus, X, ArrowLeft, Link2, Copy, Trash2, Pencil, Search, CalendarRange,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { groupbuysApi, type GroupBuyInput } from '@/lib/api';
import { fmtWon, fmtNum } from '@/components/tabs/kpi/format';

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  planned: { label: '준비 중', cls: 'bg-yellow/15 text-yellow' },
  active: { label: '진행 중', cls: 'bg-green/15 text-green' },
  done: { label: '종료', cls: 'bg-border-primary text-text-tertiary' },
};

export function GroupBuyBoard() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const qc = useQueryClient();

  const { data: list, isLoading } = useQuery({
    queryKey: ['groupbuys', 'list'],
    queryFn: groupbuysApi.list,
  });

  if (selectedId !== null) {
    return (
      <GroupBuyDetail
        id={selectedId}
        onBack={() => { setSelectedId(null); qc.invalidateQueries({ queryKey: ['groupbuys', 'list'] }); }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-text-primary">공구 보드</h2>
          <p className="text-xs text-text-tertiary mt-0.5">
            공구를 등록하고 대학별 캠페인을 묶으면 링크·쿠폰·확정 매출이 자동으로 모입니다
          </p>
        </div>
        <button
          onClick={() => setEditing('new')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white hover:opacity-90"
          style={{ backgroundColor: 'var(--color-brand-bg)' }}
        >
          <Plus size={14} /> 새 공구
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-brand border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (list || []).length === 0 ? (
        <div
          className="rounded-xl py-16 text-center"
          style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px dashed var(--color-border-primary)' }}
        >
          <p className="text-sm text-text-tertiary">아직 공구가 없습니다</p>
          <p className="text-xs text-text-quaternary mt-1">&quot;새 공구&quot;로 10월 공구를 등록해 보세요</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {list!.map((gb: any) => {
            const st = STATUS_LABELS[gb.status] || STATUS_LABELS.planned;
            return (
              <button
                key={gb.id}
                onClick={() => setSelectedId(gb.id)}
                className="text-left rounded-xl p-4 transition-colors hover:border-brand/50"
                style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-text-primary leading-snug">{gb.name}</h3>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium ${st.cls}`}>{st.label}</span>
                </div>
                <p className="flex items-center gap-1 text-[11px] text-text-quaternary mt-1.5">
                  <CalendarRange size={11} />
                  {gb.start_date || '?'} ~ {gb.end_date || '?'} · 캠페인 {gb.campaign_count}개
                </p>
                <div className="mt-3 flex items-end justify-between">
                  <div>
                    <p className="text-[10px] text-text-quaternary">확정 매출</p>
                    <p className="text-lg font-bold text-text-primary tabular-nums">{fmtWon(gb.confirmed_revenue)}</p>
                    <p className="text-[10px] text-text-quaternary">{fmtNum(gb.confirmed_orders)}건 · 클릭 {fmtNum(gb.clicks)}</p>
                  </div>
                  {gb.target_revenue ? (
                    <div className="text-right">
                      <p className="text-[10px] text-text-quaternary">목표 {fmtWon(gb.target_revenue)}</p>
                      <p className={`text-sm font-semibold tabular-nums ${
                        (gb.progress_pct ?? 0) >= 100 ? 'text-green' : 'text-text-secondary'
                      }`}>{gb.progress_pct ?? 0}%</p>
                    </div>
                  ) : null}
                </div>
                {gb.target_revenue ? (
                  <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.07)' }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, gb.progress_pct ?? 0)}%`,
                        backgroundColor: (gb.progress_pct ?? 0) >= 100 ? '#27A644' : 'var(--color-brand-bg)',
                      }}
                    />
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {editing && (
        <GroupBuyFormModal
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(gb) => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ['groupbuys'] });
            if (gb?.id) setSelectedId(gb.id);
          }}
        />
      )}
    </div>
  );
}

// ─── 상세 ────────────────────────────────────────────────────────────────────

function GroupBuyDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [showAttach, setShowAttach] = useState(false);

  const { data: gb, isLoading } = useQuery({
    queryKey: ['groupbuys', 'detail', id],
    queryFn: () => groupbuysApi.detail(id),
  });

  const detachMut = useMutation({
    mutationFn: (cid: number) => groupbuysApi.detachCampaign(id, cid),
    onSuccess: () => { toast.success('캠페인을 뺐습니다'); qc.invalidateQueries({ queryKey: ['groupbuys'] }); },
  });
  const removeMut = useMutation({
    mutationFn: () => groupbuysApi.remove(id),
    onSuccess: () => { toast.success('공구를 삭제했습니다'); onBack(); },
  });

  if (isLoading || !gb) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-7 h-7 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const st = STATUS_LABELS[gb.status] || STATUS_LABELS.planned;
  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success(`${label} 복사됨`),
      () => toast.error('복사 실패'),
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary border border-border-primary">
            <ArrowLeft size={14} />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-text-primary">{gb.name}</h2>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${st.cls}`}>{st.label}</span>
            </div>
            <p className="text-[11px] text-text-quaternary mt-0.5">
              {gb.start_date || '?'} ~ {gb.end_date || '?'}{gb.description ? ` · ${gb.description}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setEditing(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-text-secondary border border-border-primary hover:text-text-primary">
            <Pencil size={12} /> 수정
          </button>
          <button
            onClick={() => { if (confirm('이 공구를 삭제할까요? (캠페인 자체는 삭제되지 않습니다)')) removeMut.mutate(); }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-red border border-red/30 hover:bg-red/10">
            <Trash2 size={12} /> 삭제
          </button>
        </div>
      </div>

      {/* 합계 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: '확정 매출', value: fmtWon(gb.totals.confirmed_revenue), extra: gb.target_revenue ? `목표 ${fmtWon(gb.target_revenue)} · ${gb.totals.progress_pct ?? 0}%` : undefined },
          { label: '확정 주문', value: `${fmtNum(gb.totals.confirmed_orders)}건` },
          { label: '클릭', value: fmtNum(gb.totals.clicks) },
          { label: '캠페인(대학)', value: `${gb.campaigns.length}개` },
        ].map((c) => (
          <div key={c.label} className="rounded-xl p-3.5" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
            <p className="text-[11px] text-text-tertiary">{c.label}</p>
            <p className="text-xl font-bold text-text-primary tabular-nums mt-0.5">{c.value}</p>
            {c.extra && <p className="text-[10px] text-text-quaternary mt-0.5">{c.extra}</p>}
          </div>
        ))}
      </div>

      {/* 일별 확정 매출 */}
      {gb.daily.length > 0 && (
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
          <h3 className="text-sm font-semibold text-text-primary mb-2">일별 확정 매출</h3>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={gb.daily.map((d: any) => ({ ...d, label: d.date.slice(5) }))} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--color-text-quaternary)' }} tickLine={false} axisLine={false} />
                <YAxis hide />
                <Tooltip
                  contentStyle={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)', borderRadius: 8, fontSize: 11 }}
                  formatter={(v: any, name: any) => (name === '매출' ? [fmtWon(v), name] : [v, name])}
                />
                <Bar dataKey="revenue" name="매출" fill="#4EA7FC" radius={[3, 3, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* 캠페인(대학) 테이블 */}
      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
          <h3 className="text-sm font-semibold text-text-primary">캠페인별 실적 (확정 귀속)</h3>
          <button onClick={() => setShowAttach(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-white hover:opacity-90"
            style={{ backgroundColor: 'var(--color-brand-bg)' }}>
            <Plus size={12} /> 캠페인 연결
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                {['캠페인', '클릭', '확정 주문', '확정 매출', '추적 링크', '쿠폰', ''].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-left font-medium text-text-tertiary whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gb.campaigns.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-text-tertiary">
                  연결된 캠페인이 없습니다 — &quot;캠페인 연결&quot;로 대학 캠페인을 추가하세요
                </td></tr>
              ) : gb.campaigns.map((c: any) => (
                <tr key={c.id} className="group" style={{ borderBottom: '1px solid rgb(var(--color-overlay-rgb) / 0.04)' }}>
                  <td className="px-3 py-2 text-text-primary max-w-[220px] truncate" title={c.name}>{c.name}</td>
                  <td className="px-3 py-2 text-text-secondary tabular-nums text-right">{fmtNum(c.clicks)}</td>
                  <td className="px-3 py-2 text-text-secondary tabular-nums text-right">{fmtNum(c.confirmed_orders)}</td>
                  <td className="px-3 py-2 text-text-primary font-medium tabular-nums text-right">{fmtWon(c.confirmed_revenue)}</td>
                  <td className="px-3 py-2">
                    {c.tracking_link ? (
                      <button onClick={() => copy(c.tracking_link, '추적 링크')}
                        className="flex items-center gap-1 text-text-tertiary hover:text-text-primary">
                        <Link2 size={12} /> <span className="text-[11px]">복사</span>
                      </button>
                    ) : <span className="text-text-quaternary">-</span>}
                  </td>
                  <td className="px-3 py-2">
                    {c.coupon_code ? (
                      <button onClick={() => copy(c.coupon_code, '쿠폰 코드')}
                        className="flex items-center gap-1 text-green hover:opacity-80">
                        <Copy size={11} /> <span className="text-[11px] font-mono">{c.coupon_code}</span>
                      </button>
                    ) : <span className="text-[11px] text-yellow">미연결</span>}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => { if (confirm(`"${c.name}"을(를) 이 공구에서 뺄까요?`)) detachMut.mutate(c.id); }}
                      className="p-1 text-text-quaternary hover:text-red opacity-0 group-hover:opacity-100 transition-opacity"
                      title="공구에서 제외"
                    ><X size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {gb.campaigns.some((c: any) => !c.coupon_code) && (
          <p className="px-4 py-2.5 text-[11px] text-yellow" style={{ borderTop: '1px solid var(--color-border-primary)' }}>
            쿠폰 미연결 캠페인이 있습니다 — 전용 쿠폰은 추적 스크립트와 무관하게 100% 확정 귀속되는 이중 안전망입니다.
            (카페24에서 쿠폰 발급 → 파트너 관리 → 캠페인에 코드 연결)
          </p>
        )}
      </div>

      {/* 상위 파트너 */}
      {gb.top_partners.length > 0 && (
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
          <h3 className="text-sm font-semibold text-text-primary mb-2">상위 파트너 (확정 매출)</h3>
          <div className="space-y-1">
            {gb.top_partners.map((p: any, i: number) => (
              <div key={p.id} className="flex items-center gap-2 text-xs">
                <span className="text-[10px] text-text-quaternary w-4 text-right">{i + 1}</span>
                <span className="text-text-secondary flex-1 truncate">{p.name}</span>
                <span className="text-text-tertiary tabular-nums">{fmtNum(p.orders)}건</span>
                <span className="text-text-primary font-medium tabular-nums w-24 text-right">{fmtWon(p.revenue)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {gb.memo && (
        <div className="rounded-xl p-4 text-xs text-text-secondary whitespace-pre-wrap"
          style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
          {gb.memo}
        </div>
      )}

      {editing && (
        <GroupBuyFormModal
          initial={gb}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); qc.invalidateQueries({ queryKey: ['groupbuys'] }); }}
        />
      )}
      {showAttach && (
        <AttachCampaignsModal
          groupBuyId={id}
          onClose={() => setShowAttach(false)}
          onAttached={() => { qc.invalidateQueries({ queryKey: ['groupbuys'] }); }}
        />
      )}
    </div>
  );
}

// ─── 생성/수정 모달 ──────────────────────────────────────────────────────────

function GroupBuyFormModal({
  initial, onClose, onSaved,
}: { initial: any | null; onClose: () => void; onSaved: (gb?: any) => void }) {
  const [form, setForm] = useState<GroupBuyInput>(() => initial ? {
    name: initial.name, description: initial.description || '', status: initial.status,
    start_date: initial.start_date, end_date: initial.end_date,
    target_revenue: initial.target_revenue, memo: initial.memo || '',
  } : { name: '', description: '', status: 'planned', start_date: null, end_date: null, target_revenue: null, memo: '' });

  const saveMut = useMutation({
    mutationFn: (payload: GroupBuyInput) =>
      initial ? groupbuysApi.update(initial.id, payload) : groupbuysApi.create(payload),
    onSuccess: (gb) => { toast.success(initial ? '수정했습니다' : '공구를 만들었습니다'); onSaved(gb); },
    onError: () => toast.error('저장 실패'),
  });

  const set = (k: keyof GroupBuyInput, v: any) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl p-5" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-text-primary">{initial ? '공구 수정' : '새 공구'}</h3>
          <button onClick={onClose} className="p-1 text-text-tertiary hover:text-text-primary"><X size={16} /></button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 col-span-2">
            <span className="text-[11px] text-text-tertiary">공구 이름 *</span>
            <input value={form.name} onChange={(e) => set('name', e.target.value)}
              placeholder="예: 2026 10월 총학생회 연합 공구"
              className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-text-tertiary">상태</span>
            <select value={form.status} onChange={(e) => set('status', e.target.value)}
              className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary">
              <option value="planned">준비 중</option>
              <option value="active">진행 중</option>
              <option value="done">종료</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-text-tertiary">매출 목표 (₩)</span>
            <input type="number" value={form.target_revenue ?? ''} onChange={(e) => set('target_revenue', e.target.value ? Number(e.target.value) : null)}
              className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary tabular-nums" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-text-tertiary">시작일</span>
            <input type="date" value={form.start_date || ''} onChange={(e) => set('start_date', e.target.value || null)}
              className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-text-tertiary">종료일</span>
            <input type="date" value={form.end_date || ''} onChange={(e) => set('end_date', e.target.value || null)}
              className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary" />
          </label>
          <label className="flex flex-col gap-1 col-span-2">
            <span className="text-[11px] text-text-tertiary">설명</span>
            <input value={form.description || ''} onChange={(e) => set('description', e.target.value)}
              className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary" />
          </label>
          <label className="flex flex-col gap-1 col-span-2">
            <span className="text-[11px] text-text-tertiary">메모</span>
            <textarea value={form.memo || ''} onChange={(e) => set('memo', e.target.value)} rows={3}
              className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary resize-y" />
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs text-text-tertiary hover:text-text-primary border border-border-primary">취소</button>
          <button
            onClick={() => {
              if (!form.name.trim()) { toast.error('공구 이름을 입력해 주세요'); return; }
              saveMut.mutate(form);
            }}
            disabled={saveMut.isPending}
            className="px-4 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-brand-bg)' }}
          >{saveMut.isPending ? '저장 중...' : '저장'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── 캠페인 연결 모달 ────────────────────────────────────────────────────────

function AttachCampaignsModal({
  groupBuyId, onClose, onAttached,
}: { groupBuyId: number; onClose: () => void; onAttached: () => void }) {
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const { data: candidates, isFetching } = useQuery({
    queryKey: ['groupbuys', 'candidates', groupBuyId, q],
    queryFn: () => groupbuysApi.candidates(q, groupBuyId),
  });

  const attachMut = useMutation({
    mutationFn: () => groupbuysApi.attachCampaigns(groupBuyId, Array.from(selected)),
    onSuccess: (r) => { toast.success(`${r.added}개 캠페인을 연결했습니다`); onAttached(); onClose(); },
    onError: () => toast.error('연결 실패'),
  });

  const toggle = (id: number) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) { n.delete(id); } else { n.add(id); }
    return n;
  });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div className="w-full max-w-md max-h-[80vh] flex flex-col rounded-xl p-5" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-text-primary">캠페인 연결</h3>
          <button onClick={onClose} className="p-1 text-text-tertiary hover:text-text-primary"><X size={16} /></button>
        </div>
        <div className="relative mb-3">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-quaternary" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="캠페인명 검색 (예: 대학교)"
            className="w-full pl-8 pr-2 py-2 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary"
          />
        </div>
        <div className="flex-1 overflow-y-auto space-y-1 min-h-[200px]">
          {isFetching ? (
            <p className="text-xs text-text-quaternary text-center py-6">검색 중...</p>
          ) : (candidates || []).length === 0 ? (
            <p className="text-xs text-text-quaternary text-center py-6">연결 가능한 캠페인이 없습니다</p>
          ) : candidates!.map((c) => (
            <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-[rgb(var(--color-overlay-rgb)/0.05)]">
              <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="accent-[var(--color-brand-bg)]" />
              <span className="text-xs text-text-secondary flex-1 truncate">{c.name}</span>
              <span className="text-[10px] text-text-quaternary">{c.status}</span>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs text-text-tertiary border border-border-primary">취소</button>
          <button
            onClick={() => attachMut.mutate()}
            disabled={selected.size === 0 || attachMut.isPending}
            className="px-4 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-brand-bg)' }}
          >{selected.size}개 연결</button>
        </div>
      </div>
    </div>
  );
}
