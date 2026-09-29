'use client';

/**
 * Meta 일별 데이터 — 캠페인×일별 원본 스냅샷 테이블 + CSV 다운로드.
 * 팀이 Meta 광고관리자 CSV를 구글시트(MAIN SHEET)에 수동으로 붙여넣던
 * 작업을 대체한다. 데이터는 1시간마다 자동 수집된 스냅샷.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { insightsDailyApi } from '@/lib/api';
import { fmtWon, fmtNum } from '@/components/tabs/kpi/format';

const PRESETS = [
  { label: '7일', days: 7 },
  { label: '30일', days: 30 },
  { label: '90일', days: 90 },
  { label: '180일', days: 180 },
  { label: '1년', days: 365 },
];

export function MetaDailyTable() {
  const [days, setDays] = useState(30);
  const [q, setQ] = useState('');
  const [submittedQ, setSubmittedQ] = useState('');
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);
  const PAGE = 100;

  const params = { days, campaign_q: submittedQ || undefined, limit: PAGE, offset: page * PAGE };
  const { data, isLoading } = useQuery({
    queryKey: ['insights', 'daily-table', params],
    queryFn: () => insightsDailyApi.table(params),
  });

  const doExport = async () => {
    setExporting(true);
    try {
      await insightsDailyApi.exportCsv({ days, campaign_q: submittedQ || undefined });
      toast.success('CSV 다운로드 시작');
    } catch {
      toast.error('다운로드 실패');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Meta 일별 데이터</h2>
          <p className="text-xs text-text-tertiary mt-0.5">
            캠페인×일별 원본 — 광고관리자 CSV를 시트에 붙여넣을 필요 없이 여기서 조회·다운로드
          </p>
        </div>
        <div className="flex-1" />
        <div className="flex items-center rounded-lg p-0.5" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.05)' }}>
          {PRESETS.map((p) => (
            <button key={p.days} onClick={() => { setDays(p.days); setPage(0); }}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              style={days === p.days
                ? { backgroundColor: 'var(--color-brand-bg)', color: '#fff' }
                : { color: 'var(--color-text-tertiary)' }}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-quaternary" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setSubmittedQ(q.trim()); setPage(0); } }}
            placeholder="캠페인 검색 후 Enter"
            className="pl-8 pr-2 py-1.5 w-48 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary"
          />
        </div>
        <button
          onClick={doExport}
          disabled={exporting}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-brand-bg)' }}
        >
          <Download size={13} /> {exporting ? '준비 중...' : 'CSV 다운로드'}
        </button>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                {['날짜', '캠페인', '지출', '노출', '클릭', 'CTR', 'CPC', '도달', '빈도', '구매', '전환매출', 'ROAS'].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-left font-medium text-text-tertiary whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={12} className="px-3 py-10 text-center text-text-tertiary">불러오는 중...</td></tr>
              ) : (data?.items || []).length === 0 ? (
                <tr><td colSpan={12} className="px-3 py-10 text-center text-text-tertiary">데이터가 없습니다</td></tr>
              ) : data!.items.map((r: any, i: number) => (
                <tr key={`${r.date}-${r.campaign_name}-${i}`} style={{ borderBottom: '1px solid rgb(var(--color-overlay-rgb) / 0.04)' }}>
                  <td className="px-3 py-2 text-text-secondary whitespace-nowrap tabular-nums">{r.date}</td>
                  <td className="px-3 py-2 text-text-primary max-w-[240px] truncate" title={r.campaign_name}>{r.campaign_name}</td>
                  <td className="px-3 py-2 text-text-primary tabular-nums text-right">{fmtWon(r.spend)}</td>
                  <td className="px-3 py-2 text-text-secondary tabular-nums text-right">{fmtNum(r.impressions)}</td>
                  <td className="px-3 py-2 text-text-secondary tabular-nums text-right">{fmtNum(r.clicks)}</td>
                  <td className="px-3 py-2 text-text-tertiary tabular-nums text-right">{r.ctr?.toFixed(2)}%</td>
                  <td className="px-3 py-2 text-text-tertiary tabular-nums text-right">{fmtWon(r.cpc)}</td>
                  <td className="px-3 py-2 text-text-tertiary tabular-nums text-right">{fmtNum(r.reach)}</td>
                  <td className="px-3 py-2 text-text-tertiary tabular-nums text-right">{r.frequency}</td>
                  <td className="px-3 py-2 text-text-secondary tabular-nums text-right">{fmtNum(r.conversions)}</td>
                  <td className="px-3 py-2 text-text-primary tabular-nums text-right">{fmtWon(r.revenue)}</td>
                  <td className={`px-3 py-2 font-medium tabular-nums text-right ${r.roas >= 1 ? 'text-green' : r.roas > 0 ? 'text-yellow' : 'text-text-quaternary'}`}>
                    {r.roas ? r.roas.toFixed(2) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-3 py-2" style={{ borderTop: '1px solid var(--color-border-primary)' }}>
          <span className="text-[11px] text-text-quaternary">
            {data ? `${data.since} ~ ${data.until} · 총 ${fmtNum(data.total)}행` : ''}
          </span>
          <div className="flex gap-1">
            <button disabled={page === 0} onClick={() => setPage(page - 1)}
              className="px-2 py-1 rounded text-[11px] text-text-tertiary hover:text-text-primary disabled:opacity-30">이전</button>
            <button disabled={(page + 1) * PAGE >= (data?.total || 0)} onClick={() => setPage(page + 1)}
              className="px-2 py-1 rounded text-[11px] text-text-tertiary hover:text-text-primary disabled:opacity-30">다음</button>
          </div>
        </div>
      </div>
    </div>
  );
}
