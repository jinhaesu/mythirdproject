'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  LayoutGrid, Users, FileText, Link2, Upload, BarChart3,
  Plus, Trash2, ChevronDown, ChevronUp, Loader2
} from 'lucide-react';
import { Button, Input, Card, CardTitle } from '@/components/ui';
import { campaignPlannerApi } from '@/lib/api';
import toast from 'react-hot-toast';

type PlannerSection = 'structure' | 'targeting' | 'copywriting' | 'utm' | 'csv' | 'predict';

export function CampaignPlanner() {
  const [activeSection, setActiveSection] = useState<PlannerSection>('structure');

  const sections = [
    { id: 'structure' as const, label: '캠페인 구조', icon: LayoutGrid, desc: '신제품/주력/소진용 구조 설계' },
    { id: 'targeting' as const, label: '타겟 설계', icon: Users, desc: 'Broad/Interest/Retarget 설계' },
    { id: 'copywriting' as const, label: '카피라이팅', icon: FileText, desc: '광고 문구 자동 생성' },
    { id: 'utm' as const, label: 'UTM 생성', icon: Link2, desc: 'UTM 링크 자동 생성' },
    { id: 'csv' as const, label: 'CSV 분석', icon: Upload, desc: '성과 데이터 분석' },
    { id: 'predict' as const, label: '소재 예측', icon: BarChart3, desc: '소재 성과 예측' },
  ];

  return (
    <div className="space-y-6">
      {/* 섹션 탭 */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {sections.map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              activeSection === s.id
                ? 'bg-primary-600 text-white shadow-md'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            <s.icon size={16} />
            {s.label}
          </button>
        ))}
      </div>

      {activeSection === 'structure' && <StructureDesigner />}
      {activeSection === 'targeting' && <TargetingDesigner />}
      {activeSection === 'copywriting' && <CopywritingGenerator />}
      {activeSection === 'utm' && <UTMGenerator />}
      {activeSection === 'csv' && <CSVAnalyzer />}
      {activeSection === 'predict' && <CreativePredictor />}
    </div>
  );
}

/* ─── 캠페인 구조 설계 ─── */
function StructureDesigner() {
  const [brandName, setBrandName] = useState('');
  const [totalBudget, setTotalBudget] = useState('');
  const [promoStart, setPromoStart] = useState('');
  const [promoEnd, setPromoEnd] = useState('');
  const [products, setProducts] = useState([
    { name: '', category: '주력', price: '', promo_info: '' },
  ]);
  const [result, setResult] = useState<any>(null);

  const addProduct = () => {
    setProducts([...products, { name: '', category: '주력', price: '', promo_info: '' }]);
  };

  const removeProduct = (index: number) => {
    setProducts(products.filter((_, i) => i !== index));
  };

  const updateProduct = (index: number, field: string, value: string) => {
    const updated = [...products];
    (updated[index] as any)[field] = value;
    setProducts(updated);
  };

  const mutation = useMutation({
    mutationFn: () => campaignPlannerApi.designStructure({
      product_list: products.map((p) => ({
        name: p.name,
        category: p.category,
        price: Number(p.price),
        promo_info: p.promo_info || undefined,
      })),
      schedule: { promo_start_date: promoStart, promo_end_date: promoEnd },
      total_budget: Number(totalBudget),
      brand_name: brandName,
    }),
    onSuccess: (data) => { setResult(data); toast.success('캠페인 구조 설계 완료'); },
    onError: () => toast.error('구조 설계 실패'),
  });

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <Card variant="bordered">
        <CardTitle className="flex items-center gap-2 mb-4">
          <LayoutGrid size={20} />
          캠페인 구조 설계
        </CardTitle>
        <div className="space-y-4">
          <Input label="브랜드명" placeholder="브랜드 이름" value={brandName} onChange={(e) => setBrandName(e.target.value)} />
          <Input label="총 예산 (원)" type="number" placeholder="5000000" value={totalBudget} onChange={(e) => setTotalBudget(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="프로모션 시작일" type="date" value={promoStart} onChange={(e) => setPromoStart(e.target.value)} />
            <Input label="프로모션 종료일" type="date" value={promoEnd} onChange={(e) => setPromoEnd(e.target.value)} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">제품 리스트</label>
              <button onClick={addProduct} className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1">
                <Plus size={14} /> 추가
              </button>
            </div>
            <div className="space-y-3">
              {products.map((p, i) => (
                <div key={i} className="p-3 bg-gray-50 rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-500">제품 {i + 1}</span>
                    {products.length > 1 && (
                      <button onClick={() => removeProduct(i)} className="text-gray-400 hover:text-red-500">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <input className="px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="제품명" value={p.name} onChange={(e) => updateProduct(i, 'name', e.target.value)} />
                    <select className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" value={p.category} onChange={(e) => updateProduct(i, 'category', e.target.value)}>
                      <option value="신제품">신제품</option>
                      <option value="주력">주력</option>
                      <option value="소진용">소진용</option>
                    </select>
                    <input className="px-3 py-2 border border-gray-300 rounded-lg text-sm" type="number" placeholder="가격" value={p.price} onChange={(e) => updateProduct(i, 'price', e.target.value)} />
                  </div>
                  <input className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="프로모션 정보 (선택)" value={p.promo_info} onChange={(e) => updateProduct(i, 'promo_info', e.target.value)} />
                </div>
              ))}
            </div>
          </div>

          <Button className="w-full" onClick={() => mutation.mutate()} loading={mutation.isPending}
            disabled={!brandName || !totalBudget || products.some((p) => !p.name || !p.price)}>
            AI 캠페인 구조 설계
          </Button>
        </div>
      </Card>

      <Card variant="bordered">
        <CardTitle className="mb-4">설계 결과</CardTitle>
        {result ? (
          <div className="prose prose-sm max-w-none">
            <pre className="bg-gray-50 p-4 rounded-lg text-sm whitespace-pre-wrap overflow-auto max-h-[600px]">
              {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
            </pre>
          </div>
        ) : (
          <div className="text-center py-16 text-gray-400">
            <LayoutGrid size={48} className="mx-auto mb-3 opacity-50" />
            <p>제품과 예산을 입력하면</p>
            <p className="text-sm">AI가 캠페인 구조를 설계합니다</p>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ─── 타겟 설계 ─── */
function TargetingDesigner() {
  const [category, setCategory] = useState('');
  const [budget, setBudget] = useState('');
  const [brandInfo, setBrandInfo] = useState('');
  const [result, setResult] = useState<any>(null);

  const mutation = useMutation({
    mutationFn: () => campaignPlannerApi.designTargeting({
      product_category: category,
      budget: Number(budget),
      brand_info: brandInfo || undefined,
    }),
    onSuccess: (data) => { setResult(data); toast.success('타겟 설계 완료'); },
    onError: () => toast.error('타겟 설계 실패'),
  });

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <Card variant="bordered">
        <CardTitle className="flex items-center gap-2 mb-4">
          <Users size={20} />
          타겟 오디언스 설계
        </CardTitle>
        <div className="space-y-4">
          <Input label="제품 카테고리" placeholder="예: 스킨케어, 운동화, SaaS" value={category} onChange={(e) => setCategory(e.target.value)} />
          <Input label="예산 (원)" type="number" placeholder="3000000" value={budget} onChange={(e) => setBudget(e.target.value)} />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">브랜드 정보 (선택)</label>
            <textarea className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none" rows={3}
              placeholder="타겟층, 브랜드 포지셔닝, 과거 성과 등" value={brandInfo} onChange={(e) => setBrandInfo(e.target.value)} />
          </div>
          <Button className="w-full" onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!category || !budget}>
            AI 타겟 설계
          </Button>
        </div>
      </Card>

      <Card variant="bordered">
        <CardTitle className="mb-4">타겟 설계 결과</CardTitle>
        {result ? (
          <pre className="bg-gray-50 p-4 rounded-lg text-sm whitespace-pre-wrap overflow-auto max-h-[600px]">
            {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
          </pre>
        ) : (
          <div className="text-center py-16 text-gray-400">
            <Users size={48} className="mx-auto mb-3 opacity-50" />
            <p>Broad / Interest / Retarget</p>
            <p className="text-sm">3단계 타겟을 AI가 설계합니다</p>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ─── 카피라이팅 생성 ─── */
function CopywritingGenerator() {
  const [purpose, setPurpose] = useState('전환용');
  const [tone, setTone] = useState('professional');
  const [products, setProducts] = useState([{ name: '', description: '', price: '', promo: '' }]);
  const [result, setResult] = useState<any>(null);

  const addProduct = () => setProducts([...products, { name: '', description: '', price: '', promo: '' }]);
  const removeProduct = (i: number) => setProducts(products.filter((_, idx) => idx !== i));
  const updateProduct = (i: number, field: string, value: string) => {
    const updated = [...products];
    (updated[i] as any)[field] = value;
    setProducts(updated);
  };

  const mutation = useMutation({
    mutationFn: () => campaignPlannerApi.generateCopywriting({
      products: products.map((p) => ({ name: p.name, description: p.description, price: Number(p.price), promo: p.promo || undefined })),
      purpose,
      tone,
    }),
    onSuccess: (data) => { setResult(data); toast.success('카피 생성 완료'); },
    onError: () => toast.error('카피 생성 실패'),
  });

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <Card variant="bordered">
        <CardTitle className="flex items-center gap-2 mb-4">
          <FileText size={20} />
          광고 카피 생성
        </CardTitle>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">목적</label>
              <select className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
                <option value="전환용">전환용</option>
                <option value="유입용">유입용</option>
                <option value="잠재고객용">잠재고객용</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">톤</label>
              <select className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" value={tone} onChange={(e) => setTone(e.target.value)}>
                <option value="professional">프로페셔널</option>
                <option value="casual">캐주얼</option>
                <option value="playful">유쾌한</option>
                <option value="urgent">긴급한</option>
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">제품 정보</label>
              <button onClick={addProduct} className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1">
                <Plus size={14} /> 추가
              </button>
            </div>
            {products.map((p, i) => (
              <div key={i} className="p-3 bg-gray-50 rounded-lg space-y-2 mb-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">제품 {i + 1}</span>
                  {products.length > 1 && <button onClick={() => removeProduct(i)} className="text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input className="px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="제품명" value={p.name} onChange={(e) => updateProduct(i, 'name', e.target.value)} />
                  <input className="px-3 py-2 border border-gray-300 rounded-lg text-sm" type="number" placeholder="가격" value={p.price} onChange={(e) => updateProduct(i, 'price', e.target.value)} />
                </div>
                <input className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="제품 설명" value={p.description} onChange={(e) => updateProduct(i, 'description', e.target.value)} />
                <input className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="프로모션 (선택)" value={p.promo} onChange={(e) => updateProduct(i, 'promo', e.target.value)} />
              </div>
            ))}
          </div>

          <Button className="w-full" onClick={() => mutation.mutate()} loading={mutation.isPending}
            disabled={products.some((p) => !p.name)}>
            AI 카피 생성
          </Button>
        </div>
      </Card>

      <Card variant="bordered">
        <CardTitle className="mb-4">생성된 카피</CardTitle>
        {result ? (
          <pre className="bg-gray-50 p-4 rounded-lg text-sm whitespace-pre-wrap overflow-auto max-h-[600px]">
            {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
          </pre>
        ) : (
          <div className="text-center py-16 text-gray-400">
            <FileText size={48} className="mx-auto mb-3 opacity-50" />
            <p>제품 정보를 입력하면</p>
            <p className="text-sm">AI가 광고 카피를 생성합니다</p>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ─── UTM 생성기 ─── */
function UTMGenerator() {
  const [baseUrl, setBaseUrl] = useState('');
  const [productsInput, setProductsInput] = useState('');
  const [campaignNames, setCampaignNames] = useState('');
  const [platforms, setPlatforms] = useState(['facebook']);
  const [result, setResult] = useState<any>(null);

  const mutation = useMutation({
    mutationFn: () => campaignPlannerApi.generateUTM({
      base_url: baseUrl,
      products: productsInput.split(',').map((s) => s.trim()).filter(Boolean),
      campaign_names: campaignNames.split(',').map((s) => s.trim()).filter(Boolean),
      platforms,
    }),
    onSuccess: (data) => { setResult(data); toast.success('UTM 링크 생성 완료'); },
    onError: () => toast.error('UTM 생성 실패'),
  });

  const togglePlatform = (p: string) => {
    setPlatforms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);
  };

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <Card variant="bordered">
        <CardTitle className="flex items-center gap-2 mb-4">
          <Link2 size={20} />
          UTM 링크 생성
        </CardTitle>
        <div className="space-y-4">
          <Input label="기본 URL" placeholder="https://yoursite.com/product" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          <Input label="제품명 (쉼표로 구분)" placeholder="신제품A, 주력상품B" value={productsInput} onChange={(e) => setProductsInput(e.target.value)} />
          <Input label="캠페인명 (쉼표로 구분)" placeholder="봄세일, 신규런칭" value={campaignNames} onChange={(e) => setCampaignNames(e.target.value)} />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">플랫폼</label>
            <div className="flex flex-wrap gap-2">
              {['facebook', 'instagram', 'google', 'naver', 'kakao'].map((p) => (
                <button key={p} onClick={() => togglePlatform(p)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    platforms.includes(p) ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          <Button className="w-full" onClick={() => mutation.mutate()} loading={mutation.isPending}
            disabled={!baseUrl || !productsInput || !campaignNames}>
            UTM 링크 생성
          </Button>
        </div>
      </Card>

      <Card variant="bordered">
        <CardTitle className="mb-4">생성된 UTM 링크</CardTitle>
        {result ? (
          <div className="space-y-2 max-h-[600px] overflow-auto">
            {Array.isArray(result) ? result.map((item: any, i: number) => (
              <div key={i} className="p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-500 mb-1">{item.campaign || item.label || `링크 ${i + 1}`}</p>
                <p className="text-sm text-primary-700 break-all font-mono">{item.url || item.utm_url || JSON.stringify(item)}</p>
              </div>
            )) : (
              <pre className="bg-gray-50 p-4 rounded-lg text-sm whitespace-pre-wrap">{JSON.stringify(result, null, 2)}</pre>
            )}
          </div>
        ) : (
          <div className="text-center py-16 text-gray-400">
            <Link2 size={48} className="mx-auto mb-3 opacity-50" />
            <p>URL과 캠페인 정보를 입력하면</p>
            <p className="text-sm">UTM 링크를 자동 생성합니다</p>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ─── CSV 분석 ─── */
function CSVAnalyzer() {
  const [file, setFile] = useState<File | null>(null);
  const [platform, setPlatform] = useState('meta');
  const [analysisType, setAnalysisType] = useState('performance');
  const [result, setResult] = useState<any>(null);

  const mutation = useMutation({
    mutationFn: () => campaignPlannerApi.analyzeCSV(file!, platform, analysisType),
    onSuccess: (data) => { setResult(data); toast.success('CSV 분석 완료'); },
    onError: () => toast.error('CSV 분석 실패'),
  });

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <Card variant="bordered">
        <CardTitle className="flex items-center gap-2 mb-4">
          <Upload size={20} />
          CSV 성과 분석
        </CardTitle>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">CSV 파일 업로드</label>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-primary-400 transition-colors">
              <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] || null)} className="hidden" id="csv-upload" />
              <label htmlFor="csv-upload" className="cursor-pointer">
                <Upload size={32} className="mx-auto mb-2 text-gray-400" />
                <p className="text-sm text-gray-600">{file ? file.name : '클릭하여 CSV 파일 선택'}</p>
                <p className="text-xs text-gray-400 mt-1">Meta, Google, Naver 광고 데이터</p>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">플랫폼</label>
              <select className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" value={platform} onChange={(e) => setPlatform(e.target.value)}>
                <option value="meta">Meta (Facebook/IG)</option>
                <option value="google">Google Ads</option>
                <option value="naver">Naver 광고</option>
                <option value="kakao">Kakao 모먼트</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">분석 유형</label>
              <select className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" value={analysisType} onChange={(e) => setAnalysisType(e.target.value)}>
                <option value="performance">성과 분석</option>
                <option value="trend">트렌드 분석</option>
                <option value="creative">소재별 분석</option>
                <option value="audience">오디언스 분석</option>
              </select>
            </div>
          </div>

          <Button className="w-full" onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!file}>
            AI 분석 시작
          </Button>
        </div>
      </Card>

      <Card variant="bordered">
        <CardTitle className="mb-4">분석 결과</CardTitle>
        {result ? (
          <pre className="bg-gray-50 p-4 rounded-lg text-sm whitespace-pre-wrap overflow-auto max-h-[600px]">
            {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
          </pre>
        ) : (
          <div className="text-center py-16 text-gray-400">
            <BarChart3 size={48} className="mx-auto mb-3 opacity-50" />
            <p>CSV 파일을 업로드하면</p>
            <p className="text-sm">AI가 성과를 분석합니다</p>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ─── 소재 성과 예측 ─── */
function CreativePredictor() {
  const [description, setDescription] = useState('');
  const [pastCreatives, setPastCreatives] = useState([
    { type: 'IMAGE', style: '', ctr: '', cvr: '', spend: '' },
  ]);
  const [result, setResult] = useState<any>(null);

  const addPast = () => setPastCreatives([...pastCreatives, { type: 'IMAGE', style: '', ctr: '', cvr: '', spend: '' }]);
  const removePast = (i: number) => setPastCreatives(pastCreatives.filter((_, idx) => idx !== i));
  const updatePast = (i: number, field: string, value: string) => {
    const updated = [...pastCreatives];
    (updated[i] as any)[field] = value;
    setPastCreatives(updated);
  };

  const mutation = useMutation({
    mutationFn: () => campaignPlannerApi.predictCreative({
      past_creatives: pastCreatives.map((p) => ({
        type: p.type, style: p.style, ctr: Number(p.ctr), cvr: Number(p.cvr), spend: Number(p.spend),
      })),
      new_creative_description: description,
    }),
    onSuccess: (data) => { setResult(data); toast.success('예측 완료'); },
    onError: () => toast.error('예측 실패'),
  });

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <Card variant="bordered">
        <CardTitle className="flex items-center gap-2 mb-4">
          <BarChart3 size={20} />
          소재 성과 예측
        </CardTitle>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">새 소재 설명</label>
            <textarea className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none" rows={3}
              placeholder="예: 흰색 배경에 제품 클로즈업, 할인율 강조 텍스트 오버레이" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">과거 소재 성과</label>
              <button onClick={addPast} className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1">
                <Plus size={14} /> 추가
              </button>
            </div>
            {pastCreatives.map((p, i) => (
              <div key={i} className="p-3 bg-gray-50 rounded-lg space-y-2 mb-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">과거 소재 {i + 1}</span>
                  {pastCreatives.length > 1 && <button onClick={() => removePast(i)} className="text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" value={p.type} onChange={(e) => updatePast(i, 'type', e.target.value)}>
                    <option value="IMAGE">이미지</option>
                    <option value="VIDEO">영상</option>
                    <option value="CAROUSEL">캐러셀</option>
                  </select>
                  <input className="px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="스타일" value={p.style} onChange={(e) => updatePast(i, 'style', e.target.value)} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input className="px-3 py-2 border border-gray-300 rounded-lg text-sm" type="number" step="0.01" placeholder="CTR (%)" value={p.ctr} onChange={(e) => updatePast(i, 'ctr', e.target.value)} />
                  <input className="px-3 py-2 border border-gray-300 rounded-lg text-sm" type="number" step="0.01" placeholder="CVR (%)" value={p.cvr} onChange={(e) => updatePast(i, 'cvr', e.target.value)} />
                  <input className="px-3 py-2 border border-gray-300 rounded-lg text-sm" type="number" placeholder="지출액" value={p.spend} onChange={(e) => updatePast(i, 'spend', e.target.value)} />
                </div>
              </div>
            ))}
          </div>

          <Button className="w-full" onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!description}>
            AI 성과 예측
          </Button>
        </div>
      </Card>

      <Card variant="bordered">
        <CardTitle className="mb-4">예측 결과</CardTitle>
        {result ? (
          <pre className="bg-gray-50 p-4 rounded-lg text-sm whitespace-pre-wrap overflow-auto max-h-[600px]">
            {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
          </pre>
        ) : (
          <div className="text-center py-16 text-gray-400">
            <BarChart3 size={48} className="mx-auto mb-3 opacity-50" />
            <p>과거 성과와 새 소재 정보를 입력하면</p>
            <p className="text-sm">AI가 예상 성과를 예측합니다</p>
          </div>
        )}
      </Card>
    </div>
  );
}
