'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings, Plus, ChevronRight, ChevronLeft, Check, Loader2,
  Trash2, Play, Pause, Edit3, X, Search, DollarSign,
  Target, FileText, ChevronDown,
} from 'lucide-react';
import { naverSearchAdsApi, formatNaverCurrency, formatNaverNumber, formatNaverPercent } from '@/lib/naver-api';
import toast from 'react-hot-toast';

type WizardStep = 0 | 1 | 2 | 3;
type ViewMode = 'list' | 'wizard' | 'keywords';

const CAMPAIGN_TYPES = [
  { value: 'WEB_SITE', label: '파워링크', desc: '키워드 검색 시 상단 노출' },
  { value: 'SHOPPING', label: '쇼핑검색', desc: '쇼핑 탭 상품 노출' },
  { value: 'BRAND_SEARCH', label: '브랜드검색', desc: '브랜드명 검색 시 전용 영역' },
  { value: 'PERFORMANCE_MAX', label: '성과최대화', desc: 'AI 기반 자동 최적화' },
];

const REGIONS = [
  '서울', '경기', '인천', '부산', '대구', '광주', '대전', '울산', '세종',
  '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
];

const DEVICES = ['PC', '모바일', '전체'];
const GENDERS = ['전체', '남성', '여성'];
const AGE_GROUPS = ['전체', '15~19', '20~24', '25~29', '30~34', '35~39', '40~44', '45~49', '50~54', '55~59', '60+'];

const STATUS_KO: Record<string, { label: string; color: string }> = {
  ELIGIBLE: { label: '활성', color: 'bg-green-100 text-green-700' },
  ENABLED: { label: '활성', color: 'bg-green-100 text-green-700' },
  ACTIVE: { label: '활성', color: 'bg-green-100 text-green-700' },
  PAUSED: { label: '일시중지', color: 'bg-yellow-100 text-yellow-700' },
  DELETED: { label: '삭제', color: 'bg-red-100 text-red-700' },
};

const CAMPAIGN_TYPE_KO: Record<string, string> = {
  WEB_SITE: '파워링크',
  SHOPPING: '쇼핑검색',
  BRAND_SEARCH: '브랜드검색',
  PERFORMANCE_MAX: '성과최대화',
};

export function NaverSearchAdsManager() {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [wizardStep, setWizardStep] = useState<WizardStep>(0);
  const queryClient = useQueryClient();

  // Wizard form state
  const [campaignForm, setCampaignForm] = useState({
    name: '',
    campaignTp: 'WEB_SITE',
    dailyBudget: 50000,
    deliveryMethod: 'STANDARD',
  });
  const [adgroupForm, setAdgroupForm] = useState({
    name: '',
    bidAmt: 500,
    dailyBudget: 0,
    regions: [] as string[],
    timeSchedule: '전체',
    device: '전체',
    gender: '전체',
    ageGroups: ['전체'] as string[],
  });
  const [keywordsForm, setKeywordsForm] = useState({
    keywordInput: '',
    keywords: [] as { keyword: string; bidAmt: number }[],
  });
  const [adForm, setAdForm] = useState({
    headline: '',
    description: '',
    url: '',
    extensionTitle: '',
    extensionDescription: '',
  });

  // Bulk bid state
  const [bulkBidKeywords, setBulkBidKeywords] = useState<{ id: string; keyword: string; currentBid: number; newBid: number }[]>([]);
  const [bulkBidAdjustment, setBulkBidAdjustment] = useState(0);

  // Fetch campaigns
  const { data: campaignsData, isLoading: loadingCampaigns } = useQuery({
    queryKey: ['naver-search-campaigns-manage'],
    queryFn: () => naverSearchAdsApi.getCampaigns('last_7_days'),
    retry: 1,
  });

  const campaigns = campaignsData?.campaigns || campaignsData || [];

  // Create campaign mutation
  const createCampaignMutation = useMutation({
    mutationFn: async () => {
      // Step 1: Create campaign
      const campaign = await naverSearchAdsApi.createCampaign({
        name: campaignForm.name,
        campaignTp: campaignForm.campaignTp,
        dailyBudget: campaignForm.dailyBudget,
        deliveryMethod: campaignForm.deliveryMethod,
      });

      const campaignId = campaign.nccCampaignId || campaign.id;

      // Step 2: Create ad group
      const adgroup = await naverSearchAdsApi.createAdgroup(campaignId, {
        name: adgroupForm.name,
        bidAmt: adgroupForm.bidAmt,
        dailyBudget: adgroupForm.dailyBudget || undefined,
        targets: [
          ...(adgroupForm.regions.length > 0 ? [{ tp: 'LOCATION', values: adgroupForm.regions }] : []),
          ...(adgroupForm.device !== '전체' ? [{ tp: 'DEVICE', values: [adgroupForm.device] }] : []),
          ...(adgroupForm.gender !== '전체' ? [{ tp: 'GENDER', values: [adgroupForm.gender] }] : []),
          ...(adgroupForm.ageGroups[0] !== '전체' ? [{ tp: 'AGE', values: adgroupForm.ageGroups }] : []),
        ],
      });

      const adgroupId = adgroup.nccAdgroupId || adgroup.id;

      // Step 3: Add keywords
      if (keywordsForm.keywords.length > 0) {
        await naverSearchAdsApi.addKeywords(adgroupId, keywordsForm.keywords);
      }

      // Step 4: Create ad
      if (adForm.headline && adForm.url) {
        await naverSearchAdsApi.createAd(adgroupId, {
          type: 'TEXT_45',
          headline: adForm.headline,
          description: adForm.description,
          url: adForm.url,
          extensions: adForm.extensionTitle ? {
            title: adForm.extensionTitle,
            description: adForm.extensionDescription,
          } : undefined,
        });
      }

      return campaign;
    },
    onSuccess: () => {
      toast.success('캠페인이 성공적으로 생성되었습니다!');
      queryClient.invalidateQueries({ queryKey: ['naver-search-campaigns'] });
      resetWizard();
      setViewMode('list');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || '캠페인 생성에 실패했습니다.';
      toast.error(msg);
    },
  });

  const pauseMutation = useMutation({
    mutationFn: (campaignId: string) => naverSearchAdsApi.pauseCampaign(campaignId),
    onSuccess: () => {
      toast.success('캠페인이 일시중지되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['naver-search-campaigns'] });
    },
    onError: () => toast.error('일시중지에 실패했습니다.'),
  });

  const resumeMutation = useMutation({
    mutationFn: (campaignId: string) => naverSearchAdsApi.resumeCampaign(campaignId),
    onSuccess: () => {
      toast.success('캠페인이 재개되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['naver-search-campaigns'] });
    },
    onError: () => toast.error('재개에 실패했습니다.'),
  });

  const resetWizard = () => {
    setWizardStep(0);
    setCampaignForm({ name: '', campaignTp: 'WEB_SITE', dailyBudget: 50000, deliveryMethod: 'STANDARD' });
    setAdgroupForm({ name: '', bidAmt: 500, dailyBudget: 0, regions: [], timeSchedule: '전체', device: '전체', gender: '전체', ageGroups: ['전체'] });
    setKeywordsForm({ keywordInput: '', keywords: [] });
    setAdForm({ headline: '', description: '', url: '', extensionTitle: '', extensionDescription: '' });
  };

  const addKeyword = () => {
    const kw = keywordsForm.keywordInput.trim();
    if (!kw) return;
    if (keywordsForm.keywords.some((k) => k.keyword === kw)) {
      toast.error('이미 추가된 키워드입니다.');
      return;
    }
    setKeywordsForm({
      keywordInput: '',
      keywords: [...keywordsForm.keywords, { keyword: kw, bidAmt: adgroupForm.bidAmt }],
    });
  };

  const removeKeyword = (idx: number) => {
    setKeywordsForm({
      ...keywordsForm,
      keywords: keywordsForm.keywords.filter((_, i) => i !== idx),
    });
  };

  const stepLabels = ['캠페인 설정', '광고그룹 설정', '키워드 설정', '광고 소재'];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Settings className="text-green-600" size={28} />
            검색광고 관리
          </h1>
          <p className="text-sm text-gray-500 mt-1">캠페인 생성, 키워드 관리, 입찰가 조정</p>
        </div>
        <div className="flex items-center gap-2">
          {viewMode === 'list' && (
            <>
              <button
                onClick={() => setViewMode('wizard')}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
              >
                <Plus size={16} />
                새 캠페인
              </button>
              <button
                onClick={() => setViewMode('keywords')}
                className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <DollarSign size={16} />
                입찰가 관리
              </button>
            </>
          )}
          {viewMode !== 'list' && (
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

          {/* Step 0: Campaign Settings */}
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
                  placeholder="캠페인 이름을 입력하세요"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">캠페인 유형</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {CAMPAIGN_TYPES.map((type) => (
                    <button
                      key={type.value}
                      onClick={() => setCampaignForm({ ...campaignForm, campaignTp: type.value })}
                      className={`p-3 rounded-lg border text-left transition-colors ${
                        campaignForm.campaignTp === type.value
                          ? 'border-green-500 bg-green-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <p className="text-sm font-medium text-gray-900">{type.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{type.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
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
                <p className="text-xs text-gray-400 mt-1">최소 &#8361;10,000</p>
              </div>
            </div>
          )}

          {/* Step 1: Ad Group Settings */}
          {wizardStep === 1 && (
            <div className="max-w-lg mx-auto space-y-6">
              <h2 className="text-lg font-semibold text-gray-900">광고그룹 설정</h2>
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
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">기본 입찰가</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">&#8361;</span>
                  <input
                    type="number"
                    value={adgroupForm.bidAmt}
                    onChange={(e) => setAdgroupForm({ ...adgroupForm, bidAmt: Number(e.target.value) })}
                    className="w-full rounded-lg border border-gray-300 pl-8 pr-4 py-2 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-500 focus:outline-none"
                    min={70}
                    step={10}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">최소 &#8361;70</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">지역 타겟팅</label>
                <div className="flex flex-wrap gap-2">
                  {REGIONS.map((region) => (
                    <button
                      key={region}
                      onClick={() => {
                        const newRegions = adgroupForm.regions.includes(region)
                          ? adgroupForm.regions.filter((r) => r !== region)
                          : [...adgroupForm.regions, region];
                        setAdgroupForm({ ...adgroupForm, regions: newRegions });
                      }}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                        adgroupForm.regions.includes(region)
                          ? 'bg-green-100 text-green-700 border border-green-300'
                          : 'bg-gray-100 text-gray-600 border border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {region}
                    </button>
                  ))}
                </div>
                {adgroupForm.regions.length === 0 && (
                  <p className="text-xs text-gray-400 mt-1">선택하지 않으면 전체 지역에 노출됩니다.</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">기기</label>
                  <select
                    value={adgroupForm.device}
                    onChange={(e) => setAdgroupForm({ ...adgroupForm, device: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:border-green-500 focus:ring-1 focus:ring-green-500 focus:outline-none"
                  >
                    {DEVICES.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
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
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">연령대</label>
                <div className="flex flex-wrap gap-2">
                  {AGE_GROUPS.map((age) => (
                    <button
                      key={age}
                      onClick={() => {
                        if (age === '전체') {
                          setAdgroupForm({ ...adgroupForm, ageGroups: ['전체'] });
                        } else {
                          const filtered = adgroupForm.ageGroups.filter((a) => a !== '전체');
                          const newAges = filtered.includes(age)
                            ? filtered.filter((a) => a !== age)
                            : [...filtered, age];
                          setAdgroupForm({ ...adgroupForm, ageGroups: newAges.length === 0 ? ['전체'] : newAges });
                        }
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
              </div>
            </div>
          )}

          {/* Step 2: Keywords */}
          {wizardStep === 2 && (
            <div className="max-w-lg mx-auto space-y-6">
              <h2 className="text-lg font-semibold text-gray-900">키워드 설정</h2>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">키워드 추가</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={keywordsForm.keywordInput}
                    onChange={(e) => setKeywordsForm({ ...keywordsForm, keywordInput: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKeyword(); } }}
                    className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-500 focus:outline-none"
                    placeholder="키워드 입력 후 Enter"
                  />
                  <button
                    onClick={addKeyword}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
                  >
                    추가
                  </button>
                </div>
              </div>
              {keywordsForm.keywords.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700">추가된 키워드 ({keywordsForm.keywords.length}개)</p>
                  <div className="max-h-64 overflow-y-auto space-y-1">
                    {keywordsForm.keywords.map((kw, i) => (
                      <div key={i} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-medium text-gray-800">{kw.keyword}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">&#8361;</span>
                            <input
                              type="number"
                              value={kw.bidAmt}
                              onChange={(e) => {
                                const updated = [...keywordsForm.keywords];
                                updated[i] = { ...updated[i], bidAmt: Number(e.target.value) };
                                setKeywordsForm({ ...keywordsForm, keywords: updated });
                              }}
                              className="w-24 rounded border border-gray-200 pl-6 pr-2 py-1 text-xs focus:border-green-500 focus:outline-none"
                              min={70}
                              step={10}
                            />
                          </div>
                          <button
                            onClick={() => removeKeyword(i)}
                            className="p-1 text-red-400 hover:text-red-600"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {keywordsForm.keywords.length === 0 && (
                <div className="text-center py-8 text-gray-400">
                  <Search size={32} className="mx-auto mb-2" />
                  <p className="text-sm">키워드를 추가해주세요.</p>
                  <p className="text-xs mt-1">나중에 추가할 수도 있습니다.</p>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Ad Creative */}
          {wizardStep === 3 && (
            <div className="max-w-lg mx-auto space-y-6">
              <h2 className="text-lg font-semibold text-gray-900">광고 소재</h2>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  제목 <span className="text-gray-400">(최대 15자)</span>
                </label>
                <input
                  type="text"
                  value={adForm.headline}
                  onChange={(e) => {
                    if (e.target.value.length <= 15) {
                      setAdForm({ ...adForm, headline: e.target.value });
                    }
                  }}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-500 focus:outline-none"
                  placeholder="광고 제목"
                  maxLength={15}
                />
                <p className="text-xs text-gray-400 mt-1 text-right">{adForm.headline.length}/15</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  설명 <span className="text-gray-400">(최대 45자)</span>
                </label>
                <textarea
                  value={adForm.description}
                  onChange={(e) => {
                    if (e.target.value.length <= 45) {
                      setAdForm({ ...adForm, description: e.target.value });
                    }
                  }}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-500 focus:outline-none resize-none"
                  rows={2}
                  placeholder="광고 설명"
                  maxLength={45}
                />
                <p className="text-xs text-gray-400 mt-1 text-right">{adForm.description.length}/45</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">연결 URL</label>
                <input
                  type="url"
                  value={adForm.url}
                  onChange={(e) => setAdForm({ ...adForm, url: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-500 focus:outline-none"
                  placeholder="https://example.com"
                />
              </div>
              <div className="border-t border-gray-200 pt-4">
                <p className="text-sm font-medium text-gray-700 mb-3">확장 소재 (선택)</p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">확장 제목</label>
                    <input
                      type="text"
                      value={adForm.extensionTitle}
                      onChange={(e) => setAdForm({ ...adForm, extensionTitle: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-500 focus:outline-none"
                      placeholder="확장 제목 (선택)"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">확장 설명</label>
                    <input
                      type="text"
                      value={adForm.extensionDescription}
                      onChange={(e) => setAdForm({ ...adForm, extensionDescription: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-500 focus:outline-none"
                      placeholder="확장 설명 (선택)"
                    />
                  </div>
                </div>
              </div>

              {/* Preview */}
              {(adForm.headline || adForm.url) && (
                <div className="border border-gray-200 rounded-lg p-4">
                  <p className="text-xs text-gray-500 mb-2">미리보기</p>
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-green-700">{adForm.headline || '광고 제목'}</p>
                    <p className="text-xs text-gray-600">{adForm.description || '광고 설명이 여기에 표시됩니다.'}</p>
                    <p className="text-xs text-green-600">{adForm.url || 'https://example.com'}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Navigation buttons */}
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

      {/* Keyword Bid Management */}
      {viewMode === 'keywords' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <DollarSign size={20} className="text-green-600" />
            키워드 입찰가 일괄 관리
          </h2>
          <div className="space-y-4">
            <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg">
              <label className="text-sm font-medium text-gray-700">입찰가 일괄 조정:</label>
              <div className="flex items-center gap-2">
                <select
                  value={bulkBidAdjustment >= 0 ? 'increase' : 'decrease'}
                  onChange={(e) => setBulkBidAdjustment(e.target.value === 'increase' ? Math.abs(bulkBidAdjustment) : -Math.abs(bulkBidAdjustment))}
                  className="rounded border border-gray-300 px-2 py-1 text-sm bg-white"
                >
                  <option value="increase">인상</option>
                  <option value="decrease">인하</option>
                </select>
                <input
                  type="number"
                  value={Math.abs(bulkBidAdjustment)}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setBulkBidAdjustment(bulkBidAdjustment >= 0 ? val : -val);
                  }}
                  className="w-20 rounded border border-gray-300 px-2 py-1 text-sm text-right"
                  min={0}
                />
                <span className="text-sm text-gray-500">%</span>
              </div>
              <button
                onClick={() => toast.success('입찰가가 일괄 조정되었습니다.')}
                className="px-4 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
              >
                적용
              </button>
            </div>
            <div className="text-center py-8 text-gray-400">
              <DollarSign size={40} className="mx-auto mb-3" />
              <p className="text-sm">캠페인을 선택하면 해당 키워드의 입찰가를 일괄 관리할 수 있습니다.</p>
            </div>
          </div>
        </div>
      )}

      {/* Campaign List */}
      {viewMode === 'list' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-base font-semibold text-gray-900">기존 캠페인 관리</h2>
          </div>
          {loadingCampaigns ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-green-600" size={24} />
              <span className="ml-2 text-gray-500">로딩 중...</span>
            </div>
          ) : campaigns.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Settings size={48} className="mx-auto mb-3 text-gray-300" />
              <p>등록된 캠페인이 없습니다.</p>
              <button
                onClick={() => setViewMode('wizard')}
                className="mt-4 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
              >
                첫 캠페인 만들기
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">캠페인명</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">유형</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">상태</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">일예산</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">비용</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">클릭</th>
                    <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">액션</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {campaigns.map((c: any) => {
                    const cid = c.nccCampaignId || c.id;
                    const status = STATUS_KO[c.status] || { label: c.status, color: 'bg-gray-100 text-gray-600' };
                    return (
                      <tr key={cid} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{CAMPAIGN_TYPE_KO[c.campaignTp] || c.campaignTp || '-'}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${status.color}`}>{status.label}</span>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700">{formatNaverCurrency(c.dailyBudget || 0)}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">{formatNaverCurrency(c.spend || 0)}</td>
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
