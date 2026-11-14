'use client';

/**
 * 광고 채널 › 데이터라이즈 — 월간 CRM 운영 진단 (2026-11-03 마케팅 연다은 건의 37189ff2).
 *
 * 출처: 데이터라이즈가 매일 9시에 채우는 구글시트 → 백엔드가 매일 09:30·13:30 KST 불러와 DB에 쌓는다.
 * 원칙: 기여매출·구매자·주문은 채널끼리 더하지 않는다(합계는 발송·도달·발송비만).
 *       도달 300건 미만 칸은 비율을 내지 않는다. 문자는 클릭 추적이 없어 '-'.
 * 시트에 칸이 없어 못 만든 항목(커버리지·구매 횟수 단계·미도달 히트맵)은 화면 맨 아래에 적어 둔다.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, LineChart, XAxis, YAxis, CartesianGrid,
  Tooltip as ReTooltip, Legend,
} from 'recharts';
import { Loader2, RefreshCw, Printer, Info, AlertTriangle, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  datarizeApi, type DatarizeBasis, type DatarizeReport, type DzMetrics, type DzDelta, type DzDailyRow,
} from '@/lib/datarize-api';

// ─── 표시 규칙 ───
const SMALL_TEXT = '표본이 적어 해석하지 않습니다';
const CH_COLOR: Record<string, string> = {
  '브랜드 메시지': '#4A85FF', '알림톡': '#4EA7FC', '문자': '#14B8A6', '이메일': '#F97316',
};
const chColor = (c: string, i = 0) => CH_COLOR[c] || ['#8A8F98', '#A855F7', '#EC4899'][i % 3];
const tooltipStyle = { backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)', borderRadius: 8, fontSize: 12 };
const tick = { fontSize: 10, fill: 'var(--color-text-tertiary)' };

/** 금액은 만원 단위 */
const fmtMan = (v: number | null | undefined): string => {
  if (v === null || v === undefined) return '-';
  const m = v / 1e4;
  return Math.abs(v) >= 1e5 ? `${Math.round(m).toLocaleString('ko-KR')}만원` : `${m.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}만원`;
};
const fmtN = (v: number | null | undefined) => (v === null || v === undefined ? '-' : Math.round(v).toLocaleString('ko-KR'));
const fmtP = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? '-' : `${v.toFixed(d)}%`);
const fmtRoas = (v: number | null | undefined) => (v === null || v === undefined ? '-' : `${Math.round(v).toLocaleString('ko-KR')}%`);
const fmtWon = (v: number | null | undefined) => (v === null || v === undefined ? '-' : `${Math.round(v).toLocaleString('ko-KR')}원`);
const axisMan = (v: number) => (Math.abs(v) >= 1e8 ? `${(v / 1e8).toFixed(1)}억` : Math.abs(v) >= 1e4 ? `${Math.round(v / 1e4).toLocaleString()}만` : String(v));
const md = (iso: string | null | undefined) => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : '-');
const monthLabel = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5, 7))}월`;
const shortM = (m: string) => `${Number(m.slice(5, 7))}월`;

const RATE_KEYS = new Set(['reach_rate', 'visit_rate', 'click_rate', 'conv_rate']);

/** 전월 대비 — 금액·건수는 %, 비율은 %p. ▲ 초록 ▼ 빨강, 발송비처럼 좋고 나쁨이 없는 값은 회색 */
function Delta({ k, d, neutral }: { k: string; d: DzDelta | undefined; neutral?: boolean }) {
  const v = d ? (d as any)[k] : undefined;
  if (v === null || v === undefined || !isFinite(v)) return <span className="text-text-quaternary text-[10px]">전월 -</span>;
  const unit = RATE_KEYS.has(k) ? '%p' : '%';
  const cls = v === 0 || neutral ? 'text-text-tertiary' : v > 0 ? 'text-green' : 'text-red';
  return (
    <span className={`tabular-nums text-[10px] ${cls}`}>
      {v > 0 ? '▲' : v < 0 ? '▼' : ''}{Math.abs(v).toFixed(RATE_KEYS.has(k) ? 2 : 1)}{unit}
    </span>
  );
}

function Section({ title, sub, right, children, accent }: {
  title: string; sub?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; accent?: boolean;
}) {
  return (
    <section
      className="bg-bg-1 rounded-xl p-4 sm:p-5 break-inside-avoid"
      style={{ border: accent ? '1px solid #F0BF00' : '1px solid var(--color-border-primary)' }}
    >
      <div className="flex flex-wrap items-start gap-2 mb-3">
        <div>
          <h2 className="text-base font-semibold text-text-primary">{title}</h2>
          {sub && <p className="text-[11px] text-text-tertiary mt-0.5">{sub}</p>}
        </div>
        <div className="flex-1" />
        {right}
      </div>
      {children}
    </section>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs text-text-tertiary" style={{ border: '1px dashed var(--color-border-primary)' }}>
      <Info size={13} className="shrink-0 mt-0.5" /> <span>{children}</span>
    </div>
  );
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg p-0.5 print:hidden" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.06)' }}>
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className="px-2.5 py-1 rounded-md text-xs font-medium"
          style={value === o.v ? { backgroundColor: 'var(--color-bg-level-1)', color: 'var(--color-text-primary)' } : { color: 'var(--color-text-tertiary)' }}
        >{o.label}</button>
      ))}
    </div>
  );
}

const BASIS_TEXT: Record<DatarizeBasis, { label: string; desc: string }> = {
  visit: { label: '방문 기준', desc: '메시지를 받고 쇼핑몰을 방문한 회원의 구매를 그 메시지 성과로 셉니다' },
  click: { label: '클릭 기준', desc: '메시지 링크를 누른 회원의 구매만 그 메시지 성과로 셉니다' },
};

export default function DatarizeDashboard() {
  const qc = useQueryClient();
  const [month, setMonth] = useState<string | null>(null);
  const [basis, setBasis] = useState<DatarizeBasis>('visit');

  const statusQ = useQuery({ queryKey: ['datarize-status'], queryFn: datarizeApi.status, staleTime: 60_000 });
  const repQ = useQuery({
    queryKey: ['datarize-report', month, basis],
    queryFn: () => datarizeApi.report(month, basis),
    staleTime: 5 * 60_000,
  });
  const syncM = useMutation({
    mutationFn: datarizeApi.sync,
    onSuccess: (r) => {
      const rows = Object.values(r.tabs || {}).reduce((s, t) => s + (t.rows || 0), 0);
      if (r.status === 'ok') toast.success(`시트를 다시 불러왔습니다 (${rows.toLocaleString('ko-KR')}줄)`);
      else toast.error(`일부만 불러왔습니다 — ${Object.entries(r.tabs || {}).filter(([, t]) => !t.ok).map(([k, t]) => `${k}: ${t.error}`).join(' / ')}`);
      qc.invalidateQueries({ queryKey: ['datarize-status'] });
      qc.invalidateQueries({ queryKey: ['datarize-report'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || '불러오기에 실패했습니다'),
  });

  const r = repQ.data;
  useEffect(() => { if (r && !month && r.month) setMonth(r.month); }, [r, month]);

  const st = statusQ.data;
  const lastOk = st?.logs.find((l) => l.status === 'ok' || l.status === 'partial');

  return (
    <div className="space-y-4 datarize-print">
      {/* 인쇄(PDF)할 때 앱 머리·메뉴 숨김 — 이 화면이 떠 있을 때만 적용 */}
      <style>{`@media print { header, nav, .print-hide { display: none !important; } body { background: #fff; } .datarize-print section { break-inside: avoid; } }`}</style>

      {/* 머리 */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">데이터라이즈 CRM 운영 진단</h1>
          <p className="text-xs text-text-tertiary mt-0.5">
            브랜드 메시지·알림톡·문자·이메일 · 출처: 데이터라이즈 연동 구글시트
            {st && <> · 마지막 불러오기 {lastOk ? lastOk.finished_kst || lastOk.started_kst : '아직 없음'} · 자동 매일 {st.schedule_kst.join('·')}</>}
          </p>
        </div>
        <div className="flex-1" />
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <select
            value={month || ''}
            onChange={(e) => setMonth(e.target.value || null)}
            className="text-xs rounded-lg px-2 py-1.5 bg-bg-1 text-text-primary"
            style={{ border: '1px solid var(--color-border-primary)' }}
            aria-label="집계 달"
          >
            {(r?.months || (month ? [month] : [])).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <Seg value={basis} onChange={setBasis} options={[{ v: 'visit', label: '방문 기준' }, { v: 'click', label: '클릭 기준' }]} />
          {st?.can_sync && (
            <button
              onClick={() => syncM.mutate()}
              disabled={syncM.isPending || st.running}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg text-text-secondary disabled:opacity-50"
              style={{ border: '1px solid var(--color-border-primary)' }}
            >
              {syncM.isPending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} 지금 다시 불러오기
            </button>
          )}
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg text-text-secondary"
            style={{ border: '1px solid var(--color-border-primary)' }}
          >
            <Printer size={13} /> 인쇄·PDF
          </button>
          {st && (
            <a href={st.sheet_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-text-tertiary hover:text-text-secondary">
              시트 <ExternalLink size={11} />
            </a>
          )}
        </div>
      </div>

      {repQ.isLoading && (
        <div className="flex items-center justify-center py-20 text-text-tertiary text-sm gap-2">
          <Loader2 size={16} className="animate-spin" /> 불러오는 중…
        </div>
      )}
      {repQ.isError && <Notice>진단 데이터를 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.</Notice>}
      {r && r.empty && (
        <Notice>
          아직 불러온 데이터가 없습니다. 서버가 매일 {st?.schedule_kst.join('·') || '09:30'}에 시트를 읽습니다
          {st?.can_sync ? ' — 오른쪽 위 「지금 다시 불러오기」로 바로 읽을 수 있습니다.' : '.'}
          {st?.logs[0]?.tabs && Object.values(st.logs[0].tabs).some((t) => !t.ok) && (
            <> 마지막 시도 오류: {Object.entries(st.logs[0].tabs).filter(([, t]) => !t.ok).map(([k, t]) => `${k} ${t.error}`).join(' / ')}</>
          )}
        </Notice>
      )}
      {r && !r.empty && <Report r={r} basis={basis} />}
    </div>
  );
}

function PeriodLine({ r, basis }: { r: DatarizeReport; basis: DatarizeBasis }) {
  const mi = r.month_info;
  return (
    <div className="rounded-lg px-3 py-2 text-xs text-text-secondary flex flex-wrap gap-x-4 gap-y-1" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.04)' }}>
      <span><b className="text-text-primary">집계 기간</b> {md(mi.start)}~{md(mi.end)}{mi.partial ? ` (데이터 ${md(mi.first)}~${md(mi.last)}, ${mi.data_days}/${mi.days_in_month}일${mi.in_progress ? ' · 진행 중인 달' : ''})` : ''} · 비교: {monthLabel(r.prev_month)}{r.prev_month_info.partial && r.prev_month_info.data_days ? ` (${r.prev_month_info.data_days}일치)` : ''}</span>
      <span><b className="text-text-primary">귀속 기준</b> {BASIS_TEXT[basis].label} — {BASIS_TEXT[basis].desc}. 기여 기간은 데이터라이즈 설정값을 따릅니다(요청서: 방문 48시간·클릭 24시간, 시트에는 기간 값이 없음).</span>
    </div>
  );
}

function Report({ r, basis }: { r: DatarizeReport; basis: DatarizeBasis }) {
  const [detailCh, setDetailCh] = useState<string>(r.channels[0] || '');
  useEffect(() => { if (!r.channels.includes(detailCh)) setDetailCh(r.channels[0] || ''); }, [r.channels, detailCh]);
  const t = r.totals;
  const live = r.by_channel.filter((b) => b.cur);

  return (
    <>
      <PeriodLine r={r} basis={basis} />

      {/* 1. 요약 카드 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Section title="CRM 성과" sub={`채널별 기여매출 · ${BASIS_TEXT[basis].label} — 채널끼리 더하지 않습니다(한 구매가 여러 채널에 함께 잡힐 수 있음)`}>
          <div className="space-y-2">
            {live.map((b) => (
              <div key={b.channel} className="flex items-baseline gap-2">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: chColor(b.channel) }} />
                <span className="text-xs text-text-secondary w-20 shrink-0">{b.channel}</span>
                <span className="text-sm font-semibold text-text-primary tabular-nums">{fmtMan(b.cur!.revenue)}</span>
                <Delta k="revenue" d={b.delta} />
                <span className="flex-1" />
                <span className="text-[11px] text-text-tertiary tabular-nums">ROAS {b.cur!.small_sample ? '표본 적음' : fmtRoas(b.cur!.roas)}</span>
              </div>
            ))}
          </div>
        </Section>
        <Section title="CRM 운영" sub="네 채널 합계(발송·도달·발송비만 더함)">
          <div className="grid grid-cols-3 gap-2">
            {([['발송', 'attempts', fmtN(t.cur.attempts) + '건'], ['도달', 'sent', fmtN(t.cur.sent) + '건'], ['발송비', 'cost', fmtMan(t.cur.cost)]] as const).map(([label, k, val]) => (
              <div key={k}>
                <p className="text-[11px] text-text-tertiary">{label}</p>
                <p className="text-sm font-semibold text-text-primary tabular-nums">{val}</p>
                <Delta k={k} d={t.delta} neutral={k === 'cost'} />
              </div>
            ))}
          </div>
          <p className="text-[11px] text-text-tertiary mt-3">
            도달률 {fmtP(t.cur.reach_rate, 1)} <Delta k="reach_rate" d={t.delta} /> · 도달 1건당 발송비 {fmtWon(t.cur.cost_per_reach)}
          </p>
        </Section>
        <Section title="회원·수신 동의" sub={r.members.cur ? `${md(r.members.cur.date)} 기준 회원 수` : '회원 수 데이터 없음'}>
          {r.members.cur ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div><p className="text-[11px] text-text-tertiary">전체 회원</p><p className="text-sm font-semibold text-text-primary tabular-nums">{fmtN(r.members.cur.total)}</p><Delta k="total" d={r.members.delta as any} /></div>
                <div><p className="text-[11px] text-text-tertiary">이메일 동의</p><p className="text-sm font-semibold text-text-primary tabular-nums">{fmtP(r.members.cur.email_rate, 1)}</p><span className="text-[10px] text-text-tertiary">{fmtN(r.members.cur.email_opt_in)}명</span></div>
                <div><p className="text-[11px] text-text-tertiary">문자 동의</p><p className="text-sm font-semibold text-text-primary tabular-nums">{fmtP(r.members.cur.sms_rate, 1)}</p><span className="text-[10px] text-text-tertiary">{fmtN(r.members.cur.sms_opt_in)}명</span></div>
              </div>
              <p className="text-[11px] text-text-tertiary mt-3">
                전체 커버리지(이번 달 한 채널이라도 받은 회원 ÷ 전체 회원)는 시트에 회원별 발송 기록이 없어 계산하지 않습니다.
              </p>
            </>
          ) : <Notice>수신 동의 탭을 아직 불러오지 않았습니다.</Notice>}
        </Section>
      </div>

      {/* 2. 눈여겨볼 변화 */}
      {r.insights.length > 0 && (
        <Section title="눈여겨볼 변화" sub={`${monthLabel(r.prev_month)} 대비 · 두 달 모두 도달 300건 이상인 채널만`} accent>
          <ul className="space-y-1.5">
            {r.insights.map((x, i) => (
              <li key={i} className="flex gap-2 text-sm text-text-primary">
                <span className={x.tone === 'up' ? 'text-green' : x.tone === 'down' ? 'text-red' : 'text-text-tertiary'}>●</span>
                {x.text}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* 3. 채널 비교 */}
      <ChannelTable r={r} basis={basis} />

      {/* 4. 채널 상세 */}
      <Section
        title="채널 상세"
        sub="최근 5개월 추이와 이번 달 퍼널"
        right={<Seg value={detailCh} onChange={setDetailCh} options={r.channels.map((c) => ({ v: c, label: c }))} />}
      >
        <ChannelDetail r={r} ch={detailCh} basis={basis} />
      </Section>

      {/* 5. 일별 추이 */}
      <DailyTrend r={r} basis={basis} />

      {/* 6. 캠페인 */}
      <CampaignTable r={r} basis={basis} />

      {/* 7. 세그먼트 */}
      <SegmentTable r={r} />

      {/* 8. 발송비 12개월 */}
      <CostHistory r={r} />

      {/* 9. 못 만든 항목 · 정의 */}
      <Section title="이번 화면에서 만들지 못한 항목" sub="시트에 필요한 칸이 없어 비워 둔 것 — 데이터라이즈에서 칸을 추가해 주면 붙일 수 있습니다">
        <ul className="text-xs text-text-secondary space-y-1 list-disc pl-4">
          <li><b>전체 커버리지</b>(이번 달 한 채널이라도 받은 회원 ÷ 전체 회원) — 회원별 발송 기록(누가 받았는지)이 없습니다. 시트는 캠페인×날짜 합계만 있습니다.</li>
          <li><b>구매자 수(중복 없는 사람 수)</b> — 시트의 &lsquo;구매전환수&rsquo;는 캠페인×날짜 단위라 한 달로 더하면 같은 사람이 여러 번 셀 수 있습니다. 화면의 &lsquo;구매자&rsquo;는 이 합(최대치)입니다.</li>
          <li><b>구매 단계별 성과</b>(미구매·1회·2~4회·5회 이상) — 발송·성과를 회원의 구매 횟수로 나눈 칸이 없습니다. 대신 데이터라이즈 세그먼트(첫구매/재구매 × 방문 상태) 회원 수를 보여 줍니다.</li>
          <li><b>회원 구간 미도달률 히트맵</b>(구매 단계 × 마지막 구매 뒤 경과일) — 회원 단위 도달 여부·경과일 칸이 없습니다.</li>
          <li><b>기여 기간 값</b>(방문 48시간·클릭 24시간) — 시트에 기간 칸이 없어 데이터라이즈 설정을 그대로 따른다고만 적었습니다.</li>
          <li><b>문자 클릭</b> — 문자는 클릭 추적이 없어 클릭 지표를 &lsquo;-&rsquo;로 둡니다.</li>
        </ul>
      </Section>

      <Section title="지표 정의">
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
          {[
            ['발송', '데이터라이즈 발송시도수'],
            ['도달', '발송수(실제로 나간 건) — 발송비는 이 건수에만 매겨집니다'],
            ['도달률', '도달 ÷ 발송'],
            ['방문율 · 클릭률', '방문자수 ÷ 도달 · 클릭자수 ÷ 도달'],
            ['구매자', '구매전환수 합(캠페인×날짜 합이라 중복 가능)'],
            ['기여매출', `${BASIS_TEXT[basis].label} 기여금액 — 채널끼리 더하지 않음`],
            ['ROAS', '기여매출 ÷ 발송비 × 100 (%, 데이터라이즈 표기와 같음)'],
            ['도달당 매출', '기여매출 ÷ 도달'],
            ['객단가', '기여매출 ÷ 구매건수'],
            ['전월 대비', '건수·금액은 %, 비율은 %p · ▲ 증가 ▼ 감소(발송비는 회색)'],
            ['표본 기준', `도달 300건 미만이면 비율을 내지 않습니다 — "${SMALL_TEXT}"`],
            ['금액 단위', '만원 (10만원 미만은 소수 1자리)'],
          ].map(([k, v]) => (
            <div key={k} className="flex gap-2"><dt className="w-24 shrink-0 text-text-tertiary">{k}</dt><dd className="text-text-secondary">{v}</dd></div>
          ))}
        </dl>
      </Section>
    </>
  );
}

function Cell({ v, k, d, small, neutral }: { v: string; k?: string; d?: DzDelta; small?: boolean; neutral?: boolean }) {
  if (small) return <td className="px-2 py-1.5 text-right text-[10px] text-text-quaternary" title={SMALL_TEXT}>표본 적음</td>;
  return (
    <td className="px-2 py-1.5 text-right tabular-nums">
      <div className="text-text-primary">{v}</div>
      {k && <Delta k={k} d={d} neutral={neutral} />}
    </td>
  );
}

function ChannelTable({ r, basis }: { r: DatarizeReport; basis: DatarizeBasis }) {
  const heads = ['채널', '발송', '도달', '도달률', '발송비', '방문(율)', '클릭(율)', '구매자', '주문', '기여매출', 'ROAS', '도달당 매출', '객단가'];
  return (
    <Section title="채널 비교" sub={`${monthLabel(r.month)} · ${BASIS_TEXT[basis].label} · 칸 아래 작은 글씨는 전월 대비 · 표본 적음 = ${SMALL_TEXT}(도달 300건 미만)`}>
      <div className="rounded-lg overflow-x-auto" style={{ border: '1px solid var(--color-border-primary)' }}>
        <table className="w-full min-w-[980px] text-xs">
          <thead>
            <tr className="text-text-tertiary" style={{ backgroundColor: 'var(--color-bg-level-2)' }}>
              {heads.map((h, i) => <th key={h} className={`px-2 py-2 font-medium ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {r.by_channel.map(({ channel, cur, delta }) => (
              <tr key={channel} style={{ borderTop: '1px solid var(--color-border-primary)' }}>
                <td className="px-2 py-1.5 text-text-primary whitespace-nowrap">
                  <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: chColor(channel) }} />{channel}
                </td>
                {!cur ? <td colSpan={12} className="px-2 py-1.5 text-text-quaternary">이번 달 발송 없음</td> : (
                  <>
                    <Cell v={fmtN(cur.attempts)} k="attempts" d={delta} neutral />
                    <Cell v={fmtN(cur.sent)} k="sent" d={delta} neutral />
                    <Cell v={fmtP(cur.reach_rate, 1)} k="reach_rate" d={delta} small={cur.small_sample} />
                    <Cell v={fmtMan(cur.cost)} k="cost" d={delta} neutral />
                    <Cell v={`${fmtN(cur.visitors)} (${fmtP(cur.visit_rate)})`} k="visit_rate" d={delta} small={cur.small_sample} />
                    {cur.clickers === null || cur.clickers === undefined
                      ? <td className="px-2 py-1.5 text-right text-text-quaternary" title="문자는 클릭 추적 없음">-</td>
                      : <Cell v={`${fmtN(cur.clickers)} (${fmtP(cur.click_rate)})`} k="click_rate" d={delta} small={cur.small_sample} />}
                    <Cell v={fmtN(cur.conv_users)} k="conv_users" d={delta} />
                    <Cell v={fmtN(cur.orders)} k="orders" d={delta} />
                    <Cell v={fmtMan(cur.revenue)} k="revenue" d={delta} />
                    <Cell v={fmtRoas(cur.roas)} k="roas" d={delta} small={cur.small_sample} />
                    <Cell v={fmtWon(cur.revenue_per_reach)} k="revenue_per_reach" d={delta} small={cur.small_sample} />
                    <Cell v={fmtWon(cur.aov)} k="aov" d={delta} small={cur.small_sample} />
                  </>
                )}
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid var(--color-border-primary)', backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.03)' }}>
              <td className="px-2 py-1.5 font-medium text-text-primary">합계</td>
              <Cell v={fmtN(r.totals.cur.attempts)} k="attempts" d={r.totals.delta} neutral />
              <Cell v={fmtN(r.totals.cur.sent)} k="sent" d={r.totals.delta} neutral />
              <Cell v={fmtP(r.totals.cur.reach_rate, 1)} k="reach_rate" d={r.totals.delta} />
              <Cell v={fmtMan(r.totals.cur.cost)} k="cost" d={r.totals.delta} neutral />
              <td colSpan={8} className="px-2 py-1.5 text-[11px] text-text-quaternary">성과(방문·구매·매출)는 채널끼리 더하지 않습니다</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function ChannelDetail({ r, ch, basis }: { r: DatarizeReport; ch: string; basis: DatarizeBasis }) {
  const b = r.by_channel.find((x) => x.channel === ch);
  const trend = r.trend.map((t) => {
    const c = t.channels[ch];
    return {
      label: shortM(t.month) + (t.partial && t.data_days ? '*' : '') + (c?.source === 'cost_only' ? '†' : ''),
      cost: c?.cost ?? null, revenue: c?.revenue ?? null, roas: c && !c.small_sample ? c.roas : null,
    };
  });
  const cur = b?.cur;
  const clickStep = basis === 'click';
  const steps = cur ? [
    { label: '발송', v: cur.attempts },
    { label: '도달', v: cur.sent },
    clickStep
      ? { label: '클릭', v: cur.clickers ?? null }
      : { label: '방문', v: cur.visitors ?? null },
    { label: '구매자', v: cur.conv_users ?? null },
  ] : [];
  const max = Math.max(1, ...steps.map((s) => s.v || 0));
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div>
        <p className="text-xs font-medium text-text-secondary mb-2">발송비·기여매출(막대) · ROAS(선)</p>
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer>
            <ComposedChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
              <XAxis dataKey="label" tick={tick} />
              <YAxis yAxisId="l" tick={tick} tickFormatter={axisMan} width={44} />
              <YAxis yAxisId="r" orientation="right" tick={tick} tickFormatter={(v) => `${v}%`} width={44} />
              <ReTooltip contentStyle={tooltipStyle} formatter={(v: any, n: any) => (n === 'ROAS' ? fmtRoas(v) : fmtMan(v))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="l" dataKey="cost" name="발송비" fill="#8A8F98" radius={[3, 3, 0, 0]} />
              <Bar yAxisId="l" dataKey="revenue" name="기여매출" fill={chColor(ch)} radius={[3, 3, 0, 0]} />
              <Line yAxisId="r" dataKey="roas" name="ROAS" stroke="#F0BF00" strokeWidth={2} dot connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[10px] text-text-quaternary mt-1">* 한 달 중 일부 날짜만 있음 · † 메시지 성과 칸이 시트 보관 기간(약 90일) 밖이라 발송비(충전금 차감 내역)만 표시. 시스템이 매일 쌓으므로 다음 달부터 더 길어집니다.</p>
      </div>
      <div>
        <p className="text-xs font-medium text-text-secondary mb-2">{monthLabel(r.month)} 퍼널 · {BASIS_TEXT[basis].label}</p>
        {!cur ? <Notice>이번 달 발송이 없습니다.</Notice> : cur.small_sample ? <Notice>도달 {fmtN(cur.sent)}건 — {SMALL_TEXT}.</Notice> : (
          <div className="space-y-2">
            {steps.map((s, i) => {
              const prevV = i ? steps[i - 1].v : null;
              const conv = s.v !== null && prevV ? (s.v / prevV) * 100 : null;
              return (
                <div key={s.label}>
                  <div className="flex items-baseline text-xs mb-0.5">
                    <span className="text-text-secondary w-14">{s.label}</span>
                    <span className="text-text-primary tabular-nums font-medium">{s.v === null ? '-' : `${fmtN(s.v)}${s.label === '구매자' ? '명' : '건'}`}</span>
                    <span className="flex-1" />
                    {i > 0 && <span className="text-text-tertiary tabular-nums">앞 단계의 {conv === null ? '-' : fmtP(conv, conv < 1 ? 2 : 1)}</span>}
                  </div>
                  <div className="h-3 rounded" style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.05)' }}>
                    <div className="h-3 rounded" style={{ width: `${s.v ? Math.max(1, (s.v / max) * 100) : 0}%`, backgroundColor: chColor(ch), opacity: 1 - i * 0.18 }} />
                  </div>
                </div>
              );
            })}
            {clickStep && cur.clickers === null && <p className="text-[11px] text-text-tertiary">문자는 클릭 추적이 없어 클릭·클릭 기준 구매를 셀 수 없습니다.</p>}
            <p className="text-[11px] text-text-tertiary pt-1">기여매출 {fmtMan(cur.revenue)} · 주문 {fmtN(cur.orders)}건 · 발송비 {fmtMan(cur.cost)} · ROAS {fmtRoas(cur.roas)}</p>
          </div>
        )}
      </div>
    </div>
  );
}

type DailyMetric = 'sent' | 'cost' | 'visitors' | 'conv_users' | 'revenue';
const DAILY_LABEL: Record<DailyMetric, string> = { sent: '도달', cost: '발송비', visitors: '방문', conv_users: '구매자', revenue: '기여매출' };
const ADDITIVE = new Set<DailyMetric>(['sent', 'cost']);

function DailyTrend({ r, basis }: { r: DatarizeReport; basis: DatarizeBasis }) {
  const [metric, setMetric] = useState<DailyMetric>('cost');
  const [ch, setCh] = useState<string>('__all__');
  const allowAll = ADDITIVE.has(metric);
  const channel = !allowAll && ch === '__all__' ? r.channels[0] : ch;
  const pick = (m: Record<string, DzDailyRow>) => {
    if (channel === '__all__') {
      const xs = Object.values(m);
      return xs.length ? xs.reduce((s, x) => s + ((x as any)[metric] || 0), 0) : null;
    }
    const v = m[channel] ? (m[channel] as any)[metric] : undefined;
    return v === undefined ? null : v;
  };
  const data = r.daily.map((d) => ({ label: `${md(d.date)}(${d.weekday})`, cur: pick(d.cur), prev: pick(d.prev), prevDate: md(d.prev_date) }));
  const money = metric === 'cost' || metric === 'revenue';
  return (
    <Section
      title="일별 추이 — 이번 달 vs 4주 전 같은 요일"
      sub={`${monthLabel(r.month)} 각 날짜를 28일 전(같은 요일)과 나란히 · ${BASIS_TEXT[basis].label}${!allowAll ? ' · 성과 지표는 채널끼리 더하지 않아 채널을 하나 고릅니다' : ''}`}
      right={
        <div className="flex flex-wrap gap-2 print:hidden">
          <Seg value={metric} onChange={setMetric} options={(Object.keys(DAILY_LABEL) as DailyMetric[]).map((k) => ({ v: k, label: DAILY_LABEL[k] }))} />
          <select
            value={channel}
            onChange={(e) => setCh(e.target.value)}
            className="text-xs rounded-lg px-2 py-1 bg-bg-1 text-text-primary"
            style={{ border: '1px solid var(--color-border-primary)' }}
          >
            {allowAll && <option value="__all__">네 채널 합계</option>}
            {r.channels.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      }
    >
      <div style={{ width: '100%', height: 240 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
            <XAxis dataKey="label" tick={tick} interval="preserveStartEnd" minTickGap={16} />
            <YAxis tick={tick} tickFormatter={money ? axisMan : (v) => Number(v).toLocaleString()} width={48} />
            <ReTooltip
              contentStyle={tooltipStyle}
              formatter={(v: any, n: any) => [money ? fmtMan(v) : fmtN(v), n]}
              labelFormatter={(l: any, p: any) => (p?.[0]?.payload ? `${l} · 비교 ${p[0].payload.prevDate}` : l)}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line dataKey="cur" name="이번 달" stroke={channel === '__all__' ? '#4EA7FC' : chColor(channel)} strokeWidth={2} dot={false} connectNulls={false} />
            <Line dataKey="prev" name="4주 전" stroke="#8A8F98" strokeDasharray="4 3" strokeWidth={1.5} dot={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Section>
  );
}

function CampaignTable({ r, basis }: { r: DatarizeReport; basis: DatarizeBasis }) {
  const [ch, setCh] = useState<string>('__all__');
  const rows = useMemo(() => r.campaigns.filter((c) => ch === '__all__' || c.channel === ch).slice(0, 20), [r.campaigns, ch]);
  return (
    <Section
      title="캠페인별 이번 달"
      sub={`기여매출 많은 순 상위 20개 (전체 ${r.campaign_count}개 중 상위 40개에서) · ${BASIS_TEXT[basis].label}`}
      right={
        <select value={ch} onChange={(e) => setCh(e.target.value)} className="text-xs rounded-lg px-2 py-1 bg-bg-1 text-text-primary print:hidden" style={{ border: '1px solid var(--color-border-primary)' }}>
          <option value="__all__">모든 채널</option>
          {r.channels.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      }
    >
      <div className="rounded-lg overflow-x-auto" style={{ border: '1px solid var(--color-border-primary)' }}>
        <table className="w-full min-w-[820px] text-xs">
          <thead>
            <tr className="text-text-tertiary" style={{ backgroundColor: 'var(--color-bg-level-2)' }}>
              {['캠페인', '채널', '도달', '발송비', '방문율', '클릭률', '구매자', '기여매출', 'ROAS'].map((h, i) => (
                <th key={h} className={`px-2 py-2 font-medium ${i < 2 ? 'text-left' : 'text-right'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.channel + c.campaign_id} style={{ borderTop: '1px solid var(--color-border-primary)' }}>
                <td className="px-2 py-1.5 text-text-primary max-w-[320px] truncate" title={c.name}>{c.name}</td>
                <td className="px-2 py-1.5 text-text-secondary whitespace-nowrap">{c.channel}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-text-secondary">{fmtN(c.sent)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-text-secondary">{fmtMan(c.cost)}</td>
                {c.small_sample
                  ? <td colSpan={2} className="px-2 py-1.5 text-right text-[10px] text-text-quaternary">{SMALL_TEXT}</td>
                  : <>
                      <td className="px-2 py-1.5 text-right tabular-nums text-text-secondary">{fmtP(c.visit_rate)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-text-secondary">{c.click_rate === null || c.click_rate === undefined ? '-' : fmtP(c.click_rate)}</td>
                    </>}
                <td className="px-2 py-1.5 text-right tabular-nums text-text-secondary">{fmtN(c.conv_users)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-text-primary">{fmtMan(c.revenue)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-text-primary">{c.small_sample ? '-' : fmtRoas(c.roas)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function SegmentTable({ r }: { r: DatarizeReport }) {
  const [cls, setCls] = useState<'상세' | '간단'>('상세');
  const rows = r.segments.rows.filter((x) => (x.classification || '상세') === cls);
  if (!r.segments.date) return null;
  return (
    <Section
      title="회원 세그먼트 현황"
      sub={`데이터라이즈 방문·구매 세그먼트 · ${md(r.segments.date)} 기준${r.segments.compare_date ? ` · 증감은 ${md(r.segments.compare_date)} 대비` : ''} · 구매 횟수(1회/2~4회/5회+) 구간 대신 데이터라이즈 분류를 씁니다`}
      right={<Seg value={cls} onChange={setCls} options={[{ v: '상세', label: '상세' }, { v: '간단', label: '간단' }]} />}
    >
      <div className="rounded-lg overflow-x-auto" style={{ border: '1px solid var(--color-border-primary)' }}>
        <table className="w-full min-w-[680px] text-xs">
          <thead>
            <tr className="text-text-tertiary" style={{ backgroundColor: 'var(--color-bg-level-2)' }}>
              {['세그먼트', '회원 수', '증감', '비중', '미방문 기간(중앙값)', '미구매 기간(중앙값)', '평균 구매금액'].map((h, i) => (
                <th key={h} className={`px-2 py-2 font-medium ${i ? 'text-right' : 'text-left'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.segment} style={{ borderTop: '1px solid var(--color-border-primary)' }}>
                <td className="px-2 py-1.5 text-text-primary">{s.segment}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-text-primary">{fmtN(s.members)}</td>
                <td className="px-2 py-1.5 text-right"><Delta k="members" d={{ members: s.members_delta } as any} neutral /></td>
                <td className="px-2 py-1.5 text-right tabular-nums text-text-secondary">{fmtP(s.ratio, 1)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-text-secondary">{s.median_days_no_visit === null ? '-' : `${fmtN(s.median_days_no_visit)}일`}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-text-secondary">{s.median_days_no_purchase === null ? '-' : `${fmtN(s.median_days_no_purchase)}일`}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-text-secondary">{fmtWon(s.avg_order_value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function CostHistory({ r }: { r: DatarizeReport }) {
  if (!r.cost_history.length) return null;
  const data = r.cost_history.map((m) => ({ label: `${m.month.slice(2, 4)}.${m.month.slice(5, 7)}`, ...m.channels }));
  return (
    <Section title="채널별 발송비 — 최근 12개월" sub="데이터라이즈 충전금 차감 내역 기준(충전은 제외) · 메시지 성과 칸보다 오래 보관돼 긴 흐름을 볼 수 있습니다">
      <div style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
            <XAxis dataKey="label" tick={tick} />
            <YAxis tick={tick} tickFormatter={axisMan} width={44} />
            <ReTooltip contentStyle={tooltipStyle} formatter={(v: any, n: any) => [fmtMan(v), n]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {r.channels.map((c, i) => <Bar key={c} dataKey={c} stackId="a" fill={chColor(c, i)} />)}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {r.month_info.in_progress && (
        <p className="text-[10px] text-text-quaternary mt-1 flex items-center gap-1"><AlertTriangle size={10} /> 이번 달은 진행 중입니다.</p>
      )}
    </Section>
  );
}
