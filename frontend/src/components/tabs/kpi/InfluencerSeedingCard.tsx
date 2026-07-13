'use client';

import { Fragment, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Download, ExternalLink, Loader2, Megaphone, Plus, Sparkles, Trash2,
} from 'lucide-react';
import {
  BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from 'recharts';
import { downloadFile, influencerApi } from '@/lib/api';
import type {
  InfluencerChannel, InfluencerSeeding, InfluencerSeedingCreatePayload,
} from '@/lib/api';
import { fmtNum, fmtWon, shortMonth } from './format';

// ─── Constants ───

const INFLUENCER_CHANNEL_OPTIONS: Array<{ value: InfluencerChannel; label: string; color: string }> = [
  { value: 'instagram', label: '인스타그램', color: '#E1306C' },
  { value: 'youtube', label: '유튜브', color: '#FF0000' },
  { value: 'blog', label: '블로그', color: '#03C75A' },
  { value: 'tiktok', label: '틱톡', color: '#69C9D0' },
  { value: 'etc', label: '기타', color: '#8A8F98' },
];

const INFLUENCER_CHANNEL_LABELS: Record<string, string> = Object.fromEntries(
  INFLUENCER_CHANNEL_OPTIONS.map((o) => [o.value, o.label]),
);
const INFLUENCER_CHANNEL_COLORS: Record<string, string> = Object.fromEntries(
  INFLUENCER_CHANNEL_OPTIONS.map((o) => [o.value, o.color]),
);

// ─── 인플루언서 시딩 카드 ───

function InfluencerChannelBadge({ channel }: { channel: string }) {
  const color = INFLUENCER_CHANNEL_COLORS[channel] || '#8A8F98';
  const label = INFLUENCER_CHANNEL_LABELS[channel] || channel;
  return (
    <span
      className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ backgroundColor: `${color}26`, color }}
    >
      {label}
    </span>
  );
}

function segmentTickFormatter(v: string): string {
  return v && v.length > 12 ? `${v.slice(0, 12)}…` : v;
}

export function InfluencerSeedingCard() {
  const queryClient = useQueryClient();
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const {
    data: seedings, isLoading: seedingsLoading, isError: seedingsError,
  } = useQuery({
    queryKey: ['influencer-seedings'],
    queryFn: () => influencerApi.listSeedings(undefined, 200),
    staleTime: 60 * 1000,
  });

  const { data: summary } = useQuery({
    queryKey: ['influencer-summary'],
    queryFn: () => influencerApi.getSummary(12),
    staleTime: 60 * 1000,
  });

  const createMutation = useMutation({
    mutationFn: (payload: InfluencerSeedingCreatePayload) => influencerApi.createSeeding(payload),
    onSuccess: () => {
      toast.success('시딩이 등록되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['influencer-seedings'] });
      queryClient.invalidateQueries({ queryKey: ['influencer-summary'] });
      setName(''); setUrl(''); setCost(''); setProduct(''); setSeededAt(todayStr);
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || '등록 실패'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => influencerApi.deleteSeeding(id),
    onSuccess: () => {
      toast.success('삭제되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['influencer-seedings'] });
      queryClient.invalidateQueries({ queryKey: ['influencer-summary'] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || '삭제 실패'),
  });

  const analyzeMutation = useMutation({
    mutationFn: (id: number) => influencerApi.analyzeSeeding(id),
    onSuccess: () => {
      toast.success('AI 분석이 완료되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['influencer-seedings'] });
      queryClient.invalidateQueries({ queryKey: ['influencer-summary'] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'AI 분석 실패'),
  });

  const [name, setName] = useState('');
  const [channel, setChannel] = useState<InfluencerChannel>('instagram');
  const [url, setUrl] = useState('');
  const [cost, setCost] = useState('');
  const [seededAt, setSeededAt] = useState(todayStr);
  const [product, setProduct] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const handleAdd = () => {
    if (!name.trim()) { toast.error('이름을 입력해주세요.'); return; }
    if (!seededAt) { toast.error('시딩 일자를 입력해주세요.'); return; }
    createMutation.mutate({
      name: name.trim(),
      channel,
      url: url.trim() || undefined,
      cost: cost.trim() === '' ? undefined : parseFloat(cost),
      seeded_at: seededAt,
      product: product.trim() || undefined,
    });
  };

  const handleExport = async () => {
    try {
      await downloadFile('/influencer/export');
    } catch {
      toast.error('엑셀 다운로드에 실패했습니다.');
    }
  };

  const rows = useMemo(
    () => [...(seedings ?? [])].sort((a, b) => (a.seeded_at < b.seeded_at ? 1 : -1)),
    [seedings],
  );

  const byChannelData = summary?.by_channel ?? [];
  // 세그먼트 차트에서 '미분석'은 제외 (분석된 타겟 분포만 표시) — 제외분은 캡션으로 안내
  const bySegmentAll = summary?.by_segment ?? [];
  const bySegmentData = bySegmentAll.filter((s) => s.segment !== '미분석');
  const unanalyzedSeg = bySegmentAll.find((s) => s.segment === '미분석') ?? null;
  const byMonthData = (summary?.by_month ?? []).map((m) => ({ ...m, monthLabel: shortMonth(m.month) }));

  return (
    <div className="bg-[#0F1011] border border-[#23252A] rounded-xl p-4">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-[#D0D6E0] flex items-center gap-1.5">
            <Megaphone size={14} className="text-[#E1306C]" />
            인플루언서 시딩
          </h3>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <span className="text-xs text-[#8A8F98]">
              총 비용 <b className="text-[#F7F8F8]">{fmtWon(summary?.total?.cost ?? 0)}</b>
            </span>
            <span className="text-xs text-[#8A8F98]">
              총 건수 <b className="text-[#F7F8F8]">{fmtNum(summary?.total?.count ?? 0)}건</b>
            </span>
            <span className="text-xs text-[#8A8F98]">
              분석완료 <b className="text-[#F7F8F8]">{fmtNum(summary?.total?.analyzed_count ?? 0)}건</b>
            </span>
          </div>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 px-3 py-2 border border-[#23252A] rounded-lg text-sm text-[#D0D6E0] hover:bg-[#141516] transition-all"
        >
          <Download size={14} /> 엑셀
        </button>
      </div>

      {/* 등록 폼 */}
      <div className="flex items-center gap-2 flex-wrap mb-4 pb-4 border-b border-[#23252A]">
        <input
          value={name}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
          placeholder="이름"
          className="w-32 px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
        />
        <select
          value={channel}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setChannel(e.target.value as InfluencerChannel)}
          className="px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
        >
          {INFLUENCER_CHANNEL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <input
          value={url}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
          placeholder="URL"
          className="w-40 px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
        />
        <input
          value={cost}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setCost(e.target.value)}
          type="number"
          placeholder="비용"
          className="w-24 px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
        />
        <input
          value={seededAt}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setSeededAt(e.target.value)}
          type="date"
          className="px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
        />
        <input
          value={product}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setProduct(e.target.value)}
          placeholder="제품"
          className="w-32 px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
        />
        <button
          onClick={handleAdd}
          disabled={createMutation.isPending}
          className="flex items-center gap-1 px-3 py-1.5 bg-[#5E6AD2] text-white text-xs font-medium rounded-lg hover:bg-[#828FFF] disabled:opacity-50"
        >
          {createMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} 추가
        </button>
      </div>

      {/* 목록 테이블 */}
      {seedingsLoading ? (
        <div className="flex items-center justify-center h-24">
          <Loader2 size={24} className="animate-spin text-[#7070FF]" />
        </div>
      ) : seedingsError ? (
        <p className="text-xs text-[#EB5757] py-6 text-center">시딩 데이터를 불러오지 못했습니다.</p>
      ) : (
        <div className="overflow-x-auto mb-4">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#23252A] text-[10px] text-[#62666D] uppercase tracking-wide">
                <th className="px-3 py-2">일자</th>
                <th className="px-3 py-2">이름</th>
                <th className="px-3 py-2">채널</th>
                <th className="px-3 py-2">팔로워</th>
                <th className="px-3 py-2">비용</th>
                <th className="px-3 py-2">제품</th>
                <th className="px-3 py-2">AI 타겟</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((item: InfluencerSeeding) => {
                const isAnalyzing = analyzeMutation.isPending && analyzeMutation.variables === item.id;
                const isExpanded = expandedId === item.id;
                return (
                  <Fragment key={item.id}>
                    <tr
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      className="border-b border-[#23252A] hover:bg-[#141516]/40 cursor-pointer"
                    >
                      <td className="px-3 py-2 text-xs text-[#8A8F98] whitespace-nowrap">{item.seeded_at}</td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap">
                        {item.url ? (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-[#4EA7FC] hover:underline inline-flex items-center gap-1"
                          >
                            {item.name} <ExternalLink size={10} />
                          </a>
                        ) : (
                          <span className="text-[#D0D6E0]">{item.name}</span>
                        )}
                      </td>
                      <td className="px-3 py-2"><InfluencerChannelBadge channel={item.channel} /></td>
                      <td className="px-3 py-2 text-xs text-[#D0D6E0] whitespace-nowrap">{fmtNum(item.follower_count ?? null)}</td>
                      <td className="px-3 py-2 text-xs text-[#D0D6E0] whitespace-nowrap">{fmtWon(item.cost ?? null)}</td>
                      <td className="px-3 py-2 text-xs text-[#D0D6E0] whitespace-nowrap">{item.product || '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {item.ai_target_segment ? (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#7070FF]/15 text-[#7070FF]">
                            {item.ai_target_segment}
                          </span>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); analyzeMutation.mutate(item.id); }}
                            disabled={isAnalyzing}
                            className="flex items-center gap-1 px-2 py-1 border border-[#23252A] rounded-lg text-[10px] text-[#D0D6E0] hover:bg-[#141516] disabled:opacity-50"
                          >
                            {isAnalyzing ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                            {isAnalyzing ? '분석 중...' : 'AI 분석'}
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(item.id); }}
                          className="text-[#8A8F98] hover:text-[#EB5757] transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b border-[#23252A] bg-[#141516]/30">
                        <td colSpan={8} className="px-3 py-3 text-xs text-[#8A8F98] leading-relaxed">
                          {item.ai_audience_summary || (item.notes ? item.notes : '오디언스 요약이 없습니다. AI 분석을 실행해주세요.')}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-xs text-[#62666D]">
                    등록된 시딩이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 채널별 / 세그먼트별 비용 차트 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-[#08090A] border border-[#23252A] rounded-xl p-3">
          <h4 className="text-xs font-semibold text-[#D0D6E0] mb-2">채널별 시딩 비용</h4>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byChannelData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#23252A" />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fill: '#8A8F98' }}
                  tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 10000)}만` : String(v))}
                />
                <YAxis
                  type="category"
                  dataKey="channel"
                  tick={{ fontSize: 10, fill: '#8A8F98' }}
                  tickFormatter={(v: string) => INFLUENCER_CHANNEL_LABELS[v] || v}
                  width={64}
                />
                <RechartsTooltip
                  contentStyle={{ backgroundColor: '#141516', border: '1px solid #23252A', borderRadius: 8, fontSize: 11 }}
                  labelStyle={{ color: '#D0D6E0' }}
                  formatter={(value: any) => [fmtWon(Number(value)), '비용']}
                  labelFormatter={(v: string) => INFLUENCER_CHANNEL_LABELS[v] || v}
                />
                <Bar dataKey="total_cost" radius={[0, 3, 3, 0]} maxBarSize={20}>
                  {byChannelData.map((d, i) => (
                    <Cell key={`ch-${i}`} fill={INFLUENCER_CHANNEL_COLORS[d.channel] || '#8A8F98'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-[#08090A] border border-[#23252A] rounded-xl p-3">
          <h4 className="text-xs font-semibold text-[#D0D6E0] mb-2">
            타겟 세그먼트별 비용
            {unanalyzedSeg && (
              <span className="ml-1.5 text-[10px] font-normal text-[#62666D]">
                (미분석 {unanalyzedSeg.count}건 · {fmtWon(unanalyzedSeg.total_cost)} 제외)
              </span>
            )}
          </h4>
          {bySegmentData.length === 0 ? (
            <div className="h-48 flex items-center justify-center">
              <p className="text-xs text-[#62666D]">AI 분석 완료된 시딩이 아직 없습니다.</p>
            </div>
          ) : (
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bySegmentData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#23252A" />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fill: '#8A8F98' }}
                  tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 10000)}만` : String(v))}
                />
                <YAxis
                  type="category"
                  dataKey="segment"
                  tick={{ fontSize: 10, fill: '#8A8F98' }}
                  tickFormatter={segmentTickFormatter}
                  width={80}
                />
                <RechartsTooltip
                  contentStyle={{ backgroundColor: '#141516', border: '1px solid #23252A', borderRadius: 8, fontSize: 11 }}
                  labelStyle={{ color: '#D0D6E0' }}
                  formatter={(value: any) => [fmtWon(Number(value)), '비용']}
                />
                <Bar dataKey="total_cost" fill="#7070FF" radius={[0, 3, 3, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          )}
        </div>
      </div>

      {/* 월별 시딩 비용 추이 */}
      <div className="bg-[#08090A] border border-[#23252A] rounded-xl p-3 mt-4">
        <h4 className="text-xs font-semibold text-[#D0D6E0] mb-2">월별 시딩 비용 추이</h4>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byMonthData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#23252A" />
              <XAxis dataKey="monthLabel" tick={{ fontSize: 10, fill: '#8A8F98' }} />
              <YAxis
                tick={{ fontSize: 10, fill: '#8A8F98' }}
                tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 10000)}만` : String(v))}
              />
              <RechartsTooltip
                contentStyle={{ backgroundColor: '#141516', border: '1px solid #23252A', borderRadius: 8, fontSize: 11 }}
                labelStyle={{ color: '#D0D6E0' }}
                formatter={(value: any) => [fmtWon(Number(value)), '비용']}
              />
              <Bar dataKey="total_cost" fill="#E1306C" radius={[3, 3, 0, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
