'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Target, Zap, Upload, CheckCircle, Trash2,
  Play, Pause, ChevronDown, ChevronUp, RefreshCw, Info, X,
  Users, MapPin, Crosshair, Layers, Eye, Database, Settings, ToggleLeft, ToggleRight,
  AlertTriangle, Check, Image as ImageIcon
} from 'lucide-react';
import { Button, Input, Card, CardTitle, Select } from '@/components/ui';
import { campaignApi, creativeApi } from '@/lib/api';
import { useAppStore } from '@/store';
import type { Campaign, Creative, StrategyRecommendation, Ad, TargetingConfig, TargetingSegment, CampaignObjective, BudgetType, PublishOptions } from '@/types';
import toast from 'react-hot-toast';

// ── Campaign Objective options ──
const OBJECTIVE_OPTIONS: { value: CampaignObjective; label: string; metaValue: string; desc: string }[] = [
  { value: 'PURCHASE', label: '전환 (구매)', metaValue: 'OUTCOME_SALES', desc: '상품 구매/결제 유도' },
  { value: 'TRAFFIC', label: '트래픽', metaValue: 'OUTCOME_TRAFFIC', desc: '웹사이트 방문 유도' },
  { value: 'LEAD_GENERATION', label: '리드 생성', metaValue: 'OUTCOME_LEADS', desc: '리드/문의 수집' },
  { value: 'AWARENESS', label: '인지도', metaValue: 'OUTCOME_AWARENESS', desc: '브랜드 인지도 확대' },
  { value: 'ENGAGEMENT', label: '참여', metaValue: 'OUTCOME_ENGAGEMENT', desc: '게시물 참여 유도' },
];

// ── Dataset options ──
const DATASET_OPTIONS = [
  { value: '', label: '선택 안함' },
  { value: 'cafe24', label: '카페24 자사몰' },
  { value: 'smartstore', label: '스마트스토어' },
  { value: 'custom', label: '직접 입력' },
];

// ── Pixel options ──
const PIXEL_OPTIONS = [
  { value: 'auto', label: '자동 (Meta에서 감지)' },
  { value: 'custom', label: '직접 입력' },
];

// ── Default targeting config factory ──
const defaultTargetingConfig = (): TargetingConfig => ({
  age_range: { min_age: 18, max_age: 65 },
  genders: ['all'],
  geo: { countries: ['KR'] },
  interests: { interests: [], behaviors: [] },
});

// ── Default 3 segments ──
const createDefaultSegments = (): TargetingSegment[] => [
  {
    type: 'BROAD',
    name: '브로드',
    enabled: true,
    ratio: 40,
    targeting: defaultTargetingConfig(),
    description: '넓은 타겟팅, 관심사 제한 없음',
  },
  {
    type: 'RETARGET',
    name: '리타겟',
    enabled: true,
    ratio: 35,
    targeting: defaultTargetingConfig(),
    custom_audiences: [],
    exclusion_audiences: [],
    description: '웹사이트 방문자, 장바구니 이탈자 타겟',
  },
  {
    type: 'INTEREST',
    name: '관심사',
    enabled: true,
    ratio: 25,
    targeting: defaultTargetingConfig(),
    interests: [],
    description: '관심사 키워드 기반 타겟팅',
  },
];

export function AdsController() {
  const { selectedCreatives, setSelectedCreatives, addSelectedCreative, removeSelectedCreative, setSelectedCampaign, setActiveTab, autoPlanResult, setAutoPlanResult } = useAppStore();

  const [campaignName, setCampaignName] = useState('');
  const [objective, setObjective] = useState<CampaignObjective>('PURCHASE');
  const [budget, setBudget] = useState('');
  const [strategy, setStrategy] = useState<StrategyRecommendation | null>(null);
  const [showPlanBanner, setShowPlanBanner] = useState(false);

  // Budget type
  const [budgetType, setBudgetType] = useState<BudgetType>('DAILY');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Advantage+ settings
  const [advantagePlus, setAdvantagePlus] = useState(false);
  const [advantagePlusAudience, setAdvantagePlusAudience] = useState(false);
  const [advantagePlusCreative, setAdvantagePlusCreative] = useState(false);

  // Dataset / Pixel configuration
  const [datasetOption, setDatasetOption] = useState('');
  const [customDatasetId, setCustomDatasetId] = useState('');
  const [pixelOption, setPixelOption] = useState('auto');
  const [customPixelId, setCustomPixelId] = useState('');

  // Launch option
  const [launchImmediately, setLaunchImmediately] = useState(false);

  // Step navigation for 3-level hierarchy
  const [activeStep, setActiveStep] = useState<1 | 2 | 3>(1);

  // Targeting state
  const [showTargeting, setShowTargeting] = useState(false);
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(65);
  const [genders, setGenders] = useState<string[]>(['all']);
  const [countries, setCountries] = useState<string[]>(['KR']);
  const [interestInput, setInterestInput] = useState('');
  const [interests, setInterests] = useState<string[]>([]);

  // Targeting segments (3 types: BROAD, RETARGET, INTEREST)
  const [segments, setSegments] = useState<TargetingSegment[]>(createDefaultSegments());
  const [showAdSetPreview, setShowAdSetPreview] = useState(false);

  // Advanced settings toggle
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ── Creative management state ──
  const [showGuide, setShowGuide] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<{ name: string; progress: number }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Local copy of selected creatives for this form
  const [localSelectedCreatives, setLocalSelectedCreatives] = useState<Creative[]>(selectedCreatives);

  // Ad text configuration
  const [primaryText, setPrimaryText] = useState('');
  const [headline, setHeadline] = useState('');
  const [callToAction, setCallToAction] = useState('SHOP_NOW');
  const [linkUrl, setLinkUrl] = useState('');

  // Keep local creatives in sync with store
  useEffect(() => {
    setLocalSelectedCreatives(selectedCreatives);
  }, [selectedCreatives]);

  // Library query
  const { data: libraryCreatives = [], refetch: refetchLibrary } = useQuery({
    queryKey: ['creative-library'],
    queryFn: () => creativeApi.getLibrary(undefined, 50),
    enabled: showLibrary,
  });

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: (file: File) => creativeApi.upload(file, { name: file.name }),
    onSuccess: (creative: Creative) => {
      addSelectedCreative(creative);
      toast.success(`"${creative.name}" 업로드 완료`);
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : '소재 업로드 실패');
    },
  });

  // Handle file upload (multiple files in sequence)
  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'];
    const validFiles = fileArray.filter(f => validTypes.includes(f.type));

    if (validFiles.length === 0) {
      toast.error('지원되지 않는 파일 형식입니다. JPG, PNG, MP4, MOV를 사용하세요.');
      return;
    }

    const trackingEntries = validFiles.map(f => ({ name: f.name, progress: 0 }));
    setUploadingFiles(trackingEntries);

    for (let i = 0; i < validFiles.length; i++) {
      setUploadingFiles(prev => prev.map((entry, idx) =>
        idx === i ? { ...entry, progress: 50 } : entry
      ));
      try {
        await uploadMutation.mutateAsync(validFiles[i]);
        setUploadingFiles(prev => prev.map((entry, idx) =>
          idx === i ? { ...entry, progress: 100 } : entry
        ));
      } catch {
        setUploadingFiles(prev => prev.map((entry, idx) =>
          idx === i ? { ...entry, progress: -1 } : entry
        ));
      }
    }

    // Clear upload tracking after a short delay
    setTimeout(() => setUploadingFiles([]), 2000);
  }, [uploadMutation]);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
      e.target.value = '';
    }
  }, [handleFiles]);

  const toggleCreativeSelection = useCallback((creative: Creative) => {
    if (selectedCreatives.some(c => c.id === creative.id)) {
      removeSelectedCreative(creative.id);
    } else {
      addSelectedCreative(creative);
    }
  }, [selectedCreatives, addSelectedCreative, removeSelectedCreative]);

  const isCreativeSelected = useCallback((id: number) => {
    return selectedCreatives.some(c => c.id === id);
  }, [selectedCreatives]);

  const handleRemoveCreative = useCallback((id: number) => {
    removeSelectedCreative(id);
  }, [removeSelectedCreative]);

  // ── Computed values ──
  const campaignDays = useMemo(() => {
    if (!startDate || !endDate) return 0;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : 0;
  }, [startDate, endDate]);

  const dailyEquivalent = useMemo(() => {
    if (budgetType !== 'LIFETIME' || !budget || campaignDays <= 0) return 0;
    return Math.round(Number(budget) / campaignDays);
  }, [budgetType, budget, campaignDays]);

  const resolvedDatasetId = useMemo(() => {
    if (datasetOption === 'custom') return customDatasetId || undefined;
    if (datasetOption === '') return undefined;
    return datasetOption;
  }, [datasetOption, customDatasetId]);

  const resolvedPixelId = useMemo(() => {
    if (pixelOption === 'custom') return customPixelId || undefined;
    return undefined;
  }, [pixelOption, customPixelId]);

  const enabledSegments = segments.filter(s => s.enabled);
  const totalRatio = enabledSegments.reduce((sum, s) => sum + s.ratio, 0);

  // Auto-fill from AI plan result
  useEffect(() => {
    if (autoPlanResult) {
      const structure = autoPlanResult.campaign_structure;
      const productName = autoPlanResult.product_info?.name || '';

      // Campaign name
      const planName = structure?.campaign_name || (productName ? `${productName} 캠페인` : '');
      if (planName) setCampaignName(planName);

      // Objective
      const planObjective = structure?.objective;
      if (planObjective && OBJECTIVE_OPTIONS.some(o => o.value === planObjective)) {
        setObjective(planObjective as CampaignObjective);
      } else if (planObjective === 'CONVERSIONS') {
        setObjective('PURCHASE');
      }

      // Budget - sum from groups or use total
      const groups = structure?.groups || [];
      const totalFromGroups = groups.reduce((sum: number, g: any) => sum + (g.budget_amount || 0), 0);
      if (totalFromGroups > 0) {
        setBudget(String(totalFromGroups));
      }

      // Auto-fill targeting from plan
      const planTargeting = autoPlanResult.targeting;
      if (planTargeting) {
        if (planTargeting.segments && Array.isArray(planTargeting.segments)) {
          const planSegments: TargetingSegment[] = planTargeting.segments.map((seg: any) => ({
            type: (seg.type === 'BROAD' || seg.type === 'RETARGET' || seg.type === 'INTEREST') ? seg.type : 'BROAD',
            name: seg.name || seg.type || '세그먼트',
            enabled: true,
            ratio: seg.ratio || seg.budget_ratio || Math.floor(100 / planTargeting.segments.length),
            targeting: {
              age_range: { min_age: 18, max_age: 65 },
              genders: seg.gender ? [seg.gender] : ['all'],
              geo: { countries: ['KR'] },
              interests: { interests: seg.interests || [] },
            },
            age_range: seg.age_range || seg.age || '',
            gender: seg.gender || 'all',
            interests: seg.interests || [],
            description: seg.description || '',
          }));
          setSegments(planSegments);
          setShowTargeting(true);
        }

        if (planTargeting.age_range) {
          const ages = String(planTargeting.age_range).replace(/세/g, '').split('-');
          if (ages.length === 2) {
            setAgeMin(Math.max(parseInt(ages[0]) || 18, 13));
            setAgeMax(Math.min(parseInt(ages[1]) || 65, 65));
          }
        }
        if (planTargeting.gender) {
          setGenders([planTargeting.gender]);
        }
        if (planTargeting.interests && Array.isArray(planTargeting.interests)) {
          setInterests(planTargeting.interests);
        }
      }

      setShowPlanBanner(true);
    }
  }, [autoPlanResult]);

  const { data: campaigns, refetch: refetchCampaigns } = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => campaignApi.list(),
  });

  const strategyMutation = useMutation({
    mutationFn: () => campaignApi.getStrategy(Number(budget), selectedCreatives.length > 0 ? selectedCreatives.map((c) => c.id) : []),
    onSuccess: (data) => { setStrategy(data); toast.success('최적 전략 분석 완료'); },
    onError: () => toast.error('전략 분석 실패'),
  });

  // Build targeting config for API
  const buildTargetingConfig = () => {
    if (!showTargeting) return undefined;
    return {
      age_range: { min_age: ageMin, max_age: ageMax },
      genders,
      geo: { countries, cities: undefined },
      interests: { interests, behaviors: undefined },
      custom_audiences: undefined,
      lookalike_audiences: undefined,
    };
  };

  const createCampaignMutation = useMutation({
    mutationFn: () => campaignApi.create({
      name: campaignName || `캠페인 ${new Date().toLocaleDateString()}`,
      objective,
      total_budget: Number(budget),
      daily_budget: budgetType === 'DAILY' ? Number(budget) : (dailyEquivalent || undefined),
      budget_type: budgetType,
      creative_ids: selectedCreatives.length > 0 ? selectedCreatives.map((c) => c.id) : [],
      targeting: buildTargetingConfig(),
      targeting_segments: enabledSegments.length > 0 ? enabledSegments : undefined,
      start_date: startDate || undefined,
      end_date: endDate || undefined,
      advantage_plus: advantagePlus,
      advantage_plus_audience: advantagePlusAudience,
      advantage_plus_creative: advantagePlusCreative,
      dataset_id: resolvedDatasetId,
      pixel_id: resolvedPixelId,
      primary_text: primaryText || undefined,
      headline: headline || undefined,
      call_to_action: callToAction || undefined,
      link_url: linkUrl || undefined,
    }),
    onSuccess: () => {
      refetchCampaigns();
      toast.success('캠페인 생성 완료');
      setCampaignName('');
      setBudget('');
      setPrimaryText('');
      setHeadline('');
      setCallToAction('SHOP_NOW');
      setLinkUrl('');
      setSegments(createDefaultSegments());
      setShowTargeting(false);
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail;
      const msg = typeof detail === 'string' ? detail : '캠페인 생성 실패';
      toast.error(msg);
    },
  });

  const publishMutation = useMutation({
    mutationFn: (campaignId: number) => campaignApi.publish(campaignId, {
      campaign_id: campaignId,
      launch_immediately: launchImmediately,
      budget_type: budgetType,
      advantage_plus: advantagePlus,
      advantage_plus_audience: advantagePlusAudience,
      advantage_plus_creative: advantagePlusCreative,
      dataset_id: resolvedDatasetId,
      pixel_id: resolvedPixelId,
      currency: 'KRW',
    }),
    onSuccess: (data) => {
      if (data.success) {
        refetchCampaigns();
        toast.success(data.message || 'Meta 발행 완료');
      } else {
        toast.error(data.message || '발행 실패');
      }
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail;
      const message = err?.response?.data?.message;
      const msg = typeof detail === 'string' ? detail
        : typeof message === 'string' ? message
        : Array.isArray(detail) ? detail.map((d: any) => d.msg).join(', ')
        : err?.message || '발행 실패 - 네트워크 또는 서버 오류';
      toast.error(msg);
    },
  });

  // Publish blocker: warn if no creatives selected
  const handlePublish = (campaignId: number) => {
    if (localSelectedCreatives.length === 0) {
      if (!confirm('소재 없이 발행하면 Meta에서 광고가 게재되지 않습니다. 계속하시겠습니까?')) {
        return;
      }
    }
    publishMutation.mutate(campaignId);
  };

  const handleViewAnalytics = (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    setActiveTab(4);
  };

  const addInterest = () => {
    const trimmed = interestInput.trim();
    if (trimmed && !interests.includes(trimmed)) {
      setInterests([...interests, trimmed]);
      setInterestInput('');
    }
  };

  const removeInterest = (interest: string) => {
    setInterests(interests.filter((i) => i !== interest));
  };

  const updateSegmentRatio = (index: number, newRatio: number) => {
    const updated = [...segments];
    updated[index] = { ...updated[index], ratio: newRatio };
    setSegments(updated);
  };

  const updateSegmentName = (index: number, name: string) => {
    const updated = [...segments];
    updated[index] = { ...updated[index], name };
    setSegments(updated);
  };

  const toggleSegmentEnabled = (index: number) => {
    const updated = [...segments];
    updated[index] = { ...updated[index], enabled: !updated[index].enabled };
    setSegments(updated);
  };

  const removeSegment = (index: number) => {
    setSegments(segments.filter((_, i) => i !== index));
  };

  // Compute ad set preview based on segments + budget
  const adSetPreview = useMemo(() => {
    const active = segments.filter(s => s.enabled);
    if (active.length === 0 || !budget) return [];
    const totalBudget = Number(budget);
    const tRatio = active.reduce((sum, s) => sum + s.ratio, 0);
    const days = budgetType === 'LIFETIME' && campaignDays > 0 ? campaignDays : 7;
    return active.map((seg) => ({
      name: seg.name,
      type: seg.type,
      ratio: seg.ratio,
      dailyBudget: Math.round((totalBudget / days) * (seg.ratio / tRatio)),
      ageRange: seg.age_range || `${ageMin}-${ageMax}세`,
      gender: seg.gender || genders.join(', '),
      interests: seg.interests || interests,
      description: seg.description || '',
    }));
  }, [segments, budget, ageMin, ageMax, genders, interests, budgetType, campaignDays]);

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      {/* 캠페인 생성 - 3단계 */}
      <div className="lg:col-span-1 space-y-6">
        <Card variant="bordered">
          <CardTitle className="flex items-center gap-2 mb-4">
            <Target size={20} />
            캠페인 생성
          </CardTitle>

          {/* Step Navigation */}
          <div className="flex items-center mb-6">
            {([
              { step: 1 as const, label: '캠페인', icon: <Target size={14} /> },
              { step: 2 as const, label: '광고세트', icon: <Users size={14} /> },
              { step: 3 as const, label: '크리에이티브', icon: <ImageIcon size={14} /> },
            ]).map((s, i) => (
              <div key={s.step} className="flex items-center flex-1">
                <button
                  onClick={() => setActiveStep(s.step)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all w-full justify-center ${
                    activeStep === s.step
                      ? 'bg-blue-600 text-white shadow-sm'
                      : activeStep > s.step
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    activeStep === s.step ? 'bg-white/20' : activeStep > s.step ? 'bg-green-200' : 'bg-gray-200'
                  }`}>{s.step}</span>
                  {s.label}
                </button>
                {i < 2 && <div className={`w-4 h-0.5 mx-0.5 ${activeStep > s.step ? 'bg-green-300' : 'bg-gray-200'}`} />}
              </div>
            ))}
          </div>

          {/* AI 기획 자동 입력 배너 */}
          {showPlanBanner && autoPlanResult && (
            <div className="mb-4 p-3 bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Info size={16} className="text-purple-600 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-purple-800">AI 기획에서 자동 입력됨</p>
                    <p className="text-xs text-purple-600 mt-0.5">기획 데이터를 기반으로 자동 입력되었습니다. 수정 후 캠페인을 생성하세요.</p>
                    {autoPlanResult.overall_strategy && (
                      <p className="text-xs text-gray-600 mt-1 italic">&quot;{autoPlanResult.overall_strategy}&quot;</p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => { setShowPlanBanner(false); setAutoPlanResult(null); }}
                  className="text-gray-400 hover:text-gray-600 flex-shrink-0"
                >
                  <X size={14} />
                </button>
              </div>

              {/* 타겟 요약 from plan */}
              {enabledSegments.length > 0 && (
                <div className="mt-2 pt-2 border-t border-purple-100">
                  <p className="text-xs font-medium text-purple-700 mb-1">타겟 설계 ({enabledSegments.length}개 세그먼트):</p>
                  <div className="flex flex-wrap gap-1">
                    {enabledSegments.map((seg, i) => (
                      <span key={i} className="text-xs bg-white text-purple-700 px-2 py-0.5 rounded border border-purple-100">
                        {seg.name} {seg.ratio}%
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-4">
            {/* ═══ STEP 1: 캠페인 설정 ═══ */}
            {activeStep === 1 && (<div className="space-y-4">
            <Input label="캠페인명" placeholder="예: 봄 신상 런칭" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} />

            {/* ── 캠페인 목표 선택 (드롭다운) ── */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">캠페인 목표</label>
              <select
                value={objective}
                onChange={(e) => setObjective(e.target.value as CampaignObjective)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
              >
                {OBJECTIVE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label} ({opt.metaValue})
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                {OBJECTIVE_OPTIONS.find(o => o.value === objective)?.desc}
              </p>
            </div>

            </div>)}

            {/* ═══ STEP 3: 크리에이티브 설정 ═══ */}
            {activeStep === 3 && (<div className="space-y-4">
            {/* ══════════════════════════════════════════════════ */}
            {/* ── 소재 관리 섹션 (Creative Management) ──────── */}
            {/* ══════════════════════════════════════════════════ */}

            {/* Advantage+ Creative (AI 크리에이티브) */}
            <div
              className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                advantagePlusCreative ? 'border-purple-300 bg-purple-50' : 'border-gray-200 hover:border-gray-300'
              }`}
              onClick={() => setAdvantagePlusCreative(!advantagePlusCreative)}
            >
              <div className="flex items-center gap-2">
                {advantagePlusCreative
                  ? <ToggleRight size={20} className="text-purple-600" />
                  : <ToggleLeft size={20} className="text-gray-400" />
                }
                <div>
                  <p className="text-sm font-medium text-gray-800">Advantage+ 크리에이티브</p>
                  <p className="text-xs text-gray-500">Meta AI 이미지 생성 & 소재 최적화</p>
                </div>
              </div>
            </div>
            {advantagePlusCreative && (
              <div className="p-3 bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg border border-purple-200">
                <p className="text-xs text-purple-800 font-semibold mb-2">Advantage+ 크리에이티브 기능</p>
                <div className="space-y-1.5 text-xs text-purple-700">
                  <div className="flex items-start gap-2">
                    <span className="w-4 h-4 bg-purple-200 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 mt-0.5">1</span>
                    <span><strong>이미지 자동 생성:</strong> 업로드한 제품 이미지를 기반으로 다양한 배경/구도의 광고 이미지를 AI가 자동 생성합니다.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="w-4 h-4 bg-purple-200 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 mt-0.5">2</span>
                    <span><strong>소재 자동 최적화:</strong> 텍스트 오버레이, 이미지 향상, 음악 추가 등 Meta AI가 각 배치에 맞게 소재를 자동 최적화합니다.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="w-4 h-4 bg-purple-200 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 mt-0.5">3</span>
                    <span><strong>다이내믹 크리에이티브:</strong> 여러 이미지/영상, 텍스트, CTA 조합 중 최적 조합을 자동 테스트합니다.</span>
                  </div>
                </div>
                <p className="text-[10px] text-purple-500 mt-2 italic">* 발행 시 Meta 광고 관리자에서 Advantage+ 크리에이티브 옵션이 자동 활성화됩니다.</p>
              </div>
            )}

            {/* Meta 소재 가이드 */}
            <div className="border border-blue-200 rounded-lg">
              <button
                onClick={() => setShowGuide(!showGuide)}
                className="w-full flex items-center justify-between p-3 bg-blue-50 rounded-t-lg"
              >
                <span className="flex items-center gap-2 text-sm font-medium text-blue-800">
                  <Info size={16} /> Meta 추천 소재 가이드
                </span>
                {showGuide ? <ChevronUp size={16} className="text-blue-600" /> : <ChevronDown size={16} className="text-blue-600" />}
              </button>
              {showGuide && (
                <div className="p-4 space-y-3">
                  <div>
                    <h4 className="text-xs font-semibold text-gray-700 mb-1">피드 (Feed)</h4>
                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                      <div>이미지: 1080x1080 (1:1)</div>
                      <div>영상: 1080x1080 (1:1, 4:5)</div>
                    </div>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-gray-700 mb-1">스토리/릴스</h4>
                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                      <div>이미지: 1080x1920 (9:16)</div>
                      <div>영상: 1080x1920 (9:16, 15초 권장)</div>
                    </div>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-gray-700 mb-1">베스트 프랙티스</h4>
                    <ul className="text-xs text-gray-600 space-y-1">
                      <li>• 텍스트 비율 20% 이하 유지</li>
                      <li>• 첫 3초 내 브랜드/제품 노출</li>
                      <li>• 소재 3개 이상 등록 (Meta AI 최적화)</li>
                      <li>• 2~3주 주기로 소재 교체</li>
                      <li>• 영상 자막 필수 (85% 무음 시청)</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>

            {/* 소재 업로드 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                소재 등록
              </label>

              {/* Drag & drop zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleFileDrop}
                className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                  dragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400'
                }`}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={24} className="mx-auto text-gray-400 mb-2" />
                <p className="text-sm text-gray-600">이미지/영상 파일을 드래그하거나 클릭하여 업로드</p>
                <p className="text-xs text-gray-400 mt-1">JPG, PNG, MP4, MOV (이미지 30MB, 영상 4GB 이하)</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  hidden
                  onChange={handleFileSelect}
                />
              </div>

              {/* Upload progress */}
              {uploadingFiles.length > 0 && (
                <div className="mt-2 space-y-1">
                  {uploadingFiles.map((file, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs">
                      <span className="truncate flex-1 text-gray-600">{file.name}</span>
                      {file.progress === -1 ? (
                        <span className="text-red-500">실패</span>
                      ) : file.progress === 100 ? (
                        <span className="text-green-600 flex items-center gap-1"><Check size={12} /> 완료</span>
                      ) : (
                        <div className="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${file.progress}%` }} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 소재 라이브러리 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-700">소재 라이브러리</label>
                <button
                  onClick={() => { setShowLibrary(!showLibrary); if (!showLibrary) refetchLibrary(); }}
                  className="text-xs text-blue-600 hover:text-blue-700"
                >
                  {showLibrary ? '접기' : '라이브러리에서 선택'}
                </button>
              </div>

              {showLibrary && (
                <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-2">
                  {libraryCreatives.length > 0 ? (
                    <div className="grid grid-cols-4 gap-2">
                      {libraryCreatives.map((creative: Creative) => (
                        <div
                          key={creative.id}
                          onClick={() => toggleCreativeSelection(creative)}
                          className={`relative rounded-lg overflow-hidden cursor-pointer border-2 transition-colors ${
                            isCreativeSelected(creative.id) ? 'border-blue-500' : 'border-transparent hover:border-gray-300'
                          }`}
                        >
                          {(creative.thumbnail_url || creative.file_url) ? (
                            <img src={creative.thumbnail_url || creative.file_url} alt={creative.name} className="w-full h-16 object-cover" />
                          ) : (
                            <div className="w-full h-16 bg-gray-100 flex items-center justify-center">
                              <ImageIcon size={16} className="text-gray-400" />
                            </div>
                          )}
                          {isCreativeSelected(creative.id) && (
                            <div className="absolute top-1 right-1 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                              <Check size={12} className="text-white" />
                            </div>
                          )}
                          <p className="text-[10px] text-gray-600 truncate p-1">{creative.name}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 text-center py-4">라이브러리에 소재가 없습니다. 위에서 파일을 업로드하세요.</p>
                  )}
                </div>
              )}
            </div>

            {/* 선택된 소재 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                선택된 소재 ({localSelectedCreatives.length}개)
                {localSelectedCreatives.length > 0 && localSelectedCreatives.length < 3 && (
                  <span className="text-orange-500 text-xs ml-2">
                    (Meta 권장: 3개 이상)
                  </span>
                )}
              </label>

              {localSelectedCreatives.length === 0 ? (
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className="text-yellow-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-yellow-800">소재를 등록해주세요</p>
                      <p className="text-xs text-yellow-600 mt-0.5">
                        캠페인에 소재가 없으면 Meta에서 광고가 게재되지 않습니다.
                        위에서 파일을 업로드하거나 라이브러리에서 선택하세요.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {localSelectedCreatives.map((creative) => (
                    <div key={creative.id} className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg border border-gray-200">
                      <div className="w-12 h-12 rounded overflow-hidden bg-gray-200 flex-shrink-0">
                        {(creative.thumbnail_url || creative.file_url) ? (
                          <img src={creative.thumbnail_url || creative.file_url} alt={creative.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <ImageIcon size={16} className="text-gray-400" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{creative.name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">
                            {creative.creative_type === 'VIDEO' ? '영상' : '이미지'}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
                            {creative.format}
                          </span>
                        </div>
                      </div>
                      <button onClick={() => handleRemoveCreative(creative.id)} className="text-gray-400 hover:text-red-500 flex-shrink-0">
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 광고 텍스트 설정 */}
            {localSelectedCreatives.length > 0 && (
              <div className="space-y-3">
                <label className="block text-sm font-medium text-gray-700">광고 텍스트</label>
                <div className="space-y-2">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      광고 문구 <span className="text-gray-400">(125자 권장)</span>
                    </label>
                    <textarea
                      value={primaryText}
                      onChange={(e) => setPrimaryText(e.target.value)}
                      placeholder="제품/서비스의 핵심 메시지를 입력하세요"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      rows={3}
                      maxLength={2200}
                    />
                    <p className={`text-xs mt-0.5 ${primaryText.length > 125 ? 'text-orange-500' : 'text-gray-400'}`}>
                      {primaryText.length}/125 (최대 2,200)
                    </p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      제목 <span className="text-gray-400">(40자 권장)</span>
                    </label>
                    <input
                      value={headline}
                      onChange={(e) => setHeadline(e.target.value)}
                      placeholder="매력적인 제목을 입력하세요"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      maxLength={255}
                    />
                    <p className={`text-xs mt-0.5 ${headline.length > 40 ? 'text-orange-500' : 'text-gray-400'}`}>
                      {headline.length}/40 (최대 255)
                    </p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">CTA 버튼</label>
                    <select
                      value={callToAction}
                      onChange={(e) => setCallToAction(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    >
                      <option value="SHOP_NOW">지금 쇼핑하기</option>
                      <option value="LEARN_MORE">자세히 알아보기</option>
                      <option value="SIGN_UP">가입하기</option>
                      <option value="ORDER_NOW">지금 주문하기</option>
                      <option value="BUY_NOW">지금 구매</option>
                      <option value="GET_OFFER">혜택 받기</option>
                      <option value="BOOK_NOW">지금 예약하기</option>
                      <option value="CONTACT_US">문의하기</option>
                      <option value="SUBSCRIBE">구독하기</option>
                      <option value="WATCH_MORE">더 보기</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">랜딩 URL</label>
                    <input
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      placeholder="https://your-shop.com/product"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      type="url"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ══════════════════════════════════════════════════ */}
            {/* ── 소재 관리 섹션 끝 ─────────────────────────── */}
            {/* ══════════════════════════════════════════════════ */}

            {/* Step 3 navigation */}
            <div className="flex justify-between pt-2">
              <button onClick={() => setActiveStep(2)}
                className="flex items-center gap-1.5 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">
                <ChevronUp size={14} /> 이전: 광고세트
              </button>
            </div>
            </div>)}

            {/* ═══ STEP 1 (계속): 예산/Advantage+/데이터셋 ═══ */}
            {activeStep === 1 && (<div className="space-y-4">
            {/* ── 예산 유형 선택 ── */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">예산 유형</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setBudgetType('DAILY')}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    budgetType === 'DAILY'
                      ? 'bg-primary-500 text-white'
                      : 'bg-white border border-gray-300 text-gray-600 hover:border-primary-300'
                  }`}
                >
                  일일 예산
                </button>
                <button
                  onClick={() => setBudgetType('LIFETIME')}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    budgetType === 'LIFETIME'
                      ? 'bg-primary-500 text-white'
                      : 'bg-white border border-gray-300 text-gray-600 hover:border-primary-300'
                  }`}
                >
                  총 예산
                </button>
              </div>
            </div>

            {/* ── 예산 입력 ── */}
            <Input
              label={budgetType === 'DAILY' ? '일일 예산 (KRW)' : '총 예산 (KRW)'}
              type="number"
              placeholder={budgetType === 'DAILY' ? '100,000' : '1,000,000'}
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              leftIcon={<span className="text-sm font-medium">{'\u20A9'}</span>}
            />

            {/* ── 총 예산 선택 시 기간 + 일일 환산 ── */}
            {budgetType === 'LIFETIME' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">시작일</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">종료일</label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>
                </div>
                {budget && campaignDays > 0 && (
                  <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-blue-700">일일 환산 예산</span>
                      <span className="font-semibold text-blue-800">{'\u20A9'}{dailyEquivalent.toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-blue-600 mt-1">
                      {'\u20A9'}{Number(budget).toLocaleString()} / {campaignDays}일 = 일일 {'\u20A9'}{dailyEquivalent.toLocaleString()}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ── 어드밴티지+ 설정 ── */}
            <div className="space-y-3">
              <div
                className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                  advantagePlus ? 'border-green-300 bg-green-50' : 'border-gray-200 hover:border-gray-300'
                }`}
                onClick={() => setAdvantagePlus(!advantagePlus)}
              >
                <div className="flex items-center gap-2">
                  {advantagePlus
                    ? <ToggleRight size={20} className="text-green-600" />
                    : <ToggleLeft size={20} className="text-gray-400" />
                  }
                  <div>
                    <p className="text-sm font-medium text-gray-800">어드밴티지+ 캠페인</p>
                    <p className="text-xs text-gray-500">Meta AI가 최적화 자동 수행</p>
                  </div>
                </div>
              </div>
              {advantagePlus && (
                <div className="ml-4 p-2.5 bg-green-50 rounded-lg border border-green-100">
                  <p className="text-xs text-green-700">
                    어드밴티지+ 캠페인이 활성화되면 Meta의 AI가 타겟팅, 배치, 예산을 자동으로 최적화합니다.
                    수동 타겟팅 설정보다 더 넓은 도달 범위를 확보할 수 있습니다.
                  </p>
                </div>
              )}

              <div
                className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                  advantagePlusAudience ? 'border-green-300 bg-green-50' : 'border-gray-200 hover:border-gray-300'
                }`}
                onClick={() => setAdvantagePlusAudience(!advantagePlusAudience)}
              >
                <div className="flex items-center gap-2">
                  {advantagePlusAudience
                    ? <ToggleRight size={20} className="text-green-600" />
                    : <ToggleLeft size={20} className="text-gray-400" />
                  }
                  <div>
                    <p className="text-sm font-medium text-gray-800">어드밴티지+ 오디언스</p>
                    <p className="text-xs text-gray-500">오디언스 확장 자동 최적화</p>
                  </div>
                </div>
              </div>
              {advantagePlusAudience && (
                <div className="ml-4 p-2.5 bg-green-50 rounded-lg border border-green-100">
                  <p className="text-xs text-green-700">
                    어드밴티지+ 오디언스를 사용하면 설정한 타겟 외에도 전환 가능성이 높은 사용자에게 광고가 노출됩니다.
                    기존 타겟팅은 참고 신호로 활용됩니다.
                  </p>
                </div>
              )}
            </div>

            {/* Step 1 navigation */}
            <div className="flex justify-end pt-2">
              <button onClick={() => setActiveStep(2)}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
                다음: 광고세트 설정 <ChevronDown size={14} className="rotate-[-90deg]" />
              </button>
            </div>
            </div>)}

            {/* ═══ STEP 2: 광고세트 설정 ═══ */}
            {activeStep === 2 && (<div className="space-y-4">
            {/* ── 타겟팅 설정 토글 ── */}
            <div>
              <button
                onClick={() => setShowTargeting(!showTargeting)}
                className="flex items-center gap-2 w-full p-3 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors text-left"
              >
                <Crosshair size={16} className="text-blue-500" />
                <span className="text-sm font-medium text-gray-700 flex-1">타겟팅 설정</span>
                {enabledSegments.length > 0 && (
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{enabledSegments.length}개 세그먼트</span>
                )}
                {showTargeting ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
              </button>

              {showTargeting && (
                <div className="mt-3 p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-4">
                  {/* 연령 */}
                  <div>
                    <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-2">
                      <Users size={14} /> 연령
                    </label>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1">
                        <input
                          type="text" inputMode="numeric" pattern="[0-9]*"
                          value={ageMin}
                          onChange={(e) => {
                            const v = e.target.value.replace(/[^0-9]/g, '');
                            if (v === '') return;
                            setAgeMin(Math.max(13, Math.min(Number(v), ageMax)));
                          }}
                          onBlur={(e) => {
                            const v = Number(e.target.value) || 18;
                            setAgeMin(Math.max(13, Math.min(v, ageMax)));
                          }}
                          className="w-16 px-2 py-1.5 border border-gray-300 rounded text-sm text-center"
                        />
                        <span className="text-sm text-gray-500">세</span>
                      </div>
                      <span className="text-gray-400">~</span>
                      <div className="flex items-center gap-1">
                        <input
                          type="text" inputMode="numeric" pattern="[0-9]*"
                          value={ageMax}
                          onChange={(e) => {
                            const v = e.target.value.replace(/[^0-9]/g, '');
                            if (v === '') return;
                            setAgeMax(Math.min(65, Math.max(Number(v), ageMin)));
                          }}
                          onBlur={(e) => {
                            const v = Number(e.target.value) || 65;
                            setAgeMax(Math.min(65, Math.max(v, ageMin)));
                          }}
                          className="w-16 px-2 py-1.5 border border-gray-300 rounded text-sm text-center"
                        />
                        <span className="text-sm text-gray-500">세</span>
                      </div>
                    </div>
                  </div>

                  {/* 성별 */}
                  <div>
                    <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-2">
                      <Users size={14} /> 성별
                    </label>
                    <div className="flex gap-2">
                      {[
                        { value: 'all', label: '전체' },
                        { value: 'male', label: '남성' },
                        { value: 'female', label: '여성' },
                      ].map((g) => (
                        <button
                          key={g.value}
                          onClick={() => setGenders([g.value])}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                            genders.includes(g.value)
                              ? 'bg-blue-500 text-white'
                              : 'bg-white border border-gray-300 text-gray-600 hover:border-blue-300'
                          }`}
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 지역 */}
                  <div>
                    <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-2">
                      <MapPin size={14} /> 지역
                    </label>
                    <div className="flex gap-2">
                      {[
                        { value: 'KR', label: '한국' },
                        { value: 'US', label: '미국' },
                        { value: 'JP', label: '일본' },
                      ].map((c) => (
                        <button
                          key={c.value}
                          onClick={() => {
                            if (countries.includes(c.value)) {
                              setCountries(countries.filter((cc) => cc !== c.value));
                            } else {
                              setCountries([...countries, c.value]);
                            }
                          }}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                            countries.includes(c.value)
                              ? 'bg-blue-500 text-white'
                              : 'bg-white border border-gray-300 text-gray-600 hover:border-blue-300'
                          }`}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 관심사 */}
                  <div>
                    <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-2">
                      <Layers size={14} /> 관심사
                    </label>
                    <div className="flex gap-2 mb-2">
                      <input
                        type="text"
                        placeholder="관심사 입력 (예: 패션, 뷰티)"
                        value={interestInput}
                        onChange={(e) => setInterestInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addInterest())}
                        className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                      />
                      <button
                        onClick={addInterest}
                        className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600"
                      >
                        추가
                      </button>
                    </div>
                    {interests.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {interests.map((interest, i) => (
                          <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs">
                            {interest}
                            <button onClick={() => removeInterest(interest)} className="hover:text-red-500">
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* ── 광고세트 세그먼트 (3 types: BROAD, RETARGET, INTEREST) ── */}
                  <div className="pt-3 border-t border-gray-200">
                    <div className="flex items-center justify-between mb-3">
                      <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
                        <Layers size={14} /> 광고세트 세그먼트
                      </label>
                      <button
                        onClick={() => setShowAdSetPreview(!showAdSetPreview)}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                      >
                        <Eye size={12} /> 미리보기
                      </button>
                    </div>

                    <div className="space-y-3">
                      {segments.map((seg, i) => (
                        <div key={i} className={`p-3 rounded-lg border transition-colors ${
                          seg.enabled ? 'bg-white border-gray-200' : 'bg-gray-100 border-gray-200 opacity-60'
                        }`}>
                          {/* Header: toggle + name + type badge + remove */}
                          <div className="flex items-center gap-2 mb-2">
                            <button
                              onClick={() => toggleSegmentEnabled(i)}
                              className="flex-shrink-0"
                            >
                              {seg.enabled
                                ? <ToggleRight size={20} className="text-green-500" />
                                : <ToggleLeft size={20} className="text-gray-400" />
                              }
                            </button>
                            <input
                              type="text"
                              value={seg.name}
                              onChange={(e) => updateSegmentName(i, e.target.value)}
                              className="flex-1 text-sm font-medium text-gray-800 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-400 focus:outline-none px-1 py-0.5"
                            />
                            <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                              seg.type === 'BROAD' ? 'bg-purple-100 text-purple-700'
                              : seg.type === 'RETARGET' ? 'bg-orange-100 text-orange-700'
                              : 'bg-teal-100 text-teal-700'
                            }`}>
                              {seg.type === 'BROAD' ? '브로드' : seg.type === 'RETARGET' ? '리타겟' : '관심사'}
                            </span>
                            <button onClick={() => removeSegment(i)} className="text-gray-400 hover:text-red-500 flex-shrink-0">
                              <X size={14} />
                            </button>
                          </div>

                          {seg.enabled && (
                            <>
                              {/* Description */}
                              {seg.description && (
                                <p className="text-xs text-gray-500 mb-2 italic">{seg.description}</p>
                              )}

                              {/* Budget ratio slider */}
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-xs text-gray-500 w-8">비중:</span>
                                <input
                                  type="range" min={5} max={80} value={seg.ratio}
                                  onChange={(e) => updateSegmentRatio(i, Number(e.target.value))}
                                  className="flex-1 h-1.5 accent-blue-500"
                                />
                                <span className="text-xs font-medium text-blue-600 w-10 text-right">{seg.ratio}%</span>
                              </div>

                              {/* Type-specific settings */}
                              {seg.type === 'BROAD' && (
                                <div className="text-xs text-gray-500 p-2 bg-purple-50 rounded">
                                  <p>넓은 타겟팅 - 관심사/행동 제한 없이 최대 도달</p>
                                  {advantagePlusAudience && (
                                    <p className="text-green-600 mt-1">어드밴티지+ 오디언스 활성화됨</p>
                                  )}
                                </div>
                              )}

                              {seg.type === 'RETARGET' && (
                                <div className="space-y-2">
                                  <div className="p-2 bg-orange-50 rounded">
                                    <p className="text-xs font-medium text-orange-700 mb-1">커스텀 오디언스</p>
                                    <div className="flex flex-wrap gap-1">
                                      {['웹사이트 방문자', '장바구니 이탈자', '영상 시청자'].map((audience) => (
                                        <label key={audience} className="inline-flex items-center gap-1 text-xs bg-white px-2 py-1 rounded border border-orange-100 cursor-pointer hover:border-orange-300">
                                          <input
                                            type="checkbox"
                                            checked={seg.custom_audiences?.includes(audience) || false}
                                            onChange={(e) => {
                                              const updated = [...segments];
                                              const current = updated[i].custom_audiences || [];
                                              updated[i] = {
                                                ...updated[i],
                                                custom_audiences: e.target.checked
                                                  ? [...current, audience]
                                                  : current.filter(a => a !== audience),
                                              };
                                              setSegments(updated);
                                            }}
                                            className="w-3 h-3"
                                          />
                                          {audience}
                                        </label>
                                      ))}
                                    </div>
                                  </div>
                                  <div className="p-2 bg-red-50 rounded">
                                    <p className="text-xs font-medium text-red-700 mb-1">제외 오디언스</p>
                                    <div className="flex flex-wrap gap-1">
                                      {['구매 완료자', '기존 고객'].map((audience) => (
                                        <label key={audience} className="inline-flex items-center gap-1 text-xs bg-white px-2 py-1 rounded border border-red-100 cursor-pointer hover:border-red-300">
                                          <input
                                            type="checkbox"
                                            checked={seg.exclusion_audiences?.includes(audience) || false}
                                            onChange={(e) => {
                                              const updated = [...segments];
                                              const current = updated[i].exclusion_audiences || [];
                                              updated[i] = {
                                                ...updated[i],
                                                exclusion_audiences: e.target.checked
                                                  ? [...current, audience]
                                                  : current.filter(a => a !== audience),
                                              };
                                              setSegments(updated);
                                            }}
                                            className="w-3 h-3"
                                          />
                                          {audience}
                                        </label>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              )}

                              {seg.type === 'INTEREST' && (
                                <div className="p-2 bg-teal-50 rounded">
                                  <p className="text-xs font-medium text-teal-700 mb-1">관심사 키워드</p>
                                  <div className="flex gap-1 mb-1">
                                    <input
                                      type="text"
                                      placeholder="관심사 입력 후 Enter"
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault();
                                          const val = (e.target as HTMLInputElement).value.trim();
                                          if (val) {
                                            const updated = [...segments];
                                            const current = updated[i].interests || [];
                                            if (!current.includes(val)) {
                                              updated[i] = { ...updated[i], interests: [...current, val] };
                                              setSegments(updated);
                                            }
                                            (e.target as HTMLInputElement).value = '';
                                          }
                                        }
                                      }}
                                      className="flex-1 px-2 py-1 border border-teal-200 rounded text-xs"
                                    />
                                  </div>
                                  {seg.interests && seg.interests.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                      {seg.interests.map((interest, j) => (
                                        <span key={j} className="inline-flex items-center gap-0.5 text-xs bg-white text-teal-700 px-1.5 py-0.5 rounded border border-teal-100">
                                          {interest}
                                          <button onClick={() => {
                                            const updated = [...segments];
                                            updated[i] = {
                                              ...updated[i],
                                              interests: (updated[i].interests || []).filter((_, k) => k !== j),
                                            };
                                            setSegments(updated);
                                          }} className="hover:text-red-500">
                                            <X size={10} />
                                          </button>
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Segment-level schedule override */}
                              <details className="mt-2">
                                <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">세그먼트별 일정 설정</summary>
                                <div className="grid grid-cols-2 gap-2 mt-1.5">
                                  <div>
                                    <label className="text-xs text-gray-500">시작일</label>
                                    <input
                                      type="date"
                                      value={seg.start_date || ''}
                                      onChange={(e) => {
                                        const updated = [...segments];
                                        updated[i] = { ...updated[i], start_date: e.target.value };
                                        setSegments(updated);
                                      }}
                                      className="w-full px-2 py-1 border border-gray-200 rounded text-xs"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-xs text-gray-500">종료일</label>
                                    <input
                                      type="date"
                                      value={seg.end_date || ''}
                                      onChange={(e) => {
                                        const updated = [...segments];
                                        updated[i] = { ...updated[i], end_date: e.target.value };
                                        setSegments(updated);
                                      }}
                                      className="w-full px-2 py-1 border border-gray-200 rounded text-xs"
                                    />
                                  </div>
                                </div>
                              </details>
                            </>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* 비중 합계 경고 */}
                    {enabledSegments.length > 0 && totalRatio !== 100 && (
                      <p className={`text-xs mt-2 ${totalRatio > 100 ? 'text-red-600' : 'text-amber-600'}`}>
                        세그먼트 비중 합계: {totalRatio}% (100%와 다릅니다. 발행 시 비율 기준으로 자동 배분됩니다.)
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ── 광고세트 미리보기 ── */}
            {showAdSetPreview && adSetPreview.length > 0 && (
              <div className="p-4 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg border border-indigo-200">
                <div className="flex items-center gap-2 mb-3">
                  <Eye size={16} className="text-indigo-600" />
                  <p className="text-sm font-medium text-indigo-800">광고세트 미리보기</p>
                </div>
                <p className="text-xs text-indigo-600 mb-3">Meta 발행 시 아래와 같이 광고세트가 생성됩니다.</p>
                <div className="space-y-2">
                  {adSetPreview.map((preset, i) => (
                    <div key={i} className="p-3 bg-white rounded-lg border border-indigo-100">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold text-gray-800">{preset.name}</span>
                        <div className="flex items-center gap-1">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            preset.type === 'BROAD' ? 'bg-purple-100 text-purple-700'
                            : preset.type === 'RETARGET' ? 'bg-orange-100 text-orange-700'
                            : 'bg-teal-100 text-teal-700'
                          }`}>{preset.type === 'BROAD' ? '브로드' : preset.type === 'RETARGET' ? '리타겟' : '관심사'}</span>
                          <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded">{preset.ratio}%</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-gray-600">
                        <span>일 예산: {'\u20A9'}{preset.dailyBudget.toLocaleString()}</span>
                        <span>연령: {preset.ageRange}</span>
                        <span>성별: {preset.gender === 'all' ? '전체' : preset.gender === 'male' ? '남성' : preset.gender === 'female' ? '여성' : preset.gender}</span>
                        {preset.interests.length > 0 && (
                          <span className="col-span-2">관심사: {preset.interests.slice(0, 3).join(', ')}{preset.interests.length > 3 ? ` 외 ${preset.interests.length - 3}개` : ''}</span>
                        )}
                      </div>
                      {preset.description && (
                        <p className="text-xs text-gray-400 mt-1 italic">{preset.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── 데이터셋 / 픽셀 설정 (고급) ── */}
            <div>
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 w-full p-3 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors text-left"
              >
                <Database size={16} className="text-gray-500" />
                <span className="text-sm font-medium text-gray-700 flex-1">데이터셋 / 픽셀 설정</span>
                {showAdvanced ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
              </button>

              {showAdvanced && (
                <div className="mt-3 p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-4">
                  {/* 데이터셋 선택 */}
                  <div>
                    <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-2">
                      <Database size={14} /> 데이터셋 선택
                    </label>
                    <select
                      value={datasetOption}
                      onChange={(e) => setDatasetOption(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                    >
                      {DATASET_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    {datasetOption === 'custom' && (
                      <input
                        type="text"
                        placeholder="데이터셋 ID 입력"
                        value={customDatasetId}
                        onChange={(e) => setCustomDatasetId(e.target.value)}
                        className="w-full mt-2 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    )}
                    {datasetOption === 'cafe24' && (
                      <p className="text-xs text-gray-500 mt-1">카페24 자사몰 데이터셋이 자동으로 연결됩니다.</p>
                    )}
                    {datasetOption === 'smartstore' && (
                      <p className="text-xs text-gray-500 mt-1">스마트스토어 데이터셋이 자동으로 연결됩니다.</p>
                    )}
                  </div>

                  {/* 픽셀 ID */}
                  <div>
                    <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-2">
                      <Settings size={14} /> 픽셀 ID
                    </label>
                    <select
                      value={pixelOption}
                      onChange={(e) => setPixelOption(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                    >
                      {PIXEL_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    {pixelOption === 'custom' && (
                      <input
                        type="text"
                        placeholder="Meta 픽셀 ID 입력"
                        value={customPixelId}
                        onChange={(e) => setCustomPixelId(e.target.value)}
                        className="w-full mt-2 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    )}
                    {pixelOption === 'auto' && (
                      <p className="text-xs text-gray-500 mt-1">Meta 광고 계정에 연결된 픽셀이 자동으로 감지됩니다.</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Step 2 navigation */}
            <div className="flex justify-between pt-2">
              <button onClick={() => setActiveStep(1)}
                className="flex items-center gap-1.5 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">
                <ChevronUp size={14} /> 이전: 캠페인
              </button>
              <button onClick={() => setActiveStep(3)}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
                다음: 크리에이티브 <ChevronDown size={14} className="rotate-[-90deg]" />
              </button>
            </div>
            </div>)}

            {/* ═══ 공통: AI 전략 + 발행 ═══ */}
            <Button variant="outline" className="w-full" onClick={() => strategyMutation.mutate()}
              loading={strategyMutation.isPending} disabled={!budget}>
              <Zap size={16} className="mr-2" /> AI 전략 추천
            </Button>

            {strategy && (
              <div className="p-4 bg-gradient-to-r from-blue-50 to-green-50 rounded-lg space-y-2">
                <p className="text-sm font-medium text-gray-900">AI 추천 전략</p>
                <p className="text-sm text-gray-700">{strategy.reasoning}</p>
                <div className="text-sm space-y-1">
                  <p><span className="font-medium">타겟:</span> {strategy.target_audience_summary}</p>
                  <p><span className="font-medium">예상 도달:</span> {strategy.expected_reach.toLocaleString()}명</p>
                  <p><span className="font-medium">예상 CTR:</span> {strategy.expected_ctr.toFixed(1)}%</p>
                </div>
                <div className="mt-2 space-y-1">
                  {strategy.allocations.map((a, i) => (
                    <div key={i} className="flex justify-between text-xs bg-white/60 px-2 py-1 rounded">
                      <span>{a.creative_name}</span>
                      <span className="font-medium">{a.allocation_percentage}% - {a.recommended_placement}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── 발행 옵션 ── */}
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-sm font-medium text-gray-700 mb-2">발행 옵션</p>
              <div className="space-y-2">
                <label className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                  !launchImmediately ? 'border-primary-300 bg-primary-50' : 'border-gray-200 hover:border-gray-300'
                }`}>
                  <input
                    type="radio"
                    name="launchOption"
                    checked={!launchImmediately}
                    onChange={() => setLaunchImmediately(false)}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium">검토 후 발행</p>
                    <p className="text-xs text-gray-500">캠페인을 PAUSED 상태로 생성 (기본값)</p>
                  </div>
                </label>
                <label className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                  launchImmediately ? 'border-green-300 bg-green-50' : 'border-gray-200 hover:border-gray-300'
                }`}>
                  <input
                    type="radio"
                    name="launchOption"
                    checked={launchImmediately}
                    onChange={() => setLaunchImmediately(true)}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium">즉시 발행</p>
                    <p className="text-xs text-gray-500">캠페인을 ACTIVE 상태로 즉시 시작</p>
                  </div>
                </label>
              </div>
            </div>

            <Button className="w-full" onClick={() => createCampaignMutation.mutate()}
              loading={createCampaignMutation.isPending} disabled={!budget}>
              캠페인 생성
            </Button>
          </div>
        </Card>
      </div>

      {/* 캠페인 목록 + 관리 */}
      <div className="lg:col-span-2">
        <Card variant="bordered">
          <div className="flex items-center justify-between mb-4">
            <CardTitle>내 캠페인</CardTitle>
            <button onClick={() => refetchCampaigns()} className="text-gray-400 hover:text-gray-600">
              <RefreshCw size={16} />
            </button>
          </div>

          {campaigns && campaigns.length > 0 ? (
            <div className="space-y-4">
              {campaigns.map((campaign) => (
                <CampaignCard
                  key={campaign.id}
                  campaign={campaign}
                  onPublish={() => handlePublish(campaign.id)}
                  onViewAnalytics={() => handleViewAnalytics(campaign)}
                  isPublishing={publishMutation.isPending}
                  onRefresh={refetchCampaigns}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-16 text-gray-400">
              <Target size={48} className="mx-auto mb-3 opacity-50" />
              <p>아직 생성된 캠페인이 없습니다</p>
              <p className="text-sm mt-1">소재를 선택하고 캠페인을 생성해보세요</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ── Objective label helper ──
const objectiveLabel = (obj: string): string => {
  const map: Record<string, string> = {
    TRAFFIC: '트래픽',
    CONVERSIONS: '전환',
    PURCHASE: '전환 (구매)',
    LEAD_GENERATION: '리드',
    AWARENESS: '인지도',
    ENGAGEMENT: '참여',
  };
  return map[obj] || obj;
};

function CampaignCard({
  campaign, onPublish, onViewAnalytics, isPublishing, onRefresh,
}: {
  campaign: Campaign; onPublish: () => void; onViewAnalytics: () => void;
  isPublishing: boolean; onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editBudget, setEditBudget] = useState('');

  const activateMutation = useMutation({
    mutationFn: () => campaignApi.activate(campaign.id),
    onSuccess: () => { onRefresh(); toast.success('캠페인 활성화됨'); },
    onError: () => toast.error('활성화 실패'),
  });

  const pauseMutation = useMutation({
    mutationFn: () => campaignApi.pause(campaign.id),
    onSuccess: () => { onRefresh(); toast.success('캠페인 일시정지됨'); },
    onError: () => toast.error('일시정지 실패'),
  });

  const budgetMutation = useMutation({
    mutationFn: () => campaignApi.updateBudget(campaign.id, undefined, Number(editBudget)),
    onSuccess: () => { onRefresh(); toast.success('예산 변경됨'); setEditBudget(''); },
    onError: () => toast.error('예산 변경 실패'),
  });

  const toggleAdMutation = useMutation({
    mutationFn: ({ adId, action }: { adId: number; action: 'activate' | 'pause' }) =>
      campaignApi.toggleAd(campaign.id, adId, action),
    onSuccess: () => { onRefresh(); toast.success('광고 상태 변경됨'); },
    onError: () => toast.error('상태 변경 실패'),
  });

  const syncMutation = useMutation({
    mutationFn: () => campaignApi.syncInsights(campaign.id),
    onSuccess: () => { onRefresh(); toast.success('인사이트 동기화 완료'); },
    onError: () => toast.error('동기화 실패'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => campaignApi.delete(campaign.id),
    onSuccess: () => { onRefresh(); toast.success('캠페인이 삭제되었습니다'); },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : '삭제 실패');
    },
  });

  const handleDelete = () => {
    if (window.confirm(`"${campaign.name}" 캠페인을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) {
      deleteMutation.mutate();
    }
  };

  const statusConfig: Record<string, { color: string; label: string }> = {
    DRAFT: { color: 'bg-gray-100 text-gray-700', label: '초안' },
    PENDING_REVIEW: { color: 'bg-yellow-100 text-yellow-700', label: '검토 대기' },
    ACTIVE: { color: 'bg-green-100 text-green-700', label: '진행중' },
    PAUSED: { color: 'bg-orange-100 text-orange-700', label: '일시정지' },
    COMPLETED: { color: 'bg-blue-100 text-blue-700', label: '완료' },
  };

  const sc = statusConfig[campaign.status] || statusConfig.DRAFT;
  const spentPct = campaign.total_budget > 0 ? (campaign.spent_amount / campaign.total_budget) * 100 : 0;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-medium text-gray-900">{campaign.name}</h3>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${sc.color}`}>{sc.label}</span>
              {campaign.meta_campaign_id && (
                <span className="flex items-center gap-1 text-xs text-green-600">
                  <CheckCircle size={12} /> Meta
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500">
              {objectiveLabel(campaign.objective)}
              {campaign.budget_type === 'LIFETIME' ? ' (총 예산)' : ' (일일)'}
              {' - '}{(campaign.ads || []).length}개 광고
              {campaign.advantage_plus && <span className="ml-1 text-xs text-green-600">[A+]</span>}
            </p>
          </div>
          <button onClick={() => setExpanded(!expanded)} className="text-gray-400 hover:text-gray-600 p-1">
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>

        {/* 예산 진행바 */}
        <div className="mb-3">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-500">{'\u20A9'}{campaign.spent_amount.toLocaleString()} / {'\u20A9'}{campaign.total_budget.toLocaleString()}</span>
            <span className="font-medium">{spentPct.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-primary-500 rounded-full transition-all" style={{ width: `${Math.min(spentPct, 100)}%` }} />
          </div>
        </div>

        {/* 타겟팅 요약 */}
        {campaign.targeting && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
              <Users size={10} /> {campaign.targeting.age_range.min_age}-{campaign.targeting.age_range.max_age}세
            </span>
            <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
              {campaign.targeting.genders.includes('all') ? '전체' : campaign.targeting.genders.includes('male') ? '남성' : '여성'}
            </span>
            {campaign.targeting.geo?.countries && (
              <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                <MapPin size={10} /> {campaign.targeting.geo.countries.join(', ')}
              </span>
            )}
            {campaign.targeting.interests?.interests && campaign.targeting.interests.interests.length > 0 && (
              <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                <Layers size={10} /> {campaign.targeting.interests.interests.slice(0, 2).join(', ')}
                {campaign.targeting.interests.interests.length > 2 && ` +${campaign.targeting.interests.interests.length - 2}`}
              </span>
            )}
          </div>
        )}

        {/* 액션 버튼 */}
        <div className="flex flex-wrap gap-2">
          {campaign.status === 'DRAFT' && (
            <Button size="sm" onClick={onPublish} loading={isPublishing}>
              <Upload size={14} className="mr-1" /> Meta 발행
            </Button>
          )}
          {campaign.status === 'ACTIVE' && (
            <Button size="sm" variant="outline" onClick={() => pauseMutation.mutate()} loading={pauseMutation.isPending}>
              <Pause size={14} className="mr-1" /> 일시정지
            </Button>
          )}
          {campaign.status === 'PAUSED' && (
            <Button size="sm" onClick={() => activateMutation.mutate()} loading={activateMutation.isPending}>
              <Play size={14} className="mr-1" /> 재개
            </Button>
          )}
          {(campaign.status === 'ACTIVE' || campaign.status === 'PAUSED') && (
            <>
              <Button size="sm" variant="outline" onClick={() => syncMutation.mutate()} loading={syncMutation.isPending}>
                <RefreshCw size={14} className="mr-1" /> 인사이트 동기화
              </Button>
              <Button size="sm" variant="outline" onClick={onViewAnalytics}>
                성과 분석
              </Button>
            </>
          )}
          {(campaign.status === 'DRAFT' || campaign.status === 'COMPLETED') && (
            <Button size="sm" variant="outline" onClick={handleDelete} loading={deleteMutation.isPending}
              className="text-red-600 border-red-200 hover:bg-red-50">
              <Trash2 size={14} className="mr-1" /> 삭제
            </Button>
          )}
        </div>
      </div>

      {/* 확장 영역: 타겟팅 상세 + 예산 변경 + 광고 ON/OFF */}
      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50 p-4 space-y-4">
          {/* 타겟팅 상세 */}
          {campaign.targeting && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                <Crosshair size={14} /> 타겟팅 설정
              </p>
              <div className="grid grid-cols-2 gap-3 p-3 bg-white rounded-lg border border-gray-200 text-sm">
                <div>
                  <span className="text-gray-500 text-xs">연령</span>
                  <p className="font-medium">{campaign.targeting.age_range.min_age} - {campaign.targeting.age_range.max_age}세</p>
                </div>
                <div>
                  <span className="text-gray-500 text-xs">성별</span>
                  <p className="font-medium">
                    {campaign.targeting.genders.includes('all') ? '전체' : campaign.targeting.genders.map(g => g === 'male' ? '남성' : '여성').join(', ')}
                  </p>
                </div>
                <div>
                  <span className="text-gray-500 text-xs">지역</span>
                  <p className="font-medium">{campaign.targeting.geo?.countries?.join(', ') || 'KR'}</p>
                </div>
                {campaign.targeting.interests?.interests && campaign.targeting.interests.interests.length > 0 && (
                  <div className="col-span-2">
                    <span className="text-gray-500 text-xs">관심사</span>
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {campaign.targeting.interests.interests.map((interest, i) => (
                        <span key={i} className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">{interest}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 예산 변경 */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">예산 변경</p>
            <div className="flex gap-2">
              <input type="number" placeholder="새 총 예산" value={editBudget} onChange={(e) => setEditBudget(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <Button size="sm" onClick={() => budgetMutation.mutate()} loading={budgetMutation.isPending} disabled={!editBudget}>
                변경
              </Button>
            </div>
          </div>

          {/* 광고 ON/OFF */}
          {(campaign.ads || []).length > 0 && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">광고 관리</p>
              <div className="space-y-2">
                {campaign.ads.map((ad) => (
                  <div key={ad.id} className="flex items-center justify-between p-2 bg-white rounded-lg">
                    <div>
                      <p className="text-sm font-medium">{ad.name}</p>
                      <p className="text-xs text-gray-500">배분: {ad.budget_percentage}% - {ad.status}</p>
                    </div>
                    <button
                      onClick={() => toggleAdMutation.mutate({
                        adId: ad.id,
                        action: ad.status === 'ACTIVE' ? 'pause' : 'activate'
                      })}
                      className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                        ad.status === 'ACTIVE'
                          ? 'bg-green-100 text-green-700 hover:bg-orange-100 hover:text-orange-700'
                          : 'bg-gray-100 text-gray-600 hover:bg-green-100 hover:text-green-700'
                      }`}>
                      {ad.status === 'ACTIVE' ? 'ON' : 'OFF'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
