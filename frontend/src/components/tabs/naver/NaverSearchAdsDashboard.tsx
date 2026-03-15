'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  BarChart3, DollarSign, Eye, MousePointer, Target, TrendingUp, TrendingDown,
  Loader2, RefreshCw, ChevronDown, ChevronRight, Play, Pause, Sparkles,
  Search, Award, Activity, AlertCircle,
} from 'lucide-react';
import { naverSearchAdsApi, formatNaverCurrency, formatNaverNumber, formatNaverPercent } from '@/lib/naver-api';
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
  ELIGIBLE: { label: '활성', color: 'bg-green-100 text-green-700' },
  ENABLED: { label: '활성', color: 'bg-green-100 text-green-700' },
  ACTIVE: { label: '활성', color: 'bg-green-100 text-green-700' },
  PAUSED: { label: '일시중지', color: 'bg-yellow-100 text-yellow-700' },
  DELETED: { label: '삭제', color: 'bg-red-100 text-red-700' },
  NOAD: { label: '소재없음', color: 'bg-gray-100 text-gray-600' },
};

const CAMPAIGN_TYPE_KO: Record<string, string> = {
  WEB_SITE: '파워링크',
  SHOPPING: '쇼핑검색',
  BRAND_SEARCH: '브랜드검색',
  PERFORMANCE_MAX: '성과최대화',
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

export function NaverSearchAdsDashboard() {
  const [datePreset, setDatePreset] = useState<DatePreset>('last_7_days');
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
  const [aiTriggered, setAiTriggered] = useState(false);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'PAUSED'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch overview
  const { data: overview, isLoading: loadingOverview, isError: overviewError, error: overviewErrorObj, refetch: refetchOverview } = useQuery({
    queryKey: ['naver-search-overview', datePreset],
    queryFn: () => naverSearchAdsApi.getOverview(datePreset),
    retry: 1,
  });

  // Fetch campaigns
  const { data: campaignsData, isLoading: loadingCampaigns, isError: campaignsError, error: campaignsErrorObj } = useQuery({
    queryKey: ['naver-search-campaigns', datePreset],
    queryFn: () => naverSearchAdsApi.getCampaigns(datePreset),
    retry: 1,
  });

  // Fetch trend
  const { data: trendData } = useQuery({
    queryKey: ['naver-search-trend', datePreset],
    queryFn: () => naverSearchAdsApi.getTrend(datePreset),
    retry: 1,
  });

  // Fetch ad groups for expanded campaign
  const { data: adgroupsData, isLoading: loadingAdgroups } = useQuery({
    queryKey: ['naver-search-adgroups', expandedCampaign, datePreset],
    queryFn: () => naverSearchAdsApi.getCampaignAdgroups(expandedCampaign!, datePreset),
    enabled: !!expandedCampaign,
    retry: 1,
  });

  // Budget update mutation
  const budgetMutation = useMutation({
    mutationFn: ({ id, budget }: { id: string; budget: number }) =>
      naverSearchAdsApi.updateCampaign(id, { dailyBudget: budget }),
    onSuccess: () => { refetchOverview(); toast.success('예산이 수정되었습니다.'); },
    onError: () => toast.error('예산 수정에 실패했습니다.'),
  });

  // Pause/Resume mutation
  const toggleMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'pause' | 'resume' }) =>
      action === 'pause' ? naverSearchAdsApi.pauseCampaign(id) : naverSearchAdsApi.resumeCampaign(id),
    onSuccess: () => { refetchOverview(); toast.success('캠페인 상태가 변경되었습니다.'); },
    onError: () => toast.error('캠페인 상태 변경에 실패했습니다.'),
  });

  // AI Analysis
  const aiMutation = useMutation({
    mutationFn: () => naverSearchAdsApi.getAIAnalysis(datePreset, overview),
    onError: (err: any) => {
      const detail = err?.response?.data?.detail || err?.message || '알 수 없는 오류';
      toast.error(`AI 분석 실패: ${detail}`);
      console.error('AI analysis error:', err?.response?.data || err);
    },
  });

  const handleAiAnalysis = () => {
    setAiTriggered(true);
    aiMutation.mutate();
  };

  const allCampaigns = campaignsData?.campaigns || campaignsData || [];
  const campaigns = useMemo(() => {
    let filtered = allCampaigns;
    if (statusFilter !== 'ALL') {
      filtered = filtered.filter((c: any) => c.status === statusFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((c: any) => c.name?.toLowerCase().includes(q));
    }
    return filtered;
  }, [allCampaigns, statusFilter, searchQuery]);

  const kpi = overview?.totals || overview?.kpi || overview || {};
  const trend = trendData?.trend || trendData?.data || trendData || [];

  // Count active / paused
  const activeCount = allCampaigns.filter((c: any) => c.status === 'ACTIVE').length;
  const pausedCount = allCampaigns.filter((c: any) => c.status === 'PAUSED').length;

  // Trend arrays for charts
  const trendSpend = Array.isArray(trend) ? trend.map((d: any) => parseFloat(d.spend || 0)) : [];
  const trendClicks = Array.isArray(trend) ? trend.map((d: any) => parseFloat(d.clicks || 0)) : [];
  const trendImpressions = Array.isArray(trend) ? trend.map((d: any) => parseFloat(d.impressions || 0)) : [];

  // Top keywords from overview
  const topKeywords = overview?.top_keywords || [];

  const kpiCards = [
    {
      label: '총 비용',
      value: formatNaverCurrency(kpi.spend || kpi.total_spend || 0),
      icon: DollarSign,
      color: 'text-green-600',
      bg: 'bg-green-50',
    },
    {
      label: '클릭수',
      value: formatNaverNumber(kpi.clicks || kpi.total_clicks || 0),
      icon: MousePointer,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      label: '노출수',
      value: formatNaverNumber(kpi.impressions || kpi.total_impressions || 0),
      icon: Eye,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
    },
    {
      label: 'CTR',
      value: formatNaverPercent(kpi.ctr || 0),
      icon: Target,
      color: 'text-orange-600',
      bg: 'bg-orange-50',
    },
    {
      label: 'ROAS',
      value: kpi.roas ? `${kpi.roas.toFixed(0)}%` : '-',
      icon: TrendingUp,
      color: 'text-indigo-600',
      bg: 'bg-indigo-50',
    },
    {
      label: '전환수',
      value: formatNaverNumber(kpi.conversions || kpi.total_conversions || 0),
      icon: Award,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
    },
    {
      label: '직접전환매출',
      value: formatNaverCurrency(kpi.revenue || kpi.conversion_value || kpi.total_revenue || 0),
      icon: BarChart3,
      color: 'text-rose-600',
      bg: 'bg-rose-50',
    },
    {
      label: '평균 노출순위',
      value: kpi.avg_rank ? `${kpi.avg_rank}위` : '-',
      icon: Activity,
      color: 'text-amber-600',
      bg: 'bg-amber-50',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart3 className="text-green-600" size={28} />
            검색광고 성과 대시보드
          </h1>
          <p className="text-sm text-gray-500 mt-1">네이버 검색광고 실시간 성과 분석</p>
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

      {/* Overview Error Banner */}
      {(overviewError || campaignsError) && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 space-y-3">
          <div className="flex items-center gap-3">
            <AlertCircle className="text-red-500 shrink-0" size={20} />
            <div>
              <p className="text-red-700 font-medium text-sm">검색광고 API 연결 실패</p>
              <p className="text-red-500 text-xs mt-0.5">
                {(overviewErrorObj as any)?.response?.data?.detail
                  || (campaignsErrorObj as any)?.response?.data?.detail
                  || (overviewErrorObj as any)?.message
                  || (campaignsErrorObj as any)?.message
                  || '네이버 검색광고 API 키를 확인해주세요.'}
              </p>
            </div>
          </div>
          {!debugInfo && (
            <button
              onClick={async () => {
                try {
                  const info = await naverSearchAdsApi.envCheck();
                  setDebugInfo(info);
                } catch (e: any) {
                  setDebugInfo({ error: e?.response?.data?.detail || e?.message || 'env-check 호출 실패' });
                }
              }}
              className="text-xs bg-red-100 text-red-700 px-3 py-1.5 rounded-lg hover:bg-red-200 transition-colors"
            >
              환경변수 진단
            </button>
          )}
          {debugInfo && (
            <div className="bg-white rounded-lg p-3 text-xs font-mono space-y-1 border border-red-100">
              <p className="font-semibold text-gray-700 mb-2">Railway 환경변수 상태:</p>
              {Object.entries(debugInfo).map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <span className="text-gray-500">{k}:</span>
                  <span className={v === true || v === 'OK' ? 'text-green-600' : v === false || v === 'ERROR' ? 'text-red-600' : 'text-gray-800'}>
                    {String(v)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stat debug info */}
      {overview && !overviewError && overview._debug_stat_error && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 mb-2 flex items-center gap-2">
          <AlertCircle className="text-yellow-500 shrink-0" size={16} />
          <p className="text-yellow-700 text-xs">통계 조회 오류: {overview._debug_stat_error} (stat_count: {overview._debug_stat_count})</p>
        </div>
      )}
      {overview && !overviewError && !overview._debug_stat_error && overview._debug_stat_count === 0 && kpi.spend === 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-2 flex items-center gap-2">
          <AlertCircle className="text-blue-500 shrink-0" size={16} />
          <p className="text-blue-700 text-xs">선택한 기간에 검색광고 지출 데이터가 없습니다. 캠페인이 일시중지 상태일 수 있습니다.</p>
        </div>
      )}

      {/* KPI Cards */}
      {loadingOverview ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-green-600" size={32} />
          <span className="ml-3 text-gray-500">데이터 로딩 중...</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-4">
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
              <p className="text-xs text-gray-500 mb-2">클릭수 추이</p>
              <MiniLineChart data={trendClicks} color="#3B82F6" width={280} height={60} />
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-2">노출수 추이</p>
              <MiniLineChart data={trendImpressions} color="#8B5CF6" width={280} height={60} />
            </div>
          </div>
        </div>
      )}

      {/* Campaign List */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <Search size={18} className="text-green-600" />
              캠페인 목록
              <span className="text-xs text-gray-400 font-normal ml-1">({allCampaigns.length}개)</span>
            </h2>
          </div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            {/* Status filter tabs */}
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
              {([
                { value: 'ALL' as const, label: '전체', count: allCampaigns.length },
                { value: 'ACTIVE' as const, label: '활성', count: activeCount },
                { value: 'PAUSED' as const, label: '중지', count: pausedCount },
              ]).map((tab) => (
                <button
                  key={tab.value}
                  onClick={() => setStatusFilter(tab.value)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    statusFilter === tab.value
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab.label} <span className="text-gray-400">({tab.count})</span>
                </button>
              ))}
            </div>
            {/* Search */}
            <div className="relative flex-1 w-full sm:max-w-xs">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="캠페인 검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-200 focus:border-green-400"
              />
            </div>
          </div>
        </div>
        {loadingCampaigns ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="animate-spin text-green-600" size={24} />
            <span className="ml-2 text-gray-500">캠페인 로딩 중...</span>
          </div>
        ) : campaignsError ? (
          <div className="text-center py-8">
            <AlertCircle size={32} className="text-red-400 mx-auto mb-2" />
            <p className="text-red-500 text-sm">캠페인 데이터를 불러올 수 없습니다</p>
            <p className="text-gray-400 text-xs mt-1">
              {(campaignsErrorObj as any)?.response?.data?.detail
                || (campaignsErrorObj as any)?.message
                || 'API 연결 상태를 확인해주세요'}
            </p>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Search size={48} className="mx-auto mb-3 text-gray-300" />
            <p>등록된 검색광고 캠페인이 없습니다.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">캠페인명</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">유형</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">상태</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">일예산</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">비용</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">클릭</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">CTR</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">CPC</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">전환</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">ROAS</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">노출순위</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {campaigns.map((campaign: any) => {
                  const campaignId = campaign.campaign_id || campaign.nccCampaignId || campaign.id;
                  const isExpanded = expandedCampaign === campaignId;
                  const status = STATUS_KO[campaign.status] || { label: campaign.status, color: 'bg-gray-100 text-gray-600' };

                  return (
                    <CampaignRow
                      key={campaignId}
                      campaign={campaign}
                      campaignId={campaignId}
                      isExpanded={isExpanded}
                      status={status}
                      onToggleExpand={() => setExpandedCampaign(isExpanded ? null : campaignId)}
                      adgroups={isExpanded ? (adgroupsData?.adgroups || adgroupsData || []) : []}
                      loadingAdgroups={loadingAdgroups && isExpanded}
                      onUpdateBudget={(id, budget) => budgetMutation.mutate({ id, budget })}
                      onToggleStatus={(id, action) => toggleMutation.mutate({ id, action })}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Top Keywords */}
      {topKeywords.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Award size={18} className="text-green-600" />
            키워드 성과 요약
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-3">클릭수 Top 키워드</h3>
              <div className="space-y-2">
                {topKeywords.slice(0, 5).map((kw: any, i: number) => (
                  <div key={i} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 bg-green-100 text-green-700 rounded-full flex items-center justify-center text-xs font-bold">{i + 1}</span>
                      <span className="text-sm font-medium text-gray-800">{kw.keyword}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-semibold text-gray-900">{formatNaverNumber(kw.clicks || 0)}</span>
                      <span className="text-xs text-gray-400 ml-1">클릭</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-3">전환 Top 키워드</h3>
              <div className="space-y-2">
                {topKeywords
                  .sort((a: any, b: any) => (b.conversions || 0) - (a.conversions || 0))
                  .slice(0, 5)
                  .map((kw: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center text-xs font-bold">{i + 1}</span>
                        <span className="text-sm font-medium text-gray-800">{kw.keyword}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-semibold text-gray-900">{formatNaverNumber(kw.conversions || 0)}</span>
                        <span className="text-xs text-gray-400 ml-1">전환</span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI Analysis Section */}
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
            <p className="text-sm">AI 분석 버튼을 클릭하면 검색광고 성과에 대한 인사이트를 제공합니다.</p>
          </div>
        ) : aiMutation.isPending ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="animate-spin text-green-600" size={24} />
            <span className="ml-3 text-gray-500">AI가 성과 데이터를 분석하고 있습니다...</span>
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

// Campaign Row with expandable ad groups
function CampaignRow({ campaign, campaignId, isExpanded, status, onToggleExpand, adgroups, loadingAdgroups, onUpdateBudget, onToggleStatus }: {
  campaign: any;
  campaignId: string;
  isExpanded: boolean;
  status: { label: string; color: string };
  onToggleExpand: () => void;
  adgroups: any[];
  loadingAdgroups: boolean;
  onUpdateBudget: (campaignId: string, budget: number) => void;
  onToggleStatus: (campaignId: string, action: 'pause' | 'resume') => void;
}) {
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetValue, setBudgetValue] = useState(String(campaign.daily_budget || campaign.dailyBudget || 0));
  const [expandTab, setExpandTab] = useState<'adgroups' | 'keywords'>('adgroups');
  const [agStatusFilter, setAgStatusFilter] = useState<'ALL' | 'ACTIVE' | 'PAUSED'>('ALL');
  const [kwStatusFilter, setKwStatusFilter] = useState<'ALL' | 'ACTIVE' | 'PAUSED'>('ALL');

  const { data: rankingData, isLoading: loadingRankings } = useQuery({
    queryKey: ['naver-keyword-rankings', campaignId],
    queryFn: () => naverSearchAdsApi.getCampaignKeywordRankings(campaignId),
    enabled: isExpanded && expandTab === 'keywords',
    staleTime: 5 * 60 * 1000,
  });

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
          <span className="text-xs text-gray-500">{CAMPAIGN_TYPE_KO[campaign.campaign_tp || campaign.campaignTp] || campaign.campaign_tp || campaign.campaignTp || '-'}</span>
        </td>
        <td className="px-4 py-3">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${status.color}`}>{status.label}</span>
        </td>
        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
          {editingBudget ? (
            <div className="flex items-center justify-end gap-1">
              <input
                type="number"
                value={budgetValue}
                onChange={(e) => setBudgetValue(e.target.value)}
                className="w-24 px-2 py-1 text-sm border rounded text-right"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    onUpdateBudget(campaignId, parseInt(budgetValue));
                    setEditingBudget(false);
                  }
                  if (e.key === 'Escape') setEditingBudget(false);
                }}
              />
              <button onClick={() => { onUpdateBudget(campaignId, parseInt(budgetValue)); setEditingBudget(false); }}
                className="text-green-600 hover:bg-green-50 p-1 rounded">
                <ChevronRight size={12} />
              </button>
            </div>
          ) : (
            <span className="cursor-pointer hover:text-green-600 hover:underline" onClick={() => setEditingBudget(true)}>
              {formatNaverCurrency(campaign.daily_budget || campaign.dailyBudget || 0)}
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-right font-medium text-gray-900">{formatNaverCurrency(campaign.spend || 0)}</td>
        <td className="px-4 py-3 text-right text-gray-700">{formatNaverNumber(campaign.clicks || 0)}</td>
        <td className="px-4 py-3 text-right text-gray-700">{formatNaverPercent(campaign.ctr || 0)}</td>
        <td className="px-4 py-3 text-right text-gray-700">{formatNaverCurrency(campaign.cpc || 0)}</td>
        <td className="px-4 py-3 text-right text-gray-700">{formatNaverNumber(campaign.conversions || 0)}</td>
        <td className="px-4 py-3 text-right text-gray-700">{campaign.roas ? `${campaign.roas.toFixed(0)}%` : '-'}</td>
        <td className="px-4 py-3 text-right text-gray-700">{campaign.avg_rank ? `${campaign.avg_rank}위` : '-'}</td>
        <td className="px-4 py-3 text-center">
          <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
            {campaign.status === 'PAUSED' ? (
              <button className="p-1 hover:bg-green-50 rounded text-green-600" title="재개"
                onClick={() => onToggleStatus(campaignId, 'resume')}>
                <Play size={14} />
              </button>
            ) : (
              <button className="p-1 hover:bg-yellow-50 rounded text-yellow-600" title="일시중지"
                onClick={() => onToggleStatus(campaignId, 'pause')}>
                <Pause size={14} />
              </button>
            )}
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={12} className="px-0 py-0">
            <div className="bg-gray-50 px-6 py-4">
              {/* Tabs */}
              <div className="flex items-center gap-1 mb-3 bg-gray-200 rounded-lg p-0.5 w-fit">
                <button onClick={() => setExpandTab('adgroups')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${expandTab === 'adgroups' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  광고그룹
                </button>
                <button onClick={() => setExpandTab('keywords')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${expandTab === 'keywords' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  키워드 · 쇼핑랭킹
                </button>
              </div>

              {/* Ad Groups Tab */}
              {expandTab === 'adgroups' && (() => {
                const activeAgs = adgroups.filter((a: any) => a.status === 'ACTIVE');
                const pausedAgs = adgroups.filter((a: any) => a.status === 'PAUSED');
                const filteredAgs = agStatusFilter === 'ALL' ? adgroups :
                  agStatusFilter === 'ACTIVE' ? activeAgs : pausedAgs;
                return (
                  <>
                    {loadingAdgroups ? (
                      <div className="flex items-center gap-2 text-gray-500 text-sm py-4">
                        <Loader2 size={16} className="animate-spin" /> 광고그룹 로딩 중...
                      </div>
                    ) : adgroups.length === 0 ? (
                      <p className="text-sm text-gray-400 py-2">광고그룹이 없습니다.</p>
                    ) : (
                      <>
                        <div className="flex items-center gap-1 mb-2 bg-gray-100 rounded-lg p-0.5 w-fit">
                          {([
                            { v: 'ALL' as const, l: '전체', c: adgroups.length },
                            { v: 'ACTIVE' as const, l: '활성', c: activeAgs.length },
                            { v: 'PAUSED' as const, l: '중지', c: pausedAgs.length },
                          ]).map(t => (
                            <button key={t.v} onClick={() => setAgStatusFilter(t.v)}
                              className={`px-2 py-1 text-xs font-medium rounded transition-colors ${agStatusFilter === t.v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                              {t.l} ({t.c})
                            </button>
                          ))}
                        </div>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-xs text-gray-500 uppercase">
                              <th className="text-left px-3 py-2">광고그룹명</th>
                              <th className="text-left px-3 py-2">상태</th>
                              <th className="text-right px-3 py-2">입찰가</th>
                              <th className="text-right px-3 py-2">비용</th>
                              <th className="text-right px-3 py-2">클릭</th>
                              <th className="text-right px-3 py-2">CTR</th>
                              <th className="text-right px-3 py-2">CPC</th>
                              <th className="text-right px-3 py-2">ROAS</th>
                              <th className="text-right px-3 py-2">노출순위</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {filteredAgs.map((ag: any) => {
                              const agStatus = STATUS_KO[ag.status] || { label: ag.status, color: 'bg-gray-100 text-gray-600' };
                              return (
                                <tr key={ag.nccAdgroupId || ag.id} className="hover:bg-white">
                                  <td className="px-3 py-2 font-medium text-gray-800">{ag.name}</td>
                                  <td className="px-3 py-2">
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${agStatus.color}`}>{agStatus.label}</span>
                                  </td>
                                  <td className="px-3 py-2 text-right text-gray-700">{formatNaverCurrency(ag.bidAmt || 0)}</td>
                                  <td className="px-3 py-2 text-right text-gray-700">{formatNaverCurrency(ag.spend || 0)}</td>
                                  <td className="px-3 py-2 text-right text-gray-700">{formatNaverNumber(ag.clicks || 0)}</td>
                                  <td className="px-3 py-2 text-right text-gray-700">{formatNaverPercent(ag.ctr || 0)}</td>
                                  <td className="px-3 py-2 text-right text-gray-700">{formatNaverCurrency(ag.cpc || 0)}</td>
                                  <td className="px-3 py-2 text-right">
                                    {ag.roas != null ? (
                                      <span className={`font-medium ${ag.roas >= 300 ? 'text-green-600' : ag.roas >= 100 ? 'text-blue-600' : 'text-red-500'}`}>
                                        {ag.roas.toFixed(0)}%
                                      </span>
                                    ) : <span className="text-gray-300">-</span>}
                                  </td>
                                  <td className="px-3 py-2 text-right text-gray-700">
                                    {ag.avg_rank ? (
                                      <span className={`font-medium ${ag.avg_rank <= 3 ? 'text-green-600' : ag.avg_rank <= 7 ? 'text-blue-600' : 'text-gray-600'}`}>
                                        {ag.avg_rank}위
                                      </span>
                                    ) : '-'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </>
                    )}
                  </>
                );
              })()}

              {/* Keywords + Shopping Rank Tab */}
              {expandTab === 'keywords' && (
                <>
                  {loadingRankings ? (
                    <div className="flex items-center gap-2 text-gray-500 text-sm py-4">
                      <Loader2 size={16} className="animate-spin" /> 키워드·품질지수·쇼핑랭킹 조회 중...
                    </div>
                  ) : !rankingData?.rankings?.length ? (
                    <div className="py-3 space-y-2">
                      <p className="text-sm text-gray-500">이 캠페인에 등록된 키워드가 없습니다.</p>
                      {rankingData?._debug && (
                        <p className="text-xs text-yellow-600 bg-yellow-50 p-2 rounded">{rankingData._debug}</p>
                      )}
                      {rankingData?._adgroup_count !== undefined && (
                        <p className="text-xs text-gray-400">광고그룹 {rankingData._adgroup_count}개
                          {rankingData._adgroup_names?.length > 0 && `: ${rankingData._adgroup_names.join(', ')}`}
                        </p>
                      )}
                      {/* Show ads even if no keywords */}
                      {rankingData?.ads?.length > 0 && (
                        <div className="mt-3">
                          <p className="text-xs font-medium text-gray-600 mb-1">등록된 소재 ({rankingData.ads.length}개)</p>
                          <div className="space-y-1">
                            {rankingData.ads.map((ad: any) => (
                              <div key={ad.nccAdId} className="flex items-center gap-2 bg-white p-2 rounded text-xs">
                                <span className="text-gray-500">{ad.adgroupName}</span>
                                <span className="font-medium text-gray-800">{ad.title || '(제목없음)'}</span>
                                <span className={`px-1.5 py-0.5 rounded text-xs ${ad.status === 'ELIGIBLE' ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-500'}`}>{ad.inspectStatus || ad.status}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (() => {
                    const activeKws = rankingData.rankings.filter((r: any) => r.status === '활성');
                    const pausedKws = rankingData.rankings.filter((r: any) => r.status === '중지');
                    const filteredKws = kwStatusFilter === 'ALL' ? rankingData.rankings :
                      kwStatusFilter === 'ACTIVE' ? activeKws : pausedKws;
                    return (
                    <div className="space-y-4">
                      <p className="text-xs text-gray-400">
                        {rankingData.campaign_type === 'SHOPPING' ? (
                          <>광고그룹에서 추출한 검색어 {rankingData.checked_keywords}개 조회</>
                        ) : (
                          <>전체 {rankingData.total_keywords}개 키워드 중 상위 {rankingData.checked_keywords}개 조회</>
                        )}
                        {' '}· 브랜드: <strong className="text-green-600">널담</strong>
                        {rankingData._adgroup_count !== undefined && ` · 광고그룹 ${rankingData._adgroup_count}개`}
                        {rankingData.ads?.length > 0 && ` · 소재 ${rankingData.ads.length}개`}
                      </p>
                      {rankingData.campaign_type === 'SHOPPING' && (
                        <p className="text-xs text-blue-500 bg-blue-50 px-2 py-1 rounded">
                          쇼핑검색 캠페인: 광고그룹 이름에서 검색어를 자동 추출하여 네이버 쇼핑 랭킹을 조회합니다.
                        </p>
                      )}

                      {/* Status filter */}
                      <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5 w-fit">
                        {([
                          { v: 'ALL' as const, l: '전체', c: rankingData.rankings.length },
                          { v: 'ACTIVE' as const, l: '활성', c: activeKws.length },
                          { v: 'PAUSED' as const, l: '중지', c: pausedKws.length },
                        ]).map(t => (
                          <button key={t.v} onClick={() => setKwStatusFilter(t.v)}
                            className={`px-2 py-1 text-xs font-medium rounded transition-colors ${kwStatusFilter === t.v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                            {t.l} ({t.c})
                          </button>
                        ))}
                      </div>

                      {/* Keyword + Quality + Ranking Table */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-xs text-gray-500 uppercase bg-white">
                              <th className="text-left px-3 py-2">키워드</th>
                              <th className="text-left px-3 py-2">광고그룹</th>
                              <th className="text-left px-3 py-2">상태</th>
                              <th className="text-right px-3 py-2">입찰가</th>
                              <th className="text-center px-3 py-2">{rankingData.campaign_type === 'SHOPPING' ? '유형' : '품질지수'}</th>
                              <th className="text-center px-3 py-2">쇼핑 랭킹</th>
                              <th className="text-left px-3 py-2">매칭 상품</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {filteredKws.map((r: any) => (
                              <tr key={r.nccKeywordId || r.keyword} className="hover:bg-white">
                                <td className="px-3 py-2 font-medium text-gray-900">{r.keyword}</td>
                                <td className="px-3 py-2 text-xs text-gray-500">{r.adgroupName}</td>
                                <td className="px-3 py-2">
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.status === '활성' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                    {r.status}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-right text-gray-700">{formatNaverCurrency(r.bidAmt || 0)}</td>
                                <td className="px-3 py-2 text-center">
                                  {r.qualityIndex != null ? (
                                    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                                      r.qualityIndex >= 8 ? 'bg-green-100 text-green-700' :
                                      r.qualityIndex >= 5 ? 'bg-blue-100 text-blue-700' :
                                      r.qualityIndex >= 3 ? 'bg-yellow-100 text-yellow-700' :
                                      'bg-red-100 text-red-700'
                                    }`}>
                                      {r.qualityIndex}
                                    </span>
                                  ) : r.source === 'adgroup_name' ? (
                                    <span className="px-1.5 py-0.5 rounded text-xs bg-purple-50 text-purple-600">쇼핑</span>
                                  ) : (
                                    <span className="text-xs text-gray-300">-</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  {r.shopping_rank ? (
                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${
                                      r.shopping_rank <= 5 ? 'bg-green-100 text-green-700' :
                                      r.shopping_rank <= 15 ? 'bg-blue-100 text-blue-700' :
                                      r.shopping_rank <= 30 ? 'bg-yellow-100 text-yellow-700' :
                                      'bg-gray-100 text-gray-600'
                                    }`}>
                                      <Award size={10} /> {r.shopping_rank_label}
                                    </span>
                                  ) : (
                                    <span className="text-xs text-gray-400">{r.shopping_error ? `오류` : '미노출'}</span>
                                  )}
                                </td>
                                <td className="px-3 py-2">
                                  {r.matched_product ? (
                                    <div className="flex items-center gap-2">
                                      {r.matched_product.image && (
                                        <img src={r.matched_product.image} alt="" className="w-8 h-8 rounded object-cover" />
                                      )}
                                      <div className="min-w-0">
                                        <p className="text-xs text-gray-800 truncate max-w-[180px]">{r.matched_product.title}</p>
                                        <p className="text-xs text-gray-400">{r.matched_product.price ? `₩${Number(r.matched_product.price).toLocaleString()}` : ''}</p>
                                      </div>
                                    </div>
                                  ) : (
                                    <span className="text-xs text-gray-300">-</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Registered Ads */}
                      {rankingData.ads?.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-gray-600 mb-2">등록된 소재 ({rankingData.ads.length}개)</p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {rankingData.ads.map((ad: any) => (
                              <div key={ad.nccAdId} className="flex items-start gap-2 bg-white p-2.5 rounded-lg border border-gray-100">
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium text-gray-800 truncate">{ad.title || '(제목없음)'}</p>
                                  {ad.description && <p className="text-xs text-gray-500 truncate">{ad.description}</p>}
                                  <div className="flex items-center gap-1.5 mt-1">
                                    <span className="text-xs text-gray-400">{ad.adgroupName}</span>
                                    <span className={`px-1.5 py-0.5 rounded text-xs ${ad.status === 'ELIGIBLE' ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-500'}`}>
                                      {ad.inspectStatus || ad.status || '-'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    );
                  })()}
                </>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
