'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3, DollarSign, Eye, MousePointer, Target,
  Play, Pause, ChevronDown, ChevronRight, AlertTriangle, CheckCircle, XCircle,
  Loader2, RefreshCw, Zap, Mail, FileText, Activity, Users, Layers,
} from 'lucide-react';
import { analyticsApi } from '@/lib/api';

type DatePreset = 'last_7d' | 'last_14d' | 'last_30d';

export default function PerformanceDashboard() {
  const [datePreset, setDatePreset] = useState<DatePreset>('last_7d');
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
  const [selectedCampaignForDeep, setSelectedCampaignForDeep] = useState<string | null>(null);
  const [reportDates, setReportDates] = useState({ start: '', end: '' });
  const [reportEmail, setReportEmail] = useState('');
  const [reportCampaignId, setReportCampaignId] = useState('');
  const queryClient = useQueryClient();

  const { data: overview, isLoading: loadingOverview, isError: overviewError, refetch: refetchOverview } = useQuery({
    queryKey: ['account-overview', datePreset],
    queryFn: () => analyticsApi.getAccountOverview(datePreset),
    refetchInterval: 60000,
    retry: 1,
  });

  const { data: aiAnalysis, isLoading: loadingAI, refetch: refetchAI } = useQuery({
    queryKey: ['ai-analysis', datePreset],
    queryFn: () => analyticsApi.getAIAnalysis(datePreset, overview),
    enabled: overview?.connected === true && !!overview?.campaigns?.length,
  });

  const { data: deepData } = useQuery({
    queryKey: ['campaign-deep', selectedCampaignForDeep, datePreset],
    queryFn: () => analyticsApi.getCampaignDeep(selectedCampaignForDeep!, datePreset),
    enabled: !!selectedCampaignForDeep,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, type, status }: { id: string; type: string; status: string }) =>
      analyticsApi.updateStatus(id, type, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['account-overview'] }),
  });

  const reportMutation = useMutation({
    mutationFn: (req: { meta_campaign_id?: string; start_date: string; end_date: string }) =>
      analyticsApi.generateReport(req),
  });

  const emailMutation = useMutation({
    mutationFn: (req: { meta_campaign_id?: string; start_date: string; end_date: string; email: string }) =>
      analyticsApi.sendReportEmail(req),
  });

  const toggleStatus = (id: string, type: string, currentStatus: string) => {
    const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    statusMutation.mutate({ id, type, status: newStatus });
  };

  if (overviewError) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertTriangle size={40} className="text-red-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">데이터 로딩 실패</h2>
          <p className="text-gray-500 mb-6">Meta 광고 데이터를 가져오는데 실패했습니다. 네트워크 연결을 확인하거나 잠시 후 다시 시도해주세요.</p>
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
          <p className="text-gray-500 mb-6">
            Meta 광고 관리자 계정을 연동하면 실제 캠페인 데이터를 기반으로 성과 분석, AI 추천, 광고 관리가 가능합니다.
          </p>
        </div>
      </div>
    );
  }

  const analysis = aiAnalysis?.analysis;
  const campaigns = overview?.campaigns || [];
  const accountInsights = overview?.account_insights || {};

  const formatNum = (v: any) => {
    if (!v) return '0';
    const n = parseFloat(v);
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toFixed(n < 10 ? 2 : 0);
  };

  const formatMoney = (v: any) => {
    if (!v) return '$0';
    const n = parseFloat(v);
    return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">성과 분석 대시보드</h2>
          <p className="text-sm text-gray-500 mt-1">Meta 광고 관리자 실시간 데이터</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value as DatePreset)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
          >
            <option value="last_7d">최근 7일</option>
            <option value="last_14d">최근 14일</option>
            <option value="last_30d">최근 30일</option>
          </select>
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPICard icon={<DollarSign size={20} />} label="총 지출" value={formatMoney(accountInsights.spend)} color="blue" />
            <KPICard icon={<Eye size={20} />} label="노출" value={formatNum(accountInsights.impressions)} color="purple" />
            <KPICard icon={<MousePointer size={20} />} label="클릭" value={formatNum(accountInsights.clicks)} sub={`CTR ${parseFloat(accountInsights.ctr || '0').toFixed(2)}%`} color="green" />
            <KPICard icon={<Target size={20} />} label="CPC" value={formatMoney(accountInsights.cpc)} sub={`CPM ${formatMoney(accountInsights.cpm)}`} color="orange" />
          </div>

          {/* Conversion Actions */}
          {accountInsights.actions && accountInsights.actions.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">전환 액션 요약</h3>
              <div className="flex flex-wrap gap-3">
                {accountInsights.actions.slice(0, 8).map((action: any, i: number) => (
                  <div key={i} className="bg-gray-50 rounded-lg px-3 py-2 text-sm">
                    <span className="text-gray-500">{action.action_type?.replace(/_/g, ' ')}</span>
                    <span className="ml-2 font-semibold text-gray-900">{formatNum(action.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI Analysis */}
          {loadingAI ? (
            <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-xl p-6">
              <div className="flex items-center gap-3">
                <Loader2 size={20} className="animate-spin text-blue-600" />
                <span className="text-blue-700">AI가 계정 데이터를 분석하고 있습니다...</span>
              </div>
            </div>
          ) : analysis && !analysis.parse_error ? (
            <div className="space-y-4">
              {/* Health Banner */}
              <div className={`rounded-xl p-5 border ${
                analysis.account_health === 'good' ? 'bg-green-50 border-green-200' :
                analysis.account_health === 'warning' ? 'bg-yellow-50 border-yellow-200' :
                'bg-red-50 border-red-200'
              }`}>
                <div className="flex items-start gap-3">
                  {analysis.account_health === 'good' ? <CheckCircle className="text-green-600 mt-0.5" size={20} /> :
                   analysis.account_health === 'warning' ? <AlertTriangle className="text-yellow-600 mt-0.5" size={20} /> :
                   <XCircle className="text-red-600 mt-0.5" size={20} />}
                  <div>
                    <h3 className="font-semibold text-gray-900">
                      계정 건강도: {analysis.account_health === 'good' ? '양호' : analysis.account_health === 'warning' ? '주의' : '위험'}
                    </h3>
                    <p className="text-sm text-gray-700 mt-1">{analysis.health_summary}</p>
                  </div>
                </div>
              </div>

              {/* Action Items */}
              {analysis.action_items?.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-xl p-5">
                  <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <Zap size={18} className="text-orange-500" /> 실행 액션 아이템
                  </h3>
                  <div className="space-y-3">
                    {analysis.action_items.map((item: any, i: number) => (
                      <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border ${
                        item.priority === 'high' ? 'border-red-200 bg-red-50' :
                        item.priority === 'medium' ? 'border-yellow-200 bg-yellow-50' : 'border-gray-200 bg-gray-50'
                      }`}>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded mt-0.5 ${
                          item.priority === 'high' ? 'bg-red-600 text-white' :
                          item.priority === 'medium' ? 'bg-yellow-600 text-white' : 'bg-gray-400 text-white'
                        }`}>{item.priority?.toUpperCase()}</span>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-900">{item.action}</p>
                          <p className="text-xs text-gray-500 mt-1">{item.reason}</p>
                          {item.expected_impact && <p className="text-xs text-blue-600 mt-1">예상 효과: {item.expected_impact}</p>}
                          {item.target_id && item.type === 'pause_ad' && (
                            <button onClick={() => toggleStatus(item.target_id, 'ad', 'ACTIVE')}
                              className="mt-2 text-xs bg-red-600 text-white px-3 py-1 rounded-lg hover:bg-red-700">
                              광고 중지 실행
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Creative Fatigue */}
              {analysis.creative_fatigue?.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-xl p-5">
                  <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <Activity size={18} className="text-red-500" /> 소재 피로도 알림
                  </h3>
                  <div className="space-y-2">
                    {analysis.creative_fatigue.map((item: any, i: number) => (
                      <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{item.ad_name}</p>
                          <p className="text-xs text-gray-500">빈도: {item.frequency}</p>
                        </div>
                        <span className={`text-xs font-semibold px-2 py-1 rounded ${
                          item.recommendation === '교체' ? 'bg-red-100 text-red-700' :
                          item.recommendation === '수정' ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'
                        }`}>{item.recommendation}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Budget Recommendations */}
              {analysis.budget_recommendations?.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-xl p-5">
                  <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <DollarSign size={18} className="text-green-500" /> 예산 추천
                  </h3>
                  <div className="space-y-2">
                    {analysis.budget_recommendations.map((item: any, i: number) => (
                      <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{item.campaign_name}</p>
                          <p className="text-xs text-gray-500">{item.reason}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-gray-400">현재: {item.current_budget}</p>
                          <p className="text-sm font-semibold text-blue-600">추천: {item.recommended_budget}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Next Steps */}
              {analysis.next_steps?.length > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
                  <h3 className="font-semibold text-blue-900 mb-3">우선 실행 사항</h3>
                  <ol className="space-y-2">
                    {analysis.next_steps.map((step: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-blue-800">
                        <span className="bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">{i + 1}</span>
                        {step}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          ) : null}

          {/* Campaign List */}
          <div className="bg-white border border-gray-200 rounded-xl">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Layers size={18} /> 캠페인 목록 ({campaigns.length}개)
              </h3>
            </div>
            <div className="divide-y divide-gray-100">
              {campaigns.map((camp: any) => {
                const isExpanded = expandedCampaign === camp.id;
                const ins = camp.insights;
                const es = camp.effective_status || camp.status;

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
                          }`}>{es}</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">{camp.objective}</p>
                      </div>
                      {ins && (
                        <div className="flex items-center gap-6 text-sm">
                          <div className="text-right"><p className="text-xs text-gray-400">지출</p><p className="font-semibold">{formatMoney(ins.spend)}</p></div>
                          <div className="text-right"><p className="text-xs text-gray-400">노출</p><p className="font-semibold">{formatNum(ins.impressions)}</p></div>
                          <div className="text-right"><p className="text-xs text-gray-400">클릭</p><p className="font-semibold">{formatNum(ins.clicks)}</p></div>
                          <div className="text-right"><p className="text-xs text-gray-400">CTR</p><p className="font-semibold">{parseFloat(ins.ctr || '0').toFixed(2)}%</p></div>
                        </div>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); toggleStatus(camp.id, 'campaign', es); }}
                        className={`p-2 rounded-lg ${es === 'ACTIVE' ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}
                        title={es === 'ACTIVE' ? '일시중지' : '활성화'}>
                        {es === 'ACTIVE' ? <Pause size={14} /> : <Play size={14} />}
                      </button>
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

                        {camp.adsets?.length > 0 ? (
                          <div className="space-y-3">
                            {camp.adsets.map((adset: any) => (
                              <div key={adset.id} className="bg-white rounded-lg border border-gray-200 p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <Users size={14} className="text-purple-500" />
                                    <span className="text-sm font-medium">{adset.name}</span>
                                    <span className={`text-xs px-1.5 py-0.5 rounded ${adset.effective_status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{adset.effective_status}</span>
                                  </div>
                                  <button onClick={() => toggleStatus(adset.id, 'adset', adset.effective_status)} className="text-xs px-2 py-1 rounded border hover:bg-gray-50">
                                    {adset.effective_status === 'ACTIVE' ? '중지' : '활성화'}
                                  </button>
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
                                    <span>지출: {formatMoney(adset.insights.spend)}</span>
                                    <span>클릭: {adset.insights.clicks}</span>
                                    <span>CTR: {parseFloat(adset.insights.ctr || '0').toFixed(2)}%</span>
                                  </div>
                                )}
                                {adset.ads?.length > 0 && (
                                  <div className="mt-2 space-y-1">
                                    {adset.ads.map((ad: any) => (
                                      <div key={ad.id} className="flex items-center justify-between bg-gray-50 rounded p-2">
                                        <div className="flex items-center gap-2">
                                          <div className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                                          <span className="text-xs text-gray-700">{ad.name}</span>
                                          <span className={`text-xs ${ad.effective_status === 'ACTIVE' ? 'text-green-600' : 'text-gray-400'}`}>{ad.effective_status}</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                          {ad.insights && <span className="text-xs text-gray-500">{formatMoney(ad.insights.spend)} | CTR {parseFloat(ad.insights.ctr || '0').toFixed(2)}%</span>}
                                          <button onClick={() => toggleStatus(ad.id, 'ad', ad.effective_status)} className="text-xs px-2 py-0.5 rounded border hover:bg-white">
                                            {ad.effective_status === 'ACTIVE' ? '중지' : '켜기'}
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : <p className="text-sm text-gray-400">광고세트가 없습니다.</p>}

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
                                      <span>{formatMoney(p.spend)} | CTR {parseFloat(p.ctr || '0').toFixed(2)}%</span>
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
              {campaigns.length === 0 && <div className="px-5 py-8 text-center text-gray-400">캠페인이 없습니다.</div>}
            </div>
          </div>

          {/* Report Section */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2"><FileText size={18} /> 기간 리포트</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">캠페인</label>
                <select value={reportCampaignId} onChange={(e) => setReportCampaignId(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
                  <option value="">전체 계정</option>
                  {campaigns.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">시작일</label>
                <input type="date" value={reportDates.start} onChange={(e) => setReportDates(d => ({ ...d, start: e.target.value }))} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">종료일</label>
                <input type="date" value={reportDates.end} onChange={(e) => setReportDates(d => ({ ...d, end: e.target.value }))} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div className="flex items-end">
                <button onClick={() => reportMutation.mutate({ meta_campaign_id: reportCampaignId || undefined, start_date: reportDates.start, end_date: reportDates.end })}
                  disabled={!reportDates.start || !reportDates.end || reportMutation.isPending}
                  className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                  {reportMutation.isPending ? <Loader2 size={14} className="animate-spin mx-auto" /> : '리포트 생성'}
                </button>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <input type="email" value={reportEmail} onChange={(e) => setReportEmail(e.target.value)} placeholder="이메일 주소" className="flex-1 px-3 py-2 border rounded-lg text-sm" />
              <button onClick={() => emailMutation.mutate({ meta_campaign_id: reportCampaignId || undefined, start_date: reportDates.start, end_date: reportDates.end, email: reportEmail })}
                disabled={!reportEmail || !reportDates.start || !reportDates.end || emailMutation.isPending}
                className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2">
                <Mail size={14} /> {emailMutation.isPending ? '발송중...' : '이메일 발송'}
              </button>
            </div>
            {emailMutation.isSuccess && <p className="mt-2 text-sm text-green-600">{(emailMutation.data as any)?.message}</p>}
            {reportMutation.isSuccess && (reportMutation.data as any)?.ai_report && (
              <div className="mt-4 bg-gray-50 rounded-lg p-4 max-h-96 overflow-y-auto">
                <h4 className="text-sm font-semibold text-gray-700 mb-2">AI 분석 리포트</h4>
                <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{(reportMutation.data as any).ai_report}</div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function KPICard({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string; sub?: string; color: string }) {
  const colors: Record<string, string> = { blue: 'bg-blue-50 text-blue-600', purple: 'bg-purple-50 text-purple-600', green: 'bg-green-50 text-green-600', orange: 'bg-orange-50 text-orange-600' };
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2"><div className={`p-1.5 rounded-lg ${colors[color]}`}>{icon}</div><span className="text-xs text-gray-500">{label}</span></div>
      <p className="text-xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}
