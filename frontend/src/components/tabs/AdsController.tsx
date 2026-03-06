'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Target, DollarSign, Zap, Upload, CheckCircle,
  Play, Pause, Settings, ChevronDown, ChevronUp, RefreshCw, Info, X
} from 'lucide-react';
import { Button, Input, Card, CardTitle, Select } from '@/components/ui';
import { campaignApi } from '@/lib/api';
import { useAppStore } from '@/store';
import type { Campaign, StrategyRecommendation, Ad } from '@/types';
import toast from 'react-hot-toast';

export function AdsController() {
  const { selectedCreatives, setSelectedCampaign, setActiveTab, autoPlanResult, setAutoPlanResult } = useAppStore();

  const [campaignName, setCampaignName] = useState('');
  const [objective, setObjective] = useState<'TRAFFIC' | 'CONVERSIONS' | 'LEAD_GENERATION'>('TRAFFIC');
  const [budget, setBudget] = useState('');
  const [strategy, setStrategy] = useState<StrategyRecommendation | null>(null);
  const [showPlanBanner, setShowPlanBanner] = useState(false);

  // Auto-fill from AI plan result
  useEffect(() => {
    if (autoPlanResult) {
      const structure = autoPlanResult.campaign_structure;
      const productName = autoPlanResult.product_info?.name || '';

      // Campaign name
      const planName = structure?.campaign_name || (productName ? `${productName} 캠페인` : '');
      if (planName) setCampaignName(planName);

      // Objective
      const planObjective = structure?.objective;
      if (planObjective && ['TRAFFIC', 'CONVERSIONS', 'LEAD_GENERATION'].includes(planObjective)) {
        setObjective(planObjective as 'TRAFFIC' | 'CONVERSIONS' | 'LEAD_GENERATION');
      }

      // Budget - sum from groups or use total
      const groups = structure?.groups || [];
      const totalFromGroups = groups.reduce((sum: number, g: any) => sum + (g.budget_amount || 0), 0);
      if (totalFromGroups > 0) {
        setBudget(String(totalFromGroups));
      }

      setShowPlanBanner(true);
    }
  }, [autoPlanResult]);

  const { data: campaigns, refetch: refetchCampaigns } = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => campaignApi.list(),
  });

  const strategyMutation = useMutation({
    mutationFn: () => campaignApi.getStrategy(Number(budget), selectedCreatives.map((c) => c.id)),
    onSuccess: (data) => { setStrategy(data); toast.success('최적 전략 분석 완료'); },
    onError: () => toast.error('전략 분석 실패'),
  });

  const createCampaignMutation = useMutation({
    mutationFn: () => campaignApi.create({
      name: campaignName || `캠페인 ${new Date().toLocaleDateString()}`,
      objective,
      total_budget: Number(budget),
      creative_ids: selectedCreatives.map((c) => c.id),
    }),
    onSuccess: () => { refetchCampaigns(); toast.success('캠페인 생성 완료'); setCampaignName(''); setBudget(''); },
    onError: () => toast.error('캠페인 생성 실패'),
  });

  const publishMutation = useMutation({
    mutationFn: (campaignId: number) => campaignApi.publish(campaignId),
    onSuccess: (data) => { data.success ? (refetchCampaigns(), toast.success(data.message)) : toast.error(data.message); },
    onError: () => toast.error('발행 실패'),
  });

  const handleViewAnalytics = (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    setActiveTab(4);
  };

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      {/* 캠페인 생성 */}
      <div className="lg:col-span-1 space-y-6">
        <Card variant="bordered">
          <CardTitle className="flex items-center gap-2 mb-4">
            <Target size={20} />
            캠페인 생성
          </CardTitle>

          {/* AI 기획 자동 입력 배너 */}
          {showPlanBanner && autoPlanResult && (
            <div className="mb-4 p-3 bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Info size={16} className="text-purple-600 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-purple-800">AI 기획에서 자동 입력됨</p>
                    <p className="text-xs text-purple-600 mt-0.5">기획 데이터를 기반으로 자동 입력되었습니다. 수정 후 캠페인을 생성하세요.</p>
                    {autoPlanResult.overall_strategy && (
                      <p className="text-xs text-gray-600 mt-1 italic">"{autoPlanResult.overall_strategy}"</p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => { setShowPlanBanner(false); setAutoPlanResult(null); }}
                  className="text-gray-400 hover:text-gray-600 flex-shrink-0"
                >
                  <X size={14} />
                </button>
              </div>

              {/* 타겟 요약 from plan */}
              {autoPlanResult.targeting?.segments && autoPlanResult.targeting.segments.length > 0 && (
                <div className="mt-2 pt-2 border-t border-purple-100">
                  <p className="text-xs font-medium text-purple-700 mb-1">타겟 설계:</p>
                  <div className="flex flex-wrap gap-1">
                    {autoPlanResult.targeting.segments.map((seg: any, i: number) => (
                      <span key={i} className="text-xs bg-white text-purple-700 px-2 py-0.5 rounded border border-purple-100">
                        {seg.type} {seg.ratio}%
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-4">
            <Input label="캠페인명" placeholder="예: 봄 신상 런칭" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">목표</label>
              <div className="space-y-2">
                {[
                  { value: 'TRAFFIC', label: '트래픽 증대', desc: '웹사이트 방문 유도' },
                  { value: 'CONVERSIONS', label: '구매 전환', desc: '상품 구매/결제 유도' },
                  { value: 'LEAD_GENERATION', label: '잠재 고객', desc: '리드/문의 수집' },
                ].map((opt) => (
                  <label key={opt.value}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      objective === opt.value ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'
                    }`}>
                    <input type="radio" name="objective" value={opt.value} checked={objective === opt.value}
                      onChange={(e) => setObjective(e.target.value as any)} className="mt-0.5" />
                    <div>
                      <p className="font-medium text-sm">{opt.label}</p>
                      <p className="text-xs text-gray-500">{opt.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                선택된 소재 ({selectedCreatives.length}개)
              </label>
              {selectedCreatives.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {selectedCreatives.map((creative) => (
                    <div key={creative.id} className="flex items-center gap-2 px-2 py-1 bg-gray-100 rounded text-sm">
                      <div className="w-6 h-6 rounded bg-gray-300 overflow-hidden">
                        {(creative.thumbnail_url || creative.file_url) && (
                          <img src={creative.thumbnail_url || creative.file_url} alt="" className="w-full h-full object-cover" />
                        )}
                      </div>
                      <span className="truncate max-w-[80px]">{creative.name}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-orange-500">Creative Studio 탭에서 소재를 선택해주세요</p>
              )}
            </div>

            <Input label="총 예산 (원)" type="number" placeholder="1,000,000" value={budget} onChange={(e) => setBudget(e.target.value)}
              leftIcon={<span className="text-sm font-medium">₩</span>} />

            <Button variant="outline" className="w-full" onClick={() => strategyMutation.mutate()}
              loading={strategyMutation.isPending} disabled={!budget || selectedCreatives.length === 0}>
              <Zap size={16} className="mr-2" /> AI 전략 추천
            </Button>

            {strategy && (
              <div className="p-4 bg-gradient-to-r from-blue-50 to-green-50 rounded-lg space-y-2">
                <p className="text-sm font-medium text-gray-900">AI 추천 전략</p>
                <p className="text-sm text-gray-700">{strategy.reasoning}</p>
                <div className="text-sm space-y-1">
                  <p><span className="font-medium">타겟:</span> {strategy.target_audience_summary}</p>
                  <p><span className="font-medium">예상 도달:</span> {strategy.expected_reach.toLocaleString()}명</p>
                  <p><span className="font-medium">예상 CTR:</span> {strategy.expected_ctr.toFixed(1)}%</p>
                </div>
                <div className="mt-2 space-y-1">
                  {strategy.allocations.map((a, i) => (
                    <div key={i} className="flex justify-between text-xs bg-white/60 px-2 py-1 rounded">
                      <span>{a.creative_name}</span>
                      <span className="font-medium">{a.allocation_percentage}% · {a.recommended_placement}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Button className="w-full" onClick={() => createCampaignMutation.mutate()}
              loading={createCampaignMutation.isPending} disabled={!budget || selectedCreatives.length === 0}>
              캠페인 생성
            </Button>
          </div>
        </Card>
      </div>

      {/* 캠페인 목록 + 관리 */}
      <div className="lg:col-span-2">
        <Card variant="bordered">
          <div className="flex items-center justify-between mb-4">
            <CardTitle>내 캠페인</CardTitle>
            <button onClick={() => refetchCampaigns()} className="text-gray-400 hover:text-gray-600">
              <RefreshCw size={16} />
            </button>
          </div>

          {campaigns && campaigns.length > 0 ? (
            <div className="space-y-4">
              {campaigns.map((campaign) => (
                <CampaignCard
                  key={campaign.id}
                  campaign={campaign}
                  onPublish={() => publishMutation.mutate(campaign.id)}
                  onViewAnalytics={() => handleViewAnalytics(campaign)}
                  isPublishing={publishMutation.isPending}
                  onRefresh={refetchCampaigns}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-16 text-gray-400">
              <Target size={48} className="mx-auto mb-3 opacity-50" />
              <p>아직 생성된 캠페인이 없습니다</p>
              <p className="text-sm mt-1">소재를 선택하고 캠페인을 생성해보세요</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function CampaignCard({
  campaign, onPublish, onViewAnalytics, isPublishing, onRefresh,
}: {
  campaign: Campaign; onPublish: () => void; onViewAnalytics: () => void;
  isPublishing: boolean; onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editBudget, setEditBudget] = useState('');

  const activateMutation = useMutation({
    mutationFn: () => campaignApi.activate(campaign.id),
    onSuccess: () => { onRefresh(); toast.success('캠페인 활성화됨'); },
    onError: () => toast.error('활성화 실패'),
  });

  const pauseMutation = useMutation({
    mutationFn: () => campaignApi.pause(campaign.id),
    onSuccess: () => { onRefresh(); toast.success('캠페인 일시정지됨'); },
    onError: () => toast.error('일시정지 실패'),
  });

  const budgetMutation = useMutation({
    mutationFn: () => campaignApi.updateBudget(campaign.id, undefined, Number(editBudget)),
    onSuccess: () => { onRefresh(); toast.success('예산 변경됨'); setEditBudget(''); },
    onError: () => toast.error('예산 변경 실패'),
  });

  const toggleAdMutation = useMutation({
    mutationFn: ({ adId, action }: { adId: number; action: 'activate' | 'pause' }) =>
      campaignApi.toggleAd(campaign.id, adId, action),
    onSuccess: () => { onRefresh(); toast.success('광고 상태 변경됨'); },
    onError: () => toast.error('상태 변경 실패'),
  });

  const syncMutation = useMutation({
    mutationFn: () => campaignApi.syncInsights(campaign.id),
    onSuccess: () => { onRefresh(); toast.success('인사이트 동기화 완료'); },
    onError: () => toast.error('동기화 실패'),
  });

  const statusConfig: Record<string, { color: string; label: string }> = {
    DRAFT: { color: 'bg-gray-100 text-gray-700', label: '초안' },
    PENDING_REVIEW: { color: 'bg-yellow-100 text-yellow-700', label: '검토 대기' },
    ACTIVE: { color: 'bg-green-100 text-green-700', label: '진행중' },
    PAUSED: { color: 'bg-orange-100 text-orange-700', label: '일시정지' },
    COMPLETED: { color: 'bg-blue-100 text-blue-700', label: '완료' },
  };

  const sc = statusConfig[campaign.status] || statusConfig.DRAFT;
  const spentPct = campaign.total_budget > 0 ? (campaign.spent_amount / campaign.total_budget) * 100 : 0;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-medium text-gray-900">{campaign.name}</h3>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${sc.color}`}>{sc.label}</span>
              {campaign.meta_campaign_id && (
                <span className="flex items-center gap-1 text-xs text-green-600">
                  <CheckCircle size={12} /> Meta
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500">
              {campaign.objective === 'TRAFFIC' ? '트래픽' : campaign.objective === 'CONVERSIONS' ? '전환' : '리드'}
              {' · '}{campaign.ads.length}개 광고
            </p>
          </div>
          <button onClick={() => setExpanded(!expanded)} className="text-gray-400 hover:text-gray-600 p-1">
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>

        {/* 예산 진행바 */}
        <div className="mb-3">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-500">₩{campaign.spent_amount.toLocaleString()} / ₩{campaign.total_budget.toLocaleString()}</span>
            <span className="font-medium">{spentPct.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-primary-500 rounded-full transition-all" style={{ width: `${Math.min(spentPct, 100)}%` }} />
          </div>
        </div>

        {/* 액션 버튼 */}
        <div className="flex flex-wrap gap-2">
          {campaign.status === 'DRAFT' && (
            <Button size="sm" onClick={onPublish} loading={isPublishing}>
              <Upload size={14} className="mr-1" /> Meta 발행
            </Button>
          )}
          {campaign.status === 'ACTIVE' && (
            <Button size="sm" variant="outline" onClick={() => pauseMutation.mutate()} loading={pauseMutation.isPending}>
              <Pause size={14} className="mr-1" /> 일시정지
            </Button>
          )}
          {campaign.status === 'PAUSED' && (
            <Button size="sm" onClick={() => activateMutation.mutate()} loading={activateMutation.isPending}>
              <Play size={14} className="mr-1" /> 재개
            </Button>
          )}
          {(campaign.status === 'ACTIVE' || campaign.status === 'PAUSED') && (
            <>
              <Button size="sm" variant="outline" onClick={() => syncMutation.mutate()} loading={syncMutation.isPending}>
                <RefreshCw size={14} className="mr-1" /> 인사이트 동기화
              </Button>
              <Button size="sm" variant="outline" onClick={onViewAnalytics}>
                성과 분석
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 확장 영역: 예산 변경 + 광고 ON/OFF */}
      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50 p-4 space-y-4">
          {/* 예산 변경 */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">예산 변경</p>
            <div className="flex gap-2">
              <input type="number" placeholder="새 총 예산" value={editBudget} onChange={(e) => setEditBudget(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <Button size="sm" onClick={() => budgetMutation.mutate()} loading={budgetMutation.isPending} disabled={!editBudget}>
                변경
              </Button>
            </div>
          </div>

          {/* 광고 ON/OFF */}
          {campaign.ads.length > 0 && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">광고 관리</p>
              <div className="space-y-2">
                {campaign.ads.map((ad) => (
                  <div key={ad.id} className="flex items-center justify-between p-2 bg-white rounded-lg">
                    <div>
                      <p className="text-sm font-medium">{ad.name}</p>
                      <p className="text-xs text-gray-500">배분: {ad.budget_percentage}% · {ad.status}</p>
                    </div>
                    <button
                      onClick={() => toggleAdMutation.mutate({
                        adId: ad.id,
                        action: ad.status === 'ACTIVE' ? 'pause' : 'activate'
                      })}
                      className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                        ad.status === 'ACTIVE'
                          ? 'bg-green-100 text-green-700 hover:bg-orange-100 hover:text-orange-700'
                          : 'bg-gray-100 text-gray-600 hover:bg-green-100 hover:text-green-700'
                      }`}>
                      {ad.status === 'ACTIVE' ? 'ON' : 'OFF'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
