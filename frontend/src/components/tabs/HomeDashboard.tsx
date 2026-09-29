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
  ShoppingBag, LineChart, Megaphone, MessageCircle, ClipboardList,
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
        <SectionCard title="Meta 광고 · 최근 7일" icon={LineChart} menu="ads" subTab={0}>
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

        {/* 활동 기록 */}
        <SectionCard title={`활동 기록 · ${monthLabel}`} icon={ClipboardList} menu="activities">
          <div className="flex gap-6 flex-wrap">
            <Metric label="기록" value={`${fmtNum(b.activities?.month_rows)}건`} />
            <Metric label="조회수 합계" value={fmtNum(b.activities?.month_views)} />
            <Metric label="집행 비용" value={fmtWon(b.activities?.month_cost)} />
          </div>
          <p className="text-[11px] text-text-quaternary">
            콘텐츠·인플루언서·체험단·서포터즈 집행을 시트 대신 여기에 기록하면 월별·채널별로 자동 집계됩니다.
          </p>
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
