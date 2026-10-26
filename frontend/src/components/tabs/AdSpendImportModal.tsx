'use client';

/**
 * 광고비 일보 엑셀 업로드 — 팀 구글시트(xlsx)를 그대로 올려 그 달 일보를 시트와 같은 숫자로 맞춘다.
 *
 * 1) 파일 선택 → 미리보기: 서버가 시트를 읽고 행마다 시스템 매체를 자동 연결 (DB 변경 없음)
 * 2) 확인이 필요한 행(비슷한 이름·새 매체·합계 보정 등)을 보고 연결을 고친다
 * 3) 반영: 연결된 매체의 그 달 일별 금액·Limit를 파일 값으로 교체. 반영 후 예상 합계가
 *    파일의 'Marketing Cost _ Total'과 같은지 반영 전에 바로 보인다.
 */
import { useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { X, Upload, Check, AlertTriangle, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  adspendApi,
  type AdspendImportMedia, type AdspendImportPreview, type AdspendImportRow,
  type AdspendImportSheet, type AdspendImportTarget,
} from '@/lib/api';

const won = (v: number | null | undefined) =>
  v === null || v === undefined ? '-' : `${Math.round(v).toLocaleString('ko-KR')}원`;

const FLAG_LABEL: Record<string, string> = {
  total_only: '일별 없이 합계만 → 말일에 반영',
  scaled: '합계 칸이 일별 합보다 작음 → 일별 비례 축소',
  remainder: '합계 칸이 더 큼 → 차액 말일에 반영',
  blank_total: '합계 칸 빈칸 → 금액 제외(공식 합계에서 빠짐)',
  merged: '아래 이름 없는 행 금액 합산',
  derived_name: '매체명 빈칸 → 판매채널·분류로 이름',
  overflow: '말일 뒤 칸 금액 → 말일에 합산',
  negative: '음수 금액 포함',
};
const REASON_LABEL: Record<string, string> = {
  alias: '기억된 연결',
  exact: '이름 일치',
  exact_other: '이름 일치 (채널 다름)',
  similar: '비슷한 이름',
  slot: '같은 판매채널·분류',
  inactive: '숨긴 매체 다시 사용',
  new: '없는 매체 → 새로 만듦',
  empty: '반영할 금액 없음',
  auto: '자동 수집 → 건너뜀',
};
const CHECK_REASONS = new Set(['exact_other', 'similar', 'slot', 'inactive', 'new']);

type ImportError = { message: string; sheets?: AdspendImportSheet[] };
const toImportError = (e: any): ImportError => {
  const d = e?.response?.data?.detail;
  if (typeof d === 'string') return { message: d };
  if (d?.message) return { message: d.message, sheets: d.sheets };
  return { message: e?.response?.status === 413 ? '파일이 너무 큽니다 (8MB까지)' : '파일을 읽지 못했습니다' };
};

const defaultTarget = (r: AdspendImportRow): AdspendImportTarget =>
  r.suggestion.action === 'map' && r.suggestion.media_id != null ? r.suggestion.media_id
    : r.suggestion.action === 'new' ? 'new' : 'skip';

export function AdSpendImportModal({ initialMonth, onClose, onApplied }: {
  initialMonth: string;
  onClose: () => void;
  onApplied: (month: string) => void;
}) {
  const [month, setMonth] = useState(initialMonth);
  const [file, setFile] = useState<File | null>(null);
  const [sheet, setSheet] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useState<AdspendImportPreview | null>(null);
  const [error, setError] = useState<ImportError | null>(null);
  const [mapping, setMapping] = useState<Record<string, AdspendImportTarget>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'check' | 'all'>('check');
  const [editing, setEditing] = useState<string | null>(null);
  const [clearMissing, setClearMissing] = useState(true);
  const [remember, setRemember] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const previewMut = useMutation({
    mutationFn: (v: { file: File; month: string; sheet?: string }) => adspendApi.importPreview(v.file, v.month, v.sheet),
    onSuccess: (p) => {
      setPreview(p);
      setError(null);
      setSheet(p.file.sheet);
      setMapping(Object.fromEntries(p.rows.map((r) => [r.key, defaultTarget(r)])));
      setTouched(new Set());
      setEditing(null);
      setFilter(p.rows.some((r) => CHECK_REASONS.has(r.suggestion.reason) || r.flags.length > 0) ? 'check' : 'all');
    },
    onError: (e) => { setPreview(null); setError(toImportError(e)); },
  });
  const run = (next: { file?: File | null; month?: string; sheet?: string }) => {
    const f = next.file !== undefined ? next.file : file;
    if (!f) return;
    previewMut.mutate({ file: f, month: next.month ?? month, sheet: next.sheet });
  };

  const applyMut = useMutation({
    mutationFn: () => adspendApi.importApply(file as File, month, { sheet, mapping, clearMissing, remember }),
    onSuccess: (res) => {
      const off = res.official.spend;
      toast.success(`${parseInt(res.month.slice(5), 10)}월 일보 반영 완료 — 집행 ${won(res.board.spend)}${off != null ? ` (파일 ${won(off)})` : ''}`);
      if (res.remember_error) toast.error(res.remember_error);
      onApplied(res.month);
    },
    onError: (e) => toast.error(toImportError(e).message),
  });

  const mediaById = useMemo(() => new Map((preview?.media || []).map((m) => [m.id, m])), [preview]);
  // 매체 고르기 목록 — 판매채널별 (보드 순서, 숨긴 매체는 뒤)
  const mediaGroups = useMemo(() => {
    const map = new Map<string, AdspendImportMedia[]>();
    (preview?.media || []).forEach((m) => {
      const k = m.inflow || '기타';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(m);
    });
    return Array.from(map.entries());
  }, [preview]);

  const needsCheck = (r: AdspendImportRow) =>
    touched.has(r.key) || CHECK_REASONS.has(r.suggestion.reason) || r.flags.length > 0;

  // 반영 후 예상 — 서버 반영 로직과 같은 규칙
  const proj = useMemo(() => {
    if (!preview) return null;
    const targets = new Map<number, number>(); // 매체 id → 연결된 행 수
    Object.values(mapping).forEach((v) => { if (typeof v === 'number') targets.set(v, (targets.get(v) || 0) + 1); });
    let spend = preview.board.spend; let limit = preview.board.limit;
    const missing: AdspendImportMedia[] = [];
    preview.media.forEach((m) => {
      if (!m.active || m.auto) return;
      const has = !!m.month_spend || m.month_limit !== null;
      if (targets.has(m.id) || (has && clearMissing)) { spend -= m.month_spend || 0; limit -= m.month_limit || 0; }
      if (has && !targets.has(m.id)) missing.push(m);
    });
    let mapped = 0; let created = 0; let skipped = 0;
    const newKeys = new Set<string>();
    preview.rows.forEach((r) => {
      const v = mapping[r.key];
      if (v === 'skip') { skipped += 1; return; }
      mapped += 1;
      spend += r.total; limit += r.limit || 0;
      if (v === 'new') newKeys.add(`${r.inflow}|${r.name}`);
    });
    created = newKeys.size;
    const reactivate = Array.from(targets.keys()).filter((id) => mediaById.get(id) && !mediaById.get(id)!.active).length;
    return { spend, limit, missing, mapped, created, skipped, reactivate, targets };
  }, [preview, mapping, clearMissing, mediaById]);

  const off = preview?.official;
  const diff = proj && off?.spend != null ? Math.round(proj.spend) - Math.round(off.spend) : null;
  const limitDiff = proj && off?.limit != null ? Math.round(proj.limit) - Math.round(off.limit) : null;
  const rows = (preview?.rows || []).filter((r) => filter === 'all' || needsCheck(r));
  const checkCount = (preview?.rows || []).filter(needsCheck).length;

  const setTarget = (key: string, v: AdspendImportTarget) => {
    setMapping((m) => ({ ...m, [key]: v }));
    setTouched((t) => new Set(t).add(key));
    setEditing(null);
  };
  const resetTarget = (r: AdspendImportRow) => {
    setMapping((m) => ({ ...m, [r.key]: defaultTarget(r) }));
    setTouched((t) => { const n = new Set(t); n.delete(r.key); return n; });
  };

  const submit = () => {
    if (!preview || !proj || !file) return;
    const lines = [
      `${parseInt(month.slice(5), 10)}월 광고비 일보를 파일 기준으로 바꿉니다.`,
      `· 연결 ${proj.mapped}행${proj.created ? ` (새 매체 ${proj.created}개)` : ''}${proj.reactivate ? ` · 숨긴 매체 ${proj.reactivate}개 다시 켬` : ''} · 반영 안 함 ${proj.skipped}행`,
      `· 파일에 없는 매체 ${proj.missing.length}개: ${clearMissing ? '이 달 금액·Limit 비움' : '그대로 둠'}`,
      `· 반영 후 집행 ${won(proj.spend)} / Limit ${won(proj.limit)}`,
      '',
      '연결된 매체의 이 달 일별 금액·Limit는 파일 값으로 교체됩니다. 진행할까요?',
    ];
    if (confirm(lines.join('\n'))) applyMut.mutate();
  };

  const targetLabel = (r: AdspendImportRow) => {
    const v = mapping[r.key];
    if (v === 'skip') return <span className="text-text-quaternary">반영 안 함</span>;
    if (v === 'new') return <span className="text-brand font-medium">＋ 새 매체 <span className="text-text-tertiary font-normal">({r.inflow || '기타'} 맨 아래)</span></span>;
    const m = mediaById.get(v);
    if (!m) return <span className="text-red">매체 없음 ({v})</span>;
    const n = proj?.targets.get(m.id) || 0;
    return (
      <span>
        <span className="text-text-primary">{m.name}</span>
        <span className="text-text-quaternary"> · {m.inflow || '기타'}</span>
        {!m.active && <span className="ml-1 px-1 rounded text-[10px] bg-yellow/15 text-yellow whitespace-nowrap">숨김→다시 켬</span>}
        {n > 1 && <span className="ml-1 px-1 rounded text-[10px] bg-brand/15 text-brand whitespace-nowrap" title="같은 매체에 연결된 행은 금액·Limit를 합산합니다">{n}행 합산</span>}
      </span>
    );
  };

  const sheets = preview?.file.sheets || error?.sheets || [];
  const busy = previewMut.isPending || applyMut.isPending;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }} onClick={() => !busy && !preview && onClose()}>
      <div className="w-full max-w-7xl rounded-xl p-5 max-h-[92vh] flex flex-col" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3 shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">엑셀 업로드 — 광고비 일보</h3>
            <p className="text-[11px] text-text-tertiary mt-0.5">
              구글시트 「영업 광고비 일보_관리」에서 <b className="text-text-secondary">파일 &gt; 다운로드 &gt; Microsoft Excel(.xlsx)</b>로 받은 파일을 그대로 올리세요. 미리보기에서는 아무것도 바뀌지 않습니다.
            </p>
          </div>
          <button onClick={onClose} disabled={busy} className="p-1 text-text-tertiary hover:text-text-primary disabled:opacity-40"><X size={16} /></button>
        </div>

        {/* 파일·월·시트 */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <input type="month" value={month}
            onChange={(e) => { if (!e.target.value) return; setMonth(e.target.value); run({ month: e.target.value, sheet: undefined }); }}
            className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary" />
          <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] || null;
              e.target.value = '';
              if (!f) return;
              setFile(f); setSheet(undefined);
              run({ file: f, sheet: undefined });
            }} />
          <button onClick={() => fileRef.current?.click()} disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-brand-bg)' }}>
            <Upload size={13} /> {file ? '다른 파일' : '파일 선택'}
          </button>
          {file && <span className="text-xs text-text-secondary truncate max-w-[260px]" title={file.name}>{file.name}</span>}
          {sheets.length > 1 && (
            <select value={sheet || ''} onChange={(e) => { setSheet(e.target.value); run({ sheet: e.target.value }); }} disabled={busy}
              className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary max-w-[240px]">
              {!sheet && <option value="">시트 고르기</option>}
              {sheets.map((s) => (
                <option key={s.name} value={s.name} disabled={!s.usable}>
                  {s.name}{s.month ? ` (${s.month})` : ''}{s.usable ? '' : ' — 일보 형식 아님'}
                </option>
              ))}
            </select>
          )}
          {previewMut.isPending && <span className="text-xs text-text-tertiary">시트 읽는 중…</span>}
        </div>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs text-red shrink-0" style={{ backgroundColor: 'rgb(var(--color-red-rgb) / 0.08)', border: '1px solid rgb(var(--color-red-rgb) / 0.3)' }}>
            <AlertTriangle size={14} className="shrink-0 mt-0.5" /> <span>{error.message}</span>
          </div>
        )}

        {preview && proj && (
          <div className="mt-3 flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
            {/* 합계 비교 */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <SumCard title={`파일 공식 합계 · ${preview.file.sheet.trim()}`} sub="Marketing Cost _ Total 행"
                spend={off?.spend ?? preview.computed.spend} limit={off?.limit ?? preview.computed.limit} />
              <SumCard title="반영 후 일보 (예상)" sub={clearMissing ? '파일에 없는 매체 비움' : '파일에 없는 매체 그대로'}
                spend={proj.spend} limit={proj.limit} highlight
                badge={diff === null ? null : Math.abs(diff) <= 50 && (limitDiff === null || Math.abs(limitDiff) <= 1)
                  ? { ok: true, text: Math.abs(diff) >= 1 ? `파일과 일치 (원 단위 반올림 ${diff > 0 ? '+' : ''}${diff}원)` : '파일과 일치' }
                  : { ok: false, text: `파일과 집행 ${diff > 0 ? '+' : ''}${diff.toLocaleString('ko-KR')}원${limitDiff ? ` · Limit ${limitDiff > 0 ? '+' : ''}${limitDiff.toLocaleString('ko-KR')}원` : ''} 차이` }} />
              <SumCard title="지금 일보" sub={`${parseInt(month.slice(5), 10)}월 · 활성 매체 전체`} spend={preview.board.spend} limit={preview.board.limit} />
            </div>

            {(preview.warnings.length > 0 || preview.excluded.length > 0) && (
              <div className="rounded-lg px-3 py-2 text-[11px] space-y-1" style={{ backgroundColor: 'rgb(var(--color-yellow-rgb) / 0.07)', border: '1px solid rgb(var(--color-yellow-rgb) / 0.3)' }}>
                {preview.warnings.map((w) => <div key={w} className="text-yellow">⚠ {w}</div>)}
                {preview.excluded.length > 0 && (
                  <div className="text-text-secondary">
                    <b className="text-text-primary">공식 합계에서 빠진 금액</b> (시트 규칙대로 제외):{' '}
                    {preview.excluded.map((e, i) => (
                      <span key={`${e.row}-${i}`}>{i > 0 && ' · '}{e.row}행 {e.name} {won(e.amount)} <span className="text-text-quaternary">({e.reason})</span></span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 행 연결 */}
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-1.5">
                <span className="text-xs font-semibold text-text-primary">행 연결</span>
                <span className="text-[11px] text-text-tertiary">
                  {preview.rows.length}행 · 연결 {proj.mapped} · 새 매체 {proj.created} · 반영 안 함 {proj.skipped}
                </span>
                <div className="flex-1" />
                <div className="flex items-center rounded-lg p-0.5" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.05)' }}>
                  {([['check', `확인 필요 ${checkCount}`], ['all', `전체 ${preview.rows.length}`]] as const).map(([kv, label]) => (
                    <button key={kv} onClick={() => setFilter(kv)}
                      className="px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors"
                      style={filter === kv ? { backgroundColor: 'var(--color-brand-bg)', color: '#fff' } : { color: 'var(--color-text-tertiary)' }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="rounded-lg overflow-x-auto" style={{ border: '1px solid var(--color-border-primary)' }}>
                <table className="w-full min-w-[880px] table-fixed text-[11px]">
                  <colgroup>
                    <col className="w-10" /><col /><col className="w-24" /><col className="w-24" /><col className="w-[30%]" /><col className="w-48" />
                  </colgroup>
                  <thead>
                    <tr className="text-text-tertiary" style={{ backgroundColor: 'var(--color-bg-level-2)' }}>
                      <th className="px-2 py-1.5 text-left font-medium">행</th>
                      <th className="px-2 py-1.5 text-left font-medium">시트 (판매채널 · 매체명)</th>
                      <th className="px-2 py-1.5 text-right font-medium">금액</th>
                      <th className="px-2 py-1.5 text-right font-medium">Limit</th>
                      <th className="px-2 py-1.5 text-left font-medium">→ 시스템 매체 <span className="font-normal text-text-quaternary">(클릭해서 바꾸기)</span></th>
                      <th className="px-2 py-1.5 text-left font-medium">근거</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr><td colSpan={6} className="px-2 py-6 text-center text-text-tertiary">확인이 필요한 행이 없습니다 — 전부 이름 그대로 연결됐습니다</td></tr>
                    )}
                    {rows.map((r) => (
                      <tr key={r.key} style={{ borderTop: '1px solid var(--color-border-primary)' }}>
                        <td className="px-2 py-1.5 text-text-quaternary tabular-nums align-top">{r.row}</td>
                        <td className="px-2 py-1.5 align-top">
                          <div className="text-text-quaternary">{r.inflow || '기타'}{r.group ? ` · ${r.group}` : ''}</div>
                          <div className="text-text-primary">{r.name}</div>
                          {(r.flags.length > 0 || r.nonnum.length > 0) && (
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {r.flags.map((f) => <span key={f} className="px-1 rounded text-[10px] bg-yellow/15 text-yellow">{FLAG_LABEL[f] || f}</span>)}
                              {r.nonnum.length > 0 && <span className="px-1 rounded text-[10px] text-text-quaternary" style={{ border: '1px solid var(--color-border-primary)' }} title="숫자가 아닌 칸은 금액에서 뺐습니다">글자 칸 무시: {r.nonnum.join(', ')}</span>}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-text-primary align-top">{r.total ? Math.round(r.total).toLocaleString('ko-KR') : ''}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-text-secondary align-top">{r.limit != null ? Math.round(r.limit).toLocaleString('ko-KR') : ''}</td>
                        <td className="px-2 py-1.5 align-top">
                          {editing === r.key ? (
                            <select autoFocus value={String(mapping[r.key])} onBlur={() => setEditing(null)}
                              onChange={(e) => { const v = e.target.value; setTarget(r.key, v === 'new' || v === 'skip' ? v : Number(v)); }}
                              className="w-full px-1.5 py-1 rounded-md text-[11px] bg-bg-2 border border-border-primary text-text-primary">
                              {r.candidates.length > 0 && (
                                <optgroup label="추천">
                                  {r.candidates.map((c) => {
                                    const m = mediaById.get(c.media_id);
                                    return m ? <option key={`c${c.media_id}`} value={m.id}>{m.name} · {m.inflow || '기타'}{m.active ? '' : ' (숨김)'}</option> : null;
                                  })}
                                </optgroup>
                              )}
                              <optgroup label="그 밖">
                                <option value="new">＋ 새 매체로 만들기 ({r.inflow || '기타'} 맨 아래)</option>
                                <option value="skip">반영 안 함</option>
                              </optgroup>
                              {mediaGroups.map(([inflow, list]) => (
                                <optgroup key={inflow} label={inflow}>
                                  {list.map((m) => (
                                    <option key={m.id} value={m.id} disabled={m.auto}>
                                      {m.name}{m.active ? '' : ' (숨김)'}{m.auto ? ' (자동 수집)' : ''}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>
                          ) : (
                            <button onClick={() => setEditing(r.key)} title="클릭해서 연결할 매체 바꾸기"
                              className="text-left w-full rounded px-1 -mx-1 hover:bg-bg-2">
                              {targetLabel(r)}
                            </button>
                          )}
                        </td>
                        <td className="px-2 py-1.5 align-top">
                          {touched.has(r.key) ? (
                            <button onClick={() => resetTarget(r)} className="flex items-center gap-1 text-brand hover:opacity-80" title="자동 연결로 되돌리기">
                              <RotateCcw size={10} /> 직접 고름
                            </button>
                          ) : (
                            <span className={`whitespace-nowrap ${CHECK_REASONS.has(r.suggestion.reason) ? 'text-yellow' : 'text-text-tertiary'}`}>
                              {REASON_LABEL[r.suggestion.reason] || r.suggestion.reason}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 파일에 없는 매체 */}
            {proj.missing.length > 0 && (
              <div className="rounded-lg px-3 py-2" style={{ border: '1px solid var(--color-border-primary)' }}>
                <label className="flex items-start gap-2 text-xs text-text-primary cursor-pointer">
                  <input type="checkbox" checked={clearMissing} onChange={(e) => setClearMissing(e.target.checked)} className="mt-0.5" />
                  <span>
                    <b>파일에 없는 매체 {proj.missing.length}개</b>의 이 달 금액·Limit 비우기
                    <span className="text-text-tertiary"> — 켜 두면 일보가 시트와 똑같아집니다. 끄면 이 매체들은 그대로 남습니다.</span>
                  </span>
                </label>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-text-secondary pl-6">
                  {proj.missing.map((m) => (
                    <span key={m.id}>
                      {m.name} <span className="text-text-quaternary">· {m.inflow || '기타'}</span>{' '}
                      <span className="tabular-nums">{m.month_spend ? won(m.month_spend) : ''}{m.month_limit != null ? ` (Limit ${won(m.month_limit)})` : ''}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              이름이 다른 연결 기억하기 <span className="text-text-quaternary">— 다음 달 업로드부터 같은 행은 같은 매체로 바로 연결</span>
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 mt-4 shrink-0">
          {preview && proj && (
            <span className="w-full sm:w-auto sm:mr-auto text-[11px] text-text-tertiary">
              반영하면 연결된 매체의 {parseInt(month.slice(5), 10)}월 일별 금액·Limit가 파일 값으로 바뀝니다 (사업계획 금액은 그대로)
            </span>
          )}
          <button onClick={onClose} disabled={busy} className="shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg text-xs text-text-tertiary border border-border-primary disabled:opacity-40">취소</button>
          <button onClick={submit} disabled={!preview || busy}
            className="shrink-0 whitespace-nowrap flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-brand-bg)' }}>
            <Check size={13} /> {applyMut.isPending ? '반영 중…' : '반영하기'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SumCard({ title, sub, spend, limit, highlight, badge }: {
  title: string; sub: string; spend: number | null; limit: number | null; highlight?: boolean;
  badge?: { ok: boolean; text: string } | null;
}) {
  return (
    <div className="rounded-lg px-3 py-2"
      style={{
        backgroundColor: highlight ? 'rgb(var(--color-brand-bg-rgb) / 0.06)' : 'var(--color-bg-level-2)',
        border: `1px solid ${highlight ? 'rgb(var(--color-brand-bg-rgb) / 0.35)' : 'var(--color-border-primary)'}`,
      }}>
      <div className="text-[11px] text-text-tertiary truncate" title={title}>{title}</div>
      <div className="text-base font-semibold text-text-primary tabular-nums mt-0.5">{won(spend)}</div>
      <div className="text-[11px] text-text-secondary tabular-nums">Limit {won(limit)}</div>
      <div className="text-[10px] text-text-quaternary truncate" title={sub}>{sub}</div>
      {badge && (
        <div className={`mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.ok ? 'bg-green/15 text-green' : 'bg-red/15 text-red'}`}>
          {badge.ok ? <Check size={10} /> : <AlertTriangle size={10} />} {badge.text}
        </div>
      )}
    </div>
  );
}
