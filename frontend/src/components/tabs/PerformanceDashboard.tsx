'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  BarChart3, DollarSign, Eye, MousePointer, Target,
  Play, Pause, ChevronDown, ChevronRight, AlertTriangle, CheckCircle, XCircle,
  Loader2, RefreshCw, Zap, Activity, Users, Layers,
  TrendingUp, TrendingDown, ToggleLeft, ToggleRight, Edit3, Check, X,
  Shield, Sparkles, ArrowRight, Lightbulb, Palette,
  MessageSquare, BarChart2, ExternalLink,
} from 'lucide-react';
import { analyticsApi, clearAnalysisCache } from '@/lib/api';
import toast from 'react-hot-toast';
import type { PerformanceFeedback, CampaignStatusFilter } from '@/types';

type DatePreset = 'today' | 'yesterday' | 'last_3d' | 'last_7d' | 'last_14d' | 'last_30d' | 'this_month' | 'last_month' | 'custom';

// Currency formatting helper - display KRW as-is from API, no multiply/divide
function formatCurrency(amount: number, currency: string = 'KRW'): string {
  if (currency === 'KRW') {
    return `\u20A9${Math.round(amount).toLocaleString('ko-KR')}`;
  }
  return `$${amount.toFixed(2)}`;
}

// Meta action_type → 한국어 번역
const ACTION_TYPE_KO: Record<string, string> = {
  'link_click': '링크 클릭',
  'post_engagement': '게시물 참여',
  'page_engagement': '페이지 참여',
  'like': '좋아요',
  'comment': '댓글',
  'post': '게시',
  'post_reaction': '게시물 반응',
  'photo_view': '사진 보기',
  'video_view': '동영상 조회',
  'landing_page_view': '랜딩페이지 방문',
  'offsite_conversion': '외부 전환',
  'onsite_conversion.messaging_conversation_started_7d': '메시지 대화 시작',
  'onsite_conversion.post_save': '게시물 저장',
  'onsite_conversion.flow_complete': '플로우 완료',
  'purchase': '구매',
  'add_to_cart': '장바구니 추가',
  'initiate_checkout': '결제 시작',
  'lead': '리드',
  'complete_registration': '회원가입 완료',
  'search': '검색',
  'view_content': '콘텐츠 보기',
  'add_payment_info': '결제정보 입력',
  'add_to_wishlist': '위시리스트 추가',
  'contact': '문의',
  'find_location': '위치 찾기',
  'schedule': '예약',
  'start_trial': '체험 시작',
  'subscribe': '구독',
  'customize_product': '제품 커스터마이즈',
  'donate': '기부',
  'omni_purchase': '통합 구매',
  'omni_add_to_cart': '통합 장바구니',
  'omni_initiated_checkout': '통합 결제 시작',
  'omni_view_content': '통합 콘텐츠 보기',
  'impression': '노출',
  'reach': '도달',
  'frequency': '빈도',
  'spend': '지출',
  'cost_per_action_type': '액션당 비용',
  'actions': '전체 액션',
  'conversions': '전환',
  'cost_per_conversion': '전환당 비용',
  'messaging_conversation_started_7d': '메시지 대화 시작',
  'messaging_first_reply': '메시지 첫 답장',
};

function translateActionType(actionType: string): string {
  if (ACTION_TYPE_KO[actionType]) return ACTION_TYPE_KO[actionType];
  for (const [key, val] of Object.entries(ACTION_TYPE_KO)) {
    if (actionType.includes(key)) return val;
  }
  return actionType
    .replace(/^(onsite_conversion\.|offsite_conversion\.)/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

export default function PerformanceDashboard() {
  const [datePreset, setDatePreset] = useState<DatePreset>('last_7d');
  const [customSince, setCustomSince] = useState('');
  const [customUntil, setCustomUntil] = useState('');
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
  const [selectedCampaignForDeep, setSelectedCampaignForDeep] = useState<string | null>(null);
  const [hidePaused, setHidePaused] = useState(false);
  const [statusFilter, setStatusFilter] = useState<CampaignStatusFilter>('ALL');
  const [trendView, setTrendView] = useState<'daily' | 'weekly'>('daily');
  const [feedbackExpanded, setFeedbackExpanded] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const isCustom = datePreset === 'custom' && customSince && customUntil && customSince <= customUntil;

  // Compute date range for this_month / last_month / today / yesterday / last_3d
  const computedDateRange = useMemo(() => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = today.getMonth();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    switch (datePreset) {
      case 'today': return { since: fmt(today), until: fmt(today) };
      case 'yesterday': {
        const y = new Date(today); y.setDate(y.getDate() - 1);
        return { since: fmt(y), until: fmt(y) };
      }
      case 'last_3d': {
        const s = new Date(today); s.setDate(s.getDate() - 2);
        return { since: fmt(s), until: fmt(today) };
      }
      case 'this_month': return { since: `${yyyy}-${String(mm + 1).padStart(2, '0')}-01`, until: fmt(today) };
      case 'last_month': {
        const start = new Date(yyyy, mm - 1, 1);
        const end = new Date(yyyy, mm, 0);
        return { since: fmt(start), until: fmt(end) };
      }
      default: return null;
    }
  }, [datePreset]);

  const isDateRange = isCustom || !!computedDateRange;
  const effectiveSince = computedDateRange?.since || customSince;
  const effectiveUntil = computedDateRange?.until || customUntil;

  const { data: overview, isLoading: loadingOverview, isError: overviewError, refetch: refetchOverview } = useQuery({
    queryKey: ['account-overview', datePreset, effectiveSince, effectiveUntil],
    queryFn: () => isDateRange
      ? analyticsApi.getAccountOverview('last_7d', effectiveSince, effectiveUntil)
      : analyticsApi.getAccountOverview(datePreset),
    refetchInterval: 60000,
    retry: 1,
    enabled: datePreset !== 'custom' || (!!customSince && !!customUntil),
  });

  const daysMap: Record<string, number> = { today: 1, yesterday: 1, last_3d: 3, last_7d: 7, last_14d: 14, last_30d: 30, this_month: 30, last_month: 30 };
  const trendIncrement = trendView === 'weekly' ? 7 : 1;

  // 주간 뷰: 어제 기준으로 정확한 7일 단위 구간 계산
  // last_7d → 이번주(어제~7일전) vs 지난주 = 14일, last_14d → 4주 = 28일, last_30d → 8주 = 56일
  const weeklyRange = useMemo(() => {
    if (trendView !== 'weekly') return null;
    const weeksMap: Record<string, number> = { last_7d: 2, last_14d: 4, last_30d: 8 };
    const totalWeeks = weeksMap[datePreset] || 2;
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const start = new Date(yesterday);
    start.setDate(start.getDate() - (totalWeeks * 7) + 1);
    return {
      since: start.toISOString().slice(0, 10),
      until: yesterday.toISOString().slice(0, 10),
    };
  }, [trendView, datePreset]);

  const trendDaysCount = trendView === 'weekly' ? 56 : (daysMap[datePreset] || 7);

  const { data: trendData } = useQuery({
    queryKey: ['account-trend', datePreset, effectiveSince, effectiveUntil, trendView],
    queryFn: () => {
      if (trendView === 'weekly' && weeklyRange) {
        return analyticsApi.getAccountTrend(14, weeklyRange.since, weeklyRange.until, 7);
      }
      if (isDateRange) {
        return analyticsApi.getAccountTrend(30, effectiveSince, effectiveUntil, trendIncrement);
      }
      return analyticsApi.getAccountTrend(trendDaysCount, undefined, undefined, trendIncrement);
    },
    enabled: overview?.connected === true,
    placeholderData: keepPreviousData,
  });

  // 주간 비교: 이번주 vs 지난주 (정확한 날짜 기반)
  // last_7d 기준 오늘 3/11 → 이번주: 3/4~3/10, 지난주: 2/25~3/3
  const weeklyComparison = useMemo(() => {
    if (trendView !== 'weekly' || !trendData?.data?.length) return null;
    const weeks = trendData.data;
    if (weeks.length < 2) return null;
    const thisWeek = weeks[weeks.length - 1];
    const lastWeek = weeks[weeks.length - 2];
    const calc = (key: string) => {
      const cur = parseFloat(thisWeek[key] || '0');
      const prev = parseFloat(lastWeek[key] || '0');
      const change = prev > 0 ? ((cur - prev) / prev * 100) : 0;
      return { cur, prev, change };
    };
    return {
      spend: calc('spend'),
      impressions: calc('impressions'),
      clicks: calc('clicks'),
      ctr: calc('ctr'),
      cpc: calc('cpc'),
      roas: { cur: parseFloat(thisWeek.roas || '0'), prev: parseFloat(lastWeek.roas || '0'), change: parseFloat(lastWeek.roas || '0') > 0 ? ((parseFloat(thisWeek.roas || '0') - parseFloat(lastWeek.roas || '0')) / parseFloat(lastWeek.roas || '0') * 100) : 0 },
      thisWeekLabel: `${thisWeek.date_start?.slice(5)} ~ ${thisWeek.date_stop?.slice(5)}`,
      lastWeekLabel: `${lastWeek.date_start?.slice(5)} ~ ${lastWeek.date_stop?.slice(5)}`,
    };
  }, [trendView, trendData]);

  const THREE_HOURS = 3 * 60 * 60 * 1000;
  const { data: aiAnalysis, isLoading: loadingAI, refetch: refetchAI, dataUpdatedAt } = useQuery({
    queryKey: ['ai-analysis', datePreset, statusFilter],
    queryFn: () => analyticsApi.getAIAnalysis(datePreset, overview, statusFilter !== 'ALL' ? statusFilter : undefined),
    enabled: overview?.connected === true && !!overview?.campaigns?.length,
    staleTime: THREE_HOURS,
    gcTime: THREE_HOURS,
  });

  const { data: deepData } = useQuery({
    queryKey: ['campaign-deep', selectedCampaignForDeep, datePreset],
    queryFn: () => analyticsApi.getCampaignDeep(selectedCampaignForDeep!, datePreset),
    enabled: !!selectedCampaignForDeep,
  });

  // Load adsets on-demand when a campaign is expanded
  const { data: adsetsData, isLoading: loadingAdsets } = useQuery({
    queryKey: ['campaign-adsets', expandedCampaign, datePreset],
    queryFn: () => analyticsApi.getCampaignAdsets(expandedCampaign!, datePreset),
    enabled: !!expandedCampaign,
  });

  const [editingBudget, setEditingBudget] = useState<{ id: string; type: string } | null>(null);
  const [budgetInput, setBudgetInput] = useState('');

  // Performance feedback query (loaded on demand per campaign, cached 3 hours)
  const { data: feedbackData, isLoading: loadingFeedback, isError: feedbackError, refetch: refetchFeedback } = useQuery({
    queryKey: ['performance-feedback', feedbackExpanded, datePreset],
    queryFn: () => analyticsApi.getPerformanceFeedback(feedbackExpanded!, datePreset),
    enabled: !!feedbackExpanded,
    retry: 1,
    staleTime: THREE_HOURS,
    gcTime: THREE_HOURS,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, type, status }: { id: string; type: string; status: string }) =>
      analyticsApi.updateStatus(id, type, status),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['account-overview'] });
      queryClient.invalidateQueries({ queryKey: ['campaign-adsets'] });
      toast.success(variables.status === 'ACTIVE' ? '활성화되었습니다.' : '일시중지되었습니다.');
      setTogglingId(null);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || '상태 변경 실패');
      setTogglingId(null);
    },
  });

  const budgetMutation = useMutation({
    mutationFn: ({ id, type, budget }: { id: string; type: string; budget: number }) =>
      analyticsApi.updateBudgetMeta(id, type, budget),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account-overview'] });
      queryClient.invalidateQueries({ queryKey: ['campaign-adsets'] });
      toast.success('예산이 변경되었습니다.');
      setEditingBudget(null);
      setBudgetInput('');
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || '예산 변경 실패'),
  });

  const toggleStatus = (id: string, type: string, currentStatus: string) => {
    if (currentStatus === 'PENDING_REVIEW' || currentStatus === 'IN_REVIEW') {
      toast.error('검토 중인 항목은 상태를 변경할 수 없습니다.');
      return;
    }
    setTogglingId(id);
    const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    statusMutation.mutate({ id, type, status: newStatus });
  };

  const startBudgetEdit = (id: string, type: string, currentBudget?: string) => {
    setEditingBudget({ id, type });
    setBudgetInput(currentBudget ? String(Math.round(parseFloat(currentBudget))) : '');
  };

  // Filter campaigns - show ALL by default, with status filter dropdown
  const allCampaigns = overview?.campaigns || [];
  const pausedCount = allCampaigns.filter((c: any) => (c.effective_status || c.status) === 'PAUSED').length;
  const campaigns = useMemo(() => {
    let filtered = allCampaigns;
    // Apply status filter
    if (statusFilter !== 'ALL') {
      const statusMap: Record<string, string[]> = {
        'ACTIVE': ['ACTIVE'],
        'PAUSED': ['PAUSED', 'CAMPAIGN_PAUSED'],
        'PENDING_REVIEW': ['PENDING_REVIEW', 'IN_REVIEW', 'WITH_ISSUES'],
        'ARCHIVED': ['ARCHIVED', 'DELETED'],
      };
      const allowed = statusMap[statusFilter] || [];
      filtered = filtered.filter((c: any) => allowed.includes(c.effective_status || c.status));
    }
    return filtered;
  }, [allCampaigns, statusFilter]);

  if (overviewError) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertTriangle size={40} className="text-red-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">데이터 로딩 실패</h2>
          <p className="text-gray-500 mb-6">Meta 광고 데이터를 가져오는데 실패했습니다.</p>
          <button onClick={() => refetchOverview()} className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700">다시 시도</button>
        </div>
      </div>
    );
  }

  if (overview && !overview.connected) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <BarChart3 size={40} className="text-blue-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">Meta 계정을 연동해주세요</h2>
          <p className="text-gray-500 mb-6">Meta 광고 관리자 계정을 연동하면 실제 캠페인 데이터를 기반으로 성과 분석, AI 추천, 광고 관리가 가능합니다.</p>
        </div>
      </div>
    );
  }

  const analysis = aiAnalysis?.analysis;
  const accountInsights = overview?.account_insights || {};
  const trendDays = trendData?.data || [];

  const formatNum = (v: any) => {
    if (!v) return '0';
    const n = parseFloat(v);
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toFixed(n < 10 ? 2 : 0);
  };

  const formatMoney = (v: any) => {
    if (!v) return formatCurrency(0);
    const n = parseFloat(v);
    return formatCurrency(n);
  };

  const formatSpend = (v: any) => {
    if (!v) return formatCurrency(0);
    const n = parseFloat(v);
    return formatCurrency(n);
  };

  const formatCPC = (v: any) => {
    if (!v) return formatCurrency(0);
    const n = parseFloat(v);
    return formatCurrency(n);
  };

  const formatROAS = (v: any) => {
    if (v === null || v === undefined) return '-';
    const n = parseFloat(v);
    if (isNaN(n)) return '-';
    return n.toFixed(2);
  };

  // Compute account-level ROAS from insights
  const accountROAS = accountInsights.roas;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">성과 분석 대시보드</h2>
          <p className="text-xs text-gray-500 mt-1">Meta 광고 관리자 실시간 데이터</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value as DatePreset)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
          >
            <option value="today">오늘</option>
            <option value="yesterday">어제</option>
            <option value="last_3d">최근 3일</option>
            <option value="last_7d">최근 7일</option>
            <option value="last_14d">최근 14일</option>
            <option value="last_30d">최근 30일</option>
            <option value="this_month">이번달</option>
            <option value="last_month">지난달</option>
            <option value="custom">직접 지정</option>
          </select>
          {datePreset === 'custom' && (
            <>
              <input type="date" value={customSince} onChange={(e) => setCustomSince(e.target.value)} max={customUntil || undefined}
                className="px-3 py-2 border border-gray-200 rounded-lg text-xs" />
              <span className="text-gray-400 text-xs">~</span>
              <input type="date" value={customUntil} onChange={(e) => setCustomUntil(e.target.value)} min={customSince || undefined}
                className="px-3 py-2 border border-gray-200 rounded-lg text-xs" />
              {customSince && customUntil && customSince > customUntil && (
                <span className="text-red-500 text-[10px]">시작일이 종료일보다 뒤입니다</span>
              )}
            </>
          )}
          <button onClick={() => { clearAnalysisCache(); refetchOverview(); refetchAI(); }} className="p-2 border border-gray-200 rounded-lg hover:bg-gray-50">
            <RefreshCw size={16} className={loadingOverview ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loadingOverview ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 size={32} className="animate-spin text-blue-600" />
          <span className="ml-3 text-gray-500">Meta 광고 데이터 로딩 중...</span>
        </div>
      ) : (
        <>
          {/* KPI Cards - ROAS 최우선 */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
            <KPICard icon={<TrendingUp size={20} />} label="ROAS" value={formatROAS(accountROAS)} sub={accountROAS ? `광고비 대비 ${(accountROAS * 100).toFixed(0)}% 수익` : '데이터 없음'} color="orange" />
            <KPICard icon={<DollarSign size={20} />} label="전환값(매출)" value={formatMoney(accountInsights.conversion_value || 0)} sub={accountInsights.conversion_value ? '구매 전환 매출' : '데이터 없음'} color="green" />
            <KPICard icon={<DollarSign size={20} />} label="총 지출" value={formatSpend(accountInsights.spend)} color="blue" />
            <KPICard icon={<MousePointer size={20} />} label="클릭" value={formatNum(accountInsights.clicks)} sub={`CTR ${parseFloat(accountInsights.ctr || '0').toFixed(2)}%`} color="green" />
            <KPICard icon={<Target size={20} />} label="CPC" value={formatCPC(accountInsights.cpc)} sub={`CPM ${formatMoney(accountInsights.cpm)}`} color="purple" />
            <KPICard icon={<Eye size={20} />} label="노출" value={formatNum(accountInsights.impressions)} sub={`도달 ${formatNum(accountInsights.reach)}`} color="blue" />
          </div>

          {/* Trend Chart with Daily/Weekly Toggle */}
          {trendDays.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                  <TrendingUp size={14} className="text-blue-500" />
                  {trendView === 'daily' ? '일별' : '주간'} 성과 추이
                </h3>
                <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
                  <button
                    onClick={() => setTrendView('daily')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                      trendView === 'daily' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >일별</button>
                  <button
                    onClick={() => setTrendView('weekly')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                      trendView === 'weekly' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >주간</button>
                </div>
              </div>

              {/* 주간 비교 카드 (이번주 vs 지난주) */}
              {trendView === 'weekly' && weeklyComparison && (
                <div className="mb-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-100">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-bold text-gray-800">이번주 vs 지난주 비교</h4>
                    <div className="flex items-center gap-3 text-[10px] text-gray-400">
                      <span>이번주: {weeklyComparison.thisWeekLabel}</span>
                      <span>지난주: {weeklyComparison.lastWeekLabel}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-2.5">
                    {([
                      { label: 'ROAS', data: weeklyComparison.roas, fmt: (v: number) => v.toFixed(2) + 'x', good: 'up' },
                      { label: '지출', data: weeklyComparison.spend, fmt: (v: number) => formatSpend(v), good: 'down' },
                      { label: '노출', data: weeklyComparison.impressions, fmt: (v: number) => formatNum(v), good: 'up' },
                      { label: '클릭', data: weeklyComparison.clicks, fmt: (v: number) => formatNum(v), good: 'up' },
                      { label: 'CTR', data: weeklyComparison.ctr, fmt: (v: number) => v.toFixed(2) + '%', good: 'up' },
                      { label: 'CPC', data: weeklyComparison.cpc, fmt: (v: number) => formatCPC(v), good: 'down' },
                    ] as const).map((m, i) => {
                      const isPositive = m.data.change > 0;
                      const isGood = (m.good === 'up' && isPositive) || (m.good === 'down' && !isPositive);
                      const changeAbs = Math.abs(m.data.change);
                      return (
                        <div key={i} className="bg-white rounded-lg p-2.5 border border-gray-100">
                          <p className="text-[10px] text-gray-400 mb-1">{m.label}</p>
                          <p className="text-sm font-bold text-gray-900">{m.fmt(m.data.cur)}</p>
                          <div className={`flex items-center gap-0.5 mt-1 ${isGood ? 'text-emerald-600' : changeAbs < 3 ? 'text-gray-400' : 'text-red-500'}`}>
                            {isPositive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                            <span className="text-[10px] font-semibold">{isPositive ? '+' : ''}{m.data.change.toFixed(1)}%</span>
                          </div>
                          <p className="text-[9px] text-gray-300 mt-0.5">전주 {m.fmt(m.data.prev)}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <p className="text-[10px] text-gray-500 mb-1">ROAS</p>
                  <MiniLineChart
                    data={trendDays.map((d: any) => ({
                      label: trendView === 'weekly' ? `${d.date_start?.slice(5)}~${d.date_stop?.slice(5)}` : d.date_stop?.slice(5) || '',
                      value: parseFloat(d.roas || 0)
                    }))}
                    color="orange"
                    formatValue={(v) => v.toFixed(2) + 'x'}
                  />
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 mb-1">지출</p>
                  <MiniLineChart
                    data={trendDays.map((d: any) => ({
                      label: trendView === 'weekly' ? `${d.date_start?.slice(5)}~${d.date_stop?.slice(5)}` : d.date_stop?.slice(5) || '',
                      value: parseFloat(d.spend || 0)
                    }))}
                    color="blue"
                    formatValue={(v) => formatSpend(v)}
                  />
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 mb-1">CTR (%)</p>
                  <MiniLineChart
                    data={trendDays.map((d: any) => ({
                      label: trendView === 'weekly' ? `${d.date_start?.slice(5)}~${d.date_stop?.slice(5)}` : d.date_stop?.slice(5) || '',
                      value: parseFloat(d.ctr || 0)
                    }))}
                    color="green"
                    formatValue={(v) => `${v.toFixed(2)}%`}
                  />
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 mb-1">CPC</p>
                  <MiniLineChart
                    data={trendDays.map((d: any) => ({
                      label: trendView === 'weekly' ? `${d.date_start?.slice(5)}~${d.date_stop?.slice(5)}` : d.date_stop?.slice(5) || '',
                      value: parseFloat(d.cpc || 0)
                    }))}
                    color="purple"
                    formatValue={(v) => formatCPC(v)}
                  />
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 mb-1">전환값 (매출)</p>
                  <MiniLineChart
                    data={trendDays.map((d: any) => ({
                      label: trendView === 'weekly' ? `${d.date_start?.slice(5)}~${d.date_stop?.slice(5)}` : d.date_stop?.slice(5) || '',
                      value: parseFloat(d.conversion_value || 0)
                    }))}
                    color="green"
                    formatValue={(v) => formatMoney(v)}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Conversion Actions */}
          {accountInsights.actions && accountInsights.actions.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">전환 액션 요약</h3>
              <div className="flex flex-wrap gap-3">
                {accountInsights.actions.slice(0, 10).map((action: any, i: number) => (
                  <div key={i} className="bg-gray-50 rounded-lg px-3 py-2 text-sm">
                    <span className="text-gray-500">{translateActionType(action.action_type)}</span>
                    <span className="ml-2 font-semibold text-gray-900">{formatNum(action.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI 성과 분석 리포트 */}
          {loadingAI ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-lg overflow-hidden">
              <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600 px-6 py-5">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center animate-pulse">
                    <Sparkles size={22} className="text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white">AI 성과 분석 리포트</h2>
                    <p className="text-sm text-white/70 mt-0.5">데이터를 분석하고 있습니다...</p>
                  </div>
                </div>
              </div>
              <div className="p-6 space-y-4">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="animate-pulse">
                    <div className="h-4 bg-gray-200 rounded-lg w-1/4 mb-3" />
                    <div className="h-24 bg-gray-100 rounded-xl" />
                  </div>
                ))}
              </div>
            </div>
          ) : analysis && analysis.parse_error ? (
            <div className="bg-white rounded-2xl border border-yellow-200 shadow-lg overflow-hidden">
              <div className="bg-gradient-to-r from-yellow-500 to-amber-500 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={20} className="text-white" />
                  <h2 className="text-base font-bold text-white">AI 분석 결과 (텍스트)</h2>
                </div>
                <button onClick={() => { clearAnalysisCache(datePreset); refetchAI(); }} className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white text-sm font-medium px-4 py-2 rounded-xl transition-all">
                  <RefreshCw size={14} /> 재분석
                </button>
              </div>
              <div className="p-6">
                <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed max-h-[500px] overflow-y-auto bg-gray-50 rounded-xl p-4 border border-gray-100">{analysis.raw_text}</div>
              </div>
            </div>
          ) : !analysis && aiAnalysis?.error ? (
            <div className="bg-white rounded-2xl border border-red-200 shadow-lg overflow-hidden">
              <div className="bg-gradient-to-r from-red-500 to-rose-500 px-6 py-4">
                <div className="flex items-center gap-2">
                  <XCircle size={20} className="text-white" />
                  <h2 className="text-base font-bold text-white">AI 분석 오류</h2>
                </div>
              </div>
              <div className="p-6 text-center">
                <p className="text-sm text-gray-600 mb-4">{aiAnalysis.error}</p>
                <button onClick={() => { clearAnalysisCache(datePreset); refetchAI(); }} className="bg-red-600 text-white px-5 py-2 rounded-xl hover:bg-red-700 transition-colors font-medium text-sm">
                  <RefreshCw size={14} className="inline mr-1.5" />다시 시도
                </button>
              </div>
            </div>
          ) : analysis && !analysis.parse_error ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-lg overflow-hidden">
              {/* Gradient Header */}
              <div className="relative bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600 px-6 py-5">
                <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 20%, white 1px, transparent 1px)', backgroundSize: '60px 60px' }} />
                <div className="relative flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center ring-2 ring-white/30">
                      <Sparkles size={22} className="text-white" />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-white tracking-tight">AI 성과 분석 리포트</h2>
                      <p className="text-sm text-white/70 mt-0.5">
                        {datePreset === 'today' ? '오늘' : datePreset === 'yesterday' ? '어제' : datePreset === 'last_3d' ? '최근 3일' : datePreset === 'last_7d' ? '최근 7일' : datePreset === 'last_14d' ? '최근 14일' : datePreset === 'last_30d' ? '최근 30일' : datePreset === 'this_month' ? '이번달' : datePreset === 'last_month' ? '지난달' : '사용자 지정'} 기간 분석
                        {statusFilter !== 'ALL' ? ` · ${statusFilter === 'ACTIVE' ? '활성' : statusFilter === 'PAUSED' ? '일시중지' : statusFilter === 'PENDING_REVIEW' ? '검토중' : '보관됨'} 캠페인만` : ''}
                        {dataUpdatedAt ? ` · ${new Date(dataUpdatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 기준` : ''}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => { clearAnalysisCache(datePreset); refetchAI(); }}
                    className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white text-sm font-medium px-4 py-2 rounded-xl transition-all"
                  >
                    <RefreshCw size={14} /> 재분석
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {/* ① 계정 건강도 */}
                <div className={`rounded-xl p-5 ${
                  analysis.account_health === 'good'
                    ? 'bg-gradient-to-r from-emerald-50 to-green-50 border border-emerald-200'
                    : analysis.account_health === 'warning'
                      ? 'bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-200'
                      : 'bg-gradient-to-r from-red-50 to-rose-50 border border-red-200'
                }`}>
                  <div className="flex items-start gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 shadow-md ${
                      analysis.account_health === 'good' ? 'bg-emerald-500' :
                      analysis.account_health === 'warning' ? 'bg-amber-500' : 'bg-red-500'
                    }`}>
                      <Shield size={24} className="text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <h3 className="text-base font-bold text-gray-900">계정 건강도</h3>
                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                          analysis.account_health === 'good' ? 'bg-emerald-100 text-emerald-700' :
                          analysis.account_health === 'warning' ? 'bg-amber-100 text-amber-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {analysis.account_health === 'good' ? '양호' : analysis.account_health === 'warning' ? '주의' : '위험'}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 leading-relaxed">{analysis.health_summary}</p>
                    </div>
                  </div>
                </div>

                {/* ② 실행 액션 아이템 (5-8건) */}
                {analysis.action_items?.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center">
                        <Zap size={16} className="text-orange-600" />
                      </div>
                      <h3 className="text-base font-bold text-gray-900">긴급 액션 아이템</h3>
                      <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-medium">{analysis.action_items.length}건</span>
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                      {analysis.action_items.map((item: any, i: number) => {
                        const typeLabel: Record<string, string> = { pause_ad: '광고 중지', increase_budget: '예산 증액', decrease_budget: '예산 감액', change_creative: '소재 변경', optimize_target: '타겟 최적화' };
                        const typeIcon: Record<string, string> = { pause_ad: 'text-red-500', increase_budget: 'text-emerald-500', decrease_budget: 'text-amber-500', change_creative: 'text-purple-500', optimize_target: 'text-blue-500' };
                        return (
                          <div
                            key={i}
                            className={`rounded-xl border-l-4 bg-white border border-gray-100 shadow-sm hover:shadow-md transition-all duration-200 p-4 ${
                              item.priority === 'high' ? 'border-l-red-500' :
                              item.priority === 'medium' ? 'border-l-amber-500' : 'border-l-blue-400'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                                    item.priority === 'high' ? 'bg-red-100 text-red-700' :
                                    item.priority === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                                  }`}>
                                    {item.priority === 'high' ? '긴급' : item.priority === 'medium' ? '중간' : '낮음'}
                                  </span>
                                  {item.type && (
                                    <span className={`text-[11px] font-medium bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-md ${typeIcon[item.type] || 'text-gray-500'}`}>
                                      {typeLabel[item.type] || item.type}
                                    </span>
                                  )}
                                  {item.target_name && <span className="text-xs text-gray-400 truncate max-w-[200px]">{item.target_name}</span>}
                                </div>
                                <p className="text-sm font-semibold text-gray-900 mb-1">{item.action}</p>
                                <p className="text-xs text-gray-500 leading-relaxed">{item.reason}</p>
                                {item.expected_impact && (
                                  <div className="mt-2.5 inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-lg">
                                    <TrendingUp size={12} className="text-emerald-500" />
                                    <span className="text-xs font-medium text-emerald-700">{item.expected_impact}</span>
                                  </div>
                                )}
                              </div>
                              {item.target_id && item.type === 'pause_ad' && (
                                <button
                                  onClick={() => toggleStatus(item.target_id, 'ad', 'ACTIVE')}
                                  className="flex-shrink-0 text-xs bg-red-600 text-white px-3.5 py-2 rounded-xl hover:bg-red-700 transition-colors font-medium shadow-sm"
                                >
                                  중지 실행
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ③ 소재 피로도 분석 (5-8건) - Full Width */}
                {analysis.creative_fatigue?.length > 0 && (
                  <div className="bg-gradient-to-br from-purple-50/50 to-pink-50/30 rounded-xl p-5 border border-purple-100">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                        <Palette size={16} className="text-purple-600" />
                      </div>
                      <h3 className="text-base font-bold text-gray-900">소재 피로도 분석</h3>
                      <span className="text-xs bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full font-medium">{analysis.creative_fatigue.length}건</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {analysis.creative_fatigue.map((item: any, i: number) => {
                        const st = (item.status || item.recommendation || '유지').toString();
                        const isReplace = st.includes('교체');
                        const isModify = st.includes('수정');
                        const statusLabel = isReplace ? '교체' : isModify ? '수정' : '유지';
                        const freq = parseFloat(item.frequency || '0');
                        return (
                          <div key={i} className="bg-white rounded-xl p-4 border border-gray-100 hover:border-purple-200 hover:shadow-md transition-all">
                            <div className="flex items-center justify-between mb-3">
                              <p className="text-sm font-bold text-gray-900 truncate flex-1 mr-2">{item.ad_name}</p>
                              <span className={`text-[11px] font-bold px-3 py-1 rounded-full flex-shrink-0 ${
                                isReplace ? 'bg-red-100 text-red-700 ring-1 ring-red-200' :
                                isModify ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-200' : 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200'
                              }`}>
                                {statusLabel}
                              </span>
                            </div>
                            <div className="mb-2.5">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[11px] text-gray-400">노출 빈도</span>
                                <span className={`text-sm font-black ${isReplace ? 'text-red-600' : isModify ? 'text-amber-600' : 'text-emerald-600'}`}>{freq.toFixed(1)}x</span>
                              </div>
                              <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${
                                    isReplace ? 'bg-gradient-to-r from-red-400 to-red-500' :
                                    isModify ? 'bg-gradient-to-r from-amber-400 to-amber-500' : 'bg-gradient-to-r from-emerald-400 to-emerald-500'
                                  }`}
                                  style={{ width: `${Math.min(freq / 4 * 100, 100)}%` }}
                                />
                              </div>
                              <div className="flex justify-between mt-0.5">
                                <span className="text-[10px] text-gray-300">0</span>
                                <span className="text-[10px] text-gray-300">4+</span>
                              </div>
                            </div>
                            {(item.detail || (st.length > 3 ? st : null)) && (
                              <p className="text-xs text-gray-500 leading-relaxed">{item.detail || st}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ④ 예산 최적화 추천 (5-8건) - Full Width */}
                {analysis.budget_recommendations?.length > 0 && (
                  <div className="bg-gradient-to-br from-emerald-50/50 to-cyan-50/30 rounded-xl p-5 border border-emerald-100">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
                        <DollarSign size={16} className="text-emerald-600" />
                      </div>
                      <h3 className="text-base font-bold text-gray-900">예산 최적화 추천</h3>
                      <span className="text-xs bg-emerald-100 text-emerald-600 px-2 py-0.5 rounded-full font-medium">{analysis.budget_recommendations.length}건</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {analysis.budget_recommendations.map((item: any, i: number) => {
                        const changeStr = (item.change || '').toString();
                        const isUp = changeStr.includes('+');
                        const isDown = changeStr.includes('-');
                        return (
                          <div key={i} className="bg-white rounded-xl p-4 border border-gray-100 hover:border-emerald-200 hover:shadow-md transition-all">
                            <div className="flex items-center justify-between mb-3">
                              <p className="text-sm font-bold text-gray-900 truncate flex-1 mr-2">{item.campaign_name}</p>
                              {changeStr && (
                                <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full flex-shrink-0 ${
                                  isUp ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200' :
                                  isDown ? 'bg-red-100 text-red-700 ring-1 ring-red-200' : 'bg-gray-100 text-gray-600 ring-1 ring-gray-200'
                                }`}>
                                  {isUp ? '↑' : isDown ? '↓' : '→'} {changeStr}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mb-3 bg-gray-50 rounded-lg p-3">
                              <div className="flex-1 text-center">
                                <p className="text-[10px] text-gray-400 mb-0.5">현재</p>
                                <p className="text-sm font-bold text-gray-500">{item.current_budget}</p>
                              </div>
                              <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center" style={{ background: isUp ? '#d1fae5' : isDown ? '#fee2e2' : '#f3f4f6' }}>
                                <ArrowRight size={14} className={isUp ? 'text-emerald-600' : isDown ? 'text-red-500' : 'text-gray-400'} />
                              </div>
                              <div className="flex-1 text-center">
                                <p className={`text-[10px] mb-0.5 ${isUp ? 'text-emerald-500' : isDown ? 'text-red-500' : 'text-blue-500'}`}>추천</p>
                                <p className={`text-sm font-bold ${isUp ? 'text-emerald-600' : isDown ? 'text-red-600' : 'text-blue-600'}`}>{item.recommended_budget}</p>
                              </div>
                            </div>
                            <p className="text-xs text-gray-500 leading-relaxed">{item.reason}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ⑤ 핵심 캠페인 피드백 (5-8건) */}
                {analysis.campaign_feedback?.length > 0 && (
                  <div className="bg-gradient-to-br from-indigo-50/50 to-blue-50/30 rounded-xl p-5 border border-indigo-100">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
                        <Target size={16} className="text-indigo-600" />
                      </div>
                      <h3 className="text-base font-bold text-gray-900">캠페인별 성과 피드백</h3>
                      <span className="text-xs bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full font-medium">{analysis.campaign_feedback.length}건</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {analysis.campaign_feedback.map((item: any, i: number) => {
                        const gradeConfig: Record<string, { bg: string; text: string; ring: string; label: string }> = {
                          A: { bg: 'bg-emerald-100', text: 'text-emerald-700', ring: 'ring-emerald-300', label: 'A 최우수' },
                          B: { bg: 'bg-blue-100', text: 'text-blue-700', ring: 'ring-blue-300', label: 'B 우수' },
                          C: { bg: 'bg-amber-100', text: 'text-amber-700', ring: 'ring-amber-300', label: 'C 보통' },
                          D: { bg: 'bg-orange-100', text: 'text-orange-700', ring: 'ring-orange-300', label: 'D 미흡' },
                          F: { bg: 'bg-red-100', text: 'text-red-700', ring: 'ring-red-300', label: 'F 부진' },
                        };
                        const gc = gradeConfig[item.grade] || gradeConfig.C;
                        return (
                          <div key={i} className="bg-white rounded-xl p-4 border border-gray-100 hover:border-indigo-200 hover:shadow-md transition-all">
                            <div className="flex items-start justify-between gap-2 mb-2.5">
                              <p className="text-sm font-bold text-gray-900 truncate flex-1">{item.campaign_name}</p>
                              <span className={`text-[11px] font-bold px-2.5 py-1 rounded-lg flex-shrink-0 ring-1 ${gc.bg} ${gc.text} ${gc.ring}`}>
                                {gc.label}
                              </span>
                            </div>
                            <p className="text-xs text-gray-600 leading-relaxed mb-2.5">{item.summary}</p>
                            {item.kpi_highlight && (
                              <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
                                <p className="text-[11px] font-medium text-indigo-700">{item.kpi_highlight}</p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ⑥ 우선 실행 사항 */}
                {analysis.next_steps?.length > 0 && (
                  <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-5 border border-blue-100">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                        <Lightbulb size={16} className="text-blue-600" />
                      </div>
                      <h3 className="text-base font-bold text-gray-900">우선 실행 사항</h3>
                    </div>
                    <div className="space-y-3">
                      {analysis.next_steps.map((step: string, i: number) => (
                        <div key={i} className="flex items-start gap-3">
                          <div className="w-7 h-7 bg-gradient-to-br from-blue-600 to-indigo-600 text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5 shadow-sm">
                            {i + 1}
                          </div>
                          <div className="flex-1 bg-white/80 backdrop-blur-sm rounded-lg px-4 py-3 border border-blue-100 shadow-sm">
                            <p className="text-sm text-gray-800 leading-relaxed">{step}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {/* Campaign List */}
          <div className="bg-white border border-gray-200 rounded-xl">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Layers size={18} /> 캠페인 목록 ({campaigns.length}개 / 전체 {allCampaigns.length}개)
              </h3>
              <div className="flex items-center gap-2">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as CampaignStatusFilter)}
                  className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs"
                >
                  <option value="ALL">전체</option>
                  <option value="ACTIVE">활성</option>
                  <option value="PAUSED">일시중지</option>
                  <option value="PENDING_REVIEW">검토중</option>
                  <option value="ARCHIVED">보관됨</option>
                </select>
                <button
                  onClick={() => { refetchOverview(); toast.success('새로고침 중...'); }}
                  className="p-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-500"
                  title="Meta에서 다시 가져오기"
                >
                  <RefreshCw size={14} className={loadingOverview ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
            <div className="divide-y divide-gray-100 min-w-[900px]">
              {campaigns.map((camp: any) => {
                const isExpanded = expandedCampaign === camp.id;
                const ins = camp.insights;
                const es = camp.effective_status || camp.status;
                const statusKo = es === 'ACTIVE' ? '활성' : es === 'PAUSED' ? '일시중지' : es === 'CAMPAIGN_PAUSED' ? '캠페인 중지' : es === 'PENDING_REVIEW' || es === 'IN_REVIEW' ? '검토중' : es === 'ARCHIVED' ? '보관됨' : es;
                const statusColor = es === 'ACTIVE' ? 'bg-green-100 text-green-700' : es === 'PAUSED' || es === 'CAMPAIGN_PAUSED' ? 'bg-yellow-100 text-yellow-700' : es === 'PENDING_REVIEW' || es === 'IN_REVIEW' ? 'bg-blue-100 text-blue-700' : es === 'ARCHIVED' ? 'bg-gray-200 text-gray-600' : 'bg-gray-100 text-gray-600';

                // Extract additional metrics
                const campBudget = camp.daily_budget ? formatCurrency(parseFloat(camp.daily_budget)) + '/일' : camp.lifetime_budget ? formatCurrency(parseFloat(camp.lifetime_budget)) : camp.budget ? formatCurrency(parseFloat(camp.budget)) : '-';
                const campCPM = ins?.cpm ? formatCurrency(parseFloat(ins.cpm)) : '-';
                const campFrequency = ins?.frequency ? parseFloat(ins.frequency).toFixed(2) : '-';
                // Use enriched fields from backend (already converted to KRW)
                const purchaseValue = ins?.website_purchase_conversion_value || ins?.action_values?.find((a: any) => a.action_type === 'purchase' || a.action_type === 'omni_purchase')?.value;
                const contentViews = ins?.website_content_views || ins?.actions?.find((a: any) => a.action_type === 'view_content' || a.action_type === 'landing_page_view')?.value;
                const costPerResult = ins?.cost_per_result || ins?.cost_per_action_type?.[0]?.value;

                return (
                  <div key={camp.id}>
                    <div className="px-5 py-4 hover:bg-gray-50 cursor-pointer flex items-center gap-3"
                      onClick={() => setExpandedCampaign(isExpanded ? null : camp.id)}>
                      {isExpanded ? <ChevronDown size={16} className="flex-shrink-0" /> : <ChevronRight size={16} className="flex-shrink-0" />}
                      <div className="flex-1 min-w-0" style={{ maxWidth: '220px' }}>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-semibold text-gray-900 truncate">{camp.name}</h4>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 font-medium ${statusColor}`}>{statusKo}</span>
                        </div>
                        <p className="text-[10px] text-gray-400 mt-0.5 truncate">{camp.objective}</p>
                      </div>
                      {ins && (
                        <div className="flex items-center gap-3 text-xs flex-shrink-0">
                          <div className="text-right w-[70px]"><p className="text-[10px] text-gray-400">예산</p><p className="font-semibold text-[11px]">{campBudget}</p></div>
                          <div className="text-right w-[65px]"><p className="text-[10px] text-gray-400">지출</p><p className="font-semibold text-[11px]">{formatSpend(ins.spend)}</p></div>
                          <div className="text-right w-[50px]"><p className="text-[10px] text-gray-400">노출</p><p className="font-semibold text-[11px]">{formatNum(ins.impressions)}</p></div>
                          <div className="text-right w-[45px]"><p className="text-[10px] text-gray-400">클릭</p><p className="font-semibold text-[11px]">{formatNum(ins.clicks)}</p></div>
                          <div className="text-right w-[45px]"><p className="text-[10px] text-gray-400">CTR</p><p className="font-semibold text-[11px]">{parseFloat(ins.ctr || '0').toFixed(2)}%</p></div>
                          <div className="text-right w-[55px]"><p className="text-[10px] text-gray-400">CPC</p><p className="font-semibold text-[11px]">{formatCPC(ins.cpc)}</p></div>
                          <div className="text-right w-[55px]"><p className="text-[10px] text-gray-400">CPM</p><p className="font-semibold text-[11px]">{campCPM}</p></div>
                          <div className="text-right w-[45px]"><p className="text-[10px] text-gray-400">ROAS</p><p className={`font-semibold text-[11px] ${ins.roas && ins.roas >= 1 ? 'text-green-600' : ins.roas ? 'text-red-600' : 'text-gray-400'}`}>{formatROAS(ins.roas)}</p></div>
                          <div className="text-right w-[70px]"><p className="text-[10px] text-gray-400">구매전환값</p><p className="font-semibold text-[11px]">{purchaseValue ? formatCurrency(parseFloat(purchaseValue)) : '-'}</p></div>
                          <div className="text-right w-[50px]"><p className="text-[10px] text-gray-400">조회수</p><p className="font-semibold text-[11px]">{contentViews ? formatNum(contentViews) : '-'}</p></div>
                          <div className="text-right w-[60px]"><p className="text-[10px] text-gray-400">결과당비용</p><p className="font-semibold text-[11px]">{costPerResult ? formatCurrency(parseFloat(costPerResult)) : '-'}</p></div>
                          <div className="text-right w-[40px]"><p className="text-[10px] text-gray-400">빈도</p><p className={`font-semibold text-[11px] ${parseFloat(campFrequency) > 2.3 ? 'text-red-600' : ''}`}>{campFrequency}</p></div>
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {editingBudget?.id === camp.id ? (
                          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <span className="text-[10px] text-gray-400">일예산 ₩</span>
                            <input type="number" value={budgetInput} onChange={(e) => setBudgetInput(e.target.value)} autoFocus
                              className="w-20 px-1.5 py-1 border rounded text-xs" placeholder="원" />
                            <button onClick={() => budgetInput && budgetMutation.mutate({ id: camp.id, type: 'campaign', budget: Number(budgetInput) })}
                              className="text-green-600 hover:text-green-800"><Check size={14} /></button>
                            <button onClick={() => setEditingBudget(null)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
                          </div>
                        ) : (
                          <button onClick={(e) => { e.stopPropagation(); startBudgetEdit(camp.id, 'campaign', camp.daily_budget); }}
                            className="p-2 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100" title="예산 변경">
                            <Edit3 size={14} />
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleStatus(camp.id, 'campaign', es); }}
                          disabled={togglingId === camp.id || es === 'PENDING_REVIEW' || es === 'IN_REVIEW'}
                          className={`p-2 rounded-lg transition-colors ${
                            togglingId === camp.id ? 'bg-gray-100 text-gray-400 cursor-wait' :
                            es === 'PENDING_REVIEW' || es === 'IN_REVIEW' ? 'bg-gray-100 text-gray-400 cursor-not-allowed' :
                            es === 'ACTIVE' ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' : 'bg-green-100 text-green-700 hover:bg-green-200'
                          }`}
                          title={es === 'PENDING_REVIEW' || es === 'IN_REVIEW' ? '검토 중에는 변경 불가' : es === 'ACTIVE' ? '일시중지' : '활성화'}>
                          {togglingId === camp.id ? <Loader2 size={14} className="animate-spin" /> : es === 'ACTIVE' ? <Pause size={14} /> : <Play size={14} />}
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="bg-gray-50 px-5 py-4 border-t border-gray-100">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-semibold text-gray-500 uppercase">광고세트 & 광고</span>
                          <div className="flex items-center gap-2">
                            <button onClick={() => setFeedbackExpanded(feedbackExpanded === camp.id ? null : camp.id)}
                              className="text-xs bg-purple-600 text-white px-3 py-1 rounded-lg hover:bg-purple-700 flex items-center gap-1">
                              <Activity size={12} />
                              {feedbackExpanded === camp.id ? '성과 피드백 닫기' : '성과 피드백'}
                            </button>
                            <button onClick={() => setSelectedCampaignForDeep(selectedCampaignForDeep === camp.id ? null : camp.id)}
                              className="text-xs bg-blue-600 text-white px-3 py-1 rounded-lg hover:bg-blue-700">
                              {selectedCampaignForDeep === camp.id ? '심층분석 닫기' : '심층 분석'}
                            </button>
                          </div>
                        </div>

                        {/* Budget utilization progress bar */}
                        {ins?.spend && (camp.daily_budget || camp.lifetime_budget) && (() => {
                          const budget = camp.daily_budget ? parseFloat(camp.daily_budget) : camp.lifetime_budget ? parseFloat(camp.lifetime_budget) : parseFloat(camp.budget || '0');
                          const spent = parseFloat(ins.spend);
                          const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
                          return (
                            <div className="mb-3">
                              <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
                                <span>예산 소진율</span>
                                <span>{pct.toFixed(1)}% ({formatCurrency(spent)} / {formatCurrency(budget)})</span>
                              </div>
                              <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all ${pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })()}

                        {loadingAdsets && expandedCampaign === camp.id ? (
                          <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
                            <Loader2 size={14} className="animate-spin" /> 광고세트 로딩 중...
                          </div>
                        ) : adsetsData?.error && expandedCampaign === camp.id ? (
                          <div className="py-4 text-center">
                            <p className="text-sm text-red-500 mb-2">광고세트를 불러오지 못했습니다.</p>
                            <p className="text-xs text-gray-400 mb-3">{typeof adsetsData.error === 'string' ? adsetsData.error : 'API 오류'}</p>
                            <button onClick={() => queryClient.invalidateQueries({ queryKey: ['campaign-adsets', camp.id] })}
                              className="text-xs bg-red-600 text-white px-3 py-1.5 rounded-lg hover:bg-red-700 inline-flex items-center gap-1">
                              <RefreshCw size={12} /> 다시 시도
                            </button>
                          </div>
                        ) : (adsetsData?.adsets || []).length > 0 && expandedCampaign === camp.id ? (
                          <div className="space-y-3">
                            {(adsetsData.adsets as any[]).map((adset: any) => {
                              const adsetStatus = adset.effective_status || adset.status;
                              const adsetStatusKo = adsetStatus === 'ACTIVE' ? '활성' : adsetStatus === 'PAUSED' ? '중지' : adsetStatus === 'PENDING_REVIEW' ? '검토중' : adsetStatus;
                              const adsetStatusColor = adsetStatus === 'ACTIVE' ? 'bg-green-100 text-green-700' : adsetStatus === 'PENDING_REVIEW' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600';
                              return (
                                <div key={adset.id} className="bg-white rounded-lg border border-gray-200 p-3">
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                      <Users size={14} className="text-purple-500" />
                                      <span className="text-sm font-medium">{adset.name}</span>
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${adsetStatusColor}`}>{adsetStatusKo}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {editingBudget?.id === adset.id ? (
                                        <div className="flex items-center gap-1">
                                          <span className="text-xs text-gray-400">일예산 ₩</span>
                                          <input type="number" value={budgetInput} onChange={(e) => setBudgetInput(e.target.value)} autoFocus
                                            className="w-20 px-1.5 py-0.5 border rounded text-xs" placeholder="원" />
                                          <button onClick={() => budgetInput && budgetMutation.mutate({ id: adset.id, type: 'adset', budget: Number(budgetInput) })}
                                            className="text-green-600 hover:text-green-800"><Check size={13} /></button>
                                          <button onClick={() => setEditingBudget(null)} className="text-gray-400 hover:text-gray-600"><X size={13} /></button>
                                        </div>
                                      ) : (
                                        <>
                                          {adset.daily_budget && <span className="text-xs text-gray-400">일예산: {formatCurrency(Number(adset.daily_budget))}</span>}
                                          <button onClick={(e) => { e.stopPropagation(); startBudgetEdit(adset.id, 'adset', adset.daily_budget); }}
                                            className="text-gray-400 hover:text-blue-600" title="예산 변경"><Edit3 size={12} /></button>
                                        </>
                                      )}
                                      <button
                                        onClick={() => toggleStatus(adset.id, 'adset', adsetStatus)}
                                        disabled={togglingId === adset.id}
                                        className={`text-xs px-2 py-1 rounded border hover:bg-gray-50 ${togglingId === adset.id ? 'opacity-50 cursor-wait' : ''}`}>
                                        {togglingId === adset.id ? <Loader2 size={12} className="animate-spin inline" /> : adsetStatus === 'ACTIVE' ? '중지' : '활성화'}
                                      </button>
                                    </div>
                                  </div>
                                  {adset.targeting && (
                                    <div className="text-xs text-gray-500 mb-2">
                                      타겟: {adset.targeting.age_min || '?'}-{adset.targeting.age_max || '?'}세
                                      {adset.targeting.genders && `, ${adset.targeting.genders.map((g: number) => g === 1 ? '남' : g === 2 ? '여' : '전체').join('/')}`}
                                      {adset.targeting.flexible_spec?.[0]?.interests &&
                                        ` | 관심사: ${adset.targeting.flexible_spec[0].interests.slice(0, 3).map((i: any) => i.name).join(', ')}`}
                                    </div>
                                  )}
                                  {adset.insights && (
                                    <div className="flex flex-wrap gap-3 text-xs text-gray-600 mb-2">
                                      <span>지출: {formatSpend(adset.insights.spend)}</span>
                                      <span>클릭: {adset.insights.clicks}</span>
                                      <span>CTR: {parseFloat(adset.insights.ctr || '0').toFixed(2)}%</span>
                                      <span>CPC: {formatCPC(adset.insights.cpc)}</span>
                                      <span>CPM: {formatCurrency(parseFloat(adset.insights.cpm || '0'))}</span>
                                      <span className={adset.insights.roas && adset.insights.roas >= 1 ? 'text-green-600 font-medium' : adset.insights.roas ? 'text-red-600 font-medium' : ''}>ROAS: {formatROAS(adset.insights.roas)}</span>
                                    </div>
                                  )}
                                  {adset.ads?.length > 0 && (
                                    <div className="mt-2 space-y-1">
                                      {adset.ads.map((ad: any) => {
                                        const adStatus = ad.effective_status || ad.status;
                                        const adStatusKo = adStatus === 'ACTIVE' ? '활성' : adStatus === 'PAUSED' ? '중지' : adStatus;
                                        const adStatusDot = adStatus === 'ACTIVE' ? 'bg-green-500' : adStatus === 'PAUSED' ? 'bg-yellow-500' : 'bg-gray-400';
                                        return (
                                          <div key={ad.id} className="flex items-center justify-between bg-gray-50 rounded p-2">
                                            <div className="flex items-center gap-2">
                                              <div className={`w-1.5 h-1.5 rounded-full ${adStatusDot}`} />
                                              <span className="text-xs text-gray-700">{ad.name}</span>
                                              <span className={`text-[10px] px-1 py-0.5 rounded ${adStatus === 'ACTIVE' ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400'}`}>{adStatusKo}</span>
                                            </div>
                                            <div className="flex items-center gap-3">
                                              {ad.insights && <span className="text-xs text-gray-500">{formatSpend(ad.insights.spend)} | CPC {formatCPC(ad.insights.cpc)} | CTR {parseFloat(ad.insights.ctr || '0').toFixed(2)}% | <span className={ad.insights.roas && ad.insights.roas >= 1 ? 'text-green-600' : ad.insights.roas ? 'text-red-600' : ''}>ROAS {formatROAS(ad.insights.roas)}</span></span>}
                                              <button
                                                onClick={() => toggleStatus(ad.id, 'ad', adStatus)}
                                                disabled={togglingId === ad.id}
                                                className={`text-xs px-2 py-0.5 rounded border hover:bg-white ${togglingId === ad.id ? 'opacity-50 cursor-wait' : ''}`}>
                                                {togglingId === ad.id ? <Loader2 size={10} className="animate-spin inline" /> : adStatus === 'ACTIVE' ? '중지' : '켜기'}
                                              </button>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : expandedCampaign === camp.id ? <p className="text-sm text-gray-400">광고세트가 없습니다.</p> : null}

                        {/* Performance Feedback Panel */}
                        {feedbackExpanded === camp.id && (
                          <PerformanceFeedbackPanel
                            campaignId={camp.id}
                            data={feedbackData}
                            isLoading={loadingFeedback}
                            isError={feedbackError}
                            onRetry={() => { clearAnalysisCache(); refetchFeedback(); }}
                            formatCurrency={formatCurrency}
                          />
                        )}

                        {selectedCampaignForDeep === camp.id && deepData && (
                          <div className="mt-4 bg-white rounded-lg border border-blue-200 p-4">
                            <h4 className="text-sm font-semibold text-blue-900 mb-3">심층 분석</h4>
                            {deepData.demographics?.length > 0 && (
                              <div className="mb-3">
                                <p className="text-xs font-semibold text-gray-600 mb-2">연령/성별 분포</p>
                                <div className="grid grid-cols-3 gap-1">
                                  {deepData.demographics.slice(0, 12).map((d: any, i: number) => (
                                    <div key={i} className="bg-blue-50 rounded p-1.5 text-xs">
                                      <span className="font-medium">{d.age} {d.gender === 'male' ? '남' : d.gender === 'female' ? '여' : ''}</span>
                                      <span className="ml-1 text-gray-500">CTR {parseFloat(d.ctr || '0').toFixed(2)}%</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {deepData.placements?.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-gray-600 mb-2">게재 위치별 성과</p>
                                <div className="space-y-1">
                                  {deepData.placements.slice(0, 6).map((p: any, i: number) => (
                                    <div key={i} className="flex justify-between text-xs bg-gray-50 rounded p-1.5">
                                      <span>{p.publisher_platform} - {p.platform_position}</span>
                                      <span>{formatSpend(p.spend)} | CTR {parseFloat(p.ctr || '0').toFixed(2)}%</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {campaigns.length === 0 && (
                <div className="px-5 py-8 text-center">
                  <p className="text-gray-400">{statusFilter !== 'ALL' ? `${statusFilter === 'ACTIVE' ? '활성' : statusFilter === 'PAUSED' ? '일시중지' : statusFilter === 'PENDING_REVIEW' ? '검토중' : '보관됨'} 캠페인이 없습니다.` : '캠페인이 없습니다.'}</p>
                  {overview?.campaigns_error && (
                    <p className="text-xs text-red-400 mt-2">Meta API 오류: {typeof overview.campaigns_error === 'string' ? overview.campaigns_error.slice(0, 100) : 'API 연결 실패'}</p>
                  )}
                </div>
              )}
            </div>
            </div>
          </div>

          {/* ═══ 크리에이티브 성과 대시보드 ═══ */}
          <CreativePerformanceDashboard
            campaigns={allCampaigns}
            datePreset={datePreset}
            formatCurrency={formatCurrency}
            formatNum={formatNum}
            formatCPC={formatCPC}
            formatROAS={formatROAS}
            formatSpend={formatSpend}
          />
        </>
      )}
    </div>
  );
}

function KPICard({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string; sub?: string; color: string }) {
  const colors: Record<string, string> = { blue: 'bg-blue-50 text-blue-600', purple: 'bg-purple-50 text-purple-600', green: 'bg-green-50 text-green-600', orange: 'bg-orange-50 text-orange-600' };
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3">
      <div className="flex items-center gap-1.5 mb-1"><div className={`p-1 rounded-lg ${colors[color]}`}>{icon}</div><span className="text-xs text-gray-500">{label}</span></div>
      <p className="text-lg font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

function MiniLineChart({ data, color, formatValue }: {
  data: { label: string; value: number }[];
  color: string;
  formatValue: (v: number) => string;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (data.length === 0) return null;

  const width = 600;
  const height = 120;
  const paddingTop = 20;
  const paddingBottom = 16;
  const paddingLeft = 44;
  const paddingRight = 10;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const maxVal = Math.max(...data.map(d => d.value), 0.01);
  const minVal = Math.min(...data.map(d => d.value), 0);
  const range = maxVal - minVal || 1;

  const points = data.map((d, i) => ({
    x: paddingLeft + (data.length > 1 ? (i / (data.length - 1)) * chartWidth : chartWidth / 2),
    y: paddingTop + chartHeight - ((d.value - minVal) / range) * chartHeight,
    value: d.value,
    label: d.label,
  }));

  let pathD = '';
  if (points.length === 1) {
    pathD = `M ${points[0].x} ${points[0].y}`;
  } else {
    pathD = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(i - 1, 0)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(i + 2, points.length - 1)];
      const tension = 0.3;
      const cp1x = p1.x + (p2.x - p0.x) * tension;
      const cp1y = p1.y + (p2.y - p0.y) * tension;
      const cp2x = p2.x - (p3.x - p1.x) * tension;
      const cp2y = p2.y - (p3.y - p1.y) * tension;
      pathD += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
    }
  }

  const areaD = pathD + ` L ${points[points.length - 1].x},${paddingTop + chartHeight} L ${points[0].x},${paddingTop + chartHeight} Z`;

  const colorMap: Record<string, { stroke: string; fill: string; areaFill: string }> = {
    blue: { stroke: '#3b82f6', fill: '#3b82f6', areaFill: 'rgba(59,130,246,0.08)' },
    purple: { stroke: '#8b5cf6', fill: '#8b5cf6', areaFill: 'rgba(139,92,246,0.08)' },
    green: { stroke: '#10b981', fill: '#10b981', areaFill: 'rgba(16,185,129,0.08)' },
    orange: { stroke: '#f97316', fill: '#f97316', areaFill: 'rgba(249,115,22,0.08)' },
  };
  const c = colorMap[color] || colorMap.blue;

  const labelStep = Math.max(1, Math.ceil(data.length / 8));

  const yTickCount = 4;
  const fmtShort = (n: number) => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
    if (Number.isInteger(n)) return n.toString();
    return n.toFixed(1);
  };

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        preserveAspectRatio="xMidYMid meet"
        onMouseLeave={() => setHoveredIndex(null)}
      >
        {/* Y-axis grid + labels */}
        {Array.from({ length: yTickCount }, (_, i) => {
          const val = minVal + (range * i) / (yTickCount - 1);
          const y = paddingTop + chartHeight - ((val - minVal) / range) * chartHeight;
          return (
            <g key={`y-${i}`}>
              <line x1={paddingLeft} y1={y} x2={width - paddingRight} y2={y} stroke="#f0f0f0" strokeWidth={0.5} />
              <text x={paddingLeft - 4} y={y + 2.5} textAnchor="end" fill="#b0b0b0" fontSize={5.5} fontFamily="system-ui">{fmtShort(val)}</text>
            </g>
          );
        })}

        <path d={areaD} fill={c.areaFill} />
        <path d={pathD} fill="none" stroke={c.stroke} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />

        {points.map((p, i) => {
          const isHovered = hoveredIndex === i;
          const rectWidth = data.length > 1 ? chartWidth / (data.length - 1) : chartWidth;
          const rectX = p.x - rectWidth / 2;

          // Tooltip positioned above chart if point is near top
          const tooltipY = p.y < paddingTop + 18 ? p.y + 14 : p.y - 18;
          const tooltipTextY = p.y < paddingTop + 18 ? p.y + 22 : p.y - 10.5;

          return (
            <g key={i}>
              <rect x={rectX} y={0} width={rectWidth} height={height} fill="transparent" onMouseEnter={() => setHoveredIndex(i)} />
              <circle cx={p.x} cy={p.y} r={isHovered ? 3 : 1.5} fill={isHovered ? c.fill : '#fff'} stroke={c.stroke} strokeWidth={isHovered ? 1.5 : 1} style={{ transition: 'r 0.12s ease' }} />

              {isHovered && (
                <g>
                  <line x1={p.x} y1={paddingTop} x2={p.x} y2={paddingTop + chartHeight} stroke={c.stroke} strokeWidth={0.4} strokeDasharray="2,2" opacity={0.25} />
                  <rect x={p.x - 28} y={tooltipY} width={56} height={13} rx={2.5} fill="#1f2937" opacity={0.92} />
                  <text x={p.x} y={tooltipTextY} textAnchor="middle" fill="white" fontSize={6} fontWeight={600} fontFamily="system-ui">{formatValue(p.value)}</text>
                </g>
              )}

              {i % labelStep === 0 && (
                <text x={p.x} y={height - 3} textAnchor="middle" fill="#c0c0c0" fontSize={5} fontFamily="system-ui">{p.label}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Performance Feedback Panel Component ───
function PerformanceFeedbackPanel({
  campaignId,
  data,
  isLoading,
  isError,
  onRetry,
  formatCurrency: fmtCur,
}: {
  campaignId: string;
  data: any;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  formatCurrency: (amount: number, currency?: string) => string;
}) {
  const [openSection, setOpenSection] = useState<string | null>('conversion');

  const toggleSection = (key: string) => setOpenSection(openSection === key ? null : key);

  if (isLoading) {
    return (
      <div className="mt-4 bg-white rounded-xl border border-purple-200 p-6">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 size={16} className="animate-spin text-purple-600" />
          <span>성과 피드백 분석 중...</span>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mt-4 bg-white rounded-xl border border-red-200 p-6 text-center">
        <AlertTriangle size={24} className="text-red-500 mx-auto mb-2" />
        <p className="text-sm text-red-600 mb-3">성과 피드백을 불러오지 못했습니다.</p>
        <button onClick={onRetry} className="text-xs bg-red-600 text-white px-4 py-1.5 rounded-lg hover:bg-red-700 inline-flex items-center gap-1">
          <RefreshCw size={12} /> 다시 시도
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mt-4 bg-white rounded-xl border border-gray-200 p-6 text-center">
        <p className="text-sm text-gray-500">데이터를 불러오는 중...</p>
      </div>
    );
  }

  // Deep unwrap: API may return nested structures like { feedback: { ... } } or { data: { feedback: {...} } }
  const unwrap = (d: any): any => {
    if (!d) return {};
    // If it has conversion_analysis directly, it's the feedback object
    if (d.conversion_analysis) return d;
    // If wrapped in "feedback" key
    if (d.feedback) return unwrap(d.feedback);
    // If wrapped in "data" key (axios may double-wrap)
    if (d.data && typeof d.data === 'object' && !Array.isArray(d.data)) return unwrap(d.data);
    return d;
  };

  const fb = unwrap(data) as PerformanceFeedback;

  // Debug: log if no analysis found
  if (!fb?.conversion_analysis) {
    console.warn('[PerformanceFeedback] No conversion_analysis found. Raw data:', JSON.stringify(data).slice(0, 500));
  }

  const conv = fb?.conversion_analysis;
  const click = fb?.click_analysis;
  const imp = fb?.impression_analysis;
  const creative = (fb as any)?.creative_fatigue_analysis || fb?.creative_analysis;
  const riskLevel = fb?.risk_level || (
    conv?.status === 'CHECK_CPA' ? 'HIGH' :
    conv?.status === 'EXPAND_TARGET' ? 'MEDIUM' : 'LOW'
  );

  // If unwrap failed to find any analysis, show debug info
  if (!conv && !click && !imp) {
    return (
      <div className="mt-4 bg-white rounded-xl border border-yellow-200 p-6">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={18} className="text-yellow-500" />
          <p className="text-sm font-semibold text-yellow-800">성과 피드백 데이터 구조 오류</p>
        </div>
        <p className="text-xs text-gray-500 mb-2">API 응답에서 분석 데이터를 찾을 수 없습니다.</p>
        <details className="text-xs">
          <summary className="cursor-pointer text-blue-600 hover:underline mb-1">응답 데이터 확인</summary>
          <pre className="bg-gray-50 rounded-lg p-3 overflow-x-auto max-h-48 text-[10px] text-gray-700 border">
            {JSON.stringify(data, null, 2).slice(0, 2000)}
          </pre>
        </details>
        <button onClick={onRetry} className="mt-3 text-xs bg-purple-600 text-white px-4 py-1.5 rounded-lg hover:bg-purple-700 inline-flex items-center gap-1">
          <RefreshCw size={12} /> 캐시 삭제 후 재분석
        </button>
      </div>
    );
  }

  const riskConfig: Record<string, { bg: string; text: string; label: string }> = {
    LOW: { bg: 'bg-green-100', text: 'text-green-700', label: '낮음' },
    MEDIUM: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '중간' },
    HIGH: { bg: 'bg-red-100', text: 'text-red-700', label: '높음' },
  };
  const risk = riskConfig[riskLevel] || riskConfig.LOW;

  const TrendArrow = ({ value, goodDirection = 'up' }: { value?: number; goodDirection?: 'up' | 'down' }) => {
    if (value === undefined || value === null) return null;
    const isUp = value > 0;
    const isGood = (goodDirection === 'up' && isUp) || (goodDirection === 'down' && !isUp);
    return (
      <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${isGood ? 'text-green-600' : Math.abs(value) < 2 ? 'text-gray-400' : 'text-red-500'}`}>
        {isUp ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
        {isUp ? '+' : ''}{value.toFixed(1)}%
      </span>
    );
  };

  const SectionHeader = ({ sectionKey, icon, title, subtitle }: { sectionKey: string; icon: React.ReactNode; title: string; subtitle: string }) => (
    <button
      onClick={() => toggleSection(sectionKey)}
      className="w-full flex items-center justify-between p-3 hover:bg-gray-50 rounded-lg transition-colors"
    >
      <div className="flex items-center gap-2">
        {icon}
        <div className="text-left">
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          <p className="text-[10px] text-gray-400">{subtitle}</p>
        </div>
      </div>
      {openSection === sectionKey ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
    </button>
  );

  return (
    <div className="mt-4 bg-white rounded-xl border border-purple-200 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={18} className="text-white" />
          <h4 className="text-sm font-bold text-white">성과 피드백</h4>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${risk.bg} ${risk.text}`}>
            위험도: {risk.label}
          </span>
        </div>
      </div>

      <div className="divide-y divide-gray-100">
        {/* Section 1: [전환 측정] ROAS & 효율성 */}
        <div>
          <SectionHeader
            sectionKey="conversion"
            icon={<Target size={16} className="text-orange-500" />}
            title="[전환 측정] ROAS & 효율성"
            subtitle={conv ? `ROAS ${conv.current_roas?.toFixed(2) || '-'}` : '데이터 없음'}
          />
          {openSection === 'conversion' && conv && (
            <div className="px-4 pb-4 space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="bg-gray-50 rounded-lg p-2.5">
                  <p className="text-[10px] text-gray-400">현재 ROAS</p>
                  <p className="text-sm font-bold text-gray-900">{conv.current_roas?.toFixed(2) || '-'}</p>
                  <TrendArrow value={conv.roas_change_pct} goodDirection="up" />
                </div>
                <div className="bg-gray-50 rounded-lg p-2.5">
                  <p className="text-[10px] text-gray-400">이전 ROAS</p>
                  <p className="text-sm font-bold text-gray-500">{conv.previous_roas?.toFixed(2) || '-'}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-2.5">
                  <p className="text-[10px] text-gray-400">현재 CPM</p>
                  <p className="text-sm font-bold text-gray-900">{fmtCur(conv.current_cpm || 0)}</p>
                  <TrendArrow value={conv.cpm_change_pct} goodDirection="down" />
                </div>
                <div className="bg-gray-50 rounded-lg p-2.5">
                  <p className="text-[10px] text-gray-400">CPA vs 객단가</p>
                  <p className="text-sm font-bold text-gray-900">{conv.current_cpa ? fmtCur(conv.current_cpa) : '-'}</p>
                  {conv.avg_order_value && <p className="text-[10px] text-gray-400">객단가: {fmtCur(conv.avg_order_value)}</p>}
                </div>
              </div>
              {/* Status badge */}
              <div className={`rounded-lg p-3 text-sm ${
                conv.status === 'INCREASE_BUDGET' ? 'bg-green-50 border border-green-200 text-green-800' :
                conv.status === 'EXPAND_TARGET' ? 'bg-yellow-50 border border-yellow-200 text-yellow-800' :
                conv.status === 'CHECK_CPA' ? 'bg-red-50 border border-red-200 text-red-800' :
                'bg-blue-50 border border-blue-200 text-blue-800'
              }`}>
                <p className="font-semibold text-xs mb-1">
                  {conv.status === 'INCREASE_BUDGET' ? 'CPM\u2193 + ROAS\u2191 \u2192 \uC801\uADF9 \uC99D\uC561 \uCD94\uCC9C' :
                   conv.status === 'EXPAND_TARGET' ? 'CPM\u2191 + ROAS\uC720\uC9C0 \u2192 \uC18C\uC7AC \uC720\uC9C0, \uD0C0\uAC9F \uD655\uC7A5 \uACE0\uB824' :
                   conv.status === 'CHECK_CPA' ? 'ROAS\u2193 \u2192 CPA vs \uAC1D\uB2E8\uAC00 \uBD84\uC11D \uD544\uC694' :
                   '\uD604\uC7AC \uC0C1\uD0DC \uC720\uC9C0'}
                </p>
                <p className="text-xs">{conv.recommendation}</p>
              </div>
            </div>
          )}
        </div>

        {/* Section 2: [클릭 측정] CTR & CPC */}
        <div>
          <SectionHeader
            sectionKey="click"
            icon={<MousePointer size={16} className="text-blue-500" />}
            title="[클릭 측정] CTR & CPC"
            subtitle={click ? `CTR ${click.overall_ctr?.toFixed(2) || '-'}%` : '데이터 없음'}
          />
          {openSection === 'click' && click && (
            <div className="px-4 pb-4 space-y-3">
              {/* CTR comparison bar */}
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-[10px] text-gray-500 mb-2">링크 클릭 CTR vs 전체 CTR</p>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-400 w-16">링크 CTR</span>
                    <div className="flex-1 h-4 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min((click.link_click_ctr || 0) * 20, 100)}%` }} />
                    </div>
                    <span className="text-xs font-semibold w-12 text-right">{click.link_click_ctr?.toFixed(2)}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-400 w-16">전체 CTR</span>
                    <div className="flex-1 h-4 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${Math.min((click.overall_ctr || 0) * 20, 100)}%` }} />
                    </div>
                    <span className="text-xs font-semibold w-12 text-right">{click.overall_ctr?.toFixed(2)}%</span>
                  </div>
                </div>
                {click.ctr_gap_warning && (
                  <p className="text-[10px] text-amber-600 mt-1.5 flex items-center gap-1"><AlertTriangle size={10} /> CTR 격차가 큼 - 참여는 높으나 클릭 전환 부족</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="bg-gray-50 rounded-lg p-2.5">
                  <p className="text-[10px] text-gray-400">CPC 추이</p>
                  <p className="text-sm font-bold">{fmtCur(click.current_cpc || 0)}</p>
                  <p className="text-[10px] text-gray-400">{click.cpc_trend}</p>
                </div>
                <div className={`rounded-lg p-2.5 ${
                  click.landing_status === 'GOOD' ? 'bg-green-50 border border-green-200' :
                  click.landing_status === 'WARNING' ? 'bg-yellow-50 border border-yellow-200' :
                  'bg-red-50 border border-red-200'
                }`}>
                  <p className="text-[10px] text-gray-400">랜딩페이지 도달율</p>
                  <p className="text-sm font-bold">{click.landing_page_view_rate?.toFixed(1)}%</p>
                  <p className="text-[10px]">
                    {click.landing_status === 'GOOD' ? '정상' :
                     click.landing_status === 'WARNING' ? '점검 권장' :
                     '웹사이트 속도/랜딩 점검 필요'}
                  </p>
                </div>
              </div>
              {click.recommendation && <p className="text-xs text-gray-600 bg-blue-50 rounded-lg p-2.5 border border-blue-100">{click.recommendation}</p>}
            </div>
          )}
        </div>

        {/* Section 3: [노출 측정] CPM & 피로도 */}
        <div>
          <SectionHeader
            sectionKey="impression"
            icon={<Eye size={16} className="text-green-500" />}
            title="[노출 측정] CPM & 피로도"
            subtitle={imp ? `빈도 ${imp.current_frequency?.toFixed(2) || '-'}` : '데이터 없음'}
          />
          {openSection === 'impression' && imp && (
            <div className="px-4 pb-4 space-y-3">
              {/* Frequency gauge */}
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] text-gray-500">노출 빈도 (Frequency)</p>
                  <span className={`text-sm font-black ${imp.current_frequency > 2.3 ? 'text-red-600' : imp.current_frequency > 1.8 ? 'text-yellow-600' : 'text-green-600'}`}>
                    {imp.current_frequency?.toFixed(2)}
                  </span>
                </div>
                <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${imp.current_frequency > 2.3 ? 'bg-red-500' : imp.current_frequency > 1.8 ? 'bg-yellow-500' : 'bg-green-500'}`}
                    style={{ width: `${Math.min((imp.current_frequency / 4) * 100, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between mt-0.5">
                  <span className="text-[9px] text-gray-300">0</span>
                  <span className="text-[9px] text-red-300">2.3 (경고)</span>
                  <span className="text-[9px] text-gray-300">4+</span>
                </div>
                {imp.frequency_warning && (
                  <p className="text-[10px] text-red-600 mt-1.5 flex items-center gap-1"><AlertTriangle size={10} /> 빈도가 2.3을 초과했습니다. 소재 교체를 고려하세요.</p>
                )}
              </div>

              {/* Fatigue alert */}
              {imp.fatigue_detected && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <AlertTriangle size={14} className="text-red-600" />
                    <p className="text-xs font-semibold text-red-700">피로도 감지</p>
                  </div>
                  <p className="text-xs text-red-600">빈도 &gt; 2.3 + CPM {imp.cpm_trend === 'UP' ? '\u2191' : '\u2193'} + CTR {imp.ctr_trend === 'DOWN' ? '\u2193' : '\u2191'}</p>
                  {imp.recommendation && <p className="text-xs text-red-500 mt-1">{imp.recommendation}</p>}
                </div>
              )}

              {/* CPC weekly trend */}
              {imp.weekly_cpc_trend && imp.weekly_cpc_trend.length > 0 && (
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-[10px] text-gray-500 mb-2">30일 CPC 주간 추이</p>
                  <div className="flex items-end gap-1 h-12">
                    {imp.weekly_cpc_trend.map((val: number, i: number) => {
                      const maxCpc = Math.max(...imp.weekly_cpc_trend, 1);
                      const height = (val / maxCpc) * 100;
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                          <div
                            className={`w-full rounded-t ${imp.cpc_upward_trend ? 'bg-red-400' : 'bg-blue-400'}`}
                            style={{ height: `${height}%`, minHeight: '2px' }}
                          />
                          <span className="text-[8px] text-gray-400">W{i + 1}</span>
                        </div>
                      );
                    })}
                  </div>
                  {imp.cpc_upward_trend && (
                    <p className="text-[10px] text-red-500 mt-1.5 flex items-center gap-1"><TrendingUp size={10} /> CPC 상승 패턴 감지</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Section 4: [소재 피로도 분석] */}
        <div>
          <SectionHeader
            sectionKey="creative"
            icon={<Palette size={16} className="text-purple-500" />}
            title="[소재 피로도 분석]"
            subtitle={creative ? `활성 소재 ${creative.active_ad_count}개` : '데이터 없음'}
          />
          {openSection === 'creative' && creative && (
            <div className="px-4 pb-4 space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                  <p className="text-[10px] text-gray-400">현재 ON 소재 수</p>
                  <p className={`text-lg font-black ${creative.active_ad_count <= 1 ? 'text-red-600' : creative.active_ad_count <= 2 ? 'text-yellow-600' : 'text-green-600'}`}>
                    {creative.active_ad_count}
                  </p>
                  <p className="text-[9px] text-gray-300">전체 {creative.total_ad_count}개</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                  <p className="text-[10px] text-gray-400">소재 다양성</p>
                  <p className={`text-lg font-black ${creative.diversity_score >= 70 ? 'text-green-600' : creative.diversity_score >= 40 ? 'text-yellow-600' : 'text-red-600'}`}>
                    {creative.diversity_score}
                  </p>
                  <p className="text-[9px] text-gray-300">/ 100점</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                  <p className="text-[10px] text-gray-400">상태</p>
                  {(() => {
                    const declining = creative.creative_performances?.filter((c: any) => c.trend === 'DECLINING').length || 0;
                    const total = creative.creative_performances?.length || 0;
                    const ratio = total > 0 ? declining / total : 0;
                    return (
                      <>
                        <p className={`text-sm font-bold ${ratio > 0.5 ? 'text-red-600' : ratio > 0.2 ? 'text-yellow-600' : 'text-green-600'}`}>
                          {ratio > 0.5 ? '교체 필요' : ratio > 0.2 ? '주의' : '양호'}
                        </p>
                        <p className="text-[9px] text-gray-300">하락 {declining}/{total}개</p>
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Per-creative details */}
              {creative.creative_performances && creative.creative_performances.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] text-gray-500 font-semibold">소재별 성과 추이</p>
                  {creative.creative_performances.map((c: any, i: number) => {
                    const trendColor = c.trend === 'IMPROVING' ? 'text-green-600' : c.trend === 'DECLINING' ? 'text-red-600' : 'text-gray-500';
                    const trendBg = c.trend === 'IMPROVING' ? 'bg-green-50 border-green-200' : c.trend === 'DECLINING' ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200';
                    const trendLabel = c.trend === 'IMPROVING' ? '\u2191 \uAC1C\uC120' : c.trend === 'DECLINING' ? '\u2193 \uD558\uB77D' : '\u2192 \uC720\uC9C0';
                    return (
                      <div key={i} className={`rounded-lg p-2.5 border ${trendBg}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-gray-900 truncate flex-1 mr-2">{c.ad_name}</span>
                          <span className={`text-[10px] font-bold ${trendColor}`}>{trendLabel}</span>
                        </div>
                        <div className="flex gap-3 text-[10px] text-gray-500">
                          <span>CTR {c.ctr?.toFixed(2)}%</span>
                          <span>CPC {fmtCur(c.cpc || 0)}</span>
                          <span>지출 {fmtCur(c.spend || 0)}</span>
                          <span className={`font-medium ${c.status === 'ACTIVE' ? 'text-green-600' : 'text-gray-400'}`}>{c.status}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {creative.recommendation && (
                <p className="text-xs text-gray-600 bg-purple-50 rounded-lg p-2.5 border border-purple-100">{creative.recommendation}</p>
              )}

              {creative.active_ad_count <= 1 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 flex items-start gap-1.5">
                  <AlertTriangle size={12} className="text-red-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-red-600">활성 소재가 {creative.active_ad_count}개뿐입니다. 최소 3개 이상의 소재를 운영하는 것을 권장합니다.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Recommendations */}
        {fb?.recommendations && fb.recommendations.length > 0 && (
          <div className="p-4">
            <p className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1"><Lightbulb size={12} className="text-yellow-500" /> 종합 권장사항</p>
            <div className="space-y-1.5">
              {fb.recommendations.map((rec: string, i: number) => (
                <div key={i} className="flex items-start gap-2 text-xs text-gray-600">
                  <span className="w-4 h-4 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold">{i + 1}</span>
                  <span>{rec}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Creative Performance Dashboard Component ───
function CreativePerformanceDashboard({
  campaigns, datePreset, formatCurrency: fmtCur, formatNum, formatCPC, formatROAS, formatSpend,
}: {
  campaigns: any[];
  datePreset: string;
  formatCurrency: (amount: number, currency?: string) => string;
  formatNum: (v: any) => string;
  formatCPC: (v: any) => string;
  formatROAS: (v: any) => string;
  formatSpend: (v: any) => string;
}) {
  const [showCreativeDash, setShowCreativeDash] = useState(false);
  const [sortBy, setSortBy] = useState<'spend' | 'ctr' | 'roas' | 'cpc'>('spend');
  const [selectedAdForChart, setSelectedAdForChart] = useState<string | null>(null);
  const [selectedAdForComments, setSelectedAdForComments] = useState<string | null>(null);
  const [adsetsCache, setAdsetsCache] = useState<Record<string, any>>({});
  const [loadingAdsets, setLoadingAdsets] = useState(false);

  // Load ad-level data for all campaigns when dashboard is expanded
  const loadAdLevelData = useCallback(async () => {
    if (loadingAdsets) return;
    setLoadingAdsets(true);
    const cache: Record<string, any> = {};
    for (const camp of campaigns) {
      const campId = camp.meta_campaign_id || camp.id;
      if (!campId || adsetsCache[campId]) continue;
      try {
        const data = await analyticsApi.getCampaignAdsets(String(campId), datePreset);
        cache[campId] = data;
      } catch { /* skip */ }
    }
    setAdsetsCache(prev => ({ ...prev, ...cache }));
    setLoadingAdsets(false);
  }, [campaigns, datePreset, adsetsCache, loadingAdsets]);

  // Per-creative trend data
  const trendQuery = useQuery({
    queryKey: ['ad-trend', selectedAdForChart],
    queryFn: () => analyticsApi.getAdTrend(selectedAdForChart!, 14),
    enabled: !!selectedAdForChart,
    staleTime: 5 * 60 * 1000,
  });

  // Ad post info (for comments)
  const postInfoQuery = useQuery({
    queryKey: ['ad-post-info', selectedAdForComments],
    queryFn: () => analyticsApi.getAdPostInfo(selectedAdForComments!),
    enabled: !!selectedAdForComments,
  });

  // Comments for ad
  const commentsQuery = useQuery({
    queryKey: ['ad-comments', postInfoQuery.data?.post_id],
    queryFn: () => analyticsApi.getAdComments(postInfoQuery.data!.post_id),
    enabled: !!postInfoQuery.data?.post_id,
  });

  // Collect all ads from all campaigns' expanded data
  const allAds = useMemo(() => {
    const ads: any[] = [];
    for (const camp of campaigns) {
      if (!camp.insights) continue;
      const ins = camp.insights;
      const purchaseValue = ins?.website_purchase_conversion_value || ins?.action_values?.find((a: any) => a.action_type === 'purchase' || a.action_type === 'omni_purchase')?.value;
      const campId = camp.meta_campaign_id || camp.id;
      const cachedAdsets = adsetsCache[campId]?.adsets || camp.adsets;

      if (cachedAdsets && cachedAdsets.length > 0) {
        for (const adset of cachedAdsets) {
          for (const ad of (adset.ads || [])) {
            const adIns = ad.insights || {};
            const adPV = adIns?.action_values?.find((a: any) => a.action_type === 'purchase' || a.action_type === 'omni_purchase')?.value;
            ads.push({
              id: ad.id,
              meta_ad_id: ad.id,
              name: ad.name,
              campaign_name: camp.name,
              adset_name: adset.name,
              status: ad.effective_status || ad.status,
              spend: parseFloat(adIns.spend || 0),
              impressions: parseFloat(adIns.impressions || 0),
              clicks: parseFloat(adIns.clicks || 0),
              ctr: parseFloat(adIns.ctr || 0),
              cpc: parseFloat(adIns.cpc || 0),
              cpm: parseFloat(adIns.cpm || 0),
              roas: adIns.roas || 0,
              conversion_value: adPV ? parseFloat(adPV) : 0,
              frequency: parseFloat(adIns.frequency || 0),
              thumbnail_url: ad.creative?.thumbnail_url,
            });
          }
        }
      } else {
        // Fallback: campaign-level as "creative" if no ad-level data
        ads.push({
          id: camp.id,
          meta_ad_id: campId,
          name: camp.name,
          campaign_name: camp.name,
          status: camp.effective_status || camp.status,
          spend: parseFloat(ins.spend || 0),
          impressions: parseFloat(ins.impressions || 0),
          clicks: parseFloat(ins.clicks || 0),
          ctr: parseFloat(ins.ctr || 0),
          cpc: parseFloat(ins.cpc || 0),
          cpm: parseFloat(ins.cpm || 0),
          roas: ins.roas || 0,
          conversion_value: purchaseValue ? parseFloat(purchaseValue) : 0,
          frequency: parseFloat(ins.frequency || 0),
        });
      }
    }
    return ads;
  }, [campaigns, adsetsCache]);

  const sortedAds = useMemo(() => {
    return [...allAds].sort((a, b) => {
      if (sortBy === 'roas') return (b.roas || 0) - (a.roas || 0);
      if (sortBy === 'ctr') return b.ctr - a.ctr;
      if (sortBy === 'cpc') return a.cpc - b.cpc;
      return b.spend - a.spend;
    });
  }, [allAds, sortBy]);

  if (allAds.length === 0) return null;

  const topByROAS = [...allAds].filter(a => a.roas > 0).sort((a, b) => b.roas - a.roas).slice(0, 3);
  const topByCTR = [...allAds].sort((a, b) => b.ctr - a.ctr).slice(0, 3);

  // Mini SVG bar chart for per-creative trend
  const renderMiniTrend = (data: any[]) => {
    if (!data || data.length === 0) return <p className="text-xs text-gray-400">데이터 없음</p>;
    const maxSpend = Math.max(...data.map((d: any) => parseFloat(d.spend || 0)), 1);
    const w = 280;
    const h = 80;
    const barW = Math.max(4, (w - data.length * 2) / data.length);
    return (
      <svg width={w} height={h + 20} className="overflow-visible">
        {data.map((d: any, i: number) => {
          const spend = parseFloat(d.spend || 0);
          const barH = (spend / maxSpend) * h;
          const x = i * (barW + 2);
          return (
            <g key={i}>
              <rect x={x} y={h - barH} width={barW} height={barH} rx={2} fill="#8b5cf6" opacity={0.7} />
              {i % 3 === 0 && (
                <text x={x} y={h + 14} fontSize={8} fill="#9ca3af">{(d.date || '').slice(5)}</text>
              )}
            </g>
          );
        })}
      </svg>
    );
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <button
          onClick={() => setShowCreativeDash(!showCreativeDash)}
          className="flex items-center gap-2 text-left"
        >
          {showCreativeDash ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Palette size={18} className="text-purple-500" /> 크리에이티브 성과 대시보드
          </h3>
          <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">{allAds.length}개</span>
        </button>
        {showCreativeDash && Object.keys(adsetsCache).length === 0 && (
          <button
            onClick={loadAdLevelData}
            disabled={loadingAdsets}
            className="text-xs px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            {loadingAdsets ? <Loader2 size={12} className="animate-spin" /> : <Layers size={12} />}
            {loadingAdsets ? '로딩 중...' : '소재별 데이터 로드'}
          </button>
        )}
      </div>

      {showCreativeDash && (
        <div className="p-5 space-y-5">
          {/* Top performers cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {topByROAS.length > 0 && (
              <div className="bg-gradient-to-br from-emerald-50 to-green-50 rounded-xl p-4 border border-emerald-200">
                <h4 className="text-xs font-bold text-emerald-800 mb-3 flex items-center gap-1.5">
                  <TrendingUp size={14} /> ROAS 우수 소재 TOP 3
                </h4>
                <div className="space-y-2">
                  {topByROAS.map((ad, i) => (
                    <div key={ad.id} className="flex items-center justify-between bg-white rounded-lg p-2.5 border border-emerald-100">
                      <div className="flex items-center gap-2">
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${
                          i === 0 ? 'bg-emerald-500' : i === 1 ? 'bg-emerald-400' : 'bg-emerald-300'
                        }`}>{i + 1}</span>
                        <span className="text-xs font-medium text-gray-800 truncate max-w-[150px]">{ad.name}</span>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-emerald-600">ROAS {formatROAS(ad.roas)}</p>
                        <p className="text-[10px] text-gray-400">매출 {formatSpend(ad.conversion_value)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {topByCTR.length > 0 && (
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-200">
                <h4 className="text-xs font-bold text-blue-800 mb-3 flex items-center gap-1.5">
                  <MousePointer size={14} /> CTR 우수 소재 TOP 3
                </h4>
                <div className="space-y-2">
                  {topByCTR.map((ad, i) => (
                    <div key={ad.id} className="flex items-center justify-between bg-white rounded-lg p-2.5 border border-blue-100">
                      <div className="flex items-center gap-2">
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${
                          i === 0 ? 'bg-blue-500' : i === 1 ? 'bg-blue-400' : 'bg-blue-300'
                        }`}>{i + 1}</span>
                        <span className="text-xs font-medium text-gray-800 truncate max-w-[150px]">{ad.name}</span>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-blue-600">CTR {ad.ctr.toFixed(2)}%</p>
                        <p className="text-[10px] text-gray-400">CPC {formatCPC(ad.cpc)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sort controls */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">정렬:</span>
            {([
              { key: 'spend' as const, label: '지출순' },
              { key: 'roas' as const, label: 'ROAS순' },
              { key: 'ctr' as const, label: 'CTR순' },
              { key: 'cpc' as const, label: 'CPC순' },
            ]).map(s => (
              <button
                key={s.key}
                onClick={() => setSortBy(s.key)}
                className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${
                  sortBy === s.key ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >{s.label}</button>
            ))}
          </div>

          {/* Creative performance table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-2 text-gray-500 font-medium">소재/캠페인</th>
                  <th className="text-right py-2 px-2 text-gray-500 font-medium">상태</th>
                  <th className="text-right py-2 px-2 text-gray-500 font-medium">지출</th>
                  <th className="text-right py-2 px-2 text-gray-500 font-medium">전환값</th>
                  <th className="text-right py-2 px-2 text-gray-500 font-medium">ROAS</th>
                  <th className="text-right py-2 px-2 text-gray-500 font-medium">CTR</th>
                  <th className="text-right py-2 px-2 text-gray-500 font-medium">CPC</th>
                  <th className="text-right py-2 px-2 text-gray-500 font-medium">CPM</th>
                  <th className="text-right py-2 px-2 text-gray-500 font-medium">빈도</th>
                  <th className="text-center py-2 px-2 text-gray-500 font-medium">관리</th>
                </tr>
              </thead>
              <tbody>
                {sortedAds.map((ad) => {
                  const statusKo = ad.status === 'ACTIVE' ? '활성' : ad.status === 'PAUSED' ? '중지' : ad.status;
                  const statusColor = ad.status === 'ACTIVE' ? 'text-green-600' : ad.status === 'PAUSED' ? 'text-yellow-600' : 'text-gray-400';
                  return (
                    <tr key={ad.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-2">
                          {ad.thumbnail_url && (
                            <img src={ad.thumbnail_url} alt="" className="w-8 h-8 rounded object-cover" />
                          )}
                          <div>
                            <p className="font-medium text-gray-800 truncate max-w-[180px]">{ad.name}</p>
                            {ad.adset_name && <p className="text-[10px] text-gray-400 truncate max-w-[180px]">{ad.campaign_name} &gt; {ad.adset_name}</p>}
                          </div>
                        </div>
                      </td>
                      <td className={`py-2 px-2 text-right font-medium ${statusColor}`}>{statusKo}</td>
                      <td className="py-2 px-2 text-right">{formatSpend(ad.spend)}</td>
                      <td className="py-2 px-2 text-right">{ad.conversion_value ? formatSpend(ad.conversion_value) : '-'}</td>
                      <td className={`py-2 px-2 text-right font-semibold ${ad.roas >= 1 ? 'text-green-600' : ad.roas > 0 ? 'text-red-500' : 'text-gray-400'}`}>
                        {formatROAS(ad.roas)}
                      </td>
                      <td className="py-2 px-2 text-right">{ad.ctr.toFixed(2)}%</td>
                      <td className="py-2 px-2 text-right">{formatCPC(ad.cpc)}</td>
                      <td className="py-2 px-2 text-right">{fmtCur(ad.cpm)}</td>
                      <td className={`py-2 px-2 text-right ${ad.frequency > 2.3 ? 'text-red-500 font-medium' : ''}`}>
                        {ad.frequency.toFixed(2)}
                      </td>
                      <td className="py-2 px-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setSelectedAdForChart(selectedAdForChart === ad.meta_ad_id ? null : ad.meta_ad_id)}
                            title="소재별 차트"
                            className={`p-1 rounded hover:bg-purple-100 ${selectedAdForChart === ad.meta_ad_id ? 'bg-purple-100 text-purple-600' : 'text-gray-400'}`}
                          >
                            <BarChart2 size={14} />
                          </button>
                          <button
                            onClick={() => setSelectedAdForComments(selectedAdForComments === ad.meta_ad_id ? null : ad.meta_ad_id)}
                            title="댓글 관리"
                            className={`p-1 rounded hover:bg-blue-100 ${selectedAdForComments === ad.meta_ad_id ? 'bg-blue-100 text-blue-600' : 'text-gray-400'}`}
                          >
                            <MessageSquare size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Per-Creative Chart Panel */}
          {selectedAdForChart && (
            <div className="border border-purple-200 rounded-xl p-4 bg-purple-50/30">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-purple-800 flex items-center gap-1.5">
                  <BarChart2 size={16} /> 소재별 일별 트렌드 (14일)
                </h4>
                <button onClick={() => setSelectedAdForChart(null)} className="text-gray-400 hover:text-gray-600">
                  <X size={16} />
                </button>
              </div>
              {trendQuery.isLoading ? (
                <div className="flex items-center gap-2 text-xs text-gray-500 py-4">
                  <Loader2 size={14} className="animate-spin" /> 트렌드 데이터 로딩 중...
                </div>
              ) : trendQuery.isError ? (
                <p className="text-xs text-red-500">트렌드 데이터를 가져올 수 없습니다.</p>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {(() => {
                      const data = trendQuery.data?.data || [];
                      const totalSpend = data.reduce((s: number, d: any) => s + parseFloat(d.spend || 0), 0);
                      const totalClicks = data.reduce((s: number, d: any) => s + parseFloat(d.clicks || 0), 0);
                      const totalImpressions = data.reduce((s: number, d: any) => s + parseFloat(d.impressions || 0), 0);
                      const totalConv = data.reduce((s: number, d: any) => s + (d.conversion_value || 0), 0);
                      return (
                        <>
                          <div className="bg-white rounded-lg p-2.5 border border-purple-100">
                            <p className="text-[10px] text-gray-500">총 지출</p>
                            <p className="text-sm font-bold">{formatSpend(totalSpend)}</p>
                          </div>
                          <div className="bg-white rounded-lg p-2.5 border border-purple-100">
                            <p className="text-[10px] text-gray-500">총 클릭</p>
                            <p className="text-sm font-bold">{formatNum(totalClicks)}</p>
                          </div>
                          <div className="bg-white rounded-lg p-2.5 border border-purple-100">
                            <p className="text-[10px] text-gray-500">총 노출</p>
                            <p className="text-sm font-bold">{formatNum(totalImpressions)}</p>
                          </div>
                          <div className="bg-white rounded-lg p-2.5 border border-purple-100">
                            <p className="text-[10px] text-gray-500">총 전환값</p>
                            <p className="text-sm font-bold">{formatSpend(totalConv)}</p>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                  <div className="bg-white rounded-lg p-3 border border-purple-100">
                    <p className="text-[10px] text-gray-500 mb-2">일별 지출 추이</p>
                    {renderMiniTrend(trendQuery.data?.data || [])}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Comment Management Panel */}
          {selectedAdForComments && (
            <div className="border border-blue-200 rounded-xl p-4 bg-blue-50/30">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-blue-800 flex items-center gap-1.5">
                  <MessageSquare size={16} /> 댓글 관리
                </h4>
                <div className="flex items-center gap-2">
                  {postInfoQuery.data?.preview_url && (
                    <a
                      href={postInfoQuery.data.preview_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                    >
                      <ExternalLink size={12} /> 게시물 보기
                    </a>
                  )}
                  <button onClick={() => setSelectedAdForComments(null)} className="text-gray-400 hover:text-gray-600">
                    <X size={16} />
                  </button>
                </div>
              </div>

              {postInfoQuery.isLoading ? (
                <div className="flex items-center gap-2 text-xs text-gray-500 py-4">
                  <Loader2 size={14} className="animate-spin" /> 게시물 정보 로딩 중...
                </div>
              ) : postInfoQuery.isError ? (
                <p className="text-xs text-red-500">게시물 정보를 가져올 수 없습니다. 이 광고에 게시물이 연결되어 있지 않을 수 있습니다.</p>
              ) : !postInfoQuery.data?.post_id ? (
                <p className="text-xs text-gray-500">이 광고에 연결된 게시물이 없습니다.</p>
              ) : commentsQuery.isLoading ? (
                <div className="flex items-center gap-2 text-xs text-gray-500 py-4">
                  <Loader2 size={14} className="animate-spin" /> 댓글 로딩 중...
                </div>
              ) : (
                <div className="space-y-2">
                  {postInfoQuery.data?.thumbnail_url && (
                    <img src={postInfoQuery.data.thumbnail_url} alt="" className="w-16 h-16 rounded-lg object-cover" />
                  )}
                  <p className="text-xs text-gray-600">
                    게시물 ID: <span className="font-mono text-gray-400">{postInfoQuery.data.post_id}</span>
                  </p>
                  {(commentsQuery.data?.comments || []).length === 0 ? (
                    <p className="text-xs text-gray-500 py-2">댓글이 없습니다.</p>
                  ) : (
                    <div className="max-h-64 overflow-y-auto space-y-2">
                      {(commentsQuery.data?.comments || []).map((comment: any) => (
                        <div key={comment.id} className="bg-white rounded-lg p-3 border border-blue-100">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-semibold text-gray-800">
                              {comment.username || '사용자'}
                            </span>
                            <span className="text-[10px] text-gray-400">
                              {comment.timestamp ? new Date(comment.timestamp).toLocaleString('ko-KR') : ''}
                            </span>
                          </div>
                          <p className="text-xs text-gray-700">{comment.text}</p>
                          {comment.like_count > 0 && (
                            <p className="text-[10px] text-gray-400 mt-1">좋아요 {comment.like_count}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
