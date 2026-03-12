'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Layers, Plus, ChevronRight, ChevronLeft, Check, Loader2,
  Play, Pause, X, Image, Monitor, Target, Upload,
} from 'lucide-react';
import { naverGFAApi, formatNaverCurrency, formatNaverNumber, formatNaverPercent } from '@/lib/naver-api';
import toast from 'react-hot-toast';

type ViewMode = 'list' | 'wizard';
type WizardStep = 0 | 1 | 2 | 3;

const OBJECTIVES = [
  { value: 'WEBSITE_TRAFFIC', label: '웹사이트 트래픽', desc: '웹사이트 방문자 유도' },
  { value: 'CONVERSION', label: '전환', desc: '구매/가입 등 전환 최적화' },
  { value: 'VIDEO_VIEW', label: '동영상 조회', desc: '동영상 시청 유도' },
  { value: 'REACH', label: '도달', desc: '최대 많은 사용자에게 노출' },
];

const PLACEMENTS = [
  { value: 'naver_main', label: '네이버 메인' },
  { value: 'band', label: '밴드' },
  { value: 'cafe', label: '카페' },
  { value: 'blog', label: '블로그' },
  { value: 'kin', label: '지식iN' },
  { value: 'news', label: '뉴스' },
  { value: 'webtoon', label: '웹툰' },
  { value: 'series', label: '시리즈' },
];

const INTERESTS = [
  '패션/뷰티', '건강/운동', 'IT/디지털', '여행', '음식/맛집',
  '교육', '부동산', '자동차', '엔터테인먼트', '비즈니스',
  '금융/투자', '반려동물', '육아/출산', '게임', '생활/가전',
];

const AGE_GROUPS = ['15~19', '20~24', '25~29', '30~34', '35~39', '40~44', '45~49', '50~54', '55~59', '60+'];
const GENDERS = ['전체', '남성', '여성'];
const BID_STRATEGIES = ['CPC', 'CPM', 'CPA', 'OCPM'];
const DEVICES_LIST = ['전체', 'PC', '모바일'];

const STATUS_KO: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: '활성', color: 'bg-green-100 text-green-700' },
  ELIGIBLE: { label: '활성', color: 'bg-green-100 text-green-700' },
  ENABLED: { label: '활성', color: 'bg-green-100 text-green-700' },
  PAUSED: { label: '일시중지', color: 'bg-yellow-100 text-yellow-700' },
  DELETED: { label: '삭제', color: 'bg-red-100 text-red-700' },
  COMPLETED: { label: '완료', color: 'bg-gray-100 text-gray-600' },
};

const OBJECTIVE_KO: Record<string, string> = {
  WEBSITE_TRAFFIC: '웹사이트 트래픽',
  CONVERSION: '전환',
  VIDEO_VIEW: '동영상 조회',
  REACH: '도달',
  APP_INSTALL: '앱 설치',
};

export function NaverGFAManager() {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [wizardStep, setWizardStep] = useState<WizardStep>(0);
  const queryClient = useQueryClient();

  // Campaign form
  const [campaignForm, setCampaignForm] = useState({
    name: '',
    objective: 'WEBSITE_TRAFFIC',
    dailyBudget: 50000,
    totalBudget: 0,
    startDate: '',
    endDate: '',
  });

  // Ad group form
  const [adgroupForm, setAdgroupForm] = useState({
    name: '',
    bidStrategy: 'CPC',
    bidAmount: 500,
    ageGroups: [] as string[],
    gender: '전체',
    interests: [] as string[],
    placements: [] as string[],
    device: '전체',
  });

  // Creative form
  const [creativeForm, setCreativeForm] = useState({
    type: 'IMAGE',
    title: '',
    description: '',
    landingUrl: '',
    imageUrl: '',
  });

  // Fetch campaigns
  const { data: campaignsData, isLoading: loadingCampaigns } = useQuery({
    queryKey: ['naver-gfa-campaigns-manage'],
    queryFn: () => naverGFAApi.getCampaigns('last_7_days'),
    retry: 1,
  });

  const campaigns = campaignsData?.campaigns || campaignsData || [];

  // Create full campaign
  const createCampaignMutation = useMutation({
    mutationFn: async () => {
      // Step 1: Campaign
      const campaign = await naverGFAApi.createCampaign({
        name: campaignForm.name,
        objective: campaignForm.objective,
        dailyBudget: campaignForm.dailyBudget,
        totalBudget: campaignForm.totalBudget || undefined,
        startDate: campaignForm.startDate || undefined,
        endDate: campaignForm.endDate || undefined,
      });
      const campaignId = campaign.campaignId || campaign.id;

      // Step 2: Ad Group
      const adgroup = await naverGFAApi.createAdgroup(campaignId, {
        name: adgroupForm.name,
        bidStrategy: adgroupForm.bidStrategy,
        bidAmount: adgroupForm.bidAmount,
        targeting: {
          age: adgroupForm.ageGroups.length > 0 ? adgroupForm.ageGroups : undefined,
          gender: adgroupForm.gender !== '전체' ? [adgroupForm.gender] : undefined,
          interests: adgroupForm.interests.length > 0 ? adgroupForm.interests : undefined,
          placements: adgroupForm.placements.length > 0 ? adgroupForm.placements : undefined,
          devices: adgroupForm.device !== '전체' ? [adgroupForm.device] : undefined,
        },
      });
      const adgroupId = adgroup.adGroupId || adgroup.id;

      // Step 3: Creative
      if (creativeForm.title && creativeForm.landingUrl) {
        await naverGFAApi.createCreative(adgroupId, {
          type: creativeForm.type,
          title: creativeForm.title,
          description: creativeForm.description,
          landingUrl: creativeForm.landingUrl,
          imageUrl: creativeForm.imageUrl || undefined,
        });
      }

      return campaign;
    },
    onSuccess: () => {
      toast.success('GFA 캠페인이 성공적으로 생성되었습니다!');
      queryClient.invalidateQueries({ queryKey: ['naver-gfa-campaigns'] });
      resetWizard();
      setViewMode('list');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'GFA 캠페인 생성에 실패했습니다.';
      toast.error(msg);
    },
  });

  const pauseMutation = useMutation({
    mutationFn: (campaignId: string) => naverGFAApi.pauseCampaign(campaignId),
    onSuccess: () => {
      toast.success('캠페인이 일시중지되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['naver-gfa-campaigns'] });
    },
    onError: () => toast.error('일시중지에 실패했습니다.'),
  });

  const resumeMutation = useMutation({
    mutationFn: (campaignId: string) => naverGFAApi.resumeCampaign(campaignId),
    onSuccess: () => {
      toast.success('캠페인이 재개되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['naver-gfa-campaigns'] });
    },
    onError: () => toast.error('재개에 실패했습니다.'),
  });

  const resetWizard = () => {
    setWizardStep(0);
    setCampaignForm({ name: '', objective: 'WEBSITE_TRAFFIC', dailyBudget: 50000, totalBudget: 0, startDate: '', endDate: '' });
    setAdgroupForm({ name: '', bidStrategy: 'CPC', bidAmount: 500, ageGroups: [], gender: '전체', interests: [], placements: [], device: '전체' });
    setCreativeForm({ type: 'IMAGE', title: '', description: '', landingUrl: '', imageUrl: '' });
  };

  const stepLabels = ['캠페인 설정', '광고그룹 & 타겟팅', '크리에이티브', '게재위치'];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Layers className="text-green-600" size={28} />
            GFA 관리
          </h1>
          <p className="text-sm text-gray-500 mt-1">네이버 성과형 디스플레이 광고 캠페인 관리</p>
        </div>
        <div className="flex items-center gap-2">
          {viewMode === 'list' ? (
            <button
              onClick={() => setViewMode('wizard')}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
            >
              <Plus size={16} />
              새 캠페인
            </button>
          ) : (
            <button
              onClick={() => { setViewMode('list'); resetWizard(); }}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <X size={16} />
              취소
            </button>
          )}
        </div>
      </div>

      {/* Campaign Wizard */}
      {viewMode === 'wizard' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          {/* Step indicator */}
          <div className="flex items-center justify-center mb-8">
            {stepLabels.map((label, i) => (
              <div key={i} className="flex items-center">
                <div className={`flex items-center gap-2 ${i <= wizardStep ? 'text-green-600' : 'text-gray-400'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                    i < wizardStep ? 'bg-green-600 text-white' : i === wizardStep ? 'bg-green-100 text-green-700 border-2 border-green-600' : 'bg-gray-100 text-gray-400'
                  }`}>
                    {i < wizardStep ? <Check size={16} /> : i + 1}
                  </div>
                  <span className="text-sm font-medium hidden sm:inline">{label}</span>
                </div>
                {i < stepLabels.length - 1 && (
                  <div className={`w-12 h-0.5 mx-2 ${i < wizardStep ? 'bg-green-600' : 'bg-gray-200'}`} />
                )}
              </div>
            ))}
          </div>

          {/* Step 0: Campaign */}
          {wizardStep === 0 && (
            <div className="max-w-lg mx-auto space-y-6">
              <h2 className="text-lg font-semibold text-gray-900">캠페인 설정</h2>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">캠페인명</label>
                <input
                  type="text"
                  value={campaignForm.name}
                  onChange={(e) => setCampaignForm({ ...campaignForm, name: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-500 focus:outline-none"
                  placeholder="GFA 캠페인 이름"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">광고 목적</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {OBJECTIVES.map((obj) => (
                    <button
                      key={obj.value}
                      onClick={() => setCampaignForm({ ...campaignForm, objective: obj.value })}
                      className={`p-3 rounded-lg border text-left transition-colors ${
                        campaignForm.objective === obj.value
                          ? 'border-green-500 bg-green-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <p className="text-sm font-medium text-gray-900">{obj.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{obj.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">일 예산</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">&#8361;</span>
                    <input
                      type="number"
                      value={campaignForm.dailyBudget}
                      onChange={(e) => setCampaignForm({ ...campaignForm, dailyBudget: Number(e.target.value) })}
                      className="w-full rounded-lg border border-gray-300 pl-8 pr-4 py-2 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-500 focus:outline-none"
                      min={10000}
                      step={10000}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">총 예산 (선택)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">&#8361;</span>
                    <input
                      type="number"
                      value={campaignForm.totalBudget}
                      onChange={(e) => setCampaignForm({ ...campaignForm, totalBudget: Number(e.target.value) })}
                      className="w-full rounded-lg border border-gray-300 pl-8 pr-4 py-2 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-500 focus:outline-none"
                      min={0}
                      step={10000}
                    />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">시작일 (선택)</label>
                  <input
                    type="date"
                    value={campaignForm.startDate}
                    onChange={(e) => setCampaignForm({ ...campaignForm, startDate: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">종료일 (선택)</label>
                  <input
                    type="date"
                    value={campaignForm.endDate}
                    onChange={(e) => setCampaignForm({ ...campaignForm, endDate: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 1: Ad Group & Targeting */}
          {wizardStep === 1 && (
            <div className="max-w-lg mx-auto space-y-6">
              <h2 className="text-lg font-semibold text-gray-900">광고그룹 & 타겟팅</h2>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">광고그룹명</label>
                <input
                  type="text"
                  value={adgroupForm.name}
                  onChange={(e) => setAdgroupForm({ ...adgroupForm, name: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-500 focus:outline-none"
                  placeholder="광고그룹 이름"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">입찰 전략</label>
                  <select
                    value={adgroupForm.bidStrategy}
                    onChange={(e) => setAdgroupForm({ ...adgroupForm, bidStrategy: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:border-green-500 focus:ring-1 focus:ring-green-500 focus:outline-none"
                  >
                    {BID_STRATEGIES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">입찰가</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">&#8361;</span>
                    <input
                      type="number"
                      value={adgroupForm.bidAmount}
                      onChange={(e) => setAdgroupForm({ ...adgroupForm, bidAmount: Number(e.target.value) })}
                      className="w-full rounded-lg border border-gray-300 pl-8 pr-4 py-2 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-500 focus:outline-none"
                      min={100}
                    />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">성별</label>
                  <select
                    value={adgroupForm.gender}
                    onChange={(e) => setAdgroupForm({ ...adgroupForm, gender: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:border-green-500 focus:ring-1 focus:ring-green-500 focus:outline-none"
                  >
                    {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">기기</label>
                  <select
                    value={adgroupForm.device}
                    onChange={(e) => setAdgroupForm({ ...adgroupForm, device: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:border-green-500 focus:ring-1 focus:ring-green-500 focus:outline-none"
                  >
                    {DEVICES_LIST.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">연령대</label>
                <div className="flex flex-wrap gap-2">
                  {AGE_GROUPS.map((age) => (
                    <button
                      key={age}
                      onClick={() => {
                        const newAges = adgroupForm.ageGroups.includes(age)
                          ? adgroupForm.ageGroups.filter((a) => a !== age)
                          : [...adgroupForm.ageGroups, age];
                        setAdgroupForm({ ...adgroupForm, ageGroups: newAges });
                      }}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                        adgroupForm.ageGroups.includes(age)
                          ? 'bg-green-100 text-green-700 border border-green-300'
                          : 'bg-gray-100 text-gray-600 border border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {age}
                    </button>
                  ))}
                </div>
                {adgroupForm.ageGroups.length === 0 && (
                  <p className="text-xs text-gray-400 mt-1">선택하지 않으면 전체 연령에 노출됩니다.</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">관심사</label>
                <div className="flex flex-wrap gap-2">
                  {INTERESTS.map((interest) => (
                    <button
                      key={interest}
                      onClick={() => {
                        const newInterests = adgroupForm.interests.includes(interest)
                          ? adgroupForm.interests.filter((i) => i !== interest)
                          : [...adgroupForm.interests, interest];
                        setAdgroupForm({ ...adgroupForm, interests: newInterests });
                      }}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                        adgroupForm.interests.includes(interest)
                          ? 'bg-green-100 text-green-700 border border-green-300'
                          : 'bg-gray-100 text-gray-600 border border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {interest}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Creative */}
          {wizardStep === 2 && (
            <div className="max-w-lg mx-auto space-y-6">
              <h2 className="text-lg font-semibold text-gray-900">크리에이티브</h2>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">소재 유형</label>
                <div className="flex gap-3">
                  {['IMAGE', 'VIDEO', 'NATIVE'].map((type) => (
                    <button
                      key={type}
                      onClick={() => setCreativeForm({ ...creativeForm, type })}
                      className={`flex-1 p-3 rounded-lg border text-center transition-colors ${
                        creativeForm.type === type
                          ? 'border-green-500 bg-green-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <p className="text-sm font-medium text-gray-900">
                        {type === 'IMAGE' ? '이미지' : type === 'VIDEO' ? '동영상' : '네이티브'}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">제목</label>
                <input
                  type="text"
                  value={creativeForm.title}
                  onChange={(e) => setCreativeForm({ ...creativeForm, title: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-500 focus:outline-none"
                  placeholder="크리에이티브 제목"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">설명</label>
                <textarea
                  value={creativeForm.description}
                  onChange={(e) => setCreativeForm({ ...creativeForm, description: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-500 focus:outline-none resize-none"
                  rows={3}
                  placeholder="크리에이티브 설명"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">랜딩 URL</label>
                <input
                  type="url"
                  value={creativeForm.landingUrl}
                  onChange={(e) => setCreativeForm({ ...creativeForm, landingUrl: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-500 focus:outline-none"
                  placeholder="https://example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">이미지 URL (선택)</label>
                <input
                  type="url"
                  value={creativeForm.imageUrl}
                  onChange={(e) => setCreativeForm({ ...creativeForm, imageUrl: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-500 focus:outline-none"
                  placeholder="https://example.com/image.jpg"
                />
              </div>
              <div className="border border-dashed border-gray-300 rounded-lg p-6 text-center">
                <Upload size={32} className="mx-auto mb-2 text-gray-400" />
                <p className="text-sm text-gray-500">이미지/동영상 파일 업로드</p>
                <p className="text-xs text-gray-400 mt-1">또는 위의 URL 필드에 직접 입력</p>
              </div>
            </div>
          )}

          {/* Step 3: Placements */}
          {wizardStep === 3 && (
            <div className="max-w-lg mx-auto space-y-6">
              <h2 className="text-lg font-semibold text-gray-900">게재위치 설정</h2>
              <p className="text-sm text-gray-500">광고가 노출될 네이버 서비스를 선택하세요.</p>
              <div className="grid grid-cols-2 gap-3">
                {PLACEMENTS.map((placement) => (
                  <button
                    key={placement.value}
                    onClick={() => {
                      const newPlacements = adgroupForm.placements.includes(placement.value)
                        ? adgroupForm.placements.filter((p) => p !== placement.value)
                        : [...adgroupForm.placements, placement.value];
                      setAdgroupForm({ ...adgroupForm, placements: newPlacements });
                    }}
                    className={`p-4 rounded-lg border text-center transition-colors ${
                      adgroupForm.placements.includes(placement.value)
                        ? 'border-green-500 bg-green-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <Monitor size={20} className={`mx-auto mb-1 ${adgroupForm.placements.includes(placement.value) ? 'text-green-600' : 'text-gray-400'}`} />
                    <p className="text-sm font-medium text-gray-900">{placement.label}</p>
                  </button>
                ))}
              </div>
              {adgroupForm.placements.length === 0 && (
                <p className="text-xs text-gray-400">선택하지 않으면 모든 게재위치에 노출됩니다.</p>
              )}

              {/* Summary before creation */}
              <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                <h3 className="text-sm font-semibold text-gray-800 mb-3">캠페인 요약</h3>
                <div className="space-y-1 text-sm text-gray-600">
                  <p>캠페인: <span className="font-medium text-gray-900">{campaignForm.name}</span></p>
                  <p>목적: <span className="font-medium text-gray-900">{OBJECTIVES.find((o) => o.value === campaignForm.objective)?.label}</span></p>
                  <p>일예산: <span className="font-medium text-gray-900">{formatNaverCurrency(campaignForm.dailyBudget)}</span></p>
                  <p>광고그룹: <span className="font-medium text-gray-900">{adgroupForm.name}</span></p>
                  <p>입찰전략: <span className="font-medium text-gray-900">{adgroupForm.bidStrategy} / {formatNaverCurrency(adgroupForm.bidAmount)}</span></p>
                  <p>크리에이티브: <span className="font-medium text-gray-900">{creativeForm.title || '(미입력)'}</span></p>
                  <p>게재위치: <span className="font-medium text-gray-900">{adgroupForm.placements.length > 0 ? adgroupForm.placements.map((p) => PLACEMENTS.find((pl) => pl.value === p)?.label).join(', ') : '전체'}</span></p>
                </div>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-8 pt-4 border-t border-gray-200">
            <button
              onClick={() => {
                if (wizardStep === 0) { setViewMode('list'); resetWizard(); }
                else setWizardStep((wizardStep - 1) as WizardStep);
              }}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <ChevronLeft size={16} />
              {wizardStep === 0 ? '취소' : '이전'}
            </button>
            {wizardStep < 3 ? (
              <button
                onClick={() => {
                  if (wizardStep === 0 && !campaignForm.name) {
                    toast.error('캠페인명을 입력해주세요.');
                    return;
                  }
                  if (wizardStep === 1 && !adgroupForm.name) {
                    toast.error('광고그룹명을 입력해주세요.');
                    return;
                  }
                  setWizardStep((wizardStep + 1) as WizardStep);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
              >
                다음
                <ChevronRight size={16} />
              </button>
            ) : (
              <button
                onClick={() => createCampaignMutation.mutate()}
                disabled={createCampaignMutation.isPending}
                className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50"
              >
                {createCampaignMutation.isPending ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Check size={16} />
                )}
                {createCampaignMutation.isPending ? '생성 중...' : '캠페인 생성'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Campaign List */}
      {viewMode === 'list' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-base font-semibold text-gray-900">기존 GFA 캠페인 관리</h2>
          </div>
          {loadingCampaigns ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-green-600" size={24} />
              <span className="ml-2 text-gray-500">로딩 중...</span>
            </div>
          ) : campaigns.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Layers size={48} className="mx-auto mb-3 text-gray-300" />
              <p>등록된 GFA 캠페인이 없습니다.</p>
              <button
                onClick={() => setViewMode('wizard')}
                className="mt-4 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
              >
                첫 GFA 캠페인 만들기
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">캠페인명</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">목적</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">상태</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">일예산</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">비용</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">노출</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">클릭</th>
                    <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">액션</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {campaigns.map((c: any) => {
                    const cid = c.campaignId || c.id;
                    const status = STATUS_KO[c.status] || { label: c.status, color: 'bg-gray-100 text-gray-600' };
                    return (
                      <tr key={cid} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{OBJECTIVE_KO[c.objective] || c.objective || '-'}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${status.color}`}>{status.label}</span>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700">{formatNaverCurrency(c.dailyBudget || 0)}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">{formatNaverCurrency(c.spend || 0)}</td>
                        <td className="px-4 py-3 text-right text-gray-700">{formatNaverNumber(c.impressions || 0)}</td>
                        <td className="px-4 py-3 text-right text-gray-700">{formatNaverNumber(c.clicks || 0)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-1">
                            {c.status === 'PAUSED' ? (
                              <button
                                onClick={() => resumeMutation.mutate(cid)}
                                className="p-1.5 hover:bg-green-50 rounded text-green-600"
                                title="재개"
                              >
                                <Play size={14} />
                              </button>
                            ) : (
                              <button
                                onClick={() => pauseMutation.mutate(cid)}
                                className="p-1.5 hover:bg-yellow-50 rounded text-yellow-600"
                                title="일시중지"
                              >
                                <Pause size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
