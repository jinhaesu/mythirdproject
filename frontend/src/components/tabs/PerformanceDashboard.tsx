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
import { analyticsApi, insightsApi, clearAnalysisCache } from '@/lib/api';
import type { InsightTrendPoint, InsightTrendCampaign } from '@/lib/api';
import toast from 'react-hot-toast';
import type { PerformanceFeedback, CampaignStatusFilter } from '@/types';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  Legend, ResponsiveContainer, PieChart, Pie, Cell,
  ComposedChart, Scatter, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, Treemap,
} from 'recharts';

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
  const [aiStatusFilter, setAiStatusFilter] = useState<CampaignStatusFilter>('ALL');
  const [aiTriggered, setAiTriggered] = useState(false);
  const [trendView, setTrendView] = useState<'daily' | 'weekly'>('daily');
  const [feedbackExpanded, setFeedbackExpanded] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  // 추세 분석 섹션 기간 선택 (7 | 30 | 90일)
  const [insightDays, setInsightDays] = useState<7 | 30 | 90>(30);
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
    queryKey: ['ai-analysis', datePreset, aiStatusFilter],
    queryFn: () => analyticsApi.getAIAnalysis(datePreset, overview, aiStatusFilter !== 'ALL' ? aiStatusFilter : undefined),
    enabled: aiTriggered && overview?.connected === true && !!overview?.campaigns?.length,
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

  // ─── 추세 분석 섹션: DB 스냅샷 기반 데이터 ───

  // 수집기 상태 (60초 주기 갱신, 토큰 만료 감지)
  const { data: insightStatus } = useQuery({
    queryKey: ['insight-status'],
    queryFn: () => insightsApi.getStatus(),
    refetchInterval: 60000,
    retry: 1,
  });

  // 추세 데이터 (기간 변경 시 재조회)
  const {
    data: insightTrend,
    isLoading: insightTrendLoading,
    refetch: refetchInsightTrend,
  } = useQuery({
    queryKey: ['insight-trend', insightDays],
    queryFn: () => insightsApi.getTrend(insightDays),
    retry: 1,
    staleTime: 5 * 60 * 1000, // 5분 캐시
  });

  // 즉시 수집 실행
  const insightRefreshMutation = useMutation({
    mutationFn: () => insightsApi.refresh(),
    onSuccess: (res) => {
      toast.success(`수집 완료: ${res.collected_rows.toLocaleString('ko-KR')}건`);
      queryClient.invalidateQueries({ queryKey: ['insight-trend'] });
      queryClient.invalidateQueries({ queryKey: ['insight-status'] });
      refetchInsightTrend();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || '수집 실패. 잠시 후 다시 시도해주세요.');
    },
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
          <div className="w-20 h-20 bg-[#EB5757]/15 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertTriangle size={40} className="text-[#EB5757]" />
          </div>
          <h2 className="text-2xl font-bold text-[#F7F8F8] mb-3">데이터 로딩 실패</h2>
          <p className="text-[#8A8F98] mb-6">Meta 광고 데이터를 가져오는데 실패했습니다.</p>
          <button onClick={() => refetchOverview()} className="bg-[#5E6AD2] text-white px-6 py-2 rounded-lg hover:bg-[#828FFF]">다시 시도</button>
        </div>
      </div>
    );
  }

  if (overview && !overview.connected) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 bg-[#4EA7FC]/15 rounded-full flex items-center justify-center mx-auto mb-6">
            <BarChart3 size={40} className="text-[#7070FF]" />
          </div>
          <h2 className="text-2xl font-bold text-[#F7F8F8] mb-3">Meta 계정을 연동해주세요</h2>
          <p className="text-[#8A8F98] mb-6">Meta 광고 관리자 계정을 연동하면 실제 캠페인 데이터를 기반으로 성과 분석, AI 추천, 광고 관리가 가능합니다.</p>
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
          <h2 className="text-xl font-bold text-[#F7F8F8]">성과 분석 대시보드</h2>
          <p className="text-xs text-[#8A8F98] mt-1">Meta 광고 관리자 실시간 데이터</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={aiStatusFilter}
            onChange={(e) => { setAiStatusFilter(e.target.value as CampaignStatusFilter); setAiTriggered(false); }}
            className="px-3 py-2 border border-[#23252A] rounded-lg text-sm"
          >
            <option value="ALL">전체 캠페인</option>
            <option value="ACTIVE">활성</option>
            <option value="PAUSED">일시중지</option>
            <option value="PENDING_REVIEW">검토중</option>
            <option value="ARCHIVED">보관됨</option>
          </select>
          <select
            value={datePreset}
            onChange={(e) => { setDatePreset(e.target.value as DatePreset); setAiTriggered(false); }}
            className="px-3 py-2 border border-[#23252A] rounded-lg text-sm"
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
                className="px-3 py-2 border border-[#23252A] rounded-lg text-xs" />
              <span className="text-[#62666D] text-xs">~</span>
              <input type="date" value={customUntil} onChange={(e) => setCustomUntil(e.target.value)} min={customSince || undefined}
                className="px-3 py-2 border border-[#23252A] rounded-lg text-xs" />
              {customSince && customUntil && customSince > customUntil && (
                <span className="text-[#EB5757] text-[10px]">시작일이 종료일보다 뒤입니다</span>
              )}
            </>
          )}
          <button
            onClick={() => { setAiTriggered(true); clearAnalysisCache(datePreset); setTimeout(() => refetchAI(), 100); }}
            disabled={loadingAI}
            className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-yellow-500 to-amber-500 text-white text-sm font-medium rounded-lg hover:from-yellow-600 hover:to-amber-600 disabled:opacity-50 transition-all"
          >
            {loadingAI ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {loadingAI ? '분석 중...' : '분석하기'}
          </button>
          <button onClick={() => { refetchOverview(); }} className="p-2 border border-[#23252A] rounded-lg hover:bg-[#141516]/5">
            <RefreshCw size={16} className={loadingOverview ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loadingOverview ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 size={32} className="animate-spin text-[#7070FF]" />
          <span className="ml-3 text-[#8A8F98]">Meta 광고 데이터 로딩 중...</span>
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
            <div className="bg-[#0F1011] border border-[#23252A] rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-[#D0D6E0] flex items-center gap-1.5">
                  <TrendingUp size={14} className="text-blue-500" />
                  {trendView === 'daily' ? '일별' : '주간'} 성과 추이
                </h3>
                <div className="flex items-center bg-[#141516] rounded-lg p-0.5">
                  <button
                    onClick={() => setTrendView('daily')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                      trendView === 'daily' ? 'bg-[#0F1011] text-[#7070FF] shadow-[0px_1px_3px_rgba(0,0,0,0.2)]' : 'text-[#8A8F98] hover:text-[#D0D6E0]'
                    }`}
                  >일별</button>
                  <button
                    onClick={() => setTrendView('weekly')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                      trendView === 'weekly' ? 'bg-[#0F1011] text-[#7070FF] shadow-[0px_1px_3px_rgba(0,0,0,0.2)]' : 'text-[#8A8F98] hover:text-[#D0D6E0]'
                    }`}
                  >주간</button>
                </div>
              </div>

              {/* 주간 비교 카드 (이번주 vs 지난주) */}
              {trendView === 'weekly' && weeklyComparison && (
                <div className="mb-4 bg-gradient-to-r from-[#08090A] to-indigo-50 rounded-xl p-4 border border-blue-100">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-bold text-[#F7F8F8]">이번주 vs 지난주 비교</h4>
                    <div className="flex items-center gap-3 text-[10px] text-[#62666D]">
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
                        <div key={i} className="bg-[#0F1011] rounded-lg p-2.5 border border-[#23252A]">
                          <p className="text-[10px] text-[#62666D] mb-1">{m.label}</p>
                          <p className="text-sm font-bold text-[#F7F8F8]">{m.fmt(m.data.cur)}</p>
                          <div className={`flex items-center gap-0.5 mt-1 ${isGood ? 'text-emerald-600' : changeAbs < 3 ? 'text-[#62666D]' : 'text-[#EB5757]'}`}>
                            {isPositive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                            <span className="text-[10px] font-semibold">{isPositive ? '+' : ''}{m.data.change.toFixed(1)}%</span>
                          </div>
                          <p className="text-[9px] text-[#62666D] mt-0.5">전주 {m.fmt(m.data.prev)}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <p className="text-[10px] text-[#8A8F98] mb-1">ROAS</p>
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
                  <p className="text-[10px] text-[#8A8F98] mb-1">지출</p>
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
                  <p className="text-[10px] text-[#8A8F98] mb-1">CTR (%)</p>
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
                  <p className="text-[10px] text-[#8A8F98] mb-1">CPC</p>
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
                  <p className="text-[10px] text-[#8A8F98] mb-1">전환값 (매출)</p>
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

          {/* ─── 추세 분석 섹션 (DB 스냅샷 기반) ─── */}
          <InsightTrendSection
            days={insightDays}
            onDaysChange={setInsightDays}
            trend={insightTrend ?? null}
            loading={insightTrendLoading}
            status={insightStatus ?? null}
            refreshing={insightRefreshMutation.isPending}
            onRefresh={() => insightRefreshMutation.mutate()}
          />

          {/* Conversion Actions */}
          {accountInsights.actions && accountInsights.actions.length > 0 && (
            <div className="bg-[#0F1011] border border-[#23252A] rounded-xl p-4">
              <h3 className="text-sm font-semibold text-[#D0D6E0] mb-3">전환 액션 요약</h3>
              <div className="flex flex-wrap gap-3">
                {accountInsights.actions.slice(0, 10).map((action: any, i: number) => (
                  <div key={i} className="bg-[#08090A] rounded-lg px-3 py-2 text-sm">
                    <span className="text-[#8A8F98]">{translateActionType(action.action_type)}</span>
                    <span className="ml-2 font-semibold text-[#F7F8F8]">{formatNum(action.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI 성과 분석 리포트 */}
          {!aiTriggered && !aiAnalysis ? (
            <div className="bg-[#0F1011] rounded-2xl border border-[#23252A] shadow-[0px_1px_3px_rgba(0,0,0,0.2)] overflow-hidden">
              <div className="bg-gradient-to-r from-[#0F1011] to-[#08090A] px-6 py-8 text-center">
                <div className="w-14 h-14 bg-gradient-to-r from-yellow-400 to-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-[0px_7px_32px_rgba(0,0,0,0.35)]">
                  <Sparkles size={28} className="text-white" />
                </div>
                <h3 className="text-lg font-bold text-[#F7F8F8] mb-2">AI 성과 분석</h3>
                <p className="text-sm text-[#8A8F98] mb-1">
                  캠페인 필터와 기간을 설정한 후 <strong>분석하기</strong> 버튼을 눌러주세요.
                </p>
                <p className="text-xs text-[#62666D]">
                  현재 설정: {aiStatusFilter === 'ALL' ? '전체' : aiStatusFilter === 'ACTIVE' ? '활성' : aiStatusFilter === 'PAUSED' ? '일시중지' : aiStatusFilter === 'PENDING_REVIEW' ? '검토중' : '보관됨'} 캠페인
                  {' · '}{datePreset === 'today' ? '오늘' : datePreset === 'yesterday' ? '어제' : datePreset === 'last_3d' ? '최근 3일' : datePreset === 'last_7d' ? '최근 7일' : datePreset === 'last_14d' ? '최근 14일' : datePreset === 'last_30d' ? '최근 30일' : datePreset === 'this_month' ? '이번달' : datePreset === 'last_month' ? '지난달' : '사용자 지정'}
                </p>
              </div>
            </div>
          ) : loadingAI ? (
            <div className="bg-[#0F1011] rounded-2xl border border-[#23252A] shadow-[0px_7px_32px_rgba(0,0,0,0.35)] overflow-hidden">
              <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600 px-6 py-5">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 bg-[#0F1011]/20 backdrop-blur-sm rounded-xl flex items-center justify-center animate-pulse">
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
                    <div className="h-4 bg-[#232326] rounded-lg w-1/4 mb-3" />
                    <div className="h-24 bg-[#141516] rounded-xl" />
                  </div>
                ))}
              </div>
            </div>
          ) : analysis && analysis.parse_error ? (
            <div className="bg-[#0F1011] rounded-2xl border border-[#F0BF00]/30 shadow-[0px_7px_32px_rgba(0,0,0,0.35)] overflow-hidden">
              <div className="bg-gradient-to-r from-yellow-500 to-amber-500 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={20} className="text-white" />
                  <h2 className="text-base font-bold text-white">AI 분석 결과 (텍스트)</h2>
                </div>
                <button onClick={() => { setAiTriggered(true); clearAnalysisCache(datePreset); setTimeout(() => refetchAI(), 100); }} className="flex items-center gap-1.5 bg-[#0F1011]/20 hover:bg-[#141516]/30 text-white text-sm font-medium px-4 py-2 rounded-xl transition-all">
                  <RefreshCw size={14} /> 재분석
                </button>
              </div>
              <div className="p-6">
                <div className="text-sm text-[#D0D6E0] whitespace-pre-wrap leading-relaxed max-h-[500px] overflow-y-auto bg-[#08090A] rounded-xl p-4 border border-[#23252A]">{analysis.raw_text}</div>
              </div>
            </div>
          ) : !analysis && aiAnalysis?.error ? (
            <div className="bg-[#0F1011] rounded-2xl border border-[#EB5757]/30 shadow-[0px_7px_32px_rgba(0,0,0,0.35)] overflow-hidden">
              <div className="bg-gradient-to-r from-red-500 to-rose-500 px-6 py-4">
                <div className="flex items-center gap-2">
                  <XCircle size={20} className="text-white" />
                  <h2 className="text-base font-bold text-white">AI 분석 오류</h2>
                </div>
              </div>
              <div className="p-6 text-center">
                <p className="text-sm text-[#8A8F98] mb-4">{aiAnalysis.error}</p>
                <button onClick={() => { setAiTriggered(true); clearAnalysisCache(datePreset); setTimeout(() => refetchAI(), 100); }} className="bg-[#EB5757] text-white px-5 py-2 rounded-xl hover:bg-[#F07070] transition-colors font-medium text-sm">
                  <RefreshCw size={14} className="inline mr-1.5" />다시 시도
                </button>
              </div>
            </div>
          ) : analysis && !analysis.parse_error ? (
            <div className="bg-[#0F1011] rounded-2xl border border-[#23252A] shadow-[0px_7px_32px_rgba(0,0,0,0.35)] overflow-hidden">
              {/* Gradient Header */}
              <div className="relative bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600 px-6 py-5">
                <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 20%, white 1px, transparent 1px)', backgroundSize: '60px 60px' }} />
                <div className="relative flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 bg-[#0F1011]/20 backdrop-blur-sm rounded-xl flex items-center justify-center ring-2 ring-white/30">
                      <Sparkles size={22} className="text-white" />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-white tracking-tight">AI 성과 분석 리포트</h2>
                      <p className="text-sm text-white/70 mt-0.5">
                        {datePreset === 'today' ? '오늘' : datePreset === 'yesterday' ? '어제' : datePreset === 'last_3d' ? '최근 3일' : datePreset === 'last_7d' ? '최근 7일' : datePreset === 'last_14d' ? '최근 14일' : datePreset === 'last_30d' ? '최근 30일' : datePreset === 'this_month' ? '이번달' : datePreset === 'last_month' ? '지난달' : '사용자 지정'} 기간 분석
                        {aiStatusFilter !== 'ALL' ? ` · ${aiStatusFilter === 'ACTIVE' ? '활성' : aiStatusFilter === 'PAUSED' ? '일시중지' : aiStatusFilter === 'PENDING_REVIEW' ? '검토중' : '보관됨'} 캠페인만` : ''}
                        {dataUpdatedAt ? ` · ${new Date(dataUpdatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 기준` : ''}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => { setAiTriggered(true); clearAnalysisCache(datePreset); setTimeout(() => refetchAI(), 100); }}
                    className="flex items-center gap-1.5 bg-[#0F1011]/20 hover:bg-[#141516]/30 backdrop-blur-sm text-white text-sm font-medium px-4 py-2 rounded-xl transition-all"
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
                      ? 'bg-gradient-to-r from-amber-50 to-yellow-50 border border-[#F0BF00]/30'
                      : 'bg-gradient-to-r from-red-50 to-rose-50 border border-[#EB5757]/30'
                }`}>
                  <div className="flex items-start gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 shadow-[0px_3px_12px_rgba(0,0,0,0.2)] ${
                      analysis.account_health === 'good' ? 'bg-emerald-500' :
                      analysis.account_health === 'warning' ? 'bg-[#F0BF00]/100' : 'bg-[#EB5757]'
                    }`}>
                      <Shield size={24} className="text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <h3 className="text-base font-bold text-[#F7F8F8]">계정 건강도</h3>
                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                          analysis.account_health === 'good' ? 'bg-emerald-100 text-emerald-700' :
                          analysis.account_health === 'warning' ? 'bg-[#F0BF00]/15 text-[#F0BF00]' :
                          'bg-[#EB5757]/15 text-[#EB5757]'
                        }`}>
                          {analysis.account_health === 'good' ? '양호' : analysis.account_health === 'warning' ? '주의' : '위험'}
                        </span>
                      </div>
                      <p className="text-sm text-[#8A8F98] leading-relaxed">{analysis.health_summary}</p>
                    </div>
                  </div>
                </div>

                {/* ② 실행 액션 아이템 (5-8건) */}
                {analysis.action_items?.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-8 h-8 bg-[#FC7840]/15 rounded-lg flex items-center justify-center">
                        <Zap size={16} className="text-[#FC7840]" />
                      </div>
                      <h3 className="text-base font-bold text-[#F7F8F8]">긴급 액션 아이템</h3>
                      <span className="text-xs bg-[#FC7840]/15 text-[#FC7840] px-2 py-0.5 rounded-full font-medium">{analysis.action_items.length}건</span>
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                      {analysis.action_items.map((item: any, i: number) => {
                        const typeLabel: Record<string, string> = { pause_ad: '광고 중지', increase_budget: '예산 증액', decrease_budget: '예산 감액', change_creative: '소재 변경', optimize_target: '타겟 최적화' };
                        const typeIcon: Record<string, string> = { pause_ad: 'text-[#EB5757]', increase_budget: 'text-emerald-500', decrease_budget: 'text-amber-500', change_creative: 'text-purple-500', optimize_target: 'text-blue-500' };
                        return (
                          <div
                            key={i}
                            className={`rounded-xl border-l-4 bg-[#0F1011] border border-[#23252A] shadow-[0px_1px_3px_rgba(0,0,0,0.2)] hover:shadow-[0px_3px_12px_rgba(0,0,0,0.2)] transition-all duration-200 p-4 ${
                              item.priority === 'high' ? 'border-l-red-500' :
                              item.priority === 'medium' ? 'border-l-amber-500' : 'border-l-blue-400'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                                    item.priority === 'high' ? 'bg-[#EB5757]/15 text-[#EB5757]' :
                                    item.priority === 'medium' ? 'bg-[#F0BF00]/15 text-[#F0BF00]' : 'bg-[#4EA7FC]/15 text-[#828FFF]'
                                  }`}>
                                    {item.priority === 'high' ? '긴급' : item.priority === 'medium' ? '중간' : '낮음'}
                                  </span>
                                  {item.type && (
                                    <span className={`text-[11px] font-medium bg-[#08090A] border border-[#23252A] px-2 py-0.5 rounded-md ${typeIcon[item.type] || 'text-[#8A8F98]'}`}>
                                      {typeLabel[item.type] || item.type}
                                    </span>
                                  )}
                                  {item.target_name && <span className="text-xs text-[#62666D] truncate max-w-[200px]">{item.target_name}</span>}
                                </div>
                                <p className="text-sm font-semibold text-[#F7F8F8] mb-1">{item.action}</p>
                                <p className="text-xs text-[#8A8F98] leading-relaxed">{item.reason}</p>
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
                                  className="flex-shrink-0 text-xs bg-[#EB5757] text-white px-3.5 py-2 rounded-xl hover:bg-[#F07070] transition-colors font-medium shadow-[0px_1px_3px_rgba(0,0,0,0.2)]"
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
                      <div className="w-8 h-8 bg-[#5E6AD2]/15 rounded-lg flex items-center justify-center">
                        <Palette size={16} className="text-[#7070FF]" />
                      </div>
                      <h3 className="text-base font-bold text-[#F7F8F8]">소재 피로도 분석</h3>
                      <span className="text-xs bg-[#5E6AD2]/15 text-[#7070FF] px-2 py-0.5 rounded-full font-medium">{analysis.creative_fatigue.length}건</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {analysis.creative_fatigue.map((item: any, i: number) => {
                        const st = (item.status || item.recommendation || '유지').toString();
                        const isReplace = st.includes('교체');
                        const isModify = st.includes('수정');
                        const statusLabel = isReplace ? '교체' : isModify ? '수정' : '유지';
                        const freq = parseFloat(item.frequency || '0');
                        return (
                          <div key={i} className="bg-[#0F1011] rounded-xl p-4 border border-[#23252A] hover:border-[#5E6AD2]/30 hover:shadow-[0px_3px_12px_rgba(0,0,0,0.2)] transition-all">
                            <div className="flex items-center justify-between mb-3">
                              <p className="text-sm font-bold text-[#F7F8F8] truncate flex-1 mr-2">{item.ad_name}</p>
                              <span className={`text-[11px] font-bold px-3 py-1 rounded-full flex-shrink-0 ${
                                isReplace ? 'bg-[#EB5757]/15 text-[#EB5757] ring-1 ring-red-200' :
                                isModify ? 'bg-[#F0BF00]/15 text-[#F0BF00] ring-1 ring-amber-200' : 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200'
                              }`}>
                                {statusLabel}
                              </span>
                            </div>
                            <div className="mb-2.5">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[11px] text-[#62666D]">노출 빈도</span>
                                <span className={`text-sm font-black ${isReplace ? 'text-[#EB5757]' : isModify ? 'text-[#F0BF00]' : 'text-emerald-600'}`}>{freq.toFixed(1)}x</span>
                              </div>
                              <div className="w-full h-3 bg-[#141516] rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${
                                    isReplace ? 'bg-gradient-to-r from-red-400 to-red-500' :
                                    isModify ? 'bg-gradient-to-r from-amber-400 to-amber-500' : 'bg-gradient-to-r from-emerald-400 to-emerald-500'
                                  }`}
                                  style={{ width: `${Math.min(freq / 4 * 100, 100)}%` }}
                                />
                              </div>
                              <div className="flex justify-between mt-0.5">
                                <span className="text-[10px] text-[#62666D]">0</span>
                                <span className="text-[10px] text-[#62666D]">4+</span>
                              </div>
                            </div>
                            {(item.detail || (st.length > 3 ? st : null)) && (
                              <p className="text-xs text-[#8A8F98] leading-relaxed">{item.detail || st}</p>
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
                      <h3 className="text-base font-bold text-[#F7F8F8]">예산 최적화 추천</h3>
                      <span className="text-xs bg-emerald-100 text-emerald-600 px-2 py-0.5 rounded-full font-medium">{analysis.budget_recommendations.length}건</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {analysis.budget_recommendations.map((item: any, i: number) => {
                        const changeStr = (item.change || '').toString();
                        const isUp = changeStr.includes('+');
                        const isDown = changeStr.includes('-');
                        return (
                          <div key={i} className="bg-[#0F1011] rounded-xl p-4 border border-[#23252A] hover:border-emerald-200 hover:shadow-[0px_3px_12px_rgba(0,0,0,0.2)] transition-all">
                            <div className="flex items-center justify-between mb-3">
                              <p className="text-sm font-bold text-[#F7F8F8] truncate flex-1 mr-2">{item.campaign_name}</p>
                              {changeStr && (
                                <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full flex-shrink-0 ${
                                  isUp ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200' :
                                  isDown ? 'bg-[#EB5757]/15 text-[#EB5757] ring-1 ring-red-200' : 'bg-[#141516] text-[#8A8F98] ring-1 ring-[#23252A]'
                                }`}>
                                  {isUp ? '↑' : isDown ? '↓' : '→'} {changeStr}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mb-3 bg-[#08090A] rounded-lg p-3">
                              <div className="flex-1 text-center">
                                <p className="text-[10px] text-[#62666D] mb-0.5">현재</p>
                                <p className="text-sm font-bold text-[#8A8F98]">{item.current_budget}</p>
                              </div>
                              <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center" style={{ background: isUp ? '#d1fae5' : isDown ? '#fee2e2' : '#f3f4f6' }}>
                                <ArrowRight size={14} className={isUp ? 'text-emerald-600' : isDown ? 'text-[#EB5757]' : 'text-[#62666D]'} />
                              </div>
                              <div className="flex-1 text-center">
                                <p className={`text-[10px] mb-0.5 ${isUp ? 'text-emerald-500' : isDown ? 'text-[#EB5757]' : 'text-blue-500'}`}>추천</p>
                                <p className={`text-sm font-bold ${isUp ? 'text-emerald-600' : isDown ? 'text-[#EB5757]' : 'text-[#7070FF]'}`}>{item.recommended_budget}</p>
                              </div>
                            </div>
                            <p className="text-xs text-[#8A8F98] leading-relaxed">{item.reason}</p>
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
                      <div className="w-8 h-8 bg-[#5E6AD2]/15 rounded-lg flex items-center justify-center">
                        <Target size={16} className="text-[#7070FF]" />
                      </div>
                      <h3 className="text-base font-bold text-[#F7F8F8]">캠페인별 성과 피드백</h3>
                      <span className="text-xs bg-[#5E6AD2]/15 text-[#7070FF] px-2 py-0.5 rounded-full font-medium">{analysis.campaign_feedback.length}건</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {analysis.campaign_feedback.map((item: any, i: number) => {
                        const gradeConfig: Record<string, { bg: string; text: string; ring: string; label: string }> = {
                          A: { bg: 'bg-emerald-100', text: 'text-emerald-700', ring: 'ring-emerald-300', label: 'A 최우수' },
                          B: { bg: 'bg-[#4EA7FC]/15', text: 'text-[#828FFF]', ring: 'ring-blue-300', label: 'B 우수' },
                          C: { bg: 'bg-[#F0BF00]/15', text: 'text-[#F0BF00]', ring: 'ring-amber-300', label: 'C 보통' },
                          D: { bg: 'bg-[#FC7840]/15', text: 'text-[#FC7840]', ring: 'ring-orange-300', label: 'D 미흡' },
                          F: { bg: 'bg-[#EB5757]/15', text: 'text-[#EB5757]', ring: 'ring-red-300', label: 'F 부진' },
                        };
                        const gc = gradeConfig[item.grade] || gradeConfig.C;
                        return (
                          <div key={i} className="bg-[#0F1011] rounded-xl p-4 border border-[#23252A] hover:border-[#5E6AD2]/30 hover:shadow-[0px_3px_12px_rgba(0,0,0,0.2)] transition-all">
                            <div className="flex items-start justify-between gap-2 mb-2.5">
                              <p className="text-sm font-bold text-[#F7F8F8] truncate flex-1">{item.campaign_name}</p>
                              <span className={`text-[11px] font-bold px-2.5 py-1 rounded-lg flex-shrink-0 ring-1 ${gc.bg} ${gc.text} ${gc.ring}`}>
                                {gc.label}
                              </span>
                            </div>
                            <p className="text-xs text-[#8A8F98] leading-relaxed mb-2.5">{item.summary}</p>
                            {item.kpi_highlight && (
                              <div className="bg-[#5E6AD2]/10 border border-indigo-100 rounded-lg px-3 py-2">
                                <p className="text-[11px] font-medium text-[#828FFF]">{item.kpi_highlight}</p>
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
                  <div className="bg-gradient-to-br from-[#08090A] to-indigo-50 rounded-xl p-5 border border-blue-100">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-8 h-8 bg-[#4EA7FC]/15 rounded-lg flex items-center justify-center">
                        <Lightbulb size={16} className="text-[#7070FF]" />
                      </div>
                      <h3 className="text-base font-bold text-[#F7F8F8]">우선 실행 사항</h3>
                    </div>
                    <div className="space-y-3">
                      {analysis.next_steps.map((step: string, i: number) => (
                        <div key={i} className="flex items-start gap-3">
                          <div className="w-7 h-7 bg-gradient-to-br from-blue-600 to-indigo-600 text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5 shadow-[0px_1px_3px_rgba(0,0,0,0.2)]">
                            {i + 1}
                          </div>
                          <div className="flex-1 bg-[#0F1011]/80 backdrop-blur-sm rounded-lg px-4 py-3 border border-blue-100 shadow-[0px_1px_3px_rgba(0,0,0,0.2)]">
                            <p className="text-sm text-[#F7F8F8] leading-relaxed">{step}</p>
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
          <div className="bg-[#0F1011] border border-[#23252A] rounded-xl">
            <div className="px-5 py-4 border-b border-[#23252A] flex items-center justify-between">
              <h3 className="font-semibold text-[#F7F8F8] flex items-center gap-2">
                <Layers size={18} /> 캠페인 목록 ({campaigns.length}개 / 전체 {allCampaigns.length}개)
              </h3>
              <div className="flex items-center gap-2">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as CampaignStatusFilter)}
                  className="px-2 py-1.5 border border-[#23252A] rounded-lg text-xs"
                >
                  <option value="ALL">전체</option>
                  <option value="ACTIVE">활성</option>
                  <option value="PAUSED">일시중지</option>
                  <option value="PENDING_REVIEW">검토중</option>
                  <option value="ARCHIVED">보관됨</option>
                </select>
                <button
                  onClick={() => { refetchOverview(); toast.success('새로고침 중...'); }}
                  className="p-1.5 border border-[#23252A] rounded-lg hover:bg-[#141516]/5 text-[#8A8F98]"
                  title="Meta에서 다시 가져오기"
                >
                  <RefreshCw size={14} className={loadingOverview ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
            <div className="divide-y divide-[#23252A] min-w-[900px]">
              {campaigns.map((camp: any) => {
                const isExpanded = expandedCampaign === camp.id;
                const ins = camp.insights;
                const es = camp.effective_status || camp.status;
                const statusKo = es === 'ACTIVE' ? '활성' : es === 'PAUSED' ? '일시중지' : es === 'CAMPAIGN_PAUSED' ? '캠페인 중지' : es === 'PENDING_REVIEW' || es === 'IN_REVIEW' ? '검토중' : es === 'ARCHIVED' ? '보관됨' : es;
                const statusColor = es === 'ACTIVE' ? 'bg-[#27A644]/15 text-[#27A644]' : es === 'PAUSED' || es === 'CAMPAIGN_PAUSED' ? 'bg-[#F0BF00]/15 text-[#F0BF00]' : es === 'PENDING_REVIEW' || es === 'IN_REVIEW' ? 'bg-[#4EA7FC]/15 text-[#828FFF]' : es === 'ARCHIVED' ? 'bg-[#232326] text-[#8A8F98]' : 'bg-[#141516] text-[#8A8F98]';

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
                    <div className="px-5 py-4 hover:bg-[#141516]/5 cursor-pointer flex items-center gap-3"
                      onClick={() => setExpandedCampaign(isExpanded ? null : camp.id)}>
                      {isExpanded ? <ChevronDown size={16} className="flex-shrink-0" /> : <ChevronRight size={16} className="flex-shrink-0" />}
                      <div className="flex-1 min-w-0" style={{ maxWidth: '220px' }}>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-semibold text-[#F7F8F8] truncate">{camp.name}</h4>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 font-medium ${statusColor}`}>{statusKo}</span>
                        </div>
                        <p className="text-[10px] text-[#62666D] mt-0.5 truncate">{camp.objective}</p>
                      </div>
                      {ins && (
                        <div className="flex items-center gap-3 text-xs flex-shrink-0">
                          <div className="text-right w-[70px]"><p className="text-[10px] text-[#62666D]">예산</p><p className="font-semibold text-[11px]">{campBudget}</p></div>
                          <div className="text-right w-[65px]"><p className="text-[10px] text-[#62666D]">지출</p><p className="font-semibold text-[11px]">{formatSpend(ins.spend)}</p></div>
                          <div className="text-right w-[50px]"><p className="text-[10px] text-[#62666D]">노출</p><p className="font-semibold text-[11px]">{formatNum(ins.impressions)}</p></div>
                          <div className="text-right w-[45px]"><p className="text-[10px] text-[#62666D]">클릭</p><p className="font-semibold text-[11px]">{formatNum(ins.clicks)}</p></div>
                          <div className="text-right w-[45px]"><p className="text-[10px] text-[#62666D]">CTR</p><p className="font-semibold text-[11px]">{parseFloat(ins.ctr || '0').toFixed(2)}%</p></div>
                          <div className="text-right w-[55px]"><p className="text-[10px] text-[#62666D]">CPC</p><p className="font-semibold text-[11px]">{formatCPC(ins.cpc)}</p></div>
                          <div className="text-right w-[55px]"><p className="text-[10px] text-[#62666D]">CPM</p><p className="font-semibold text-[11px]">{campCPM}</p></div>
                          <div className="text-right w-[45px]"><p className="text-[10px] text-[#62666D]">ROAS</p><p className={`font-semibold text-[11px] ${ins.roas && ins.roas >= 1 ? 'text-[#27A644]' : ins.roas ? 'text-[#EB5757]' : 'text-[#62666D]'}`}>{formatROAS(ins.roas)}</p></div>
                          <div className="text-right w-[70px]"><p className="text-[10px] text-[#62666D]">구매전환값</p><p className="font-semibold text-[11px]">{purchaseValue ? formatCurrency(parseFloat(purchaseValue)) : '-'}</p></div>
                          <div className="text-right w-[50px]"><p className="text-[10px] text-[#62666D]">조회수</p><p className="font-semibold text-[11px]">{contentViews ? formatNum(contentViews) : '-'}</p></div>
                          <div className="text-right w-[60px]"><p className="text-[10px] text-[#62666D]">결과당비용</p><p className="font-semibold text-[11px]">{costPerResult ? formatCurrency(parseFloat(costPerResult)) : '-'}</p></div>
                          <div className="text-right w-[40px]"><p className="text-[10px] text-[#62666D]">빈도</p><p className={`font-semibold text-[11px] ${parseFloat(campFrequency) > 2.3 ? 'text-[#EB5757]' : ''}`}>{campFrequency}</p></div>
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {editingBudget?.id === camp.id ? (
                          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <span className="text-[10px] text-[#62666D]">일예산 ₩</span>
                            <input type="number" value={budgetInput} onChange={(e) => setBudgetInput(e.target.value)} autoFocus
                              className="w-20 px-1.5 py-1 border rounded text-xs" placeholder="원" />
                            <button onClick={() => budgetInput && budgetMutation.mutate({ id: camp.id, type: 'campaign', budget: Number(budgetInput) })}
                              className="text-[#27A644] hover:text-[#27A644]"><Check size={14} /></button>
                            <button onClick={() => setEditingBudget(null)} className="text-[#62666D] hover:text-[#D0D6E0]"><X size={14} /></button>
                          </div>
                        ) : (
                          <button onClick={(e) => { e.stopPropagation(); startBudgetEdit(camp.id, 'campaign', camp.daily_budget); }}
                            className="p-2 rounded-lg bg-[#4EA7FC]/10 text-[#7070FF] hover:bg-[#4EA7FC]/15" title="예산 변경">
                            <Edit3 size={14} />
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleStatus(camp.id, 'campaign', es); }}
                          disabled={togglingId === camp.id || es === 'PENDING_REVIEW' || es === 'IN_REVIEW'}
                          className={`p-2 rounded-lg transition-colors ${
                            togglingId === camp.id ? 'bg-[#141516] text-[#62666D] cursor-wait' :
                            es === 'PENDING_REVIEW' || es === 'IN_REVIEW' ? 'bg-[#141516] text-[#62666D] cursor-not-allowed' :
                            es === 'ACTIVE' ? 'bg-[#F0BF00]/15 text-[#F0BF00] hover:bg-yellow-200' : 'bg-[#27A644]/15 text-[#27A644] hover:bg-green-200'
                          }`}
                          title={es === 'PENDING_REVIEW' || es === 'IN_REVIEW' ? '검토 중에는 변경 불가' : es === 'ACTIVE' ? '일시중지' : '활성화'}>
                          {togglingId === camp.id ? <Loader2 size={14} className="animate-spin" /> : es === 'ACTIVE' ? <Pause size={14} /> : <Play size={14} />}
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="bg-[#08090A] px-5 py-4 border-t border-[#23252A]">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-semibold text-[#8A8F98] uppercase">광고세트 & 광고</span>
                          <div className="flex items-center gap-2">
                            <button onClick={() => setFeedbackExpanded(feedbackExpanded === camp.id ? null : camp.id)}
                              className="text-xs bg-purple-600 text-white px-3 py-1 rounded-lg hover:bg-purple-700 flex items-center gap-1">
                              <Activity size={12} />
                              {feedbackExpanded === camp.id ? '성과 피드백 닫기' : '성과 피드백'}
                            </button>
                            <button onClick={() => setSelectedCampaignForDeep(selectedCampaignForDeep === camp.id ? null : camp.id)}
                              className="text-xs bg-[#5E6AD2] text-white px-3 py-1 rounded-lg hover:bg-[#828FFF]">
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
                              <div className="flex items-center justify-between text-[10px] text-[#8A8F98] mb-1">
                                <span>예산 소진율</span>
                                <span>{pct.toFixed(1)}% ({formatCurrency(spent)} / {formatCurrency(budget)})</span>
                              </div>
                              <div className="w-full h-2 bg-[#232326] rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all ${pct > 90 ? 'bg-[#EB5757]' : pct > 70 ? 'bg-[#F0BF00]' : 'bg-[#27A644]'}`} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })()}

                        {loadingAdsets && expandedCampaign === camp.id ? (
                          <div className="flex items-center gap-2 text-sm text-[#62666D] py-4">
                            <Loader2 size={14} className="animate-spin" /> 광고세트 로딩 중...
                          </div>
                        ) : adsetsData?.error && expandedCampaign === camp.id ? (
                          <div className="py-4 text-center">
                            <p className="text-sm text-[#EB5757] mb-2">광고세트를 불러오지 못했습니다.</p>
                            <p className="text-xs text-[#62666D] mb-3">{typeof adsetsData.error === 'string' ? adsetsData.error : 'API 오류'}</p>
                            <button onClick={() => queryClient.invalidateQueries({ queryKey: ['campaign-adsets', camp.id] })}
                              className="text-xs bg-[#EB5757] text-white px-3 py-1.5 rounded-lg hover:bg-[#F07070] inline-flex items-center gap-1">
                              <RefreshCw size={12} /> 다시 시도
                            </button>
                          </div>
                        ) : (adsetsData?.adsets || []).length > 0 && expandedCampaign === camp.id ? (
                          <div className="space-y-3">
                            {(adsetsData.adsets as any[]).map((adset: any) => {
                              const adsetStatus = adset.effective_status || adset.status;
                              const adsetStatusKo = adsetStatus === 'ACTIVE' ? '활성' : adsetStatus === 'PAUSED' ? '중지' : adsetStatus === 'PENDING_REVIEW' ? '검토중' : adsetStatus;
                              const adsetStatusColor = adsetStatus === 'ACTIVE' ? 'bg-[#27A644]/15 text-[#27A644]' : adsetStatus === 'PENDING_REVIEW' ? 'bg-[#4EA7FC]/15 text-[#828FFF]' : 'bg-[#141516] text-[#8A8F98]';
                              return (
                                <div key={adset.id} className="bg-[#0F1011] rounded-lg border border-[#23252A] p-3">
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                      <Users size={14} className="text-purple-500" />
                                      <span className="text-sm font-medium">{adset.name}</span>
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${adsetStatusColor}`}>{adsetStatusKo}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {editingBudget?.id === adset.id ? (
                                        <div className="flex items-center gap-1">
                                          <span className="text-xs text-[#62666D]">일예산 ₩</span>
                                          <input type="number" value={budgetInput} onChange={(e) => setBudgetInput(e.target.value)} autoFocus
                                            className="w-20 px-1.5 py-0.5 border rounded text-xs" placeholder="원" />
                                          <button onClick={() => budgetInput && budgetMutation.mutate({ id: adset.id, type: 'adset', budget: Number(budgetInput) })}
                                            className="text-[#27A644] hover:text-[#27A644]"><Check size={13} /></button>
                                          <button onClick={() => setEditingBudget(null)} className="text-[#62666D] hover:text-[#D0D6E0]"><X size={13} /></button>
                                        </div>
                                      ) : (
                                        <>
                                          {adset.daily_budget && <span className="text-xs text-[#62666D]">일예산: {formatCurrency(Number(adset.daily_budget))}</span>}
                                          <button onClick={(e) => { e.stopPropagation(); startBudgetEdit(adset.id, 'adset', adset.daily_budget); }}
                                            className="text-[#62666D] hover:text-[#7070FF]" title="예산 변경"><Edit3 size={12} /></button>
                                        </>
                                      )}
                                      <button
                                        onClick={() => toggleStatus(adset.id, 'adset', adsetStatus)}
                                        disabled={togglingId === adset.id}
                                        className={`text-xs px-2 py-1 rounded border hover:bg-[#141516]/5 ${togglingId === adset.id ? 'opacity-50 cursor-wait' : ''}`}>
                                        {togglingId === adset.id ? <Loader2 size={12} className="animate-spin inline" /> : adsetStatus === 'ACTIVE' ? '중지' : '활성화'}
                                      </button>
                                    </div>
                                  </div>
                                  {adset.targeting && (
                                    <div className="text-xs text-[#8A8F98] mb-2">
                                      타겟: {adset.targeting.age_min || '?'}-{adset.targeting.age_max || '?'}세
                                      {adset.targeting.genders && `, ${adset.targeting.genders.map((g: number) => g === 1 ? '남' : g === 2 ? '여' : '전체').join('/')}`}
                                      {adset.targeting.flexible_spec?.[0]?.interests &&
                                        ` | 관심사: ${adset.targeting.flexible_spec[0].interests.slice(0, 3).map((i: any) => i.name).join(', ')}`}
                                    </div>
                                  )}
                                  {adset.insights && (
                                    <div className="flex flex-wrap gap-3 text-xs text-[#8A8F98] mb-2">
                                      <span>지출: {formatSpend(adset.insights.spend)}</span>
                                      <span>클릭: {adset.insights.clicks}</span>
                                      <span>CTR: {parseFloat(adset.insights.ctr || '0').toFixed(2)}%</span>
                                      <span>CPC: {formatCPC(adset.insights.cpc)}</span>
                                      <span>CPM: {formatCurrency(parseFloat(adset.insights.cpm || '0'))}</span>
                                      <span className={adset.insights.roas && adset.insights.roas >= 1 ? 'text-[#27A644] font-medium' : adset.insights.roas ? 'text-[#EB5757] font-medium' : ''}>ROAS: {formatROAS(adset.insights.roas)}</span>
                                    </div>
                                  )}
                                  {adset.ads?.length > 0 && (
                                    <div className="mt-2 space-y-1">
                                      {adset.ads.map((ad: any) => {
                                        const adStatus = ad.effective_status || ad.status;
                                        const adStatusKo = adStatus === 'ACTIVE' ? '활성' : adStatus === 'PAUSED' ? '중지' : adStatus;
                                        const adStatusDot = adStatus === 'ACTIVE' ? 'bg-[#27A644]' : adStatus === 'PAUSED' ? 'bg-[#F0BF00]' : 'bg-[#28282C]';
                                        return (
                                          <div key={ad.id} className="flex items-center justify-between bg-[#08090A] rounded p-2">
                                            <div className="flex items-center gap-2">
                                              <div className={`w-1.5 h-1.5 rounded-full ${adStatusDot}`} />
                                              <span className="text-xs text-[#D0D6E0]">{ad.name}</span>
                                              <span className={`text-[10px] px-1 py-0.5 rounded ${adStatus === 'ACTIVE' ? 'bg-[#27A644]/10 text-[#27A644]' : 'bg-[#141516] text-[#62666D]'}`}>{adStatusKo}</span>
                                            </div>
                                            <div className="flex items-center gap-3">
                                              {ad.insights && <span className="text-xs text-[#8A8F98]">{formatSpend(ad.insights.spend)} | CPC {formatCPC(ad.insights.cpc)} | CTR {parseFloat(ad.insights.ctr || '0').toFixed(2)}% | <span className={ad.insights.roas && ad.insights.roas >= 1 ? 'text-[#27A644]' : ad.insights.roas ? 'text-[#EB5757]' : ''}>ROAS {formatROAS(ad.insights.roas)}</span></span>}
                                              <button
                                                onClick={() => toggleStatus(ad.id, 'ad', adStatus)}
                                                disabled={togglingId === ad.id}
                                                className={`text-xs px-2 py-0.5 rounded border hover:bg-[#141516] ${togglingId === ad.id ? 'opacity-50 cursor-wait' : ''}`}>
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
                        ) : expandedCampaign === camp.id ? <p className="text-sm text-[#62666D]">광고세트가 없습니다.</p> : null}

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
                          <div className="mt-4 bg-[#0F1011] rounded-lg border border-[#5E6AD2]/30 p-4">
                            <h4 className="text-sm font-semibold text-blue-900 mb-3">심층 분석</h4>
                            {deepData.demographics?.length > 0 && (
                              <div className="mb-4">
                                <p className="text-xs font-semibold text-[#8A8F98] mb-2">연령 x 성별 ROAS 히트맵</p>
                                {(() => {
                                  const ageGroups = Array.from(new Set(deepData.demographics.map((d: any) => d.age))).sort() as string[];
                                  const getVal = (age: string, gender: string) => {
                                    const row = deepData.demographics.find((d: any) => d.age === age && d.gender === gender);
                                    return row ? parseFloat(row.roas || row.ctr || '0') : 0;
                                  };
                                  const allVals = ageGroups.flatMap((age: string) => [getVal(age, 'female'), getVal(age, 'male')]).filter(v => v > 0);
                                  const maxVal = allVals.length > 0 ? Math.max(...allVals) : 1;
                                  const heatColor = (val: number) => {
                                    if (val === 0) return '#1a1b1e';
                                    const intensity = Math.min(val / maxVal, 1);
                                    if (intensity > 0.7) return '#1d4ed8';
                                    if (intensity > 0.4) return '#3b82f6';
                                    if (intensity > 0.2) return '#93c5fd';
                                    return '#dbeafe';
                                  };
                                  return (
                                    <div className="overflow-x-auto">
                                      <table className="text-[10px] w-full">
                                        <thead>
                                          <tr>
                                            <th className="text-left py-1 px-2 text-[#62666D] font-medium">연령대</th>
                                            <th className="text-center py-1 px-2 text-[#62666D] font-medium">여성</th>
                                            <th className="text-center py-1 px-2 text-[#62666D] font-medium">남성</th>
                                            <th className="text-center py-1 px-2 text-[#62666D] font-medium">전체</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {ageGroups.map((age: string) => {
                                            const female = getVal(age, 'female');
                                            const male = getVal(age, 'male');
                                            const total = (female + male) / (female > 0 && male > 0 ? 2 : 1);
                                            return (
                                              <tr key={age} className="border-t border-[#23252A]">
                                                <td className="py-1.5 px-2 font-medium text-[#D0D6E0]">{age}</td>
                                                {[female, male, total].map((val, ci) => (
                                                  <td key={ci} className="py-1.5 px-2 text-center">
                                                    <span
                                                      className="inline-block px-2 py-0.5 rounded font-semibold"
                                                      style={{ backgroundColor: heatColor(val), color: val > maxVal * 0.4 ? '#fff' : '#374151' }}
                                                    >
                                                      {val > 0 ? val.toFixed(2) : '-'}
                                                    </span>
                                                  </td>
                                                ))}
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                      <p className="text-[9px] text-[#62666D] mt-1">값: ROAS (없으면 CTR%). 색상 진할수록 고성과.</p>
                                    </div>
                                  );
                                })()}
                              </div>
                            )}
                            {deepData.placements?.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-[#8A8F98] mb-2">게재 위치별 성과</p>
                                <div className="space-y-1">
                                  {deepData.placements.slice(0, 6).map((p: any, i: number) => (
                                    <div key={i} className="flex justify-between text-xs bg-[#08090A] rounded p-1.5">
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
                  <p className="text-[#62666D]">{statusFilter !== 'ALL' ? `${statusFilter === 'ACTIVE' ? '활성' : statusFilter === 'PAUSED' ? '일시중지' : statusFilter === 'PENDING_REVIEW' ? '검토중' : '보관됨'} 캠페인이 없습니다.` : '캠페인이 없습니다.'}</p>
                  {overview?.campaigns_error && (
                    <p className="text-xs text-red-400 mt-2">Meta API 오류: {typeof overview.campaigns_error === 'string' ? overview.campaigns_error.slice(0, 100) : 'API 연결 실패'}</p>
                  )}
                </div>
              )}
            </div>
            </div>
          </div>

          {/* ═══ 캠페인별 ROAS 비교 차트 ═══ */}
          {(() => {
            const campaignChartData = campaigns
              .filter((c: any) => c.insights?.roas != null && parseFloat(c.insights.roas) > 0)
              .map((c: any) => ({
                name: c.name.length > 20 ? c.name.slice(0, 20) + '…' : c.name,
                roas: parseFloat(c.insights.roas),
              }))
              .sort((a: any, b: any) => b.roas - a.roas)
              .slice(0, 10);
            if (campaignChartData.length === 0) return null;
            return (
              <div className="bg-[#0F1011] border border-[#23252A] rounded-xl p-4">
                <h3 className="text-sm font-semibold text-[#D0D6E0] mb-3 flex items-center gap-1.5">
                  <BarChart3 size={14} className="text-purple-500" />
                  캠페인별 ROAS 비교
                </h3>
                <ResponsiveContainer width="100%" height={Math.max(200, campaignChartData.length * 40)}>
                  <BarChart data={campaignChartData} layout="vertical" margin={{ left: 10, right: 20, top: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2d35" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} stroke="#2a2d35" tickLine={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#d1d5db' }} width={130} stroke="#2a2d35" tickLine={false} />
                    <RechartsTooltip
                      contentStyle={{ fontSize: '11px', borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', background: '#1f2937', color: '#f9fafb' }}
                      formatter={(v: number) => [`${v.toFixed(2)}x`, 'ROAS']}
                    />
                    <Bar dataKey="roas" fill="#8b5cf6" radius={[0, 4, 4, 0]} barSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            );
          })()}

          {/* ═══ 전환 퍼널 ═══ */}
          {(() => {
            const totalImpressions = parseFloat(accountInsights.impressions || '0');
            const totalClicks = parseFloat(accountInsights.clicks || '0');
            const totalAddToCart = parseFloat(
              accountInsights.actions?.find((a: any) => a.action_type === 'add_to_cart' || a.action_type === 'omni_add_to_cart')?.value || '0'
            );
            const totalPurchases = parseFloat(
              accountInsights.actions?.find((a: any) => a.action_type === 'purchase' || a.action_type === 'omni_purchase')?.value || '0'
            );
            if (totalImpressions === 0) return null;
            return (
              <div className="bg-[#0F1011] border border-[#23252A] rounded-xl p-4">
                <h3 className="text-sm font-semibold text-[#D0D6E0] mb-3 flex items-center gap-1.5">
                  <Activity size={14} className="text-blue-500" />
                  전환 퍼널
                </h3>
                <div className="space-y-2">
                  {[
                    { stage: '노출', value: totalImpressions, color: '#93c5fd' },
                    { stage: '클릭', value: totalClicks, color: '#60a5fa' },
                    { stage: '장바구니', value: totalAddToCart, color: '#3b82f6' },
                    { stage: '구매', value: totalPurchases, color: '#1d4ed8' },
                  ].map((item, idx) => (
                    <div key={idx} className="flex items-center gap-3">
                      <span className="text-xs text-[#8A8F98] w-16 flex-shrink-0">{item.stage}</span>
                      <div className="flex-1 h-8 bg-[#141516] rounded-lg overflow-hidden relative">
                        <div
                          className="h-full rounded-lg transition-all duration-500"
                          style={{ width: `${Math.max((item.value / totalImpressions) * 100, item.value > 0 ? 1 : 0)}%`, backgroundColor: item.color }}
                        />
                        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-white drop-shadow">
                          {item.value > 0
                            ? `${item.value.toLocaleString()} (${((item.value / totalImpressions) * 100).toFixed(2)}%)`
                            : '데이터 없음'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

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
  const colors: Record<string, string> = { blue: 'bg-[#4EA7FC]/10 text-[#7070FF]', purple: 'bg-[#5E6AD2]/10 text-[#7070FF]', green: 'bg-[#27A644]/10 text-[#27A644]', orange: 'bg-[#FC7840]/10 text-[#FC7840]' };
  return (
    <div className="bg-[#0F1011] border border-[#23252A] rounded-xl p-3">
      <div className="flex items-center gap-1.5 mb-1"><div className={`p-1 rounded-lg ${colors[color]}`}>{icon}</div><span className="text-xs text-[#8A8F98]">{label}</span></div>
      <p className="text-lg font-bold text-[#F7F8F8]">{value}</p>
      {sub && <p className="text-xs text-[#62666D]">{sub}</p>}
    </div>
  );
}

const MINI_CHART_COLOR_MAP: Record<string, { stroke: string; gradientId: string }> = {
  blue:   { stroke: '#3b82f6', gradientId: 'grad-blue' },
  purple: { stroke: '#8b5cf6', gradientId: 'grad-purple' },
  green:  { stroke: '#10b981', gradientId: 'grad-green' },
  orange: { stroke: '#f97316', gradientId: 'grad-orange' },
};

function MiniLineChart({ data, color, formatValue }: {
  data: { label: string; value: number }[];
  color: string;
  formatValue: (v: number) => string;
}) {
  if (data.length === 0) return null;

  const c = MINI_CHART_COLOR_MAP[color] || MINI_CHART_COLOR_MAP.blue;
  const chartData = data.map(d => ({ label: d.label, value: d.value }));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 16, left: 44 }}>
        <defs>
          <linearGradient id={c.gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c.stroke} stopOpacity={0.25} />
            <stop offset="100%" stopColor={c.stroke} stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a2d35" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 9, fill: '#9ca3af' }}
          stroke="#2a2d35"
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 9, fill: '#9ca3af' }}
          stroke="#2a2d35"
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => {
            if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
            if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
            return Number.isInteger(v) ? String(v) : v.toFixed(1);
          }}
          width={40}
        />
        <RechartsTooltip
          contentStyle={{
            fontSize: '11px',
            padding: '4px 8px',
            borderRadius: '6px',
            border: 'none',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            background: '#1f2937',
            color: '#f9fafb',
          }}
          formatter={(v: number) => [formatValue(v), '']}
          labelFormatter={(l) => String(l)}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={c.stroke}
          strokeWidth={1.5}
          fill={`url(#${c.gradientId})`}
          dot={false}
          activeDot={{ r: 4, fill: c.stroke, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── Insight Trend Section (DB 스냅샷 기반 추세 차트) ───

/** MM/DD 포맷으로 날짜 문자열 변환 */
function fmtDateMMDD(dateStr: string): string {
  // dateStr: "2026-06-12"
  return dateStr.slice(5).replace('-', '/');
}

/** 금액 천단위 콤마 + 원 */
function fmtKRW(v: number): string {
  return `${Math.round(v).toLocaleString('ko-KR')}원`;
}

/** as_of ISO timestamp를 한국어 날짜시간으로 변환 */
function fmtAsOf(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

// 캠페인별 차트에 사용할 색상 팔레트 (최대 5개)
const CAMPAIGN_COLORS = ['#7070FF', '#10b981', '#f97316', '#4EA7FC', '#F0BF00'];

interface InsightTrendSectionProps {
  days: 7 | 30 | 90;
  onDaysChange: (d: 7 | 30 | 90) => void;
  trend: import('@/lib/api').InsightTrendResponse | null;
  loading: boolean;
  status: import('@/lib/api').InsightStatusResponse | null;
  refreshing: boolean;
  onRefresh: () => void;
}

function InsightTrendSection({
  days,
  onDaysChange,
  trend,
  loading,
  status,
  refreshing,
  onRefresh,
}: InsightTrendSectionProps) {
  const accountSeries: InsightTrendPoint[] = trend?.account?.series ?? [];
  const campaigns: InsightTrendCampaign[] = trend?.campaigns ?? [];
  // 상위 5개 캠페인 (지출 합계 기준 내림차순)
  const top5Campaigns = [...campaigns]
    .sort((a, b) => {
      const sumA = a.series.reduce((s, p) => s + p.spend, 0);
      const sumB = b.series.reduce((s, p) => s + p.spend, 0);
      return sumB - sumA;
    })
    .slice(0, 5);

  // 캠페인별 멀티라인용 데이터 병합: date → { date: string, [campaign_name]: number }
  const campaignChartData = (() => {
    if (top5Campaigns.length === 0) return [] as Array<{ date: string; [k: string]: string | number }>;
    const dateMap: Record<string, { date: string; [k: string]: string | number }> = {};
    top5Campaigns.forEach((camp) => {
      camp.series.forEach((pt) => {
        if (!dateMap[pt.date]) dateMap[pt.date] = { date: pt.date };
        dateMap[pt.date][camp.campaign_name] = pt.spend;
      });
    });
    return Object.values(dateMap).sort((a, b) => (a.date as string).localeCompare(b.date as string));
  })();

  const tooltipStyle = {
    fontSize: '11px',
    padding: '6px 10px',
    borderRadius: '8px',
    border: 'none',
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    background: '#1f2937',
    color: '#f9fafb',
  };

  const axisTickProps = { fontSize: 9, fill: '#9ca3af' };

  const hasData = accountSeries.length > 0;

  return (
    <div className="bg-[#0F1011] border border-[#23252A] rounded-xl p-4 space-y-5">
      {/* 섹션 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-[#7070FF]" />
          <h3 className="text-sm font-semibold text-[#D0D6E0]">추세 분석</h3>
          {status?.as_of && (
            <span className="text-[10px] text-[#62666D]">
              데이터 기준: {fmtAsOf(status.as_of)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* 기간 선택 토글 */}
          <div className="flex items-center bg-[#141516] rounded-lg p-0.5">
            {([7, 30, 90] as const).map((d) => (
              <button
                key={d}
                onClick={() => onDaysChange(d)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  days === d
                    ? 'bg-[#0F1011] text-[#7070FF] shadow-[0px_1px_3px_rgba(0,0,0,0.2)]'
                    : 'text-[#8A8F98] hover:text-[#D0D6E0]'
                }`}
              >
                {d}일
              </button>
            ))}
          </div>
          {/* 즉시 수집 버튼 */}
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] hover:bg-[#141516] disabled:opacity-50 transition-all"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? '수집 중...' : '지금 새로고침'}
          </button>
        </div>
      </div>

      {/* 토큰 만료 경고 배너 */}
      {status?.token_expired && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-[#EB5757]/10 border border-[#EB5757]/30 rounded-lg">
          <AlertTriangle size={14} className="text-[#EB5757] flex-shrink-0" />
          <p className="text-xs text-[#EB5757]">
            Meta 토큰이 만료되었습니다. 우측 상단 메뉴에서 Meta 계정을 다시 연결해주세요.
          </p>
        </div>
      )}

      {/* 로딩 상태 */}
      {loading && (
        <div className="flex items-center justify-center h-40">
          <Loader2 size={28} className="animate-spin text-[#7070FF]" />
          <span className="ml-3 text-sm text-[#8A8F98]">추세 데이터 로딩 중...</span>
        </div>
      )}

      {/* 데이터 없음 빈 상태 */}
      {!loading && !hasData && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <BarChart3 size={36} className="text-[#23252A] mb-3" />
          <p className="text-sm text-[#8A8F98] mb-1">아직 수집된 데이터가 없습니다.</p>
          <p className="text-xs text-[#62666D] mb-4">
            <button
              onClick={onRefresh}
              disabled={refreshing}
              className="text-[#7070FF] underline underline-offset-2 hover:text-[#828FFF] disabled:opacity-50"
            >
              지금 새로고침
            </button>
            으로 첫 수집을 시작하세요.
          </p>
          {status?.last_error && (
            <p className="text-[10px] text-[#EB5757] max-w-sm">마지막 오류: {status.last_error}</p>
          )}
        </div>
      )}

      {/* 차트 영역 */}
      {!loading && hasData && (
        <div className="space-y-6">
          {/* 차트 1: 일별 지출(Bar) + ROAS(Line) 복합 — 이중 Y축 */}
          <div>
            <p className="text-[11px] font-medium text-[#8A8F98] mb-2">일별 지출 &amp; ROAS</p>
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart
                data={accountSeries.map((p) => ({
                  date: fmtDateMMDD(p.date),
                  spend: p.spend,
                  roas: p.roas,
                }))}
                margin={{ top: 8, right: 48, bottom: 4, left: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2d35" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={axisTickProps}
                  stroke="#2a2d35"
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                {/* 왼쪽 Y축: 지출(원) */}
                <YAxis
                  yAxisId="spend"
                  orientation="left"
                  tick={axisTickProps}
                  stroke="#2a2d35"
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  tickFormatter={(v: number) => {
                    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
                    if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
                    return String(v);
                  }}
                />
                {/* 오른쪽 Y축: ROAS */}
                <YAxis
                  yAxisId="roas"
                  orientation="right"
                  tick={axisTickProps}
                  stroke="#2a2d35"
                  tickLine={false}
                  axisLine={false}
                  width={36}
                  tickFormatter={(v: number) => v.toFixed(1) + 'x'}
                />
                <RechartsTooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: number, name: string) =>
                    name === 'spend'
                      ? [fmtKRW(v), '지출']
                      : [v.toFixed(2) + 'x', 'ROAS']
                  }
                  labelFormatter={(l) => String(l)}
                />
                <Legend
                  formatter={(value) => (value === 'spend' ? '지출' : 'ROAS')}
                  wrapperStyle={{ fontSize: '10px', color: '#9ca3af' }}
                />
                <Bar
                  yAxisId="spend"
                  dataKey="spend"
                  fill="#4EA7FC"
                  opacity={0.75}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={24}
                />
                <Line
                  yAxisId="roas"
                  type="monotone"
                  dataKey="roas"
                  stroke="#7070FF"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: '#7070FF', strokeWidth: 0 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* 차트 2: 일별 CPA 추이 (LineChart) */}
          <div>
            <p className="text-[11px] font-medium text-[#8A8F98] mb-2">일별 CPA 추이 (전환당 비용)</p>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart
                data={accountSeries
                  .filter((p) => p.cpa > 0)
                  .map((p) => ({
                    date: fmtDateMMDD(p.date),
                    cpa: p.cpa,
                  }))}
                margin={{ top: 8, right: 20, bottom: 4, left: 4 }}
              >
                <defs>
                  <linearGradient id="grad-cpa" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FC7840" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#FC7840" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2d35" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={axisTickProps}
                  stroke="#2a2d35"
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={axisTickProps}
                  stroke="#2a2d35"
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  tickFormatter={(v: number) => {
                    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
                    if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
                    return String(v);
                  }}
                />
                <RechartsTooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: number) => [fmtKRW(v), 'CPA']}
                  labelFormatter={(l) => String(l)}
                />
                <Line
                  type="monotone"
                  dataKey="cpa"
                  stroke="#FC7840"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: '#FC7840', strokeWidth: 0 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* 차트 3: 캠페인별 일별 지출 비교 (멀티 라인, 상위 5개) */}
          {top5Campaigns.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-[#8A8F98] mb-2">
                캠페인별 일별 지출 비교
                <span className="ml-1 text-[#62666D]">(지출 상위 {top5Campaigns.length}개)</span>
              </p>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart
                  data={campaignChartData.map((row) => ({
                    ...row,
                    date: fmtDateMMDD(String(row.date)),
                  }))}
                  margin={{ top: 8, right: 20, bottom: 4, left: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2d35" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={axisTickProps}
                    stroke="#2a2d35"
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={axisTickProps}
                    stroke="#2a2d35"
                    tickLine={false}
                    axisLine={false}
                    width={52}
                    tickFormatter={(v: number) => {
                      if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
                      if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
                      return String(v);
                    }}
                  />
                  <RechartsTooltip
                    contentStyle={tooltipStyle}
                    formatter={(v: number, name: string) => [fmtKRW(v), name]}
                    labelFormatter={(l) => String(l)}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: '10px', color: '#9ca3af' }}
                    formatter={(value) => {
                      // 긴 캠페인 이름 축약 (20자)
                      return value.length > 20 ? value.slice(0, 20) + '…' : value;
                    }}
                  />
                  {top5Campaigns.map((camp, idx) => (
                    <Line
                      key={camp.campaign_id}
                      type="monotone"
                      dataKey={camp.campaign_name}
                      stroke={CAMPAIGN_COLORS[idx % CAMPAIGN_COLORS.length]}
                      strokeWidth={1.5}
                      dot={false}
                      activeDot={{ r: 3, strokeWidth: 0 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
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
      <div className="mt-4 bg-[#0F1011] rounded-xl border border-[#5E6AD2]/30 p-6">
        <div className="flex items-center gap-2 text-sm text-[#8A8F98]">
          <Loader2 size={16} className="animate-spin text-[#7070FF]" />
          <span>성과 피드백 분석 중...</span>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mt-4 bg-[#0F1011] rounded-xl border border-[#EB5757]/30 p-6 text-center">
        <AlertTriangle size={24} className="text-[#EB5757] mx-auto mb-2" />
        <p className="text-sm text-[#EB5757] mb-3">성과 피드백을 불러오지 못했습니다.</p>
        <button onClick={onRetry} className="text-xs bg-[#EB5757] text-white px-4 py-1.5 rounded-lg hover:bg-[#F07070] inline-flex items-center gap-1">
          <RefreshCw size={12} /> 다시 시도
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mt-4 bg-[#0F1011] rounded-xl border border-[#23252A] p-6 text-center">
        <p className="text-sm text-[#8A8F98]">데이터를 불러오는 중...</p>
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
      <div className="mt-4 bg-[#0F1011] rounded-xl border border-[#F0BF00]/30 p-6">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={18} className="text-yellow-500" />
          <p className="text-sm font-semibold text-[#F0BF00]">성과 피드백 데이터 구조 오류</p>
        </div>
        <p className="text-xs text-[#8A8F98] mb-2">API 응답에서 분석 데이터를 찾을 수 없습니다.</p>
        <details className="text-xs">
          <summary className="cursor-pointer text-[#7070FF] hover:underline mb-1">응답 데이터 확인</summary>
          <pre className="bg-[#08090A] rounded-lg p-3 overflow-x-auto max-h-48 text-[10px] text-[#D0D6E0] border">
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
    LOW: { bg: 'bg-[#27A644]/15', text: 'text-[#27A644]', label: '낮음' },
    MEDIUM: { bg: 'bg-[#F0BF00]/15', text: 'text-[#F0BF00]', label: '중간' },
    HIGH: { bg: 'bg-[#EB5757]/15', text: 'text-[#EB5757]', label: '높음' },
  };
  const risk = riskConfig[riskLevel] || riskConfig.LOW;

  const TrendArrow = ({ value, goodDirection = 'up' }: { value?: number; goodDirection?: 'up' | 'down' }) => {
    if (value === undefined || value === null) return null;
    const isUp = value > 0;
    const isGood = (goodDirection === 'up' && isUp) || (goodDirection === 'down' && !isUp);
    return (
      <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${isGood ? 'text-[#27A644]' : Math.abs(value) < 2 ? 'text-[#62666D]' : 'text-[#EB5757]'}`}>
        {isUp ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
        {isUp ? '+' : ''}{value.toFixed(1)}%
      </span>
    );
  };

  const SectionHeader = ({ sectionKey, icon, title, subtitle }: { sectionKey: string; icon: React.ReactNode; title: string; subtitle: string }) => (
    <button
      onClick={() => toggleSection(sectionKey)}
      className="w-full flex items-center justify-between p-3 hover:bg-[#141516]/5 rounded-lg transition-colors"
    >
      <div className="flex items-center gap-2">
        {icon}
        <div className="text-left">
          <p className="text-sm font-semibold text-[#F7F8F8]">{title}</p>
          <p className="text-[10px] text-[#62666D]">{subtitle}</p>
        </div>
      </div>
      {openSection === sectionKey ? <ChevronDown size={16} className="text-[#62666D]" /> : <ChevronRight size={16} className="text-[#62666D]" />}
    </button>
  );

  return (
    <div className="mt-4 bg-[#0F1011] rounded-xl border border-[#5E6AD2]/30 overflow-hidden">
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

      <div className="divide-y divide-[#23252A]">
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
                <div className="bg-[#08090A] rounded-lg p-2.5">
                  <p className="text-[10px] text-[#62666D]">현재 ROAS</p>
                  <p className="text-sm font-bold text-[#F7F8F8]">{conv.current_roas?.toFixed(2) || '-'}</p>
                  <TrendArrow value={conv.roas_change_pct} goodDirection="up" />
                </div>
                <div className="bg-[#08090A] rounded-lg p-2.5">
                  <p className="text-[10px] text-[#62666D]">이전 ROAS</p>
                  <p className="text-sm font-bold text-[#8A8F98]">{conv.previous_roas?.toFixed(2) || '-'}</p>
                </div>
                <div className="bg-[#08090A] rounded-lg p-2.5">
                  <p className="text-[10px] text-[#62666D]">현재 CPM</p>
                  <p className="text-sm font-bold text-[#F7F8F8]">{fmtCur(conv.current_cpm || 0)}</p>
                  <TrendArrow value={conv.cpm_change_pct} goodDirection="down" />
                </div>
                <div className="bg-[#08090A] rounded-lg p-2.5">
                  <p className="text-[10px] text-[#62666D]">CPA vs 객단가</p>
                  <p className="text-sm font-bold text-[#F7F8F8]">{conv.current_cpa ? fmtCur(conv.current_cpa) : '-'}</p>
                  {conv.avg_order_value && <p className="text-[10px] text-[#62666D]">객단가: {fmtCur(conv.avg_order_value)}</p>}
                </div>
              </div>
              {/* Status badge */}
              <div className={`rounded-lg p-3 text-sm ${
                conv.status === 'INCREASE_BUDGET' ? 'bg-[#27A644]/10 border border-[#27A644]/30 text-[#27A644]' :
                conv.status === 'EXPAND_TARGET' ? 'bg-[#F0BF00]/10 border border-[#F0BF00]/30 text-[#F0BF00]' :
                conv.status === 'CHECK_CPA' ? 'bg-[#EB5757]/10 border border-[#EB5757]/30 text-[#EB5757]' :
                'bg-[#4EA7FC]/10 border border-[#5E6AD2]/30 text-[#828FFF]'
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
              <div className="bg-[#08090A] rounded-lg p-3">
                <p className="text-[10px] text-[#8A8F98] mb-2">링크 클릭 CTR vs 전체 CTR</p>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[#62666D] w-16">링크 CTR</span>
                    <div className="flex-1 h-4 bg-[#232326] rounded-full overflow-hidden">
                      <div className="h-full bg-[#4EA7FC] rounded-full" style={{ width: `${Math.min((click.link_click_ctr || 0) * 20, 100)}%` }} />
                    </div>
                    <span className="text-xs font-semibold w-12 text-right">{click.link_click_ctr?.toFixed(2)}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[#62666D] w-16">전체 CTR</span>
                    <div className="flex-1 h-4 bg-[#232326] rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${Math.min((click.overall_ctr || 0) * 20, 100)}%` }} />
                    </div>
                    <span className="text-xs font-semibold w-12 text-right">{click.overall_ctr?.toFixed(2)}%</span>
                  </div>
                </div>
                {click.ctr_gap_warning && (
                  <p className="text-[10px] text-[#F0BF00] mt-1.5 flex items-center gap-1"><AlertTriangle size={10} /> CTR 격차가 큼 - 참여는 높으나 클릭 전환 부족</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="bg-[#08090A] rounded-lg p-2.5">
                  <p className="text-[10px] text-[#62666D]">CPC 추이</p>
                  <p className="text-sm font-bold">{fmtCur(click.current_cpc || 0)}</p>
                  <p className="text-[10px] text-[#62666D]">{click.cpc_trend}</p>
                </div>
                <div className={`rounded-lg p-2.5 ${
                  click.landing_status === 'GOOD' ? 'bg-[#27A644]/10 border border-[#27A644]/30' :
                  click.landing_status === 'WARNING' ? 'bg-[#F0BF00]/10 border border-[#F0BF00]/30' :
                  'bg-[#EB5757]/10 border border-[#EB5757]/30'
                }`}>
                  <p className="text-[10px] text-[#62666D]">랜딩페이지 도달율</p>
                  <p className="text-sm font-bold">{click.landing_page_view_rate?.toFixed(1)}%</p>
                  <p className="text-[10px]">
                    {click.landing_status === 'GOOD' ? '정상' :
                     click.landing_status === 'WARNING' ? '점검 권장' :
                     '웹사이트 속도/랜딩 점검 필요'}
                  </p>
                </div>
              </div>
              {click.recommendation && <p className="text-xs text-[#8A8F98] bg-[#4EA7FC]/10 rounded-lg p-2.5 border border-blue-100">{click.recommendation}</p>}
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
              <div className="bg-[#08090A] rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] text-[#8A8F98]">노출 빈도 (Frequency)</p>
                  <span className={`text-sm font-black ${imp.current_frequency > 2.3 ? 'text-[#EB5757]' : imp.current_frequency > 1.8 ? 'text-[#F0BF00]' : 'text-[#27A644]'}`}>
                    {imp.current_frequency?.toFixed(2)}
                  </span>
                </div>
                <div className="w-full h-3 bg-[#232326] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${imp.current_frequency > 2.3 ? 'bg-[#EB5757]' : imp.current_frequency > 1.8 ? 'bg-[#F0BF00]' : 'bg-[#27A644]'}`}
                    style={{ width: `${Math.min((imp.current_frequency / 4) * 100, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between mt-0.5">
                  <span className="text-[9px] text-[#62666D]">0</span>
                  <span className="text-[9px] text-red-300">2.3 (경고)</span>
                  <span className="text-[9px] text-[#62666D]">4+</span>
                </div>
                {imp.frequency_warning && (
                  <p className="text-[10px] text-[#EB5757] mt-1.5 flex items-center gap-1"><AlertTriangle size={10} /> 빈도가 2.3을 초과했습니다. 소재 교체를 고려하세요.</p>
                )}
              </div>

              {/* Fatigue alert */}
              {imp.fatigue_detected && (
                <div className="bg-[#EB5757]/10 border border-[#EB5757]/30 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <AlertTriangle size={14} className="text-[#EB5757]" />
                    <p className="text-xs font-semibold text-[#EB5757]">피로도 감지</p>
                  </div>
                  <p className="text-xs text-[#EB5757]">빈도 &gt; 2.3 + CPM {imp.cpm_trend === 'UP' ? '\u2191' : '\u2193'} + CTR {imp.ctr_trend === 'DOWN' ? '\u2193' : '\u2191'}</p>
                  {imp.recommendation && <p className="text-xs text-[#EB5757] mt-1">{imp.recommendation}</p>}
                </div>
              )}

              {/* CPC weekly trend */}
              {imp.weekly_cpc_trend && imp.weekly_cpc_trend.length > 0 && (
                <div className="bg-[#08090A] rounded-lg p-3">
                  <p className="text-[10px] text-[#8A8F98] mb-2">30일 CPC 주간 추이</p>
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
                          <span className="text-[8px] text-[#62666D]">W{i + 1}</span>
                        </div>
                      );
                    })}
                  </div>
                  {imp.cpc_upward_trend && (
                    <p className="text-[10px] text-[#EB5757] mt-1.5 flex items-center gap-1"><TrendingUp size={10} /> CPC 상승 패턴 감지</p>
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
                <div className="bg-[#08090A] rounded-lg p-2.5 text-center">
                  <p className="text-[10px] text-[#62666D]">현재 ON 소재 수</p>
                  <p className={`text-lg font-black ${creative.active_ad_count <= 1 ? 'text-[#EB5757]' : creative.active_ad_count <= 2 ? 'text-[#F0BF00]' : 'text-[#27A644]'}`}>
                    {creative.active_ad_count}
                  </p>
                  <p className="text-[9px] text-[#62666D]">전체 {creative.total_ad_count}개</p>
                </div>
                <div className="bg-[#08090A] rounded-lg p-2.5 text-center">
                  <p className="text-[10px] text-[#62666D]">소재 다양성</p>
                  <p className={`text-lg font-black ${creative.diversity_score >= 70 ? 'text-[#27A644]' : creative.diversity_score >= 40 ? 'text-[#F0BF00]' : 'text-[#EB5757]'}`}>
                    {creative.diversity_score}
                  </p>
                  <p className="text-[9px] text-[#62666D]">/ 100점</p>
                </div>
                <div className="bg-[#08090A] rounded-lg p-2.5 text-center">
                  <p className="text-[10px] text-[#62666D]">상태</p>
                  {(() => {
                    const declining = creative.creative_performances?.filter((c: any) => c.trend === 'DECLINING').length || 0;
                    const total = creative.creative_performances?.length || 0;
                    const ratio = total > 0 ? declining / total : 0;
                    return (
                      <>
                        <p className={`text-sm font-bold ${ratio > 0.5 ? 'text-[#EB5757]' : ratio > 0.2 ? 'text-[#F0BF00]' : 'text-[#27A644]'}`}>
                          {ratio > 0.5 ? '교체 필요' : ratio > 0.2 ? '주의' : '양호'}
                        </p>
                        <p className="text-[9px] text-[#62666D]">하락 {declining}/{total}개</p>
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Per-creative details */}
              {creative.creative_performances && creative.creative_performances.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] text-[#8A8F98] font-semibold">소재별 성과 추이</p>
                  {creative.creative_performances.map((c: any, i: number) => {
                    const trendColor = c.trend === 'IMPROVING' ? 'text-[#27A644]' : c.trend === 'DECLINING' ? 'text-[#EB5757]' : 'text-[#8A8F98]';
                    const trendBg = c.trend === 'IMPROVING' ? 'bg-[#27A644]/10 border-[#27A644]/30' : c.trend === 'DECLINING' ? 'bg-[#EB5757]/10 border-[#EB5757]/30' : 'bg-[#08090A] border-[#23252A]';
                    const trendLabel = c.trend === 'IMPROVING' ? '\u2191 \uAC1C\uC120' : c.trend === 'DECLINING' ? '\u2193 \uD558\uB77D' : '\u2192 \uC720\uC9C0';
                    return (
                      <div key={i} className={`rounded-lg p-2.5 border ${trendBg}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-[#F7F8F8] truncate flex-1 mr-2">{c.ad_name}</span>
                          <span className={`text-[10px] font-bold ${trendColor}`}>{trendLabel}</span>
                        </div>
                        <div className="flex gap-3 text-[10px] text-[#8A8F98]">
                          <span>CTR {c.ctr?.toFixed(2)}%</span>
                          <span>CPC {fmtCur(c.cpc || 0)}</span>
                          <span>지출 {fmtCur(c.spend || 0)}</span>
                          <span className={`font-medium ${c.status === 'ACTIVE' ? 'text-[#27A644]' : 'text-[#62666D]'}`}>{c.status}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {creative.recommendation && (
                <p className="text-xs text-[#8A8F98] bg-[#5E6AD2]/10 rounded-lg p-2.5 border border-purple-100">{creative.recommendation}</p>
              )}

              {creative.active_ad_count <= 1 && (
                <div className="bg-[#EB5757]/10 border border-[#EB5757]/30 rounded-lg p-2.5 flex items-start gap-1.5">
                  <AlertTriangle size={12} className="text-[#EB5757] mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-[#EB5757]">활성 소재가 {creative.active_ad_count}개뿐입니다. 최소 3개 이상의 소재를 운영하는 것을 권장합니다.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Recommendations */}
        {fb?.recommendations && fb.recommendations.length > 0 && (
          <div className="p-4">
            <p className="text-xs font-semibold text-[#D0D6E0] mb-2 flex items-center gap-1"><Lightbulb size={12} className="text-yellow-500" /> 종합 권장사항</p>
            <div className="space-y-1.5">
              {fb.recommendations.map((rec: string, i: number) => (
                <div key={i} className="flex items-start gap-2 text-xs text-[#8A8F98]">
                  <span className="w-4 h-4 bg-[#5E6AD2]/15 text-[#7070FF] rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold">{i + 1}</span>
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

  // Recharts bar chart for per-creative trend
  const renderMiniTrend = (data: any[]) => {
    if (!data || data.length === 0) return <p className="text-xs text-[#62666D]">데이터 없음</p>;
    const chartData = data.map((d: any) => ({
      date: (d.date || '').slice(5),
      spend: parseFloat(d.spend || 0),
    }));
    return (
      <ResponsiveContainer width="100%" height={100}>
        <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 16, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2d35" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 8, fill: '#9ca3af' }} stroke="#2a2d35" tickLine={false} interval={2} />
          <YAxis hide />
          <RechartsTooltip
            contentStyle={{ fontSize: '11px', padding: '4px 8px', borderRadius: '6px', border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.3)', background: '#1f2937', color: '#f9fafb' }}
            formatter={(v: number) => [formatSpend(v), '지출']}
          />
          <Bar dataKey="spend" fill="#8b5cf6" opacity={0.85} radius={[3, 3, 0, 0]} maxBarSize={20} />
        </BarChart>
      </ResponsiveContainer>
    );
  };

  return (
    <div className="bg-[#0F1011] border border-[#23252A] rounded-xl">
      <div className="px-5 py-4 border-b border-[#23252A] flex items-center justify-between">
        <button
          onClick={() => setShowCreativeDash(!showCreativeDash)}
          className="flex items-center gap-2 text-left"
        >
          {showCreativeDash ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <h3 className="font-semibold text-[#F7F8F8] flex items-center gap-2">
            <Palette size={18} className="text-purple-500" /> 크리에이티브 성과 대시보드
          </h3>
          <span className="text-xs bg-[#5E6AD2]/15 text-[#828FFF] px-2 py-0.5 rounded-full">{allAds.length}개</span>
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
                    <div key={ad.id} className="flex items-center justify-between bg-[#0F1011] rounded-lg p-2.5 border border-emerald-100">
                      <div className="flex items-center gap-2">
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${
                          i === 0 ? 'bg-emerald-500' : i === 1 ? 'bg-emerald-400' : 'bg-emerald-300'
                        }`}>{i + 1}</span>
                        <span className="text-xs font-medium text-[#F7F8F8] truncate max-w-[150px]">{ad.name}</span>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-emerald-600">ROAS {formatROAS(ad.roas)}</p>
                        <p className="text-[10px] text-[#62666D]">매출 {formatSpend(ad.conversion_value)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {topByCTR.length > 0 && (
              <div className="bg-gradient-to-br from-[#08090A] to-indigo-50 rounded-xl p-4 border border-[#5E6AD2]/30">
                <h4 className="text-xs font-bold text-[#828FFF] mb-3 flex items-center gap-1.5">
                  <MousePointer size={14} /> CTR 우수 소재 TOP 3
                </h4>
                <div className="space-y-2">
                  {topByCTR.map((ad, i) => (
                    <div key={ad.id} className="flex items-center justify-between bg-[#0F1011] rounded-lg p-2.5 border border-blue-100">
                      <div className="flex items-center gap-2">
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${
                          i === 0 ? 'bg-[#4EA7FC]' : i === 1 ? 'bg-blue-400' : 'bg-blue-300'
                        }`}>{i + 1}</span>
                        <span className="text-xs font-medium text-[#F7F8F8] truncate max-w-[150px]">{ad.name}</span>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-[#7070FF]">CTR {ad.ctr.toFixed(2)}%</p>
                        <p className="text-[10px] text-[#62666D]">CPC {formatCPC(ad.cpc)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sort controls */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#8A8F98]">정렬:</span>
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
                  sortBy === s.key ? 'bg-[#5E6AD2]/15 text-[#828FFF]' : 'bg-[#141516] text-[#8A8F98] hover:bg-[#141516]/7'
                }`}
              >{s.label}</button>
            ))}
          </div>

          {/* Creative performance table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#23252A]">
                  <th className="text-left py-2 px-2 text-[#8A8F98] font-medium">소재/캠페인</th>
                  <th className="text-right py-2 px-2 text-[#8A8F98] font-medium">상태</th>
                  <th className="text-right py-2 px-2 text-[#8A8F98] font-medium">지출</th>
                  <th className="text-right py-2 px-2 text-[#8A8F98] font-medium">전환값</th>
                  <th className="text-right py-2 px-2 text-[#8A8F98] font-medium">ROAS</th>
                  <th className="text-right py-2 px-2 text-[#8A8F98] font-medium">CTR</th>
                  <th className="text-right py-2 px-2 text-[#8A8F98] font-medium">CPC</th>
                  <th className="text-right py-2 px-2 text-[#8A8F98] font-medium">CPM</th>
                  <th className="text-right py-2 px-2 text-[#8A8F98] font-medium">빈도</th>
                  <th className="text-center py-2 px-2 text-[#8A8F98] font-medium">관리</th>
                </tr>
              </thead>
              <tbody>
                {sortedAds.map((ad) => {
                  const statusKo = ad.status === 'ACTIVE' ? '활성' : ad.status === 'PAUSED' ? '중지' : ad.status;
                  const statusColor = ad.status === 'ACTIVE' ? 'text-[#27A644]' : ad.status === 'PAUSED' ? 'text-[#F0BF00]' : 'text-[#62666D]';
                  return (
                    <tr key={ad.id} className="border-b border-gray-50 hover:bg-[#141516]/5">
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-2">
                          {ad.thumbnail_url && (
                            <img src={ad.thumbnail_url} alt="" className="w-8 h-8 rounded object-cover" />
                          )}
                          <div>
                            <p className="font-medium text-[#F7F8F8] truncate max-w-[180px]">{ad.name}</p>
                            {ad.adset_name && <p className="text-[10px] text-[#62666D] truncate max-w-[180px]">{ad.campaign_name} &gt; {ad.adset_name}</p>}
                          </div>
                        </div>
                      </td>
                      <td className={`py-2 px-2 text-right font-medium ${statusColor}`}>{statusKo}</td>
                      <td className="py-2 px-2 text-right">{formatSpend(ad.spend)}</td>
                      <td className="py-2 px-2 text-right">{ad.conversion_value ? formatSpend(ad.conversion_value) : '-'}</td>
                      <td className={`py-2 px-2 text-right font-semibold ${ad.roas >= 1 ? 'text-[#27A644]' : ad.roas > 0 ? 'text-[#EB5757]' : 'text-[#62666D]'}`}>
                        {formatROAS(ad.roas)}
                      </td>
                      <td className="py-2 px-2 text-right">{ad.ctr.toFixed(2)}%</td>
                      <td className="py-2 px-2 text-right">{formatCPC(ad.cpc)}</td>
                      <td className="py-2 px-2 text-right">{fmtCur(ad.cpm)}</td>
                      <td className={`py-2 px-2 text-right ${ad.frequency > 2.3 ? 'text-[#EB5757] font-medium' : ''}`}>
                        {ad.frequency.toFixed(2)}
                      </td>
                      <td className="py-2 px-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setSelectedAdForChart(selectedAdForChart === ad.meta_ad_id ? null : ad.meta_ad_id)}
                            title="소재별 차트"
                            className={`p-1 rounded hover:bg-[#5E6AD2]/15 ${selectedAdForChart === ad.meta_ad_id ? 'bg-[#5E6AD2]/15 text-[#7070FF]' : 'text-[#62666D]'}`}
                          >
                            <BarChart2 size={14} />
                          </button>
                          <button
                            onClick={() => setSelectedAdForComments(selectedAdForComments === ad.meta_ad_id ? null : ad.meta_ad_id)}
                            title="댓글 관리"
                            className={`p-1 rounded hover:bg-[#4EA7FC]/15 ${selectedAdForComments === ad.meta_ad_id ? 'bg-[#4EA7FC]/15 text-[#7070FF]' : 'text-[#62666D]'}`}
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
            <div className="border border-[#5E6AD2]/30 rounded-xl p-4 bg-[#5E6AD2]/10/30">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-purple-800 flex items-center gap-1.5">
                  <BarChart2 size={16} /> 소재별 일별 트렌드 (14일)
                </h4>
                <button onClick={() => setSelectedAdForChart(null)} className="text-[#62666D] hover:text-[#D0D6E0]">
                  <X size={16} />
                </button>
              </div>
              {trendQuery.isLoading ? (
                <div className="flex items-center gap-2 text-xs text-[#8A8F98] py-4">
                  <Loader2 size={14} className="animate-spin" /> 트렌드 데이터 로딩 중...
                </div>
              ) : trendQuery.isError ? (
                <p className="text-xs text-[#EB5757]">트렌드 데이터를 가져올 수 없습니다.</p>
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
                          <div className="bg-[#0F1011] rounded-lg p-2.5 border border-purple-100">
                            <p className="text-[10px] text-[#8A8F98]">총 지출</p>
                            <p className="text-sm font-bold">{formatSpend(totalSpend)}</p>
                          </div>
                          <div className="bg-[#0F1011] rounded-lg p-2.5 border border-purple-100">
                            <p className="text-[10px] text-[#8A8F98]">총 클릭</p>
                            <p className="text-sm font-bold">{formatNum(totalClicks)}</p>
                          </div>
                          <div className="bg-[#0F1011] rounded-lg p-2.5 border border-purple-100">
                            <p className="text-[10px] text-[#8A8F98]">총 노출</p>
                            <p className="text-sm font-bold">{formatNum(totalImpressions)}</p>
                          </div>
                          <div className="bg-[#0F1011] rounded-lg p-2.5 border border-purple-100">
                            <p className="text-[10px] text-[#8A8F98]">총 전환값</p>
                            <p className="text-sm font-bold">{formatSpend(totalConv)}</p>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                  <div className="bg-[#0F1011] rounded-lg p-3 border border-purple-100">
                    <p className="text-[10px] text-[#8A8F98] mb-2">일별 지출 추이</p>
                    {renderMiniTrend(trendQuery.data?.data || [])}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Comment Management Panel */}
          {selectedAdForComments && (
            <div className="border border-[#5E6AD2]/30 rounded-xl p-4 bg-[#4EA7FC]/10/30">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-[#828FFF] flex items-center gap-1.5">
                  <MessageSquare size={16} /> 댓글 관리
                </h4>
                <div className="flex items-center gap-2">
                  {postInfoQuery.data?.preview_url && (
                    <a
                      href={postInfoQuery.data.preview_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[#7070FF] hover:text-[#828FFF] flex items-center gap-1"
                    >
                      <ExternalLink size={12} /> 게시물 보기
                    </a>
                  )}
                  <button onClick={() => setSelectedAdForComments(null)} className="text-[#62666D] hover:text-[#D0D6E0]">
                    <X size={16} />
                  </button>
                </div>
              </div>

              {postInfoQuery.isLoading ? (
                <div className="flex items-center gap-2 text-xs text-[#8A8F98] py-4">
                  <Loader2 size={14} className="animate-spin" /> 게시물 정보 로딩 중...
                </div>
              ) : postInfoQuery.isError ? (
                <p className="text-xs text-[#EB5757]">게시물 정보를 가져올 수 없습니다. 이 광고에 게시물이 연결되어 있지 않을 수 있습니다.</p>
              ) : !postInfoQuery.data?.post_id ? (
                <p className="text-xs text-[#8A8F98]">이 광고에 연결된 게시물이 없습니다.</p>
              ) : commentsQuery.isLoading ? (
                <div className="flex items-center gap-2 text-xs text-[#8A8F98] py-4">
                  <Loader2 size={14} className="animate-spin" /> 댓글 로딩 중...
                </div>
              ) : (
                <div className="space-y-2">
                  {postInfoQuery.data?.thumbnail_url && (
                    <img src={postInfoQuery.data.thumbnail_url} alt="" className="w-16 h-16 rounded-lg object-cover" />
                  )}
                  <p className="text-xs text-[#8A8F98]">
                    게시물 ID: <span className="font-mono text-[#62666D]">{postInfoQuery.data.post_id}</span>
                  </p>
                  {(commentsQuery.data?.comments || []).length === 0 ? (
                    <p className="text-xs text-[#8A8F98] py-2">댓글이 없습니다.</p>
                  ) : (
                    <div className="max-h-64 overflow-y-auto space-y-2">
                      {(commentsQuery.data?.comments || []).map((comment: any) => (
                        <div key={comment.id} className="bg-[#0F1011] rounded-lg p-3 border border-blue-100">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-semibold text-[#F7F8F8]">
                              {comment.username || '사용자'}
                            </span>
                            <span className="text-[10px] text-[#62666D]">
                              {comment.timestamp ? new Date(comment.timestamp).toLocaleString('ko-KR') : ''}
                            </span>
                          </div>
                          <p className="text-xs text-[#D0D6E0]">{comment.text}</p>
                          {comment.like_count > 0 && (
                            <p className="text-[10px] text-[#62666D] mt-1">좋아요 {comment.like_count}</p>
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
