'use client';

import { Fragment, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Download, HeartHandshake, Loader2, Plus, Trash2,
} from 'lucide-react';
import {
  BarChart, Bar, Line, ComposedChart, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import { downloadFile, sponsorshipApi } from '@/lib/api';
import type {
  SponsorshipEvent, SponsorshipEventCreatePayload, SponsorshipEventType,
} from '@/lib/api';
import { fmtNum, fmtWon, shortMonth } from './format';

// ─── Constants ───

const SPONSORSHIP_EVENT_TYPE_OPTIONS: Array<{ value: SponsorshipEventType; label: string; color: string }> = [
  { value: 'festival', label: '대학축제', color: '#7070FF' },
  { value: 'club', label: '동아리', color: '#4EA7FC' },
  { value: 'marathon', label: '마라톤', color: '#27A644' },
  { value: 'conference', label: '학회', color: '#F2994A' },
  { value: 'etc', label: '기타', color: '#8A8F98' },
];

const SPONSORSHIP_EVENT_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  SPONSORSHIP_EVENT_TYPE_OPTIONS.map((o) => [o.value, o.label]),
);
const SPONSORSHIP_EVENT_TYPE_COLORS: Record<string, string> = Object.fromEntries(
  SPONSORSHIP_EVENT_TYPE_OPTIONS.map((o) => [o.value, o.color]),
);

const SPONSORSHIP_CONDITION_OPTIONS = ['인스타그램 게시', '홍보물 제공', '포스터 부착', '현수막 노출', '부스 제공', '기타'] as const;

// ─── 협찬 관리 카드 ───

function SponsorshipEventTypeBadge({ eventType }: { eventType: string }) {
  const color = SPONSORSHIP_EVENT_TYPE_COLORS[eventType] || '#8A8F98';
  const label = SPONSORSHIP_EVENT_TYPE_LABELS[eventType] || eventType;
  return (
    <span
      className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ backgroundColor: `${color}26`, color }}
    >
      {label}
    </span>
  );
}

function SponsorshipConditionChips({ conditions }: { conditions?: string | null }) {
  const parts = (conditions ?? '').split(',').map((c) => c.trim()).filter(Boolean);
  if (parts.length === 0) return <span className="text-xs text-[#62666D]">-</span>;
  const shown = parts.slice(0, 3);
  const rest = parts.length - shown.length;
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {shown.map((c, i) => (
        <span
          key={`${c}-${i}`}
          className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[#23252A] text-[#D0D6E0] whitespace-nowrap"
        >
          {c}
        </span>
      ))}
      {rest > 0 && (
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[#23252A] text-[#8A8F98] whitespace-nowrap">
          +{rest}
        </span>
      )}
    </span>
  );
}

export function SponsorshipCard() {
  const queryClient = useQueryClient();
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [eventTypeFilter, setEventTypeFilter] = useState<string>('');

  const {
    data: events, isLoading: eventsLoading, isError: eventsError,
  } = useQuery({
    queryKey: ['sponsorship-events', eventTypeFilter],
    queryFn: () => sponsorshipApi.listEvents(eventTypeFilter || undefined, 300),
    staleTime: 60 * 1000,
  });

  const { data: summary } = useQuery({
    queryKey: ['sponsorship-summary'],
    queryFn: () => sponsorshipApi.getSummary(12),
    staleTime: 60 * 1000,
  });

  // ─── 등록 폼 상태 ───
  const [targetName, setTargetName] = useState('');
  const [eventType, setEventType] = useState<SponsorshipEventType>('festival');
  const [sponsoredAt, setSponsoredAt] = useState(todayStr);
  const [product, setProduct] = useState('');
  const [quantity, setQuantity] = useState('');
  const [estimatedValue, setEstimatedValue] = useState('');
  const [reason, setReason] = useState('');
  const [expectedEffect, setExpectedEffect] = useState('');
  const [conditions, setConditions] = useState<string[]>([]);
  const [etcConditionText, setEtcConditionText] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const resetForm = () => {
    setTargetName(''); setProduct(''); setQuantity(''); setEstimatedValue('');
    setReason(''); setExpectedEffect(''); setConditions([]); setEtcConditionText('');
    setSponsoredAt(todayStr); setEventType('festival');
  };

  const createMutation = useMutation({
    mutationFn: (payload: SponsorshipEventCreatePayload) => sponsorshipApi.createEvent(payload),
    onSuccess: () => {
      toast.success('협찬이 등록되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['sponsorship-events'] });
      queryClient.invalidateQueries({ queryKey: ['sponsorship-summary'] });
      resetForm();
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || '등록 실패'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => sponsorshipApi.deleteEvent(id),
    onSuccess: () => {
      toast.success('삭제되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['sponsorship-events'] });
      queryClient.invalidateQueries({ queryKey: ['sponsorship-summary'] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || '삭제 실패'),
  });

  const toggleCondition = (label: string) => {
    setConditions((prev) => (prev.includes(label) ? prev.filter((c) => c !== label) : [...prev, label]));
  };

  const handleAdd = () => {
    if (!targetName.trim()) { toast.error('대상 명칭을 입력해주세요.'); return; }
    if (!sponsoredAt) { toast.error('일자를 입력해주세요.'); return; }
    if (!product.trim()) { toast.error('제품명을 입력해주세요.'); return; }
    const qty = parseFloat(quantity);
    if (!quantity.trim() || Number.isNaN(qty)) { toast.error('수량을 입력해주세요.'); return; }

    const conditionParts = conditions.filter((c) => c !== '기타');
    if (conditions.includes('기타')) {
      conditionParts.push(etcConditionText.trim() || '기타');
    }

    createMutation.mutate({
      target_name: targetName.trim(),
      event_type: eventType,
      sponsored_at: sponsoredAt,
      product: product.trim(),
      quantity: qty,
      estimated_value: estimatedValue.trim() === '' ? undefined : parseFloat(estimatedValue),
      reason: reason.trim() || undefined,
      expected_effect: expectedEffect.trim() || undefined,
      conditions: conditionParts.length > 0 ? conditionParts.join(', ') : undefined,
    });
  };

  const handleExport = async () => {
    try {
      await downloadFile('/sponsorship/export');
    } catch {
      toast.error('엑셀 다운로드에 실패했습니다.');
    }
  };

  const rows = useMemo(
    () => [...(events ?? [])].sort((a, b) => (a.sponsored_at < b.sponsored_at ? 1 : -1)),
    [events],
  );

  const monthlyChartData = useMemo(
    () => (summary?.by_month ?? []).map((m) => ({ month: shortMonth(m.month), count: m.count, quantity: m.quantity })),
    [summary],
  );
  const productChartData = summary?.by_product ?? [];
  const eventTypeChartData = summary?.by_event_type ?? [];

  return (
    <div className="bg-[#0F1011] border border-[#23252A] rounded-xl p-4">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-[#D0D6E0] flex items-center gap-1.5">
            <HeartHandshake size={14} className="text-[#7070FF]" />
            협찬 관리
          </h3>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <span className="text-xs text-[#8A8F98]">
              총 협찬 <b className="text-[#F7F8F8]">{fmtNum(summary?.total?.count ?? 0)}건</b>
            </span>
            <span className="text-xs text-[#8A8F98]">
              총 수량 <b className="text-[#F7F8F8]">{fmtNum(summary?.total?.quantity ?? 0)}개</b>
            </span>
            <span className="text-xs text-[#8A8F98]">
              환산 <b className="text-[#F7F8F8]">{fmtWon(summary?.total?.estimated_value ?? 0)}</b>
            </span>
          </div>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 px-3 py-2 border border-[#23252A] rounded-lg text-sm text-[#D0D6E0] hover:bg-[#141516] transition-all"
        >
          <Download size={14} /> 엑셀
        </button>
      </div>

      {/* 등록 폼 */}
      <div className="mb-4 pb-4 border-b border-[#23252A] space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={targetName}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setTargetName(e.target.value)}
            placeholder="대상 명칭"
            className="w-36 px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
          />
          <select
            value={eventType}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setEventType(e.target.value as SponsorshipEventType)}
            className="px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
          >
            {SPONSORSHIP_EVENT_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <input
            value={sponsoredAt}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setSponsoredAt(e.target.value)}
            type="date"
            className="px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
          />
          <input
            value={product}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setProduct(e.target.value)}
            placeholder="제품명"
            className="w-32 px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
          />
          <input
            value={quantity}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setQuantity(e.target.value)}
            type="number"
            placeholder="수량"
            className="w-20 px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
          />
          <input
            value={estimatedValue}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setEstimatedValue(e.target.value)}
            type="number"
            placeholder="환산금액(선택)"
            className="w-28 px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={reason}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setReason(e.target.value)}
            placeholder="협찬 사유"
            className="w-52 px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
          />
          <input
            value={expectedEffect}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setExpectedEffect(e.target.value)}
            placeholder="기대효과"
            className="w-52 px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
          />
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11px] text-[#62666D]">협찬 조건</span>
          {SPONSORSHIP_CONDITION_OPTIONS.map((label) => (
            <label key={label} className="flex items-center gap-1 text-xs text-[#D0D6E0] cursor-pointer">
              <input
                type="checkbox"
                checked={conditions.includes(label)}
                onChange={() => toggleCondition(label)}
                className="accent-[#5E6AD2]"
              />
              {label}
            </label>
          ))}
          {conditions.includes('기타') && (
            <input
              value={etcConditionText}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setEtcConditionText(e.target.value)}
              placeholder="기타 조건 입력"
              className="w-40 px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
            />
          )}
        </div>
        <div>
          <button
            onClick={handleAdd}
            disabled={createMutation.isPending}
            className="flex items-center gap-1 px-3 py-1.5 bg-[#5E6AD2] text-white text-xs font-medium rounded-lg hover:bg-[#828FFF] disabled:opacity-50"
          >
            {createMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} 등록
          </button>
        </div>
      </div>

      {/* 필터 */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <span className="text-[11px] text-[#62666D]">행사 유형</span>
        <select
          value={eventTypeFilter}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setEventTypeFilter(e.target.value)}
          className="px-2 py-1.5 bg-[#08090A] border border-[#23252A] rounded-lg text-xs text-[#D0D6E0] focus:outline-none focus:border-[#5E6AD2]"
        >
          <option value="">전체</option>
          {SPONSORSHIP_EVENT_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* 목록 테이블 */}
      {eventsLoading ? (
        <div className="flex items-center justify-center h-24">
          <Loader2 size={24} className="animate-spin text-[#7070FF]" />
        </div>
      ) : eventsError ? (
        <p className="text-xs text-[#EB5757] py-6 text-center">협찬 데이터를 불러오지 못했습니다.</p>
      ) : (
        <div className="overflow-x-auto mb-4">
          <table className="w-full min-w-[700px] text-left">
            <thead>
              <tr className="border-b border-[#23252A] text-[10px] text-[#62666D] uppercase tracking-wide">
                <th className="px-3 py-2 whitespace-nowrap">일자</th>
                <th className="px-3 py-2 whitespace-nowrap">대상명</th>
                <th className="px-3 py-2 whitespace-nowrap">행사유형</th>
                <th className="px-3 py-2 whitespace-nowrap">제품</th>
                <th className="px-3 py-2 whitespace-nowrap">수량</th>
                <th className="px-3 py-2 whitespace-nowrap">조건</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((item: SponsorshipEvent) => {
                const isExpanded = expandedId === item.id;
                return (
                  <Fragment key={item.id}>
                    <tr
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      className="border-b border-[#23252A] hover:bg-[#141516]/40 cursor-pointer"
                    >
                      <td className="px-3 py-2 text-xs text-[#8A8F98] whitespace-nowrap">{item.sponsored_at}</td>
                      <td className="px-3 py-2 text-xs text-[#D0D6E0] whitespace-nowrap">{item.target_name}</td>
                      <td className="px-3 py-2"><SponsorshipEventTypeBadge eventType={item.event_type} /></td>
                      <td className="px-3 py-2 text-xs text-[#D0D6E0] whitespace-nowrap">{item.product}</td>
                      <td className="px-3 py-2 text-xs text-[#D0D6E0] whitespace-nowrap">{fmtNum(item.quantity)}</td>
                      <td className="px-3 py-2"><SponsorshipConditionChips conditions={item.conditions} /></td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(item.id); }}
                          className="text-[#8A8F98] hover:text-[#EB5757] transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b border-[#23252A] bg-[#141516]/30">
                        <td colSpan={7} className="px-3 py-3 text-xs text-[#8A8F98] leading-relaxed space-y-1">
                          <p><span className="text-[#62666D]">사유</span> {item.reason || '-'}</p>
                          <p><span className="text-[#62666D]">기대효과</span> {item.expected_effect || '-'}</p>
                          <p><span className="text-[#62666D]">메모</span> {item.notes || '-'}</p>
                          {item.estimated_value != null && (
                            <p><span className="text-[#62666D]">환산금액</span> {fmtWon(item.estimated_value)}</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-xs text-[#62666D]">
                    등록된 협찬이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 차트 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-[#08090A] border border-[#23252A] rounded-xl p-3 md:col-span-2">
          <h4 className="text-xs font-semibold text-[#D0D6E0] mb-2">월별 협찬 횟수 & 수량</h4>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthlyChartData} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#23252A" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#8A8F98' }} />
                <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#8A8F98' }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#7070FF' }} />
                <RechartsTooltip
                  contentStyle={{ backgroundColor: '#141516', border: '1px solid #23252A', borderRadius: 8, fontSize: 11 }}
                  labelStyle={{ color: '#D0D6E0' }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="left" dataKey="count" name="협찬 횟수" fill="#4EA7FC" radius={[3, 3, 0, 0]} maxBarSize={30} />
                <Line yAxisId="right" type="monotone" dataKey="quantity" name="수량" stroke="#7070FF" strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-[#08090A] border border-[#23252A] rounded-xl p-3">
          <h4 className="text-xs font-semibold text-[#D0D6E0] mb-2">제품별 협찬 수량</h4>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={productChartData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#23252A" />
                <XAxis type="number" tick={{ fontSize: 10, fill: '#8A8F98' }} />
                <YAxis type="category" dataKey="product" tick={{ fontSize: 10, fill: '#8A8F98' }} width={72} />
                <RechartsTooltip
                  contentStyle={{ backgroundColor: '#141516', border: '1px solid #23252A', borderRadius: 8, fontSize: 11 }}
                  labelStyle={{ color: '#D0D6E0' }}
                  formatter={(value: any) => [fmtNum(Number(value)), '수량']}
                />
                <Bar dataKey="quantity" fill="#27A644" radius={[0, 3, 3, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-[#08090A] border border-[#23252A] rounded-xl p-3">
          <h4 className="text-xs font-semibold text-[#D0D6E0] mb-2">행사 유형별 협찬 횟수</h4>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={eventTypeChartData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#23252A" />
                <XAxis type="number" tick={{ fontSize: 10, fill: '#8A8F98' }} />
                <YAxis
                  type="category"
                  dataKey="event_type"
                  tick={{ fontSize: 10, fill: '#8A8F98' }}
                  tickFormatter={(v: string) => SPONSORSHIP_EVENT_TYPE_LABELS[v] || v}
                  width={72}
                />
                <RechartsTooltip
                  contentStyle={{ backgroundColor: '#141516', border: '1px solid #23252A', borderRadius: 8, fontSize: 11 }}
                  labelStyle={{ color: '#D0D6E0' }}
                  formatter={(value: any) => [fmtNum(Number(value)), '횟수']}
                  labelFormatter={(v: string) => SPONSORSHIP_EVENT_TYPE_LABELS[v] || v}
                />
                <Bar dataKey="count" radius={[0, 3, 3, 0]} maxBarSize={20}>
                  {eventTypeChartData.map((d, i) => (
                    <Cell key={`et-${i}`} fill={SPONSORSHIP_EVENT_TYPE_COLORS[d.event_type] || '#8A8F98'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
