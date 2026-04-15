'use client';

import { useState } from 'react';
import {
  Users, Link2, Share2, TrendingUp, DollarSign, Award, Plus, Search,
  Eye, Copy, CheckCircle, Clock, X, BarChart2, Gift, UserPlus, ExternalLink,
  Percent, ShoppingBag, Megaphone, Settings, Filter, Download
} from 'lucide-react';
import toast from 'react-hot-toast';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Campaign {
  id: string;
  name: string;
  product: string;
  commission_type: 'percentage' | 'fixed';
  commission_rate: number;
  status: 'active' | 'paused' | 'ended';
  start_date: string;
  end_date?: string;
  total_sales: number;
  total_commission: number;
  partner_count: number;
  click_count: number;
  conversion_count: number;
  conversion_rate: number;
}

interface Partner {
  id: string;
  name: string;
  email: string;
  channel: string;
  followers: number;
  status: 'pending' | 'approved' | 'rejected';
  total_sales: number;
  total_commission: number;
  unpaid_commission: number;
  referral_link: string;
  click_count: number;
  conversion_count: number;
  joined_date: string;
}

interface ReferralProgram {
  id: string;
  name: string;
  reward_type: 'points' | 'coupon' | 'cash';
  referrer_reward: number;
  referee_reward: number;
  status: 'active' | 'paused';
  total_referrals: number;
  total_signups: number;
  conversion_rate: number;
}

type SectionKey = 'dashboard' | 'campaigns' | 'partners' | 'referral' | 'settlement' | 'settings';

// ─── Demo data ────────────────────────────────────────────────────────────────

const DEMO_CAMPAIGNS: Campaign[] = [
  {
    id: '1',
    name: '봄 신상 런칭 캠페인',
    product: '두바이 쫀득쿠키 세트',
    commission_type: 'percentage',
    commission_rate: 10,
    status: 'active',
    start_date: '2026-04-01',
    end_date: '2026-04-30',
    total_sales: 2500000,
    total_commission: 250000,
    partner_count: 12,
    click_count: 3400,
    conversion_count: 85,
    conversion_rate: 2.5,
  },
  {
    id: '2',
    name: '인플루언서 협업',
    product: '저당 디저트 기프트박스',
    commission_type: 'fixed',
    commission_rate: 5000,
    status: 'active',
    start_date: '2026-03-15',
    total_sales: 1800000,
    total_commission: 180000,
    partner_count: 8,
    click_count: 2100,
    conversion_count: 62,
    conversion_rate: 2.95,
  },
];

const DEMO_PARTNERS: Partner[] = [
  {
    id: '1',
    name: '달콤리뷰',
    email: 'sweet@review.com',
    channel: 'instagram',
    followers: 45000,
    status: 'approved',
    total_sales: 850000,
    total_commission: 85000,
    unpaid_commission: 35000,
    referral_link: 'https://nuldam.com/?ref=dalcom',
    click_count: 1200,
    conversion_count: 32,
    joined_date: '2026-03-01',
  },
  {
    id: '2',
    name: '맛있는일상',
    email: 'tasty@daily.com',
    channel: 'youtube',
    followers: 120000,
    status: 'approved',
    total_sales: 1200000,
    total_commission: 120000,
    unpaid_commission: 70000,
    referral_link: 'https://nuldam.com/?ref=tasty',
    click_count: 2800,
    conversion_count: 48,
    joined_date: '2026-02-15',
  },
  {
    id: '3',
    name: '디저트매니아',
    email: 'dessert@mania.com',
    channel: 'blog',
    followers: 8000,
    status: 'pending',
    total_sales: 0,
    total_commission: 0,
    unpaid_commission: 0,
    referral_link: '',
    click_count: 0,
    conversion_count: 0,
    joined_date: '2026-04-10',
  },
];

const DEMO_REFERRAL_PROGRAMS: ReferralProgram[] = [
  {
    id: '1',
    name: '친구 추천 프로그램',
    reward_type: 'points',
    referrer_reward: 3000,
    referee_reward: 2000,
    status: 'active',
    total_referrals: 156,
    total_signups: 89,
    conversion_rate: 57.1,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: Campaign['status']) {
  if (status === 'active') return 'bg-emerald-500/20 text-emerald-400';
  if (status === 'paused') return 'bg-yellow-500/20 text-yellow-400';
  return 'bg-gray-500/20 text-gray-400';
}

function statusLabel(status: Campaign['status']) {
  if (status === 'active') return '활성';
  if (status === 'paused') return '일시정지';
  return '종료';
}

function partnerStatusBadge(status: Partner['status']) {
  if (status === 'approved') return 'bg-emerald-500/20 text-emerald-400';
  if (status === 'pending') return 'bg-yellow-500/20 text-yellow-400';
  return 'bg-red-500/20 text-red-400';
}

function partnerStatusLabel(status: Partner['status']) {
  if (status === 'approved') return '승인';
  if (status === 'pending') return '대기';
  return '거절';
}

// ─── Sub-sections ─────────────────────────────────────────────────────────────

interface DashboardProps {
  campaigns: Campaign[];
  partners: Partner[];
}

function Dashboard({ campaigns, partners }: DashboardProps) {
  const totalSales = campaigns.reduce((s, c) => s + c.total_sales, 0);
  const totalCommission = campaigns.reduce((s, c) => s + c.total_commission, 0);
  const totalPartners = partners.filter(p => p.status === 'approved').length;
  const totalClicks = campaigns.reduce((s, c) => s + c.click_count, 0);
  const totalConversions = campaigns.reduce((s, c) => s + c.conversion_count, 0);
  const avgConversionRate = totalClicks > 0 ? (totalConversions / totalClicks) * 100 : 0;

  const kpis = [
    { label: '총 매출', value: `₩${(totalSales / 10000).toFixed(0)}만`, icon: <ShoppingBag size={16} />, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { label: '총 커미션', value: `₩${(totalCommission / 10000).toFixed(0)}만`, icon: <DollarSign size={16} />, color: 'text-green-400', bg: 'bg-green-500/10' },
    { label: '활성 파트너', value: `${totalPartners}명`, icon: <Users size={16} />, color: 'text-purple-400', bg: 'bg-purple-500/10' },
    { label: '총 클릭', value: totalClicks.toLocaleString(), icon: <Eye size={16} />, color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
    { label: '전환', value: totalConversions.toLocaleString(), icon: <CheckCircle size={16} />, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { label: '전환율', value: `${avgConversionRate.toFixed(1)}%`, icon: <Percent size={16} />, color: 'text-orange-400', bg: 'bg-orange-500/10' },
  ];

  const approvedPartners = partners
    .filter(p => p.status === 'approved')
    .sort((a, b) => b.total_sales - a.total_sales);

  const rankColors = [
    'bg-yellow-500/20 text-yellow-400',
    'bg-gray-300/20 text-gray-300',
    'bg-orange-500/20 text-orange-400',
  ];

  return (
    <div className="space-y-6">
      {/* KPI 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map((kpi, idx) => (
          <div key={idx} className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35]">
            <div className={`w-8 h-8 rounded-lg ${kpi.bg} flex items-center justify-center ${kpi.color} mb-2`}>
              {kpi.icon}
            </div>
            <p className="text-[10px] text-gray-500">{kpi.label}</p>
            <p className="text-lg font-bold text-white">{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* 활성 캠페인 요약 */}
        <div className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35]">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Megaphone size={14} className="text-emerald-400" /> 활성 캠페인
          </h3>
          <div className="space-y-3">
            {campaigns.filter(c => c.status === 'active').map(c => (
              <div key={c.id} className="p-3 bg-[#141516] rounded-lg">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="text-sm font-medium text-white">{c.name}</p>
                    <p className="text-[10px] text-gray-500">{c.product}</p>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded">활성</span>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div><p className="text-[10px] text-gray-500">파트너</p><p className="text-xs font-medium text-white">{c.partner_count}</p></div>
                  <div><p className="text-[10px] text-gray-500">클릭</p><p className="text-xs font-medium text-white">{c.click_count.toLocaleString()}</p></div>
                  <div><p className="text-[10px] text-gray-500">전환</p><p className="text-xs font-medium text-white">{c.conversion_count}</p></div>
                  <div><p className="text-[10px] text-gray-500">매출</p><p className="text-xs font-medium text-white">₩{(c.total_sales / 10000).toFixed(0)}만</p></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 상위 파트너 */}
        <div className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35]">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Award size={14} className="text-yellow-400" /> Top 파트너
          </h3>
          <div className="space-y-2">
            {approvedPartners.map((p, idx) => (
              <div key={p.id} className="flex items-center gap-3 p-2 bg-[#141516] rounded-lg">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${rankColors[idx] ?? 'bg-gray-500/20 text-gray-400'}`}>
                  {idx + 1}
                </span>
                <div className="flex-1">
                  <p className="text-sm text-white font-medium">{p.name}</p>
                  <p className="text-[10px] text-gray-500">{p.channel} · {p.followers.toLocaleString()} followers</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-emerald-400">₩{p.total_sales.toLocaleString()}</p>
                  <p className="text-[10px] text-gray-500">{p.conversion_count}건 전환</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Campaigns section ────────────────────────────────────────────────────────

interface NewCampaignForm {
  name: string;
  product: string;
  commission_type: 'percentage' | 'fixed';
  commission_rate: number;
  start_date: string;
  end_date: string;
}

function CampaignsSection({ campaigns }: { campaigns: Campaign[] }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<NewCampaignForm>({
    name: '',
    product: '',
    commission_type: 'percentage',
    commission_rate: 10,
    start_date: '',
    end_date: '',
  });

  const handleCreate = () => {
    toast.success('캠페인이 생성되었습니다');
    setShowForm(false);
    setForm({ name: '', product: '', commission_type: 'percentage', commission_rate: 10, start_date: '', end_date: '' });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold text-white">어필리에이트 캠페인</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg transition-colors"
        >
          <Plus size={14} /> 새 캠페인
        </button>
      </div>

      {showForm && (
        <div className="bg-[#1a1b1e] rounded-xl p-4 border border-emerald-500/30 space-y-3">
          <h3 className="text-sm font-semibold text-white">새 캠페인 만들기</h3>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400">캠페인명</label>
              <input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="예: 여름 신상 프로모션"
                className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">대상 상품</label>
              <input
                value={form.product}
                onChange={e => setForm({ ...form, product: e.target.value })}
                placeholder="예: 저당 디저트 세트"
                className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">커미션 유형</label>
              <select
                value={form.commission_type}
                onChange={e => setForm({ ...form, commission_type: e.target.value as 'percentage' | 'fixed' })}
                className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50"
              >
                <option value="percentage">매출 비율 (%)</option>
                <option value="fixed">건당 고정 금액 (₩)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400">
                {form.commission_type === 'percentage' ? '커미션 비율 (%)' : '건당 금액 (₩)'}
              </label>
              <input
                type="number"
                value={form.commission_rate}
                onChange={e => setForm({ ...form, commission_rate: Number(e.target.value) })}
                className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">시작일</label>
              <input
                type="date"
                value={form.start_date}
                onChange={e => setForm({ ...form, start_date: e.target.value })}
                className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">종료일 (선택)</label>
              <input
                type="date"
                value={form.end_date}
                onChange={e => setForm({ ...form, end_date: e.target.value })}
                className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowForm(false)}
              className="px-3 py-1.5 text-xs text-gray-400 border border-[#2a2d35] rounded-lg hover:text-white hover:border-gray-500 transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleCreate}
              className="px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors"
            >
              캠페인 생성
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {campaigns.map(c => (
          <div key={c.id} className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35]">
            <div className="flex justify-between items-start mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-white">{c.name}</h3>
                  <span className={`text-[10px] px-2 py-0.5 rounded ${statusBadge(c.status)}`}>
                    {statusLabel(c.status)}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  {c.product} · {c.commission_type === 'percentage' ? `${c.commission_rate}%` : `₩${c.commission_rate.toLocaleString()}/건`}
                </p>
              </div>
              <p className="text-xs text-gray-500">{c.start_date} ~ {c.end_date ?? '진행중'}</p>
            </div>
            <div className="grid grid-cols-5 gap-3 text-center bg-[#141516] rounded-lg p-3">
              <div><p className="text-[10px] text-gray-500">파트너</p><p className="text-sm font-bold text-white">{c.partner_count}명</p></div>
              <div><p className="text-[10px] text-gray-500">클릭</p><p className="text-sm font-bold text-white">{c.click_count.toLocaleString()}</p></div>
              <div><p className="text-[10px] text-gray-500">전환</p><p className="text-sm font-bold text-cyan-400">{c.conversion_count}건</p></div>
              <div><p className="text-[10px] text-gray-500">매출</p><p className="text-sm font-bold text-emerald-400">₩{c.total_sales.toLocaleString()}</p></div>
              <div><p className="text-[10px] text-gray-500">커미션</p><p className="text-sm font-bold text-yellow-400">₩{c.total_commission.toLocaleString()}</p></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Partners section ─────────────────────────────────────────────────────────

function PartnersSection({ partners }: { partners: Partner[] }) {
  const copyLink = (link: string) => {
    navigator.clipboard.writeText(link);
    toast.success('링크가 복사되었습니다');
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold text-white">파트너 관리</h2>
        <button
          onClick={() => toast.success('파트너 초대 링크가 복사되었습니다')}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg transition-colors"
        >
          <UserPlus size={14} /> 파트너 초대
        </button>
      </div>

      <div className="space-y-3">
        {partners.map(p => (
          <div key={p.id} className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35]">
            <div className="flex justify-between items-start mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center text-white font-bold text-sm">
                  {p.name[0]}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-white">{p.name}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${partnerStatusBadge(p.status)}`}>
                      {partnerStatusLabel(p.status)}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-500">{p.channel} · {p.followers.toLocaleString()} followers · {p.email}</p>
                </div>
              </div>
              {p.status === 'pending' && (
                <div className="flex gap-1">
                  <button
                    onClick={() => toast.success(`${p.name} 파트너를 승인했습니다`)}
                    className="px-2 py-1 text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded transition-colors"
                  >
                    승인
                  </button>
                  <button
                    onClick={() => toast.error(`${p.name} 파트너 신청을 거절했습니다`)}
                    className="px-2 py-1 text-[10px] border border-red-400/30 text-red-400 hover:bg-red-400/10 rounded transition-colors"
                  >
                    거절
                  </button>
                </div>
              )}
            </div>

            {p.status === 'approved' && (
              <>
                <div className="grid grid-cols-5 gap-3 text-center bg-[#141516] rounded-lg p-3 mb-2">
                  <div><p className="text-[10px] text-gray-500">클릭</p><p className="text-sm font-bold text-white">{p.click_count.toLocaleString()}</p></div>
                  <div><p className="text-[10px] text-gray-500">전환</p><p className="text-sm font-bold text-cyan-400">{p.conversion_count}건</p></div>
                  <div><p className="text-[10px] text-gray-500">매출</p><p className="text-sm font-bold text-emerald-400">₩{p.total_sales.toLocaleString()}</p></div>
                  <div><p className="text-[10px] text-gray-500">총 커미션</p><p className="text-sm font-bold text-yellow-400">₩{p.total_commission.toLocaleString()}</p></div>
                  <div><p className="text-[10px] text-gray-500">미정산</p><p className="text-sm font-bold text-red-400">₩{p.unpaid_commission.toLocaleString()}</p></div>
                </div>
                <div className="flex items-center gap-2 bg-[#141516] rounded-lg px-3 py-2">
                  <Link2 size={12} className="text-gray-500 shrink-0" />
                  <code className="text-[10px] text-gray-400 flex-1 truncate">{p.referral_link}</code>
                  <button onClick={() => copyLink(p.referral_link)} className="text-gray-400 hover:text-white transition-colors">
                    <Copy size={12} />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Referral section ─────────────────────────────────────────────────────────

function ReferralSection({ programs }: { programs: ReferralProgram[] }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold text-white">친구추천 프로그램</h2>
        <button
          onClick={() => toast.success('프로그램 추가 기능은 준비 중입니다')}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg transition-colors"
        >
          <Plus size={14} /> 프로그램 추가
        </button>
      </div>

      {programs.map(prog => (
        <div key={prog.id} className="bg-[#1a1b1e] rounded-xl p-5 border border-[#2a2d35]">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h3 className="text-sm font-semibold text-white">{prog.name}</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                보상: {prog.reward_type === 'points' ? '포인트' : prog.reward_type === 'coupon' ? '쿠폰' : '현금'}
              </p>
            </div>
            <span className={`text-xs px-2 py-1 rounded ${prog.status === 'active' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-gray-400'}`}>
              {prog.status === 'active' ? '운영중' : '일시정지'}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="bg-[#141516] rounded-lg p-3 text-center">
              <p className="text-[10px] text-gray-500">추천인 보상</p>
              <p className="text-lg font-bold text-emerald-400">{prog.referrer_reward.toLocaleString()}P</p>
            </div>
            <div className="bg-[#141516] rounded-lg p-3 text-center">
              <p className="text-[10px] text-gray-500">피추천인 보상</p>
              <p className="text-lg font-bold text-cyan-400">{prog.referee_reward.toLocaleString()}P</p>
            </div>
            <div className="bg-[#141516] rounded-lg p-3 text-center">
              <p className="text-[10px] text-gray-500">총 추천</p>
              <p className="text-lg font-bold text-white">{prog.total_referrals}</p>
            </div>
            <div className="bg-[#141516] rounded-lg p-3 text-center">
              <p className="text-[10px] text-gray-500">가입 전환율</p>
              <p className="text-lg font-bold text-yellow-400">{prog.conversion_rate}%</p>
            </div>
          </div>

          {/* 전환 퍼널 */}
          <div className="space-y-2">
            <p className="text-xs text-gray-400">전환 퍼널</p>
            {[
              { label: '추천 링크 공유', value: prog.total_referrals, color: '#93c5fd' },
              { label: '링크 클릭', value: Math.round(prog.total_referrals * 0.8), color: '#60a5fa' },
              { label: '가입 완료', value: prog.total_signups, color: '#34d399' },
            ].map((step, idx) => (
              <div key={idx} className="flex items-center gap-3">
                <span className="text-[10px] text-gray-500 w-20 shrink-0">{step.label}</span>
                <div className="flex-1 h-6 bg-[#141516] rounded overflow-hidden relative">
                  <div
                    className="h-full rounded"
                    style={{ width: `${(step.value / prog.total_referrals) * 100}%`, backgroundColor: step.color }}
                  />
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-white">
                    {step.value}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Settlement section ───────────────────────────────────────────────────────

function SettlementSection({ partners, totalCommission }: { partners: Partner[]; totalCommission: number }) {
  const totalUnpaid = partners.reduce((s, p) => s + p.unpaid_commission, 0);
  const approvedPartners = partners.filter(p => p.status === 'approved');

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-white">정산 관리</h2>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35] text-center">
          <p className="text-xs text-gray-500">총 미정산 금액</p>
          <p className="text-2xl font-bold text-red-400 mt-1">₩{totalUnpaid.toLocaleString()}</p>
        </div>
        <div className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35] text-center">
          <p className="text-xs text-gray-500">이번 달 정산 예정</p>
          <p className="text-2xl font-bold text-yellow-400 mt-1">₩105,000</p>
        </div>
        <div className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35] text-center">
          <p className="text-xs text-gray-500">누적 정산 완료</p>
          <p className="text-2xl font-bold text-emerald-400 mt-1">₩{totalCommission.toLocaleString()}</p>
        </div>
      </div>

      <div className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35]">
        <h3 className="text-sm font-semibold text-white mb-3">파트너별 정산 현황</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-[#2a2d35]">
                <th className="text-left py-2 px-2">파트너</th>
                <th className="text-right py-2 px-2">총 매출</th>
                <th className="text-right py-2 px-2">총 커미션</th>
                <th className="text-right py-2 px-2">미정산</th>
                <th className="text-center py-2 px-2">상태</th>
                <th className="text-center py-2 px-2">액션</th>
              </tr>
            </thead>
            <tbody>
              {approvedPartners.map(p => (
                <tr key={p.id} className="border-b border-[#2a2d35]/50 text-gray-300">
                  <td className="py-2.5 px-2 font-medium text-white">{p.name}</td>
                  <td className="py-2.5 px-2 text-right">₩{p.total_sales.toLocaleString()}</td>
                  <td className="py-2.5 px-2 text-right">₩{p.total_commission.toLocaleString()}</td>
                  <td className="py-2.5 px-2 text-right text-red-400">₩{p.unpaid_commission.toLocaleString()}</td>
                  <td className="py-2.5 px-2 text-center">
                    <span className="text-[10px] px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded">미정산</span>
                  </td>
                  <td className="py-2.5 px-2 text-center">
                    <button
                      onClick={() => toast.success(`${p.name} 정산이 처리되었습니다`)}
                      className="px-2 py-0.5 text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white rounded transition-colors"
                    >
                      정산하기
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Settings section ─────────────────────────────────────────────────────────

function SettingsSection() {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-white">어필리에이트 설정</h2>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35] space-y-3">
          <h3 className="text-sm font-semibold text-white">기본 설정</h3>
          <div>
            <label className="text-xs text-gray-400">기본 커미션 비율 (%)</label>
            <input type="number" defaultValue={10} className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50" />
          </div>
          <div>
            <label className="text-xs text-gray-400">쿠키 유효기간 (일)</label>
            <input type="number" defaultValue={30} className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50" />
          </div>
          <div>
            <label className="text-xs text-gray-400">최소 정산 금액 (₩)</label>
            <input type="number" defaultValue={50000} className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50" />
          </div>
          <div>
            <label className="text-xs text-gray-400">정산 주기</label>
            <select defaultValue="monthly" className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50">
              <option value="weekly">주간</option>
              <option value="biweekly">격주</option>
              <option value="monthly">월간</option>
            </select>
          </div>
          <button
            onClick={() => toast.success('설정이 저장되었습니다')}
            className="w-full py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors"
          >
            설정 저장
          </button>
        </div>

        <div className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35] space-y-3">
          <h3 className="text-sm font-semibold text-white">알림 설정</h3>
          {[
            { label: '새 파트너 신청 알림', defaultChecked: true },
            { label: '전환 발생 알림', defaultChecked: true },
            { label: '정산 예정일 알림', defaultChecked: true },
            { label: '일일 리포트 이메일', defaultChecked: false },
          ].map(item => (
            <label key={item.label} className="flex items-center justify-between cursor-pointer">
              <span className="text-xs text-gray-400">{item.label}</span>
              <input type="checkbox" defaultChecked={item.defaultChecked} className="w-4 h-4 rounded accent-emerald-500" />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const NAV_ITEMS: { key: SectionKey; label: string; icon: React.ReactNode }[] = [
  { key: 'dashboard', label: '대시보드', icon: <BarChart2 size={14} /> },
  { key: 'campaigns', label: '캠페인 관리', icon: <Megaphone size={14} /> },
  { key: 'partners', label: '파트너 관리', icon: <Users size={14} /> },
  { key: 'referral', label: '친구추천', icon: <Gift size={14} /> },
  { key: 'settlement', label: '정산 관리', icon: <DollarSign size={14} /> },
  { key: 'settings', label: '설정', icon: <Settings size={14} /> },
];

export function AffiliateManaging() {
  const [activeSection, setActiveSection] = useState<SectionKey>('dashboard');

  const campaigns = DEMO_CAMPAIGNS;
  const partners = DEMO_PARTNERS;
  const referralPrograms = DEMO_REFERRAL_PROGRAMS;

  const totalCommission = campaigns.reduce((s, c) => s + c.total_commission, 0);

  return (
    <div className="space-y-6">
      {/* 상단 네비게이션 */}
      <div className="flex items-center gap-1 bg-[#1a1b1e] rounded-xl p-1 overflow-x-auto">
        {NAV_ITEMS.map(item => (
          <button
            key={item.key}
            onClick={() => setActiveSection(item.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
              activeSection === item.key
                ? 'bg-emerald-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            {item.icon} {item.label}
          </button>
        ))}
      </div>

      {activeSection === 'dashboard' && <Dashboard campaigns={campaigns} partners={partners} />}
      {activeSection === 'campaigns' && <CampaignsSection campaigns={campaigns} />}
      {activeSection === 'partners' && <PartnersSection partners={partners} />}
      {activeSection === 'referral' && <ReferralSection programs={referralPrograms} />}
      {activeSection === 'settlement' && <SettlementSection partners={partners} totalCommission={totalCommission} />}
      {activeSection === 'settings' && <SettingsSection />}
    </div>
  );
}
