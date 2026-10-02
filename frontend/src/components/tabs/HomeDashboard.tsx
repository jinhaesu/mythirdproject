'use client';

/**
 * 홈 — 전 채널 통합 브리핑 (업무 중심 개편 2026-09).
 *
 * /home/briefing 하나만 호출(DB 로컬 집계, 외부 API 무호출)해서
 * "오늘 마케팅이 어떤 상태인가"를 한 화면에 보여준다.
 */
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip,
} from 'recharts';
import {
  LineChart, Megaphone, MessageCircle, ClipboardList, Receipt, Target, Gift,
  ArrowUpRight, ArrowDownRight, CheckCircle2, AlertCircle, ChevronRight,
} from 'lucide-react';
import { homeApi } from '@/lib/api';
import { useAppStore, type MenuKey } from '@/store';
import { fmtWon, fmtNum } from '@/components/tabs/kpi/format';

function DeltaChip({ pct }: { pct: number | null | undefined }) {
  if (pct === null || pct === undefined) return null;
  const up = pct >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-medium ${
        up ? 'bg-green/15 text-green' : 'bg-red/15 text-red'
      }`}
    >
      {up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function SectionCard({
  title, icon: Icon, menu, subTab, children,
}: {
  title: string; icon: any; menu?: MenuKey; subTab?: number; children: React.ReactNode;
}) {
  const { setActiveMenu, setMenuSubTab } = useAppStore();
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={15} style={{ color: 'var(--color-accent-hover)' }} />
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        </div>
        {menu && (
          <button
            onClick={() => {
              setActiveMenu(menu);
              if (subTab !== undefined) setMenuSubTab(menu, subTab);
            }}
            className="flex items-center gap-0.5 text-[11px] text-text-tertiary hover:text-text-primary transition-colors"
          >
            자세히 <ChevronRight size={12} />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function MiniProgress({ pct }: { pct: number | null | undefined }) {
  if (pct === null || pct === undefined) {
    return <div className="h-1.5 rounded-full" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.07)' }} />;
  }
  const color = pct > 100 ? '#EA4335' : pct >= 90 ? '#F0BF00' : '#27A644';
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.07)' }}>
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: color }} />
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[11px] text-text-tertiary whitespace-nowrap">{label}</span>
      <span className="text-lg font-semibold text-text-primary tabular-nums whitespace-nowrap">{value}</span>
      {sub && <span className="text-[11px] text-text-quaternary">{sub}</span>}
    </div>
  );
}

export function HomeDashboard() {
  const { data: b, isLoading, error } = useQuery({
    queryKey: ['home', 'briefing'],
    queryFn: homeApi.getBriefing,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (error || !b) {
    return <p className="text-sm text-red py-12 text-center">브리핑을 불러오지 못했습니다. 새로고침해 주세요.</p>;
  }

  const monthLabel = `${parseInt(b.month?.split('-')[1] || '0', 10)}월`;
  const metaDaily = (b.meta?.daily || []).map((d: any) => ({
    ...d,
    label: d.date?.slice(5),
    roas: d.spend ? d.revenue / d.spend : null,
  }));

  return (
    <div className="space-y-4">
      {/* 상단 히어로: 이달 매출 + 상태 칩 */}
      <div
        className="rounded-xl p-5 flex flex-wrap items-end justify-between gap-4"
        style={{ backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' }}
      >
        <div className="flex flex-wrap gap-8 items-end">
          <div>
            <p className="text-xs text-text-tertiary mb-1">{monthLabel} 자사몰 매출 (취소·환불 제외)</p>
            <p className="text-3xl font-bold text-text-primary tabular-nums">{fmtWon(b.sales?.month_amount)}</p>
            <p className="text-[11px] text-text-quaternary mt-1">주문 {fmtNum(b.sales?.month_orders)}건</p>
          </div>
          <Metric
            label="최근 7일 매출"
            value={fmtWon(b.sales?.week_amount)}
            sub={<DeltaChip pct={b.sales?.week_delta_pct} />}
          />
          {b.goal?.month_planned_spend > 0 && (
            <Metric label={`${monthLabel} 광고비 계획`} value={fmtWon(b.goal.month_planned_spend)} />
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusChip ok={!!b.connections?.cafe24} label="카페24" />
          <StatusChip ok={!!b.connections?.meta} label="Meta" />
          <StatusChip
            ok={!!b.affiliate?.tracking_healthy}
            label={b.affiliate?.tracking_healthy ? '어필 추적 정상' : '어필 추적 점검 필요'}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Meta 광고 */}
        <SectionCard title="Meta 광고 · 최근 7일" icon={LineChart} menu="live" subTab={0}>
          <div className="flex gap-6 flex-wrap">
            <Metric label="지출" value={fmtWon(b.meta?.spend_7d)} sub={<DeltaChip pct={b.meta?.spend_delta_pct} />} />
            <Metric label="전환 매출" value={fmtWon(b.meta?.revenue_7d)} />
            <Metric
              label="ROAS"
              value={b.meta?.roas_7d != null ? b.meta.roas_7d.toFixed(2) : '-'}
              sub={b.meta?.roas_prev7 != null ? `이전 7일 ${b.meta.roas_prev7.toFixed(2)}` : undefined}
            />
            <Metric label="구매" value={fmtNum(b.meta?.purchases_7d)} />
          </div>
          {metaDaily.length > 0 && (
            <div className="h-36">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={metaDaily} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--color-text-quaternary)' }} tickLine={false} axisLine={false} />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)',
                      borderRadius: 8, fontSize: 11,
                    }}
                    formatter={(v: any, name: any) =>
                      name === '지출' || name === '매출' ? [fmtWon(v), name] : [v, name]}
                  />
                  <Bar dataKey="spend" name="지출" fill="#4EA7FC" opacity={0.5} radius={[3, 3, 0, 0]} />
                  <Line dataKey="revenue" name="매출" stroke="#27A644" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        {/* 어필리에이트 */}
        <SectionCard title="공구·어필리에이트" icon={Megaphone} menu="affiliate">
          <div className="flex gap-6 flex-wrap">
            <Metric label="확정 매출 (30일)" value={fmtWon(b.affiliate?.confirmed_amount_30d)} sub={`${fmtNum(b.affiliate?.confirmed_orders_30d)}건`} />
            <Metric label="클릭 (7일)" value={fmtNum(b.affiliate?.clicks_7d)} sub={<DeltaChip pct={b.affiliate?.clicks_delta_pct} />} />
            <Metric label="구매 연결 (7일)" value={fmtNum(b.affiliate?.binds_7d)} />
            <Metric label="활성 캠페인" value={fmtNum(b.affiliate?.active_campaigns)} />
          </div>
          <p className="text-[11px] text-text-quaternary">
            확정 매출 = 추적 링크·전용 쿠폰으로 구매가 확인된 주문만 집계 (정산 기준)
          </p>
        </SectionCard>

        {/* 네이버 브랜드 */}
        <SectionCard title="네이버 브랜드 언급량" icon={MessageCircle} menu="intel" subTab={0}>
          {(b.naver_mentions || []).length === 0 ? (
            <p className="text-xs text-text-tertiary">수집된 언급량 스냅샷이 없습니다.</p>
          ) : (
            <div className="flex gap-8 flex-wrap">
              {b.naver_mentions.map((m: any) => (
                <div key={m.keyword}>
                  <p className="text-xs font-medium text-text-secondary mb-1">“{m.keyword}”</p>
                  <div className="flex gap-5">
                    <Metric label="블로그 누적" value={fmtNum(m.blog_total)} sub={`+${fmtNum(m.blog_delta_14d)} / 14일`} />
                    <Metric label="카페 누적" value={fmtNum(m.cafe_total)} />
                  </div>
                  <p className="text-[10px] text-text-quaternary mt-1">기준 {m.as_of}</p>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* 활동 기록 — 월별 조회수 미니 차트 */}
        <SectionCard title={`활동 기록 · ${monthLabel}`} icon={ClipboardList} menu="input" subTab={1}>
          <div className="flex gap-6 flex-wrap">
            <Metric label="기록" value={`${fmtNum(b.activities?.month_rows)}건`} />
            <Metric label="조회수 합계" value={fmtNum(b.activities?.month_views)} />
            <Metric label="집행 비용" value={fmtWon(b.activities?.month_cost)} />
          </div>
          {(b.activities_monthly || []).length > 0 && (
            <div className="h-28">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={b.activities_monthly.map((m: any) => ({ ...m, label: m.month.slice(2) }))} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--color-text-quaternary)' }} tickLine={false} axisLine={false} />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)', borderRadius: 8, fontSize: 11 }}
                    formatter={(v: any, name: any) => (name === '비용' ? [fmtWon(v), name] : [fmtNum(v), name])}
                  />
                  <Bar dataKey="views" name="조회수" fill="#4EA7FC" opacity={0.6} radius={[3, 3, 0, 0]} />
                  <Line dataKey="cost" name="비용" stroke="#F0BF00" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        {/* 광고비 일보 — 집행 vs Limit + 6개월 추이 */}
        <SectionCard title={`광고비 일보 · ${monthLabel}`} icon={Receipt} menu="input" subTab={0}>
          <div className="flex gap-6 flex-wrap">
            <Metric label="집행" value={fmtWon(b.adspend?.month_spend)} />
            <Metric label="Limit" value={b.adspend?.month_limit ? fmtWon(b.adspend.month_limit) : '-'} />
            <Metric
              label="사용율"
              value={b.adspend?.usage_pct != null ? `${b.adspend.usage_pct}%` : '-'}
            />
          </div>
          <MiniProgress pct={b.adspend?.usage_pct} />
          {(b.adspend?.monthly || []).length > 0 && (
            <div className="h-28">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={b.adspend.monthly.map((m: any) => ({ ...m, label: m.month.slice(2) }))} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--color-text-quaternary)' }} tickLine={false} axisLine={false} />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)', borderRadius: 8, fontSize: 11 }}
                    formatter={(v: any, name: any) => [fmtWon(v), name]}
                  />
                  <Bar dataKey="spend" name="집행" fill="#7070FF" opacity={0.6} radius={[3, 3, 0, 0]} />
                  <Line dataKey="limit" name="Limit" stroke="#EA4335" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        {/* 협찬 — 이달 요약 + 6개월 추이 */}
        <SectionCard title={`협찬 · ${monthLabel}`} icon={Gift} menu="sponsorship" subTab={0}>
          <div className="flex gap-6 flex-wrap">
            <Metric label="협찬" value={`${fmtNum(b.sponsorship?.month_count)}건`} />
            <Metric label="품목 수량" value={`${fmtNum(b.sponsorship?.month_quantity)}개`} />
            <Metric label="환산 금액" value={fmtWon(b.sponsorship?.month_value)} />
            <Metric label="결과물" value={`${fmtNum(b.sponsorship?.month_outcomes)}건`} />
          </div>
          {(b.sponsorship?.monthly || []).some((m: any) => m.count > 0) ? (
            <div className="h-28">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={b.sponsorship.monthly.map((m: any) => ({ ...m, label: m.month.slice(2) }))} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--color-text-quaternary)' }} tickLine={false} axisLine={false} />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)', borderRadius: 8, fontSize: 11 }}
                    formatter={(v: any, name: any) => (name === '환산 금액' ? [fmtWon(v), name] : [fmtNum(v), name])}
                  />
                  <Bar dataKey="count" name="협찬 건수" fill="#17BEBB" opacity={0.6} radius={[3, 3, 0, 0]} />
                  <Line dataKey="value" name="환산 금액" stroke="#F0BF00" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-[11px] text-text-quaternary">
              최근 6개월 협찬 기록이 없습니다 — <b className="text-text-tertiary">협찬 관리 › 협찬 등록</b>에서 기입하세요
            </p>
          )}
        </SectionCard>

        {/* KPI 목표 현황 */}
        <SectionCard title={`목표 현황 · ${monthLabel}`} icon={Target} menu="analysis" subTab={0}>
          <div className="space-y-2.5">
            <div>
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-text-tertiary">자사몰 매출 vs 외부 목표 매출</span>
                <span className="text-text-secondary tabular-nums">
                  {fmtWon(b.sales?.month_amount)}{b.goal?.ext_target_revenue ? ` / ${fmtWon(b.goal.ext_target_revenue)}` : ' / 목표 미입력'}
                </span>
              </div>
              <MiniProgress pct={b.goal?.ext_target_revenue ? Math.round((b.sales?.month_amount / b.goal.ext_target_revenue) * 100) : null} />
            </div>
            <div>
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-text-tertiary">광고비 집행 vs Limit</span>
                <span className="text-text-secondary tabular-nums">
                  {fmtWon(b.adspend?.month_spend)}{b.adspend?.month_limit ? ` / ${fmtWon(b.adspend.month_limit)}` : ''}
                </span>
              </div>
              <MiniProgress pct={b.adspend?.usage_pct} />
            </div>
            <p className="text-[11px] text-text-quaternary">
              목표 CAC {b.goal?.target_cac ? fmtWon(b.goal.target_cac) : '미입력'} · 목표 신규고객 {b.goal?.target_new_customers ? fmtNum(b.goal.target_new_customers) : '미입력'}
              — 목표는 <b className="text-text-tertiary">입력 › 월 목표 입력</b>에서
            </p>
          </div>
        </SectionCard>
      </div>
      <p className="text-[10px] text-text-quaternary text-right">
        데이터 기준: {b.as_of ? new Date(b.as_of + 'Z').toLocaleString('ko-KR') : '-'} · 10분마다 자동 갱신
      </p>
    </div>
  );
}

function StatusChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium ${
        ok ? 'bg-green/15 text-green' : 'bg-red/15 text-red'
      }`}
    >
      {ok ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
      {label}
    </span>
  );
}
