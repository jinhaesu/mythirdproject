'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Shield, Plus, Bot, PlayCircle, Trash2, Clock,
  ToggleLeft, ToggleRight, Calendar, Loader2, Zap,
  ChevronDown, ChevronRight, FileText, Mail,
  TrendingUp, TrendingDown, Award, Target, DollarSign,
  Eye, MousePointer, ArrowUpRight, ArrowDownRight,
  BarChart3, Download, Activity, AlertTriangle, CheckCircle,
} from 'lucide-react';
import { analyticsApi } from '@/lib/api';
import toast from 'react-hot-toast';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

const METRIC_OPTIONS = [
  { value: 'cpc', label: 'CPC' },
  { value: 'ctr', label: 'CTR (%)' },
  { value: 'roas', label: 'ROAS' },
  { value: 'cvr', label: 'CVR (%)' },
  { value: 'cpm', label: 'CPM' },
  { value: 'spend', label: '지출' },
  { value: 'frequency', label: '빈도' },
];

const OPERATOR_OPTIONS = [
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
  { value: 'gte', label: '>=' },
  { value: 'lte', label: '<=' },
];

const OPERATOR_SYMBOL: Record<string, string> = {
  gt: '>',
  lt: '<',
  gte: '>=',
  lte: '<=',
};

const ACTION_OPTIONS = [
  { value: 'pause', label: '자동 중지' },
  { value: 'decrease_budget', label: '예산 감소' },
  { value: 'increase_budget', label: '예산 증가' },
];

const ACTION_KO: Record<string, string> = {
  pause: '자동 중지',
  decrease_budget: '예산 감소',
  increase_budget: '예산 증가',
  paused: '중지됨',
  budget_decreased: '예산 감소됨',
  budget_increased: '예산 증가됨',
};

const METRIC_FORMAT: Record<string, (v: number) => string> = {
  cpc: (v) => `\u20A9${Math.round(v).toLocaleString('ko-KR')}`,
  cpm: (v) => `\u20A9${Math.round(v).toLocaleString('ko-KR')}`,
  spend: (v) => `\u20A9${Math.round(v).toLocaleString('ko-KR')}`,
  ctr: (v) => `${v.toFixed(2)}%`,
  cvr: (v) => `${v.toFixed(2)}%`,
  roas: (v) => `${v.toFixed(2)}`,
  frequency: (v) => `${v.toFixed(2)}`,
};

function formatThreshold(metric: string, value: number): string {
  const fmt = METRIC_FORMAT[metric];
  return fmt ? fmt(value) : String(value);
}

const formatSpend = (v: any) => {
  if (!v) return '\u20A90';
  const n = parseFloat(v);
  if (n >= 10000) return `\u20A9${(n / 10000).toFixed(1)}\uB9CC`;
  return `\u20A9${Math.round(n).toLocaleString('ko-KR')}`;
};
const formatNum = (v: any) => {
  if (!v) return '0';
  const n = parseFloat(v);
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toFixed(n < 10 ? 2 : 0);
};
const formatCPC = (v: any) => {
  if (!v) return '\u20A90';
  return `\u20A9${Math.round(parseFloat(v)).toLocaleString('ko-KR')}`;
};

export function AutoManagement() {
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [showHistory, setShowHistory] = useState(true);
  const [reportDates, setReportDates] = useState({ start: '', end: '' });
  const [reportEmail, setReportEmail] = useState('');
  const [reportCampaignId, setReportCampaignId] = useState('');
  const [savedReport, setSavedReport] = useState<any>(null);

  // Rule form state
  const [ruleForm, setRuleForm] = useState({
    name: '', metric: 'cpc', operator: 'gt', threshold: '',
    secondary_metric: '', secondary_operator: 'gt', secondary_threshold: '',
    action: 'pause', action_value: '', target_type: 'campaign', target_id: '', target_name: '',
  });

  // Schedule form state
  const [schedForm, setSchedForm] = useState({
    name: '', schedule_type: 'weekly', day_of_week: 1, day_of_month: 1,
    send_hour: 9, send_minute: 0, meta_campaign_id: '', lookback_days: 7, email_to: '',
  });

  // Queries
  const { data: overview } = useQuery({
    queryKey: ['account-overview', 'last_7d'],
    queryFn: () => analyticsApi.getAccountOverview('last_7d'),
    retry: 1,
  });

  const { data: rulesData, refetch: refetchRules } = useQuery({
    queryKey: ['auto-rules'],
    queryFn: () => analyticsApi.getRules(),
  });

  const { data: ruleLogsData, refetch: refetchLogs } = useQuery({
    queryKey: ['rule-logs'],
    queryFn: () => analyticsApi.getRuleLogs(50),
  });

  const { data: schedulesData, refetch: refetchSchedules } = useQuery({
    queryKey: ['schedules'],
    queryFn: () => analyticsApi.getSchedules(),
  });

  // Rule mutations
  const createRuleMutation = useMutation({
    mutationFn: (data: any) => analyticsApi.createRule(data),
    onSuccess: () => { refetchRules(); setShowRuleForm(false); resetRuleForm(); toast.success('룰이 생성되었습니다.'); },
    onError: (err: any) => toast.error(err?.response?.data?.detail || '룰 생성에 실패했습니다.'),
  });

  const updateRuleMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => analyticsApi.updateRule(id, data),
    onSuccess: () => { refetchRules(); toast.success('룰이 수정되었습니다.'); },
    onError: () => toast.error('룰 수정에 실패했습니다.'),
  });

  const deleteRuleMutation = useMutation({
    mutationFn: (id: string) => analyticsApi.deleteRule(id),
    onSuccess: () => { refetchRules(); toast.success('룰이 삭제되었습니다.'); },
    onError: () => toast.error('룰 삭제에 실패했습니다.'),
  });

  const executeRulesMutation = useMutation({
    mutationFn: () => analyticsApi.executeRules(),
    onSuccess: () => { refetchRules(); refetchLogs(); toast.success('룰 실행이 완료되었습니다.'); },
    onError: () => toast.error('룰 실행에 실패했습니다.'),
  });

  const aiRecommendMutation = useMutation({
    mutationFn: () => analyticsApi.aiRecommendRules(overview),
    onError: () => toast.error('AI 추천 생성에 실패했습니다.'),
  });

  // Schedule mutations
  const createScheduleMutation = useMutation({
    mutationFn: (data: any) => analyticsApi.createSchedule(data),
    onSuccess: () => { refetchSchedules(); setShowScheduleForm(false); resetScheduleForm(); toast.success('스케줄이 생성되었습니다.'); },
    onError: (err: any) => { toast.error(err?.response?.data?.detail || '스케줄 생성에 실패했습니다.'); },
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: (id: string) => analyticsApi.deleteSchedule(id),
    onSuccess: () => { refetchSchedules(); toast.success('스케줄이 삭제되었습니다.'); },
    onError: () => toast.error('스케줄 삭제에 실패했습니다.'),
  });

  const updateScheduleMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => analyticsApi.updateSchedule(id, data),
    onSuccess: () => { refetchSchedules(); toast.success('스케줄이 수정되었습니다.'); },
    onError: () => toast.error('스케줄 수정에 실패했습니다.'),
  });

  const [runNowResult, setRunNowResult] = useState<any>(null);
  const runNowMutation = useMutation({
    mutationFn: (id: string) => analyticsApi.runScheduleNow(id),
    onSuccess: (data: any) => {
      setRunNowResult(data);
      refetchSchedules();
      if (data?.email_sent) toast.success('리포트 이메일 발송 완료!');
      else if (data?.status === 'success' || data?.status === 'partial') toast.success(data.message || '실행 완료');
      else toast.error(data?.message || '실행 실패');
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || err?.response?.data?.message || '수동 실행 실패'),
  });

  const reportMutation = useMutation({
    mutationFn: (req: { meta_campaign_id?: string; start_date: string; end_date: string }) =>
      analyticsApi.generateReport(req),
    onSuccess: (data: any) => {
      setSavedReport(data);
      if (data?.ai_error) {
        toast.error(`AI 리포트 생성에 실패했습니다. (${data.ai_error})`);
      }
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : '리포트 생성에 실패했습니다.');
    },
  });

  const emailMutation = useMutation({
    mutationFn: (req: { meta_campaign_id?: string; start_date: string; end_date: string; email: string; report_data?: any }) =>
      analyticsApi.sendReportEmail(req),
    onSuccess: () => toast.success('이메일이 발송되었습니다.'),
    onError: (err: any) => {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : '이메일 발송에 실패했습니다.');
    },
  });

  const testEmailMutation = useMutation({
    mutationFn: () => analyticsApi.testEmail(),
    onSuccess: (data: any) => {
      if (data.success) {
        toast.success(data.message || '테스트 이메일 발송 성공');
      } else {
        toast.error(`테스트 실패: ${data.error || '알 수 없는 오류'}`);
        console.log('Email diagnostics:', data.diagnostics);
      }
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : '테스트 이메일 실패');
    },
  });

  const resetRuleForm = () => setRuleForm({
    name: '', metric: 'cpc', operator: 'gt', threshold: '',
    secondary_metric: '', secondary_operator: 'gt', secondary_threshold: '',
    action: 'pause', action_value: '', target_type: 'campaign', target_id: '', target_name: '',
  });

  const resetScheduleForm = () => setSchedForm({
    name: '', schedule_type: 'weekly', day_of_week: 1, day_of_month: 1,
    send_hour: 9, send_minute: 0, meta_campaign_id: '', lookback_days: 7, email_to: '',
  });

  const handleCreateRule = () => {
    const data: any = {
      name: ruleForm.name || `${ruleForm.metric} ${ruleForm.operator} ${ruleForm.threshold}`,
      metric: ruleForm.metric,
      operator: ruleForm.operator,
      threshold: parseFloat(ruleForm.threshold),
      action: ruleForm.action,
      target_type: ruleForm.target_type,
    };
    if (ruleForm.action_value) data.action_value = parseFloat(ruleForm.action_value);
    if (ruleForm.target_id) { data.target_id = ruleForm.target_id; data.target_name = ruleForm.target_name; }
    if (ruleForm.secondary_metric) {
      data.secondary_metric = ruleForm.secondary_metric;
      data.secondary_operator = ruleForm.secondary_operator;
      data.secondary_threshold = parseFloat(ruleForm.secondary_threshold);
    }
    createRuleMutation.mutate(data);
  };

  const handleApplyRecommendation = (rec: any) => {
    createRuleMutation.mutate({
      name: rec.name,
      metric: rec.metric,
      operator: rec.operator,
      threshold: rec.threshold,
      action: rec.action,
      action_value: rec.action_value,
      target_type: rec.target_type || 'campaign',
    });
  };

  const handleCreateSchedule = () => {
    createScheduleMutation.mutate({
      name: schedForm.name,
      schedule_type: schedForm.schedule_type,
      day_of_week: schedForm.schedule_type === 'weekly' ? schedForm.day_of_week : undefined,
      day_of_month: schedForm.schedule_type === 'monthly' ? schedForm.day_of_month : undefined,
      send_hour: schedForm.send_hour,
      send_minute: schedForm.send_minute,
      meta_campaign_id: schedForm.meta_campaign_id || undefined,
      lookback_days: schedForm.lookback_days,
      email_to: schedForm.email_to || undefined,
    });
  };

  const rules = (rulesData as any)?.rules || rulesData || [];
  const ruleLogs = (ruleLogsData as any)?.logs || ruleLogsData || [];
  const schedules = (schedulesData as any)?.schedules || schedulesData || [];
  const allCampaigns = overview?.campaigns || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <Shield size={24} className="text-indigo-600" />
            </div>
            자동 관리
          </h2>
          <p className="text-sm text-gray-500 mt-1">룰 기반으로 캠페인, 광고세트, 광고를 자동 최적화합니다. 조건을 설정하면 자동으로 감시하고 액션을 실행합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => aiRecommendMutation.mutate()}
            disabled={aiRecommendMutation.isPending}
            className="text-sm bg-purple-100 text-purple-700 px-4 py-2 rounded-lg hover:bg-purple-200 flex items-center gap-2 disabled:opacity-50 font-medium">
            <Bot size={16} /> {aiRecommendMutation.isPending ? 'AI 분석중...' : 'AI 추천'}
          </button>
          <button onClick={() => executeRulesMutation.mutate()}
            disabled={executeRulesMutation.isPending}
            className="text-sm bg-red-100 text-red-700 px-4 py-2 rounded-lg hover:bg-red-200 flex items-center gap-2 disabled:opacity-50 font-medium">
            <PlayCircle size={16} /> {executeRulesMutation.isPending ? '실행중...' : '지금 실행'}
          </button>
          <button onClick={() => setShowRuleForm(!showRuleForm)}
            className="text-sm bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 flex items-center gap-2 font-medium">
            <Plus size={16} /> 룰 추가
          </button>
        </div>
      </div>

      {/* Execute results */}
      {executeRulesMutation.isSuccess && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
          <Zap size={18} className="text-green-600" />
          <p className="text-sm text-green-700 font-medium">
            실행 완료: {(executeRulesMutation.data as any)?.results?.length || 0}건 처리됨
          </p>
        </div>
      )}

      {/* AI Recommendations */}
      {aiRecommendMutation.isSuccess && (aiRecommendMutation.data as any)?.recommendations && (
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-5">
          <h4 className="text-sm font-semibold text-purple-800 mb-3 flex items-center gap-2">
            <Bot size={16} /> AI 추천 룰
          </h4>
          <div className="space-y-2">
            {((aiRecommendMutation.data as any).recommendations as any[]).map((rec: any, i: number) => (
              <div key={i} className="flex items-center justify-between bg-white rounded-lg border border-purple-200 p-4">
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{rec.name}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {rec.metric} {OPERATOR_SYMBOL[rec.operator] || rec.operator} {rec.threshold} → {ACTION_KO[rec.action] || rec.action}
                    {rec.reason && <span className="ml-2 text-purple-600">| {rec.reason}</span>}
                  </p>
                </div>
                <button onClick={() => handleApplyRecommendation(rec)}
                  disabled={createRuleMutation.isPending}
                  className="text-sm bg-purple-600 text-white px-4 py-1.5 rounded-lg hover:bg-purple-700 ml-3 font-medium">
                  적용
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rule Form */}
      {showRuleForm && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h4 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <Plus size={16} className="text-indigo-600" /> 새 룰 추가
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <input placeholder="룰 이름 (선택)" value={ruleForm.name} onChange={(e) => setRuleForm(f => ({ ...f, name: e.target.value }))}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400" />
            <select value={ruleForm.target_type} onChange={(e) => setRuleForm(f => ({ ...f, target_type: e.target.value }))}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400">
              <option value="campaign">캠페인</option>
              <option value="adset">광고세트</option>
              <option value="ad">광고</option>
            </select>
            <select value={ruleForm.action} onChange={(e) => setRuleForm(f => ({ ...f, action: e.target.value }))}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400">
              {ACTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
            <select value={ruleForm.metric} onChange={(e) => setRuleForm(f => ({ ...f, metric: e.target.value }))}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400">
              {METRIC_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select value={ruleForm.operator} onChange={(e) => setRuleForm(f => ({ ...f, operator: e.target.value }))}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400">
              {OPERATOR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input type="number" placeholder="임계값" value={ruleForm.threshold} onChange={(e) => setRuleForm(f => ({ ...f, threshold: e.target.value }))}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400" />
            {ruleForm.action !== 'pause' && (
              <input type="number" placeholder="변경량 (%)" value={ruleForm.action_value} onChange={(e) => setRuleForm(f => ({ ...f, action_value: e.target.value }))}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400" />
            )}
          </div>
          {/* Secondary condition */}
          <details className="mb-4">
            <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">+ AND 조건 추가</summary>
            <div className="grid grid-cols-3 gap-3 mt-2">
              <select value={ruleForm.secondary_metric} onChange={(e) => setRuleForm(f => ({ ...f, secondary_metric: e.target.value }))}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm">
                <option value="">선택 안함</option>
                {METRIC_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <select value={ruleForm.secondary_operator} onChange={(e) => setRuleForm(f => ({ ...f, secondary_operator: e.target.value }))}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm">
                {OPERATOR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <input type="number" placeholder="임계값" value={ruleForm.secondary_threshold} onChange={(e) => setRuleForm(f => ({ ...f, secondary_threshold: e.target.value }))}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
          </details>
          <div className="flex items-center gap-2">
            <button onClick={handleCreateRule} disabled={!ruleForm.threshold || createRuleMutation.isPending}
              className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50 font-medium">
              {createRuleMutation.isPending ? '생성중...' : '룰 생성'}
            </button>
            <button onClick={() => { setShowRuleForm(false); resetRuleForm(); }}
              className="text-gray-500 px-5 py-2 rounded-lg text-sm hover:bg-gray-100">취소</button>
          </div>
        </div>
      )}

      {/* Active Rules List */}
      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Shield size={18} className="text-indigo-600" /> 활성 룰 목록
            {Array.isArray(rules) && rules.length > 0 && (
              <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full ml-1">{rules.length}개</span>
            )}
          </h3>
        </div>

        {Array.isArray(rules) && rules.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left py-3 px-5 text-xs font-semibold text-gray-500 uppercase">룰 이름</th>
                  <th className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase">조건</th>
                  <th className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase">액션</th>
                  <th className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase">대상</th>
                  <th className="text-center py-3 px-3 text-xs font-semibold text-gray-500 uppercase">실행 횟수</th>
                  <th className="text-center py-3 px-3 text-xs font-semibold text-gray-500 uppercase">마지막 체크</th>
                  <th className="text-center py-3 px-3 text-xs font-semibold text-gray-500 uppercase">ON/OFF</th>
                  <th className="text-center py-3 px-3 text-xs font-semibold text-gray-500 uppercase">삭제</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rules.map((rule: any) => (
                  <tr key={rule.id} className="hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-5">
                      <span className="font-medium text-gray-900">{rule.name}</span>
                    </td>
                    <td className="py-3 px-3">
                      <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded font-mono">
                        {rule.metric?.toUpperCase()} {OPERATOR_SYMBOL[rule.operator] || rule.operator} {formatThreshold(rule.metric, rule.threshold)}
                      </span>
                      {rule.secondary_metric && (
                        <span className="text-xs bg-gray-50 text-gray-600 px-2 py-1 rounded font-mono ml-1">
                          AND {rule.secondary_metric?.toUpperCase()} {OPERATOR_SYMBOL[rule.secondary_operator] || rule.secondary_operator} {formatThreshold(rule.secondary_metric, rule.secondary_threshold)}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <span className={`text-xs font-semibold px-2 py-1 rounded ${
                        rule.action === 'pause' ? 'bg-red-100 text-red-700' :
                        rule.action === 'decrease_budget' ? 'bg-orange-100 text-orange-700' :
                        'bg-green-100 text-green-700'
                      }`}>
                        {ACTION_KO[rule.action] || rule.action}
                        {rule.action_value ? ` (${rule.action_value}%)` : ''}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                        {rule.target_type === 'campaign' ? '캠페인' : rule.target_type === 'adset' ? '광고세트' : '광고'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center">
                      {rule.times_triggered > 0 ? (
                        <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded font-medium">{rule.times_triggered}회</span>
                      ) : (
                        <span className="text-xs text-gray-400">0회</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className="text-xs text-gray-400">
                        {rule.last_checked_at
                          ? new Date(rule.last_checked_at).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                          : '-'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <button onClick={() => updateRuleMutation.mutate({ id: rule.id, data: { enabled: !rule.enabled } })}
                        className={`p-1.5 rounded-lg transition-colors ${rule.enabled ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'}`}
                        title={rule.enabled ? 'ON - 클릭하여 비활성화' : 'OFF - 클릭하여 활성화'}>
                        {rule.enabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                      </button>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <button onClick={() => { if (confirm('이 룰을 삭제하시겠습니까?')) deleteRuleMutation.mutate(rule.id); }}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-5 py-10 text-center">
            <Shield size={32} className="text-gray-300 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">등록된 자동 관리 룰이 없습니다.</p>
            <p className="text-gray-400 text-xs mt-1">위의 "룰 추가" 또는 "AI 추천"을 사용해보세요.</p>
          </div>
        )}
      </div>

      {/* Execution History */}
      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between cursor-pointer"
          onClick={() => setShowHistory(!showHistory)}>
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Clock size={18} className="text-amber-600" /> 실행 기록
            {Array.isArray(ruleLogs) && ruleLogs.length > 0 && (
              <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full ml-1">{ruleLogs.length}건</span>
            )}
          </h3>
          {showHistory ? <ChevronDown size={18} className="text-gray-400" /> : <ChevronRight size={18} className="text-gray-400" />}
        </div>

        {showHistory && (
          <div className="max-h-96 overflow-y-auto">
            {Array.isArray(ruleLogs) && ruleLogs.length > 0 ? (
              <div className="divide-y divide-gray-50">
                {ruleLogs.map((log: any, i: number) => {
                  const actionColor = log.action_taken === 'paused'
                    ? 'bg-red-100 text-red-700 border-red-200'
                    : log.action_taken?.includes('decreased')
                    ? 'bg-orange-100 text-orange-700 border-orange-200'
                    : log.action_taken?.includes('increased')
                    ? 'bg-green-100 text-green-700 border-green-200'
                    : 'bg-gray-100 text-gray-700 border-gray-200';

                  return (
                    <div key={log.id || i} className="px-5 py-3 flex items-center gap-4 hover:bg-gray-50 transition-colors">
                      {/* Timeline dot */}
                      <div className="flex flex-col items-center flex-shrink-0">
                        <div className={`w-3 h-3 rounded-full ${
                          log.action_taken === 'paused' ? 'bg-red-400' :
                          log.action_taken?.includes('decreased') ? 'bg-orange-400' :
                          log.action_taken?.includes('increased') ? 'bg-green-400' : 'bg-gray-400'
                        }`} />
                      </div>

                      {/* Timestamp */}
                      <div className="w-36 flex-shrink-0">
                        <span className="text-xs text-gray-500">
                          {log.triggered_at
                            ? new Date(log.triggered_at).toLocaleString('ko-KR', {
                                year: 'numeric', month: 'short', day: 'numeric',
                                hour: '2-digit', minute: '2-digit',
                              })
                            : '-'}
                        </span>
                      </div>

                      {/* Rule name */}
                      <div className="flex-shrink-0 w-36">
                        <span className="text-xs font-medium text-gray-700 truncate block">{log.rule_name || '-'}</span>
                      </div>

                      {/* Action badge */}
                      <div className="flex-shrink-0">
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${actionColor}`}>
                          {ACTION_KO[log.action_taken] || log.action_taken}
                        </span>
                      </div>

                      {/* Target */}
                      <div className="flex-1 min-w-0">
                        <span className="text-xs text-gray-600 truncate block">{log.target_name || log.target_id || '-'}</span>
                      </div>

                      {/* Metric value */}
                      <div className="flex-shrink-0 text-right">
                        <span className="text-xs text-gray-500">
                          {log.metric_name && (
                            <span className="font-medium text-gray-700">{log.metric_name}: </span>
                          )}
                          {typeof log.metric_value === 'number' ? log.metric_value.toFixed(2) : log.metric_value || '-'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="px-5 py-10 text-center">
                <Clock size={32} className="text-gray-300 mx-auto mb-3" />
                <p className="text-gray-400 text-sm">아직 실행 기록이 없습니다.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Period Report */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2"><FileText size={18} /> 기간 리포트</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">캠페인</label>
            <select value={reportCampaignId} onChange={(e) => setReportCampaignId(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
              <option value="">전체 계정</option>
              {allCampaigns.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
          <button onClick={() => emailMutation.mutate({ meta_campaign_id: reportCampaignId || undefined, start_date: reportDates.start, end_date: reportDates.end, email: reportEmail, report_data: savedReport || undefined })}
            disabled={!reportEmail || !reportDates.start || !reportDates.end || emailMutation.isPending}
            className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2">
            <Mail size={14} /> {emailMutation.isPending ? '발송중...' : '이메일 발송'}
          </button>
          <button onClick={() => testEmailMutation.mutate()}
            disabled={testEmailMutation.isPending}
            className="bg-gray-500 text-white px-3 py-2 rounded-lg text-sm hover:bg-gray-600 disabled:opacity-50 flex items-center gap-1">
            {testEmailMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} 테스트
          </button>
        </div>
        {emailMutation.isSuccess && <p className="mt-2 text-sm text-green-600">{(emailMutation.data as any)?.message}</p>}
        {emailMutation.isError && <p className="mt-2 text-sm text-red-600">이메일 발송에 실패했습니다.</p>}
        {testEmailMutation.isSuccess && !testEmailMutation.data?.success && (
          <p className="mt-2 text-xs text-red-600">진단: {JSON.stringify(testEmailMutation.data?.diagnostics, null, 2)}</p>
        )}

        {savedReport && (
          <ReportNewsletter data={savedReport}
            onEmail={reportEmail ? () => emailMutation.mutate({ meta_campaign_id: reportCampaignId || undefined, start_date: reportDates.start, end_date: reportDates.end, email: reportEmail, report_data: savedReport || undefined }) : undefined} />
        )}
        {reportMutation.isError && (
          <div className="mt-4 bg-red-50 rounded-lg p-4">
            <p className="text-sm text-red-600">리포트 생성에 실패했습니다.</p>
          </div>
        )}
      </div>

      {/* Scheduled Reports */}
      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Calendar size={18} className="text-teal-600" /> 스케줄 리포트
          </h3>
          <button onClick={() => setShowScheduleForm(!showScheduleForm)}
            className="text-sm bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 flex items-center gap-2 font-medium">
            <Plus size={14} /> 스케줄 추가
          </button>
        </div>

        {/* Schedule Form */}
        {showScheduleForm && (
          <div className="px-5 py-4 bg-gray-50 border-b border-gray-100">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
              <input placeholder="스케줄 이름" value={schedForm.name} onChange={(e) => setSchedForm(f => ({ ...f, name: e.target.value }))}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-400" />
              <select value={schedForm.schedule_type} onChange={(e) => setSchedForm(f => ({ ...f, schedule_type: e.target.value }))}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm">
                <option value="weekly">주간</option>
                <option value="monthly">월간</option>
              </select>
              {schedForm.schedule_type === 'weekly' ? (
                <select value={schedForm.day_of_week} onChange={(e) => setSchedForm(f => ({ ...f, day_of_week: parseInt(e.target.value) }))}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm">
                  {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
                    <option key={i} value={i}>{d}요일</option>
                  ))}
                </select>
              ) : (
                <select value={schedForm.day_of_month} onChange={(e) => setSchedForm(f => ({ ...f, day_of_month: parseInt(e.target.value) }))}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm">
                  {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                    <option key={d} value={d}>{d}일</option>
                  ))}
                </select>
              )}
              <div className="relative">
                <input
                  type="time"
                  value={`${String(schedForm.send_hour).padStart(2, '0')}:${String(schedForm.send_minute).padStart(2, '0')}`}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(':').map(Number);
                    setSchedForm(f => ({ ...f, send_hour: h || 0, send_minute: m || 0 }));
                  }}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-full focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-400"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">발송</span>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              <select value={schedForm.meta_campaign_id} onChange={(e) => setSchedForm(f => ({ ...f, meta_campaign_id: e.target.value }))}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm">
                <option value="">전체 계정</option>
                {allCampaigns.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={schedForm.lookback_days} onChange={(e) => setSchedForm(f => ({ ...f, lookback_days: parseInt(e.target.value) }))}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm">
                <option value={7}>최근 7일</option>
                <option value={14}>최근 14일</option>
                <option value={30}>최근 30일</option>
              </select>
              <input type="email" placeholder="수신 이메일 (선택)" value={schedForm.email_to} onChange={(e) => setSchedForm(f => ({ ...f, email_to: e.target.value }))}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-400" />
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleCreateSchedule} disabled={!schedForm.name || createScheduleMutation.isPending}
                className="bg-teal-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-teal-700 disabled:opacity-50 font-medium">
                {createScheduleMutation.isPending ? '생성중...' : '스케줄 생성'}
              </button>
              <button onClick={() => { setShowScheduleForm(false); resetScheduleForm(); }}
                className="text-gray-500 px-5 py-2 rounded-lg text-sm hover:bg-gray-100">취소</button>
            </div>
          </div>
        )}

        {/* Schedule List */}
        <div className="divide-y divide-gray-100">
          {Array.isArray(schedules) && schedules.length > 0 ? schedules.map((sched: any) => (
            <div key={sched.id} className="px-5 py-3 hover:bg-gray-50 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">{sched.name}</span>
                    <span className="text-xs bg-teal-100 text-teal-700 px-2 py-0.5 rounded">
                      {sched.schedule_type === 'weekly' ? `매주 ${['일', '월', '화', '수', '목', '금', '토'][sched.day_of_week || 0]}요일` : `매월 ${sched.day_of_month}일`} {String(sched.send_hour ?? 9).padStart(2, '0')}:{String(sched.send_minute ?? 0).padStart(2, '0')}
                    </span>
                    {sched.enabled ? (
                      <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">활성</span>
                    ) : (
                      <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">비활성</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    최근 {sched.lookback_days}일 | {sched.email_to || '이메일 미설정'}
                    {sched.last_run_at && ` | 마지막 실행: ${new Date(sched.last_run_at).toLocaleString('ko-KR')}`}
                    {sched.next_run_at && ` | 다음 실행: ${new Date(sched.next_run_at).toLocaleString('ko-KR')}`}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => runNowMutation.mutate(sched.id)}
                    disabled={runNowMutation.isPending}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg transition-colors disabled:opacity-50"
                    title="지금 실행"
                  >
                    {runNowMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <PlayCircle size={12} />}
                    수동 실행
                  </button>
                  <button onClick={() => updateScheduleMutation.mutate({ id: sched.id, data: { enabled: !sched.enabled } })}
                    className={`p-1.5 rounded-lg transition-colors ${sched.enabled ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'}`}>
                    {sched.enabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                  </button>
                  <button onClick={() => deleteScheduleMutation.mutate(sched.id)}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          )) : (
            <div className="px-5 py-8 text-center">
              <Calendar size={32} className="text-gray-300 mx-auto mb-3" />
              <p className="text-gray-400 text-sm">등록된 스케줄이 없습니다.</p>
            </div>
          )}
        </div>

        {/* Run Result */}
        {runNowResult && (
          <div className={`mx-5 mb-4 p-4 rounded-lg border text-sm ${
            runNowResult.email_sent ? 'bg-green-50 border-green-200' :
            runNowResult.status === 'error' ? 'bg-red-50 border-red-200' :
            'bg-yellow-50 border-yellow-200'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <p className="font-medium">
                {runNowResult.email_sent ? '✅ ' : runNowResult.status === 'error' ? '❌ ' : '⚠️ '}
                {runNowResult.message}
              </p>
              <button onClick={() => setRunNowResult(null)} className="text-gray-400 hover:text-gray-600 text-xs">닫기</button>
            </div>
            {runNowResult.summary && (
              <div className="grid grid-cols-4 gap-2 mt-2">
                <div className="bg-white rounded p-2 text-center">
                  <div className="text-xs text-gray-500">비용</div>
                  <div className="font-semibold text-gray-900">{Math.round(runNowResult.summary.spend).toLocaleString()}원</div>
                </div>
                <div className="bg-white rounded p-2 text-center">
                  <div className="text-xs text-gray-500">노출</div>
                  <div className="font-semibold text-gray-900">{runNowResult.summary.impressions?.toLocaleString()}</div>
                </div>
                <div className="bg-white rounded p-2 text-center">
                  <div className="text-xs text-gray-500">클릭</div>
                  <div className="font-semibold text-gray-900">{runNowResult.summary.clicks?.toLocaleString()}</div>
                </div>
                <div className="bg-white rounded p-2 text-center">
                  <div className="text-xs text-gray-500">CTR</div>
                  <div className="font-semibold text-gray-900">{runNowResult.summary.ctr?.toFixed(2)}%</div>
                </div>
              </div>
            )}
            {runNowResult.reason && !runNowResult.email_sent && (
              <p className="text-xs text-gray-600 mt-2">
                원인: {runNowResult.reason === 'no_meta_token' ? 'Meta 액세스 토큰이 없습니다' :
                       runNowResult.reason === 'no_ad_account' ? 'Meta 광고 계정이 설정되지 않았습니다' :
                       runNowResult.reason === 'resend_api_key_not_set' ? 'RESEND_API_KEY 환경변수가 서버에 설정되지 않았습니다' :
                       runNowResult.reason === 'no_email_configured' ? '이메일 주소가 설정되지 않았습니다' :
                       runNowResult.reason}
                {runNowResult.email_error && ` (${runNowResult.email_error})`}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Newsletter-style Report Component
// ──────────────────────────────────────────────

function ReportSparkline({ data, color, height = 48 }: { data: number[]; color: string; height?: number }) {
  if (data.length < 2) return null;
  const width = 200;
  const max = Math.max(...data, 0.01);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const pad = 4;
  const points = data.map((v, i) => ({
    x: pad + (i / (data.length - 1)) * (width - pad * 2),
    y: pad + (height - pad * 2) - ((v - min) / range) * (height - pad * 2),
  }));

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];
    const t = 0.3;
    d += ` C ${p1.x + (p2.x - p0.x) * t},${p1.y + (p2.y - p0.y) * t} ${p2.x - (p3.x - p1.x) * t},${p2.y - (p3.y - p1.y) * t} ${p2.x},${p2.y}`;
  }

  const areaD = d + ` L ${points[points.length - 1].x},${height - pad} L ${points[0].x},${height - pad} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#grad-${color})`} />
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

function ReportNewsletter({ data, onEmail }: { data: any; onEmail?: () => void }) {
  const daily = data?.daily_data || [];
  const totals = data?.totals || {};
  const campaign = data?.campaign_info;
  // Try to parse AI report: if string, attempt client-side JSON extraction
  let ai = typeof data?.ai_report === 'object' ? data.ai_report : null;
  let aiText = typeof data?.ai_report === 'string' ? data.ai_report : null;
  if (!ai && aiText) {
    try {
      // Try ```json block
      let jsonStr = aiText;
      if (jsonStr.includes('```json')) {
        jsonStr = jsonStr.split('```json')[1].split('```')[0].trim();
      } else if (jsonStr.includes('```')) {
        const parts = jsonStr.split('```');
        if (parts.length >= 3) {
          jsonStr = parts[1].trim();
          if (jsonStr.startsWith('json')) jsonStr = jsonStr.slice(4).trim();
        }
      }
      // Try balanced brace extraction
      const start = jsonStr.indexOf('{');
      if (start >= 0) {
        let depth = 0, inStr = false, esc = false;
        for (let i = start; i < jsonStr.length; i++) {
          const c = jsonStr[i];
          if (esc) { esc = false; continue; }
          if (c === '\\') { esc = true; continue; }
          if (c === '"') { inStr = !inStr; continue; }
          if (inStr) continue;
          if (c === '{') depth++;
          else if (c === '}') { depth--; if (depth === 0) { ai = JSON.parse(jsonStr.slice(start, i + 1)); aiText = null; break; } }
        }
      }
    } catch { /* keep aiText as fallback */ }
  }
  const period = data?.period || {};

  const formatROAS = (v: any) => {
    if (v === null || v === undefined) return '-';
    const n = parseFloat(v);
    return isNaN(n) ? '-' : n.toFixed(2);
  };

  const gradeColors: Record<string, string> = {
    A: 'from-emerald-500 to-green-600', B: 'from-blue-500 to-indigo-600',
    C: 'from-yellow-500 to-orange-500', D: 'from-orange-500 to-red-500', F: 'from-red-500 to-red-700',
  };
  const grade = ai?.overall_grade || 'B';
  const gradeGradient = gradeColors[grade] || gradeColors['B'];

  const spendData = daily.map((d: any) => parseFloat(d.spend || 0));
  const clickData = daily.map((d: any) => parseInt(d.clicks || 0));
  const ctrData = daily.map((d: any) => parseFloat(d.ctr || 0));
  const roasData = daily.map((d: any) => parseFloat(d.roas || 0));

  const [pdfLoading, setPdfLoading] = useState(false);
  const handleDownloadPDF = async () => {
    const el = document.getElementById('report-printable');
    if (!el) return;
    setPdfLoading(true);
    try {
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pdfWidth - 16;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let yPos = 8;
      if (imgHeight <= pdfHeight - 16) {
        pdf.addImage(imgData, 'PNG', 8, yPos, imgWidth, imgHeight);
      } else {
        // Multi-page: slice the canvas into pages
        const pageContentHeight = pdfHeight - 16;
        const srcPageHeight = (pageContentHeight / imgWidth) * canvas.width;
        let srcY = 0;
        let page = 0;
        while (srcY < canvas.height) {
          if (page > 0) pdf.addPage();
          const sliceHeight = Math.min(srcPageHeight, canvas.height - srcY);
          const sliceCanvas = document.createElement('canvas');
          sliceCanvas.width = canvas.width;
          sliceCanvas.height = sliceHeight;
          const ctx = sliceCanvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(canvas, 0, srcY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
            const sliceImg = sliceCanvas.toDataURL('image/png');
            const sliceImgHeight = (sliceHeight * imgWidth) / canvas.width;
            pdf.addImage(sliceImg, 'PNG', 8, 8, imgWidth, sliceImgHeight);
          }
          srcY += sliceHeight;
          page++;
        }
      }
      pdf.save(`리포트_${period.start}_${period.end}.pdf`);
      toast.success('PDF가 다운로드되었습니다.');
    } catch (err) {
      toast.error('PDF 생성에 실패했습니다.');
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <div className="mt-6">
      {/* Action Bar */}
      <div className="flex items-center justify-end gap-2 mb-4 print:hidden">
        <button onClick={handleDownloadPDF} disabled={pdfLoading}
          className="flex items-center gap-2 text-sm bg-gradient-to-r from-gray-700 to-gray-800 text-white px-4 py-2.5 rounded-xl hover:from-gray-800 hover:to-gray-900 font-medium disabled:opacity-50 shadow-sm transition-all">
          {pdfLoading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} {pdfLoading ? 'PDF 생성중...' : 'PDF 다운로드'}
        </button>
        {onEmail && (
          <button onClick={onEmail}
            className="flex items-center gap-2 text-sm bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-4 py-2.5 rounded-xl hover:from-purple-700 hover:to-indigo-700 font-medium shadow-sm transition-all">
            <Mail size={15} /> 이메일 발송
          </button>
        )}
      </div>

      <div id="report-printable" className="rounded-2xl overflow-hidden border border-gray-200 shadow-xl bg-white">
        {/* Hero Header */}
        <div className="bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-800 px-6 sm:px-10 py-8 relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-blue-400/15 to-transparent rounded-full -translate-y-1/2 translate-x-1/3" />
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-gradient-to-tr from-indigo-500/10 to-transparent rounded-full translate-y-1/3 -translate-x-1/4" />
          </div>
          <div className="relative z-10 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 bg-white/15 backdrop-blur-sm rounded-lg flex items-center justify-center border border-white/10">
                  <BarChart3 size={18} className="text-white" />
                </div>
                <div>
                  <span className="text-blue-300 text-[10px] font-semibold tracking-[0.15em] uppercase block">META-COMMANDER</span>
                  <span className="text-white/60 text-xs">Performance Report</span>
                </div>
              </div>
              {ai?.headline ? (
                <h2 className="text-xl sm:text-2xl font-bold text-white leading-snug mb-2 break-words line-clamp-2">{ai.headline}</h2>
              ) : (
                <h2 className="text-xl sm:text-2xl font-bold text-white mb-2">성과 분석 리포트</h2>
              )}
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span className="text-blue-200/80 text-xs sm:text-sm font-medium bg-white/10 backdrop-blur-sm px-3 py-1 rounded-lg">
                  {period.start} ~ {period.end}
                </span>
                {campaign && <span className="text-blue-200/80 text-xs sm:text-sm bg-white/10 backdrop-blur-sm px-3 py-1 rounded-lg truncate max-w-[200px]">{campaign.name}</span>}
              </div>
            </div>
            {ai?.overall_grade && (
              <div className="flex flex-col items-center shrink-0">
                <div className={`w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br ${gradeGradient} flex items-center justify-center shadow-xl ring-4 ring-white/10`}>
                  <span className="text-2xl sm:text-3xl font-black text-white drop-shadow-lg">{grade}</span>
                </div>
                <span className="text-[10px] sm:text-xs text-blue-200/70 mt-1.5 font-medium text-center max-w-[180px] line-clamp-2 break-words">{ai.grade_reason || '종합 등급'}</span>
              </div>
            )}
          </div>
        </div>

        <div className="p-5 sm:p-8 space-y-6">
          {/* Period Summary */}
          {ai?.period_summary && (
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-100/80">
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                  <BarChart3 size={14} className="text-blue-600" />
                </div>
                <p className="text-gray-700 text-sm leading-relaxed whitespace-pre-line break-words">{ai.period_summary}</p>
              </div>
            </div>
          )}

          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            <ReportKPICard icon={<DollarSign size={16} />} label="총 지출" value={formatSpend(totals.spend)} sparkData={spendData} sparkColor="#3b82f6" accent="blue" />
            <ReportKPICard icon={<Eye size={16} />} label="노출" value={formatNum(totals.impressions)} sub={`도달 ${formatNum(totals.reach)}`} sparkData={daily.map((d: any) => parseInt(d.impressions || 0))} sparkColor="#8b5cf6" accent="purple" />
            <ReportKPICard icon={<MousePointer size={16} />} label="클릭" value={formatNum(totals.clicks)} sub={`CTR ${totals.ctr?.toFixed(2) || '0'}%`} sparkData={clickData} sparkColor="#10b981" accent="green" />
            <ReportKPICard icon={<Target size={16} />} label="CPC" value={formatCPC(totals.cpc)} sparkData={daily.map((d: any) => parseFloat(d.cpc || 0))} sparkColor="#f97316" accent="orange" />
            <ReportKPICard icon={<TrendingUp size={16} />} label="ROAS" value={formatROAS(totals.roas)} sub={totals.conversion_value ? `전환매출 ${formatSpend(totals.conversion_value)}` : undefined} sparkData={roasData} sparkColor={totals.roas && totals.roas >= 1 ? '#10b981' : '#ef4444'} accent={totals.roas && totals.roas >= 1 ? 'green' : 'red'} highlight />
          </div>

          {/* Trend Charts */}
          {daily.length > 1 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.15em] mb-4 flex items-center gap-2">
                <Activity size={14} className="text-blue-500" /> 일별 추이
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: '지출', data: spendData, color: '#3b82f6', bg: 'from-blue-50 to-blue-100/50' },
                  { label: 'ROAS', data: roasData, color: totals.roas >= 1 ? '#10b981' : '#ef4444', bg: totals.roas >= 1 ? 'from-emerald-50 to-green-100/50' : 'from-red-50 to-red-100/50' },
                  { label: 'CTR (%)', data: ctrData, color: '#10b981', bg: 'from-emerald-50 to-teal-100/50' },
                  { label: '클릭', data: clickData, color: '#f97316', bg: 'from-orange-50 to-amber-100/50' },
                ].map((chart) => (
                  <div key={chart.label} className={`bg-gradient-to-br ${chart.bg} rounded-2xl p-4 border border-gray-100/80`}>
                    <h5 className="text-xs font-semibold text-gray-500 mb-3">{chart.label}</h5>
                    <ReportSparkline data={chart.data} color={chart.color} height={60} />
                    <div className="flex justify-between text-[10px] text-gray-400 mt-2 font-medium">
                      <span>{daily[0]?.date_stop?.slice(5) || ''}</span>
                      <span>{daily[daily.length - 1]?.date_stop?.slice(5) || ''}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {ai?.daily_trend_insight && (
            <div className="bg-gradient-to-r from-sky-50 to-blue-50 rounded-2xl p-4 border border-sky-100">
              <p className="text-sm text-blue-800 leading-relaxed">{ai.daily_trend_insight}</p>
            </div>
          )}

          {/* AI KPI Highlights */}
          {ai?.kpi_highlights && ai.kpi_highlights.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.15em] mb-4 flex items-center gap-2">
                <Zap size={14} className="text-amber-500" /> KPI 하이라이트
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {ai.kpi_highlights.map((kpi: any, i: number) => (
                  <div key={i} className="flex items-center gap-4 bg-white rounded-xl p-4 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      kpi.change?.startsWith('+') ? 'bg-gradient-to-br from-green-100 to-emerald-100' : kpi.change?.startsWith('-') ? 'bg-gradient-to-br from-red-100 to-rose-100' : 'bg-gradient-to-br from-blue-100 to-indigo-100'
                    }`}>
                      {kpi.change?.startsWith('+') ? <ArrowUpRight size={16} className="text-green-600" /> :
                       kpi.change?.startsWith('-') ? <ArrowDownRight size={16} className="text-red-600" /> :
                       <TrendingUp size={16} className="text-blue-600" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-gray-900">{kpi.metric} {kpi.value}</span>
                        {kpi.change && <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${kpi.change.startsWith('+') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{kpi.change}</span>}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">{kpi.insight}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Daily Data Table */}
          {daily.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.15em] mb-4 flex items-center gap-2">
                <Calendar size={14} className="text-indigo-500" /> 일별 데이터
              </h4>
              <div className="rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gradient-to-r from-slate-50 to-gray-50">
                        <th className="text-left py-3 px-4 text-gray-500 font-semibold text-xs">날짜</th>
                        <th className="text-right py-3 px-3 text-gray-500 font-semibold text-xs">지출</th>
                        <th className="text-right py-3 px-3 text-gray-500 font-semibold text-xs">노출</th>
                        <th className="text-right py-3 px-3 text-gray-500 font-semibold text-xs">도달</th>
                        <th className="text-right py-3 px-3 text-gray-500 font-semibold text-xs">클릭</th>
                        <th className="text-right py-3 px-3 text-gray-500 font-semibold text-xs">CTR</th>
                        <th className="text-right py-3 px-3 text-gray-500 font-semibold text-xs">CPC</th>
                        <th className="text-right py-3 px-3 text-gray-500 font-semibold text-xs">ROAS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {daily.map((row: any, i: number) => {
                        const roas = parseFloat(row.roas || 0);
                        return (
                          <tr key={i} className={`hover:bg-blue-50/60 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                            <td className="py-2.5 px-4 text-gray-700 font-medium">{row.date_stop || row.date || '-'}</td>
                            <td className="py-2.5 px-3 text-right font-semibold text-gray-900">{formatSpend(row.spend)}</td>
                            <td className="py-2.5 px-3 text-right text-gray-600">{formatNum(row.impressions)}</td>
                            <td className="py-2.5 px-3 text-right text-gray-600">{formatNum(row.reach)}</td>
                            <td className="py-2.5 px-3 text-right text-gray-600">{formatNum(row.clicks)}</td>
                            <td className="py-2.5 px-3 text-right text-gray-600">{parseFloat(row.ctr || '0').toFixed(2)}%</td>
                            <td className="py-2.5 px-3 text-right text-gray-600">{formatCPC(row.cpc)}</td>
                            <td className={`py-2.5 px-3 text-right font-bold ${roas >= 1 ? 'text-emerald-600' : roas > 0 ? 'text-red-500' : 'text-gray-400'}`}>{formatROAS(row.roas)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gradient-to-r from-slate-800 to-slate-900 text-white">
                        <td className="py-3 px-4 text-sm font-bold">합계</td>
                        <td className="py-3 px-3 text-right text-sm font-bold">{formatSpend(totals.spend)}</td>
                        <td className="py-3 px-3 text-right text-sm">{formatNum(totals.impressions)}</td>
                        <td className="py-3 px-3 text-right text-sm">{formatNum(totals.reach)}</td>
                        <td className="py-3 px-3 text-right text-sm">{formatNum(totals.clicks)}</td>
                        <td className="py-3 px-3 text-right text-sm">{totals.ctr?.toFixed(2) || '0'}%</td>
                        <td className="py-3 px-3 text-right text-sm">{formatCPC(totals.cpc)}</td>
                        <td className="py-3 px-3 text-right text-sm font-bold">{formatROAS(totals.roas)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* AI Insights */}
          {ai?.key_insights?.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.15em] mb-4 flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-500" /> 핵심 인사이트
              </h4>
              <div className="space-y-3">
                {ai.key_insights.map((insight: string, i: number) => (
                  <div key={i} className="flex items-start gap-4 bg-gradient-to-r from-amber-50 via-orange-50 to-yellow-50 rounded-xl p-4 border border-amber-100/80 shadow-sm">
                    <div className="w-8 h-8 bg-gradient-to-br from-amber-500 to-orange-500 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
                      <span className="text-white text-xs font-black">{i + 1}</span>
                    </div>
                    <p className="text-sm text-gray-800 leading-relaxed pt-1">{insight}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {ai?.recommendations?.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.15em] mb-4 flex items-center gap-2">
                <CheckCircle size={14} className="text-green-500" /> 실행 추천
              </h4>
              <div className="space-y-3">
                {ai.recommendations.map((rec: any, i: number) => (
                  <div key={i} className={`rounded-xl p-5 border-l-4 shadow-sm ${
                    rec.priority === 'high' ? 'border-l-red-500 bg-gradient-to-r from-red-50 to-white border border-red-100' :
                    rec.priority === 'medium' ? 'border-l-yellow-500 bg-gradient-to-r from-yellow-50 to-white border border-yellow-100' :
                    'border-l-gray-400 bg-gradient-to-r from-gray-50 to-white border border-gray-100'
                  }`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                        rec.priority === 'high' ? 'bg-red-600 text-white' :
                        rec.priority === 'medium' ? 'bg-yellow-500 text-white' : 'bg-gray-500 text-white'
                      }`}>{rec.priority === 'high' ? '긴급' : rec.priority === 'medium' ? '중요' : '참고'}</span>
                      <h5 className="text-sm font-bold text-gray-900">{rec.title}</h5>
                    </div>
                    <p className="text-sm text-gray-600 leading-relaxed">{rec.description}</p>
                    {rec.expected_impact && (
                      <div className="mt-2 flex items-center gap-1.5 text-xs text-blue-600 font-medium bg-blue-50 px-3 py-1.5 rounded-lg w-fit">
                        <Award size={12} /> 예상 효과: {rec.expected_impact}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fallback AI text */}
          {!ai && aiText && (
            <div className="bg-gradient-to-br from-gray-50 to-slate-50 rounded-2xl p-6 border border-gray-100">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.15em] mb-3">AI 분석</h4>
              <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{aiText}</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-gradient-to-r from-slate-50 to-gray-50 border-t border-gray-100 px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-gradient-to-r from-blue-600 to-indigo-600 rounded flex items-center justify-center">
              <span className="text-white text-[8px] font-bold">M</span>
            </div>
            <span className="text-xs text-gray-400 font-medium">Meta-Commander 자동 생성 리포트</span>
          </div>
          <span className="text-xs text-gray-400">{new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
        </div>
      </div>
    </div>
  );
}

function ReportKPICard({ icon, label, value, sub, sparkData, sparkColor, accent, highlight }: {
  icon: React.ReactNode; label: string; value: string; sub?: string;
  sparkData: number[]; sparkColor: string; accent: string; highlight?: boolean;
}) {
  const accentBg: Record<string, string> = {
    blue: 'bg-blue-50', purple: 'bg-purple-50', green: 'bg-emerald-50',
    orange: 'bg-orange-50', red: 'bg-red-50',
  };
  const accentText: Record<string, string> = {
    blue: 'text-blue-600', purple: 'text-purple-600', green: 'text-emerald-600',
    orange: 'text-orange-600', red: 'text-red-600',
  };

  return (
    <div className={`rounded-2xl p-4 border transition-all hover:shadow-lg hover:-translate-y-0.5 ${
      highlight ? 'border-blue-200 bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 ring-1 ring-blue-100 shadow-blue-100/50 shadow-md' : 'border-gray-100 bg-white hover:border-gray-200 shadow-sm'
    }`}>
      <div className="flex items-center gap-2 mb-3">
        <div className={`p-2 rounded-xl ${accentBg[accent]} ${accentText[accent]}`}>{icon}</div>
        <span className="text-xs text-gray-500 font-semibold">{label}</span>
      </div>
      <p className="text-2xl font-black text-gray-900 tracking-tight">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1 font-medium">{sub}</p>}
      {sparkData.length > 1 && (
        <div className="mt-3 -mx-1">
          <ReportSparkline data={sparkData} color={sparkColor} height={36} />
        </div>
      )}
    </div>
  );
}

export default AutoManagement;
