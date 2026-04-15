'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Zap, Plus, Trash2, ToggleLeft, ToggleRight, Clock,
  Loader2, Bot, PlayCircle, ChevronDown, ChevronRight,
  AlertTriangle, CheckCircle, Sparkles, Activity, Check,
} from 'lucide-react';
import { naverAutoRulesApi, formatNaverCurrency, formatNaverNumber, formatNaverPercent } from '@/lib/naver-api';
import toast from 'react-hot-toast';

const METRIC_OPTIONS = [
  { value: 'cpc', label: 'CPC (클릭당 비용)' },
  { value: 'ctr', label: 'CTR (클릭률, %)' },
  { value: 'roas', label: 'ROAS (%)' },
  { value: 'spend', label: '일 지출' },
  { value: 'impressions', label: '노출수' },
  { value: 'clicks', label: '클릭수' },
  { value: 'conversions', label: '전환수' },
  { value: 'cpm', label: 'CPM (천회 노출 비용)' },
  { value: 'budget_usage', label: '일 예산 소진률 (%)' },
];

const OPERATOR_OPTIONS = [
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
  { value: 'gte', label: '>=' },
  { value: 'lte', label: '<=' },
];

const OPERATOR_SYMBOL: Record<string, string> = {
  gt: '>', lt: '<', gte: '>=', lte: '<=',
};

const ACTION_OPTIONS = [
  { value: 'adjust_bid', label: '입찰가 조정' },
  { value: 'pause_campaign', label: '캠페인 일시중지' },
  { value: 'change_budget', label: '예산 변경' },
  { value: 'notify', label: '알림 발송' },
];

const ACTION_KO: Record<string, string> = {
  adjust_bid: '입찰가 조정',
  pause_campaign: '캠페인 일시중지',
  change_budget: '예산 변경',
  notify: '알림 발송',
  paused: '중지됨',
  bid_adjusted: '입찰가 조정됨',
  budget_changed: '예산 변경됨',
  notified: '알림 발송됨',
};

const PLATFORM_OPTIONS = [
  { value: 'all', label: '전체 (검색광고 + GFA)' },
  { value: 'search_ads', label: '검색광고만' },
  { value: 'gfa', label: 'GFA만' },
];

export function NaverAutoManagement() {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [aiTriggered, setAiTriggered] = useState(false);
  const queryClient = useQueryClient();

  // Rule form
  const [ruleForm, setRuleForm] = useState({
    name: '',
    platform: 'all',
    metric: 'cpc',
    operator: 'gt',
    threshold: 0,
    action: 'notify',
    actionValue: 0,
    enabled: true,
  });

  // Fetch rules
  const { data: rulesData, isLoading: loadingRules } = useQuery({
    queryKey: ['naver-auto-rules'],
    queryFn: () => naverAutoRulesApi.getRules(),
    retry: 1,
  });

  // Fetch logs
  const { data: logsData, isLoading: loadingLogs } = useQuery({
    queryKey: ['naver-auto-rule-logs'],
    queryFn: () => naverAutoRulesApi.getRuleLogs(50),
    enabled: showLogs,
    retry: 1,
  });

  const rules: any[] = rulesData?.rules || (Array.isArray(rulesData) ? rulesData : []);
  const logs: any[] = logsData?.logs || (Array.isArray(logsData) ? logsData : []);

  // Create rule
  const createRuleMutation = useMutation({
    mutationFn: () => naverAutoRulesApi.createRule({
      name: ruleForm.name,
      platform: ruleForm.platform,
      conditions: [{
        metric: ruleForm.metric,
        operator: ruleForm.operator,
        threshold: ruleForm.threshold,
      }],
      action: ruleForm.action,
      action_value: ruleForm.actionValue || undefined,
      enabled: ruleForm.enabled,
    }),
    onSuccess: () => {
      toast.success('규칙이 생성되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['naver-auto-rules'] });
      setShowCreateForm(false);
      resetForm();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || '규칙 생성에 실패했습니다.');
    },
  });

  // Toggle rule
  const toggleRuleMutation = useMutation({
    mutationFn: ({ ruleId, enabled }: { ruleId: string; enabled: boolean }) =>
      naverAutoRulesApi.updateRule(ruleId, { enabled }),
    onSuccess: () => {
      toast.success('규칙 상태가 변경되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['naver-auto-rules'] });
    },
    onError: () => toast.error('상태 변경에 실패했습니다.'),
  });

  // Delete rule
  const deleteRuleMutation = useMutation({
    mutationFn: (ruleId: string) => naverAutoRulesApi.deleteRule(ruleId),
    onSuccess: () => {
      toast.success('규칙이 삭제되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['naver-auto-rules'] });
    },
    onError: () => toast.error('삭제에 실패했습니다.'),
  });

  // Execute rules
  const executeRulesMutation = useMutation({
    mutationFn: () => naverAutoRulesApi.executeRules(),
    onSuccess: (data) => {
      toast.success(`규칙 실행 완료: ${data?.executed || 0}건 처리`);
      queryClient.invalidateQueries({ queryKey: ['naver-auto-rule-logs'] });
    },
    onError: () => toast.error('규칙 실행에 실패했습니다.'),
  });

  // AI recommend
  const aiRecommendMutation = useMutation({
    mutationFn: () => naverAutoRulesApi.aiRecommendRules(),
    onError: () => toast.error('AI 추천에 실패했습니다.'),
  });

  const resetForm = () => {
    setRuleForm({
      name: '',
      platform: 'all',
      metric: 'cpc',
      operator: 'gt',
      threshold: 0,
      action: 'notify',
      actionValue: 0,
      enabled: true,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#F7F8F8] flex items-center gap-2">
            <Zap className="text-[#27A644]" size={28} />
            네이버 자동관리
          </h1>
          <p className="text-sm text-[#8A8F98] mt-1">조건 기반 자동 최적화 규칙 설정</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreateForm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#27A644] text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
          >
            <Plus size={16} />
            룰 생성
          </button>
          <button
            onClick={() => executeRulesMutation.mutate()}
            disabled={executeRulesMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 border border-green-300 text-[#27A644] rounded-lg text-sm font-medium hover:bg-[#27A644]/10 transition-colors disabled:opacity-50"
          >
            {executeRulesMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <PlayCircle size={16} />}
            즉시 실행
          </button>
        </div>
      </div>

      {/* Create Rule Form */}
      {showCreateForm && (
        <div className="bg-[#0F1011] rounded-xl border border-[#23252A] p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-[#F7F8F8] flex items-center gap-2">
              <Plus size={20} className="text-[#27A644]" />
              새 규칙 생성
            </h2>
            <button onClick={() => { setShowCreateForm(false); resetForm(); }} className="text-[#62666D] hover:text-[#D0D6E0]">
              <Trash2 size={16} />
            </button>
          </div>
          <div className="max-w-lg space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#D0D6E0] mb-1">규칙 이름</label>
              <input
                type="text"
                value={ruleForm.name}
                onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })}
                className="w-full rounded-lg border border-[#23252A] px-4 py-2 text-sm focus:border-[#27A644] focus:ring-1 focus:ring-green-500 focus:outline-none"
                placeholder="예: CPC 과다 시 알림"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#D0D6E0] mb-1">적용 플랫폼</label>
              <select
                value={ruleForm.platform}
                onChange={(e) => setRuleForm({ ...ruleForm, platform: e.target.value })}
                className="w-full rounded-lg border border-[#23252A] px-3 py-2 text-sm bg-[#0F1011] focus:border-[#27A644] focus:ring-1 focus:ring-green-500 focus:outline-none"
              >
                {PLATFORM_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div className="p-4 bg-[#08090A] rounded-lg">
              <p className="text-sm font-medium text-[#D0D6E0] mb-3">조건 설정</p>
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={ruleForm.metric}
                  onChange={(e) => setRuleForm({ ...ruleForm, metric: e.target.value })}
                  className="rounded border border-[#23252A] px-3 py-1.5 text-sm bg-[#0F1011]"
                >
                  {METRIC_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                <select
                  value={ruleForm.operator}
                  onChange={(e) => setRuleForm({ ...ruleForm, operator: e.target.value })}
                  className="rounded border border-[#23252A] px-3 py-1.5 text-sm bg-[#0F1011] w-16"
                >
                  {OPERATOR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <input
                  type="number"
                  value={ruleForm.threshold}
                  onChange={(e) => setRuleForm({ ...ruleForm, threshold: Number(e.target.value) })}
                  className="rounded border border-[#23252A] px-3 py-1.5 text-sm w-28 text-right"
                />
                <span className="text-xs text-[#8A8F98]">
                  {ruleForm.metric.includes('ctr') || ruleForm.metric.includes('roas') || ruleForm.metric.includes('budget_usage') ? '%' : '원'}
                </span>
              </div>
            </div>
            <div className="p-4 bg-[#08090A] rounded-lg">
              <p className="text-sm font-medium text-[#D0D6E0] mb-3">액션</p>
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={ruleForm.action}
                  onChange={(e) => setRuleForm({ ...ruleForm, action: e.target.value })}
                  className="rounded border border-[#23252A] px-3 py-1.5 text-sm bg-[#0F1011]"
                >
                  {ACTION_OPTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
                {(ruleForm.action === 'adjust_bid' || ruleForm.action === 'change_budget') && (
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={ruleForm.actionValue}
                      onChange={(e) => setRuleForm({ ...ruleForm, actionValue: Number(e.target.value) })}
                      className="rounded border border-[#23252A] px-3 py-1.5 text-sm w-20 text-right"
                    />
                    <span className="text-xs text-[#8A8F98]">%</span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <button
                onClick={() => { setShowCreateForm(false); resetForm(); }}
                className="px-4 py-2 border border-[#23252A] rounded-lg text-sm font-medium text-[#D0D6E0] hover:bg-[#141516]/5"
              >
                취소
              </button>
              <button
                onClick={() => {
                  if (!ruleForm.name) { toast.error('규칙 이름을 입력해주세요.'); return; }
                  createRuleMutation.mutate();
                }}
                disabled={createRuleMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-[#27A644] text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
              >
                {createRuleMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                규칙 생성
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active Rules List */}
      <div className="bg-[#0F1011] rounded-xl border border-[#23252A] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#23252A]">
          <h2 className="text-base font-semibold text-[#F7F8F8] flex items-center gap-2">
            <Zap size={18} className="text-[#27A644]" />
            활성 룰 목록
          </h2>
        </div>
        {loadingRules ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="animate-spin text-[#27A644]" size={24} />
            <span className="ml-2 text-[#8A8F98]">규칙 로딩 중...</span>
          </div>
        ) : rules.length === 0 ? (
          <div className="text-center py-12 text-[#8A8F98]">
            <Bot size={48} className="mx-auto mb-3 text-[#62666D]" />
            <p>등록된 자동 관리 규칙이 없습니다.</p>
            <button
              onClick={() => setShowCreateForm(true)}
              className="mt-4 px-4 py-2 bg-[#27A644] text-white rounded-lg text-sm font-medium hover:bg-green-700"
            >
              첫 규칙 만들기
            </button>
          </div>
        ) : (
          <div className="divide-y divide-[#23252A]">
            {rules.map((rule: any) => {
              const ruleId = rule.id || rule.rule_id;
              const conditions = rule.conditions || [];
              const isEnabled = rule.enabled !== false;
              return (
                <div key={ruleId} className="px-6 py-4 hover:bg-[#141516]/5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => toggleRuleMutation.mutate({ ruleId, enabled: !isEnabled })}
                        className="flex-shrink-0"
                      >
                        {isEnabled ? (
                          <ToggleRight size={24} className="text-[#27A644]" />
                        ) : (
                          <ToggleLeft size={24} className="text-[#62666D]" />
                        )}
                      </button>
                      <div>
                        <p className="text-sm font-medium text-[#F7F8F8]">{rule.name}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {rule.platform && rule.platform !== 'all' && (
                            <span className="px-1.5 py-0.5 bg-[#27A644]/10 text-[#27A644] rounded text-xs">
                              {rule.platform === 'search_ads' ? '검색광고' : 'GFA'}
                            </span>
                          )}
                          {conditions.map((c: any, i: number) => (
                            <span key={i} className="text-xs text-[#8A8F98]">
                              {METRIC_OPTIONS.find((m) => m.value === c.metric)?.label || c.metric}{' '}
                              {OPERATOR_SYMBOL[c.operator] || c.operator}{' '}
                              {c.threshold}{c.metric.includes('ctr') || c.metric.includes('roas') || c.metric.includes('budget_usage') ? '%' : '원'}
                            </span>
                          ))}
                          <span className="text-xs text-[#62666D]">→</span>
                          <span className="text-xs font-medium text-[#D0D6E0]">
                            {ACTION_KO[rule.action] || rule.action}
                            {rule.action_value ? ` (${rule.action_value}%)` : ''}
                          </span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        if (confirm('이 규칙을 삭제하시겠습니까?')) {
                          deleteRuleMutation.mutate(ruleId);
                        }
                      }}
                      className="p-1.5 text-red-400 hover:text-[#EB5757] hover:bg-[#EB5757]/10 rounded"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Execution Logs */}
      <div className="bg-[#0F1011] rounded-xl border border-[#23252A] overflow-hidden">
        <button
          className="w-full px-6 py-4 border-b border-[#23252A] flex items-center justify-between hover:bg-[#141516]/5"
          onClick={() => setShowLogs(!showLogs)}
        >
          <h2 className="text-base font-semibold text-[#F7F8F8] flex items-center gap-2">
            <Clock size={18} className="text-[#27A644]" />
            실행 로그
          </h2>
          {showLogs ? <ChevronDown size={16} className="text-[#62666D]" /> : <ChevronRight size={16} className="text-[#62666D]" />}
        </button>
        {showLogs && (
          <div>
            {loadingLogs ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="animate-spin text-[#27A644]" size={20} />
                <span className="ml-2 text-[#8A8F98] text-sm">로그 로딩 중...</span>
              </div>
            ) : logs.length === 0 ? (
              <div className="text-center py-8 text-[#62666D]">
                <Clock size={32} className="mx-auto mb-2" />
                <p className="text-sm">실행 기록이 없습니다.</p>
              </div>
            ) : (
              <div className="divide-y divide-[#23252A] max-h-64 overflow-y-auto">
                {logs.map((log: any, i: number) => (
                  <div key={i} className="px-6 py-3 text-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {log.status === 'success' ? (
                          <CheckCircle size={14} className="text-green-500" />
                        ) : (
                          <AlertTriangle size={14} className="text-yellow-500" />
                        )}
                        <span className="font-medium text-[#F7F8F8]">{log.rule_name || log.name}</span>
                      </div>
                      <span className="text-xs text-[#62666D]">{log.executed_at || log.created_at}</span>
                    </div>
                    <p className="text-xs text-[#8A8F98] mt-1 ml-5">
                      {ACTION_KO[log.action] || log.action}: {log.details || log.message || '-'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* AI Rule Recommendations */}
      <div className="bg-[#0F1011] rounded-xl border border-[#23252A] p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-[#F7F8F8] flex items-center gap-2">
            <Sparkles size={18} className="text-[#27A644]" />
            AI 룰 추천
          </h2>
          <button
            onClick={() => {
              setAiTriggered(true);
              aiRecommendMutation.mutate();
            }}
            disabled={aiRecommendMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-[#27A644] text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            {aiRecommendMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {aiRecommendMutation.isPending ? '분석 중...' : '추천 받기'}
          </button>
        </div>

        {!aiTriggered ? (
          <div className="text-center py-8 text-[#62666D]">
            <Bot size={40} className="mx-auto mb-3" />
            <p className="text-sm">AI가 현재 성과 데이터를 분석하여 최적의 자동 관리 규칙을 추천합니다.</p>
          </div>
        ) : aiRecommendMutation.isPending ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="animate-spin text-[#27A644]" size={24} />
            <span className="ml-3 text-[#8A8F98]">AI가 최적의 규칙을 분석하고 있습니다...</span>
          </div>
        ) : aiRecommendMutation.data ? (
          <div className="space-y-3">
            {typeof aiRecommendMutation.data === 'string' ? (
              <div className="prose prose-sm max-w-none text-[#D0D6E0] whitespace-pre-wrap">{aiRecommendMutation.data}</div>
            ) : Array.isArray(aiRecommendMutation.data.recommendations || aiRecommendMutation.data) ? (
              (aiRecommendMutation.data.recommendations || aiRecommendMutation.data).map((rec: any, i: number) => (
                <div key={i} className="p-4 bg-[#27A644]/10 rounded-lg border border-[#27A644]/30">
                  <p className="text-sm font-medium text-[#27A644]">{rec.name || rec.title || `추천 규칙 ${i + 1}`}</p>
                  <p className="text-sm text-[#27A644] mt-1">{rec.description || rec.reason || (typeof rec === 'string' ? rec : '')}</p>
                  {rec.conditions && (
                    <div className="mt-2 flex items-center gap-2 text-xs text-[#27A644]">
                      <Activity size={12} />
                      <span>
                        {rec.conditions.map((c: any) =>
                          `${c.metric} ${OPERATOR_SYMBOL[c.operator] || c.operator} ${c.threshold}`
                        ).join(', ')}
                      </span>
                      <span>→</span>
                      <span>{ACTION_KO[rec.action] || rec.action}</span>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="prose prose-sm max-w-none text-[#D0D6E0] whitespace-pre-wrap">
                {JSON.stringify(aiRecommendMutation.data, null, 2)}
              </div>
            )}
          </div>
        ) : aiRecommendMutation.isError ? (
          <div className="text-center py-8 text-[#EB5757]">
            <p className="text-sm">AI 추천에 실패했습니다. 다시 시도해주세요.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

