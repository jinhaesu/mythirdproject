'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Target, DollarSign, Zap, Upload, CheckCircle, AlertCircle } from 'lucide-react';
import { Button, Input, Card, CardTitle, Select } from '@/components/ui';
import { campaignApi } from '@/lib/api';
import { useAppStore } from '@/store';
import type { Campaign, StrategyRecommendation } from '@/types';
import toast from 'react-hot-toast';

export function AdsController() {
  const { selectedCreatives, setSelectedCampaign, setActiveTab } = useAppStore();

  const [campaignName, setCampaignName] = useState('');
  const [objective, setObjective] = useState<'TRAFFIC' | 'CONVERSIONS' | 'LEAD_GENERATION'>('TRAFFIC');
  const [budget, setBudget] = useState('');
  const [strategy, setStrategy] = useState<StrategyRecommendation | null>(null);

  const { data: campaigns, refetch: refetchCampaigns } = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => campaignApi.list(),
  });

  const strategyMutation = useMutation({
    mutationFn: () => campaignApi.getStrategy(
      Number(budget),
      selectedCreatives.map((c) => c.id)
    ),
    onSuccess: (data) => {
      setStrategy(data);
      toast.success('최적 전략 분석 완료');
    },
    onError: () => toast.error('전략 분석 실패'),
  });

  const createCampaignMutation = useMutation({
    mutationFn: () => campaignApi.create({
      name: campaignName || `캠페인 ${new Date().toLocaleDateString()}`,
      objective,
      total_budget: Number(budget),
      creative_ids: selectedCreatives.map((c) => c.id),
    }),
    onSuccess: (data) => {
      refetchCampaigns();
      toast.success('캠페인 생성 완료');
    },
    onError: () => toast.error('캠페인 생성 실패'),
  });

  const publishMutation = useMutation({
    mutationFn: (campaignId: number) => campaignApi.publish(campaignId),
    onSuccess: (data) => {
      if (data.success) {
        refetchCampaigns();
        toast.success(data.message);
      } else {
        toast.error(data.message);
      }
    },
    onError: () => toast.error('발행 실패'),
  });

  const handleViewAnalytics = (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    setActiveTab(3); // Performance Dashboard로 이동
  };

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      {/* 캠페인 설정 */}
      <div className="lg:col-span-1 space-y-6">
        <Card variant="bordered">
          <CardTitle className="flex items-center gap-2 mb-4">
            <Target size={20} />
            캠페인 설정 마법사
          </CardTitle>

          <div className="space-y-4">
            <Input
              label="캠페인명"
              placeholder="캠페인 이름 입력"
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">목표 선택</label>
              <div className="space-y-2">
                {[
                  { value: 'TRAFFIC', label: '트래픽 증대', desc: '웹사이트 방문 유도' },
                  { value: 'CONVERSIONS', label: '구매 전환', desc: '상품 구매 유도' },
                  { value: 'LEAD_GENERATION', label: '잠재 고객 확보', desc: '리드 수집' },
                ].map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      objective === opt.value ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="objective"
                      value={opt.value}
                      checked={objective === opt.value}
                      onChange={(e) => setObjective(e.target.value as any)}
                      className="mt-1"
                    />
                    <div>
                      <p className="font-medium text-sm">{opt.label}</p>
                      <p className="text-xs text-gray-500">{opt.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">선택된 소재</label>
              {selectedCreatives.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {selectedCreatives.map((creative) => (
                    <div key={creative.id} className="flex items-center gap-2 px-2 py-1 bg-gray-100 rounded text-sm">
                      <img
                        src={creative.thumbnail_url || creative.file_url || '/placeholder.png'}
                        alt=""
                        className="w-6 h-6 rounded object-cover"
                      />
                      <span className="truncate max-w-[100px]">{creative.name}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500">Creative Studio에서 소재를 선택해주세요</p>
              )}
            </div>
          </div>
        </Card>

        <Card variant="bordered">
          <CardTitle className="flex items-center gap-2 mb-4">
            <DollarSign size={20} />
            예산 및 전략
          </CardTitle>

          <div className="space-y-4">
            <Input
              label="총 예산 (원)"
              type="number"
              placeholder="1000000"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              leftIcon={<span className="text-sm">₩</span>}
            />

            <Button
              className="w-full"
              variant="outline"
              onClick={() => strategyMutation.mutate()}
              loading={strategyMutation.isPending}
              disabled={!budget || selectedCreatives.length === 0}
            >
              <Zap size={16} className="mr-2" />
              최적 전략 조회
            </Button>

            {strategy && (
              <div className="p-4 bg-gradient-to-r from-blue-50 to-green-50 rounded-lg">
                <p className="text-sm font-medium text-gray-900 mb-2">AI 추천 전략</p>
                <p className="text-sm text-gray-700 mb-3">{strategy.reasoning}</p>
                <div className="space-y-2 text-sm">
                  <p><span className="font-medium">타겟:</span> {strategy.target_audience_summary}</p>
                  <p><span className="font-medium">예상 도달:</span> {strategy.expected_reach.toLocaleString()}명</p>
                  <p><span className="font-medium">예상 CTR:</span> {strategy.expected_ctr.toFixed(1)}%</p>
                </div>
                <div className="mt-3 space-y-1">
                  {strategy.allocations.map((alloc, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span>{alloc.creative_name}</span>
                      <span className="font-medium">{alloc.allocation_percentage}% ({alloc.recommended_placement})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Button
              className="w-full"
              onClick={() => createCampaignMutation.mutate()}
              loading={createCampaignMutation.isPending}
              disabled={!budget || selectedCreatives.length === 0}
            >
              캠페인 생성
            </Button>
          </div>
        </Card>
      </div>

      {/* 캠페인 목록 */}
      <div className="lg:col-span-2">
        <Card variant="bordered">
          <CardTitle className="mb-4">내 캠페인</CardTitle>

          {campaigns && campaigns.length > 0 ? (
            <div className="space-y-4">
              {campaigns.map((campaign) => (
                <CampaignCard
                  key={campaign.id}
                  campaign={campaign}
                  onPublish={() => publishMutation.mutate(campaign.id)}
                  onViewAnalytics={() => handleViewAnalytics(campaign)}
                  isPublishing={publishMutation.isPending}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <Target size={48} className="mx-auto mb-4 opacity-50" />
              <p>아직 생성된 캠페인이 없습니다</p>
              <p className="text-sm">소재를 선택하고 캠페인을 생성해보세요</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function CampaignCard({
  campaign,
  onPublish,
  onViewAnalytics,
  isPublishing,
}: {
  campaign: Campaign;
  onPublish: () => void;
  onViewAnalytics: () => void;
  isPublishing: boolean;
}) {
  const statusColors: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-700',
    PENDING_REVIEW: 'bg-yellow-100 text-yellow-700',
    ACTIVE: 'bg-green-100 text-green-700',
    PAUSED: 'bg-orange-100 text-orange-700',
    COMPLETED: 'bg-blue-100 text-blue-700',
  };

  const statusLabels: Record<string, string> = {
    DRAFT: '초안',
    PENDING_REVIEW: '검토 대기',
    ACTIVE: '진행중',
    PAUSED: '일시중지',
    COMPLETED: '완료',
  };

  return (
    <div className="p-4 border border-gray-200 rounded-lg">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-medium">{campaign.name}</h3>
          <p className="text-sm text-gray-500">
            {campaign.objective === 'TRAFFIC' ? '트래픽' : campaign.objective === 'CONVERSIONS' ? '전환' : '리드'}
            {' • '}
            {campaign.ads.length}개 광고
          </p>
        </div>
        <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors[campaign.status]}`}>
          {statusLabels[campaign.status]}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
        <div>
          <p className="text-gray-500">총 예산</p>
          <p className="font-medium">₩{campaign.total_budget.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-gray-500">지출</p>
          <p className="font-medium">₩{campaign.spent_amount.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-gray-500">집행률</p>
          <p className="font-medium">{((campaign.spent_amount / campaign.total_budget) * 100).toFixed(1)}%</p>
        </div>
      </div>

      <div className="flex gap-2">
        {campaign.status === 'DRAFT' && (
          <Button size="sm" onClick={onPublish} loading={isPublishing}>
            <Upload size={14} className="mr-1" />
            Meta에 발행하기
          </Button>
        )}
        {campaign.status === 'ACTIVE' && (
          <Button size="sm" variant="outline" onClick={onViewAnalytics}>
            성과 분석 보기
          </Button>
        )}
        {campaign.meta_campaign_id && (
          <span className="flex items-center gap-1 text-xs text-green-600">
            <CheckCircle size={12} />
            Meta 연동됨
          </span>
        )}
      </div>
    </div>
  );
}
