'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { TrendingUp, DollarSign, MousePointer, ShoppingCart, Zap, RefreshCw, Lightbulb } from 'lucide-react';
import { Button, Card, CardTitle, Select } from '@/components/ui';
import { analyticsApi, campaignApi } from '@/lib/api';
import { useAppStore } from '@/store';
import type { PerformanceDashboard as DashboardData, AIInsight } from '@/types';
import toast from 'react-hot-toast';

export function PerformanceDashboard() {
  const { selectedCampaign, setSelectedStyle, setActiveTab } = useAppStore();
  const [days, setDays] = useState(7);
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(selectedCampaign?.id || null);

  const { data: campaigns } = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => campaignApi.list(),
  });

  const { data: dashboard, isLoading, refetch } = useQuery({
    queryKey: ['dashboard', selectedCampaignId, days],
    queryFn: () => analyticsApi.getDashboard(selectedCampaignId!, days),
    enabled: !!selectedCampaignId,
  });

  const reallocateMutation = useMutation({
    mutationFn: () => analyticsApi.reallocateBudget(selectedCampaignId!, true, true),
    onSuccess: (data) => {
      if (data.success) {
        toast.success('예산 재배분 완료');
        refetch();
      }
    },
    onError: () => toast.error('예산 재배분 실패'),
  });

  const learnMutation = useMutation({
    mutationFn: () => analyticsApi.learnFromPerformance(selectedCampaignId!, true),
    onSuccess: (data) => {
      if (data.winning_style) {
        setSelectedStyle(data.winning_style as any, null);
        toast.success('성공 패턴을 학습했습니다');
      }
    },
    onError: () => toast.error('학습 실패'),
  });

  const handleLearnAndCreate = () => {
    learnMutation.mutate();
    setActiveTab(0); // Market Intelligence로 이동
  };

  if (!selectedCampaignId) {
    return (
      <Card variant="bordered">
        <div className="text-center py-12">
          <TrendingUp size={48} className="mx-auto mb-4 text-gray-400" />
          {campaigns && campaigns.length > 0 ? (
            <>
              <h3 className="text-lg font-medium mb-2">캠페인을 선택하세요</h3>
              <p className="text-gray-500 mb-4">분석할 캠페인을 선택하면 성과 대시보드가 표시됩니다</p>
              <div className="max-w-xs mx-auto space-y-2">
                {campaigns.map((c) => (
                  <button key={c.id} onClick={() => setSelectedCampaignId(c.id)}
                    className="w-full text-left p-3 border border-gray-200 rounded-lg hover:border-primary-400 hover:bg-primary-50 transition-colors">
                    <p className="font-medium text-sm">{c.name}</p>
                    <p className="text-xs text-gray-500">
                      {c.status === 'ACTIVE' ? '진행중' : c.status === 'DRAFT' ? '초안' : c.status === 'PAUSED' ? '일시정지' : c.status}
                      {' · '}₩{c.total_budget.toLocaleString()}
                    </p>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <h3 className="text-lg font-medium mb-2">아직 캠페인이 없습니다</h3>
              <p className="text-gray-500 mb-4">광고 집행 탭에서 캠페인을 생성하면 여기서 성과를 분석할 수 있습니다</p>
              <Button variant="outline" onClick={() => setActiveTab(3)}>
                광고 집행 탭으로 이동
              </Button>
            </>
          )}
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Select
            options={campaigns?.map((c) => ({ value: String(c.id), label: c.name })) || []}
            value={String(selectedCampaignId)}
            onChange={(e) => setSelectedCampaignId(Number(e.target.value))}
            className="w-48"
          />
          <Select
            options={[
              { value: '7', label: '최근 7일' },
              { value: '14', label: '최근 14일' },
              { value: '30', label: '최근 30일' },
            ]}
            value={String(days)}
            onChange={(e) => setDays(Number(e.target.value))}
            className="w-32"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw size={14} className="mr-1" />
          새로고침
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-12">로딩 중...</div>
      ) : dashboard ? (
        <>
          {/* KPI 카드 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPICard
              icon={<DollarSign size={20} />}
              label="총 지출"
              value={`₩${dashboard.kpi_summary.total_spend.toLocaleString()}`}
              color="blue"
            />
            <KPICard
              icon={<TrendingUp size={20} />}
              label="ROAS"
              value={`${(dashboard.kpi_summary.roas * 100).toFixed(1)}%`}
              color="green"
            />
            <KPICard
              icon={<MousePointer size={20} />}
              label="CTR"
              value={`${dashboard.kpi_summary.ctr.toFixed(2)}%`}
              color="purple"
            />
            <KPICard
              icon={<ShoppingCart size={20} />}
              label="CPC"
              value={`₩${dashboard.kpi_summary.cpc.toFixed(0)}`}
              color="orange"
            />
          </div>

          {/* 차트 */}
          <div className="grid lg:grid-cols-2 gap-6">
            <Card variant="bordered">
              <CardTitle className="mb-4">일별 성과 추이</CardTitle>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dashboard.daily_trend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="spend" stroke="#3b82f6" name="지출" />
                    <Line type="monotone" dataKey="clicks" stroke="#10b981" name="클릭" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card variant="bordered">
              <CardTitle className="mb-4">소재별 성과</CardTitle>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dashboard.creative_performance}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="creative_name" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="roas" fill="#3b82f6" name="ROAS" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {/* A/B 테스트 비교 */}
          {dashboard.comparison && (
            <Card variant="bordered" className="bg-gradient-to-r from-green-50 to-blue-50">
              <CardTitle className="flex items-center gap-2 mb-4">
                <Zap size={20} className="text-yellow-500" />
                A/B 테스트 결과
              </CardTitle>
              <p className="text-lg mb-4">{dashboard.comparison.recommendation}</p>
              <div className="grid md:grid-cols-2 gap-6">
                <div className="p-4 bg-white rounded-lg border-2 border-green-500">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-2xl">🏆</span>
                    <span className="font-medium">Winner: {dashboard.comparison.winner.creative_name}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>CTR: {dashboard.comparison.winner.ctr.toFixed(2)}%</div>
                    <div>ROAS: {(dashboard.comparison.winner.roas * 100).toFixed(1)}%</div>
                    <div>전환: {dashboard.comparison.winner.conversions}</div>
                    <div>지출: ₩{dashboard.comparison.winner.spend.toLocaleString()}</div>
                  </div>
                </div>
                <div className="p-4 bg-white rounded-lg border border-gray-200">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-medium text-gray-600">{dashboard.comparison.loser.creative_name}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm text-gray-600">
                    <div>CTR: {dashboard.comparison.loser.ctr.toFixed(2)}%</div>
                    <div>ROAS: {(dashboard.comparison.loser.roas * 100).toFixed(1)}%</div>
                    <div>전환: {dashboard.comparison.loser.conversions}</div>
                    <div>지출: ₩{dashboard.comparison.loser.spend.toLocaleString()}</div>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 mt-4">
                <Button onClick={() => reallocateMutation.mutate()} loading={reallocateMutation.isPending}>
                  예산 재배분 적용
                </Button>
              </div>
            </Card>
          )}

          {/* AI 인사이트 */}
          {dashboard.ai_insights.length > 0 && (
            <Card variant="bordered">
              <CardTitle className="flex items-center gap-2 mb-4">
                <Lightbulb size={20} className="text-yellow-500" />
                AI 인사이트
              </CardTitle>
              <div className="space-y-3">
                {dashboard.ai_insights.map((insight, i) => (
                  <InsightCard key={i} insight={insight} />
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-gray-100">
                <Button variant="outline" onClick={handleLearnAndCreate}>
                  이 성과로 다음 기획하기
                </Button>
              </div>
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}

function KPICard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: 'blue' | 'green' | 'purple' | 'orange';
}) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600',
    orange: 'bg-orange-50 text-orange-600',
  };

  return (
    <Card variant="bordered" padding="sm">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${colors[color]}`}>
          {icon}
        </div>
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-xl font-semibold">{value}</p>
        </div>
      </div>
    </Card>
  );
}

function InsightCard({ insight }: { insight: AIInsight }) {
  const typeColors: Record<string, string> = {
    performance: 'bg-blue-100 text-blue-700',
    optimization: 'bg-green-100 text-green-700',
    trend: 'bg-purple-100 text-purple-700',
  };

  return (
    <div className="p-4 bg-gray-50 rounded-lg">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${typeColors[insight.insight_type] || 'bg-gray-100 text-gray-700'}`}>
            {insight.insight_type === 'performance' ? '성과' : insight.insight_type === 'optimization' ? '최적화' : '트렌드'}
          </span>
          <h4 className="font-medium">{insight.title}</h4>
        </div>
      </div>
      <p className="text-sm text-gray-600">{insight.description}</p>
      {insight.action_available && (
        <Button size="sm" variant="outline" className="mt-2">
          {insight.action_type === 'reallocate_budget' ? '예산 재배분' :
           insight.action_type === 'pause_ad' ? '광고 일시중지' : '적용하기'}
        </Button>
      )}
    </div>
  );
}
