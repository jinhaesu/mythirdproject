'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ShoppingBag,
  Eye,
  CheckCircle,
  Percent,
  DollarSign,
  BarChart2,
  Coins,
  Clock,
  Copy,
  LogOut,
  Link2,
  Loader2,
  Mail,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { partnerAuthApi, partnerDashboardApi } from '@/lib/partner-api';
import type { PartnerInfo, PartnerDashboard, PartnerCampaign } from '@/lib/partner-api';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtKRW(amount: number): string {
  return `₩${Math.round(amount).toLocaleString('ko-KR')}`;
}

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('ko-KR');
}

// ─── Login Page ───────────────────────────────────────────────────────────────

function LoginView({ onTokenVerified }: { onTokenVerified: (partner: PartnerInfo, token: string) => void }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      toast.error('이메일을 입력하세요');
      return;
    }
    setLoading(true);
    try {
      await partnerAuthApi.sendMagicLink(trimmed);
      setSent(true);
      toast.success('등록된 이메일로 로그인 링크를 보냈습니다.');
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        '로그인 링크 요청 실패';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#08090A] p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-emerald-600 rounded-xl flex items-center justify-center shadow-[0px_4px_24px_rgba(0,0,0,0.4)]">
              <span className="text-white font-bold text-xl">N</span>
            </div>
            <h1 className="text-3xl font-semibold text-[#F7F8F8] tracking-tight">널담</h1>
          </div>
          <p className="text-[#8A8F98] text-sm">어필리에이트 파트너 전용</p>
        </div>

        <div className="bg-[#0F1011] border border-[#23252A] rounded-2xl p-6 shadow-[0px_7px_32px_rgba(0,0,0,0.35)]">
          {!sent ? (
            <form onSubmit={handleSend} className="space-y-4">
              <div className="text-center mb-2">
                <h2 className="text-base font-semibold text-[#F7F8F8]">널담 어필리에이트 파트너 로그인</h2>
                <p className="text-sm text-[#8A8F98] mt-1">로그인 링크를 이메일로 보내드립니다</p>
              </div>

              <div>
                <label className="block text-xs text-[#8A8F98] mb-1.5">이메일</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="partner@example.com"
                  required
                  className="w-full px-3 py-2.5 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white placeholder:text-[#4a4d55] focus:outline-none focus:border-emerald-500/60 transition-colors"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {loading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Mail size={16} />
                )}
                로그인 링크 받기
              </button>
            </form>
          ) : (
            <div className="text-center py-4">
              <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/30 rounded-full flex items-center justify-center mx-auto mb-4">
                <Mail size={28} className="text-emerald-400" />
              </div>
              <h2 className="text-base font-semibold text-[#F7F8F8] mb-2">이메일을 확인하세요</h2>
              <p className="text-sm text-[#8A8F98] mb-1">
                <span className="font-medium text-[#D0D6E0]">{email}</span>
              </p>
              <p className="text-sm text-[#8A8F98] mb-6">로 로그인 링크를 보냈습니다</p>
              <button
                className="text-sm text-emerald-400 hover:text-emerald-300 font-medium transition-colors"
                onClick={() => { setSent(false); setEmail(''); }}
              >
                다른 이메일로 시도
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

interface KpiCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: 'default' | 'yellow' | 'red';
}

function KpiCard({ icon, label, value, sub, accent = 'default' }: KpiCardProps) {
  const accentColor =
    accent === 'yellow'
      ? 'text-yellow-400'
      : accent === 'red'
      ? 'text-red-400'
      : 'text-emerald-400';

  return (
    <div className="bg-[#1E1F22] border border-white/10 rounded-xl p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[#8A8F98]">
        <span className={accentColor}>{icon}</span>
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className={`text-xl font-bold ${accentColor}`}>{value}</p>
      {sub && <p className="text-[11px] text-[#8A8F98]">{sub}</p>}
    </div>
  );
}

// ─── Campaign Card ────────────────────────────────────────────────────────────

function CampaignCard({ campaign }: { campaign: PartnerCampaign }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(campaign.referral_link);
      setCopied(true);
      toast.success('링크가 복사되었습니다');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('복사에 실패했습니다');
    }
  };

  const commissionLabel =
    campaign.commission_type === 'percentage'
      ? `${campaign.commission_rate}%`
      : fmtKRW(campaign.commission_rate);

  return (
    <div className="bg-[#1E1F22] border border-white/10 rounded-xl p-4 space-y-3">
      {/* 상품 정보 */}
      <div className="flex items-start gap-3">
        {campaign.product_image ? (
          <img
            src={campaign.product_image}
            alt={campaign.product_name}
            className="w-12 h-12 rounded-lg object-cover bg-[#141516] shrink-0"
          />
        ) : (
          <div className="w-12 h-12 rounded-lg bg-[#141516] border border-white/10 flex items-center justify-center shrink-0">
            <ShoppingBag size={18} className="text-[#8A8F98]" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">{campaign.product_name}</p>
          <p className="text-xs text-[#8A8F98] truncate">{campaign.campaign_name}</p>
          <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 bg-emerald-500/15 text-emerald-400 text-[11px] rounded-full border border-emerald-500/20">
            <Coins size={10} />
            커미션 {commissionLabel}
          </span>
        </div>
      </div>

      {/* 전용 링크 */}
      <div className="flex items-center gap-2 bg-[#141516] border border-white/10 rounded-lg px-3 py-2">
        <Link2 size={12} className="text-[#8A8F98] shrink-0" />
        <input
          readOnly
          value={campaign.referral_link}
          className="flex-1 bg-transparent text-[11px] text-[#8A8F98] outline-none truncate"
        />
        <button
          onClick={handleCopy}
          className="shrink-0 text-[#8A8F98] hover:text-emerald-400 transition-colors"
          aria-label="링크 복사"
        >
          <Copy size={13} className={copied ? 'text-emerald-400' : ''} />
        </button>
      </div>

      {/* 성과 미니 바 */}
      <div className="grid grid-cols-4 gap-2 text-center">
        <div className="bg-[#141516] rounded-lg p-2">
          <p className="text-[10px] text-[#8A8F98]">클릭</p>
          <p className="text-sm font-bold text-white">{fmtNum(campaign.clicks)}</p>
        </div>
        <div className="bg-[#141516] rounded-lg p-2">
          <p className="text-[10px] text-[#8A8F98]">전환</p>
          <p className="text-sm font-bold text-cyan-400">{fmtNum(campaign.conversions)}</p>
        </div>
        <div className="bg-[#141516] rounded-lg p-2">
          <p className="text-[10px] text-[#8A8F98]">매출</p>
          <p className="text-sm font-bold text-emerald-400">{fmtKRW(campaign.sales)}</p>
        </div>
        <div className="bg-[#141516] rounded-lg p-2">
          <p className="text-[10px] text-[#8A8F98]">커미션</p>
          <p className="text-sm font-bold text-yellow-400">{fmtKRW(campaign.commission)}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard View ───────────────────────────────────────────────────────────

function DashboardView({ partner, onLogout }: { partner: PartnerInfo; onLogout: () => void }) {
  const [dashboard, setDashboard] = useState<PartnerDashboard | null>(null);
  const [campaigns, setCampaigns] = useState<PartnerCampaign[]>([]);
  const [loadingDash, setLoadingDash] = useState(true);
  const [loadingCamp, setLoadingCamp] = useState(true);
  const [dashError, setDashError] = useState(false);

  useEffect(() => {
    partnerDashboardApi
      .getDashboard()
      .then(setDashboard)
      .catch(() => setDashError(true))
      .finally(() => setLoadingDash(false));

    partnerDashboardApi
      .getCampaigns()
      .then(setCampaigns)
      .catch(() => {})
      .finally(() => setLoadingCamp(false));
  }, []);

  const kpiItems: KpiCardProps[] = dashboard
    ? [
        {
          icon: <ShoppingBag size={16} />,
          label: '총 판매 제품 수',
          value: `${fmtNum(dashboard.total_products)}개`,
          accent: 'default',
        },
        {
          icon: <Eye size={16} />,
          label: '총 클릭',
          value: fmtNum(dashboard.total_clicks),
          accent: 'default',
        },
        {
          icon: <CheckCircle size={16} />,
          label: '총 전환 건수',
          value: `${fmtNum(dashboard.total_conversions)}건`,
          accent: 'default',
        },
        {
          icon: <Percent size={16} />,
          label: '전환율',
          value: `${dashboard.conversion_rate.toFixed(1)}%`,
          accent: 'default',
        },
        {
          icon: <DollarSign size={16} />,
          label: '총 결제 금액',
          value: fmtKRW(dashboard.total_sales),
          accent: 'default',
        },
        {
          icon: <BarChart2 size={16} />,
          label: '객단가',
          value: fmtKRW(dashboard.avg_order_value),
          accent: 'default',
        },
        {
          icon: <Coins size={16} />,
          label: '총 예상 정산액',
          value: fmtKRW(dashboard.total_commission),
          sub: `정산 완료: ${fmtKRW(dashboard.paid_commission)}`,
          accent: 'default',
        },
        {
          icon: <Clock size={16} />,
          label: '미정산 커미션',
          value: fmtKRW(dashboard.unpaid_commission),
          sub: dashboard.unpaid_commission > 0 ? '정산 대기 중' : '미정산 없음',
          accent: dashboard.unpaid_commission > 100000 ? 'red' : dashboard.unpaid_commission > 0 ? 'yellow' : 'default',
        },
      ]
    : [];

  return (
    <div className="min-h-screen bg-[#08090A]">
      {/* 헤더 */}
      <header className="border-b border-white/10 bg-[#0F1011]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-emerald-600 rounded-lg flex items-center justify-center shrink-0">
              <span className="text-white font-bold text-base">N</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{partner.name}</p>
              <p className="text-[11px] text-[#8A8F98]">어필리에이트 파트너</p>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#8A8F98] border border-white/10 rounded-lg hover:text-white hover:border-white/20 transition-colors"
          >
            <LogOut size={13} />
            로그아웃
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-8">
        {/* KPI 카드 */}
        <section>
          <h2 className="text-sm font-semibold text-[#8A8F98] uppercase tracking-wider mb-4">
            성과 요약
          </h2>
          {loadingDash ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="text-emerald-400 animate-spin" />
            </div>
          ) : dashError ? (
            <div className="text-sm text-red-400 text-center py-8">
              대시보드 데이터를 불러오지 못했습니다
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {kpiItems.map((item, i) => (
                <KpiCard key={i} {...item} />
              ))}
            </div>
          )}
        </section>

        {/* 캠페인 & 링크 */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-sm font-semibold text-[#8A8F98] uppercase tracking-wider">
              내 캠페인 &amp; 링크
            </h2>
            {!loadingCamp && (
              <span className="px-2 py-0.5 bg-emerald-500/15 text-emerald-400 text-[11px] rounded-full border border-emerald-500/20">
                {campaigns.length}개
              </span>
            )}
          </div>

          {loadingCamp ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="text-emerald-400 animate-spin" />
            </div>
          ) : campaigns.length === 0 ? (
            <div className="bg-[#1E1F22] border border-white/10 rounded-xl flex flex-col items-center justify-center py-12 gap-2">
              <ShoppingBag size={28} className="text-[#4a4d55]" />
              <p className="text-sm text-[#8A8F98]">아직 참여 중인 캠페인이 없습니다</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {campaigns.map((c) => (
                <CampaignCard key={c.campaign_id} campaign={c} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

// ─── Verifying Spinner ────────────────────────────────────────────────────────

function VerifyingView() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#08090A]">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-[#8A8F98] text-lg">로그인 확인 중...</p>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PartnerPage() {
  const [partner, setPartner] = useState<PartnerInfo | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const logout = useCallback(() => {
    localStorage.removeItem('partner_token');
    setPartner(null);
    window.history.replaceState({}, '', '/partner');
  }, []);

  // URL ?token= 처리 또는 기존 localStorage 토큰 복원
  useEffect(() => {
    const init = async () => {
      const params = new URLSearchParams(window.location.search);
      const urlToken = params.get('token');

      if (urlToken) {
        // URL 매직링크 토큰 검증
        setVerifying(true);
        try {
          const res = await partnerAuthApi.verify(urlToken);
          localStorage.setItem('partner_token', res.access_token);
          setPartner(res.partner);
          window.history.replaceState({}, '', '/partner');
          toast.success('로그인 되었습니다');
        } catch {
          toast.error('로그인이 만료되었습니다');
          window.history.replaceState({}, '', '/partner');
        } finally {
          setVerifying(false);
        }
      } else {
        // 기존 토큰으로 복원
        const saved = localStorage.getItem('partner_token');
        if (saved) {
          try {
            const me = await partnerDashboardApi.getMe();
            setPartner(me);
          } catch {
            localStorage.removeItem('partner_token');
          }
        }
      }
      setInitialized(true);
    };

    init();
  }, []);

  if (verifying) return <VerifyingView />;
  if (!initialized) return <VerifyingView />;

  if (!partner) {
    return (
      <LoginView
        onTokenVerified={(p, token) => {
          localStorage.setItem('partner_token', token);
          setPartner(p);
        }}
      />
    );
  }

  return <DashboardView partner={partner} onLogout={logout} />;
}
