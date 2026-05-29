'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileText, Download, Mail, Calendar, Loader2, Plus,
  Trash2, Clock, BarChart3, Monitor, Layers,
  ChevronDown, ChevronRight, Check, X, RefreshCw,
} from 'lucide-react';
import { naverReportApi, formatNaverCurrency, formatNaverNumber, formatNaverPercent } from '@/lib/naver-api';
import toast from 'react-hot-toast';

type ReportType = 'search' | 'gfa' | 'combined';
type ReportFormat = 'pdf' | 'excel' | 'email';
type ScheduleFrequency = 'daily' | 'weekly' | 'monthly';

const REPORT_TYPES = [
  { value: 'search', label: '검색광고 리포트', icon: BarChart3, desc: '캠페인/키워드 성과' },
  { value: 'gfa', label: 'GFA 리포트', icon: Monitor, desc: '캠페인/크리에이티브 성과' },
  { value: 'combined', label: '통합 리포트', icon: Layers, desc: '검색광고 + GFA 합산' },
];

const METRICS_SEARCH = [
  { value: 'impressions', label: '노출수' },
  { value: 'clicks', label: '클릭수' },
  { value: 'spend', label: '비용' },
  { value: 'ctr', label: 'CTR' },
  { value: 'cpc', label: 'CPC' },
  { value: 'conversions', label: '전환수' },
  { value: 'conversion_value', label: '전환매출' },
  { value: 'roas', label: 'ROAS' },
];

const METRICS_GFA = [
  { value: 'impressions', label: '노출수' },
  { value: 'clicks', label: '클릭수' },
  { value: 'spend', label: '비용' },
  { value: 'ctr', label: 'CTR' },
  { value: 'cpm', label: 'CPM' },
  { value: 'conversions', label: '전환수' },
  { value: 'roas', label: 'ROAS' },
  { value: 'reach', label: '도달' },
];

export function NaverReports() {
  const [activeSection, setActiveSection] = useState<'generate' | 'schedules'>('generate');
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const queryClient = useQueryClient();

  // Report generation form
  const [reportForm, setReportForm] = useState({
    type: 'search' as ReportType,
    format: 'pdf' as ReportFormat,
    startDate: getDefaultStartDate(),
    endDate: getDefaultEndDate(),
    metrics: ['impressions', 'clicks', 'spend', 'ctr', 'conversions'] as string[],
    level: 'campaign' as 'campaign' | 'adgroup' | 'keyword' | 'creative',
    email: '',
  });

  // Schedule form
  const [scheduleForm, setScheduleForm] = useState({
    name: '',
    type: 'search' as ReportType,
    frequency: 'weekly' as ScheduleFrequency,
    email: '',
    metrics: ['impressions', 'clicks', 'spend', 'ctr', 'conversions'] as string[],
    dayOfWeek: 1,
    dayOfMonth: 1,
  });

  // Fetch schedules
  const { data: schedulesData, isLoading: loadingSchedules } = useQuery({
    queryKey: ['naver-report-schedules'],
    queryFn: () => naverReportApi.getSchedules(),
    enabled: activeSection === 'schedules',
    retry: 1,
  });

  const schedules: any[] = schedulesData?.schedules || (Array.isArray(schedulesData) ? schedulesData : []);

  // Generate report mutation
  const generateMutation = useMutation({
    mutationFn: () => naverReportApi.generate({
      type: reportForm.type,
      format: reportForm.format,
      start_date: reportForm.startDate,
      end_date: reportForm.endDate,
      metrics: reportForm.metrics,
      level: reportForm.level,
    }),
    onSuccess: (data) => {
      if (data?.download_url) {
        window.open(data.download_url, '_blank');
      }
      toast.success('리포트가 생성되었습니다!');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || '리포트 생성에 실패했습니다.');
    },
  });

  // Send email mutation
  const emailMutation = useMutation({
    mutationFn: () => naverReportApi.sendEmail({
      type: reportForm.type,
      start_date: reportForm.startDate,
      end_date: reportForm.endDate,
      metrics: reportForm.metrics,
      level: reportForm.level,
      email: reportForm.email,
    }),
    onSuccess: () => {
      toast.success('리포트가 이메일로 발송되었습니다!');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || '이메일 발송에 실패했습니다.');
    },
  });

  // Create schedule mutation
  const createScheduleMutation = useMutation({
    mutationFn: () => naverReportApi.createSchedule({
      name: scheduleForm.name,
      type: scheduleForm.type,
      frequency: scheduleForm.frequency,
      email: scheduleForm.email,
      metrics: scheduleForm.metrics,
      day_of_week: scheduleForm.frequency === 'weekly' ? scheduleForm.dayOfWeek : undefined,
      day_of_month: scheduleForm.frequency === 'monthly' ? scheduleForm.dayOfMonth : undefined,
    }),
    onSuccess: () => {
      toast.success('스케줄이 생성되었습니다!');
      queryClient.invalidateQueries({ queryKey: ['naver-report-schedules'] });
      setShowScheduleForm(false);
      setScheduleForm({ name: '', type: 'search', frequency: 'weekly', email: '', metrics: ['impressions', 'clicks', 'spend', 'ctr', 'conversions'], dayOfWeek: 1, dayOfMonth: 1 });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || '스케줄 생성에 실패했습니다.');
    },
  });

  // Delete schedule mutation
  const deleteScheduleMutation = useMutation({
    mutationFn: (scheduleId: string) => naverReportApi.deleteSchedule(scheduleId),
    onSuccess: () => {
      toast.success('스케줄이 삭제되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['naver-report-schedules'] });
    },
    onError: () => toast.error('스케줄 삭제에 실패했습니다.'),
  });

  const availableMetrics = reportForm.type === 'gfa' ? METRICS_GFA : METRICS_SEARCH;

  const toggleMetric = (metric: string) => {
    const newMetrics = reportForm.metrics.includes(metric)
      ? reportForm.metrics.filter((m) => m !== metric)
      : [...reportForm.metrics, metric];
    setReportForm({ ...reportForm, metrics: newMetrics });
  };

  const toggleScheduleMetric = (metric: string) => {
    const newMetrics = scheduleForm.metrics.includes(metric)
      ? scheduleForm.metrics.filter((m) => m !== metric)
      : [...scheduleForm.metrics, metric];
    setScheduleForm({ ...scheduleForm, metrics: newMetrics });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#F7F8F8] flex items-center gap-2">
            <FileText className="text-[#27A644]" size={28} />
            네이버 리포트
          </h1>
          <p className="text-sm text-[#8A8F98] mt-1">검색광고 / GFA 통합 리포트 생성</p>
        </div>
        <div className="flex items-center bg-[#141516] rounded-lg p-0.5">
          <button
            onClick={() => setActiveSection('generate')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeSection === 'generate' ? 'bg-[#0F1011] shadow-[0px_1px_3px_rgba(0,0,0,0.2)] text-[#27A644]' : 'text-[#8A8F98] hover:text-[#D0D6E0]'
            }`}
          >
            리포트 생성
          </button>
          <button
            onClick={() => setActiveSection('schedules')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeSection === 'schedules' ? 'bg-[#0F1011] shadow-[0px_1px_3px_rgba(0,0,0,0.2)] text-[#27A644]' : 'text-[#8A8F98] hover:text-[#D0D6E0]'
            }`}
          >
            스케줄 리포트
          </button>
        </div>
      </div>

      {/* Report Generation */}
      {activeSection === 'generate' && (
        <div className="space-y-6">
          {/* Report Type */}
          <div className="bg-[#0F1011] rounded-xl border border-[#23252A] p-6">
            <h2 className="text-base font-semibold text-[#F7F8F8] mb-4">리포트 유형</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {REPORT_TYPES.map((type) => {
                const Icon = type.icon;
                return (
                  <button
                    key={type.value}
                    onClick={() => setReportForm({ ...reportForm, type: type.value as ReportType })}
                    className={`p-4 rounded-lg border text-left transition-colors ${
                      reportForm.type === type.value
                        ? 'border-[#27A644] bg-[#27A644]/10'
                        : 'border-[#23252A] hover:border-[#23252A]'
                    }`}
                  >
                    <Icon size={24} className={reportForm.type === type.value ? 'text-[#27A644]' : 'text-[#62666D]'} />
                    <p className="text-sm font-medium text-[#F7F8F8] mt-2">{type.label}</p>
                    <p className="text-xs text-[#8A8F98] mt-0.5">{type.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Date Range & Format */}
          <div className="bg-[#0F1011] rounded-xl border border-[#23252A] p-6">
            <h2 className="text-base font-semibold text-[#F7F8F8] mb-4">기간 및 형식</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#D0D6E0] mb-1">시작일</label>
                <input
                  type="date"
                  value={reportForm.startDate}
                  onChange={(e) => setReportForm({ ...reportForm, startDate: e.target.value })}
                  className="w-full rounded-lg border border-[#23252A] px-4 py-2 text-sm focus:border-[#27A644] focus:ring-1 focus:ring-green-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#D0D6E0] mb-1">종료일</label>
                <input
                  type="date"
                  value={reportForm.endDate}
                  onChange={(e) => setReportForm({ ...reportForm, endDate: e.target.value })}
                  className="w-full rounded-lg border border-[#23252A] px-4 py-2 text-sm focus:border-[#27A644] focus:ring-1 focus:ring-green-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#D0D6E0] mb-1">분석 수준</label>
                <select
                  value={reportForm.level}
                  onChange={(e) => setReportForm({ ...reportForm, level: e.target.value as any })}
                  className="w-full rounded-lg border border-[#23252A] px-3 py-2 text-sm bg-[#0F1011] focus:border-[#27A644] focus:ring-1 focus:ring-green-500 focus:outline-none"
                >
                  <option value="campaign">캠페인별</option>
                  <option value="adgroup">광고그룹별</option>
                  {reportForm.type === 'search' && <option value="keyword">키워드별</option>}
                  {reportForm.type === 'gfa' && <option value="creative">크리에이티브별</option>}
                </select>
              </div>
            </div>
          </div>

          {/* Metrics Selection */}
          <div className="bg-[#0F1011] rounded-xl border border-[#23252A] p-6">
            <h2 className="text-base font-semibold text-[#F7F8F8] mb-4">지표 선택</h2>
            <div className="flex flex-wrap gap-2">
              {availableMetrics.map((metric) => (
                <button
                  key={metric.value}
                  onClick={() => toggleMetric(metric.value)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    reportForm.metrics.includes(metric.value)
                      ? 'bg-[#27A644]/15 text-[#27A644] border border-green-300'
                      : 'bg-[#141516] text-[#8A8F98] border border-[#23252A] hover:border-[#23252A]'
                  }`}
                >
                  {metric.label}
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="bg-[#0F1011] rounded-xl border border-[#23252A] p-6">
            <h2 className="text-base font-semibold text-[#F7F8F8] mb-4">리포트 생성</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* PDF Download */}
              <button
                onClick={() => {
                  setReportForm({ ...reportForm, format: 'pdf' });
                  generateMutation.mutate();
                }}
                disabled={generateMutation.isPending}
                className="flex items-center justify-center gap-2 p-4 border border-[#23252A] rounded-lg text-sm font-medium text-[#D0D6E0] hover:bg-[#141516]/5 transition-colors disabled:opacity-50"
              >
                {generateMutation.isPending && reportForm.format === 'pdf' ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Download size={18} className="text-[#EB5757]" />
                )}
                PDF 다운로드
              </button>
              {/* Excel Download */}
              <button
                onClick={() => {
                  setReportForm({ ...reportForm, format: 'excel' });
                  generateMutation.mutate();
                }}
                disabled={generateMutation.isPending}
                className="flex items-center justify-center gap-2 p-4 border border-[#23252A] rounded-lg text-sm font-medium text-[#D0D6E0] hover:bg-[#141516]/5 transition-colors disabled:opacity-50"
              >
                {generateMutation.isPending && reportForm.format === 'excel' ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Download size={18} className="text-[#27A644]" />
                )}
                Excel 다운로드
              </button>
              {/* Email */}
              <div className="flex gap-2">
                <input
                  type="email"
                  value={reportForm.email}
                  onChange={(e) => setReportForm({ ...reportForm, email: e.target.value })}
                  className="flex-1 rounded-lg border border-[#23252A] px-3 py-2 text-sm focus:border-[#27A644] focus:ring-1 focus:ring-green-500 focus:outline-none"
                  placeholder="email@example.com"
                />
                <button
                  onClick={() => {
                    if (!reportForm.email) { toast.error('이메일을 입력해주세요.'); return; }
                    emailMutation.mutate();
                  }}
                  disabled={emailMutation.isPending}
                  className="flex items-center gap-1 px-4 py-2 bg-[#27A644] text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                >
                  {emailMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
                  발송
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Reports */}
      {activeSection === 'schedules' && (
        <div className="space-y-6">
          {/* Create Schedule */}
          <div className="flex justify-end">
            <button
              onClick={() => setShowScheduleForm(!showScheduleForm)}
              className="flex items-center gap-2 px-4 py-2 bg-[#27A644] text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
            >
              <Plus size={16} />
              스케줄 추가
            </button>
          </div>

          {showScheduleForm && (
            <div className="bg-[#0F1011] rounded-xl border border-[#23252A] p-6">
              <h2 className="text-base font-semibold text-[#F7F8F8] mb-4 flex items-center gap-2">
                <Calendar size={18} className="text-[#27A644]" />
                새 스케줄 리포트
              </h2>
              <div className="max-w-lg space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#D0D6E0] mb-1">스케줄명</label>
                  <input
                    type="text"
                    value={scheduleForm.name}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, name: e.target.value })}
                    className="w-full rounded-lg border border-[#23252A] px-4 py-2 text-sm focus:border-[#27A644] focus:ring-1 focus:ring-green-500 focus:outline-none"
                    placeholder="예: 주간 검색광고 리포트"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[#D0D6E0] mb-1">리포트 유형</label>
                    <select
                      value={scheduleForm.type}
                      onChange={(e) => setScheduleForm({ ...scheduleForm, type: e.target.value as ReportType })}
                      className="w-full rounded-lg border border-[#23252A] px-3 py-2 text-sm bg-[#0F1011] focus:border-[#27A644] focus:ring-1 focus:ring-green-500 focus:outline-none"
                    >
                      {REPORT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#D0D6E0] mb-1">발송 주기</label>
                    <select
                      value={scheduleForm.frequency}
                      onChange={(e) => setScheduleForm({ ...scheduleForm, frequency: e.target.value as ScheduleFrequency })}
                      className="w-full rounded-lg border border-[#23252A] px-3 py-2 text-sm bg-[#0F1011] focus:border-[#27A644] focus:ring-1 focus:ring-green-500 focus:outline-none"
                    >
                      <option value="daily">매일</option>
                      <option value="weekly">매주</option>
                      <option value="monthly">매월</option>
                    </select>
                  </div>
                </div>
                {scheduleForm.frequency === 'weekly' && (
                  <div>
                    <label className="block text-sm font-medium text-[#D0D6E0] mb-1">요일</label>
                    <select
                      value={scheduleForm.dayOfWeek}
                      onChange={(e) => setScheduleForm({ ...scheduleForm, dayOfWeek: Number(e.target.value) })}
                      className="w-full rounded-lg border border-[#23252A] px-3 py-2 text-sm bg-[#0F1011] focus:border-[#27A644] focus:ring-1 focus:ring-green-500 focus:outline-none"
                    >
                      <option value={1}>월요일</option>
                      <option value={2}>화요일</option>
                      <option value={3}>수요일</option>
                      <option value={4}>목요일</option>
                      <option value={5}>금요일</option>
                      <option value={6}>토요일</option>
                      <option value={0}>일요일</option>
                    </select>
                  </div>
                )}
                {scheduleForm.frequency === 'monthly' && (
                  <div>
                    <label className="block text-sm font-medium text-[#D0D6E0] mb-1">날짜</label>
                    <select
                      value={scheduleForm.dayOfMonth}
                      onChange={(e) => setScheduleForm({ ...scheduleForm, dayOfMonth: Number(e.target.value) })}
                      className="w-full rounded-lg border border-[#23252A] px-3 py-2 text-sm bg-[#0F1011] focus:border-[#27A644] focus:ring-1 focus:ring-green-500 focus:outline-none"
                    >
                      {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                        <option key={d} value={d}>{d}일</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-[#D0D6E0] mb-1">수신 이메일</label>
                  <input
                    type="email"
                    value={scheduleForm.email}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, email: e.target.value })}
                    className="w-full rounded-lg border border-[#23252A] px-4 py-2 text-sm focus:border-[#27A644] focus:ring-1 focus:ring-green-500 focus:outline-none"
                    placeholder="report@example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#D0D6E0] mb-2">포함 지표</label>
                  <div className="flex flex-wrap gap-2">
                    {(scheduleForm.type === 'gfa' ? METRICS_GFA : METRICS_SEARCH).map((metric) => (
                      <button
                        key={metric.value}
                        onClick={() => toggleScheduleMetric(metric.value)}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                          scheduleForm.metrics.includes(metric.value)
                            ? 'bg-[#27A644]/15 text-[#27A644] border border-green-300'
                            : 'bg-[#141516] text-[#8A8F98] border border-[#23252A] hover:border-[#23252A]'
                        }`}
                      >
                        {metric.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between pt-2">
                  <button
                    onClick={() => setShowScheduleForm(false)}
                    className="px-4 py-2 border border-[#23252A] rounded-lg text-sm font-medium text-[#D0D6E0] hover:bg-[#141516]/5"
                  >
                    취소
                  </button>
                  <button
                    onClick={() => {
                      if (!scheduleForm.name) { toast.error('스케줄명을 입력해주세요.'); return; }
                      if (!scheduleForm.email) { toast.error('이메일을 입력해주세요.'); return; }
                      createScheduleMutation.mutate();
                    }}
                    disabled={createScheduleMutation.isPending}
                    className="flex items-center gap-2 px-4 py-2 bg-[#27A644] text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                  >
                    {createScheduleMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                    스케줄 생성
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Schedules List */}
          <div className="bg-[#0F1011] rounded-xl border border-[#23252A] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#23252A]">
              <h2 className="text-base font-semibold text-[#F7F8F8] flex items-center gap-2">
                <Calendar size={18} className="text-[#27A644]" />
                등록된 스케줄
              </h2>
            </div>
            {loadingSchedules ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="animate-spin text-[#27A644]" size={24} />
                <span className="ml-2 text-[#8A8F98]">로딩 중...</span>
              </div>
            ) : schedules.length === 0 ? (
              <div className="text-center py-12 text-[#8A8F98]">
                <Calendar size={48} className="mx-auto mb-3 text-[#62666D]" />
                <p>등록된 스케줄이 없습니다.</p>
                <button
                  onClick={() => setShowScheduleForm(true)}
                  className="mt-4 px-4 py-2 bg-[#27A644] text-white rounded-lg text-sm font-medium hover:bg-green-700"
                >
                  첫 스케줄 만들기
                </button>
              </div>
            ) : (
              <div className="divide-y divide-[#23252A]">
                {schedules.map((sched: any) => {
                  const schedId = sched.id || sched.schedule_id;
                  const typeLabel = REPORT_TYPES.find((t) => t.value === sched.type)?.label || sched.type;
                  const freqLabel = sched.frequency === 'daily' ? '매일' : sched.frequency === 'weekly' ? '매주' : '매월';
                  return (
                    <div key={schedId} className="px-6 py-4 hover:bg-[#141516]/5 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-[#F7F8F8]">{sched.name}</p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-[#8A8F98]">
                          <span className="px-1.5 py-0.5 bg-[#27A644]/10 text-[#27A644] rounded">{typeLabel}</span>
                          <span className="flex items-center gap-1">
                            <Clock size={12} />
                            {freqLabel}
                          </span>
                          <span className="flex items-center gap-1">
                            <Mail size={12} />
                            {sched.email}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          if (confirm('이 스케줄을 삭제하시겠습니까?')) {
                            deleteScheduleMutation.mutate(schedId);
                          }
                        }}
                        className="p-1.5 text-red-400 hover:text-[#EB5757] hover:bg-[#EB5757]/10 rounded"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Helper functions
function getDefaultStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

function getDefaultEndDate(): string {
  return new Date().toISOString().slice(0, 10);
}
