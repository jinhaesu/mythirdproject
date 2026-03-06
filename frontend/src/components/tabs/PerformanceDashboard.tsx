'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import {
  TrendingUp, DollarSign, MousePointer, ShoppingCart, Zap, RefreshCw, Lightbulb,
  Calendar, Mail, FileText, Database, ArrowRight
} from 'lucide-react';
import { Button, Card, CardTitle, Select, Input } from '@/components/ui';
import { analyticsApi, campaignApi } from '@/lib/api';
import { useAppStore } from '@/store';
import type { PerformanceDashboard as DashboardData, AIInsight, MetaCampaign } from '@/types';
import toast from 'react-hot-toast';

export function PerformanceDashboard() {
  const { selectedCampaign, setSelectedStyle, setActiveTab } = useAppStore();
  const [days, setDays] = useState(7);
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(selectedCampaign?.id || null);
  const [showReport, setShowReport] = useState(false);
  const [reportStartDate, setReportStartDate] = useState('');
  const [reportEndDate, setReportEndDate] = useState('');
  const [reportEmail, setReportEmail] = useState('');
  const [reportData, setReportData] = useState<any>(null);
  const [selectedMetaCampaignId, setSelectedMetaCampaignId] = useState<string | null>(null);

  const { data: campaigns } = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => campaignApi.list(),
  });

  // Fetch Meta campaigns
  const { data: metaCampaignsData } = useQuery({
    queryKey: ['meta-campaigns'],
    queryFn: () => analyticsApi.getMetaCampaigns(),
  });

  const metaCampaigns: MetaCampaign[] = metaCampaignsData?.campaigns || [];
  const metaConnected = metaCampaignsData?.connected || false;

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

  const reportMutation = useMutation({
    mutationFn: () => analyticsApi.generateReport({
      campaign_id: selectedCampaignId || undefined,
      meta_campaign_id: selectedMetaCampaignId || undefined,
      start_date: reportStartDate,
      end_date: reportEndDate,
    }),
    onSuccess: (data) => { setReportData(data); toast.success('리포트 생성 완료'); },
    onError: () => toast.error('리포트 생성 실패'),
  });

  const emailMutation = useMutation({
    mutationFn: () => analyticsApi.sendReportEmail({
      campaign_id: selectedCampaignId || undefined,
      meta_campaign_id: selectedMetaCampaignId || undefined,
      start_date: reportStartDate,
      end_date: reportEndDate,
      email: reportEmail,
    }),
    onSuccess: () => toast.success('리포트가 이메일로 발송되었습니다!'),
    onError: (err: any) => toast.error(err?.response?.data?.detail || '이메일 발송 실패'),
  });

  const handleLearnAndCreate = () => {
    learnMutation.mutate();
    setActiveTab(0);
  };

  // Show Meta campaigns section if connected
  const hasNoSelection = !selectedCampaignId;

  return (
    <div className="space-y-6">
      {/* Meta 연동 캠페인 자동 표시 */}
      {metaConnected && metaCampaigns.length > 0 && (
        <Card variant="bordered" className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
          <CardTitle className="flex items-center gap-2 mb-3">
            <Database size={18} className="text-blue-600" />
            Meta 광고 캠페인 (실시간)
          </CardTitle>
          <div className="space-y-2">
            {metaCampaigns.map((camp) => (
              <div key={camp.id}
                className={`p-3 rounded-lg border cursor-pointer transition-all ${
                  selectedMetaCampaignId === camp.id
                    ? 'bg-white border-blue-400 shadow-sm'
                    : 'bg-white/50 border-gray-200 hover:border-blue-300'
                }`}
                onClick={() => setSelectedMetaCampaignId(camp.id)}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-sm">{camp.name}</span>
                    <span className={`ml-2 px-1.5 py-0.5 rounded text-xs ${
                      camp.status === 'ACTIVE' ? 'bg-green-100 text-green-700' :
                      camp.status === 'PAUSED' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>{camp.status}</span>
                  </div>
                  {camp.insights && (
                    <div className="flex gap-4 text-xs text-gray-500">
                      <span>지출: ${camp.insights.spend}</span>
                      <span>클릭: {camp.insights.clicks}</span>
                      <span>CTR: {camp.insights.ctr}%</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 미연동 시 안내 */}
      {!metaConnected && hasNoSelection && (!campaigns || campaigns.length === 0) && (
        <Card variant="bordered">
          <div className="text-center py-12">
            <TrendingUp size={48} className="mx-auto mb-4 text-gray-400" />
            <h3 className="text-lg font-medium mb-2">성과 분석을 시작하세요</h3>
            <p className="text-gray-500 mb-4">Meta 계정을 연동하면 실제 캠페인 데이터가 자동으로 표시됩니다</p>
            <div className="flex gap-3 justify-center">
              <Button variant="outline" onClick={() => setActiveTab(3)}>
                광고 집행 탭으로 이동
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* 로컬 캠페인 선택 (기존) */}
      {campaigns && campaigns.length > 0 && !selectedCampaignId && (
        <Card variant="bordered">
          <CardTitle className="mb-3">로컬 캠페인 선택</CardTitle>
          <div className="max-w-xs space-y-2">
            {campaigns.map((c) => (
              <button key={c.id} onClick={() => setSelectedCampaignId(c.id)}
                className="w-full text-left p-3 border border-gray-200 rounded-lg hover:border-primary-400 hover:bg-primary-50 transition-colors">
                <p className="font-medium text-sm">{c.name}</p>
                <p className="text-xs text-gray-500">
                  {c.status === 'ACTIVE' ? '진행중' : c.status === 'DRAFT' ? '초안' : c.status}
                  {' · '}₩{c.total_budget.toLocaleString()}
                </p>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* 기간 리포트 생성 (Part E-3, E-4) */}
      <Card variant="bordered">
        <CardTitle className="flex items-center gap-2 mb-3">
          <FileText size={18} />
          기간별 리포트
        </CardTitle>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">시작일</label>
            <input type="date" value={reportStartDate} onChange={(e) => setReportStartDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">종료일</label>
            <input type="date" value={reportEndDate} onChange={(e) => setReportEndDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <Button onClick={() => reportMutation.mutate()} loading={reportMutation.isPending}
            disabled={!reportStartDate || !reportEndDate}>
            <FileText size={16} className="mr-1" /> 리포트 생성
          </Button>
          <div className="flex gap-2 items-end">
            <div>
              <label className="block text-xs text-gray-500 mb-1">이메일</label>
              <input type="email" placeholder="report@company.com" value={reportEmail}
                onChange={(e) => setReportEmail(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-48" />
            </div>
            <Button variant="outline" onClick={() => emailMutation.mutate()} loading={emailMutation.isPending}
              disabled={!reportStartDate || !reportEndDate || !reportEmail}>
              <Mail size={16} className="mr-1" /> 이메일 발송
            </Button>
          </div>
        </div>

        {/* 리포트 결과 */}
        {reportData?.ai_report && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg">
            <h4 className="font-medium mb-2">AI 분석 리포트</h4>
            <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap text-sm">
              {reportData.ai_report}
            </div>
          </div>
        )}
      </Card>

      {/* 대시보드 (기존 - 캠페인 선택 시) */}
      {selectedCampaignId && (
        <>
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
                <KPICard icon={<DollarSign size={20} />} label="총 지출" value={`₩${dashboard.kpi_summary.total_spend.toLocaleString()}`} color="blue" />
                <KPICard icon={<TrendingUp size={20} />} label="ROAS" value={`${(dashboard.kpi_summary.roas * 100).toFixed(1)}%`} color="green" />
                <KPICard icon={<MousePointer size={20} />} label="CTR" value={`${dashboard.kpi_summary.ctr.toFixed(2)}%`} color="purple" />
                <KPICard icon={<ShoppingCart size={20} />} label="CPC" value={`₩${dashboard.kpi_summary.cpc.toFixed(0)}`} color="orange" />
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
                        <span className="text-2xl">&#127942;</span>
                        <span className="font-medium">Winner: {dashboard.comparison.winner.creative_name}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>CTR: {dashboard.comparison.winner.ctr.toFixed(2)}%</div>
                        <div>ROAS: {(dashboard.comparison.winner.roas * 100).toFixed(1)}%</div>
                      </div>
                    </div>
                    <div className="p-4 bg-white rounded-lg border border-gray-200">
                      <span className="font-medium text-gray-600">{dashboard.comparison.loser.creative_name}</span>
                      <div className="grid grid-cols-2 gap-2 text-sm text-gray-600 mt-2">
                        <div>CTR: {dashboard.comparison.loser.ctr.toFixed(2)}%</div>
                        <div>ROAS: {(dashboard.comparison.loser.roas * 100).toFixed(1)}%</div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4">
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
        </>
      )}
    </div>
  );
}

function KPICard({
  icon, label, value, color,
}: {
  icon: React.ReactNode; label: string; value: string;
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
        <div className={`p-2 rounded-lg ${colors[color]}`}>{icon}</div>
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
