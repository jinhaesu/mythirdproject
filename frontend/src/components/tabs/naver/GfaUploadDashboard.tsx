'use client';

/**
 * GFA 성과 대시보드 — 올린 성과 파일(광고 관리자 보고서) 값으로 그린다 (2026-10-27 마케팅 건의).
 *
 * 1) 핵심 KPI 요약 — 총 광고비·총 전환 매출·ROAS·전환 수·CPA·CTR·CPC·CVR (직전 같은 길이 기간 대비)
 * 2) 광고 성과 추이 — 일별·주별·월별 (광고비·전환 매출 / ROAS / 클릭 / 전환 / CPA / CPC) + 전주·전월 대비
 * 3) 캠페인별 — 광고비·매출·ROAS·CPA·CTR·예산 소진율·고효율/저효율(roasClass)·매출 기여도
 * 4) 소재별 — 노출·클릭·CTR·CPC·ROAS, 이미지형·동영상형 비교, 상품별·프로모션별 비교
 * 파일에 없는 칸이 필요한 표는 그렇다고 알려 준다.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as ReTooltip, Legend, ReferenceLine,
} from 'recharts';
import { Loader2, Upload, FileSpreadsheet, Info, TrendingUp, Layers, Image as ImageIcon, Tag } from 'lucide-react';
import {
  naverGFAApi,
  type GfaChangeKey, type GfaPerf, type GfaSeriesPoint, type GfaUploadDashboardData,
} from '@/lib/naver-api';
import {
  BREAKEVEN_ROAS, BREAKEVEN_ROAS_LABEL, BREAKEVEN_ROAS_LOW, roasClass,
  fmtWon, fmtRatio, fmtPercent, fmtNum,
} from '../kpi/format';
import { kst, VAT_LABEL } from './GfaUploadModal';

type Unit = 'daily' | 'weekly' | 'monthly';
const UNIT_LABEL: Record<Unit, string> = { daily: '일별', weekly: '주별', monthly: '월별' };
const PREV_LABEL: Record<Unit, string> = { daily: '전일', weekly: '전주', monthly: '전월' };

const C = { spend: '#4EA7FC', sales: '#27A644', roas: '#F0BF00', clicks: '#7070FF', conv: '#27A644', cost: '#4EA7FC' };
const tooltipStyle = { backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)', borderRadius: 8, fontSize: 12 };
const tick = { fontSize: 10, fill: 'var(--color-text-tertiary)' };
const fmtAxis = (v: number) =>
  Math.abs(v) >= 1e8 ? `${(v / 1e8).toFixed(1)}억` : Math.abs(v) >= 1e4 ? `${Math.round(v / 1e4).toLocaleString()}만` : String(v);

/** 효율 구분 — format.ts roasClass(손익분기 3.1~3.3 기준) 그대로 */
const EFFICIENCY: Record<string, { label: string; badge: string }> = {
  'text-green': { label: '고효율', badge: 'bg-green/15 text-green' },
  'text-yellow': { label: '개선 필요', badge: 'bg-yellow/15 text-yellow' },
  'text-red': { label: '저효율', badge: 'bg-red/15 text-red' },
};
const efficiencyOf = (roas: number | null | undefined) => EFFICIENCY[roasClass(roas)] || null;

/** 증감률 표시 — better: 'up'(클수록 좋음) | 'down'(작을수록 좋음) | 'neutral' */
function Delta({ v, better = 'up', suffix }: { v: number | null | undefined; better?: 'up' | 'down' | 'neutral'; suffix?: string }) {
  if (v === null || v === undefined) return <span className="text-text-quaternary">-</span>;
  const good = better === 'neutral' ? null : better === 'up' ? v > 0 : v < 0;
  const cls = v === 0 || good === null ? 'text-text-tertiary' : good ? 'text-green' : 'text-red';
  return (
    <span className={`tabular-nums ${cls}`}>
      {v > 0 ? '▲' : v < 0 ? '▼' : ''}{Math.abs(v).toFixed(1)}%{suffix ? <span className="text-text-quaternary"> {suffix}</span> : null}
    </span>
  );
}

function Card({ title, icon, right, children }: { title: string; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-bg-1 rounded-xl border border-border-primary p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h2 className="text-base font-semibold text-text-primary flex items-center gap-2">{icon}{title}</h2>
        <div className="flex-1" />
        {right}
      </div>
      {children}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs text-text-tertiary" style={{ border: '1px dashed var(--color-border-primary)' }}>
      <Info size={13} className="shrink-0 mt-0.5" /> <span>{children}</span>
    </div>
  );
}

function MiniChart({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)' }}>
      <p className="text-xs font-medium text-text-secondary mb-2">{title}</p>
      <div style={{ width: '100%', height: 190 }}>
        <ResponsiveContainer>{children}</ResponsiveContainer>
      </div>
    </div>
  );
}

type GroupRow = GfaPerf & { label: string; sub?: string | null };

/** 묶음별 성과 표 (소재 유형·상품·프로모션) */
function PerfTable({ rows, first }: { rows: GroupRow[]; first: string }) {
  const total = rows.reduce((s, r) => s + (r.spend || 0), 0);
  return (
    <div className="rounded-lg overflow-x-auto" style={{ border: '1px solid var(--color-border-primary)' }}>
      <table className="w-full min-w-[760px] text-xs">
        <thead>
          <tr className="text-text-tertiary" style={{ backgroundColor: 'var(--color-bg-level-2)' }}>
            {[first, '광고비', '비중', '노출', '클릭', 'CTR', 'CPC', '전환', '전환 매출', 'ROAS', 'CPA'].map((h, i) => (
              <th key={h} className={`px-2.5 py-2 font-medium ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label + (r.sub || '')} style={{ borderTop: '1px solid var(--color-border-primary)' }}>
              <td className="px-2.5 py-1.5 text-text-primary">
                {r.label}{r.sub ? <span className="text-text-quaternary"> · {r.sub}</span> : null}
              </td>
              <td className="px-2.5 py-1.5 text-right tabular-nums text-text-primary">{fmtWon(r.spend)}</td>
              <td className="px-2.5 py-1.5 text-right tabular-nums text-text-tertiary">{total ? `${((r.spend / total) * 100).toFixed(1)}%` : '-'}</td>
              <td className="px-2.5 py-1.5 text-right tabular-nums text-text-secondary">{fmtNum(r.impressions)}</td>
              <td className="px-2.5 py-1.5 text-right tabular-nums text-text-secondary">{fmtNum(r.clicks)}</td>
              <td className="px-2.5 py-1.5 text-right tabular-nums text-text-secondary">{fmtPercent(r.ctr)}</td>
              <td className="px-2.5 py-1.5 text-right tabular-nums text-text-secondary">{fmtWon(r.cpc)}</td>
              <td className="px-2.5 py-1.5 text-right tabular-nums text-text-secondary">{fmtNum(r.conversions)}</td>
              <td className="px-2.5 py-1.5 text-right tabular-nums text-text-secondary">{fmtWon(r.conv_sales)}</td>
              <td className={`px-2.5 py-1.5 text-right tabular-nums font-medium ${roasClass(r.roas)}`}>{fmtRatio(r.roas)}</td>
              <td className="px-2.5 py-1.5 text-right tabular-nums text-text-secondary">{fmtWon(r.cpa)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GfaUploadDashboard({ dateRange, startDate, endDate, accounts, onUpload, onShowAll }: {
  dateRange: string;
  startDate?: string;
  endDate?: string;
  accounts: string[];
  onUpload: () => void;
  onShowAll: () => void;
}) {
  const [account, setAccount] = useState<string>('__all__');
  const [unit, setUnit] = useState<Unit>('daily');
  const [campSort, setCampSort] = useState<'spend' | 'conv_sales' | 'roas'>('spend');
  const [allCreatives, setAllCreatives] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['gfa-upload', 'dashboard', dateRange, startDate, endDate, account],
    queryFn: () => naverGFAApi.uploadDashboard(dateRange, startDate, endDate, account === '__all__' ? undefined : account),
    retry: 1,
  });
  const d = data && data.has_data ? (data as GfaUploadDashboardData) : null;

  const series: GfaSeriesPoint[] = useMemo(() => (d ? d.series[unit] : []), [d, unit]);
  const campaigns = useMemo(() => {
    if (!d) return [];
    const list = [...d.campaigns];
    list.sort((a, b) => ((b[campSort] ?? -1) as number) - ((a[campSort] ?? -1) as number));
    return list;
  }, [d, campSort]);
  const effSummary = useMemo(() => {
    const out: Record<string, { n: number; spend: number }> = {};
    (d?.campaigns || []).forEach((c) => {
      const e = efficiencyOf(c.roas);
      if (!e) return;
      out[e.label] = { n: (out[e.label]?.n || 0) + 1, spend: (out[e.label]?.spend || 0) + c.spend };
    });
    return out;
  }, [d]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-green" size={28} />
        <span className="ml-3 text-text-tertiary">올린 GFA 성과 불러오는 중...</span>
      </div>
    );
  }
  if (isError) {
    return <Notice>올린 GFA 성과를 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.</Notice>;
  }
  if (!d) {
    if (account !== '__all__') {
      return (
        <Notice>
          「{account || '기본'}」 계정으로 올린 데이터가 없습니다.{' '}
          <button onClick={() => setAccount('__all__')} className="underline text-text-secondary">전체 계정 보기</button>
        </Notice>
      );
    }
    return (
      <div className="bg-bg-1 rounded-xl border border-border-primary p-6 text-center space-y-3">
        <FileSpreadsheet size={40} className="mx-auto text-text-quaternary" />
        <p className="text-sm font-medium text-text-primary">아직 올린 GFA 성과 파일이 없습니다</p>
        <div className="text-xs text-text-tertiary space-y-1 max-w-xl mx-auto text-left">
          <p>1. GFA 광고 관리자 → <b className="text-text-secondary">보고서</b>에서 기간 단위를 <b className="text-text-secondary">일</b>로 두고, 캠페인·광고그룹·소재로 나눠 보기를 켭니다.</p>
          <p>2. 지표에 노출·클릭·총 비용·전환수·전환 매출(구매완료면 더 좋음)을 넣고 CSV 또는 엑셀로 내려받습니다.</p>
          <p>3. 오른쪽 위 <b className="text-text-secondary">파일 올리기</b> → 미리보기 확인 → 반영하면 이 화면이 그 값으로 채워집니다.</p>
        </div>
        <button onClick={onUpload} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-90" style={{ backgroundColor: 'var(--color-brand-bg)' }}>
          <Upload size={14} /> 파일 올리기
        </button>
      </div>
    );
  }

  const k = d.kpi;
  const ch: Partial<Record<GfaChangeKey, number | null>> = d.kpi_change || {};
  const av = d.availability;
  const prevText = `직전 ${d.period.days}일 대비`;
  const empty = k.days === 0;
  const vatText = d.spend_vat.length === 1 && d.spend_vat[0] ? VAT_LABEL[d.spend_vat[0]] : d.spend_vat.length > 1 ? 'VAT 기준 섞임(파일마다 다름)' : 'VAT 표시 없음';

  const kpiCards: { key: GfaChangeKey; label: string; value: string; better: 'up' | 'down' | 'neutral'; cls?: string; sub?: string }[] = [
    { key: 'spend', label: '총 광고비', value: fmtWon(k.spend), better: 'neutral', sub: vatText },
    { key: 'conv_sales', label: '총 전환 매출', value: fmtWon(k.conv_sales), better: 'up' },
    { key: 'roas', label: 'ROAS', value: fmtRatio(k.roas), better: 'up', cls: roasClass(k.roas), sub: BREAKEVEN_ROAS_LABEL },
    { key: 'conversions', label: '전환 수', value: fmtNum(k.conversions), better: 'up' },
    { key: 'cpa', label: 'CPA', value: fmtWon(k.cpa), better: 'down', sub: '광고비 ÷ 전환 수' },
    { key: 'ctr', label: 'CTR', value: fmtPercent(k.ctr), better: 'up', sub: `노출 ${fmtNum(k.impressions)}` },
    { key: 'cpc', label: 'CPC', value: fmtWon(k.cpc), better: 'down', sub: `클릭 ${fmtNum(k.clicks)}` },
    { key: 'cvr', label: 'CVR', value: fmtPercent(k.cvr), better: 'up', sub: '전환 수 ÷ 클릭' },
  ];

  const many = series.length > 31;
  const lineProps = { type: 'monotone' as const, strokeWidth: 2, dot: many ? false : { r: 2.5 }, connectNulls: true };
  const xProps = { dataKey: 'label', tick, interval: 'preserveStartEnd' as const, minTickGap: 12 };

  return (
    <div className="space-y-5">
      {/* 데이터 출처 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)' }}>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-green/15 text-green font-medium"><FileSpreadsheet size={12} /> 업로드 파일 데이터</span>
        <span className="text-text-secondary">조회 {d.period.start} ~ {d.period.end}</span>
        <span className="text-text-tertiary">올린 기간 {d.data_span.min} ~ {d.data_span.max}</span>
        {d.last_upload?.created_at && (
          <span className="text-text-tertiary">마지막 업로드 {kst(d.last_upload.created_at)}{d.last_upload.filename ? ` · ${d.last_upload.filename}` : ''}</span>
        )}
        <div className="flex-1" />
        {accounts.length > 1 && (
          <select value={account} onChange={(e) => setAccount(e.target.value)}
            className="px-2 py-1 rounded-lg text-xs bg-bg-1 border border-border-primary text-text-primary">
            <option value="__all__">전체 계정</option>
            {accounts.map((a) => <option key={a} value={a}>{a || '기본'}</option>)}
          </select>
        )}
      </div>

      {empty ? (
        <Notice>
          선택한 기간({d.period.start} ~ {d.period.end})에는 올린 데이터가 없습니다. 올린 기간은 {d.data_span.min} ~ {d.data_span.max}입니다.{' '}
          <button onClick={onShowAll} className="underline text-text-secondary">올린 전체 기간 보기</button>
        </Notice>
      ) : (
        <>
          {d.missing_days > 0 && (
            <Notice>선택한 {d.period.days}일 중 {d.missing_days}일은 올린 데이터가 없습니다 — 그 날짜는 0이 아니라 빈 날로 두었습니다.</Notice>
          )}

          {/* 1. 핵심 KPI */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {kpiCards.map((c) => (
              <div key={c.key} className="bg-bg-1 rounded-xl border border-border-primary p-4" title={d.kpi_prev ? `${d.period.prev_start} ~ ${d.period.prev_end} 대비` : '직전 기간 데이터 없음'}>
                <div className="text-xs text-text-tertiary font-medium">{c.label}</div>
                <div className={`text-lg font-bold tabular-nums mt-1 ${c.cls || 'text-text-primary'}`}>{c.value}</div>
                <div className="flex flex-wrap items-center gap-x-2 text-[11px] mt-0.5">
                  <Delta v={ch[c.key]} better={c.better} suffix={ch[c.key] != null ? prevText : undefined} />
                </div>
                {c.sub && <div className="text-[10px] text-text-quaternary mt-0.5 truncate">{c.sub}</div>}
              </div>
            ))}
          </div>
          {!av.conv_sales && <Notice>파일에 전환 매출 칸이 없어 ROAS·전환 매출이 비어 있습니다. 전환 매출이 든 보고서로 다시 올리면 채워집니다.</Notice>}

          {/* 2. 추이 */}
          <Card title="광고 성과 추이" icon={<TrendingUp size={18} className="text-green" />}
            right={
              <div className="flex items-center rounded-lg p-0.5" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.05)' }}>
                {(['daily', 'weekly', 'monthly'] as Unit[]).map((u) => (
                  <button key={u} onClick={() => setUnit(u)}
                    className="px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors"
                    style={unit === u ? { backgroundColor: 'var(--color-brand-bg)', color: '#fff' } : { color: 'var(--color-text-tertiary)' }}>
                    {UNIT_LABEL[u]}
                  </button>
                ))}
              </div>
            }>
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
              <MiniChart title="광고비 · 전환 매출">
                <LineChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
                  <XAxis {...xProps} />
                  <YAxis tickFormatter={fmtAxis} tick={tick} width={48} />
                  <ReTooltip formatter={(v: number, n: string) => [fmtWon(Number(v)), n]} contentStyle={tooltipStyle} labelStyle={{ color: 'var(--color-text-secondary)' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line {...lineProps} dataKey="spend" name="광고비" stroke={C.spend} />
                  {av.conv_sales && <Line {...lineProps} dataKey="conv_sales" name="전환 매출" stroke={C.sales} />}
                </LineChart>
              </MiniChart>
              <MiniChart title="ROAS">
                <LineChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
                  <XAxis {...xProps} />
                  <YAxis tick={tick} width={36} domain={[0, (max: number) => Math.max(Math.ceil((max || 0) + 0.5), 4)]} />
                  <ReTooltip formatter={(v: number) => [fmtRatio(Number(v)), 'ROAS']} contentStyle={tooltipStyle} labelStyle={{ color: 'var(--color-text-secondary)' }} />
                  <ReferenceLine y={BREAKEVEN_ROAS} stroke="#EA4335" strokeDasharray="5 4" label={{ value: BREAKEVEN_ROAS_LABEL, position: 'insideTopRight', fontSize: 9, fill: '#EA4335' }} />
                  <Line {...lineProps} dataKey="roas" name="ROAS" stroke={C.roas} />
                </LineChart>
              </MiniChart>
              <MiniChart title="클릭 수">
                <BarChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" vertical={false} />
                  <XAxis {...xProps} />
                  <YAxis tickFormatter={fmtAxis} tick={tick} width={40} />
                  <ReTooltip formatter={(v: number) => [fmtNum(Number(v)), '클릭']} contentStyle={tooltipStyle} labelStyle={{ color: 'var(--color-text-secondary)' }} />
                  <Bar dataKey="clicks" fill={C.clicks} radius={[2, 2, 0, 0]} maxBarSize={28} />
                </BarChart>
              </MiniChart>
              <MiniChart title="전환 수">
                <BarChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" vertical={false} />
                  <XAxis {...xProps} />
                  <YAxis tickFormatter={fmtAxis} tick={tick} width={40} allowDecimals={false} />
                  <ReTooltip formatter={(v: number) => [fmtNum(Number(v)), '전환']} contentStyle={tooltipStyle} labelStyle={{ color: 'var(--color-text-secondary)' }} />
                  <Bar dataKey="conversions" fill={C.conv} radius={[2, 2, 0, 0]} maxBarSize={28} />
                </BarChart>
              </MiniChart>
              <MiniChart title="CPA (전환당 광고비)">
                <LineChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
                  <XAxis {...xProps} />
                  <YAxis tickFormatter={fmtAxis} tick={tick} width={48} />
                  <ReTooltip formatter={(v: number) => [fmtWon(Number(v)), 'CPA']} contentStyle={tooltipStyle} labelStyle={{ color: 'var(--color-text-secondary)' }} />
                  <Line {...lineProps} dataKey="cpa" name="CPA" stroke={C.cost} />
                </LineChart>
              </MiniChart>
              <MiniChart title="CPC (클릭당 광고비)">
                <LineChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
                  <XAxis {...xProps} />
                  <YAxis tickFormatter={fmtAxis} tick={tick} width={48} />
                  <ReTooltip formatter={(v: number) => [fmtWon(Number(v)), 'CPC']} contentStyle={tooltipStyle} labelStyle={{ color: 'var(--color-text-secondary)' }} />
                  <Line {...lineProps} dataKey="cpc" name="CPC" stroke={C.cost} />
                </LineChart>
              </MiniChart>
            </div>

            {/* 전주·전월 대비 증감 */}
            <div className="mt-4">
              <p className="text-xs font-semibold text-text-primary mb-1.5">
                {UNIT_LABEL[unit]} 증감 <span className="font-normal text-text-tertiary">— {PREV_LABEL[unit]} 대비 · (일부)는 고른 기간이 그 {unit === 'weekly' ? '주' : unit === 'monthly' ? '달' : '날'}을 다 덮지 않음</span>
              </p>
              <div className="rounded-lg overflow-x-auto" style={{ border: '1px solid var(--color-border-primary)' }}>
                <table className="w-full min-w-[860px] text-xs">
                  <thead>
                    <tr className="text-text-tertiary" style={{ backgroundColor: 'var(--color-bg-level-2)' }}>
                      {['기간', '광고비', '전환 매출', 'ROAS', '전환 수', 'CPA', 'CPC'].map((h, i) => (
                        <th key={h} className={`px-2.5 py-2 font-medium ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...series].reverse().slice(0, unit === 'daily' ? 14 : 12).map((p) => (
                      <tr key={p.key} style={{ borderTop: '1px solid var(--color-border-primary)' }}>
                        <td className="px-2.5 py-1.5 text-text-secondary whitespace-nowrap">{p.label}{p.partial ? <span className="text-text-quaternary"> (일부)</span> : null}</td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums"><span className="text-text-primary">{fmtWon(p.spend)}</span> <Delta v={p.change?.spend} better="neutral" /></td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums"><span className="text-text-primary">{fmtWon(p.conv_sales)}</span> <Delta v={p.change?.conv_sales} /></td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums"><span className={`font-medium ${roasClass(p.roas)}`}>{fmtRatio(p.roas)}</span> <Delta v={p.change?.roas} /></td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums"><span className="text-text-primary">{fmtNum(p.conversions)}</span> <Delta v={p.change?.conversions} /></td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums"><span className="text-text-primary">{fmtWon(p.cpa)}</span> <Delta v={p.change?.cpa} better="down" /></td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums"><span className="text-text-primary">{fmtWon(p.cpc)}</span> <Delta v={p.change?.cpc} better="down" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>

          {/* 3. 캠페인별 */}
          <Card title="캠페인별 성과" icon={<Layers size={18} className="text-green" />}
            right={
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                {Object.entries(effSummary).map(([label, s]) => {
                  const e = Object.values(EFFICIENCY).find((x) => x.label === label);
                  return (
                    <span key={label} className={`px-2 py-0.5 rounded-full font-medium ${e?.badge || ''}`}>
                      {label} {s.n}개 · 광고비 {k.spend ? ((s.spend / k.spend) * 100).toFixed(0) : 0}%
                    </span>
                  );
                })}
                <select value={campSort} onChange={(e) => setCampSort(e.target.value as typeof campSort)}
                  className="px-2 py-1 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary">
                  <option value="spend">광고비 순</option>
                  <option value="conv_sales">전환 매출 순</option>
                  <option value="roas">ROAS 순</option>
                </select>
              </div>
            }>
            {!av.campaign ? (
              <Notice>파일에 캠페인 칸이 없습니다 — 보고서를 캠페인으로 나눠 내려받으면 캠페인별 표가 나옵니다.</Notice>
            ) : (
              <>
                <div className="rounded-lg overflow-x-auto" style={{ border: '1px solid var(--color-border-primary)' }}>
                  <table className="w-full min-w-[1000px] text-xs">
                    <thead>
                      <tr className="text-text-tertiary" style={{ backgroundColor: 'var(--color-bg-level-2)' }}>
                        <th className="px-2.5 py-2 font-medium text-left">캠페인</th>
                        <th className="px-2.5 py-2 font-medium text-right">광고비</th>
                        <th className="px-2.5 py-2 font-medium text-right">전환 매출</th>
                        <th className="px-2.5 py-2 font-medium text-left w-36">매출 기여도</th>
                        <th className="px-2.5 py-2 font-medium text-right">ROAS</th>
                        <th className="px-2.5 py-2 font-medium text-center">효율</th>
                        <th className="px-2.5 py-2 font-medium text-right">CPA</th>
                        <th className="px-2.5 py-2 font-medium text-right">CTR</th>
                        <th className="px-2.5 py-2 font-medium text-right">CPC</th>
                        <th className="px-2.5 py-2 font-medium text-right">예산 소진율</th>
                      </tr>
                    </thead>
                    <tbody>
                      {campaigns.map((c) => {
                        const e = efficiencyOf(c.roas);
                        return (
                          <tr key={`${c.account}|${c.id}`} style={{ borderTop: '1px solid var(--color-border-primary)' }}>
                            <td className="px-2.5 py-1.5 text-text-primary">
                              {c.name}
                              {d.accounts.length > 1 && <span className="text-text-quaternary"> · {c.account || '기본'}</span>}
                            </td>
                            <td className="px-2.5 py-1.5 text-right tabular-nums text-text-primary">
                              {fmtWon(c.spend)}
                              {c.spend_share != null && <div className="text-[10px] text-text-quaternary">광고비의 {c.spend_share.toFixed(1)}%</div>}
                            </td>
                            <td className="px-2.5 py-1.5 text-right tabular-nums text-text-secondary">{fmtWon(c.conv_sales)}</td>
                            <td className="px-2.5 py-1.5">
                              {c.sales_share != null ? (
                                <div className="flex items-center gap-1.5">
                                  <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.08)' }}>
                                    <div className="h-1.5 rounded-full" style={{ width: `${Math.min(100, Math.max(0, c.sales_share))}%`, backgroundColor: C.sales }} />
                                  </div>
                                  <span className="tabular-nums text-text-secondary w-11 text-right">{c.sales_share.toFixed(1)}%</span>
                                </div>
                              ) : <span className="text-text-quaternary">-</span>}
                            </td>
                            <td className={`px-2.5 py-1.5 text-right tabular-nums font-medium ${roasClass(c.roas)}`}>{fmtRatio(c.roas)}</td>
                            <td className="px-2.5 py-1.5 text-center">
                              {e ? <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${e.badge}`}>{e.label}</span> : <span className="text-text-quaternary">-</span>}
                            </td>
                            <td className="px-2.5 py-1.5 text-right tabular-nums text-text-secondary">{fmtWon(c.cpa)}</td>
                            <td className="px-2.5 py-1.5 text-right tabular-nums text-text-secondary">{fmtPercent(c.ctr)}</td>
                            <td className="px-2.5 py-1.5 text-right tabular-nums text-text-secondary">{fmtWon(c.cpc)}</td>
                            <td className="px-2.5 py-1.5 text-right tabular-nums text-text-secondary"
                              title={c.budget != null ? `${c.budget_basis === 'total' ? '총 예산' : '일 예산 합'} ${fmtWon(c.budget)}` : undefined}>
                              {c.budget_util != null ? `${c.budget_util.toFixed(1)}%` : '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-text-tertiary mt-1.5">
                  효율: ROAS {BREAKEVEN_ROAS_LOW} 이상 고효율 · 2.0~{BREAKEVEN_ROAS_LOW} 개선 필요(손익분기 미만) · 2.0 미만 저효율 ({BREAKEVEN_ROAS_LABEL}).
                  매출 기여도 = 캠페인 전환 매출 ÷ 전체 전환 매출.
                  {av.budget
                    ? ' 예산 소진율 = 광고비 ÷ 예산(일 예산은 예산이 적힌 날짜만 더함).'
                    : ' 예산 소진율: 파일에 예산 칸이 없어 계산하지 않았습니다 (예산 칸이 든 보고서를 올리면 표시).'}
                </p>
              </>
            )}
          </Card>

          {/* 4. 소재별 */}
          <Card title="소재별 성과" icon={<ImageIcon size={18} className="text-green" />}
            right={av.creative && d.creative_count > 20 ? (
              <button onClick={() => setAllCreatives((v) => !v)} className="text-[11px] text-text-tertiary underline">
                {allCreatives ? '상위 20개만' : `전체 ${Math.min(d.creative_count, d.creatives.length)}개 보기`}
              </button>
            ) : null}>
            {!av.creative ? (
              <Notice>파일에 소재 칸이 없습니다 — 보고서를 광고 소재까지 나눠 내려받으면 소재별 표가 나옵니다.</Notice>
            ) : (
              <>
                <div className="rounded-lg overflow-x-auto" style={{ border: '1px solid var(--color-border-primary)' }}>
                  <table className="w-full min-w-[1000px] text-xs">
                    <thead>
                      <tr className="text-text-tertiary" style={{ backgroundColor: 'var(--color-bg-level-2)' }}>
                        {['소재', '유형', '노출', '클릭', 'CTR', 'CPC', '광고비', '전환 매출', 'ROAS'].map((h, i) => (
                          <th key={h} className={`px-2.5 py-2 font-medium ${i < 2 ? 'text-left' : 'text-right'}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(allCreatives ? d.creatives : d.creatives.slice(0, 20)).map((c, i) => (
                        <tr key={`${c.account}|${c.campaign}|${c.adgroup}|${c.id}|${c.type}|${i}`} style={{ borderTop: '1px solid var(--color-border-primary)' }}>
                          <td className="px-2.5 py-1.5 max-w-[320px]">
                            <div className="text-text-primary truncate" title={c.name || ''}>{c.name || c.id || '-'}</div>
                            <div className="text-[10px] text-text-quaternary truncate">{[c.campaign, c.adgroup].filter(Boolean).join(' › ')}</div>
                          </td>
                          <td className="px-2.5 py-1.5 text-text-tertiary whitespace-nowrap">{c.type || '-'}</td>
                          <td className="px-2.5 py-1.5 text-right tabular-nums text-text-secondary">{fmtNum(c.impressions)}</td>
                          <td className="px-2.5 py-1.5 text-right tabular-nums text-text-secondary">{fmtNum(c.clicks)}</td>
                          <td className="px-2.5 py-1.5 text-right tabular-nums text-text-secondary">{fmtPercent(c.ctr)}</td>
                          <td className="px-2.5 py-1.5 text-right tabular-nums text-text-secondary">{fmtWon(c.cpc)}</td>
                          <td className="px-2.5 py-1.5 text-right tabular-nums text-text-primary">{fmtWon(c.spend)}</td>
                          <td className="px-2.5 py-1.5 text-right tabular-nums text-text-secondary">{fmtWon(c.conv_sales)}</td>
                          <td className={`px-2.5 py-1.5 text-right tabular-nums font-medium ${roasClass(c.roas)}`}>{fmtRatio(c.roas)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {d.creative_count > d.creatives.length && (
                  <p className="text-[11px] text-text-tertiary mt-1.5">광고비 상위 {d.creatives.length}개만 보여 줍니다 (전체 {d.creative_count.toLocaleString('ko-KR')}개).</p>
                )}
              </>
            )}

            <div className="mt-4 space-y-2">
              <p className="text-xs font-semibold text-text-primary">이미지형 · 동영상형 비교</p>
              {d.types ? (
                <>
                  <PerfTable first="구분" rows={d.types.groups.map((g) => ({ ...g, label: g.group }))} />
                  {d.types.raw.length > 1 && (
                    <PerfTable first="소재 유형(파일 값)" rows={d.types.raw.map((g) => ({ ...g, label: g.type }))} />
                  )}
                </>
              ) : (
                <Notice>파일에 소재 유형 칸이 없습니다 — 보고서에 「소재 유형(광고 형식)」 칸을 넣어 내려받으면 이미지형·동영상형 비교가 나옵니다.</Notice>
              )}
            </div>
          </Card>

          <Card title="상품별 · 프로모션별 비교" icon={<Tag size={18} className="text-green" />}>
            <div className="space-y-3">
              {d.products ? (
                <PerfTable first="상품" rows={d.products.map((p) => ({ ...p, label: p.name }))} />
              ) : (
                <Notice>파일에 상품 칸이 없습니다 — 파일에 「상품」 칸을 넣거나, 올릴 때 칸 연결에서 「상품」 항목을 캠페인 이름 같은 칸으로 지정하면 나옵니다.</Notice>
              )}
              {d.promotions ? (
                <PerfTable first="프로모션" rows={d.promotions.map((p) => ({ ...p, label: p.name }))} />
              ) : (
                <Notice>파일에 프로모션 칸이 없습니다 — 파일에 「프로모션」 칸을 넣거나, 올릴 때 칸 연결에서 「프로모션」 항목을 알맞은 칸으로 지정하면 나옵니다.</Notice>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
