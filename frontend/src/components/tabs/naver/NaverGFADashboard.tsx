'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Monitor, DollarSign, Eye, MousePointer, Target, TrendingUp,
  Loader2, RefreshCw, ChevronDown, ChevronRight, Sparkles,
  Image, Activity, Play, Pause, Award, Calendar,
} from 'lucide-react';
import { naverGFAApi, formatNaverCurrency, formatNaverNumber, formatNaverPercent } from '@/lib/naver-api';
import toast from 'react-hot-toast';

type DatePreset = 'today' | 'yesterday' | 'last_7_days' | 'last_14_days' | 'last_30_days' | 'this_month' | 'custom';

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'today', label: '오늘' },
  { value: 'yesterday', label: '어제' },
  { value: 'last_7_days', label: '최근 7일' },
  { value: 'last_14_days', label: '최근 14일' },
  { value: 'last_30_days', label: '최근 30일' },
  { value: 'this_month', label: '이번달' },
  { value: 'custom', label: '기간 직접설정' },
];

const STATUS_KO: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: '활성', color: 'bg-green/15 text-green' },
  ELIGIBLE: { label: '활성', color: 'bg-green/15 text-green' },
  ENABLED: { label: '활성', color: 'bg-green/15 text-green' },
  PAUSED: { label: '일시중지', color: 'bg-yellow/15 text-yellow' },
  DELETED: { label: '삭제', color: 'bg-red/15 text-red' },
  COMPLETED: { label: '완료', color: 'bg-bg-2 text-text-tertiary' },
};

const OBJECTIVE_KO: Record<string, string> = {
  WEBSITE_TRAFFIC: '웹사이트 트래픽',
  CONVERSION: '전환',
  VIDEO_VIEW: '동영상 조회',
  REACH: '도달',
  APP_INSTALL: '앱 설치',
};

const PLACEMENT_KO: Record<string, string> = {
  naver_main: '네이버 메인',
  band: '밴드',
  cafe: '카페',
  blog: '블로그',
  kin: '지식iN',
  news: '뉴스',
  webtoon: '웹툰',
  series: '시리즈',
};

// SVG Mini Line Chart
function MiniLineChart({ data, color = '#2DB400', height = 40, width = 120 }: {
  data: number[];
  color?: string;
  height?: number;
  width?: number;
}) {
  if (!data || data.length < 2) return <div style={{ width, height }} className="bg-bg-0 rounded" />;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="block">
      <polyline fill="none" stroke={color} strokeWidth="2" points={points} />
    </svg>
  );
}

export function NaverGFADashboard() {
  const [datePreset, setDatePreset] = useState<DatePreset>('last_7_days');
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
  const [aiTriggered, setAiTriggered] = useState(false);

  // Custom date range state
  const today = new Date().toISOString().split('T')[0];
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const [customStartDate, setCustomStartDate] = useState<string>(sevenDaysAgo);
  const [customEndDate, setCustomEndDate] = useState<string>(today);

  // Effective date range for API calls
  const effectiveDateRange = datePreset;
  const effectiveStartDate = datePreset === 'custom' ? customStartDate : undefined;
  const effectiveEndDate = datePreset === 'custom' ? customEndDate : undefined;

  // Fetch overview
  const { data: overview, isLoading: loadingOverview, refetch: refetchOverview } = useQuery({
    queryKey: ['naver-gfa-overview', effectiveDateRange, effectiveStartDate, effectiveEndDate],
    queryFn: () => naverGFAApi.getOverview(effectiveDateRange, effectiveStartDate, effectiveEndDate),
    retry: 1,
  });

  // Fetch campaigns
  const { data: campaignsData, isLoading: loadingCampaigns } = useQuery({
    queryKey: ['naver-gfa-campaigns', effectiveDateRange, effectiveStartDate, effectiveEndDate],
    queryFn: () => naverGFAApi.getCampaigns(effectiveDateRange, effectiveStartDate, effectiveEndDate),
    retry: 1,
  });

  // Fetch trend
  const { data: trendData } = useQuery({
    queryKey: ['naver-gfa-trend', effectiveDateRange, effectiveStartDate, effectiveEndDate],
    queryFn: () => naverGFAApi.getTrend(effectiveDateRange, 'daily', effectiveStartDate, effectiveEndDate),
    retry: 1,
  });

  // Fetch ad groups for expanded campaign
  const { data: adgroupsData, isLoading: loadingAdgroups } = useQuery({
    queryKey: ['naver-gfa-adgroups', expandedCampaign, effectiveDateRange, effectiveStartDate, effectiveEndDate],
    queryFn: () => naverGFAApi.getCampaignAdgroups(expandedCampaign!, effectiveDateRange, effectiveStartDate, effectiveEndDate),
    enabled: !!expandedCampaign,
    retry: 1,
  });

  // AI Analysis
  const aiMutation = useMutation({
    mutationFn: () => naverGFAApi.getAIAnalysis(effectiveDateRange, overview, effectiveStartDate, effectiveEndDate),
    onError: () => toast.error('AI 분석에 실패했습니다.'),
  });

  const handleAiAnalysis = () => {
    setAiTriggered(true);
    aiMutation.mutate();
  };

  const campaigns = campaignsData?.campaigns || campaignsData || [];
  const kpi = overview?.kpi || overview || {};
  const trend = trendData?.data || trendData || [];
  const topCreatives = overview?.top_creatives || [];

  const trendSpend = Array.isArray(trend) ? trend.map((d: any) => parseFloat(d.spend || 0)) : [];
  const trendImpressions = Array.isArray(trend) ? trend.map((d: any) => parseFloat(d.impressions || 0)) : [];
  const trendClicks = Array.isArray(trend) ? trend.map((d: any) => parseFloat(d.clicks || 0)) : [];

  const kpiCards = [
    {
      label: '비용',
      value: formatNaverCurrency(kpi.spend || kpi.total_spend || 0),
      icon: DollarSign,
      color: 'text-green',
      bg: 'bg-green/10',
    },
    {
      label: '노출',
      value: formatNaverNumber(kpi.impressions || kpi.total_impressions || 0),
      icon: Eye,
      color: 'text-accent',
      bg: 'bg-brand/10',
    },
    {
      label: '클릭',
      value: formatNaverNumber(kpi.clicks || kpi.total_clicks || 0),
      icon: MousePointer,
      color: 'text-accent',
      bg: 'bg-blue/10',
    },
    {
      label: 'CTR',
      value: formatNaverPercent(kpi.ctr || 0),
      icon: Target,
      color: 'text-orange',
      bg: 'bg-orange/10',
    },
    {
      label: 'CPM',
      value: formatNaverCurrency(kpi.cpm || 0),
      icon: Activity,
      color: 'text-cyan-600',
      bg: 'bg-teal/10',
    },
    {
      label: 'ROAS',
      value: kpi.roas ? `${(kpi.roas * 100).toFixed(0)}%` : '-',
      icon: TrendingUp,
      color: 'text-rose-600',
      bg: 'bg-rose-50',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Monitor className="text-green" size={28} />
            GFA 성과 대시보드
          </h1>
          <p className="text-sm text-text-tertiary mt-1">네이버 성과형 디스플레이 광고 분석</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value as DatePreset)}
            className="rounded-lg border border-border-primary px-3 py-2 text-sm bg-bg-1 focus:border-green focus:ring-1 focus:ring-green-500 focus:outline-none"
          >
            {DATE_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          {datePreset === 'custom' && (
            <div className="flex items-center gap-1.5">
              <Calendar size={14} className="text-text-quaternary" />
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                max={customEndDate}
                className="rounded-lg border border-border-primary px-2 py-1.5 text-sm bg-bg-1 focus:border-green focus:ring-1 focus:ring-green-500 focus:outline-none"
              />
              <span className="text-text-quaternary text-sm">~</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                min={customStartDate}
                className="rounded-lg border border-border-primary px-2 py-1.5 text-sm bg-bg-1 focus:border-green focus:ring-1 focus:ring-green-500 focus:outline-none"
              />
            </div>
          )}
          <button
            onClick={() => refetchOverview()}
            className="p-2 rounded-lg border border-border-primary hover:bg-bg-2/5 transition-colors"
            title="새로고침"
          >
            <RefreshCw size={16} className="text-text-tertiary" />
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      {loadingOverview ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-green" size={32} />
          <span className="ml-3 text-text-tertiary">데이터 로딩 중...</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {kpiCards.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.label} className="bg-bg-1 rounded-xl border border-border-primary p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-text-tertiary font-medium">{card.label}</span>
                  <div className={`w-8 h-8 ${card.bg} rounded-lg flex items-center justify-center`}>
                    <Icon size={16} className={card.color} />
                  </div>
                </div>
                <p className="text-lg font-bold text-text-primary">{card.value}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Trend Chart */}
      {trendSpend.length > 1 && (
        <div className="bg-bg-1 rounded-xl border border-border-primary p-6">
          <h2 className="text-base font-semibold text-text-primary mb-4 flex items-center gap-2">
            <Activity size={18} className="text-green" />
            트렌드 차트
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <p className="text-xs text-text-tertiary mb-2">비용 추이</p>
              <div className="overflow-x-auto"><MiniLineChart data={trendSpend} color="#2DB400" width={280} height={60} /></div>
            </div>
            <div>
              <p className="text-xs text-text-tertiary mb-2">노출수 추이</p>
              <div className="overflow-x-auto"><MiniLineChart data={trendImpressions} color="#8B5CF6" width={280} height={60} /></div>
            </div>
            <div>
              <p className="text-xs text-text-tertiary mb-2">클릭수 추이</p>
              <div className="overflow-x-auto"><MiniLineChart data={trendClicks} color="#3B82F6" width={280} height={60} /></div>
            </div>
          </div>
        </div>
      )}

      {/* Campaign List */}
      <div className="bg-bg-1 rounded-xl border border-border-primary overflow-hidden">
        <div className="px-6 py-4 border-b border-border-primary">
          <h2 className="text-base font-semibold text-text-primary flex items-center gap-2">
            <Monitor size={18} className="text-green" />
            GFA 캠페인 목록
          </h2>
        </div>
        {loadingCampaigns ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="animate-spin text-green" size={24} />
            <span className="ml-2 text-text-tertiary">캠페인 로딩 중...</span>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="text-center py-12 text-text-tertiary">
            <Monitor size={48} className="mx-auto mb-3 text-text-quaternary" />
            <p>등록된 GFA 캠페인이 없습니다.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1000px]">
              <thead className="bg-bg-0">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase">캠페인명</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase">목적</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase">상태</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-text-tertiary uppercase">일예산</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-text-tertiary uppercase">비용</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-text-tertiary uppercase">노출</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-text-tertiary uppercase">클릭</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-text-tertiary uppercase">CTR</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-text-tertiary uppercase">CPM</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-text-tertiary uppercase">ROAS</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-text-tertiary uppercase">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-primary">
                {campaigns.map((campaign: any) => {
                  const cid = campaign.campaignId || campaign.id;
                  const isExpanded = expandedCampaign === cid;
                  const status = STATUS_KO[campaign.status] || { label: campaign.status, color: 'bg-bg-2 text-text-tertiary' };

                  return (
                    <GFACampaignRow
                      key={cid}
                      campaign={campaign}
                      campaignId={cid}
                      isExpanded={isExpanded}
                      status={status}
                      onToggleExpand={() => setExpandedCampaign(isExpanded ? null : cid)}
                      adgroups={isExpanded ? (adgroupsData?.adgroups || adgroupsData || []) : []}
                      loadingAdgroups={loadingAdgroups && isExpanded}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Top Creatives */}
      {topCreatives.length > 0 && (
        <div className="bg-bg-1 rounded-xl border border-border-primary p-6">
          <h2 className="text-base font-semibold text-text-primary mb-4 flex items-center gap-2">
            <Award size={18} className="text-green" />
            크리에이티브 성과
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {topCreatives.slice(0, 6).map((creative: any, i: number) => (
              <div key={i} className="border border-border-primary rounded-lg p-4">
                <div className="flex items-start gap-3">
                  {creative.imageUrl ? (
                    <div className="w-16 h-16 bg-bg-2 rounded-lg overflow-hidden flex-shrink-0">
                      <img src={creative.imageUrl} alt={creative.title || ''} className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="w-16 h-16 bg-bg-2 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Image size={20} className="text-text-quaternary" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">{creative.title || creative.name || `크리에이티브 ${i + 1}`}</p>
                    <p className="text-xs text-text-tertiary mt-1">{creative.type || 'IMAGE'}</p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-text-tertiary">
                      <span>클릭 {formatNaverNumber(creative.clicks || 0)}</span>
                      <span>CTR {formatNaverPercent(creative.ctr || 0)}</span>
                    </div>
                    <p className="text-xs text-text-tertiary mt-1">비용 {formatNaverCurrency(creative.spend || 0)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Analysis */}
      <div className="bg-bg-1 rounded-xl border border-border-primary p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-text-primary flex items-center gap-2">
            <Sparkles size={18} className="text-green" />
            AI 분석
          </h2>
          <button
            onClick={handleAiAnalysis}
            disabled={aiMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-green text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            {aiMutation.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Sparkles size={16} />
            )}
            {aiMutation.isPending ? '분석 중...' : '분석하기'}
          </button>
        </div>

        {!aiTriggered ? (
          <div className="text-center py-8 text-text-quaternary">
            <Sparkles size={40} className="mx-auto mb-3" />
            <p className="text-sm">AI 분석 버튼을 클릭하면 GFA 성과에 대한 인사이트를 제공합니다.</p>
          </div>
        ) : aiMutation.isPending ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="animate-spin text-green" size={24} />
            <span className="ml-3 text-text-tertiary">AI가 GFA 성과를 분석하고 있습니다...</span>
          </div>
        ) : aiMutation.data ? (
          <div className="space-y-4">
            {typeof aiMutation.data === 'string' ? (
              <div className="prose prose-sm max-w-none text-text-secondary whitespace-pre-wrap">{aiMutation.data}</div>
            ) : (
              <>
                {aiMutation.data.summary && (
                  <div className="p-4 bg-green/10 rounded-lg border border-green/30">
                    <h3 className="text-sm font-semibold text-green mb-2">요약</h3>
                    <p className="text-sm text-green whitespace-pre-wrap">{aiMutation.data.summary}</p>
                  </div>
                )}
                {aiMutation.data.insights && Array.isArray(aiMutation.data.insights) && (
                  <div className="space-y-2">
                    {aiMutation.data.insights.map((insight: any, i: number) => (
                      <div key={i} className="p-3 bg-bg-0 rounded-lg">
                        <p className="text-sm text-text-secondary">{typeof insight === 'string' ? insight : insight.description || insight.title}</p>
                      </div>
                    ))}
                  </div>
                )}
                {aiMutation.data.recommendations && Array.isArray(aiMutation.data.recommendations) && (
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary mb-2">추천 사항</h3>
                    <ul className="space-y-1">
                      {aiMutation.data.recommendations.map((rec: any, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                          <span className="text-green-500 mt-0.5">&#9679;</span>
                          {typeof rec === 'string' ? rec : rec.description || rec.title}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {aiMutation.data.analysis && (
                  <div className="prose prose-sm max-w-none text-text-secondary whitespace-pre-wrap">{aiMutation.data.analysis}</div>
                )}
              </>
            )}
          </div>
        ) : aiMutation.isError ? (
          <div className="text-center py-8 text-red">
            <p className="text-sm">분석에 실패했습니다. 다시 시도해주세요.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function GFACampaignRow({ campaign, campaignId, isExpanded, status, onToggleExpand, adgroups, loadingAdgroups }: {
  campaign: any;
  campaignId: string;
  isExpanded: boolean;
  status: { label: string; color: string };
  onToggleExpand: () => void;
  adgroups: any[];
  loadingAdgroups: boolean;
}) {
  return (
    <>
      <tr className="hover:bg-bg-2/5 cursor-pointer" onClick={onToggleExpand}>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {isExpanded ? <ChevronDown size={14} className="text-text-quaternary" /> : <ChevronRight size={14} className="text-text-quaternary" />}
            <span className="font-medium text-text-primary">{campaign.name}</span>
          </div>
        </td>
        <td className="px-4 py-3">
          <span className="text-xs text-text-tertiary">{OBJECTIVE_KO[campaign.objective] || campaign.objective || '-'}</span>
        </td>
        <td className="px-4 py-3">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${status.color}`}>{status.label}</span>
        </td>
        <td className="px-4 py-3 text-right text-text-secondary">{formatNaverCurrency(campaign.dailyBudget || 0)}</td>
        <td className="px-4 py-3 text-right font-medium text-text-primary">{formatNaverCurrency(campaign.spend || 0)}</td>
        <td className="px-4 py-3 text-right text-text-secondary">{formatNaverNumber(campaign.impressions || 0)}</td>
        <td className="px-4 py-3 text-right text-text-secondary">{formatNaverNumber(campaign.clicks || 0)}</td>
        <td className="px-4 py-3 text-right text-text-secondary">{formatNaverPercent(campaign.ctr || 0)}</td>
        <td className="px-4 py-3 text-right text-text-secondary">{formatNaverCurrency(campaign.cpm || 0)}</td>
        <td className="px-4 py-3 text-right text-text-secondary">{campaign.roas ? `${(campaign.roas * 100).toFixed(0)}%` : '-'}</td>
        <td className="px-4 py-3 text-center">
          <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
            {campaign.status === 'PAUSED' ? (
              <button className="p-1 hover:bg-green/10 rounded text-green" title="재개">
                <Play size={14} />
              </button>
            ) : (
              <button className="p-1 hover:bg-yellow/10 rounded text-yellow" title="일시중지">
                <Pause size={14} />
              </button>
            )}
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={11} className="px-0 py-0">
            <div className="bg-bg-0 px-8 py-4">
              {loadingAdgroups ? (
                <div className="flex items-center gap-2 text-text-tertiary text-sm py-4">
                  <Loader2 size={16} className="animate-spin" />
                  광고그룹 로딩 중...
                </div>
              ) : adgroups.length === 0 ? (
                <p className="text-sm text-text-quaternary py-2">광고그룹이 없습니다.</p>
              ) : (
                <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead>
                    <tr className="text-xs text-text-tertiary uppercase">
                      <th className="text-left px-3 py-2">광고그룹명</th>
                      <th className="text-left px-3 py-2">상태</th>
                      <th className="text-left px-3 py-2">입찰전략</th>
                      <th className="text-left px-3 py-2">게재위치</th>
                      <th className="text-right px-3 py-2">비용</th>
                      <th className="text-right px-3 py-2">노출</th>
                      <th className="text-right px-3 py-2">클릭</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-primary">
                    {adgroups.map((ag: any) => {
                      const agStatus = STATUS_KO[ag.status] || { label: ag.status, color: 'bg-bg-2 text-text-tertiary' };
                      const placements = ag.targeting?.placements || [];
                      return (
                        <tr key={ag.adGroupId || ag.id} className="hover:bg-bg-2">
                          <td className="px-3 py-2 font-medium text-text-primary">{ag.name}</td>
                          <td className="px-3 py-2">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${agStatus.color}`}>{agStatus.label}</span>
                          </td>
                          <td className="px-3 py-2 text-xs text-text-tertiary">{ag.bidStrategy || '-'}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {placements.length > 0 ? placements.map((p: string, i: number) => (
                                <span key={i} className="px-1.5 py-0.5 bg-green/10 text-green rounded text-xs">{PLACEMENT_KO[p] || p}</span>
                              )) : <span className="text-xs text-text-quaternary">-</span>}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right text-text-secondary">{formatNaverCurrency(ag.spend || 0)}</td>
                          <td className="px-3 py-2 text-right text-text-secondary">{formatNaverNumber(ag.impressions || 0)}</td>
                          <td className="px-3 py-2 text-right text-text-secondary">{formatNaverNumber(ag.clicks || 0)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
