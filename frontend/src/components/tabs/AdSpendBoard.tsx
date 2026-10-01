'use client';

/**
 * 광고비 일보 — 매체별 일별 광고비 기입 그리드 (구글시트 일보의 시스템화).
 *
 * 행 = 매체(유입채널 그룹핑), 열 = 1일~말일. 셀 클릭 → 기입(단위: 천원).
 * 우측: 월 합계 / Limit(클릭 수정) / 사용율. 하단: 일별 합계.
 * meta/naver_sa 자동 연동 매체는 스냅샷에서 자동 채움(읽기 전용).
 * 저장 값은 원 단위(VAT 포함) — 시트 관행과 동일하게 화면 표기는 천원.
 */
import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus, X, ChevronLeft, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { adspendApi, type AdMediaRow } from '@/lib/api';
import { fmtWon } from '@/components/tabs/kpi/format';

const thisMonth = () => new Date().toISOString().slice(0, 7);

function monthAdd(month: string, delta: number): string {
  const y = parseInt(month.slice(0, 4), 10);
  const m = parseInt(month.slice(5, 7), 10);
  const t = y * 12 + (m - 1) + delta;
  return `${String(Math.floor(t / 12)).padStart(4, '0')}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/** 원 → 천원 표시 */
const k = (v: number | null | undefined) =>
  v === null || v === undefined || v === 0 ? '' : Math.round(v / 1000).toLocaleString('ko-KR');

export function AdSpendBoard() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(thisMonth());
  const [editCell, setEditCell] = useState<{ mediaId: number; date: string } | null>(null);
  const [editLimit, setEditLimit] = useState<number | null>(null); // media_id
  const [editNote, setEditNote] = useState<number | null>(null); // media_id
  const [cellValue, setCellValue] = useState('');
  const [showAddMedia, setShowAddMedia] = useState(false);

  const { data: board, isLoading } = useQuery({
    queryKey: ['adspend', 'board', month],
    queryFn: () => adspendApi.board(month),
  });

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

  const days = board?.days_in_month ?? 30;
  const dates = useMemo(
    () => Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
    [month, days],
  );
  const todayIso = new Date().toISOString().slice(0, 10);

  // 유입채널별 그룹핑
  const groups = useMemo(() => {
    const map = new Map<string, AdMediaRow[]>();
    (board?.rows || []).forEach((r) => {
      const key = r.inflow || '기타';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    });
    return Array.from(map.entries());
  }, [board]);

  const commitCell = () => {
    if (!editCell) return;
    const raw = cellValue.replace(/,/g, '').trim();
    const num = raw === '' ? 0 : Number(raw);
    if (Number.isNaN(num) || num < 0) { toast.error('숫자를 입력해 주세요 (천원 단위)'); return; }
    entryMut.mutate({ mediaId: editCell.mediaId, date: editCell.date, amount: num * 1000 });
    setEditCell(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h2 className="text-base font-semibold text-text-primary">광고비 일보</h2>
          <p className="text-xs text-text-tertiary mt-0.5">
            셀 클릭으로 기입 · 단위 <b className="text-text-secondary">천원</b> (VAT 포함) · Limit 셀 클릭으로 월 한도 수정
          </p>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <button onClick={() => setMonth(monthAdd(month, -1))} className="p-1.5 rounded-lg border border-border-primary text-text-tertiary hover:text-text-primary"><ChevronLeft size={13} /></button>
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary" />
          <button onClick={() => setMonth(monthAdd(month, 1))} className="p-1.5 rounded-lg border border-border-primary text-text-tertiary hover:text-text-primary"><ChevronRight size={13} /></button>
        </div>
        <button
          onClick={async () => {
            try { await adspendApi.exportXlsx(month); toast.success('엑셀 다운로드 시작'); }
            catch { toast.error('다운로드 실패'); }
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-text-secondary border border-border-primary hover:text-text-primary"
        >
          <Download size={13} /> 엑셀
        </button>
        <button onClick={() => setShowAddMedia(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white hover:opacity-90"
          style={{ backgroundColor: 'var(--color-brand-bg)' }}>
          <Plus size={13} /> 매체 추가
        </button>
      </div>

      {/* 월 요약 */}
      {board && (
        <div className="flex flex-wrap gap-3">
          {[
            { label: `${parseInt(month.slice(5), 10)}월 집행`, value: fmtWon(board.totals.spend) },
            { label: 'Limit 합계', value: fmtWon(board.totals.limit) },
            {
              label: '사용율',
              value: board.totals.usage_pct != null ? `${board.totals.usage_pct}%` : '-',
              cls: board.totals.usage_pct != null && board.totals.usage_pct > 100 ? 'text-red' :
                board.totals.usage_pct != null && board.totals.usage_pct > 90 ? 'text-yellow' : 'text-green',
            },
            { label: '매체 수', value: String(board.rows.length) },
          ].map((c) => (
            <div key={c.label} className="rounded-xl px-4 py-2.5" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
              <p className="text-[10px] text-text-quaternary">{c.label}</p>
              <p className={`text-base font-bold tabular-nums ${c.cls || 'text-text-primary'}`}>{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16"><div className="w-7 h-7 border-2 border-brand border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            <table className="text-[11px] border-collapse" style={{ minWidth: `${480 + days * 52}px` }}>
              <thead className="sticky top-0 z-20" style={{ backgroundColor: 'var(--color-bg-level-2)' }}>
                <tr>
                  <th className="sticky left-0 z-30 px-2 py-2 text-left font-medium text-text-tertiary min-w-[190px]" style={{ backgroundColor: 'var(--color-bg-level-2)' }}>매체</th>
                  {dates.map((d) => (
                    <th key={d} className={`px-1 py-2 text-right font-medium min-w-[50px] ${d === todayIso ? 'text-text-primary' : 'text-text-quaternary'}`}>
                      {parseInt(d.slice(8), 10)}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right font-medium text-text-secondary min-w-[70px]">합계</th>
                  <th className="px-2 py-2 text-right font-medium text-text-quaternary min-w-[70px]">Limit</th>
                  <th className="px-2 py-2 text-right font-medium text-text-quaternary min-w-[52px]">사용율</th>
                  <th className="px-2 py-2 text-left font-medium text-text-quaternary min-w-[140px]">비고</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(([inflow, rows]) => (
                  <Fragment key={inflow}>
                    <tr>
                      <td colSpan={days + 5} className="sticky left-0 px-2 py-1.5 text-[10px] font-bold" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.06)', color: 'var(--color-accent-hover)' }}>
                        {inflow}
                      </td>
                    </tr>
                    {rows.map((r) => (
                      <tr key={r.media_id} className="group" style={{ borderTop: '1px solid rgb(var(--color-overlay-rgb) / 0.04)' }}>
                        <td className="sticky left-0 z-10 px-2 py-1 text-text-secondary max-w-[190px]" style={{ backgroundColor: 'var(--color-bg-level-1)' }}>
                          <div className="flex items-center gap-1">
                            <span className="truncate" title={`${r.group_name || ''} · ${r.name}${r.memo ? ` · ${r.memo}` : ''}`}>{r.name}</span>
                            {r.auto && <span className="shrink-0 px-1 rounded text-[8px] font-bold bg-green/15 text-green">자동</span>}
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
                                  defaultValue={v ? String(Math.round(v / 1000)) : ''}
                                  onChange={(e) => setCellValue(e.target.value)}
                                  onBlur={commitCell}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') commitCell();
                                    if (e.key === 'Escape') setEditCell(null);
                                  }}
                                  className="w-[50px] px-1 py-1 text-right text-[11px] tabular-nums bg-bg-2 border border-brand outline-none"
                                />
                              ) : (
                                <button
                                  disabled={r.auto}
                                  onClick={() => { setCellValue(v ? String(Math.round(v / 1000)) : ''); setEditCell({ mediaId: r.media_id, date: d }); }}
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
                        <td className="px-2 py-1 text-right font-medium text-text-primary tabular-nums">{k(r.month_total) || '0'}</td>
                        <td className="p-0 text-right">
                          {editLimit === r.media_id ? (
                            <input
                              autoFocus
                              defaultValue={r.limit_amount ? String(Math.round(r.limit_amount / 1000)) : ''}
                              onChange={(e) => setCellValue(e.target.value)}
                              onBlur={() => {
                                const num = Number(cellValue.replace(/,/g, '').trim() || '0');
                                if (!Number.isNaN(num) && num >= 0) limitMut.mutate({ mediaId: r.media_id, limit: num * 1000 });
                                setEditLimit(null);
                              }}
                              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditLimit(null); }}
                              className="w-[66px] px-1 py-1 text-right text-[11px] tabular-nums bg-bg-2 border border-brand outline-none"
                            />
                          ) : (
                            <button
                              onClick={() => { setCellValue(r.limit_amount ? String(Math.round(r.limit_amount / 1000)) : ''); setEditLimit(r.media_id); }}
                              className="w-full px-2 py-1 text-right tabular-nums text-text-quaternary hover:text-text-primary hover:bg-[rgb(var(--color-overlay-rgb)/0.07)]"
                            >{k(r.limit_amount) || '설정'}</button>
                          )}
                        </td>
                        <td className={`px-2 py-1 text-right tabular-nums font-medium ${
                          r.usage_pct == null ? 'text-text-quaternary' :
                          r.usage_pct > 100 ? 'text-red' : r.usage_pct > 90 ? 'text-yellow' : 'text-green'
                        }`}>{r.usage_pct != null ? `${Math.round(r.usage_pct)}%` : '-'}</td>
                        <td className="p-0">
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
                ))}
              </tbody>
              <tfoot className="sticky bottom-0" style={{ backgroundColor: 'var(--color-bg-level-2)' }}>
                <tr style={{ borderTop: '2px solid var(--color-border-primary)' }}>
                  <td className="sticky left-0 px-2 py-1.5 font-bold text-text-primary" style={{ backgroundColor: 'var(--color-bg-level-2)' }}>일별 합계</td>
                  {dates.map((d) => (
                    <td key={d} className="px-1 py-1.5 text-right font-medium text-text-secondary tabular-nums">{k(board?.day_totals[d])}</td>
                  ))}
                  <td className="px-2 py-1.5 text-right font-bold text-text-primary tabular-nums">{k(board?.totals.spend)}</td>
                  <td className="px-2 py-1.5 text-right text-text-quaternary tabular-nums">{k(board?.totals.limit)}</td>
                  <td className="px-2 py-1.5 text-right text-text-quaternary tabular-nums">{board?.totals.usage_pct != null ? `${board.totals.usage_pct}%` : ''}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {showAddMedia && (
        <AddMediaModal
          existingInflows={groups.map(([g]) => g)}
          onClose={() => setShowAddMedia(false)}
          onSaved={() => { setShowAddMedia(false); invalidate(); }}
        />
      )}
    </div>
  );
}

function AddMediaModal({ existingInflows, onClose, onSaved }: {
  existingInflows: string[]; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({ name: '', inflow: '', group_name: '', memo: '' });
  const mut = useMutation({
    mutationFn: () => adspendApi.createMedia(form),
    onSuccess: () => { toast.success('매체를 추가했습니다'); onSaved(); },
    onError: () => toast.error('추가 실패'),
  });
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl p-5" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-text-primary">매체 추가</h3>
          <button onClick={onClose} className="p-1 text-text-tertiary hover:text-text-primary"><X size={16} /></button>
        </div>
        <div className="space-y-3">
          {[
            { k: 'name', label: '매체명 *', ph: '예: 자사몰 토스 쿠폰광고' },
            { k: 'inflow', label: '유입 채널', ph: '예: 자사몰, 네이버스토어, 쿠팡 WING', list: true },
            { k: 'group_name', label: '매체 그룹', ph: '예: 메타, 네이버, CRM, 바이럴' },
            { k: 'memo', label: '메모', ph: '' },
          ].map((f) => (
            <label key={f.k} className="flex flex-col gap-1">
              <span className="text-[11px] text-text-tertiary">{f.label}</span>
              <input
                list={f.list ? 'inflow-list' : undefined}
                value={(form as any)[f.k]}
                onChange={(e) => setForm((v) => ({ ...v, [f.k]: e.target.value }))}
                placeholder={f.ph}
                className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary"
              />
            </label>
          ))}
          <datalist id="inflow-list">{existingInflows.map((g) => <option key={g} value={g} />)}</datalist>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs text-text-tertiary border border-border-primary">취소</button>
          <button
            onClick={() => { if (!form.name.trim()) { toast.error('매체명을 입력해 주세요'); return; } mut.mutate(); }}
            disabled={mut.isPending}
            className="px-4 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-brand-bg)' }}
          >추가</button>
        </div>
      </div>
    </div>
  );
}
