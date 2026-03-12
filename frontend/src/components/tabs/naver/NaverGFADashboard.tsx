'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Monitor, DollarSign, Eye, MousePointer, Target, TrendingUp,
  Loader2, RefreshCw, ChevronDown, ChevronRight, Sparkles,
  Image, Activity, Play, Pause, Award,
} from 'lucide-react';
import { naverGFAApi, formatNaverCurrency, formatNaverNumber, formatNaverPercent } from '@/lib/naver-api';
import toast from 'react-hot-toast';

type DatePreset = 'today' | 'yesterday' | 'last_7_days' | 'last_14_days' | 'last_30_days' | 'this_month';

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'today', label: '오늘' },
  { value: 'yesterday', label: '어제' },
  { value: 'last_7_days', label: '최근 7일' },
  { value: 'last_14_days', label: '최근 14일' },
  { value: 'last_30_days', label: '최근 30일' },
  { value: 'this_month', label: '이번달' },
];

const STATUS_KO: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: '활성', color: 'bg-green-100 text-green-700' },
  ELIGIBLE: { label: '활성', color: 'bg-green-100 text-green-700' },
  ENABLED: { label: '활성', color: 'bg-green-100 text-green-700' },
  PAUSED: { label: '일시중지', color: 'bg-yellow-100 text-yellow-700' },
  DELETED: { label: '삭제', color: 'bg-red-100 text-red-700' },
  COMPLETED: { label: '완료', color: 'bg-gray-100 text-gray-600' },
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
  if (!data || data.length < 2) return <div style={{ width, height }} className="bg-gray-50 rounded" />;
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

  // Fetch overview
  const { data: overview, isLoading: loadingOverview, refetch: refetchOverview } = useQuery({
    queryKey: ['naver-gfa-overview', datePreset],
    queryFn: () => naverGFAApi.getOverview(datePreset),
    retry: 1,
  });

  // Fetch campaigns
  const { data: campaignsData, isLoading: loadingCampaigns } = useQuery({
    queryKey: ['naver-gfa-campaigns', datePreset],
    queryFn: () => naverGFAApi.getCampaigns(datePreset),
    retry: 1,
  });

  // Fetch trend
  const { data: trendData } = useQuery({
    queryKey: ['naver-gfa-trend', datePreset],
    queryFn: () => naverGFAApi.getTrend(datePreset),
    retry: 1,
  });

  // Fetch ad groups for expanded campaign
  const { data: adgroupsData, isLoading: loadingAdgroups } = useQuery({
    queryKey: ['naver-gfa-adgroups', expandedCampaign],
    queryFn: () => naverGFAApi.getCampaignAdgroups(expandedCampaign!),
    enabled: !!expandedCampaign,
    retry: 1,
  });

  // AI Analysis
  const aiMutation = useMutation({
    mutationFn: () => naverGFAApi.getAIAnalysis(datePreset, overview),
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
      color: 'text-green-600',
      bg: 'bg-green-50',
    },
    {
      label: '노출',
      value: formatNaverNumber(kpi.impressions || kpi.total_impressions || 0),
      icon: Eye,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
    },
    {
      label: '클릭',
      value: formatNaverNumber(kpi.clicks || kpi.total_clicks || 0),
      icon: MousePointer,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      label: 'CTR',
      value: formatNaverPercent(kpi.ctr || 0),
      icon: Target,
      color: 'text-orange-600',
      bg: 'bg-orange-50',
    },
    {
      label: 'CPM',
      value: formatNaverCurrency(kpi.cpm || 0),
      icon: Activity,
      color: 'text-cyan-600',
      bg: 'bg-cyan-50',
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
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Monitor className="text-green-600" size={28} />
            GFA 성과 대시보드
          </h1>
          <p className="text-sm text-gray-500 mt-1">네이버 성과형 디스플레이 광고 분석</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value as DatePreset)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:border-green-500 focus:ring-1 focus:ring-green-500 focus:outline-none"
          >
            {DATE_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          <button
            onClick={() => refetchOverview()}
            className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
            title="새로고침"
          >
            <RefreshCw size={16} className="text-gray-500" />
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      {loadingOverview ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-green-600" size={32} />
          <span className="ml-3 text-gray-500">데이터 로딩 중...</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {kpiCards.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.label} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-500 font-medium">{card.label}</span>
                  <div className={`w-8 h-8 ${card.bg} rounded-lg flex items-center justify-center`}>
                    <Icon size={16} className={card.color} />
                  </div>
                </div>
                <p className="text-lg font-bold text-gray-900">{card.value}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Trend Chart */}
      {trendSpend.length > 1 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Activity size={18} className="text-green-600" />
            트렌드 차트
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <p className="text-xs text-gray-500 mb-2">비용 추이</p>
              <MiniLineChart data={trendSpend} color="#2DB400" width={280} height={60} />
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-2">노출수 추이</p>
              <MiniLineChart data={trendImpressions} color="#8B5CF6" width={280} height={60} />
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-2">클릭수 추이</p>
              <MiniLineChart data={trendClicks} color="#3B82F6" width={280} height={60} />
            </div>
          </div>
        </div>
      )}

      {/* Campaign List */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Monitor size={18} className="text-green-600" />
            GFA 캠페인 목록
          </h2>
        </div>
        {loadingCampaigns ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="animate-spin text-green-600" size={24} />
            <span className="ml-2 text-gray-500">캠페인 로딩 중...</span>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Monitor size={48} className="mx-auto mb-3 text-gray-300" />
            <p>등록된 GFA 캠페인이 없습니다.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">캠페인명</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">목적</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">상태</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">일예산</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">비용</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">노출</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">클릭</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">CTR</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">CPM</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">ROAS</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {campaigns.map((campaign: any) => {
                  const cid = campaign.campaignId || campaign.id;
                  const isExpanded = expandedCampaign === cid;
                  const status = STATUS_KO[campaign.status] || { label: campaign.status, color: 'bg-gray-100 text-gray-600' };

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
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Award size={18} className="text-green-600" />
            크리에이티브 성과
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {topCreatives.slice(0, 6).map((creative: any, i: number) => (
              <div key={i} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  {creative.imageUrl ? (
                    <div className="w-16 h-16 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
                      <img src={creative.imageUrl} alt={creative.title || ''} className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Image size={20} className="text-gray-400" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{creative.title || creative.name || `크리에이티브 ${i + 1}`}</p>
                    <p className="text-xs text-gray-500 mt-1">{creative.type || 'IMAGE'}</p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-600">
                      <span>클릭 {formatNaverNumber(creative.clicks || 0)}</span>
                      <span>CTR {formatNaverPercent(creative.ctr || 0)}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">비용 {formatNaverCurrency(creative.spend || 0)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Analysis */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Sparkles size={18} className="text-green-600" />
            AI 분석
          </h2>
          <button
            onClick={handleAiAnalysis}
            disabled={aiMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50"
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
          <div className="text-center py-8 text-gray-400">
            <Sparkles size={40} className="mx-auto mb-3" />
            <p className="text-sm">AI 분석 버튼을 클릭하면 GFA 성과에 대한 인사이트를 제공합니다.</p>
          </div>
        ) : aiMutation.isPending ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="animate-spin text-green-600" size={24} />
            <span className="ml-3 text-gray-500">AI가 GFA 성과를 분석하고 있습니다...</span>
          </div>
        ) : aiMutation.data ? (
          <div className="space-y-4">
            {typeof aiMutation.data === 'string' ? (
              <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap">{aiMutation.data}</div>
            ) : (
              <>
                {aiMutation.data.summary && (
                  <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                    <h3 className="text-sm font-semibold text-green-800 mb-2">요약</h3>
                    <p className="text-sm text-green-700 whitespace-pre-wrap">{aiMutation.data.summary}</p>
                  </div>
                )}
                {aiMutation.data.insights && Array.isArray(aiMutation.data.insights) && (
                  <div className="space-y-2">
                    {aiMutation.data.insights.map((insight: any, i: number) => (
                      <div key={i} className="p-3 bg-gray-50 rounded-lg">
                        <p className="text-sm text-gray-700">{typeof insight === 'string' ? insight : insight.description || insight.title}</p>
                      </div>
                    ))}
                  </div>
                )}
                {aiMutation.data.recommendations && Array.isArray(aiMutation.data.recommendations) && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800 mb-2">추천 사항</h3>
                    <ul className="space-y-1">
                      {aiMutation.data.recommendations.map((rec: any, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                          <span className="text-green-500 mt-0.5">&#9679;</span>
                          {typeof rec === 'string' ? rec : rec.description || rec.title}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {aiMutation.data.analysis && (
                  <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap">{aiMutation.data.analysis}</div>
                )}
              </>
            )}
          </div>
        ) : aiMutation.isError ? (
          <div className="text-center py-8 text-red-500">
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
      <tr className="hover:bg-gray-50 cursor-pointer" onClick={onToggleExpand}>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {isExpanded ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
            <span className="font-medium text-gray-900">{campaign.name}</span>
          </div>
        </td>
        <td className="px-4 py-3">
          <span className="text-xs text-gray-500">{OBJECTIVE_KO[campaign.objective] || campaign.objective || '-'}</span>
        </td>
        <td className="px-4 py-3">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${status.color}`}>{status.label}</span>
        </td>
        <td className="px-4 py-3 text-right text-gray-700">{formatNaverCurrency(campaign.dailyBudget || 0)}</td>
        <td className="px-4 py-3 text-right font-medium text-gray-900">{formatNaverCurrency(campaign.spend || 0)}</td>
        <td className="px-4 py-3 text-right text-gray-700">{formatNaverNumber(campaign.impressions || 0)}</td>
        <td className="px-4 py-3 text-right text-gray-700">{formatNaverNumber(campaign.clicks || 0)}</td>
        <td className="px-4 py-3 text-right text-gray-700">{formatNaverPercent(campaign.ctr || 0)}</td>
        <td className="px-4 py-3 text-right text-gray-700">{formatNaverCurrency(campaign.cpm || 0)}</td>
        <td className="px-4 py-3 text-right text-gray-700">{campaign.roas ? `${(campaign.roas * 100).toFixed(0)}%` : '-'}</td>
        <td className="px-4 py-3 text-center">
          <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
            {campaign.status === 'PAUSED' ? (
              <button className="p-1 hover:bg-green-50 rounded text-green-600" title="재개">
                <Play size={14} />
              </button>
            ) : (
              <button className="p-1 hover:bg-yellow-50 rounded text-yellow-600" title="일시중지">
                <Pause size={14} />
              </button>
            )}
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={11} className="px-0 py-0">
            <div className="bg-gray-50 px-8 py-4">
              {loadingAdgroups ? (
                <div className="flex items-center gap-2 text-gray-500 text-sm py-4">
                  <Loader2 size={16} className="animate-spin" />
                  광고그룹 로딩 중...
                </div>
              ) : adgroups.length === 0 ? (
                <p className="text-sm text-gray-400 py-2">광고그룹이 없습니다.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 uppercase">
                      <th className="text-left px-3 py-2">광고그룹명</th>
                      <th className="text-left px-3 py-2">상태</th>
                      <th className="text-left px-3 py-2">입찰전략</th>
                      <th className="text-left px-3 py-2">게재위치</th>
                      <th className="text-right px-3 py-2">비용</th>
                      <th className="text-right px-3 py-2">노출</th>
                      <th className="text-right px-3 py-2">클릭</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {adgroups.map((ag: any) => {
                      const agStatus = STATUS_KO[ag.status] || { label: ag.status, color: 'bg-gray-100 text-gray-600' };
                      const placements = ag.targeting?.placements || [];
                      return (
                        <tr key={ag.adGroupId || ag.id} className="hover:bg-white">
                          <td className="px-3 py-2 font-medium text-gray-800">{ag.name}</td>
                          <td className="px-3 py-2">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${agStatus.color}`}>{agStatus.label}</span>
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-600">{ag.bidStrategy || '-'}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {placements.length > 0 ? placements.map((p: string, i: number) => (
                                <span key={i} className="px-1.5 py-0.5 bg-green-50 text-green-700 rounded text-xs">{PLACEMENT_KO[p] || p}</span>
                              )) : <span className="text-xs text-gray-400">-</span>}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right text-gray-700">{formatNaverCurrency(ag.spend || 0)}</td>
                          <td className="px-3 py-2 text-right text-gray-700">{formatNaverNumber(ag.impressions || 0)}</td>
                          <td className="px-3 py-2 text-right text-gray-700">{formatNaverNumber(ag.clicks || 0)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
