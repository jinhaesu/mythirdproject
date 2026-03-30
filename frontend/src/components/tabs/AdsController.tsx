'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Target, Zap, Upload, CheckCircle, Trash2, Plus, Copy,
  Play, Pause, ChevronDown, ChevronUp, RefreshCw, Info, X,
  Users, MapPin, Crosshair, Layers, Eye, Database, Settings, ToggleLeft, ToggleRight,
  AlertTriangle, Check, Image as ImageIcon, Save, FolderOpen, Clock, Pencil
} from 'lucide-react';
import { Button, Input, Card, CardTitle, Select } from '@/components/ui';
import { campaignApi, creativeApi, resolveMediaUrl } from '@/lib/api';
import { useAppStore } from '@/store';
import type { Campaign, Creative, StrategyRecommendation, Ad, TargetingConfig, TargetingSegment, AdSetCreative, CampaignObjective, BudgetType, PublishOptions, CampaignDraft } from '@/types';
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
    custom_audiences: [],
    exclusion_audiences: [],
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
    description: '웹사이트 방문자, 장바구니 이탈자, 구매자, 광고 참여자, 동영상 시청자 타겟',
  },
  {
    type: 'INTEREST',
    name: '관심사',
    enabled: true,
    ratio: 25,
    targeting: defaultTargetingConfig(),
    custom_audiences: [],
    exclusion_audiences: [],
    interests: [],
    description: '관심사 키워드 기반 타겟팅',
  },
];

// ── Draft localStorage helpers ──
const DRAFT_STORAGE_KEY = 'campaign_drafts';

function loadDrafts(): CampaignDraft[] {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveDrafts(drafts: CampaignDraft[]) {
  localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(drafts));
}

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

  // Budget level: 'campaign' = CBO (auto-distribute), 'adset' = per-adset budget
  const [budgetLevel, setBudgetLevel] = useState<'campaign' | 'adset'>('campaign');

  // Bid strategy
  const [bidStrategy, setBidStrategy] = useState<string>('');  // '' = auto (lowest cost)
  const [bidAmount, setBidAmount] = useState<string>('');

  // Preview modal
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Fallback handler for creative preview images with broken/expired URLs
  const IMG_FALLBACK = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">' +
    '<rect fill="#f3f4f6" width="200" height="200"/>' +
    '<text x="100" y="95" text-anchor="middle" fill="#9ca3af" font-size="14" font-family="sans-serif">이미지</text>' +
    '<text x="100" y="115" text-anchor="middle" fill="#9ca3af" font-size="14" font-family="sans-serif">로드 실패</text>' +
    '</svg>'
  );
  const handleImageError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.src !== IMG_FALLBACK) {
      img.src = IMG_FALLBACK;
    }
  }, []);

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

  // 광고세트 (Ad Sets)
  const [segments, setSegments] = useState<TargetingSegment[]>(createDefaultSegments());
  const [expandedAdSets, setExpandedAdSets] = useState<Record<number, boolean>>({ 0: true });
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

  // Ad text configuration (legacy, kept for backward compat)
  const [primaryText, setPrimaryText] = useState('');
  const [headline, setHeadline] = useState('');
  const [callToAction, setCallToAction] = useState('SHOP_NOW');
  const [linkUrl, setLinkUrl] = useState('');

  // Per-adset creative picker state (which adset index is open in Step 3)
  const [creativePickerForAdSet, setCreativePickerForAdSet] = useState<number | null>(null);
  // Collapsible state for ad set cards in Step 3
  const [expandedCreativeAdSets, setExpandedCreativeAdSets] = useState<Record<number, boolean>>({ 0: true });

  // ── Catalog state (for Advantage+ catalog dropdowns) ──
  const [catalogs, setCatalogs] = useState<Array<{ id: string; name: string }>>([]);
  const [productSets, setProductSets] = useState<Record<string, Array<{ id: string; name: string }>>>({});

  // ── 임시 저장 (Draft) state ──
  const [drafts, setDrafts] = useState<CampaignDraft[]>(loadDrafts);
  const [loadedDraftId, setLoadedDraftId] = useState<string | null>(null);

  const saveDraft = useCallback(() => {
    const draftName = campaignName || `임시 저장 ${new Date().toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
    const draft: CampaignDraft = {
      id: loadedDraftId || `draft_${Date.now()}`,
      name: draftName,
      savedAt: new Date().toISOString(),
      formData: {
        campaignName, objective, budget, budgetType, startDate, endDate,
        budgetLevel, advantagePlus, advantagePlusAudience, advantagePlusCreative,
        datasetOption, customDatasetId, pixelOption, customPixelId,
        launchImmediately, bidStrategy, bidAmount,
        segments, showTargeting, ageMin, ageMax, genders, countries, interests,
        primaryText, headline, callToAction, linkUrl,
        activeStep,
        selectedCreativeIds: localSelectedCreatives.map(c => c.id),
      },
    };
    const updated = [draft, ...drafts.filter(d => d.id !== draft.id)];
    saveDrafts(updated);
    setDrafts(updated);
    setLoadedDraftId(draft.id);
    toast.success('임시 저장 완료');
  }, [campaignName, objective, budget, budgetType, startDate, endDate, budgetLevel,
      advantagePlus, advantagePlusAudience, advantagePlusCreative, datasetOption,
      customDatasetId, pixelOption, customPixelId, launchImmediately, bidStrategy,
      bidAmount, segments, showTargeting, ageMin, ageMax, genders, countries,
      interests, primaryText, headline, callToAction, linkUrl, activeStep,
      localSelectedCreatives, drafts, loadedDraftId]);

  const deleteDraft = useCallback((draftId: string) => {
    const updated = drafts.filter(d => d.id !== draftId);
    saveDrafts(updated);
    setDrafts(updated);
    if (loadedDraftId === draftId) setLoadedDraftId(null);
  }, [drafts, loadedDraftId]);

  const loadDraft = useCallback((draft: CampaignDraft) => {
    const f = draft.formData;
    setCampaignName(f.campaignName);
    setObjective(f.objective);
    setBudget(f.budget);
    setBudgetType(f.budgetType);
    setStartDate(f.startDate);
    setEndDate(f.endDate);
    setBudgetLevel(f.budgetLevel);
    setAdvantagePlus(f.advantagePlus);
    setAdvantagePlusAudience(f.advantagePlusAudience);
    setAdvantagePlusCreative(f.advantagePlusCreative);
    setDatasetOption(f.datasetOption);
    setCustomDatasetId(f.customDatasetId);
    setPixelOption(f.pixelOption);
    setCustomPixelId(f.customPixelId);
    setLaunchImmediately(f.launchImmediately);
    setBidStrategy(f.bidStrategy);
    setBidAmount(f.bidAmount);
    setSegments(f.segments);
    setShowTargeting(f.showTargeting);
    setAgeMin(f.ageMin);
    setAgeMax(f.ageMax);
    setGenders(f.genders);
    setCountries(f.countries);
    setInterests(f.interests);
    setPrimaryText(f.primaryText);
    setHeadline(f.headline);
    setCallToAction(f.callToAction);
    setLinkUrl(f.linkUrl);
    setActiveStep(f.activeStep);
    setLoadedDraftId(draft.id);
    toast.success(`"${draft.name}" 불러오기 완료`);
  }, []);

  // Keep local creatives in sync with store
  useEffect(() => {
    setLocalSelectedCreatives(selectedCreatives);
  }, [selectedCreatives]);

  // Library query
  const { data: libraryCreatives = [], refetch: refetchLibrary } = useQuery({
    queryKey: ['creative-library'],
    queryFn: () => creativeApi.getLibrary(undefined, 50),
    enabled: showLibrary || creativePickerForAdSet !== null,
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

  // 글로벌 타겟팅 변경을 세그먼트에 동기화 — 단, 사용자가 직접 변경할 때만
  // (복제/수정 시 프로그래밍적으로 설정할 때는 동기화 안 함)
  const isManualTargetingChange = useRef(false);
  const prevTargetingValues = useRef({ ageMin, ageMax, genders: genders.join(','), countries: countries.join(',') });

  useEffect(() => {
    if (!showTargeting) return;
    const prev = prevTargetingValues.current;
    const changed = prev.ageMin !== ageMin || prev.ageMax !== ageMax ||
      prev.genders !== genders.join(',') || prev.countries !== countries.join(',');
    prevTargetingValues.current = { ageMin, ageMax, genders: genders.join(','), countries: countries.join(',') };

    // 첫 호출이거나 프로그래밍적 변경은 무시
    if (!isManualTargetingChange.current) {
      isManualTargetingChange.current = true;
      return;
    }
    if (!changed) return;

    setSegments(prev => prev.map(seg => ({
      ...seg,
      targeting: {
        ...(seg.targeting || defaultTargetingConfig()),
        age_range: { min_age: ageMin, max_age: ageMax },
        genders: genders,
        geo: { ...((seg.targeting || defaultTargetingConfig()).geo), countries },
      }
    })));
  }, [ageMin, ageMax, genders, countries, showTargeting]);

  const { data: campaigns, refetch: refetchCampaigns } = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => campaignApi.list(),
  });

  // Meta 커스텀 오디언스 목록 (리타겟팅용)
  const { data: customAudiencesData, isLoading: isLoadingAudiences, error: audiencesError } = useQuery({
    queryKey: ['custom-audiences'],
    queryFn: () => campaignApi.getCustomAudiences(),
    staleTime: 5 * 60 * 1000, // 5분 캐시
    retry: 1,
  });
  const metaCustomAudiences = customAudiencesData?.audiences || [];
  const audiencesApiError = (customAudiencesData as any)?.error;

  const strategyMutation = useMutation({
    mutationFn: () => campaignApi.getStrategy(Number(budget), selectedCreatives.length > 0 ? selectedCreatives.map((c) => c.id) : []),
    onSuccess: (data) => { setStrategy(data); toast.success('최적 전략 분석 완료'); },
    onError: () => toast.error('전략 분석 실패'),
  });

  // Build targeting config for API.
  // Pass force=true in update mode to always include targeting data even if
  // showTargeting is somehow false (guards against stale closure values).
  const buildTargetingConfig = (force = false) => {
    if (!showTargeting && !force) return undefined;
    return {
      age_range: { min_age: ageMin, max_age: ageMax },
      genders,
      geo: { countries, cities: undefined },
      interests: { interests, behaviors: undefined },
      custom_audiences: undefined,
      lookalike_audiences: undefined,
    };
  };

  // Collect all creative IDs across all ad sets
  const allAdSetCreativeIds = useMemo(() => {
    const ids = new Set<number>();
    segments.forEach(seg => (seg.ads || []).forEach(a => ids.add(a.creative_id)));
    return Array.from(ids);
  }, [segments]);

  const createCampaignMutation = useMutation({
    mutationFn: () => campaignApi.create({
      name: campaignName || `캠페인 ${new Date().toLocaleDateString()}`,
      objective,
      total_budget: Number(budget),
      daily_budget: budgetType === 'DAILY' ? Number(budget) : (dailyEquivalent || undefined),
      budget_type: budgetType,
      creative_ids: allAdSetCreativeIds.length > 0 ? allAdSetCreativeIds : (selectedCreatives.length > 0 ? selectedCreatives.map((c) => c.id) : []),
      targeting: buildTargetingConfig(true),
      targeting_segments: enabledSegments.length > 0 ? enabledSegments.map(seg => ({
        type: seg.type,
        name: seg.name,
        enabled: seg.enabled,
        ratio: seg.ratio,
        targeting: seg.targeting,
        description: seg.description,
        custom_audiences: seg.custom_audiences,
        exclusion_audiences: seg.exclusion_audiences,
        interests: seg.interests,
        ads: (seg.ads || []).map(a => ({
          creative_id: a.creative_id,
          ad_name: a.ad_name,
          media_source: a.media_source || 'manual',
          format: a.format || 'single',
          multi_advertiser_ads: a.multi_advertiser_ads ?? true,
          primary_text: a.primary_text,
          headline: a.headline,
          description: a.description,
          call_to_action: a.call_to_action,
          landing_type: a.landing_type || 'website',
          link_url: a.link_url,
          use_display_link: a.use_display_link ?? false,
          display_link: a.display_link,
          url_params: a.url_params,
          utm_label: (a as any).utm_label,
          advantage_catalog: (a as any).advantage_catalog ?? false,
          catalog_id: (a as any).catalog_id,
          product_set_id: (a as any).product_set_id,
          advantage_plus_creative: (a as any).advantage_plus_creative ?? false,
        })),
      })) : undefined,
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
      // 불러온 초안이 있으면 자동 삭제
      if (loadedDraftId) {
        deleteDraft(loadedDraftId);
        setLoadedDraftId(null);
      }
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
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;
      let msg = '캠페인 생성 실패';
      if (typeof detail === 'string') {
        msg = detail;
      } else if (Array.isArray(detail)) {
        msg = detail.map((e: any) => e.msg || e.message || JSON.stringify(e)).join(', ');
      } else if (status) {
        msg = `캠페인 생성 실패 (${status}: ${err?.response?.statusText || 'Error'})`;
      } else if (err?.message) {
        msg = `캠페인 생성 실패: ${err.message}`;
      }
      console.error('Campaign create error:', status, err?.response?.data || err?.message);
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
      use_cbo: budgetLevel === 'campaign',
      bid_strategy: (bidStrategy && bidAmount) ? bidStrategy : undefined,
      bid_amount: (bidStrategy && bidAmount) ? Number(bidAmount) : undefined,
    }),
    onSuccess: (data) => {
      if (data.success) {
        refetchCampaigns();
        toast.success(data.message || 'Meta 발행 완료');
      } else {
        const msg = data.message || '발행 실패';
        // TOS URL이 포함된 에러는 더 오래 보여주기
        if (msg.includes('business.facebook.com') || msg.includes('약관')) {
          toast.error(msg, { duration: 15000 });
        } else {
          toast.error(msg, { duration: 8000 });
        }
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

  // ── 캠페인 수정 (DRAFT → 폼에 로드) ──
  const [editingCampaignId, setEditingCampaignId] = useState<number | null>(null);

  const editCampaign = useCallback((campaign: Campaign) => {
    setCampaignName(campaign.name);
    setObjective(campaign.objective);
    setBudget(String(campaign.total_budget));
    setBudgetType(campaign.budget_type || 'DAILY');
    setStartDate(campaign.start_date ? campaign.start_date.split('T')[0] : '');
    setEndDate(campaign.end_date ? campaign.end_date.split('T')[0] : '');
    setAdvantagePlus(campaign.advantage_plus || false);
    setAdvantagePlusAudience(campaign.advantage_plus_audience || false);
    setDatasetOption(campaign.dataset_id ? 'custom' : '');
    setCustomDatasetId(campaign.dataset_id || '');
    setPixelOption(campaign.pixel_id ? 'custom' : 'auto');
    setCustomPixelId(campaign.pixel_id || '');

    // 타겟팅 복원 (수정모드에서는 항상 활성화)
    // Always reset to campaign's values (or safe defaults) so stale state from
    // a previous edit never leaks into the current campaign's save payload.
    setShowTargeting(true);
    setAgeMin(campaign.targeting?.age_range?.min_age ?? 18);
    setAgeMax(campaign.targeting?.age_range?.max_age ?? 65);
    setGenders(campaign.targeting?.genders || ['all']);
    setCountries(campaign.targeting?.geo?.countries || ['KR']);
    setInterests(campaign.targeting?.interests?.interests || []);

    // 세그먼트 복원 + 세그먼트 타겟팅에도 글로벌 값 반영
    if (campaign.targeting_segments && campaign.targeting_segments.length > 0) {
      const restoredAge = campaign.targeting?.age_range || { min_age: 18, max_age: 65 };
      const restoredGenders = campaign.targeting?.genders || ['all'];
      const restoredCountries = campaign.targeting?.geo?.countries || ['KR'];
      setSegments(campaign.targeting_segments.map((seg: any) => ({
        ...seg,
        targeting: {
          ...(seg.targeting || defaultTargetingConfig()),
          age_range: { min_age: restoredAge.min_age, max_age: restoredAge.max_age },
          genders: restoredGenders,
          geo: { ...(seg.targeting?.geo || { countries: ['KR'] }), countries: restoredCountries },
        }
      })));
    }

    setEditingCampaignId(campaign.id);
    setLoadedDraftId(null);
    setActiveStep(1);
    isManualTargetingChange.current = false; // 동기화 방지
    toast.success(`"${campaign.name}" 수정 모드`);

    // 스크롤 맨 위로
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // ── 캠페인 복제 ──
  const duplicateCampaign = useCallback((campaign: Campaign) => {
    setCampaignName(`${campaign.name} (복사)`);
    setObjective(campaign.objective);
    setBudget(String(campaign.total_budget));
    setBudgetType(campaign.budget_type || 'DAILY');
    setStartDate(campaign.start_date ? campaign.start_date.split('T')[0] : '');
    setEndDate(campaign.end_date ? campaign.end_date.split('T')[0] : '');
    setAdvantagePlus(campaign.advantage_plus || false);
    setAdvantagePlusAudience(campaign.advantage_plus_audience || false);
    setDatasetOption(campaign.dataset_id ? 'custom' : '');
    setCustomDatasetId(campaign.dataset_id || '');
    setPixelOption(campaign.pixel_id ? 'custom' : 'auto');
    setCustomPixelId(campaign.pixel_id || '');

    // 타겟팅 복원 (항상 활성화)
    setShowTargeting(true);
    setAgeMin(campaign.targeting?.age_range?.min_age ?? 18);
    setAgeMax(campaign.targeting?.age_range?.max_age ?? 65);
    setGenders(campaign.targeting?.genders || ['all']);
    setCountries(campaign.targeting?.geo?.countries || ['KR']);
    setInterests(campaign.targeting?.interests?.interests || []);

    // 세그먼트 복원 (deep copy + 타겟팅 유지)
    if (campaign.targeting_segments && campaign.targeting_segments.length > 0) {
      setSegments(campaign.targeting_segments.map((seg: any) => JSON.parse(JSON.stringify(seg))));
    }

    // 수정 모드가 아닌 새 캠페인 생성 모드로
    setEditingCampaignId(null);
    setLoadedDraftId(null);
    setActiveStep(1);
    isManualTargetingChange.current = false; // 동기화 방지
    toast.success(`"${campaign.name}" 복제됨 — 수정 후 생성하세요`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // 수정 완료 후 캠페인 업데이트
  const updateCampaignMutation = useMutation({
    mutationFn: () => campaignApi.update(editingCampaignId!, {
      name: campaignName || `캠페인 ${new Date().toLocaleDateString()}`,
      objective,
      total_budget: Number(budget),
      daily_budget: budgetType === 'DAILY' ? Number(budget) : undefined,
      budget_type: budgetType,
      targeting: buildTargetingConfig(true),
      targeting_segments: enabledSegments.length > 0 ? enabledSegments : undefined,
      start_date: startDate || undefined,
      end_date: endDate || undefined,
      advantage_plus: advantagePlus,
      advantage_plus_audience: advantagePlusAudience,
      dataset_id: resolvedDatasetId,
      pixel_id: resolvedPixelId,
    } as any),
    onSuccess: () => {
      refetchCampaigns();
      toast.success('캠페인 수정 완료');
      setEditingCampaignId(null);
      setCampaignName('');
      setBudget('');
      setSegments(createDefaultSegments());
      setShowTargeting(false);
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : '캠페인 수정 실패');
    },
  });

  const cancelEdit = () => {
    setEditingCampaignId(null);
    setCampaignName('');
    setBudget('');
    setPrimaryText('');
    setHeadline('');
    setSegments(createDefaultSegments());
    setShowTargeting(false);
    toast('수정 취소', { icon: '↩️' });
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

  const addAdSet = (type: 'BROAD' | 'RETARGET' | 'INTEREST' | 'CUSTOM') => {
    const typeNames = { BROAD: '브로드', RETARGET: '리타겟', INTEREST: '관심사', CUSTOM: '커스텀' };
    const newSeg: TargetingSegment = {
      type,
      name: `${typeNames[type]} ${segments.length + 1}`,
      enabled: true,
      ratio: 20,
      targeting: defaultTargetingConfig(),
      description: '',
      custom_audiences: [],
      exclusion_audiences: [],
      ...(type === 'INTEREST' || type === 'CUSTOM' ? { interests: [] } : {}),
    };
    setSegments(prev => [...prev, newSeg]);
    setExpandedAdSets(prev => ({ ...prev, [segments.length]: true }));
  };

  const duplicateAdSet = (index: number) => {
    const source = segments[index];
    const copy: TargetingSegment = {
      ...JSON.parse(JSON.stringify(source)),
      name: `${source.name} (복사)`,
    };
    setSegments(prev => [...prev, copy]);
    setExpandedAdSets(prev => ({ ...prev, [segments.length]: true }));
  };

  const toggleAdSetExpanded = (index: number) => {
    setExpandedAdSets(prev => ({ ...prev, [index]: !prev[index] }));
  };

  const updateSegmentTargeting = (index: number, field: string, value: any) => {
    const updated = [...segments];
    const seg = { ...updated[index] };
    const targeting = { ...(seg.targeting || defaultTargetingConfig()) };

    if (field === 'min_age') targeting.age_range = { ...targeting.age_range, min_age: value };
    else if (field === 'max_age') targeting.age_range = { ...targeting.age_range, max_age: value };
    else if (field === 'genders') targeting.genders = value;
    else if (field === 'countries') targeting.geo = { ...targeting.geo, countries: value };
    else if (field === 'interests') targeting.interests = { ...targeting.interests, interests: value };

    seg.targeting = targeting;
    updated[index] = seg;
    setSegments(updated);
  };

  const distributeRatiosEvenly = () => {
    const enabled = segments.filter(s => s.enabled);
    if (enabled.length === 0) return;
    const evenRatio = Math.floor(100 / enabled.length);
    const remainder = 100 - evenRatio * enabled.length;
    let idx = 0;
    setSegments(segments.map(s => {
      if (!s.enabled) return s;
      const r = evenRatio + (idx === 0 ? remainder : 0);
      idx++;
      return { ...s, ratio: r };
    }));
  };

  // ── 광고세트별 소재 관리 (Step 3) ──
  const addCreativeToAdSet = (segIndex: number, creative: Creative) => {
    const updated = [...segments];
    const seg = { ...updated[segIndex] };
    const existingAds = seg.ads || [];
    if (existingAds.some(a => a.creative_id === creative.id)) return;
    const sameCreativeCount = existingAds.filter((a: any) => a.creative_id === creative.id).length;
    const suffix = sameCreativeCount > 0 ? ` (${sameCreativeCount + 1})` : '';
    const newAd: AdSetCreative = {
      creative_id: creative.id,
      creative,
      ad_name: `${campaignName}_${seg.name}_${creative.name}${suffix}`,
      media_source: 'manual',
      format: creative.creative_type === 'CAROUSEL' ? 'carousel' : 'single',
      multi_advertiser_ads: true,
      primary_text: '',
      headline: '',
      description: '',
      call_to_action: 'SHOP_NOW',
      landing_type: 'website',
      link_url: '',
      use_display_link: false,
      advantage_catalog: false,
      advantage_plus_creative: false,
    };
    seg.ads = [...existingAds, newAd];
    updated[segIndex] = seg;
    setSegments(updated);
  };

  const removeCreativeFromAdSet = (segIndex: number, creativeId: number) => {
    const updated = [...segments];
    const seg = { ...updated[segIndex] };
    seg.ads = (seg.ads || []).filter(a => a.creative_id !== creativeId);
    updated[segIndex] = seg;
    setSegments(updated);
  };

  const updateAdSetCreativeField = (segIndex: number, creativeId: number, field: keyof AdSetCreative, value: string) => {
    const updated = [...segments];
    const seg = { ...updated[segIndex] };
    // Handle boolean fields stored as 'true'/'false' strings
    const boolFields: (keyof AdSetCreative)[] = ['multi_advertiser_ads', 'use_display_link'];
    const parsed = boolFields.includes(field) ? value === 'true' : value;
    seg.ads = (seg.ads || []).map(a =>
      a.creative_id === creativeId ? { ...a, [field]: parsed } : a
    );
    updated[segIndex] = seg;
    setSegments(updated);
  };

  // ── Carousel card CRUD helpers ──
  const updateCarouselCard = (segIndex: number, creativeId: number, cardIndex: number, field: string, value: string) => {
    const updated = [...segments];
    const seg = { ...updated[segIndex] };
    seg.ads = (seg.ads || []).map(a => {
      if (a.creative_id !== creativeId) return a;
      const cards = [...((a as any).carousel_cards || [])];
      cards[cardIndex] = { ...cards[cardIndex], [field]: value };
      return { ...a, carousel_cards: cards };
    });
    updated[segIndex] = seg;
    setSegments(updated);
  };

  const addCarouselCard = (segIndex: number, creativeId: number) => {
    const updated = [...segments];
    const seg = { ...updated[segIndex] };
    seg.ads = (seg.ads || []).map(a => {
      if (a.creative_id !== creativeId) return a;
      const cards = [...((a as any).carousel_cards || [])];
      if (cards.length >= 10) return a;
      cards.push({ headline: '', link_url: '' });
      return { ...a, carousel_cards: cards };
    });
    updated[segIndex] = seg;
    setSegments(updated);
  };

  const removeCarouselCard = (segIndex: number, creativeId: number, cardIndex: number) => {
    const updated = [...segments];
    const seg = { ...updated[segIndex] };
    seg.ads = (seg.ads || []).map(a => {
      if (a.creative_id !== creativeId) return a;
      const cards = [...((a as any).carousel_cards || [])];
      if (cards.length <= 2) return a;
      cards.splice(cardIndex, 1);
      return { ...a, carousel_cards: cards };
    });
    updated[segIndex] = seg;
    setSegments(updated);
  };

  // Compute ad set preview based on segments + budget
  const adSetPreview = useMemo(() => {
    const active = segments.filter(s => s.enabled);
    if (active.length === 0 || !budget) return [];
    const totalBudget = Number(budget);
    const tRatio = active.reduce((sum, s) => sum + s.ratio, 0);
    const days = budgetType === 'LIFETIME' && campaignDays > 0 ? campaignDays : 7;
    return active.map((seg) => {
      const t = seg.targeting || defaultTargetingConfig();
      return {
        name: seg.name,
        type: seg.type,
        ratio: seg.ratio,
        dailyBudget: Math.round((totalBudget / days) * (seg.ratio / (tRatio || 1))),
        ageRange: `${t.age_range?.min_age || 18}-${t.age_range?.max_age || 65}세`,
        gender: t.genders?.join(', ') || 'all',
        interests: t.interests?.interests || seg.interests || [],
        description: seg.description || '',
      };
    });
  }, [segments, budget, budgetType, campaignDays]);

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
                            <div className="relative group">
                              <img src={resolveMediaUrl(creative.thumbnail_url || creative.file_url)} alt={creative.name} className="w-full h-16 object-cover" onError={handleImageError} />
                              <button onClick={(e) => { e.stopPropagation(); setPreviewUrl(resolveMediaUrl(creative.file_url || creative.thumbnail_url)); }}
                                className="absolute inset-0 bg-black/0 group-hover:bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all">
                                <Eye size={14} className="text-white drop-shadow" />
                              </button>
                            </div>
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

            {/* ══════════════════════════════════════════════════ */}
            {/* ── 광고세트별 소재 배정 ─────────────────────── */}
            {/* ══════════════════════════════════════════════════ */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                <Layers size={14} /> 광고세트별 소재 배정
              </label>

              {enabledSegments.length === 0 ? (
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className="text-yellow-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-yellow-800">광고세트를 먼저 만들어주세요</p>
                      <p className="text-xs text-yellow-600 mt-0.5">
                        Step 2에서 광고세트를 추가한 뒤 여기서 소재를 배정할 수 있습니다.
                      </p>
                      <button onClick={() => setActiveStep(2)} className="text-xs text-blue-600 hover:text-blue-700 mt-1 underline">
                        광고세트 설정으로 이동
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {segments.map((seg, i) => {
                    if (!seg.enabled) return null;
                    const isOpen = expandedCreativeAdSets[i] ?? false;
                    const typeBadge = seg.type === 'BROAD' ? 'bg-purple-100 text-purple-700'
                      : seg.type === 'RETARGET' ? 'bg-orange-100 text-orange-700'
                      : seg.type === 'INTEREST' ? 'bg-teal-100 text-teal-700'
                      : 'bg-blue-100 text-blue-700';
                    const cardBorder = seg.type === 'BROAD' ? 'border-purple-200' : seg.type === 'RETARGET' ? 'border-orange-200' : seg.type === 'INTEREST' ? 'border-teal-200' : 'border-blue-200';

                    return (
                      <div key={i} className={`rounded-lg border ${cardBorder}`}>
                        {/* 광고세트 헤더 (클릭으로 접기/펼치기) */}
                        <div
                          className="flex items-center gap-2 p-2.5 bg-gray-50 rounded-t-lg cursor-pointer select-none"
                          onClick={() => setExpandedCreativeAdSets(prev => ({ ...prev, [i]: !prev[i] }))}
                        >
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${typeBadge}`}>
                            {seg.type === 'BROAD' ? '브로드' : seg.type === 'RETARGET' ? '리타겟' : seg.type === 'INTEREST' ? '관심사' : '커스텀'}
                          </span>
                          <span className="text-sm font-medium text-gray-800 flex-1">{seg.name}</span>
                          <span className="text-xs text-gray-500">{(seg.ads || []).length}개 소재</span>
                          {isOpen ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                        </div>

                        {/* 광고세트 본문 (접기/펼치기) */}
                        {isOpen && (
                        <div className="p-2.5 space-y-2">
                          {/* 소재 추가 버튼 */}
                          <button
                            onClick={() => { setCreativePickerForAdSet(creativePickerForAdSet === i ? null : i); if (creativePickerForAdSet !== i) refetchLibrary(); }}
                            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50 w-full justify-center border border-dashed border-blue-300"
                          >
                            <Plus size={12} /> 소재 추가
                          </button>

                          {/* 소재 선택 패널 */}
                          {creativePickerForAdSet === i && (
                            <div className="p-2 bg-blue-50 rounded-lg border border-blue-200 max-h-40 overflow-y-auto">
                              <p className="text-[10px] text-blue-600 mb-1.5">소재를 클릭하여 이 광고세트에 추가</p>
                              {libraryCreatives.length === 0 ? (
                                <p className="text-xs text-gray-500 py-2 text-center">소재 라이브러리가 비어있습니다. 위에서 파일을 업로드하세요.</p>
                              ) : (
                                <div className="grid grid-cols-4 gap-1.5">
                                  {libraryCreatives.map((c: Creative) => {
                                    const alreadyAdded = (seg.ads || []).some(a => a.creative_id === c.id);
                                    return (
                                      <div key={c.id} className="relative group">
                                        <button disabled={alreadyAdded}
                                          onClick={() => addCreativeToAdSet(i, c)}
                                          className={`w-full relative rounded overflow-hidden border transition-all ${alreadyAdded ? 'opacity-40 cursor-not-allowed border-gray-200' : 'border-blue-300 hover:border-blue-500 hover:shadow-sm cursor-pointer'}`}>
                                          {c.thumbnail_url || c.file_url ? (
                                            <div className="relative">
                                              <img src={resolveMediaUrl(c.thumbnail_url || c.file_url)} alt={c.name} className="w-full aspect-square object-cover" onError={handleImageError} />
                                              <div onClick={(e) => { e.stopPropagation(); e.preventDefault(); setPreviewUrl(resolveMediaUrl(c.file_url || c.thumbnail_url)); }}
                                                className="absolute top-0 right-0 p-0.5 bg-black/40 rounded-bl opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                                                <Eye size={10} className="text-white" />
                                              </div>
                                            </div>
                                          ) : (
                                            <div className="w-full aspect-square bg-gray-200 flex items-center justify-center"><ImageIcon size={16} className="text-gray-400" /></div>
                                          )}
                                          {alreadyAdded && <div className="absolute inset-0 bg-white/50 flex items-center justify-center"><Check size={14} className="text-green-600" /></div>}
                                          <p className="text-[9px] text-gray-600 truncate px-0.5 py-0.5">{c.name}</p>
                                        </button>
                                        {!alreadyAdded && (
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              segments.forEach((seg, idx) => {
                                                if (seg.enabled && !(seg.ads || []).some((a: any) => a.creative_id === c.id)) {
                                                  addCreativeToAdSet(idx, c);
                                                }
                                              });
                                              toast.success(`${c.name}이(가) 모든 세그먼트에 추가되었습니다`);
                                            }}
                                            className="absolute bottom-1 right-1 text-[10px] bg-violet-500 text-white px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                            title="모든 세그먼트에 추가"
                                          >
                                            전체
                                          </button>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              <button onClick={() => setCreativePickerForAdSet(null)}
                                className="mt-1.5 w-full text-xs text-blue-600 hover:text-blue-700 py-1">닫기</button>
                            </div>
                          )}

                          {/* 배정된 소재 목록 + Meta 스타일 개별 설정 */}
                          {(seg.ads || []).length > 0 ? (
                            <div className="space-y-2">
                              {(seg.ads || []).map((ad) => (
                                <div key={ad.creative_id} className="border border-gray-200 rounded-lg bg-white">
                                  {/* 소재 헤더: 썸네일 + 광고 이름 + 삭제 */}
                                  <div className="flex items-center gap-2 p-2">
                                    <div className="w-10 h-10 rounded overflow-hidden flex-shrink-0 bg-gray-100 relative group cursor-pointer"
                                      onClick={() => { const url = resolveMediaUrl(ad.creative?.file_url || ad.creative?.thumbnail_url); if (url) setPreviewUrl(url); }}>
                                      {(ad.creative?.thumbnail_url || ad.creative?.file_url) ? (
                                        <>
                                          <img src={resolveMediaUrl(ad.creative?.thumbnail_url || ad.creative?.file_url)} alt="" className="w-full h-full object-cover" onError={handleImageError} />
                                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all">
                                            <Eye size={12} className="text-white drop-shadow" />
                                          </div>
                                        </>
                                      ) : <ImageIcon size={16} className="m-auto mt-2.5 text-gray-400" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <label className="block text-[10px] text-gray-400 mb-0.5">광고 소재 이름</label>
                                      <input
                                        type="text"
                                        value={ad.ad_name}
                                        onChange={(e) => updateAdSetCreativeField(i, ad.creative_id, 'ad_name', e.target.value)}
                                        placeholder="광고 소재 이름을 입력하세요"
                                        className="w-full text-sm font-medium bg-gray-50 border border-gray-200 rounded px-2 py-1 focus:bg-white focus:border-violet-400 focus:ring-1 focus:ring-violet-400 focus:outline-none transition-colors"
                                      />
                                    </div>
                                    <button onClick={() => removeCreativeFromAdSet(i, ad.creative_id)}
                                      className="text-gray-400 hover:text-red-500 flex-shrink-0"><X size={13} /></button>
                                  </div>

                                  {/* ── 1. 광고 크리에이티브 설정 ── */}
                                  <details className="border-t border-gray-100">
                                    <summary className="px-2 py-1.5 text-[10px] font-medium text-gray-600 cursor-pointer hover:bg-gray-50 flex items-center gap-1">
                                      <Layers size={10} /> 광고 크리에이티브
                                    </summary>
                                    <div className="px-2 pb-2 space-y-2">
                                      <div>
                                        <label className="text-[10px] text-gray-500">형식</label>
                                        <div className="flex gap-1.5 mt-0.5">
                                          <button onClick={() => updateAdSetCreativeField(i, ad.creative_id, 'format', 'single')}
                                            className={`flex-1 px-2 py-1 rounded text-[10px] font-medium ${(ad.format || 'single') === 'single' ? 'bg-blue-500 text-white' : 'bg-white border border-gray-300 text-gray-600'}`}>
                                            단일 이미지/동영상
                                          </button>
                                          <button onClick={() => updateAdSetCreativeField(i, ad.creative_id, 'format', 'carousel')}
                                            className={`flex-1 px-2 py-1 rounded text-[10px] font-medium ${ad.format === 'carousel' ? 'bg-blue-500 text-white' : 'bg-white border border-gray-300 text-gray-600'}`}>
                                            슬라이드(카탈로그)
                                          </button>
                                        </div>
                                        {ad.format === 'carousel' && (
                                          <div className="mt-2 space-y-2">
                                            <p className="text-[10px] text-gray-500">캐러셀 카드 (2~10개)</p>
                                            {((ad as any).carousel_cards || []).map((card: any, ci: number) => (
                                              <div key={ci} className="flex items-center gap-2 p-1.5 bg-gray-50 rounded text-[10px]">
                                                <span className="text-gray-400 w-4">{ci + 1}</span>
                                                <input placeholder="헤드라인" value={card.headline || ''}
                                                  onChange={e => updateCarouselCard(i, ad.creative_id, ci, 'headline', e.target.value)}
                                                  className="flex-1 px-1.5 py-0.5 border border-gray-200 rounded text-[10px]" />
                                                <input placeholder="링크 URL" value={card.link_url || ''}
                                                  onChange={e => updateCarouselCard(i, ad.creative_id, ci, 'link_url', e.target.value)}
                                                  className="flex-1 px-1.5 py-0.5 border border-gray-200 rounded text-[10px]" />
                                                <button onClick={() => removeCarouselCard(i, ad.creative_id, ci)} className="text-red-400 hover:text-red-600"><X size={10} /></button>
                                              </div>
                                            ))}
                                            <button onClick={() => addCarouselCard(i, ad.creative_id)}
                                              className="text-[10px] text-blue-600 hover:text-blue-700">+ 카드 추가</button>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </details>

                                  {/* ── 2. 광고 문구 ── */}
                                  <details className="border-t border-gray-100" open>
                                    <summary className="px-2 py-1.5 text-[10px] font-medium text-gray-600 cursor-pointer hover:bg-gray-50 flex items-center gap-1">
                                      <Zap size={10} /> 광고 문구 {ad.primary_text || ad.headline ? '✓' : ''}
                                    </summary>
                                    <div className="px-2 pb-2 space-y-1.5">
                                      <div>
                                        <div className="flex justify-between"><label className="text-[10px] text-gray-500">제목 (Headline)</label><span className="text-[10px] text-gray-400">{ad.headline?.length || 0}/40</span></div>
                                        <input type="text" value={ad.headline} maxLength={40}
                                          onChange={(e) => updateAdSetCreativeField(i, ad.creative_id, 'headline', e.target.value)}
                                          placeholder="광고 제목 (40자 이내)"
                                          className="w-full px-2 py-1 border border-gray-200 rounded text-xs" />
                                      </div>
                                      <div>
                                        <div className="flex justify-between"><label className="text-[10px] text-gray-500">기본 문구 (Primary Text)</label><span className="text-[10px] text-gray-400">{ad.primary_text?.length || 0}/300</span></div>
                                        <textarea value={ad.primary_text} rows={3} maxLength={300}
                                          onChange={(e) => updateAdSetCreativeField(i, ad.creative_id, 'primary_text', e.target.value)}
                                          placeholder="광고 기본 문구 (300자 이내)"
                                          className="w-full px-2 py-1 border border-gray-200 rounded text-xs resize-none" />
                                      </div>
                                      <div>
                                        <label className="text-[10px] text-gray-500">행동 유도 (CTA)</label>
                                        <select value={ad.call_to_action}
                                          onChange={(e) => updateAdSetCreativeField(i, ad.creative_id, 'call_to_action', e.target.value)}
                                          className="w-full px-2 py-1 border border-gray-200 rounded text-xs bg-white">
                                          <option value="SHOP_NOW">지금 구매하기</option>
                                          <option value="LEARN_MORE">더 알아보기</option>
                                          <option value="ORDER_NOW">지금 주문하기</option>
                                          <option value="BUY_NOW">지금 구매</option>
                                          <option value="GET_OFFER">혜택 받기</option>
                                          <option value="SIGN_UP">가입하기</option>
                                          <option value="BOOK_NOW">지금 예약하기</option>
                                          <option value="CONTACT_US">문의하기</option>
                                          <option value="SUBSCRIBE">구독하기</option>
                                          <option value="DOWNLOAD">다운로드</option>
                                        </select>
                                      </div>
                                      <button onClick={() => {
                                        const updatedSegs = [...segments];
                                        updatedSegs.forEach((os, oi) => { if (oi !== i && os.enabled) { const m = (os.ads || []).find((a: AdSetCreative) => a.creative_id === ad.creative_id); if (m) { m.primary_text = ad.primary_text; m.headline = ad.headline; m.description = ad.description; m.call_to_action = ad.call_to_action; m.link_url = ad.link_url; m.utm_label = (ad as any).utm_label; m.url_params = ad.url_params; } } });
                                        setSegments(updatedSegs);
                                        toast.success('다른 세그먼트에 동일 적용 완료');
                                      }} className="text-xs text-violet-500 hover:text-violet-700 flex items-center gap-1 mt-1">
                                        <Copy size={12} /> 다른 세그먼트에 동일 적용
                                      </button>
                                    </div>
                                  </details>

                                  {/* ── 3. 광고 설정 (어드밴티지+ 카탈로그) ── */}
                                  <details className="border-t border-gray-100">
                                    <summary className="px-2 py-1.5 text-[10px] font-medium text-gray-600 cursor-pointer hover:bg-gray-50 flex items-center gap-1">
                                      <Database size={10} /> 광고 설정 {(ad as any).advantage_catalog ? '(카탈로그 ON)' : ''}
                                    </summary>
                                    <div className="px-2 pb-2 space-y-2">
                                      <label className="flex items-center gap-2 cursor-pointer">
                                        <input type="checkbox" checked={(ad as any).advantage_catalog ?? false}
                                          onChange={(e) => updateAdSetCreativeField(i, ad.creative_id, 'advantage_catalog', e.target.checked ? 'true' : 'false')}
                                          className="w-3.5 h-3.5 rounded" />
                                        <div><span className="text-[10px] font-medium text-gray-700">어드밴티지+ 카탈로그</span>
                                        <p className="text-[9px] text-gray-400">카탈로그의 관련 제품 미디어를 표시하여 판매 증대</p></div>
                                      </label>
                                      {(ad as any).advantage_catalog && (
                                        <div className="space-y-1.5 pl-5">
                                          <div>
                                            <label className="text-[10px] text-gray-500">카탈로그</label>
                                            {catalogs.length > 0 ? (
                                              <select value={(ad as any).catalog_id || ''}
                                                onChange={(e) => {
                                                  const catId = e.target.value;
                                                  updateAdSetCreativeField(i, ad.creative_id, 'catalog_id', catId);
                                                  updateAdSetCreativeField(i, ad.creative_id, 'product_set_id', '');
                                                  if (catId && !productSets[catId]) {
                                                    campaignApi.getProductSets(catId).then(sets => {
                                                      setProductSets(prev => ({ ...prev, [catId]: sets }));
                                                    }).catch(() => {});
                                                  }
                                                }}
                                                className="w-full px-2 py-1 border border-gray-200 rounded text-xs bg-white">
                                                <option value="">카탈로그 선택</option>
                                                {catalogs.map(c => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
                                              </select>
                                            ) : (
                                              <div className="flex gap-1">
                                                <input type="text" value={(ad as any).catalog_id || ''}
                                                  onChange={(e) => updateAdSetCreativeField(i, ad.creative_id, 'catalog_id', e.target.value)}
                                                  placeholder="카탈로그 ID" className="flex-1 px-2 py-1 border border-gray-200 rounded text-xs" />
                                                <button onClick={() => {
                                                  campaignApi.getCatalogs().then(data => setCatalogs(data)).catch(() => {});
                                                }} className="px-2 py-1 text-[10px] bg-gray-100 border border-gray-200 rounded hover:bg-gray-200">불러오기</button>
                                              </div>
                                            )}
                                          </div>
                                          <div>
                                            <label className="text-[10px] text-gray-500">제품 세트 (선택)</label>
                                            {(ad as any).catalog_id && productSets[(ad as any).catalog_id]?.length > 0 ? (
                                              <select value={(ad as any).product_set_id || ''}
                                                onChange={(e) => updateAdSetCreativeField(i, ad.creative_id, 'product_set_id', e.target.value)}
                                                className="w-full px-2 py-1 border border-gray-200 rounded text-xs bg-white">
                                                <option value="">전체 제품</option>
                                                {productSets[(ad as any).catalog_id].map(ps => <option key={ps.id} value={ps.id}>{ps.name} ({ps.id})</option>)}
                                              </select>
                                            ) : (
                                              <input type="text" value={(ad as any).product_set_id || ''}
                                                onChange={(e) => updateAdSetCreativeField(i, ad.creative_id, 'product_set_id', e.target.value)}
                                                placeholder="제품 세트 ID" className="w-full px-2 py-1 border border-gray-200 rounded text-xs" />
                                            )}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </details>

                                  {/* ── 4. 랜딩 페이지 + UTM ── */}
                                  <details className="border-t border-gray-100" open>
                                    <summary className="px-2 py-1.5 text-[10px] font-medium text-gray-600 cursor-pointer hover:bg-gray-50 flex items-center gap-1">
                                      <MapPin size={10} /> 랜딩 페이지 {ad.link_url ? '✓' : ''}
                                    </summary>
                                    <div className="px-2 pb-2 space-y-1.5">
                                      <div>
                                        <label className="text-[10px] text-gray-500">랜딩 페이지 URL <span className="text-red-400">*</span></label>
                                        <input type="url" value={ad.link_url}
                                          onChange={(e) => {
                                            updateAdSetCreativeField(i, ad.creative_id, 'link_url', e.target.value);
                                            // UTM 자동 생성
                                            const label = (ad as any).utm_label || '';
                                            if (label) {
                                              const utm = `utm_source=facebook&utm_medium=cpc&utm_campaign=${encodeURIComponent(label)}&utm_content=${ad.format === 'carousel' ? 'carousel' : 'single'}`;
                                              updateAdSetCreativeField(i, ad.creative_id, 'url_params', utm);
                                            }
                                          }}
                                          placeholder="https://www.nuldam.com/product/list.html?cate_no=62"
                                          className={`w-full px-2 py-1 border rounded text-xs ${!ad.link_url ? 'border-red-200 bg-red-50' : 'border-gray-200'}`} />
                                      </div>
                                      <div>
                                        <label className="text-[10px] text-gray-500">UTM 구분값 <span className="text-gray-400">(빈칸 시 생략)</span></label>
                                        <input type="text" value={(ad as any).utm_label || ''}
                                          onChange={(e) => {
                                            updateAdSetCreativeField(i, ad.creative_id, 'utm_label', e.target.value);
                                            // UTM 자동 생성
                                            const label = e.target.value;
                                            if (label) {
                                              const utm = `utm_source=facebook&utm_medium=cpc&utm_campaign=${encodeURIComponent(label)}&utm_content=${ad.format === 'carousel' ? 'carousel' : 'single'}`;
                                              updateAdSetCreativeField(i, ad.creative_id, 'url_params', utm);
                                            } else {
                                              updateAdSetCreativeField(i, ad.creative_id, 'url_params', '');
                                            }
                                          }}
                                          placeholder="260323_promotion"
                                          className="w-full px-2 py-1 border border-gray-200 rounded text-xs" />
                                      </div>
                                      {ad.link_url && (ad as any).utm_label && (
                                        <div>
                                          <label className="text-[10px] text-gray-500">UTM 확인 (자동 생성)</label>
                                          <div className="p-1.5 bg-gray-50 rounded text-[10px] text-gray-600 break-all font-mono">
                                            {ad.link_url}{ad.link_url.includes('?') ? '&' : '?'}{ad.url_params}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </details>

                                  {/* ── 5. 추적 설정 ── */}
                                  <details className="border-t border-gray-100">
                                    <summary className="px-2 py-1.5 text-[10px] font-medium text-gray-600 cursor-pointer hover:bg-gray-50 flex items-center gap-1">
                                      <Target size={10} /> 추적 설정
                                    </summary>
                                    <div className="px-2 pb-2 space-y-2">
                                      <div>
                                        <label className="text-[10px] text-gray-500">추적 이벤트</label>
                                        <div className="flex flex-wrap gap-1 mt-1">
                                          {['Purchase', 'AddToCart', 'ViewContent', 'Lead', 'CompleteRegistration'].map(evt => (
                                            <button key={evt}
                                              onClick={() => {
                                                const current: string[] = (ad as any).pixel_events || [];
                                                const next = current.includes(evt)
                                                  ? current.filter((e: string) => e !== evt)
                                                  : [...current, evt];
                                                const updated = [...segments];
                                                const seg = { ...updated[i] };
                                                seg.ads = (seg.ads || []).map(a =>
                                                  a.creative_id === ad.creative_id ? { ...a, pixel_events: next } : a
                                                );
                                                updated[i] = seg;
                                                setSegments(updated);
                                              }}
                                              className={`text-[10px] px-2 py-0.5 rounded border ${
                                                ((ad as any).pixel_events || []).includes(evt)
                                                  ? 'bg-blue-100 border-blue-300 text-blue-700'
                                                  : 'border-gray-200 text-gray-500'
                                              }`}>
                                              {evt}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                      <div>
                                        <label className="text-[10px] text-gray-500">조회 태그 (impression tracking URLs)</label>
                                        <textarea
                                          value={((ad as any).view_tags || []).join('\n')}
                                          onChange={e => {
                                            const tags = e.target.value.split('\n').filter(Boolean);
                                            const updated = [...segments];
                                            const seg = { ...updated[i] };
                                            seg.ads = (seg.ads || []).map(a =>
                                              a.creative_id === ad.creative_id ? { ...a, view_tags: tags } : a
                                            );
                                            updated[i] = seg;
                                            setSegments(updated);
                                          }}
                                          placeholder="https://tracking.example.com/pixel?id=123"
                                          className="w-full px-2 py-1 border border-gray-200 rounded text-[10px] h-12 resize-none"
                                          rows={2}
                                        />
                                      </div>
                                    </div>
                                  </details>

                                  {/* ── 6. 어드밴티지+ 크리에이티브 ── */}
                                  <details className="border-t border-gray-100">
                                    <summary className="px-2 py-1.5 text-[10px] font-medium text-gray-600 cursor-pointer hover:bg-gray-50 flex items-center gap-1">
                                      <ToggleRight size={10} /> 어드밴티지+ 크리에이티브 {(ad as any).advantage_plus_creative ? '(ON)' : ''}
                                    </summary>
                                    <div className="px-2 pb-2">
                                      <label className="flex items-center gap-2 cursor-pointer">
                                        <input type="checkbox" checked={(ad as any).advantage_plus_creative ?? false}
                                          onChange={(e) => updateAdSetCreativeField(i, ad.creative_id, 'advantage_plus_creative', e.target.checked ? 'true' : 'false')}
                                          className="w-3.5 h-3.5 rounded" />
                                        <div><span className="text-[10px] font-medium text-gray-700">어드밴티지+ 크리에이티브 활성화</span>
                                        <p className="text-[9px] text-gray-400">Meta AI가 광고 소재를 자동 최적화합니다</p></div>
                                      </label>
                                    </div>
                                  </details>

                                  {/* ── 7. 파트너십 광고 ── */}
                                  <details className="border-t border-gray-100 mt-1">
                                    <summary className="px-2 py-1.5 text-[10px] text-gray-500 cursor-pointer hover:bg-gray-50">파트너십 광고 설정</summary>
                                    <div className="mt-1 space-y-1.5 px-2 pb-2 bg-gray-50 rounded">
                                      <label className="flex items-center gap-1.5 text-[10px]">
                                        <input type="checkbox" checked={(ad as any).partnership_enabled || false}
                                          onChange={e => updateAdSetCreativeField(i, ad.creative_id, 'partnership_enabled' as any, String(e.target.checked))} />
                                        파트너십 광고 활성화
                                      </label>
                                      {(ad as any).partnership_enabled && (
                                        <input placeholder="파트너 페이지 ID"
                                          value={(ad as any).partner_page_id || ''}
                                          onChange={e => updateAdSetCreativeField(i, ad.creative_id, 'partner_page_id' as any, e.target.value)}
                                          className="w-full px-2 py-1 border border-gray-200 rounded text-[10px]" />
                                      )}
                                    </div>
                                  </details>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[10px] text-gray-400 text-center py-1">소재를 추가하세요</p>
                          )}
                        </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

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

            {/* ── 예산 사용 설정 (CBO vs 광고세트별) ── */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">예산 사용 설정</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setBudgetLevel('campaign')}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    budgetLevel === 'campaign'
                      ? 'bg-primary-500 text-white'
                      : 'bg-white border border-gray-300 text-gray-600 hover:border-primary-300'
                  }`}
                >
                  캠페인별 예산 사용
                </button>
                <button
                  onClick={() => setBudgetLevel('adset')}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    budgetLevel === 'adset'
                      ? 'bg-primary-500 text-white'
                      : 'bg-white border border-gray-300 text-gray-600 hover:border-primary-300'
                  }`}
                >
                  광고세트별 예산 사용
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1.5">
                {budgetLevel === 'campaign'
                  ? '캠페인 예산 안에서 광고세트별 예산이 자동 분배됩니다 (CBO).'
                  : '각 광고세트에서 개별적으로 예산을 설정합니다.'}
              </p>
            </div>

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

            {/* ═══ STEP 2: 광고세트 관리 ═══ */}
            {activeStep === 2 && (<div className="space-y-4">

            {/* ── 광고세트 추가 ── */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers size={16} className="text-blue-600" />
                <span className="text-sm font-semibold text-gray-800">광고세트 ({segments.length}개)</span>
                {enabledSegments.length > 0 && totalRatio !== 100 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded ${totalRatio > 100 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
                    비중 {totalRatio}%
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {enabledSegments.length > 1 && (
                  <button onClick={distributeRatiosEvenly}
                    className="text-xs text-blue-600 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50">
                    균등 배분
                  </button>
                )}
                <button
                  onClick={() => setShowAdSetPreview(!showAdSetPreview)}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-50"
                >
                  <Eye size={12} /> 미리보기
                </button>
              </div>
            </div>

            {/* 광고세트 유형 선택 + 추가 */}
            <div className="flex gap-1.5 flex-wrap">
              {([
                { type: 'BROAD' as const, label: '+ 브로드', color: 'border-purple-300 text-purple-700 hover:bg-purple-50' },
                { type: 'RETARGET' as const, label: '+ 리타겟', color: 'border-orange-300 text-orange-700 hover:bg-orange-50' },
                { type: 'INTEREST' as const, label: '+ 관심사', color: 'border-teal-300 text-teal-700 hover:bg-teal-50' },
                { type: 'CUSTOM' as const, label: '+ 커스텀', color: 'border-blue-300 text-blue-700 hover:bg-blue-50' },
              ]).map(({ type, label, color }) => (
                <button key={type} onClick={() => addAdSet(type)}
                  className={`px-2.5 py-1.5 border rounded-lg text-xs font-medium transition-colors ${color}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* ── 광고세트 카드 목록 ── */}
            {segments.length === 0 && (
              <div className="p-6 text-center border-2 border-dashed border-gray-200 rounded-lg">
                <Layers size={24} className="mx-auto text-gray-400 mb-2" />
                <p className="text-sm text-gray-500">광고세트를 추가해주세요</p>
                <p className="text-xs text-gray-400 mt-1">위 버튼으로 브로드, 리타겟, 관심사, 커스텀 유형을 추가할 수 있습니다.</p>
              </div>
            )}

            <div className="space-y-3">
              {segments.map((seg, i) => {
                const isExpanded = expandedAdSets[i] ?? false;
                const t = seg.targeting || defaultTargetingConfig();
                const typeBadge = seg.type === 'BROAD' ? 'bg-purple-100 text-purple-700'
                  : seg.type === 'RETARGET' ? 'bg-orange-100 text-orange-700'
                  : seg.type === 'INTEREST' ? 'bg-teal-100 text-teal-700'
                  : 'bg-blue-100 text-blue-700';
                const cardBorder = seg.enabled
                  ? (seg.type === 'BROAD' ? 'border-purple-200' : seg.type === 'RETARGET' ? 'border-orange-200' : seg.type === 'INTEREST' ? 'border-teal-200' : 'border-blue-200')
                  : 'border-gray-200';

                return (
                  <div key={i} className={`rounded-lg border transition-colors ${cardBorder} ${!seg.enabled ? 'opacity-50' : ''}`}>
                    {/* Card Header */}
                    <div className="flex items-center gap-2 p-3 cursor-pointer" onClick={() => toggleAdSetExpanded(i)}>
                      <button onClick={(e) => { e.stopPropagation(); toggleSegmentEnabled(i); }} className="flex-shrink-0">
                        {seg.enabled ? <ToggleRight size={20} className="text-green-500" /> : <ToggleLeft size={20} className="text-gray-400" />}
                      </button>
                      <input
                        type="text" value={seg.name}
                        onChange={(e) => updateSegmentName(i, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 text-sm font-medium text-gray-800 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-400 focus:outline-none px-1 py-0.5 min-w-0"
                      />
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${typeBadge}`}>
                        {seg.type === 'BROAD' ? '브로드' : seg.type === 'RETARGET' ? '리타겟' : seg.type === 'INTEREST' ? '관심사' : '커스텀'}
                      </span>
                      <span className="text-xs font-semibold text-blue-600 flex-shrink-0 w-8 text-right">{seg.ratio}%</span>
                      <button onClick={(e) => { e.stopPropagation(); duplicateAdSet(i); }} className="text-gray-400 hover:text-blue-500 flex-shrink-0" title="복제">
                        <Copy size={13} />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); removeSegment(i); }} className="text-gray-400 hover:text-red-500 flex-shrink-0" title="삭제">
                        <X size={14} />
                      </button>
                      {isExpanded ? <ChevronUp size={14} className="text-gray-400 flex-shrink-0" /> : <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />}
                    </div>

                    {/* Card Body - expanded & enabled */}
                    {isExpanded && seg.enabled && (
                      <div className="px-3 pb-3 space-y-3 border-t border-gray-100">
                        {seg.description && (
                          <p className="text-xs text-gray-500 italic pt-2">{seg.description}</p>
                        )}

                        {/* 예산 비중 or 개별 예산 */}
                        {budgetLevel === 'campaign' ? (
                          <div className="flex items-center gap-2 pt-2">
                            <span className="text-xs text-gray-500 w-14">예산 비중:</span>
                            <input type="range" min={5} max={80} value={seg.ratio}
                              onChange={(e) => updateSegmentRatio(i, Number(e.target.value))}
                              className="flex-1 h-1.5 accent-blue-500" />
                            <span className="text-xs font-semibold text-blue-600 w-10 text-right">{seg.ratio}%</span>
                            {budget && (
                              <span className="text-[10px] text-gray-400">
                                ({'\u20A9'}{Math.round(Number(budget) * seg.ratio / (totalRatio || 100)).toLocaleString()})
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 pt-2">
                            <span className="text-xs text-gray-500 w-20">일일 예산:</span>
                            <div className="flex items-center gap-1 flex-1">
                              <span className="text-xs text-gray-400">{'\u20A9'}</span>
                              <input type="number" placeholder="50,000"
                                value={seg.daily_budget || ''}
                                onChange={(e) => { const u = [...segments]; u[i] = { ...u[i], daily_budget: Number(e.target.value) || 0 }; setSegments(u); }}
                                className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs" />
                            </div>
                          </div>
                        )}

                        {/* ── 타겟팅 설정 ── */}
                        <div className="p-3 bg-gray-50 rounded-lg space-y-3">
                          <p className="text-xs font-medium text-gray-600 flex items-center gap-1"><Crosshair size={12} /> 타겟팅</p>

                          {/* 연령 */}
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 w-10">연령:</span>
                            <input type="number" min={13} max={65}
                              value={t.age_range?.min_age ?? 18}
                              onChange={(e) => updateSegmentTargeting(i, 'min_age', Number(e.target.value) || 0)}
                              onBlur={(e) => {
                                const v = Math.max(13, Math.min(Number(e.target.value) || 18, t.age_range?.max_age ?? 65));
                                updateSegmentTargeting(i, 'min_age', v);
                              }}
                              className="w-14 px-2 py-1 border border-gray-300 rounded text-xs text-center" />
                            <span className="text-xs text-gray-400">~</span>
                            <input type="number" min={13} max={65}
                              value={t.age_range?.max_age ?? 65}
                              onChange={(e) => updateSegmentTargeting(i, 'max_age', Number(e.target.value) || 0)}
                              onBlur={(e) => {
                                const v = Math.min(65, Math.max(Number(e.target.value) || 65, t.age_range?.min_age ?? 13));
                                updateSegmentTargeting(i, 'max_age', v);
                              }}
                              className="w-14 px-2 py-1 border border-gray-300 rounded text-xs text-center" />
                            <span className="text-xs text-gray-500">세</span>
                          </div>

                          {/* 성별 */}
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 w-10">성별:</span>
                            <div className="flex gap-1">
                              {[{ value: 'all', label: '전체' }, { value: 'male', label: '남성' }, { value: 'female', label: '여성' }].map((g) => (
                                <button key={g.value}
                                  onClick={() => updateSegmentTargeting(i, 'genders', [g.value])}
                                  className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                                    (t.genders || ['all']).includes(g.value)
                                      ? 'bg-blue-500 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:border-blue-300'
                                  }`}>
                                  {g.label}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* 지역 */}
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 w-10">지역:</span>
                            <div className="flex gap-1">
                              {[{ value: 'KR', label: '한국' }, { value: 'US', label: '미국' }, { value: 'JP', label: '일본' }].map((c) => (
                                <button key={c.value}
                                  onClick={() => {
                                    const cur = t.geo?.countries || ['KR'];
                                    updateSegmentTargeting(i, 'countries', cur.includes(c.value) ? cur.filter(cc => cc !== c.value) : [...cur, c.value]);
                                  }}
                                  className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                                    (t.geo?.countries || ['KR']).includes(c.value)
                                      ? 'bg-blue-500 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:border-blue-300'
                                  }`}>
                                  {c.label}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* 관심사 (for INTEREST, CUSTOM, or any type) */}
                          {(seg.type === 'INTEREST' || seg.type === 'CUSTOM' || seg.type === 'BROAD') && (
                            <div>
                              <div className="flex items-center gap-1 mb-1">
                                <span className="text-xs text-gray-500 w-10">관심사:</span>
                                <input type="text" placeholder="관심사 입력 후 Enter"
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      const val = (e.target as HTMLInputElement).value.trim();
                                      if (val) {
                                        const cur = t.interests?.interests || [];
                                        if (!cur.includes(val)) {
                                          updateSegmentTargeting(i, 'interests', [...cur, val]);
                                        }
                                        (e.target as HTMLInputElement).value = '';
                                      }
                                    }
                                  }}
                                  className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs" />
                              </div>
                              {(t.interests?.interests || []).length > 0 && (
                                <div className="flex flex-wrap gap-1 ml-12">
                                  {(t.interests?.interests || []).map((interest: string, j: number) => (
                                    <span key={j} className="inline-flex items-center gap-0.5 text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                                      {interest}
                                      <button onClick={() => {
                                        const cur = t.interests?.interests || [];
                                        updateSegmentTargeting(i, 'interests', cur.filter((_: string, k: number) => k !== j));
                                      }} className="hover:text-red-500"><X size={10} /></button>
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* ── 유형별 추가 설정 ── */}
                        {seg.type === 'BROAD' && (
                          <div className="text-xs text-gray-500 p-2 bg-purple-50 rounded">
                            <p>넓은 타겟팅 — Meta Advantage+가 자동으로 최적 오디언스를 탐색합니다.</p>
                          </div>
                        )}

                        {/* ── 맞춤 타겟 (모든 세그먼트 공통) ── */}
                        <div className="space-y-2">
                          <AudienceSearchSelect
                            label="맞춤 타겟 (커스텀 오디언스)"
                            color="orange"
                            audiences={metaCustomAudiences}
                            selected={seg.custom_audiences || []}
                            isLoading={isLoadingAudiences}
                            error={audiencesError ? '네트워크 오류' : audiencesApiError}
                            onChange={(ids) => {
                              const updated = [...segments];
                              updated[i] = { ...updated[i], custom_audiences: ids };
                              setSegments(updated);
                            }}
                          />
                          <AudienceSearchSelect
                            label="제외 오디언스"
                            color="red"
                            audiences={metaCustomAudiences}
                            selected={seg.exclusion_audiences || []}
                            isLoading={isLoadingAudiences}
                            error={audiencesError ? '네트워크 오류' : audiencesApiError}
                            onChange={(ids) => {
                              const updated = [...segments];
                              updated[i] = { ...updated[i], exclusion_audiences: ids };
                              setSegments(updated);
                            }}
                          />
                            {(seg.custom_audiences || []).length > 0 && (
                              <p className="text-[10px] text-amber-600">맞춤 타겟 사용 시 Meta 맞춤 타겟 약관 동의가 필요합니다.</p>
                            )}
                          </div>

                        {/* 세그먼트별 일정 */}
                        <details className="mt-1">
                          <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">일정 설정 (선택)</summary>
                          <div className="grid grid-cols-2 gap-2 mt-1.5">
                            <div>
                              <label className="text-xs text-gray-500">시작일</label>
                              <input type="date" value={seg.start_date || ''}
                                onChange={(e) => { const u = [...segments]; u[i] = { ...u[i], start_date: e.target.value }; setSegments(u); }}
                                className="w-full px-2 py-1 border border-gray-200 rounded text-xs" />
                            </div>
                            <div>
                              <label className="text-xs text-gray-500">종료일</label>
                              <input type="date" value={seg.end_date || ''}
                                onChange={(e) => { const u = [...segments]; u[i] = { ...u[i], end_date: e.target.value }; setSegments(u); }}
                                className="w-full px-2 py-1 border border-gray-200 rounded text-xs" />
                            </div>
                          </div>
                        </details>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 비중 합계 경고 */}
            {enabledSegments.length > 0 && totalRatio !== 100 && (
              <p className={`text-xs ${totalRatio > 100 ? 'text-red-600' : 'text-amber-600'}`}>
                광고세트 비중 합계: {totalRatio}% — 100%와 다릅니다. 발행 시 비율 기준으로 자동 배분됩니다.
              </p>
            )}

            {/* 비중 시각화 바 */}
            {enabledSegments.length > 0 && (
              <div className="flex h-2 rounded-full overflow-hidden bg-gray-200">
                {enabledSegments.map((seg, i) => {
                  const width = (seg.ratio / (totalRatio || 1)) * 100;
                  const color = seg.type === 'BROAD' ? 'bg-purple-400' : seg.type === 'RETARGET' ? 'bg-orange-400' : seg.type === 'INTEREST' ? 'bg-teal-400' : 'bg-blue-400';
                  return <div key={i} className={`${color} transition-all`} style={{ width: `${width}%` }} title={`${seg.name}: ${seg.ratio}%`} />;
                })}
              </div>
            )}

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
                            : preset.type === 'CUSTOM' ? 'bg-blue-100 text-blue-700'
                            : 'bg-teal-100 text-teal-700'
                          }`}>{preset.type === 'BROAD' ? '브로드' : preset.type === 'RETARGET' ? '리타겟' : preset.type === 'CUSTOM' ? '커스텀' : '관심사'}</span>
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

            {/* ── 입찰 전략 ── */}
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-sm font-medium text-gray-700 mb-2">입찰 전략</p>
              <select
                value={bidStrategy}
                onChange={(e) => { setBidStrategy(e.target.value); if (!e.target.value) setBidAmount(''); }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="">자동 (최저 비용)</option>
                <option value="LOWEST_COST_WITH_BID_CAP">입찰가 한도 (Bid Cap)</option>
                <option value="COST_CAP">비용 한도 (Cost Cap)</option>
                <option value="MINIMUM_ROAS">최소 ROAS</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                {!bidStrategy && 'Meta가 자동으로 최저 비용에 입찰합니다.'}
                {bidStrategy === 'LOWEST_COST_WITH_BID_CAP' && '입찰당 최대 금액을 설정합니다.'}
                {bidStrategy === 'COST_CAP' && '결과당 평균 비용 목표를 설정합니다.'}
                {bidStrategy === 'MINIMUM_ROAS' && '최소 광고비 대비 수익률을 설정합니다.'}
              </p>

              {bidStrategy && (
                <div className="mt-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {bidStrategy === 'MINIMUM_ROAS' ? '최소 ROAS' : '입찰 금액 (원)'}
                    <span className="text-red-500 ml-0.5">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={bidAmount}
                      onChange={(e) => setBidAmount(e.target.value)}
                      placeholder={bidStrategy === 'MINIMUM_ROAS' ? '예: 200 (2.0x ROAS)' : '예: 5000'}
                      className={`w-full px-3 py-2 border rounded-lg text-sm focus:ring-primary-500 focus:border-primary-500 ${
                        bidStrategy && !bidAmount ? 'border-red-300 bg-red-50' : 'border-gray-300'
                      }`}
                    />
                    {bidStrategy && !bidAmount && (
                      <p className="text-xs text-red-500 mt-1 font-medium">
                        {bidStrategy === 'MINIMUM_ROAS'
                          ? '최소 ROAS 값을 입력해주세요 (필수)'
                          : '입찰 금액을 입력해주세요 (필수)'}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

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

            {/* 미입력 항목 안내 */}
            {(!budget || (!!bidStrategy && !bidAmount)) && (
              <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-xs font-medium text-amber-800 flex items-center gap-1"><AlertTriangle size={12} /> 필수 항목을 확인해주세요</p>
                <ul className="text-xs text-amber-700 mt-1 space-y-0.5 list-disc list-inside">
                  {!budget && <li>Step 1에서 <button onClick={() => setActiveStep(1)} className="underline text-blue-600">예산</button>을 입력해주세요</li>}
                  {!!bidStrategy && !bidAmount && <li>입찰 전략을 선택했으면 입찰 금액을 입력해주세요</li>}
                </ul>
              </div>
            )}

            {editingCampaignId ? (
              <>
                <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-lg mb-2">
                  <p className="text-xs font-medium text-blue-800 flex items-center gap-1">
                    <Pencil size={12} /> 캠페인 수정 모드 — 변경 후 "수정 완료"를 눌러주세요
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={() => updateCampaignMutation.mutate()}
                    loading={updateCampaignMutation.isPending} disabled={!budget}>
                    수정 완료
                  </Button>
                  <button
                    onClick={cancelEdit}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 hover:border-gray-400 transition-colors"
                  >
                    취소
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={() => createCampaignMutation.mutate()}
                    loading={createCampaignMutation.isPending} disabled={!budget || (!!bidStrategy && !bidAmount)}>
                    캠페인 생성
                  </Button>
                  <button
                    onClick={saveDraft}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 hover:border-gray-400 transition-colors flex items-center gap-1.5"
                    title="임시 저장"
                  >
                    <Save size={14} />
                    임시 저장
                  </button>
                </div>
                {loadedDraftId && (
                  <p className="text-xs text-blue-600 flex items-center gap-1 mt-1">
                    <FolderOpen size={11} /> 초안에서 불러온 상태 — 캠페인 생성 시 초안이 자동 삭제됩니다
                  </p>
                )}
              </>
            )}
          </div>
        </Card>

        {/* ── 임시 저장 목록 ── */}
        {drafts.length > 0 && (
          <Card variant="bordered" className="mt-3">
            <div className="flex items-center justify-between mb-3">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <Save size={14} className="text-gray-500" />
                임시 저장 ({drafts.length})
              </CardTitle>
            </div>
            <div className="space-y-2">
              {drafts.map((draft) => {
                const savedDate = new Date(draft.savedAt);
                const objLabel = OBJECTIVE_OPTIONS.find(o => o.value === draft.formData.objective)?.label || draft.formData.objective;
                const isLoaded = loadedDraftId === draft.id;
                return (
                  <div key={draft.id}
                    className={`p-2.5 rounded-lg border transition-colors ${isLoaded ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{draft.name}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-xs text-gray-500">{objLabel}</span>
                          {draft.formData.budget && (
                            <span className="text-xs text-gray-500">
                              {Number(draft.formData.budget).toLocaleString()}원
                            </span>
                          )}
                          <span className="text-xs text-gray-400 flex items-center gap-0.5">
                            <Clock size={10} />
                            {savedDate.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => loadDraft(draft)}
                          className="px-2 py-1 text-xs rounded bg-white border border-gray-300 text-gray-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-colors"
                        >
                          불러오기
                        </button>
                        <button
                          onClick={() => { if (confirm('이 초안을 삭제할까요?')) deleteDraft(draft.id); }}
                          className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                          title="삭제"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
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
                  onEdit={() => editCampaign(campaign)}
                  onDuplicate={() => duplicateCampaign(campaign)}
                  onViewAnalytics={() => handleViewAnalytics(campaign)}
                  isPublishing={publishMutation.isPending}
                  isEditing={editingCampaignId === campaign.id}
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

      {/* ── 미리보기 모달 ── */}
      {previewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setPreviewUrl(null)}>
          <div className="relative max-w-3xl max-h-[90vh] m-4" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setPreviewUrl(null)}
              className="absolute -top-3 -right-3 w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center hover:bg-gray-100 z-10">
              <X size={16} />
            </button>
            {previewUrl.match(/\.(mp4|mov|webm|avi)$/i) ? (
              <video src={previewUrl} controls autoPlay className="max-w-full max-h-[85vh] rounded-lg shadow-2xl" />
            ) : (
              <img src={previewUrl} alt="미리보기" className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
                onError={(e) => { e.currentTarget.src = IMG_FALLBACK; }} />
            )}
          </div>
        </div>
      )}
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
  campaign, onPublish, onEdit, onDuplicate, onViewAnalytics, isPublishing, isEditing, onRefresh,
}: {
  campaign: Campaign; onPublish: () => void; onEdit: () => void; onDuplicate: () => void; onViewAnalytics: () => void;
  isPublishing: boolean; isEditing?: boolean; onRefresh: () => void;
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
    <div className={`border rounded-lg overflow-hidden ${isEditing ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-200'}`}>
      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-medium text-gray-900">{campaign.name}</h3>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${sc.color}`}>{sc.label}</span>
              {isEditing && <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">수정 중</span>}
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

        {/* 타겟팅 요약 — 세그먼트별 표시 */}
        {(() => {
          const segs = campaign.targeting_segments as any[] | undefined;
          const t = campaign.targeting;
          if (segs && segs.length > 0) {
            return (
              <div className="mb-3 space-y-1">
                {segs.filter((s: any) => s.enabled !== false).map((seg: any, i: number) => {
                  const st = seg.targeting || t || {};
                  const genders = st.genders ?? ['all'];
                  const genderLabel = genders.includes('all') ? '전체' : genders.includes('male') ? '남성' : genders.includes('female') ? '여성' : genders.join(',');
                  return (
                    <div key={i} className="flex flex-wrap gap-1 items-center">
                      <span className="text-[10px] font-medium text-gray-500 w-12">{seg.name}</span>
                      <span className="inline-flex items-center gap-0.5 text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                        {st.age_range?.min_age ?? 18}-{st.age_range?.max_age ?? 65}세
                      </span>
                      <span className="inline-flex items-center gap-0.5 text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                        {genderLabel}
                      </span>
                      <span className="inline-flex items-center gap-0.5 text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                        {st.geo?.countries?.join(', ') || 'KR'}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          }
          if (!t) return null;
          const genders = t.genders ?? ['all'];
          const genderLabel = genders.includes('all') ? '전체' : genders.includes('male') ? '남성' : genders.includes('female') ? '여성' : genders.join(',');
          return (
            <div className="mb-3 flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                <Users size={10} /> {t.age_range?.min_age ?? 18}-{t.age_range?.max_age ?? 65}세
              </span>
              <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{genderLabel}</span>
              {t.geo?.countries && (
                <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                  <MapPin size={10} /> {t.geo.countries.join(', ')}
                </span>
              )}
            </div>
          );
        })()}

        {/* 액션 버튼 */}
        <div className="flex flex-wrap gap-2">
          {campaign.status === 'DRAFT' && (
            <>
              <Button size="sm" variant="outline" onClick={onEdit} disabled={isEditing}>
                <Pencil size={14} className="mr-1" /> {isEditing ? '수정 중...' : '수정'}
              </Button>
              <Button size="sm" onClick={onPublish} loading={isPublishing}>
                <Upload size={14} className="mr-1" /> Meta 발행
              </Button>
            </>
          )}
          {/* Custom Audience TOS Warning — shown when a RETARGET segment is active */}
          {campaign.status === 'DRAFT' && campaign.targeting_segments?.some((s: any) => s.type === 'RETARGET' && s.enabled !== false) && (
            <div className="w-full mt-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs">
              <div className="flex items-start gap-1.5">
                <AlertTriangle size={12} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-amber-800">리타겟팅 사전 설정 필요</p>
                  <p className="text-amber-600 mt-0.5">맞춤 타겟 약관에 동의해야 Meta 발행이 가능합니다.</p>
                  <a
                    href={`https://business.facebook.com/ads/manage/customaudiences/tos/?act=${campaign.meta_campaign_id || ''}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline mt-1 inline-block"
                  >
                    Meta 맞춤 타겟 약관 동의하기 →
                  </a>
                </div>
              </div>
            </div>
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
          <Button size="sm" variant="outline" onClick={onDuplicate}>
            <Copy size={14} className="mr-1" /> 복제
          </Button>
          <Button size="sm" variant="outline" onClick={handleDelete} loading={deleteMutation.isPending}
            className="text-red-600 border-red-200 hover:bg-red-50">
            <Trash2 size={14} className="mr-1" /> 삭제
          </Button>
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


// ── AudienceSearchSelect: 검색형 오디언스 선택 컴포넌트 ──

function AudienceSearchSelect({
  label,
  color,
  audiences,
  selected,
  isLoading,
  error,
  onChange,
}: {
  label: string;
  color: 'orange' | 'red';
  audiences: Array<{ id: string; name: string; approximate_count_lower_bound?: number }>;
  selected: string[];
  isLoading: boolean;
  error?: string | null;
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = audiences.filter(a =>
    a.name.toLowerCase().includes(query.toLowerCase())
  );

  const selectedAudiences = audiences.filter(a => selected.includes(a.id));

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  };

  const remove = (id: string) => onChange(selected.filter(x => x !== id));

  const bgColor = color === 'orange' ? 'bg-orange-50' : 'bg-red-50';
  const borderColor = color === 'orange' ? 'border-orange-200' : 'border-red-200';
  const labelColor = color === 'orange' ? 'text-orange-700' : 'text-red-700';
  const tagBg = color === 'orange' ? 'bg-orange-100 text-orange-800' : 'bg-red-100 text-red-800';

  return (
    <div className={`p-2 ${bgColor} rounded`} ref={ref}>
      <p className={`text-xs font-medium ${labelColor} mb-1.5`}>{label}</p>
      {isLoading ? (
        <p className="text-xs text-gray-400">불러오는 중...</p>
      ) : error ? (
        <p className="text-xs text-red-500">{error}</p>
      ) : audiences.length === 0 ? (
        <p className="text-xs text-gray-400">등록된 오디언스가 없습니다.</p>
      ) : (
        <>
          {/* 선택된 태그 */}
          {selectedAudiences.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1.5">
              {selectedAudiences.map(a => (
                <span key={a.id} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${tagBg}`}>
                  {a.name}
                  <button onClick={() => remove(a.id)} className="hover:text-red-600 ml-0.5">&times;</button>
                </span>
              ))}
            </div>
          )}
          {/* 검색 입력 */}
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              placeholder="오디언스 검색..."
              className={`w-full px-2.5 py-1.5 text-xs border ${borderColor} rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-400`}
            />
            {/* 드롭다운 */}
            {open && (
              <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {filtered.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-gray-400">일치하는 오디언스가 없습니다</p>
                ) : (
                  filtered.map(a => {
                    const isSelected = selected.includes(a.id);
                    return (
                      <button
                        key={a.id}
                        onClick={() => { toggle(a.id); setQuery(''); }}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center justify-between ${isSelected ? 'bg-blue-50' : ''}`}
                      >
                        <span className="flex items-center gap-1.5">
                          <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-white text-[9px] ${isSelected ? 'bg-blue-500 border-blue-500' : 'border-gray-300'}`}>
                            {isSelected ? '✓' : ''}
                          </span>
                          {a.name}
                        </span>
                        {a.approximate_count_lower_bound ? (
                          <span className="text-gray-400 text-[10px]">~{a.approximate_count_lower_bound.toLocaleString()}</span>
                        ) : null}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
