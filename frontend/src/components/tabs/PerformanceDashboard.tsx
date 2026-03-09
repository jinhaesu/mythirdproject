'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3, DollarSign, Eye, MousePointer, Target,
  Play, Pause, ChevronDown, ChevronRight, AlertTriangle, CheckCircle, XCircle,
  Loader2, RefreshCw, Zap, Activity, Users, Layers,
  TrendingUp, TrendingDown, ToggleLeft, ToggleRight, Edit3, Check, X,
  Shield, Sparkles, ArrowRight, Lightbulb, Palette,
} from 'lucide-react';
import { analyticsApi } from '@/lib/api';
import toast from 'react-hot-toast';

type DatePreset = 'last_7d' | 'last_14d' | 'last_30d' | 'custom';

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
  const [hidePaused, setHidePaused] = useState(true);
  const queryClient = useQueryClient();

  const isCustom = datePreset === 'custom' && customSince && customUntil && customSince <= customUntil;

  const { data: overview, isLoading: loadingOverview, isError: overviewError, refetch: refetchOverview } = useQuery({
    queryKey: ['account-overview', datePreset, customSince, customUntil],
    queryFn: () => isCustom
      ? analyticsApi.getAccountOverview('last_7d', customSince, customUntil)
      : analyticsApi.getAccountOverview(datePreset),
    refetchInterval: 60000,
    retry: 1,
    enabled: datePreset !== 'custom' || (!!customSince && !!customUntil),
  });

  const daysMap: Record<string, number> = { last_7d: 7, last_14d: 14, last_30d: 30 };
  const { data: trendData } = useQuery({
    queryKey: ['account-trend', datePreset, customSince, customUntil],
    queryFn: () => isCustom
      ? analyticsApi.getAccountTrend(30, customSince, customUntil)
      : analyticsApi.getAccountTrend(daysMap[datePreset] || 7),
    enabled: overview?.connected === true,
  });

  const { data: aiAnalysis, isLoading: loadingAI, refetch: refetchAI, dataUpdatedAt } = useQuery({
    queryKey: ['ai-analysis', datePreset],
    queryFn: () => analyticsApi.getAIAnalysis(datePreset, overview),
    enabled: overview?.connected === true && !!overview?.campaigns?.length,
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000,
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

  const statusMutation = useMutation({
    mutationFn: ({ id, type, status }: { id: string; type: string; status: string }) =>
      analyticsApi.updateStatus(id, type, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['account-overview'] }),
  });

  const budgetMutation = useMutation({
    mutationFn: ({ id, type, budget }: { id: string; type: string; budget: number }) =>
      analyticsApi.updateBudgetMeta(id, type, budget * 100),
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
    const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    statusMutation.mutate({ id, type, status: newStatus });
  };

  const startBudgetEdit = (id: string, type: string, currentBudget?: string) => {
    setEditingBudget({ id, type });
    setBudgetInput(currentBudget ? String(Math.round(parseFloat(currentBudget) / 100)) : '');
  };

  // Filter campaigns
  const allCampaigns = overview?.campaigns || [];
  const pausedCount = allCampaigns.filter((c: any) => (c.effective_status || c.status) === 'PAUSED').length;
  const campaigns = useMemo(() => {
    if (!hidePaused) return allCampaigns;
    return allCampaigns.filter((c: any) => (c.effective_status || c.status) !== 'PAUSED');
  }, [allCampaigns, hidePaused]);

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
    if (!v) return '\u20A90';
    const n = parseFloat(v);
    if (n >= 10000) return `\u20A9${(n / 10000).toFixed(1)}\uB9CC`;
    return `\u20A9${Math.round(n).toLocaleString('ko-KR')}`;
  };

  const formatSpend = (v: any) => {
    if (!v) return '\u20A90';
    const n = parseFloat(v);
    if (n >= 10000) return `\u20A9${(n / 10000).toFixed(1)}\uB9CC`;
    return `\u20A9${Math.round(n).toLocaleString('ko-KR')}`;
  };

  const formatCPC = (v: any) => {
    if (!v) return '\u20A90';
    const n = parseFloat(v);
    return `\u20A9${Math.round(n).toLocaleString('ko-KR')}`;
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
            <option value="last_7d">최근 7일</option>
            <option value="last_14d">최근 14일</option>
            <option value="last_30d">최근 30일</option>
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
          <button onClick={() => { refetchOverview(); refetchAI(); }} className="p-2 border border-gray-200 rounded-lg hover:bg-gray-50">
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
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <KPICard icon={<DollarSign size={20} />} label="총 지출" value={formatSpend(accountInsights.spend)} color="blue" />
            <KPICard icon={<Eye size={20} />} label="노출" value={formatNum(accountInsights.impressions)} color="purple" />
            <KPICard icon={<MousePointer size={20} />} label="클릭" value={formatNum(accountInsights.clicks)} sub={`CTR ${parseFloat(accountInsights.ctr || '0').toFixed(2)}%`} color="green" />
            <KPICard icon={<Target size={20} />} label="CPC" value={formatCPC(accountInsights.cpc)} sub={`CPM ${formatMoney(accountInsights.cpm)}`} color="orange" />
            <KPICard icon={<TrendingUp size={20} />} label="ROAS" value={formatROAS(accountROAS)} sub={accountROAS ? `${(accountROAS * 100).toFixed(0)}% 수익률` : '데이터 없음'} color="blue" />
          </div>

          {/* Daily Trend Chart */}
          {trendDays.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-3">
              <h3 className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
                <TrendingUp size={14} className="text-blue-500" /> 일별 성과 추이
              </h3>
              <div className="space-y-3">
                <div>
                  <p className="text-[10px] text-gray-500 mb-1">지출</p>
                  <MiniLineChart
                    data={trendDays.map((d: any) => ({ label: d.date_stop?.slice(5) || '', value: parseFloat(d.spend || 0) }))}
                    color="blue"
                    formatValue={(v) => formatSpend(v)}
                  />
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 mb-1">노출수</p>
                  <MiniLineChart
                    data={trendDays.map((d: any) => ({ label: d.date_stop?.slice(5) || '', value: parseInt(d.impressions || 0) }))}
                    color="purple"
                    formatValue={(v) => formatNum(v)}
                  />
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 mb-1">CTR (%)</p>
                  <MiniLineChart
                    data={trendDays.map((d: any) => ({ label: d.date_stop?.slice(5) || '', value: parseFloat(d.ctr || 0) }))}
                    color="green"
                    formatValue={(v) => `${v.toFixed(2)}%`}
                  />
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 mb-1">ROAS</p>
                  <MiniLineChart
                    data={trendDays.map((d: any) => ({ label: d.date_stop?.slice(5) || '', value: parseFloat(d.roas || 0) }))}
                    color="orange"
                    formatValue={(v) => v.toFixed(2)}
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
                {[1, 2, 3].map(i => (
                  <div key={i} className="animate-pulse">
                    <div className="h-4 bg-gray-200 rounded-lg w-1/3 mb-3" />
                    <div className="h-20 bg-gray-100 rounded-xl" />
                  </div>
                ))}
              </div>
            </div>
          ) : analysis && analysis.parse_error ? (
            <div className="bg-white rounded-2xl border border-yellow-200 shadow-lg overflow-hidden">
              <div className="bg-gradient-to-r from-yellow-500 to-amber-500 px-6 py-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={20} className="text-white" />
                  <h2 className="text-base font-bold text-white">AI 분석 결과 (텍스트)</h2>
                </div>
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
                <button onClick={() => refetchAI()} className="bg-red-600 text-white px-5 py-2 rounded-xl hover:bg-red-700 transition-colors font-medium text-sm">
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
                        {datePreset === 'last_7d' ? '최근 7일' : datePreset === 'last_14d' ? '최근 14일' : datePreset === 'last_30d' ? '최근 30일' : '사용자 지정'} 기간 분석
                        {dataUpdatedAt ? ` · ${new Date(dataUpdatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 기준` : ''}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => refetchAI()}
                    className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white text-sm font-medium px-4 py-2 rounded-xl transition-all"
                  >
                    <RefreshCw size={14} /> 재분석
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {/* 계정 건강도 */}
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

                {/* 실행 액션 아이템 */}
                {analysis.action_items?.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center">
                        <Zap size={16} className="text-orange-600" />
                      </div>
                      <h3 className="text-base font-bold text-gray-900">실행 액션 아이템</h3>
                      <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-medium">{analysis.action_items.length}건</span>
                    </div>
                    <div className="space-y-3">
                      {analysis.action_items.map((item: any, i: number) => (
                        <div
                          key={i}
                          className={`rounded-xl border-l-4 bg-white border border-gray-100 shadow-sm hover:shadow-md transition-all duration-200 p-4 ${
                            item.priority === 'high' ? 'border-l-red-500' :
                            item.priority === 'medium' ? 'border-l-amber-500' : 'border-l-blue-400'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2">
                                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                                  item.priority === 'high' ? 'bg-red-100 text-red-700' :
                                  item.priority === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                                }`}>
                                  {item.priority === 'high' ? '긴급' : item.priority === 'medium' ? '중간' : '낮음'}
                                </span>
                                {item.type && (
                                  <span className="text-[11px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-md">
                                    {item.type === 'pause_ad' ? '광고 중지' : item.type === 'increase_budget' ? '예산 증액' : item.type === 'decrease_budget' ? '예산 감액' : item.type === 'change_creative' ? '소재 변경' : item.type}
                                  </span>
                                )}
                                {item.target_name && <span className="text-xs text-gray-400 truncate">{item.target_name}</span>}
                              </div>
                              <p className="text-sm font-semibold text-gray-900 mb-1">{item.action}</p>
                              <p className="text-xs text-gray-500 leading-relaxed">{item.reason}</p>
                              {item.expected_impact && (
                                <div className="mt-2.5 inline-flex items-center gap-1.5 bg-emerald-50 px-2.5 py-1 rounded-lg">
                                  <TrendingUp size={12} className="text-emerald-500" />
                                  <span className="text-xs font-medium text-emerald-700">예상 효과: {item.expected_impact}</span>
                                </div>
                              )}
                            </div>
                            {item.target_id && item.type === 'pause_ad' && (
                              <button
                                onClick={() => toggleStatus(item.target_id, 'ad', 'ACTIVE')}
                                className="flex-shrink-0 text-xs bg-red-600 text-white px-3.5 py-2 rounded-xl hover:bg-red-700 transition-colors font-medium shadow-sm"
                              >
                                광고 중지
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 2-column: 소재 피로도 + 예산 추천 */}
                {(analysis.creative_fatigue?.length > 0 || analysis.budget_recommendations?.length > 0) && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* 소재 피로도 분석 */}
                    {analysis.creative_fatigue?.length > 0 && (
                      <div className="bg-gradient-to-br from-gray-50 to-purple-50/30 rounded-xl p-5 border border-gray-100">
                        <div className="flex items-center gap-2 mb-4">
                          <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                            <Palette size={16} className="text-purple-600" />
                          </div>
                          <h3 className="text-sm font-bold text-gray-900">소재 피로도 분석</h3>
                          <span className="text-[10px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full font-medium">{analysis.creative_fatigue.length}</span>
                        </div>
                        <div className="space-y-2.5">
                          {analysis.creative_fatigue.map((item: any, i: number) => (
                            <div key={i} className="bg-white rounded-lg p-3.5 border border-gray-100 hover:border-purple-200 transition-colors">
                              <div className="flex items-center justify-between mb-2.5">
                                <p className="text-sm font-semibold text-gray-900 truncate flex-1 mr-2">{item.ad_name}</p>
                                <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full flex-shrink-0 ${
                                  item.recommendation === '교체' ? 'bg-red-100 text-red-700' :
                                  item.recommendation === '수정' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                                }`}>
                                  {item.recommendation}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] text-gray-400 flex-shrink-0 w-14">노출 빈도</span>
                                <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all ${
                                      item.recommendation === '교체' ? 'bg-gradient-to-r from-red-400 to-red-500' :
                                      item.recommendation === '수정' ? 'bg-gradient-to-r from-amber-400 to-amber-500' : 'bg-gradient-to-r from-emerald-400 to-emerald-500'
                                    }`}
                                    style={{ width: `${Math.min(parseFloat(item.frequency || '0') / 5 * 100, 100)}%` }}
                                  />
                                </div>
                                <span className="text-xs font-bold text-gray-700 flex-shrink-0 w-8 text-right">{item.frequency}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 예산 최적화 추천 */}
                    {analysis.budget_recommendations?.length > 0 && (
                      <div className="bg-gradient-to-br from-gray-50 to-emerald-50/30 rounded-xl p-5 border border-gray-100">
                        <div className="flex items-center gap-2 mb-4">
                          <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
                            <DollarSign size={16} className="text-emerald-600" />
                          </div>
                          <h3 className="text-sm font-bold text-gray-900">예산 최적화 추천</h3>
                          <span className="text-[10px] bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded-full font-medium">{analysis.budget_recommendations.length}</span>
                        </div>
                        <div className="space-y-2.5">
                          {analysis.budget_recommendations.map((item: any, i: number) => (
                            <div key={i} className="bg-white rounded-lg p-3.5 border border-gray-100 hover:border-emerald-200 transition-colors">
                              <p className="text-sm font-semibold text-gray-900 mb-2.5">{item.campaign_name}</p>
                              <div className="flex items-center gap-2 mb-2.5 bg-gray-50 rounded-lg p-2.5">
                                <div className="flex-1 text-center">
                                  <p className="text-[10px] text-gray-400 mb-0.5">현재 예산</p>
                                  <p className="text-sm font-bold text-gray-500">{item.current_budget}</p>
                                </div>
                                <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                                  <ArrowRight size={14} className="text-blue-500" />
                                </div>
                                <div className="flex-1 text-center">
                                  <p className="text-[10px] text-blue-500 mb-0.5">추천 예산</p>
                                  <p className="text-sm font-bold text-blue-600">{item.recommended_budget}</p>
                                </div>
                              </div>
                              <p className="text-xs text-gray-500 leading-relaxed">{item.reason}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 우선 실행 사항 */}
                {analysis.next_steps?.length > 0 && (
                  <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-5 border border-blue-100">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                        <Lightbulb size={16} className="text-blue-600" />
                      </div>
                      <h3 className="text-sm font-bold text-gray-900">우선 실행 사항</h3>
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
                <Layers size={18} /> 캠페인 목록 ({campaigns.length}개)
              </h3>
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                <button onClick={() => setHidePaused(!hidePaused)} className="text-gray-500 hover:text-gray-700">
                  {hidePaused ? <ToggleRight size={20} className="text-blue-600" /> : <ToggleLeft size={20} />}
                </button>
                <span>중지 숨기기</span>
                {hidePaused && pausedCount > 0 && (
                  <span className="text-xs text-gray-400">(중지 {pausedCount}개 숨김)</span>
                )}
              </label>
            </div>
            <div className="divide-y divide-gray-100">
              {campaigns.map((camp: any) => {
                const isExpanded = expandedCampaign === camp.id;
                const ins = camp.insights;
                const es = camp.effective_status || camp.status;
                const statusKo = es === 'ACTIVE' ? '활성' : es === 'PAUSED' ? '일시중지' : es === 'CAMPAIGN_PAUSED' ? '캠페인 중지' : es;

                return (
                  <div key={camp.id}>
                    <div className="px-5 py-4 hover:bg-gray-50 cursor-pointer flex items-center gap-4"
                      onClick={() => setExpandedCampaign(isExpanded ? null : camp.id)}>
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-semibold text-gray-900 truncate">{camp.name}</h4>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            es === 'ACTIVE' ? 'bg-green-100 text-green-700' :
                            es === 'PAUSED' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600'
                          }`}>{statusKo}</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">{camp.objective}</p>
                      </div>
                      {ins && (
                        <div className="flex items-center gap-4 text-xs">
                          <div className="text-right"><p className="text-xs text-gray-400">지출</p><p className="font-semibold">{formatSpend(ins.spend)}</p></div>
                          <div className="text-right"><p className="text-xs text-gray-400">노출</p><p className="font-semibold">{formatNum(ins.impressions)}</p></div>
                          <div className="text-right"><p className="text-xs text-gray-400">클릭</p><p className="font-semibold">{formatNum(ins.clicks)}</p></div>
                          <div className="text-right"><p className="text-xs text-gray-400">CTR</p><p className="font-semibold">{parseFloat(ins.ctr || '0').toFixed(2)}%</p></div>
                          <div className="text-right"><p className="text-xs text-gray-400">CPC</p><p className="font-semibold">{formatCPC(ins.cpc)}</p></div>
                          <div className="text-right"><p className="text-xs text-gray-400">ROAS</p><p className={`font-semibold ${ins.roas && ins.roas >= 1 ? 'text-green-600' : ins.roas ? 'text-red-600' : 'text-gray-400'}`}>{formatROAS(ins.roas)}</p></div>
                        </div>
                      )}
                      <div className="flex items-center gap-1.5">
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
                        <button onClick={(e) => { e.stopPropagation(); toggleStatus(camp.id, 'campaign', es); }}
                          className={`p-2 rounded-lg ${es === 'ACTIVE' ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}
                          title={es === 'ACTIVE' ? '일시중지' : '활성화'}>
                          {es === 'ACTIVE' ? <Pause size={14} /> : <Play size={14} />}
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="bg-gray-50 px-5 py-4 border-t border-gray-100">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-semibold text-gray-500 uppercase">광고세트 & 광고</span>
                          <button onClick={() => setSelectedCampaignForDeep(selectedCampaignForDeep === camp.id ? null : camp.id)}
                            className="text-xs bg-blue-600 text-white px-3 py-1 rounded-lg hover:bg-blue-700">
                            {selectedCampaignForDeep === camp.id ? '심층분석 닫기' : '심층 분석'}
                          </button>
                        </div>

                        {loadingAdsets && expandedCampaign === camp.id ? (
                          <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
                            <Loader2 size={14} className="animate-spin" /> 광고세트 로딩 중...
                          </div>
                        ) : (adsetsData?.adsets || []).length > 0 && expandedCampaign === camp.id ? (
                          <div className="space-y-3">
                            {(adsetsData.adsets as any[]).map((adset: any) => {
                              const adsetStatus = adset.effective_status || adset.status;
                              const adsetStatusKo = adsetStatus === 'ACTIVE' ? '활성' : adsetStatus === 'PAUSED' ? '중지' : adsetStatus;
                              return (
                                <div key={adset.id} className="bg-white rounded-lg border border-gray-200 p-3">
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                      <Users size={14} className="text-purple-500" />
                                      <span className="text-sm font-medium">{adset.name}</span>
                                      <span className={`text-xs px-1.5 py-0.5 rounded ${adsetStatus === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{adsetStatusKo}</span>
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
                                          {adset.daily_budget && <span className="text-xs text-gray-400">일예산: {formatSpend(Number(adset.daily_budget) / 100)}</span>}
                                          <button onClick={(e) => { e.stopPropagation(); startBudgetEdit(adset.id, 'adset', adset.daily_budget); }}
                                            className="text-gray-400 hover:text-blue-600" title="예산 변경"><Edit3 size={12} /></button>
                                        </>
                                      )}
                                      <button onClick={() => toggleStatus(adset.id, 'adset', adsetStatus)} className="text-xs px-2 py-1 rounded border hover:bg-gray-50">
                                        {adsetStatus === 'ACTIVE' ? '중지' : '활성화'}
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
                                    <div className="flex gap-4 text-xs text-gray-600 mb-2">
                                      <span>지출: {formatSpend(adset.insights.spend)}</span>
                                      <span>클릭: {adset.insights.clicks}</span>
                                      <span>CTR: {parseFloat(adset.insights.ctr || '0').toFixed(2)}%</span>
                                      <span>CPC: {formatCPC(adset.insights.cpc)}</span>
                                      <span className={adset.insights.roas && adset.insights.roas >= 1 ? 'text-green-600 font-medium' : adset.insights.roas ? 'text-red-600 font-medium' : ''}>ROAS: {formatROAS(adset.insights.roas)}</span>
                                    </div>
                                  )}
                                  {adset.ads?.length > 0 && (
                                    <div className="mt-2 space-y-1">
                                      {adset.ads.map((ad: any) => {
                                        const adStatus = ad.effective_status || ad.status;
                                        const adStatusKo = adStatus === 'ACTIVE' ? '활성' : adStatus === 'PAUSED' ? '중지' : adStatus;
                                        return (
                                          <div key={ad.id} className="flex items-center justify-between bg-gray-50 rounded p-2">
                                            <div className="flex items-center gap-2">
                                              <div className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                                              <span className="text-xs text-gray-700">{ad.name}</span>
                                              <span className={`text-xs ${adStatus === 'ACTIVE' ? 'text-green-600' : 'text-gray-400'}`}>{adStatusKo}</span>
                                            </div>
                                            <div className="flex items-center gap-3">
                                              {ad.insights && <span className="text-xs text-gray-500">{formatSpend(ad.insights.spend)} | CPC {formatCPC(ad.insights.cpc)} | CTR {parseFloat(ad.insights.ctr || '0').toFixed(2)}% | <span className={ad.insights.roas && ad.insights.roas >= 1 ? 'text-green-600' : ad.insights.roas ? 'text-red-600' : ''}>ROAS {formatROAS(ad.insights.roas)}</span></span>}
                                              <button onClick={() => toggleStatus(ad.id, 'ad', adStatus)} className="text-xs px-2 py-0.5 rounded border hover:bg-white">
                                                {adStatus === 'ACTIVE' ? '중지' : '켜기'}
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
                  <p className="text-gray-400">{hidePaused ? '활성 캠페인이 없습니다.' : '캠페인이 없습니다.'}</p>
                  {overview?.campaigns_error && (
                    <p className="text-xs text-red-400 mt-2">Meta API 오류: {typeof overview.campaigns_error === 'string' ? overview.campaigns_error.slice(0, 100) : 'API 연결 실패'}</p>
                  )}
                </div>
              )}
            </div>
          </div>
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
