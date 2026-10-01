'use client';

/**
 * 월 목표 입력 — 계획 기입의 단일 창구 (2026-10 메뉴 속성 재편).
 *
 * 자사몰 목표(CAC·LTV·전환율·AOV·신규고객)와 외부 채널 목표(광고비·매출)를
 * 한 화면에서 월 단위로 기입한다. 기존 값 프리필 후 수정 저장.
 * 광고비 Limit(매체별 월 한도)은 광고비 일보에서, 활동 계획은 활동 기록에서.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Check, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { kpiApi, externalKpiApi } from '@/lib/api';
import { useAppStore } from '@/store';

const thisMonth = () => new Date().toISOString().slice(0, 7);

function monthAdd(month: string, delta: number): string {
  const y = parseInt(month.slice(0, 4), 10);
  const m = parseInt(month.slice(5, 7), 10);
  const t = y * 12 + (m - 1) + delta;
  return `${String(Math.floor(t / 12)).padStart(4, '0')}-${String((t % 12) + 1).padStart(2, '0')}`;
}

function Field({ label, value, onChange, step }: {
  label: string; value: string; onChange: (v: string) => void; step?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-text-tertiary">{label}</span>
      <input
        type="number" step={step || '1'} value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary tabular-nums"
      />
    </label>
  );
}

const n = (v: string) => (v.trim() === '' ? null : Number(v));
const s = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

export function GoalEntry() {
  const qc = useQueryClient();
  const { setActiveMenu, setMenuSubTab } = useAppStore();
  const [month, setMonth] = useState(thisMonth());

  const { data: mallGoals } = useQuery({ queryKey: ['kpi', 'goals'], queryFn: () => kpiApi.listGoals(24, 6) });
  const { data: extGoals } = useQuery({ queryKey: ['kpi', 'ext-goals'], queryFn: () => externalKpiApi.listGoals(24, 6) });

  const [mall, setMall] = useState({ cac: '', ltv: '', ltvCac: '', conv: '', aov: '', newCust: '', memo: '' });
  const [ext, setExt] = useState({ spend: '', revenue: '', manual: '', memo: '' });

  // 월 변경/데이터 도착 시 프리필
  useEffect(() => {
    const g = (mallGoals || []).find((x) => x.month === month);
    setMall({
      cac: s(g?.target_cac), ltv: s(g?.target_ltv), ltvCac: s(g?.target_ltv_cac),
      conv: s(g?.target_conversion_rate), aov: s(g?.target_aov),
      newCust: s(g?.target_new_customers), memo: g?.memo || '',
    });
  }, [month, mallGoals]);
  useEffect(() => {
    const g = (extGoals || []).find((x) => x.month === month);
    setExt({
      spend: s(g?.target_spend), revenue: s(g?.target_revenue),
      manual: s(g?.actual_revenue_manual), memo: g?.memo || '',
    });
  }, [month, extGoals]);

  const mallMut = useMutation({
    mutationFn: () => kpiApi.updateGoal(month, {
      target_cac: n(mall.cac), target_ltv: n(mall.ltv), target_ltv_cac: n(mall.ltvCac),
      target_conversion_rate: n(mall.conv), target_aov: n(mall.aov),
      target_new_customers: n(mall.newCust), memo: mall.memo || null,
    }),
    onSuccess: () => { toast.success(`${month} 자사몰 목표 저장`); qc.invalidateQueries({ queryKey: ['kpi'] }); },
    onError: () => toast.error('저장 실패'),
  });
  const extMut = useMutation({
    mutationFn: () => externalKpiApi.updateGoal(month, {
      target_spend: n(ext.spend), target_revenue: n(ext.revenue),
      actual_revenue_manual: n(ext.manual), memo: ext.memo || null,
    }),
    onSuccess: () => { toast.success(`${month} 외부 채널 목표 저장`); qc.invalidateQueries({ queryKey: ['kpi'] }); },
    onError: () => toast.error('저장 실패'),
  });

  const card = 'rounded-xl p-4 space-y-3';
  const cardStyle = { backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h2 className="text-base font-semibold text-text-primary">월 목표 입력</h2>
          <p className="text-xs text-text-tertiary mt-0.5">
            달성 여부는 <b className="text-text-secondary">성과 분석</b>에서 확인됩니다 — 다음 달 목표는 미리 입력해 두세요
          </p>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <button onClick={() => setMonth(monthAdd(month, -1))} className="p-1.5 rounded-lg border border-border-primary text-text-tertiary hover:text-text-primary"><ChevronLeft size={13} /></button>
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary" />
          <button onClick={() => setMonth(monthAdd(month, 1))} className="p-1.5 rounded-lg border border-border-primary text-text-tertiary hover:text-text-primary"><ChevronRight size={13} /></button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 자사몰 목표 */}
        <div className={card} style={cardStyle}>
          <h3 className="text-sm font-semibold text-text-primary">자사몰 목표 ({parseInt(month.slice(5), 10)}월)</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label="목표 CAC (₩)" value={mall.cac} onChange={(v) => setMall({ ...mall, cac: v })} />
            <Field label="목표 LTV (₩)" value={mall.ltv} onChange={(v) => setMall({ ...mall, ltv: v })} />
            <Field label="목표 LTV/CAC" value={mall.ltvCac} onChange={(v) => setMall({ ...mall, ltvCac: v })} step="0.01" />
            <Field label="목표 구매전환율 (%)" value={mall.conv} onChange={(v) => setMall({ ...mall, conv: v })} step="0.01" />
            <Field label="목표 AOV (₩)" value={mall.aov} onChange={(v) => setMall({ ...mall, aov: v })} />
            <Field label="목표 신규 고객수" value={mall.newCust} onChange={(v) => setMall({ ...mall, newCust: v })} />
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-text-tertiary">메모</span>
            <input value={mall.memo} onChange={(e) => setMall({ ...mall, memo: e.target.value })}
              className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary" />
          </label>
          <button onClick={() => mallMut.mutate()} disabled={mallMut.isPending}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-brand-bg)' }}>
            {mallMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} 자사몰 목표 저장
          </button>
        </div>

        {/* 외부 채널 목표 */}
        <div className={card} style={cardStyle}>
          <h3 className="text-sm font-semibold text-text-primary">외부 채널 목표 ({parseInt(month.slice(5), 10)}월)</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label="목표 광고비 (₩)" value={ext.spend} onChange={(v) => setExt({ ...ext, spend: v })} />
            <Field label="목표 매출 (₩)" value={ext.revenue} onChange={(v) => setExt({ ...ext, revenue: v })} />
            <Field label="매출 보정 (₩)" value={ext.manual} onChange={(v) => setExt({ ...ext, manual: v })} />
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-text-tertiary">메모</span>
            <input value={ext.memo} onChange={(e) => setExt({ ...ext, memo: e.target.value })}
              className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary" />
          </label>
          <button onClick={() => extMut.mutate()} disabled={extMut.isPending}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-brand-bg)' }}>
            {extMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} 외부 목표 저장
          </button>
        </div>
      </div>

      {/* 다른 계획 입력 바로가기 */}
      <div className="rounded-xl px-4 py-3 flex flex-wrap items-center gap-3 text-xs text-text-tertiary" style={cardStyle}>
        <span>이 화면 밖의 계획 입력:</span>
        <button onClick={() => setMenuSubTab('input', 0)} className="text-text-secondary hover:text-text-primary underline decoration-dotted">
          매체별 월 Limit → 광고비 일보
        </button>
        <button onClick={() => setMenuSubTab('input', 1)} className="text-text-secondary hover:text-text-primary underline decoration-dotted">
          콘텐츠·시딩 계획 → 활동 기록(계획 탭)
        </button>
        <button onClick={() => { setActiveMenu('affiliate'); setMenuSubTab('affiliate', 0); }} className="text-text-secondary hover:text-text-primary underline decoration-dotted">
          공구 매출 목표 → 공구 보드
        </button>
      </div>
    </div>
  );
}
