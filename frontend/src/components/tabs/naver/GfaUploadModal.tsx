'use client';

/**
 * GFA 성과 파일 올리기 — 광고 관리자 보고서에서 내려받은 일별 성과 파일(CSV·XLSX)을 그대로 올린다.
 *
 * 1) 파일 선택 → 미리보기: 서버가 머리글을 읽고 칸을 자동 연결 (DB 변경 없음)
 * 2) 못 알아본 칸은 항목별로 직접 고르고 다시 미리보기
 * 3) 반영: 같은 (계정 이름, 날짜)의 예전 값은 파일 값으로 바뀐다 — 두 번 세지 않음, 다른 날짜는 그대로 쌓인다
 * 4) 여러 파일 한 번에(2026-11-03): GFA는 60일씩만 받아져 1~2월·3~4월처럼 나눈 파일을 골라 기간 순으로 차례 반영
 */
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Upload, Check, AlertTriangle, RotateCcw, Trash2, History, ChevronDown, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  naverGFAApi,
  type GfaUploadApplyResult, type GfaUploadPreview,
} from '@/lib/naver-api';

const won = (v: number | null | undefined) =>
  v === null || v === undefined ? '-' : `${Math.round(v).toLocaleString('ko-KR')}원`;
const num = (v: number | null | undefined) =>
  v === null || v === undefined ? '-' : Math.round(v).toLocaleString('ko-KR');
/** 서버 시각(UTC, 시간대 표시 없음) → 한국 시각 'M. D. HH:mm' */
export const kst = (iso: string) => {
  const d = new Date(/Z$|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
};

export const GRANULARITY_LABEL: Record<string, string> = {
  creative: '소재 단위',
  adgroup: '광고그룹 단위',
  campaign: '캠페인 단위',
  account: '계정 합계(일별)',
};
export const VAT_LABEL: Record<string, string> = { excl: 'VAT 제외', incl: 'VAT 포함' };

type UploadError = { message: string; sheets?: { name: string; usable: boolean }[] };
const toUploadError = (e: any): UploadError => {
  const d = e?.response?.data?.detail;
  if (typeof d === 'string') return { message: d };
  if (d?.message) return { message: d.message, sheets: d.sheets };
  return { message: e?.response?.status === 413 ? '파일이 너무 큽니다 (8MB까지)' : '파일을 읽지 못했습니다' };
};

/** 고른 파일 하나 — 여러 개를 한 번에 골라 차례로 미리보기·반영한다 (2026-11-03: GFA는 60일씩만 받아져 나눠 올림) */
type Item = {
  id: number;
  file: File;
  sheet?: string;
  headerRow?: number;
  mapping: Record<string, number | null>;
  preview: GfaUploadPreview | null;
  error: UploadError | null;
  status: 'reading' | 'ready' | 'error' | 'applying' | 'applied';
  result?: GfaUploadApplyResult;
};
type RunOpts = { sheet?: string; headerRow?: number; mapping?: Record<string, number | null> };

let itemSeq = 0;

export function GfaUploadModal({ accounts, onClose, onApplied }: {
  accounts: string[];
  onClose: () => void;
  /** 반영한 파일들의 결과(반영 순서) */
  onApplied: (results: GfaUploadApplyResult[]) => void;
}) {
  const qc = useQueryClient();
  const [items, setItems] = useState<Item[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [accountLabel, setAccountLabel] = useState('');
  const [applying, setApplying] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSample, setShowSample] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<Item[]>([]);
  itemsRef.current = items;

  const active = items.find((x) => x.id === activeId) || null;
  const file = active?.file ?? null;
  const sheet = active?.sheet;
  const headerRow = active?.headerRow;
  const mapping = active?.mapping ?? {};
  const preview = active?.preview ?? null;
  const error = active?.error ?? null;

  const patch = (id: number, p: Partial<Item>) =>
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const setHeaderRow = (v: number | undefined) => { if (active) patch(active.id, { headerRow: v }); };

  /** 한 파일 미리보기 — DB는 바꾸지 않는다 */
  const previewOne = async (it: Item, next: RunOpts = {}, label = accountLabel) => {
    const opts = {
      accountLabel: label,
      sheet: 'sheet' in next ? next.sheet : it.sheet,
      headerRow: 'headerRow' in next ? next.headerRow : it.headerRow,
      mapping: next.mapping ?? it.mapping,
    };
    patch(it.id, { status: 'reading', sheet: opts.sheet, headerRow: opts.headerRow, mapping: opts.mapping });
    try {
      const p = await naverGFAApi.uploadPreview(it.file, opts);
      patch(it.id, { preview: p, error: null, status: 'ready', sheet: p.file.sheet || undefined, headerRow: p.file.header_row });
    } catch (e) {
      patch(it.id, { preview: null, error: toUploadError(e), status: 'error' });
    }
  };
  const run = (next: RunOpts = {}) => { if (active) previewOne(active, next); };
  /** 계정 이름을 바꾸면 아직 반영 안 한 파일 전부 다시 미리보기(겹침 계산이 계정 이름 기준) */
  const rerunAll = async () => {
    for (const it of itemsRef.current) if (it.status !== 'applied') await previewOne(it);
  };

  const addFiles = async (files: File[]) => {
    const fresh: Item[] = files.map((f) => ({
      id: ++itemSeq, file: f, mapping: {}, preview: null, error: null, status: 'reading',
    }));
    setItems((xs) => [...xs, ...fresh]);
    setActiveId(fresh[0]?.id ?? null);
    for (const it of fresh) await previewOne(it);  // 차례로 — 서버에 한꺼번에 몰지 않음
  };
  const removeItem = (id: number) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
    if (activeId === id) setActiveId(items.find((x) => x.id !== id)?.id ?? null);
  };

  // 반영 대기 — 기간이 이른 파일부터(겹치는 날짜는 나중에 반영되는 파일 값이 남는다)
  const pending = useMemo(
    () => items.filter((x) => x.status === 'ready' && x.preview?.can_apply)
      .sort((a, b) => (a.preview?.date_from || '').localeCompare(b.preview?.date_from || '')),
    [items],
  );
  const overlaps = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < pending.length; i++) {
      for (let j = i + 1; j < pending.length; j++) {
        const a = pending[i].preview!, b = pending[j].preview!;
        if (a.date_from && b.date_from && a.date_to && b.date_to && a.date_from <= b.date_to && b.date_from <= a.date_to) {
          const from = a.date_from > b.date_from ? a.date_from : b.date_from;
          const to = a.date_to < b.date_to ? a.date_to : b.date_to;
          out.push(`「${pending[i].file.name}」과 「${pending[j].file.name}」이 ${from}~${to}에 겹칩니다 — 그 날짜는 뒤 파일(「${pending[j].file.name}」) 값이 남습니다`);
        }
      }
    }
    return out;
  }, [pending]);

  const applyAll = async (list: Item[]) => {
    setApplying(true);
    const done: GfaUploadApplyResult[] = [];
    try {
      for (const it of list) {
        patch(it.id, { status: 'applying' });
        try {
          const res = await naverGFAApi.uploadApply(it.file, { accountLabel, sheet: it.sheet, headerRow: it.headerRow, mapping: it.mapping });
          patch(it.id, { status: 'applied', result: res });
          done.push(res);
        } catch (e) {
          patch(it.id, { status: 'ready' });
          toast.error(`「${it.file.name}」 반영 실패 — ${toUploadError(e).message}${done.length ? ` (앞의 ${done.length}개는 반영됨)` : ''}`);
          return;
        }
      }
    } finally {
      setApplying(false);
      if (done.length) qc.invalidateQueries({ queryKey: ['gfa-upload'] });
    }
    const ins = done.reduce((s, r) => s + r.inserted, 0);
    const rep = done.reduce((s, r) => s + r.replaced, 0);
    const from = done.map((r) => r.date_from).filter(Boolean).sort()[0];
    const to = done.map((r) => r.date_to).filter(Boolean).sort().pop();
    toast.success(`GFA 성과 반영 완료 — 파일 ${done.length}개 · ${from}~${to} · ${ins.toLocaleString('ko-KR')}행${rep ? ` (예전 ${rep.toLocaleString('ko-KR')}행 대체)` : ''}`);
    onApplied(done);
  };

  const { data: uploadStatus } = useQuery({
    queryKey: ['gfa-upload', 'status'],
    queryFn: () => naverGFAApi.uploadStatus(),
  });
  const coverage = uploadStatus?.coverage;

  const { data: history } = useQuery({
    queryKey: ['gfa-upload', 'batches'],
    queryFn: () => naverGFAApi.uploadBatches(),
    enabled: showHistory,
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => naverGFAApi.deleteUploadBatch(id),
    onSuccess: (r) => {
      toast.success(`업로드 기록을 지웠습니다 (${r.rows.toLocaleString('ko-KR')}행)`);
      qc.invalidateQueries({ queryKey: ['gfa-upload'] });
    },
    onError: () => toast.error('지우지 못했습니다'),
  });

  const colLabel = (i: number) => {
    const c = preview?.columns[i];
    return c ? `${c.letter}열 · ${c.header || '(빈 머리글)'}` : `${i + 1}번째 칸`;
  };
  const setField = (key: string, v: string) => {
    const next = { ...mapping };
    if (v === 'auto') delete next[key];
    else next[key] = v === 'none' ? null : Number(v);
    run({ mapping: next });
  };
  const resetMapping = () => { run({ mapping: {} }); };

  const unknownCols = useMemo(() => (preview?.columns || []).filter((c) => c.status === 'unknown'), [preview]);
  const ignoredCols = useMemo(() => (preview?.columns || []).filter((c) => c.status === 'ignored'), [preview]);
  const sheets = preview?.file.sheets || error?.sheets || [];
  const reading = items.some((x) => x.status === 'reading');
  const busy = reading || applying;
  const t = preview?.totals;
  const blocked = items.filter((x) => x.status === 'error' || (x.status === 'ready' && !x.preview?.can_apply));

  const submit = () => {
    if (!pending.length) return;
    let lines: string[];
    if (pending.length === 1) {
      const p = pending[0].preview!;
      const tt = p.totals;
      lines = [
        `GFA 성과 ${p.date_from} ~ ${p.date_to} (${p.days}일) · ${p.record_count.toLocaleString('ko-KR')}행을 반영합니다.`,
        `· 비용 ${won(tt.spend)}${p.spend_vat ? ` (${VAT_LABEL[p.spend_vat]})` : ''} · 전환 매출 ${won(tt.conv_sales)}${tt.roas != null ? ` · ROAS ${tt.roas.toFixed(2)}` : ''}`,
        p.replace.rows > 0
          ? `· 이미 올린 같은 계정·날짜 ${p.replace.rows.toLocaleString('ko-KR')}행은 이 파일 값으로 바뀝니다`
          : '· 겹치는 예전 데이터 없음 — 이미 올린 다른 날짜에 더해 쌓입니다',
      ];
    } else {
      lines = [
        `파일 ${pending.length}개를 기간이 이른 것부터 차례로 반영합니다 (이미 올린 다른 날짜에 더해 쌓임).`,
        ...pending.map((x, i) => {
          const p = x.preview!;
          return `${i + 1}. ${x.file.name} — ${p.date_from}~${p.date_to} · ${p.record_count.toLocaleString('ko-KR')}행 · 비용 ${won(p.totals.spend)}${p.replace.rows ? ` · 같은 날짜 예전 ${p.replace.rows.toLocaleString('ko-KR')}행 대체` : ''}`;
        }),
        ...(overlaps.length ? ['', ...overlaps.map((o) => `⚠ ${o}`)] : []),
        ...(blocked.length ? ['', `반영 못 하는 파일 ${blocked.length}개는 빼고 진행합니다.`] : []),
      ];
    }
    if (confirm([...lines, '', '진행할까요?'].join('\n'))) applyAll(pending);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }} onClick={() => !busy && items.length === 0 && onClose()}>
      <div className="w-full max-w-6xl rounded-xl p-5 max-h-[92vh] flex flex-col" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-3 shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">파일 올리기 — GFA 일별 성과</h3>
            <p className="text-[11px] text-text-tertiary mt-0.5 leading-relaxed">
              GFA 광고 관리자 <b className="text-text-secondary">보고서</b>에서 기간 단위를 <b className="text-text-secondary">일</b>로 두고 내려받은 CSV·엑셀(.xlsx) 파일을 그대로 올리세요.
              캠페인·광고그룹·소재까지 나눠 받으면 표가 더 자세해집니다. 미리보기에서는 아무것도 바뀌지 않습니다.
            </p>
          </div>
          <button onClick={onClose} disabled={busy} className="p-1 text-text-tertiary hover:text-text-primary disabled:opacity-40"><X size={16} /></button>
        </div>

        {/* 파일·계정·시트 */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <input ref={fileRef} type="file" multiple accept=".csv,.xlsx,.xls,.txt,.tsv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden"
            onChange={(e) => {
              const fs = Array.from(e.target.files || []);
              e.target.value = '';
              if (fs.length) addFiles(fs);
            }} />
          <button onClick={() => fileRef.current?.click()} disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-brand-bg)' }}
            title="여러 파일을 한 번에 고를 수 있습니다 (예: 1~2월, 3~4월 파일)">
            <Upload size={13} /> {items.length ? '파일 더 고르기' : '파일 선택 (여러 개 가능)'}
          </button>
          {items.length === 1 && file && <span className="text-xs text-text-secondary truncate max-w-[240px]" title={file.name}>{file.name}</span>}
          <label className="flex items-center gap-1.5 text-xs text-text-tertiary">
            계정 이름
            <input value={accountLabel} list="gfa-upload-accounts" placeholder="비우면 파일의 광고계정 칸"
              onChange={(e) => setAccountLabel(e.target.value)}
              onBlur={() => { if (items.length) rerunAll(); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              className="w-44 px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary" />
            <datalist id="gfa-upload-accounts">
              {accounts.filter(Boolean).map((a) => <option key={a} value={a} />)}
            </datalist>
          </label>
          {sheets.length > 1 && (
            <select value={sheet || ''} onChange={(e) => { run({ sheet: e.target.value, headerRow: undefined }); }} disabled={busy}
              className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary max-w-[220px]">
              {!sheet && <option value="">시트 고르기</option>}
              {sheets.map((s) => (
                <option key={s.name} value={s.name}>{s.name}{s.usable ? '' : ' — 성과 표 아님'}</option>
              ))}
            </select>
          )}
          {preview && (
            <label className="flex items-center gap-1.5 text-xs text-text-tertiary" title="머리글(칸 이름)이 있는 행 번호 — 잘못 잡혔을 때만 바꾸세요">
              머리글 행
              <input type="number" min={1} max={200} value={headerRow ?? ''}
                onChange={(e) => setHeaderRow(e.target.value ? Number(e.target.value) : undefined)}
                onBlur={() => { if (headerRow && headerRow !== preview.file.header_row) { run({ headerRow, mapping: {} }); } }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                className="w-16 px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary" />
            </label>
          )}
          {reading && <span className="text-xs text-text-tertiary">파일 읽는 중…</span>}
          <div className="flex-1" />
          <button onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-text-tertiary border border-border-primary hover:text-text-primary">
            <History size={12} /> 올린 기록
          </button>
        </div>

        {/* 지금까지 쌓인 날짜 — 60일씩 나눠 올릴 때 어디가 비었는지 */}
        {coverage && coverage.runs.length > 0 && (
          <div className="mt-2 text-[11px] text-text-tertiary shrink-0">
            지금까지 올린 날짜: {coverage.runs.map((r) => `${r.from}~${r.to}`).join(', ')}
            {coverage.gaps.length > 0 && <span className="text-yellow"> · 빈 구간 {coverage.gaps.map((g) => `${g.from}~${g.to}`).join(', ')}</span>}
            <span className="text-text-quaternary"> — 새 파일은 이 위에 쌓이고, 같은 날짜는 새 파일 값으로 바뀝니다</span>
          </div>
        )}

        {/* 고른 파일 목록 (여러 개) */}
        {items.length > 1 && (
          <div className="mt-2 rounded-lg overflow-x-auto shrink-0" style={{ border: '1px solid var(--color-border-primary)' }}>
            <table className="w-full min-w-[720px] text-[11px]">
              <thead>
                <tr className="text-text-tertiary" style={{ backgroundColor: 'var(--color-bg-level-2)' }}>
                  {['파일', '기간', '행', '비용', '같은 날짜 대체', '상태', ''].map((h, i) => (
                    <th key={i} className={`px-2 py-1.5 font-medium ${i >= 2 && i <= 4 ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((x) => {
                  const p = x.preview;
                  const st = x.status === 'reading' ? ['읽는 중…', 'text-text-tertiary']
                    : x.status === 'applying' ? ['반영 중…', 'text-text-tertiary']
                      : x.status === 'applied' ? ['반영됨', 'text-green']
                        : x.status === 'error' ? ['못 읽음', 'text-red']
                          : p?.can_apply ? ['반영 가능', 'text-text-secondary'] : ['고칠 것 있음', 'text-red'];
                  return (
                    <tr key={x.id} onClick={() => setActiveId(x.id)}
                      className="cursor-pointer"
                      style={{ borderTop: '1px solid var(--color-border-primary)', backgroundColor: x.id === activeId ? 'rgb(var(--color-overlay-rgb) / 0.05)' : undefined }}>
                      <td className="px-2 py-1 text-text-primary truncate max-w-[260px]" title={x.file.name}>{x.id === activeId ? '▸ ' : ''}{x.file.name}</td>
                      <td className="px-2 py-1 text-text-secondary whitespace-nowrap">{p?.date_from ? `${p.date_from} ~ ${p.date_to}` : '-'}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-text-secondary">{p ? num(p.record_count) : '-'}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-text-primary">{p ? won(p.totals.spend) : '-'}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-text-tertiary">{p ? num(p.replace.rows) : '-'}</td>
                      <td className={`px-2 py-1 whitespace-nowrap ${st[1]}`}>{st[0]}</td>
                      <td className="px-2 py-1 text-right">
                        {x.status !== 'applying' && (
                          <button onClick={(e) => { e.stopPropagation(); removeItem(x.id); }} disabled={busy}
                            className="p-0.5 rounded text-text-tertiary hover:text-red disabled:opacity-40" title="목록에서 빼기">
                            <X size={12} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {overlaps.length > 0 && (
              <div className="px-2 py-1.5 text-[11px] text-yellow space-y-0.5" style={{ borderTop: '1px solid var(--color-border-primary)' }}>
                {overlaps.map((o) => <div key={o}>⚠ {o}</div>)}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs text-red shrink-0" style={{ backgroundColor: 'rgb(var(--color-red-rgb) / 0.08)', border: '1px solid rgb(var(--color-red-rgb) / 0.3)' }}>
            <AlertTriangle size={14} className="shrink-0 mt-0.5" /> <span>{error.message}</span>
          </div>
        )}

        <div className="mt-3 flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
          {showHistory && (
            <div className="rounded-lg p-3" style={{ border: '1px solid var(--color-border-primary)', backgroundColor: 'var(--color-bg-level-2)' }}>
              <p className="text-xs font-semibold text-text-primary mb-2">올린 기록 <span className="font-normal text-text-tertiary">— 남은 행은 지금 기준(나중에 같은 날짜를 다시 올리면 줄어듭니다)</span></p>
              {!history ? (
                <p className="text-[11px] text-text-tertiary">불러오는 중…</p>
              ) : history.batches.length === 0 ? (
                <p className="text-[11px] text-text-tertiary">아직 올린 파일이 없습니다.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-[11px]">
                    <thead>
                      <tr className="text-text-tertiary">
                        <th className="text-left font-medium px-2 py-1">올린 때</th>
                        <th className="text-left font-medium px-2 py-1">파일</th>
                        <th className="text-left font-medium px-2 py-1">계정</th>
                        <th className="text-left font-medium px-2 py-1">기간</th>
                        <th className="text-right font-medium px-2 py-1">남은 행 / 올린 행</th>
                        <th className="text-right font-medium px-2 py-1">비용(남은 행)</th>
                        <th className="px-2 py-1" />
                      </tr>
                    </thead>
                    <tbody>
                      {history.batches.map((b) => (
                        <tr key={b.id} style={{ borderTop: '1px solid var(--color-border-primary)' }}>
                          <td className="px-2 py-1 text-text-secondary whitespace-nowrap">{b.created_at ? kst(b.created_at) : '-'}</td>
                          <td className="px-2 py-1 text-text-primary truncate max-w-[220px]" title={b.filename || ''}>{b.filename || '-'}</td>
                          <td className="px-2 py-1 text-text-secondary">{b.account_label || '기본'}</td>
                          <td className="px-2 py-1 text-text-secondary whitespace-nowrap">{b.date_from} ~ {b.date_to}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-text-secondary">{num(b.live_rows)} / {num(b.row_count)}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-text-primary">{won(b.live_spend)}</td>
                          <td className="px-2 py-1 text-right">
                            <button disabled={deleteMut.isPending}
                              onClick={() => { if (confirm(`이 업로드로 넣은 남은 ${b.live_rows.toLocaleString('ko-KR')}행을 지울까요?\n(${b.filename || ''} · ${b.date_from} ~ ${b.date_to})`)) deleteMut.mutate(b.id); }}
                              className="p-1 rounded text-text-tertiary hover:text-red disabled:opacity-40" title="이 업로드 지우기">
                              <Trash2 size={12} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {!preview && !error && !reading && (
            <div className="rounded-lg px-4 py-6 text-center text-xs text-text-tertiary space-y-1" style={{ border: '1px dashed var(--color-border-primary)' }}>
              <p>파일을 고르면 칸을 자동으로 알아보고 미리 보여 줍니다.</p>
              <p>GFA는 한 번에 60일까지만 내려받아지니 1~2월, 3~4월처럼 나눠 받은 파일을 <b className="text-text-secondary">한꺼번에 골라</b> 올리면 차례로 쌓입니다.</p>
              <p className="text-text-quaternary">알아보는 칸: 날짜·캠페인·광고그룹·소재·소재 유형·노출·클릭·비용(VAT 제외 우선)·전환 수·전환 매출(구매완료 우선)·예산·상품·프로모션</p>
            </div>
          )}

          {preview && t && (
            <>
              {/* 요약 */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
                <Sum title="기간" value={preview.date_from ? `${preview.date_from.slice(5)} ~ ${(preview.date_to || '').slice(5)}` : '-'} sub={`${preview.days}일 · ${(preview.date_from || '').slice(0, 4)}`} />
                <Sum title="행" value={`${preview.record_count.toLocaleString('ko-KR')}행`} sub={`${GRANULARITY_LABEL[preview.granularity]} · 파일 ${preview.data_rows.toLocaleString('ko-KR')}행`} />
                <Sum title="비용" value={won(t.spend)} sub={preview.spend_vat ? VAT_LABEL[preview.spend_vat] : 'VAT 표시 없음(파일 값 그대로)'} />
                <Sum title="전환 매출" value={won(t.conv_sales)} sub={t.roas != null ? `ROAS ${t.roas.toFixed(2)}` : '전환 매출 칸 없음'} />
                <Sum title="노출 · 클릭" value={`${num(t.impressions)} · ${num(t.clicks)}`} sub={`전환 ${num(t.conversions)}`} />
              </div>

              {preview.errors.length > 0 && (
                <div className="rounded-lg px-3 py-2 text-[11px] space-y-1" style={{ backgroundColor: 'rgb(var(--color-red-rgb) / 0.08)', border: '1px solid rgb(var(--color-red-rgb) / 0.3)' }}>
                  {preview.errors.map((w) => <div key={w} className="text-red">✕ {w}</div>)}
                </div>
              )}
              {(preview.warnings.length > 0 || preview.replace.rows > 0 || preview.replace.other_accounts.length > 0) && (
                <div className="rounded-lg px-3 py-2 text-[11px] space-y-1" style={{ backgroundColor: 'rgb(var(--color-yellow-rgb) / 0.07)', border: '1px solid rgb(var(--color-yellow-rgb) / 0.3)' }}>
                  {preview.replace.rows > 0 && (
                    <div className="text-text-primary">↻ 이미 올린 같은 계정·날짜 <b>{preview.replace.rows.toLocaleString('ko-KR')}행</b>은 이 파일 값으로 바뀝니다 (두 번 세지 않음)</div>
                  )}
                  {preview.replace.other_accounts.map((o) => (
                    <div key={o.account} className="text-yellow">
                      ⚠ 같은 날짜에 다른 계정 이름 「{o.account || '기본'}」 데이터 {o.rows.toLocaleString('ko-KR')}행({o.date_from}~{o.date_to})이 있습니다 — 같은 광고계정이면 계정 이름을 똑같이 맞춰야 두 번 세지 않습니다
                    </div>
                  ))}
                  {preview.warnings.map((w) => <div key={w} className="text-yellow">⚠ {w}</div>)}
                </div>
              )}

              {/* 칸 연결 */}
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <span className="text-xs font-semibold text-text-primary">칸 연결</span>
                  <span className="text-[11px] text-text-tertiary">
                    {preview.file.kind === 'xlsx' ? `엑셀${preview.file.sheet ? ` · ${preview.file.sheet}` : ''}` : preview.file.kind === 'html' ? 'HTML 표' : `CSV · ${preview.file.encoding || ''}${preview.file.delimiter ? ` · ${preview.file.delimiter}` : ''}`} · 머리글 {preview.file.header_row}행
                  </span>
                  <div className="flex-1" />
                  {Object.keys(mapping).length > 0 && (
                    <button onClick={resetMapping} disabled={busy} className="flex items-center gap-1 text-[11px] text-brand hover:opacity-80 disabled:opacity-40">
                      <RotateCcw size={10} /> 자동 연결로 되돌리기
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-4 gap-y-1.5 rounded-lg p-3" style={{ border: '1px solid var(--color-border-primary)' }}>
                  {preview.fields.map((f) => {
                    const v = f.key in mapping ? (mapping[f.key] === null ? 'none' : String(mapping[f.key])) : 'auto';
                    const autoText = f.columns.length === 0 ? '없음'
                      : f.columns.length > 1 ? f.columns.map((i) => `「${preview.columns[i]?.header}」`).join('+') + ' 합산'
                        : colLabel(f.columns[0]);
                    const missing = f.required && f.columns.length === 0;
                    return (
                      <label key={f.key} className="flex items-center gap-2 text-[11px] min-w-0">
                        <span className={`w-20 shrink-0 ${missing ? 'text-red font-semibold' : 'text-text-secondary'}`}>
                          {f.label}{f.required && <span className="text-red">*</span>}
                        </span>
                        <select value={v} disabled={busy} onChange={(e) => setField(f.key, e.target.value)}
                          className={`flex-1 min-w-0 px-1.5 py-1 rounded-md text-[11px] bg-bg-2 border text-text-primary ${f.manual ? 'border-brand' : missing ? 'border-red' : 'border-border-primary'}`}>
                          <option value="auto">자동: {autoText}</option>
                          <option value="none">쓰지 않음</option>
                          {preview.columns.filter((c) => c.status !== 'empty').map((c) => (
                            <option key={c.index} value={c.index}>{c.letter}열 · {c.header}</option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
                </div>
                {(unknownCols.length > 0 || ignoredCols.length > 0) && (
                  <div className="mt-1.5 text-[11px] text-text-tertiary space-y-0.5">
                    {unknownCols.length > 0 && (
                      <div>못 알아본 칸(쓰지 않음): {unknownCols.map((c) => `${c.letter}열 「${c.header}」`).join(', ')} <span className="text-text-quaternary">— 필요한 값이면 위에서 항목에 직접 연결하세요</span></div>
                    )}
                    {ignoredCols.length > 0 && (
                      <div className="text-text-quaternary">다시 계산하거나 쓰지 않는 칸: {ignoredCols.map((c) => c.header).join(', ')}</div>
                    )}
                  </div>
                )}
              </div>

              {/* 계정별 · 미리보기 행 */}
              {preview.accounts.length > 0 && (
                <div className="text-[11px] text-text-secondary">
                  계정별: {preview.accounts.map((a) => `${a.account || '기본'} ${a.days}일 ${a.rows.toLocaleString('ko-KR')}행 ${won(a.spend)}`).join(' · ')}
                </div>
              )}
              {preview.sample.length > 0 && (
                <div>
                  <button onClick={() => setShowSample((v) => !v)} className="flex items-center gap-1 text-xs font-semibold text-text-primary">
                    {showSample ? <ChevronDown size={12} /> : <ChevronRight size={12} />} 읽은 행 미리보기 <span className="font-normal text-text-tertiary">(앞 {preview.sample.length}행)</span>
                  </button>
                  {showSample && (
                    <div className="mt-1.5 rounded-lg overflow-x-auto" style={{ border: '1px solid var(--color-border-primary)' }}>
                      <table className="w-full min-w-[900px] text-[11px]">
                        <thead>
                          <tr className="text-text-tertiary" style={{ backgroundColor: 'var(--color-bg-level-2)' }}>
                            {['날짜', '계정', '캠페인', '광고그룹', '소재', '유형', '노출', '클릭', '비용', '전환', '전환 매출'].map((h, i) => (
                              <th key={h} className={`px-2 py-1.5 font-medium ${i >= 6 ? 'text-right' : 'text-left'}`}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {preview.sample.map((r, i) => (
                            <tr key={i} style={{ borderTop: '1px solid var(--color-border-primary)' }}>
                              <td className="px-2 py-1 text-text-secondary whitespace-nowrap">{r.date}</td>
                              <td className="px-2 py-1 text-text-secondary">{r.account || '기본'}</td>
                              <td className="px-2 py-1 text-text-primary truncate max-w-[160px]">{r.campaign_name || r.campaign_id || '-'}</td>
                              <td className="px-2 py-1 text-text-secondary truncate max-w-[140px]">{r.adgroup_name || r.adgroup_id || '-'}</td>
                              <td className="px-2 py-1 text-text-secondary truncate max-w-[160px]">{r.creative_name || r.creative_id || '-'}</td>
                              <td className="px-2 py-1 text-text-tertiary">{r.creative_type || '-'}</td>
                              <td className="px-2 py-1 text-right tabular-nums text-text-secondary">{num(r.impressions)}</td>
                              <td className="px-2 py-1 text-right tabular-nums text-text-secondary">{num(r.clicks)}</td>
                              <td className="px-2 py-1 text-right tabular-nums text-text-primary">{num(r.spend)}</td>
                              <td className="px-2 py-1 text-right tabular-nums text-text-secondary">{num(r.conversions)}</td>
                              <td className="px-2 py-1 text-right tabular-nums text-text-secondary">{num(r.conv_sales)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 mt-4 shrink-0">
          {items.length > 0 && (
            <span className="w-full sm:w-auto sm:mr-auto text-[11px] text-text-tertiary">
              {pending.length
                ? `반영하면 파일에 있는 계정·날짜만 파일 값으로 바뀌고 다른 날짜는 그대로 쌓여 있습니다${blocked.length ? ` · 고칠 것 있는 파일 ${blocked.length}개는 빼고 반영` : ''}`
                : items.every((x) => x.status === 'applied') ? '모두 반영했습니다'
                  : reading ? '파일 읽는 중…' : '빨간 항목을 고쳐야 반영할 수 있습니다'}
            </span>
          )}
          <button onClick={onClose} disabled={busy} className="shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg text-xs text-text-tertiary border border-border-primary disabled:opacity-40">닫기</button>
          <button onClick={submit} disabled={!pending.length || busy}
            className="shrink-0 whitespace-nowrap flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-brand-bg)' }}>
            <Check size={13} /> {applying ? '반영 중…' : pending.length > 1 ? `${pending.length}개 파일 반영하기` : '반영하기'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Sum({ title, value, sub }: { title: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)' }}>
      <div className="text-[11px] text-text-tertiary">{title}</div>
      <div className="text-sm font-semibold text-text-primary tabular-nums mt-0.5 truncate" title={value}>{value}</div>
      <div className="text-[10px] text-text-quaternary truncate" title={sub}>{sub}</div>
    </div>
  );
}
