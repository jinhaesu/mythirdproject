'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users, Link2, Share2, TrendingUp, DollarSign, Award, Plus, Search,
  Eye, Copy, CheckCircle, Clock, X, BarChart2, Gift, UserPlus, ExternalLink,
  Percent, ShoppingBag, Megaphone, Settings, Filter, Download, Loader2,
  AlertCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { affiliateApi } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AffiliateCampaign {
  id: number;
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

interface AffiliatePartner {
  id: number;
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
  id: number;
  name: string;
  reward_type: 'points' | 'coupon' | 'cash';
  referrer_reward: number;
  referee_reward: number;
  status: 'active' | 'paused';
  total_referrals: number;
  total_signups: number;
  conversion_rate: number;
}

interface Settlement {
  id: number;
  partner_id: number;
  partner_name: string;
  amount: number;
  status: 'pending' | 'paid';
  created_at: string;
  paid_at?: string;
}

interface DashboardData {
  total_sales: number;
  total_commission: number;
  active_partners: number;
  total_clicks: number;
  total_conversions: number;
  conversion_rate: number;
  active_campaigns: AffiliateCampaign[];
  top_partners: AffiliatePartner[];
}

interface NewCampaignForm {
  name: string;
  product: string;
  commission_type: 'percentage' | 'fixed';
  commission_rate: number;
  start_date: string;
  end_date: string;
}

interface NewPartnerForm {
  name: string;
  email: string;
  channel: string;
  followers: number;
}

interface NewReferralProgramForm {
  name: string;
  reward_type: 'points' | 'coupon' | 'cash';
  referrer_reward: number;
  referee_reward: number;
}

interface AffiliateSettingsForm {
  default_commission_rate: number;
  cookie_lifetime_days: number;
  min_payout_amount: number;
  payout_cycle: 'weekly' | 'biweekly' | 'monthly';
  notify_new_partner: boolean;
  notify_conversion: boolean;
  notify_payout: boolean;
  notify_daily_report: boolean;
}

type SectionKey = 'dashboard' | 'campaigns' | 'partners' | 'referral' | 'settlement' | 'settings';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function campaignStatusBadge(status: AffiliateCampaign['status']) {
  if (status === 'active') return 'bg-emerald-500/20 text-emerald-400';
  if (status === 'paused') return 'bg-yellow-500/20 text-yellow-400';
  return 'bg-gray-500/20 text-gray-400';
}

function campaignStatusLabel(status: AffiliateCampaign['status']) {
  if (status === 'active') return '활성';
  if (status === 'paused') return '일시정지';
  return '종료';
}

function partnerStatusBadge(status: AffiliatePartner['status']) {
  if (status === 'approved') return 'bg-emerald-500/20 text-emerald-400';
  if (status === 'pending') return 'bg-yellow-500/20 text-yellow-400';
  return 'bg-red-500/20 text-red-400';
}

function partnerStatusLabel(status: AffiliatePartner['status']) {
  if (status === 'approved') return '승인';
  if (status === 'pending') return '대기';
  return '거절';
}

// ─── Loading spinner ──────────────────────────────────────────────────────────

function SectionLoader() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 size={24} className="text-emerald-400 animate-spin" />
    </div>
  );
}

function SectionError({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-2">
      <AlertCircle size={24} className="text-red-400" />
      <p className="text-sm text-gray-400">{message ?? '데이터를 불러오지 못했습니다'}</p>
    </div>
  );
}

// ─── Dashboard section ────────────────────────────────────────────────────────

function DashboardSection() {
  const { data, isLoading, isError } = useQuery<DashboardData>({
    queryKey: ['affiliate', 'dashboard'],
    queryFn: affiliateApi.getDashboard,
    retry: 1,
  });

  const d = data ?? {
    total_sales: 0,
    total_commission: 0,
    active_partners: 0,
    total_clicks: 0,
    total_conversions: 0,
    conversion_rate: 0,
    active_campaigns: [],
    top_partners: [],
  };

  const kpis = [
    { label: '총 매출', value: d.total_sales > 0 ? `₩${(d.total_sales / 10000).toFixed(0)}만` : '₩0', icon: <ShoppingBag size={16} />, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { label: '총 커미션', value: d.total_commission > 0 ? `₩${(d.total_commission / 10000).toFixed(0)}만` : '₩0', icon: <DollarSign size={16} />, color: 'text-green-400', bg: 'bg-green-500/10' },
    { label: '활성 파트너', value: `${d.active_partners}명`, icon: <Users size={16} />, color: 'text-purple-400', bg: 'bg-purple-500/10' },
    { label: '총 클릭', value: d.total_clicks.toLocaleString(), icon: <Eye size={16} />, color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
    { label: '전환', value: d.total_conversions.toLocaleString(), icon: <CheckCircle size={16} />, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { label: '전환율', value: `${d.conversion_rate.toFixed(1)}%`, icon: <Percent size={16} />, color: 'text-orange-400', bg: 'bg-orange-500/10' },
  ];

  const rankColors = [
    'bg-yellow-500/20 text-yellow-400',
    'bg-gray-300/20 text-gray-300',
    'bg-orange-500/20 text-orange-400',
  ];

  if (isLoading) return <SectionLoader />;

  return (
    <div className="space-y-6">
      {isError && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-lg">
          <AlertCircle size={14} className="text-red-400" />
          <p className="text-xs text-red-400">대시보드 데이터를 불러오지 못했습니다. 기본값으로 표시합니다.</p>
        </div>
      )}

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
          {d.active_campaigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <Megaphone size={20} className="text-gray-600" />
              <p className="text-xs text-gray-500">활성 캠페인이 없습니다</p>
              <p className="text-[10px] text-gray-600">캠페인 관리 탭에서 새 캠페인을 생성하세요</p>
            </div>
          ) : (
            <div className="space-y-3">
              {d.active_campaigns.map(c => (
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
          )}
        </div>

        {/* 상위 파트너 */}
        <div className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35]">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Award size={14} className="text-yellow-400" /> Top 파트너
          </h3>
          {d.top_partners.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <Users size={20} className="text-gray-600" />
              <p className="text-xs text-gray-500">등록된 파트너가 없습니다</p>
              <p className="text-[10px] text-gray-600">파트너 관리 탭에서 파트너를 초대하세요</p>
            </div>
          ) : (
            <div className="space-y-2">
              {d.top_partners.map((p, idx) => (
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
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Campaigns section ────────────────────────────────────────────────────────

function CampaignsSection() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<NewCampaignForm>({
    name: '',
    product: '',
    commission_type: 'percentage',
    commission_rate: 10,
    start_date: '',
    end_date: '',
  });

  const { data: campaigns = [], isLoading, isError } = useQuery<AffiliateCampaign[]>({
    queryKey: ['affiliate', 'campaigns'],
    queryFn: affiliateApi.getCampaigns,
    retry: 1,
  });

  const createMutation = useMutation({
    mutationFn: affiliateApi.createCampaign,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['affiliate', 'campaigns'] });
      qc.invalidateQueries({ queryKey: ['affiliate', 'dashboard'] });
      toast.success('캠페인이 생성되었습니다');
      setShowForm(false);
      setForm({ name: '', product: '', commission_type: 'percentage', commission_rate: 10, start_date: '', end_date: '' });
    },
    onError: () => toast.error('캠페인 생성에 실패했습니다'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => affiliateApi.deleteCampaign(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['affiliate', 'campaigns'] });
      qc.invalidateQueries({ queryKey: ['affiliate', 'dashboard'] });
      toast.success('캠페인이 삭제되었습니다');
    },
    onError: () => toast.error('캠페인 삭제에 실패했습니다'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => affiliateApi.updateCampaign(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['affiliate', 'campaigns'] });
      qc.invalidateQueries({ queryKey: ['affiliate', 'dashboard'] });
      toast.success('캠페인이 업데이트되었습니다');
    },
    onError: () => toast.error('캠페인 업데이트에 실패했습니다'),
  });

  const handleCreate = () => {
    if (!form.name.trim()) { toast.error('캠페인명을 입력하세요'); return; }
    if (!form.start_date) { toast.error('시작일을 입력하세요'); return; }
    createMutation.mutate(form);
  };

  const handleToggleStatus = (c: AffiliateCampaign) => {
    const newStatus = c.status === 'active' ? 'paused' : 'active';
    updateMutation.mutate({ id: c.id, data: { status: newStatus } });
  };

  if (isLoading) return <SectionLoader />;

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

      {isError && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-lg">
          <AlertCircle size={14} className="text-red-400" />
          <p className="text-xs text-red-400">캠페인 목록을 불러오지 못했습니다</p>
        </div>
      )}

      {showForm && (
        <div className="bg-[#1a1b1e] rounded-xl p-4 border border-emerald-500/30 space-y-3">
          <h3 className="text-sm font-semibold text-white">새 캠페인 만들기</h3>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400">캠페인명 *</label>
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
              <label className="text-xs text-gray-400">시작일 *</label>
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
              disabled={createMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
            >
              {createMutation.isPending && <Loader2 size={12} className="animate-spin" />}
              캠페인 생성
            </button>
          </div>
        </div>
      )}

      {campaigns.length === 0 && !isError ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 bg-[#1a1b1e] rounded-xl border border-[#2a2d35]">
          <Megaphone size={28} className="text-gray-600" />
          <p className="text-sm text-gray-400">아직 생성된 캠페인이 없습니다</p>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg transition-colors"
          >
            <Plus size={14} /> 첫 캠페인 만들기
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map(c => (
            <div key={c.id} className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35]">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-white">{c.name}</h3>
                    <span className={`text-[10px] px-2 py-0.5 rounded ${campaignStatusBadge(c.status)}`}>
                      {campaignStatusLabel(c.status)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {c.product} · {c.commission_type === 'percentage' ? `${c.commission_rate}%` : `₩${c.commission_rate.toLocaleString()}/건`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-xs text-gray-500">{c.start_date} ~ {c.end_date ?? '진행중'}</p>
                  <button
                    onClick={() => handleToggleStatus(c)}
                    disabled={updateMutation.isPending}
                    className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                      c.status === 'active'
                        ? 'border border-yellow-400/30 text-yellow-400 hover:bg-yellow-400/10'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    }`}
                  >
                    {c.status === 'active' ? '일시정지' : '재개'}
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate(c.id)}
                    disabled={deleteMutation.isPending}
                    className="p-1 text-gray-500 hover:text-red-400 transition-colors"
                  >
                    <X size={12} />
                  </button>
                </div>
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
      )}
    </div>
  );
}

// ─── Partners section ─────────────────────────────────────────────────────────

function PartnersSection() {
  const qc = useQueryClient();
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteForm, setInviteForm] = useState<NewPartnerForm>({
    name: '',
    email: '',
    channel: 'instagram',
    followers: 0,
  });

  const { data: partners = [], isLoading, isError } = useQuery<AffiliatePartner[]>({
    queryKey: ['affiliate', 'partners'],
    queryFn: affiliateApi.getPartners,
    retry: 1,
  });

  const createMutation = useMutation({
    mutationFn: affiliateApi.createPartner,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['affiliate', 'partners'] });
      qc.invalidateQueries({ queryKey: ['affiliate', 'dashboard'] });
      toast.success('파트너 초대가 완료되었습니다');
      setShowInviteForm(false);
      setInviteForm({ name: '', email: '', channel: 'instagram', followers: 0 });
    },
    onError: () => toast.error('파트너 초대에 실패했습니다'),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => affiliateApi.approvePartner(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['affiliate', 'partners'] });
      qc.invalidateQueries({ queryKey: ['affiliate', 'dashboard'] });
      toast.success('파트너를 승인했습니다');
    },
    onError: () => toast.error('승인에 실패했습니다'),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: number) => affiliateApi.rejectPartner(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['affiliate', 'partners'] });
      toast.success('파트너 신청을 거절했습니다');
    },
    onError: () => toast.error('거절 처리에 실패했습니다'),
  });

  const copyLink = (link: string) => {
    navigator.clipboard.writeText(link);
    toast.success('링크가 복사되었습니다');
  };

  const handleInvite = () => {
    if (!inviteForm.name.trim()) { toast.error('파트너명을 입력하세요'); return; }
    if (!inviteForm.email.trim()) { toast.error('이메일을 입력하세요'); return; }
    createMutation.mutate(inviteForm);
  };

  if (isLoading) return <SectionLoader />;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold text-white">파트너 관리</h2>
        <button
          onClick={() => setShowInviteForm(!showInviteForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg transition-colors"
        >
          <UserPlus size={14} /> 파트너 초대
        </button>
      </div>

      {isError && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-lg">
          <AlertCircle size={14} className="text-red-400" />
          <p className="text-xs text-red-400">파트너 목록을 불러오지 못했습니다</p>
        </div>
      )}

      {showInviteForm && (
        <div className="bg-[#1a1b1e] rounded-xl p-4 border border-emerald-500/30 space-y-3">
          <h3 className="text-sm font-semibold text-white">파트너 초대하기</h3>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400">파트너명 *</label>
              <input
                value={inviteForm.name}
                onChange={e => setInviteForm({ ...inviteForm, name: e.target.value })}
                placeholder="예: 달콤리뷰"
                className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">이메일 *</label>
              <input
                type="email"
                value={inviteForm.email}
                onChange={e => setInviteForm({ ...inviteForm, email: e.target.value })}
                placeholder="partner@example.com"
                className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">채널</label>
              <select
                value={inviteForm.channel}
                onChange={e => setInviteForm({ ...inviteForm, channel: e.target.value })}
                className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50"
              >
                <option value="instagram">Instagram</option>
                <option value="youtube">YouTube</option>
                <option value="blog">블로그</option>
                <option value="tiktok">TikTok</option>
                <option value="other">기타</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400">팔로워 수</label>
              <input
                type="number"
                value={inviteForm.followers}
                onChange={e => setInviteForm({ ...inviteForm, followers: Number(e.target.value) })}
                className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowInviteForm(false)}
              className="px-3 py-1.5 text-xs text-gray-400 border border-[#2a2d35] rounded-lg hover:text-white hover:border-gray-500 transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleInvite}
              disabled={createMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
            >
              {createMutation.isPending && <Loader2 size={12} className="animate-spin" />}
              초대 보내기
            </button>
          </div>
        </div>
      )}

      {partners.length === 0 && !isError ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 bg-[#1a1b1e] rounded-xl border border-[#2a2d35]">
          <Users size={28} className="text-gray-600" />
          <p className="text-sm text-gray-400">아직 등록된 파트너가 없습니다</p>
          <button
            onClick={() => setShowInviteForm(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg transition-colors"
          >
            <UserPlus size={14} /> 첫 파트너 초대하기
          </button>
        </div>
      ) : (
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
                      onClick={() => approveMutation.mutate(p.id)}
                      disabled={approveMutation.isPending}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium rounded transition-colors"
                    >
                      {approveMutation.isPending && <Loader2 size={10} className="animate-spin" />}
                      승인
                    </button>
                    <button
                      onClick={() => rejectMutation.mutate(p.id)}
                      disabled={rejectMutation.isPending}
                      className="px-2 py-1 text-[10px] border border-red-400/30 text-red-400 hover:bg-red-400/10 disabled:opacity-50 rounded transition-colors"
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
                  {p.referral_link && (
                    <div className="flex items-center gap-2 bg-[#141516] rounded-lg px-3 py-2">
                      <Link2 size={12} className="text-gray-500 shrink-0" />
                      <code className="text-[10px] text-gray-400 flex-1 truncate">{p.referral_link}</code>
                      <button onClick={() => copyLink(p.referral_link)} className="text-gray-400 hover:text-white transition-colors">
                        <Copy size={12} />
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Referral section ─────────────────────────────────────────────────────────

function ReferralSection() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<NewReferralProgramForm>({
    name: '',
    reward_type: 'points',
    referrer_reward: 3000,
    referee_reward: 2000,
  });

  const { data: programs = [], isLoading, isError } = useQuery<ReferralProgram[]>({
    queryKey: ['affiliate', 'referral-programs'],
    queryFn: affiliateApi.getReferralPrograms,
    retry: 1,
  });

  const createMutation = useMutation({
    mutationFn: affiliateApi.createReferralProgram,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['affiliate', 'referral-programs'] });
      toast.success('프로그램이 생성되었습니다');
      setShowForm(false);
      setForm({ name: '', reward_type: 'points', referrer_reward: 3000, referee_reward: 2000 });
    },
    onError: () => toast.error('프로그램 생성에 실패했습니다'),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'active' | 'paused' }) =>
      affiliateApi.updateReferralProgram(id, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['affiliate', 'referral-programs'] });
      toast.success('프로그램 상태가 변경되었습니다');
    },
    onError: () => toast.error('상태 변경에 실패했습니다'),
  });

  const handleCreate = () => {
    if (!form.name.trim()) { toast.error('프로그램명을 입력하세요'); return; }
    createMutation.mutate(form);
  };

  if (isLoading) return <SectionLoader />;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold text-white">친구추천 프로그램</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg transition-colors"
        >
          <Plus size={14} /> 프로그램 추가
        </button>
      </div>

      {isError && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-lg">
          <AlertCircle size={14} className="text-red-400" />
          <p className="text-xs text-red-400">프로그램 목록을 불러오지 못했습니다</p>
        </div>
      )}

      {showForm && (
        <div className="bg-[#1a1b1e] rounded-xl p-4 border border-emerald-500/30 space-y-3">
          <h3 className="text-sm font-semibold text-white">새 추천 프로그램 만들기</h3>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <label className="text-xs text-gray-400">프로그램명 *</label>
              <input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="예: 친구 추천 프로그램"
                className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">보상 유형</label>
              <select
                value={form.reward_type}
                onChange={e => setForm({ ...form, reward_type: e.target.value as 'points' | 'coupon' | 'cash' })}
                className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50"
              >
                <option value="points">포인트</option>
                <option value="coupon">쿠폰</option>
                <option value="cash">현금</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400">추천인 보상</label>
              <input
                type="number"
                value={form.referrer_reward}
                onChange={e => setForm({ ...form, referrer_reward: Number(e.target.value) })}
                className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">피추천인 보상</label>
              <input
                type="number"
                value={form.referee_reward}
                onChange={e => setForm({ ...form, referee_reward: Number(e.target.value) })}
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
              disabled={createMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
            >
              {createMutation.isPending && <Loader2 size={12} className="animate-spin" />}
              프로그램 생성
            </button>
          </div>
        </div>
      )}

      {programs.length === 0 && !isError ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 bg-[#1a1b1e] rounded-xl border border-[#2a2d35]">
          <Gift size={28} className="text-gray-600" />
          <p className="text-sm text-gray-400">아직 추천 프로그램이 없습니다</p>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg transition-colors"
          >
            <Plus size={14} /> 첫 프로그램 만들기
          </button>
        </div>
      ) : (
        programs.map(prog => (
          <div key={prog.id} className="bg-[#1a1b1e] rounded-xl p-5 border border-[#2a2d35]">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="text-sm font-semibold text-white">{prog.name}</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  보상: {prog.reward_type === 'points' ? '포인트' : prog.reward_type === 'coupon' ? '쿠폰' : '현금'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-1 rounded ${prog.status === 'active' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-gray-400'}`}>
                  {prog.status === 'active' ? '운영중' : '일시정지'}
                </span>
                <button
                  onClick={() => toggleMutation.mutate({ id: prog.id, status: prog.status === 'active' ? 'paused' : 'active' })}
                  disabled={toggleMutation.isPending}
                  className="text-[10px] px-2 py-1 border border-[#2a2d35] text-gray-400 hover:text-white hover:border-gray-500 rounded transition-colors disabled:opacity-50"
                >
                  {prog.status === 'active' ? '중지' : '재개'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="bg-[#141516] rounded-lg p-3 text-center">
                <p className="text-[10px] text-gray-500">추천인 보상</p>
                <p className="text-lg font-bold text-emerald-400">{prog.referrer_reward.toLocaleString()}{prog.reward_type === 'points' ? 'P' : prog.reward_type === 'cash' ? '원' : ''}</p>
              </div>
              <div className="bg-[#141516] rounded-lg p-3 text-center">
                <p className="text-[10px] text-gray-500">피추천인 보상</p>
                <p className="text-lg font-bold text-cyan-400">{prog.referee_reward.toLocaleString()}{prog.reward_type === 'points' ? 'P' : prog.reward_type === 'cash' ? '원' : ''}</p>
              </div>
              <div className="bg-[#141516] rounded-lg p-3 text-center">
                <p className="text-[10px] text-gray-500">총 추천</p>
                <p className="text-lg font-bold text-white">{prog.total_referrals}</p>
              </div>
              <div className="bg-[#141516] rounded-lg p-3 text-center">
                <p className="text-[10px] text-gray-500">가입 전환율</p>
                <p className="text-lg font-bold text-yellow-400">{prog.conversion_rate.toFixed(1)}%</p>
              </div>
            </div>

            {/* 전환 퍼널 */}
            {prog.total_referrals > 0 && (
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
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ─── Settlement section ───────────────────────────────────────────────────────

function SettlementSection() {
  const qc = useQueryClient();

  const { data: settlements = [], isLoading, isError } = useQuery<Settlement[]>({
    queryKey: ['affiliate', 'settlements'],
    queryFn: affiliateApi.getSettlements,
    retry: 1,
  });

  const { data: partners = [] } = useQuery<AffiliatePartner[]>({
    queryKey: ['affiliate', 'partners'],
    queryFn: affiliateApi.getPartners,
    retry: 1,
  });

  const payMutation = useMutation({
    mutationFn: (id: number) => affiliateApi.paySettlement(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['affiliate', 'settlements'] });
      qc.invalidateQueries({ queryKey: ['affiliate', 'partners'] });
      qc.invalidateQueries({ queryKey: ['affiliate', 'dashboard'] });
      toast.success('정산이 처리되었습니다');
    },
    onError: () => toast.error('정산 처리에 실패했습니다'),
  });

  const createSettlementMutation = useMutation({
    mutationFn: (partnerId: number) => affiliateApi.createSettlement({ partner_id: partnerId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['affiliate', 'settlements'] });
      toast.success('정산 요청이 생성되었습니다');
    },
    onError: () => toast.error('정산 요청 생성에 실패했습니다'),
  });

  const totalUnpaid = settlements.filter(s => s.status === 'pending').reduce((sum, s) => sum + s.amount, 0);
  const totalPaid = settlements.filter(s => s.status === 'paid').reduce((sum, s) => sum + s.amount, 0);
  const pendingCount = settlements.filter(s => s.status === 'pending').length;

  const approvedPartners = partners.filter(p => p.status === 'approved' && p.unpaid_commission > 0);

  if (isLoading) return <SectionLoader />;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-white">정산 관리</h2>

      {isError && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-lg">
          <AlertCircle size={14} className="text-red-400" />
          <p className="text-xs text-red-400">정산 데이터를 불러오지 못했습니다</p>
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35] text-center">
          <p className="text-xs text-gray-500">총 미정산 금액</p>
          <p className="text-2xl font-bold text-red-400 mt-1">₩{totalUnpaid.toLocaleString()}</p>
          <p className="text-[10px] text-gray-600 mt-0.5">{pendingCount}건 대기중</p>
        </div>
        <div className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35] text-center">
          <p className="text-xs text-gray-500">이번 달 정산 예정</p>
          <p className="text-2xl font-bold text-yellow-400 mt-1">
            ₩{approvedPartners.reduce((s, p) => s + p.unpaid_commission, 0).toLocaleString()}
          </p>
        </div>
        <div className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35] text-center">
          <p className="text-xs text-gray-500">누적 정산 완료</p>
          <p className="text-2xl font-bold text-emerald-400 mt-1">₩{totalPaid.toLocaleString()}</p>
        </div>
      </div>

      {/* 파트너별 미정산 현황 (정산 요청 생성용) */}
      {approvedPartners.length > 0 && (
        <div className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35]">
          <h3 className="text-sm font-semibold text-white mb-3">미정산 파트너</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-[#2a2d35]">
                  <th className="text-left py-2 px-2">파트너</th>
                  <th className="text-right py-2 px-2">총 매출</th>
                  <th className="text-right py-2 px-2">총 커미션</th>
                  <th className="text-right py-2 px-2">미정산</th>
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
                      <button
                        onClick={() => createSettlementMutation.mutate(p.id)}
                        disabled={createSettlementMutation.isPending}
                        className="flex items-center gap-1 mx-auto px-2 py-0.5 text-[10px] bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded transition-colors"
                      >
                        {createSettlementMutation.isPending && <Loader2 size={8} className="animate-spin" />}
                        정산 요청
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 정산 내역 */}
      <div className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35]">
        <h3 className="text-sm font-semibold text-white mb-3">정산 내역</h3>
        {settlements.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2">
            <DollarSign size={24} className="text-gray-600" />
            <p className="text-xs text-gray-500">정산 내역이 없습니다</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-[#2a2d35]">
                  <th className="text-left py-2 px-2">파트너</th>
                  <th className="text-right py-2 px-2">금액</th>
                  <th className="text-center py-2 px-2">상태</th>
                  <th className="text-left py-2 px-2">생성일</th>
                  <th className="text-left py-2 px-2">완료일</th>
                  <th className="text-center py-2 px-2">액션</th>
                </tr>
              </thead>
              <tbody>
                {settlements.map(s => (
                  <tr key={s.id} className="border-b border-[#2a2d35]/50 text-gray-300">
                    <td className="py-2.5 px-2 font-medium text-white">{s.partner_name}</td>
                    <td className="py-2.5 px-2 text-right text-emerald-400">₩{s.amount.toLocaleString()}</td>
                    <td className="py-2.5 px-2 text-center">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${s.status === 'paid' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                        {s.status === 'paid' ? '완료' : '대기'}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-gray-500">{s.created_at?.slice(0, 10)}</td>
                    <td className="py-2.5 px-2 text-gray-500">{s.paid_at?.slice(0, 10) ?? '-'}</td>
                    <td className="py-2.5 px-2 text-center">
                      {s.status === 'pending' && (
                        <button
                          onClick={() => payMutation.mutate(s.id)}
                          disabled={payMutation.isPending}
                          className="flex items-center gap-1 mx-auto px-2 py-0.5 text-[10px] bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded transition-colors"
                        >
                          {payMutation.isPending && <Loader2 size={8} className="animate-spin" />}
                          정산하기
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Settings section ─────────────────────────────────────────────────────────

function SettingsSection() {
  const [settings, setSettings] = useState<AffiliateSettingsForm>({
    default_commission_rate: 10,
    cookie_lifetime_days: 30,
    min_payout_amount: 50000,
    payout_cycle: 'monthly',
    notify_new_partner: true,
    notify_conversion: true,
    notify_payout: true,
    notify_daily_report: false,
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      // Settings endpoint — backend will add GET /api/v1/affiliate/settings and PUT /api/v1/affiliate/settings
      // For now we POST to a placeholder-compatible endpoint
      return fetch('/api/v1/affiliate/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
    },
    onSuccess: () => toast.success('설정이 저장되었습니다'),
    onError: () => toast.error('설정 저장에 실패했습니다'),
  });

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-white">어필리에이트 설정</h2>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35] space-y-3">
          <h3 className="text-sm font-semibold text-white">기본 설정</h3>
          <div>
            <label className="text-xs text-gray-400">기본 커미션 비율 (%)</label>
            <input
              type="number"
              value={settings.default_commission_rate}
              onChange={e => setSettings({ ...settings, default_commission_rate: Number(e.target.value) })}
              className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400">쿠키 유효기간 (일)</label>
            <input
              type="number"
              value={settings.cookie_lifetime_days}
              onChange={e => setSettings({ ...settings, cookie_lifetime_days: Number(e.target.value) })}
              className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400">최소 정산 금액 (₩)</label>
            <input
              type="number"
              value={settings.min_payout_amount}
              onChange={e => setSettings({ ...settings, min_payout_amount: Number(e.target.value) })}
              className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400">정산 주기</label>
            <select
              value={settings.payout_cycle}
              onChange={e => setSettings({ ...settings, payout_cycle: e.target.value as 'weekly' | 'biweekly' | 'monthly' })}
              className="w-full mt-1 px-3 py-2 bg-[#141516] border border-[#2a2d35] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50"
            >
              <option value="weekly">주간</option>
              <option value="biweekly">격주</option>
              <option value="monthly">월간</option>
            </select>
          </div>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="flex items-center justify-center gap-1.5 w-full py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {saveMutation.isPending && <Loader2 size={12} className="animate-spin" />}
            설정 저장
          </button>
        </div>

        <div className="bg-[#1a1b1e] rounded-xl p-4 border border-[#2a2d35] space-y-3">
          <h3 className="text-sm font-semibold text-white">알림 설정</h3>
          {([
            { key: 'notify_new_partner' as const, label: '새 파트너 신청 알림' },
            { key: 'notify_conversion' as const, label: '전환 발생 알림' },
            { key: 'notify_payout' as const, label: '정산 예정일 알림' },
            { key: 'notify_daily_report' as const, label: '일일 리포트 이메일' },
          ]).map(item => (
            <label key={item.key} className="flex items-center justify-between cursor-pointer">
              <span className="text-xs text-gray-400">{item.label}</span>
              <input
                type="checkbox"
                checked={settings[item.key]}
                onChange={e => setSettings({ ...settings, [item.key]: e.target.checked })}
                className="w-4 h-4 rounded accent-emerald-500"
              />
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

      {activeSection === 'dashboard' && <DashboardSection />}
      {activeSection === 'campaigns' && <CampaignsSection />}
      {activeSection === 'partners' && <PartnersSection />}
      {activeSection === 'referral' && <ReferralSection />}
      {activeSection === 'settlement' && <SettlementSection />}
      {activeSection === 'settings' && <SettingsSection />}
    </div>
  );
}
