'use client';

/** 자사몰 여정·스크롤 화면 공통 조각 (기간 고르기·구역 상자·숫자 형식). */
import { Info } from 'lucide-react';

export const BRAND = 'var(--color-brand-bg)';
export const tooltipStyle = {
  backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)', borderRadius: 8, fontSize: 12,
};
export const tick = { fontSize: 10, fill: 'var(--color-text-tertiary)' };

export const fmtN = (v: number | null | undefined) => (v === null || v === undefined ? '-' : Math.round(v).toLocaleString('ko-KR'));
export const fmtP = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '-' : `${v.toFixed(d)}%`);
export const md = (iso: string | null | undefined) => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : '-');

/** 오늘(한국 시간) 기준 YYYY-MM-DD */
export function kstToday(): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function Section({ title, sub, right, children }: {
  title: string; sub?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="bg-bg-1 rounded-xl p-4 sm:p-5" style={{ border: '1px solid var(--color-border-primary)' }}>
      <div className="flex flex-wrap items-start gap-2 mb-3">
        <div>
          <h2 className="text-base font-semibold text-text-primary">{title}</h2>
          {sub && <p className="text-[11px] text-text-tertiary mt-0.5">{sub}</p>}
        </div>
        <div className="flex-1" />
        {right}
      </div>
      {children}
    </section>
  );
}

export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs text-text-tertiary" style={{ border: '1px dashed var(--color-border-primary)' }}>
      <Info size={13} className="shrink-0 mt-0.5" /> <span>{children}</span>
    </div>
  );
}

export function Seg<T extends string | number>({ value, options, onChange }: {
  value: T; options: { v: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg p-0.5 flex-wrap" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.06)' }}>
      {options.map((o) => (
        <button
          key={String(o.v)}
          onClick={() => onChange(o.v)}
          className="px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap"
          style={value === o.v ? { backgroundColor: 'var(--color-bg-level-1)', color: 'var(--color-text-primary)' } : { color: 'var(--color-text-tertiary)' }}
        >{o.label}</button>
      ))}
    </div>
  );
}

export function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-xl px-4 py-3 bg-bg-1" style={{ border: '1px solid var(--color-border-primary)' }}>
      <div className="text-[11px] text-text-tertiary">{label}</div>
      <div className="text-xl font-semibold text-text-primary tabular-nums mt-0.5">{value}</div>
      {sub && <div className="text-[11px] text-text-tertiary mt-0.5">{sub}</div>}
    </div>
  );
}

/** 기간: 빠른 선택(최근 N일) + 직접 고르기 */
export function PeriodPicker({ start, end, onChange, quick = [7, 14, 30] }: {
  start: string; end: string; onChange: (s: string, e: string) => void; quick?: number[];
}) {
  const today = kstToday();
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  const quickOn = end === today ? days : -1;
  const inputCls = 'bg-bg-2 rounded-md px-2 py-1 text-xs text-text-primary tabular-nums';
  const inputStyle = { border: '1px solid var(--color-border-primary)' };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Seg value={quickOn} options={quick.map((n) => ({ v: n, label: `최근 ${n}일` }))} onChange={(n) => onChange(addDays(today, -(n - 1)), today)} />
      <input type="date" className={inputCls} style={inputStyle} value={start} max={end} onChange={(e) => e.target.value && onChange(e.target.value, end)} />
      <span className="text-xs text-text-tertiary">~</span>
      <input type="date" className={inputCls} style={inputStyle} value={end} min={start} max={today} onChange={(e) => e.target.value && onChange(start, e.target.value)} />
    </div>
  );
}

/** 가로 막대 한 줄 (이름 · 막대 · 값) */
export function BarRow({ label, share, right, color = BRAND }: { label: string; share: number | null; right: React.ReactNode; color?: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="w-28 shrink-0 truncate text-text-secondary" title={label}>{label}</div>
      <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.06)' }}>
        <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, share ?? 0))}%`, backgroundColor: color }} />
      </div>
      <div className="w-24 shrink-0 text-right tabular-nums text-text-secondary">{right}</div>
    </div>
  );
}
