'use client';

/**
 * 콘텐츠 분석 — 발행 콘텐츠의 일별 스냅샷 기반 누적·증가 분석.
 *
 * - 누적 조회수 스택(기존 콘텐츠 vs 기간 내 신규 콘텐츠 기여)
 * - 일별 증가분(기존/신규) + 좋아요·댓글 추이 + 네이버 언급량 병치
 * - 최근 7일 조회 급상승 콘텐츠 (톱 무버)
 * 수집: 유튜브 전 영상 자동 + 인스타 자사 게시물(연동 시), 매일 03:10 KST.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ResponsiveContainer, ComposedChart, AreaChart, Area, Bar, Line, XAxis, YAxis,
  Tooltip as RechartsTooltip, Legend, CartesianGrid,
} from 'recharts';
import { RefreshCw, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import { contentApi, socialApi } from '@/lib/api';
import { fmtNum } from '@/components/tabs/kpi/format';

const TYPE_LABELS: Record<string, string> = {
  '': '전체', content: '자사 콘텐츠', influencer: '인플루언서', experience: '체험단',
  crew: '크루', groupbuy: '공동구매',
};
const RANGES = [14, 30, 60, 90, 180];
const card: React.CSSProperties = { backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' };

const nTick = (v: number) =>
  v >= 100000000 ? `${(v / 100000000).toFixed(1)}억` : v >= 10000 ? `${Math.round(v / 10000)}만` : String(v);

export function ContentAnalytics() {
  const qc = useQueryClient();
  const [days, setDays] = useState(30);
  const [typeF, setTypeF] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['content', 'analytics', days, typeF],
    queryFn: () => contentApi.analytics(days, typeF),
    staleTime: 5 * 60 * 1000,
  });

  const refreshMut = useMutation({
    mutationFn: () => socialApi.refreshActivityMetrics(24),
    onSuccess: (d) => {
      toast.success(`지표 갱신: 유튜브 ${d.yt_updated ?? d.updated}건 · 인스타 ${d.ig_updated ?? 0}건 · 스냅샷 ${d.snapshots ?? '-'}건`);
      qc.invalidateQueries({ queryKey: ['content'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || '갱신 실패'),
  });

  const s = data?.summary;
  const series = (data?.series || []).map((r: any) => ({ ...r, label: r.date.slice(5) }));
  const mentionKeys = Object.keys(data?.mentions || {});
  const mentionRows: any[] = mentionKeys.length
    ? (data.mentions[mentionKeys[0]] || []).map((m: any) => ({ label: m.date.slice(5), blog: m.blog, cafe: m.cafe }))
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h2 className="text-base font-semibold text-text-primary">콘텐츠 분석</h2>
          <p className="text-xs text-text-tertiary mt-0.5">
            발행 콘텐츠의 조회수를 매일 자동 스냅샷 — 누적 흐름과 기존/신규 콘텐츠 기여를 분해합니다
          </p>
        </div>
        <div className="flex-1" />
        <select value={typeF} onChange={(e) => setTypeF(e.target.value)}
          className="px-2 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary">
          {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="flex items-center gap-1">
          {RANGES.map((d) => (
            <button key={d} onClick={() => setDays(d)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border ${
                days === d ? 'text-white border-transparent' : 'text-text-tertiary border-border-primary hover:text-text-primary'
              }`}
              style={days === d ? { backgroundColor: 'var(--color-brand-bg)' } : undefined}
            >{d}일</button>
          ))}
        </div>
        <button onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-text-secondary border border-border-primary hover:text-text-primary disabled:opacity-50">
          <RefreshCw size={13} className={refreshMut.isPending ? 'animate-spin' : ''} /> 지금 갱신
        </button>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: '추적 콘텐츠', value: s ? `${fmtNum(s.tracked_contents)}건` : '-' },
          { label: '누적 조회수 (현재)', value: s ? fmtNum(s.views_total) : '-' },
          { label: `${days}일간 증가`, value: s ? `+${fmtNum(s.views_delta_window)}` : '-' },
          { label: '신규 콘텐츠 기여 (누적)', value: s ? fmtNum(s.views_new_contents) : '-' },
          { label: '누적 좋아요 · 댓글', value: s ? `${fmtNum(s.likes_total)} · ${fmtNum(s.comments_total)}` : '-' },
        ].map((c) => (
          <div key={c.label} className="rounded-xl p-4" style={card}>
            <p className="text-[11px] text-text-tertiary">{c.label}</p>
            <p className="text-lg font-bold text-text-primary tabular-nums mt-1">{c.value}</p>
          </div>
        ))}
      </div>

      {/* 누적 조회수 스택 */}
      <div className="rounded-xl p-4" style={card}>
        <h3 className="text-sm font-semibold text-text-primary mb-3">누적 조회수 — 기존 콘텐츠 vs 신규 콘텐츠({days}일 내 발행) 기여</h3>
        {isLoading ? <p className="text-xs text-text-tertiary py-8 text-center">불러오는 중...</p>
          : series.filter((r: any) => r.tracked).length === 0 ? (
          <p className="text-xs text-text-tertiary py-8 text-center">
            아직 스냅샷이 없습니다 — &quot;지금 갱신&quot;을 누르면 첫 스냅샷이 생기고, 이후 매일 03:10에 자동 누적됩니다
          </p>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--color-text-quaternary)' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-quaternary)' }} tickLine={false} axisLine={false} tickFormatter={nTick} width={52} />
                <RechartsTooltip
                  contentStyle={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)', borderRadius: 8, fontSize: 11 }}
                  formatter={(v: any, name: any) => [fmtNum(Number(v)), name]}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Area type="monotone" dataKey="views_existing" name="기존 콘텐츠 누적" stackId="v" stroke="#4EA7FC" fill="#4EA7FC" fillOpacity={0.35} />
                <Area type="monotone" dataKey="views_new" name="신규 콘텐츠 누적" stackId="v" stroke="#27A644" fill="#27A644" fillOpacity={0.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* 일별 증가분 + 좋아요·댓글 */}
        <div className="rounded-xl p-4" style={card}>
          <h3 className="text-sm font-semibold text-text-primary mb-3">일별 조회수 증가 (기존/신규) · 좋아요 추이</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--color-text-quaternary)' }} tickLine={false} axisLine={false} />
                <YAxis yAxisId="l" tick={{ fontSize: 9, fill: 'var(--color-text-quaternary)' }} tickLine={false} axisLine={false} tickFormatter={nTick} width={48} />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 9, fill: '#F0BF00' }} tickLine={false} axisLine={false} tickFormatter={nTick} width={48} />
                <RechartsTooltip
                  contentStyle={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)', borderRadius: 8, fontSize: 11 }}
                  formatter={(v: any, name: any) => [v != null ? fmtNum(Number(v)) : '-', name]}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar yAxisId="l" dataKey="delta_existing" name="기존 증가" stackId="d" fill="#4EA7FC" opacity={0.7} />
                <Bar yAxisId="l" dataKey="delta_new" name="신규 증가" stackId="d" fill="#27A644" opacity={0.8} />
                <Line yAxisId="r" dataKey="likes" name="누적 좋아요" stroke="#F0BF00" strokeWidth={1.5} dot={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 언급량 */}
        <div className="rounded-xl p-4" style={card}>
          <h3 className="text-sm font-semibold text-text-primary mb-3">
            네이버 브랜드 언급량 {mentionKeys.length ? `(“${mentionKeys[0]}”)` : ''}
          </h3>
          {mentionRows.length === 0 ? (
            <p className="text-xs text-text-tertiary py-8 text-center">언급량 스냅샷이 없습니다</p>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={mentionRows} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--color-text-quaternary)' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--color-text-quaternary)' }} tickLine={false} axisLine={false} tickFormatter={nTick} width={52} />
                  <RechartsTooltip
                    contentStyle={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)', borderRadius: 8, fontSize: 11 }}
                    formatter={(v: any, name: any) => [fmtNum(Number(v)), name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line dataKey="blog" name="블로그 누적" stroke="#4EA7FC" strokeWidth={2} dot={false} />
                  <Line dataKey="cafe" name="카페 누적" stroke="#C06EF3" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* 톱 무버 */}
      <div className="rounded-xl overflow-hidden" style={card}>
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
          <h3 className="text-sm font-semibold text-text-primary">최근 7일 조회수 급상승 콘텐츠</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-text-tertiary" style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
              {['유형', '제품/콘텐츠', '크리에이터', '채널', '7일 증가', '누적 조회', '좋아요', '댓글', ''].map((h, i) => (
                <th key={i} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {(data?.top_movers_7d || []).map((m: any) => (
                <tr key={m.activity_id} style={{ borderBottom: '1px solid rgb(var(--color-overlay-rgb) / 0.04)' }}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.08)', color: 'var(--color-text-secondary)' }}>
                      {TYPE_LABELS[m.activity_type] || m.activity_type}{m.is_new ? ' · 신규' : ''}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-text-primary max-w-[240px] truncate" title={m.product || ''}>{m.product || '-'}</td>
                  <td className="px-3 py-2 text-text-secondary whitespace-nowrap max-w-[140px] truncate">{m.creator || '-'}</td>
                  <td className="px-3 py-2 text-text-tertiary whitespace-nowrap">{m.channel || '-'}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-green">+{fmtNum(m.delta_views_7d)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-primary">{fmtNum(m.views)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-tertiary">{fmtNum(m.likes)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-tertiary">{fmtNum(m.comments)}</td>
                  <td className="px-3 py-2 text-right">
                    {m.link && <a href={m.link} target="_blank" rel="noreferrer" className="text-brand hover:underline inline-flex items-center gap-0.5">열기 <ExternalLink size={10} /></a>}
                  </td>
                </tr>
              ))}
              {data && (data.top_movers_7d || []).length === 0 && (
                <tr><td colSpan={9} className="px-4 py-6 text-center text-text-quaternary">
                  최근 7일 증가분이 아직 없습니다 — 스냅샷이 2일 이상 쌓이면 나타납니다
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {data && (
        <p className="text-[10px] text-text-quaternary text-right">
          기준: {data.as_of?.slice(0, 16).replace('T', ' ')} UTC · {data.note}
        </p>
      )}
    </div>
  );
}
