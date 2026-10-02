'use client';

/**
 * 협찬 등록·목록 — 외부 협찬(전시/마라톤/대학축제 등) 기록 관리.
 *
 * - 협찬 1건 = 협찬처 + 종류 + 일자 + 품목들(품목·수량·환산금액) + 조건/메모
 * - 행 펼침: 품목 상세 + 결과물(사진/영상/포스팅/보도 등 링크·조회수) 등록
 * - 분석 그래프는 '협찬 분석' 서브탭 (sponsorship/summary)
 */
import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus, X, Download, ChevronDown, ChevronRight, Trash2, Pencil, Link as LinkIcon,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  sponsorshipApi, type SponsorshipRow, type SponsorshipItemRow,
} from '@/lib/api';
import { fmtWon, fmtNum } from '@/components/tabs/kpi/format';

const emptyItem = (): SponsorshipItemRow => ({ product: '', quantity: 0, estimated_value: null, note: '' });

export function SponsorshipBoard() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [typeF, setTypeF] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [editing, setEditing] = useState<SponsorshipRow | 'new' | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['sponsorship', 'events'],
    queryFn: () => sponsorshipApi.list(),
  });
  const { data: meta } = useQuery({
    queryKey: ['sponsorship', 'meta'],
    queryFn: sponsorshipApi.meta,
    staleTime: 5 * 60 * 1000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['sponsorship'] });

  const delMut = useMutation({
    mutationFn: (id: number) => sponsorshipApi.remove(id),
    onSuccess: () => { toast.success('삭제했습니다'); invalidate(); },
    onError: () => toast.error('삭제 실패'),
  });

  const events = useMemo(() => {
    let list = data?.events || [];
    if (typeF) list = list.filter((e) => (e.event_type_label || e.event_type) === typeF);
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      list = list.filter((e) =>
        e.target_name.toLowerCase().includes(needle)
        || (e.product || '').toLowerCase().includes(needle)
        || e.items.some((i) => i.product.toLowerCase().includes(needle)));
    }
    return list;
  }, [data, typeF, q]);

  const typeOptions = useMemo(
    () => Array.from(new Set((data?.events || []).map((e) => e.event_type_label || e.event_type))),
    [data],
  );

  const totals = useMemo(() => ({
    count: events.length,
    quantity: events.reduce((s, e) => s + (e.quantity || 0), 0),
    value: events.reduce((s, e) => s + (e.estimated_value || 0), 0),
    outcomes: events.reduce((s, e) => s + e.outcomes.length, 0),
  }), [events]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h2 className="text-base font-semibold text-text-primary">협찬 등록·목록</h2>
          <p className="text-xs text-text-tertiary mt-0.5">
            외부 협찬 내역을 종류·품목·수량으로 기록하고, 행을 펼쳐 결과물(사진·영상·포스팅)을 등록합니다
          </p>
        </div>
        <div className="flex-1" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="협찬처·품목 검색"
          className="px-2.5 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary w-44" />
        <select value={typeF} onChange={(e) => setTypeF(e.target.value)}
          className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary">
          <option value="">종류 전체</option>
          {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button
          onClick={async () => {
            try { await sponsorshipApi.exportXlsx(); toast.success('엑셀 다운로드 시작'); }
            catch { toast.error('다운로드 실패'); }
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-text-secondary border border-border-primary hover:text-text-primary">
          <Download size={13} /> 엑셀
        </button>
        <button onClick={() => setEditing('new')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white hover:opacity-90"
          style={{ backgroundColor: 'var(--color-brand-bg)' }}>
          <Plus size={13} /> 협찬 등록
        </button>
      </div>

      {/* 요약 */}
      <div className="flex flex-wrap gap-3">
        {[
          { label: '협찬 건수', value: `${fmtNum(totals.count)}건` },
          { label: '품목 수량 합계', value: `${fmtNum(totals.quantity)}개` },
          { label: '환산 금액 합계', value: fmtWon(totals.value) },
          { label: '등록된 결과물', value: `${fmtNum(totals.outcomes)}건` },
        ].map((c) => (
          <div key={c.label} className="rounded-xl px-4 py-2.5" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
            <p className="text-[10px] text-text-quaternary">{c.label}</p>
            <p className="text-base font-bold tabular-nums text-text-primary">{c.value}</p>
          </div>
        ))}
      </div>

      {/* 목록 */}
      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                {['', '일자', '협찬처', '종류', '품목', '수량', '환산금액', '결과물', ''].map((h, i) => (
                  <th key={i} className="px-3 py-2.5 text-left font-medium text-text-tertiary whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-text-tertiary">불러오는 중...</td></tr>
              ) : events.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-text-tertiary">
                  등록된 협찬이 없습니다 — 우측 상단 &apos;협찬 등록&apos;으로 시작하세요
                </td></tr>
              ) : events.map((e) => (
                <Fragment key={e.id}>
                  <tr className="cursor-pointer hover:bg-[rgb(var(--color-overlay-rgb)/0.04)]"
                    style={{ borderBottom: '1px solid rgb(var(--color-overlay-rgb) / 0.04)' }}
                    onClick={() => setOpenId(openId === e.id ? null : e.id)}>
                    <td className="pl-3 py-2 text-text-quaternary w-6">
                      {openId === e.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </td>
                    <td className="px-3 py-2 text-text-tertiary whitespace-nowrap tabular-nums">{e.sponsored_at || '-'}</td>
                    <td className="px-3 py-2 text-text-primary font-medium">{e.target_name}</td>
                    <td className="px-3 py-2">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.08)', color: 'var(--color-text-secondary)' }}>
                        {e.event_type_label || e.event_type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-text-secondary max-w-[220px] truncate" title={e.items.map((i) => `${i.product} ${i.quantity}개`).join(', ')}>
                      {e.product}
                    </td>
                    <td className="px-3 py-2 text-text-primary tabular-nums text-right">{fmtNum(e.quantity)}</td>
                    <td className="px-3 py-2 text-text-primary tabular-nums text-right">{e.estimated_value != null ? fmtWon(e.estimated_value) : '-'}</td>
                    <td className="px-3 py-2">
                      {e.outcomes.length > 0 ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green/15 text-green">{e.outcomes.length}건</span>
                      ) : (
                        <span className="text-[10px] text-text-quaternary">미등록</span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-right" onClick={(ev) => ev.stopPropagation()}>
                      <button onClick={() => setEditing(e)} className="p-1 text-text-quaternary hover:text-text-primary" title="수정"><Pencil size={13} /></button>
                      <button onClick={() => { if (confirm(`'${e.target_name}' 협찬을 삭제할까요? (품목·결과물 포함)`)) delMut.mutate(e.id); }}
                        className="p-1 text-text-quaternary hover:text-red" title="삭제"><Trash2 size={13} /></button>
                    </td>
                  </tr>
                  {openId === e.id && (
                    <tr style={{ borderBottom: '1px solid rgb(var(--color-overlay-rgb) / 0.04)' }}>
                      <td colSpan={9} className="px-6 py-3" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.03)' }}>
                        <DetailPanel event={e} outcomeKinds={meta?.outcome_kinds || []} onChanged={invalidate} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <EditModal
          event={editing === 'new' ? null : editing}
          eventTypes={meta?.event_types || []}
          products={meta?.products || []}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); invalidate(); }}
        />
      )}
    </div>
  );
}

// ── 상세 패널: 품목 + 결과물 관리 ──────────────────────────────────────────────

function DetailPanel({ event, outcomeKinds, onChanged }: {
  event: SponsorshipRow; outcomeKinds: string[]; onChanged: () => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ kind: '', link: '', views: '', occurred_at: '', note: '' });

  const addMut = useMutation({
    mutationFn: () => sponsorshipApi.addOutcome(event.id, {
      kind: form.kind.trim(), link: form.link.trim() || null,
      views: form.views.trim() ? Number(form.views.replace(/,/g, '')) : null,
      occurred_at: form.occurred_at || null, note: form.note.trim() || null,
    }),
    onSuccess: () => { toast.success('결과물을 등록했습니다'); setShowAdd(false); setForm({ kind: '', link: '', views: '', occurred_at: '', note: '' }); onChanged(); },
    onError: () => toast.error('등록 실패'),
  });
  const delMut = useMutation({
    mutationFn: (id: number) => sponsorshipApi.removeOutcome(id),
    onSuccess: onChanged,
    onError: () => toast.error('삭제 실패'),
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
      {/* 품목 상세 */}
      <div>
        <p className="font-semibold text-text-secondary mb-1.5">품목 ({event.items.length})</p>
        <table className="w-full">
          <thead>
            <tr className="text-[10px] text-text-quaternary">
              <th className="text-left py-1 pr-2 font-medium">품목</th>
              <th className="text-right py-1 px-2 font-medium">수량</th>
              <th className="text-right py-1 px-2 font-medium">환산금액</th>
              <th className="text-left py-1 pl-2 font-medium">비고</th>
            </tr>
          </thead>
          <tbody>
            {event.items.map((i) => (
              <tr key={i.id} style={{ borderTop: '1px solid rgb(var(--color-overlay-rgb) / 0.05)' }}>
                <td className="py-1 pr-2 text-text-primary">{i.product}</td>
                <td className="py-1 px-2 text-right tabular-nums text-text-secondary">{fmtNum(i.quantity)}</td>
                <td className="py-1 px-2 text-right tabular-nums text-text-secondary">{i.estimated_value != null ? fmtWon(i.estimated_value) : '-'}</td>
                <td className="py-1 pl-2 text-text-tertiary">{i.note || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(event.reason || event.conditions || event.expected_effect || event.notes) && (
          <div className="mt-2 space-y-0.5 text-[11px] text-text-tertiary">
            {event.reason && <p>사유: {event.reason}</p>}
            {event.conditions && <p>조건: {event.conditions}</p>}
            {event.expected_effect && <p>기대효과: {event.expected_effect}</p>}
            {event.notes && <p>메모: {event.notes}</p>}
          </div>
        )}
      </div>

      {/* 결과물 */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="font-semibold text-text-secondary">결과물 ({event.outcomes.length})</p>
          <button onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-text-secondary border border-border-primary hover:text-text-primary">
            <Plus size={11} /> 결과물 등록
          </button>
        </div>
        {event.outcomes.length === 0 && !showAdd && (
          <p className="text-[11px] text-text-quaternary py-2">아직 결과물이 없습니다 — 사진·영상·포스팅·보도 링크를 등록해 두세요</p>
        )}
        {event.outcomes.map((o) => (
          <div key={o.id} className="flex items-center gap-2 py-1" style={{ borderTop: '1px solid rgb(var(--color-overlay-rgb) / 0.05)' }}>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.08)', color: 'var(--color-text-secondary)' }}>{o.kind}</span>
            {o.link ? (
              <a href={o.link} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-brand hover:underline truncate max-w-[260px]">
                <LinkIcon size={11} className="shrink-0" /><span className="truncate">{o.link}</span>
              </a>
            ) : <span className="text-text-quaternary text-[11px]">링크 없음</span>}
            {o.views != null && <span className="text-text-tertiary tabular-nums shrink-0">조회 {fmtNum(o.views)}</span>}
            {o.occurred_at && <span className="text-text-quaternary text-[10px] shrink-0">{o.occurred_at}</span>}
            {o.note && <span className="text-text-tertiary truncate">{o.note}</span>}
            <div className="flex-1" />
            <button onClick={() => delMut.mutate(o.id)} className="p-0.5 text-text-quaternary hover:text-red shrink-0" title="삭제"><Trash2 size={12} /></button>
          </div>
        ))}
        {showAdd && (
          <div className="mt-2 p-2.5 rounded-lg space-y-2" style={{ border: '1px solid var(--color-border-primary)' }}>
            <div className="grid grid-cols-2 gap-2">
              <input list="outcome-kinds" value={form.kind} onChange={(e) => setForm((v) => ({ ...v, kind: e.target.value }))}
                placeholder="종류 * (사진, 영상, SNS 포스팅…)" className="px-2 py-1.5 rounded text-[11px] bg-bg-2 border border-border-primary text-text-primary" />
              <datalist id="outcome-kinds">{outcomeKinds.map((k) => <option key={k} value={k} />)}</datalist>
              <input type="date" value={form.occurred_at} onChange={(e) => setForm((v) => ({ ...v, occurred_at: e.target.value }))}
                className="px-2 py-1.5 rounded text-[11px] bg-bg-2 border border-border-primary text-text-primary" />
            </div>
            <input value={form.link} onChange={(e) => setForm((v) => ({ ...v, link: e.target.value }))}
              placeholder="링크 (게시물·기사·드라이브 URL)" className="w-full px-2 py-1.5 rounded text-[11px] bg-bg-2 border border-border-primary text-text-primary" />
            <div className="grid grid-cols-2 gap-2">
              <input value={form.views} onChange={(e) => setForm((v) => ({ ...v, views: e.target.value }))}
                placeholder="조회/노출수" className="px-2 py-1.5 rounded text-[11px] tabular-nums bg-bg-2 border border-border-primary text-text-primary" />
              <input value={form.note} onChange={(e) => setForm((v) => ({ ...v, note: e.target.value }))}
                placeholder="메모" className="px-2 py-1.5 rounded text-[11px] bg-bg-2 border border-border-primary text-text-primary" />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowAdd(false)} className="px-2.5 py-1 rounded text-[11px] text-text-tertiary border border-border-primary">취소</button>
              <button
                onClick={() => { if (!form.kind.trim()) { toast.error('종류를 입력해 주세요'); return; } addMut.mutate(); }}
                disabled={addMut.isPending}
                className="px-3 py-1 rounded text-[11px] font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-brand-bg)' }}>등록</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 등록/수정 모달 ────────────────────────────────────────────────────────────

function EditModal({ event, eventTypes, products, onClose, onSaved }: {
  event: SponsorshipRow | null; eventTypes: string[]; products: string[];
  onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    target_name: event?.target_name || '',
    event_type: event ? (event.event_type_label || event.event_type) : '',
    sponsored_at: event?.sponsored_at || new Date().toISOString().slice(0, 10),
    reason: event?.reason || '',
    expected_effect: event?.expected_effect || '',
    conditions: event?.conditions || '',
    notes: event?.notes || '',
  });
  const [items, setItems] = useState<SponsorshipItemRow[]>(
    event && event.items.length ? event.items.map((i) => ({ ...i })) : [emptyItem()],
  );

  const setItem = (idx: number, patch: Partial<SponsorshipItemRow>) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const mut = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        target_name: form.target_name.trim(),
        event_type: form.event_type.trim(),
        reason: form.reason.trim() || null,
        expected_effect: form.expected_effect.trim() || null,
        conditions: form.conditions.trim() || null,
        notes: form.notes.trim() || null,
        items: items
          .filter((i) => i.product.trim())
          .map((i) => ({
            product: i.product.trim(),
            quantity: Number(i.quantity) || 0,
            estimated_value: i.estimated_value != null && String(i.estimated_value) !== '' ? Number(i.estimated_value) : null,
            note: (i.note || '').trim() || null,
          })),
      };
      return event ? sponsorshipApi.update(event.id, payload) : sponsorshipApi.create(payload);
    },
    onSuccess: () => { toast.success(event ? '수정했습니다' : '협찬을 등록했습니다'); onSaved(); },
    onError: (e: any) => toast.error(e?.response?.data?.detail || '저장 실패'),
  });

  const submit = () => {
    if (!form.target_name.trim()) { toast.error('협찬처를 입력해 주세요'); return; }
    if (!form.event_type.trim()) { toast.error('협찬 종류를 입력해 주세요'); return; }
    if (!items.some((i) => i.product.trim())) { toast.error('품목을 1개 이상 입력해 주세요'); return; }
    mut.mutate();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 overflow-y-auto" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div className="w-full max-w-xl rounded-xl p-5 my-8" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-text-primary">{event ? '협찬 수정' : '협찬 등록'}</h3>
          <button onClick={onClose} className="p-1 text-text-tertiary hover:text-text-primary"><X size={16} /></button>
        </div>

        <div className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 col-span-2">
              <span className="text-[11px] text-text-tertiary">협찬처 (대상명) *</span>
              <input value={form.target_name} onChange={(e) => setForm((v) => ({ ...v, target_name: e.target.value }))}
                placeholder="예: 2026 서울마라톤 조직위, OO대학교 총학생회"
                className="px-2 py-1.5 rounded-lg bg-bg-2 border border-border-primary text-text-primary" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-text-tertiary">협찬 종류 *</span>
              <input list="sponsor-types" value={form.event_type} onChange={(e) => setForm((v) => ({ ...v, event_type: e.target.value }))}
                placeholder="전시, 마라톤, 대학축제…" className="px-2 py-1.5 rounded-lg bg-bg-2 border border-border-primary text-text-primary" />
              <datalist id="sponsor-types">{eventTypes.map((t) => <option key={t} value={t} />)}</datalist>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-text-tertiary">협찬 일자 *</span>
              <input type="date" value={form.sponsored_at} onChange={(e) => setForm((v) => ({ ...v, sponsored_at: e.target.value }))}
                className="px-2 py-1.5 rounded-lg bg-bg-2 border border-border-primary text-text-primary" />
            </label>
          </div>

          {/* 품목 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-text-tertiary">품목·수량 *</span>
              <button onClick={() => setItems((p) => [...p, emptyItem()])}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-text-secondary border border-border-primary hover:text-text-primary">
                <Plus size={11} /> 품목 추가
              </button>
            </div>
            <datalist id="sponsor-products">{products.map((p) => <option key={p} value={p} />)}</datalist>
            <div className="space-y-1.5">
              {items.map((it, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_72px_100px_1fr_24px] gap-1.5 items-center">
                  <input list="sponsor-products" value={it.product} onChange={(e) => setItem(idx, { product: e.target.value })}
                    placeholder="품목명" className="px-2 py-1.5 rounded-lg bg-bg-2 border border-border-primary text-text-primary" />
                  <input value={it.quantity || ''} onChange={(e) => setItem(idx, { quantity: Number(e.target.value.replace(/[^0-9]/g, '')) || 0 })}
                    placeholder="수량" className="px-2 py-1.5 rounded-lg text-right tabular-nums bg-bg-2 border border-border-primary text-text-primary" />
                  <input value={it.estimated_value ?? ''} onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9]/g, '');
                    setItem(idx, { estimated_value: raw === '' ? null : Number(raw) });
                  }}
                    placeholder="환산금액(원)" className="px-2 py-1.5 rounded-lg text-right tabular-nums bg-bg-2 border border-border-primary text-text-primary" />
                  <input value={it.note || ''} onChange={(e) => setItem(idx, { note: e.target.value })}
                    placeholder="비고" className="px-2 py-1.5 rounded-lg bg-bg-2 border border-border-primary text-text-primary" />
                  <button onClick={() => setItems((p) => (p.length > 1 ? p.filter((_, i) => i !== idx) : p))}
                    className="p-1 text-text-quaternary hover:text-red" title="행 삭제"><X size={13} /></button>
                </div>
              ))}
            </div>
          </div>

          {[
            { k: 'conditions', label: '협찬 조건', ph: '예: 부스 로고 노출, SNS 태그 3회 (쉼표 구분)' },
            { k: 'reason', label: '협찬 사유', ph: '' },
            { k: 'expected_effect', label: '기대효과', ph: '' },
            { k: 'notes', label: '메모', ph: '' },
          ].map((f) => (
            <label key={f.k} className="flex flex-col gap-1">
              <span className="text-[11px] text-text-tertiary">{f.label}</span>
              <input value={(form as any)[f.k]} onChange={(e) => setForm((v) => ({ ...v, [f.k]: e.target.value }))}
                placeholder={f.ph} className="px-2 py-1.5 rounded-lg bg-bg-2 border border-border-primary text-text-primary" />
            </label>
          ))}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs text-text-tertiary border border-border-primary">취소</button>
          <button onClick={submit} disabled={mut.isPending}
            className="px-4 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-brand-bg)' }}>
            {event ? '저장' : '등록'}
          </button>
        </div>
      </div>
    </div>
  );
}
