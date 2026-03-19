'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Star, Plus, Trash2, Search, Loader2, AlertTriangle, TrendingDown,
  BarChart3, Sparkles, ExternalLink, MessageSquare,
} from 'lucide-react';
import api from '@/lib/api';
import { clsx } from 'clsx';
import toast from 'react-hot-toast';

// ── API ──
const reviewApi = {
  listProducts: async () => {
    const { data } = await api.get('/naver/review-monitor/products');
    return data as any[];
  },
  registerProduct: async (body: { product_name: string; product_url: string }) => {
    const { data } = await api.post('/naver/review-monitor/products', body);
    return data;
  },
  deleteProduct: async (id: string) => {
    await api.delete(`/naver/review-monitor/products/${id}`);
  },
  analyze: async (productDbId: string, starThreshold: number) => {
    const { data } = await api.post(`/naver/review-monitor/analyze?product_db_id=${productDbId}&star_threshold=${starThreshold}`);
    return data;
  },
};

// ── 별점 렌더링 ──
function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <Star key={n} size={size} className={n <= rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200'} />
      ))}
    </span>
  );
}

// ── AI 분석 카드 ──
function ReviewAiAnalysis({ text }: { text: string }) {
  const sections: { title: string; content: string; icon: string; color: string }[] = [];
  const lines = text.split('\n');
  let curTitle = '';
  let curLines: string[] = [];

  const detectStyle = (t: string) => {
    const l = t.toLowerCase();
    if (l.includes('불만') || l.includes('이슈') || l.includes('top')) return { icon: '🔴', color: 'border-red-200 bg-red-50' };
    if (l.includes('긴급') || l.includes('대응')) return { icon: '⚡', color: 'border-orange-200 bg-orange-50' };
    if (l.includes('전략') || l.includes('개선') || l.includes('방안')) return { icon: '🛠️', color: 'border-blue-200 bg-blue-50' };
    if (l.includes('긍정') || l.includes('포인트')) return { icon: '💚', color: 'border-green-200 bg-green-50' };
    return { icon: '📋', color: 'border-gray-200 bg-gray-50' };
  };

  const flush = () => {
    if (curTitle || curLines.length) {
      const style = detectStyle(curTitle);
      sections.push({ title: curTitle, content: curLines.join('\n').trim(), ...style });
    }
    curTitle = '';
    curLines = [];
  };

  for (const line of lines) {
    const hm = line.match(/^(?:\d+[\.\)]\s*\**|#{1,3}\s+|\*\*\d*[\.\)]?\s*)(.+?)(?:\**\s*)$/);
    if (hm) { flush(); curTitle = hm[1].replace(/\*\*/g, '').trim(); }
    else curLines.push(line);
  }
  flush();

  if (sections.length <= 1) {
    return (
      <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200">
        <h4 className="text-sm font-semibold text-emerald-900 mb-2 flex items-center gap-1.5"><Sparkles size={14} /> AI 리뷰 분석</h4>
        <div className="text-xs text-gray-700 whitespace-pre-line leading-relaxed">{text}</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5"><Sparkles size={15} /> AI 리뷰 분석</h4>
      <div className="grid gap-3">
        {sections.map((sec, i) => (
          <div key={i} className={clsx('rounded-xl border p-4', sec.color)}>
            {sec.title && (
              <div className="flex items-center gap-2 mb-2">
                <span className="text-base">{sec.icon}</span>
                <h5 className="text-sm font-semibold text-gray-900">{sec.title}</h5>
              </div>
            )}
            <div className="text-xs text-gray-700 leading-relaxed whitespace-pre-line">
              {sec.content.split('\n').map((line, j) => {
                const t = line.trim();
                if (!t) return null;
                const bm = t.match(/^[-•▸→]\s*(.+)/);
                if (bm) return <div key={j} className="flex gap-1.5 py-0.5"><span className="text-green-500 mt-px">▸</span><span dangerouslySetInnerHTML={{ __html: t.replace(/^[-•▸→]\s*/, '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }} /></div>;
                return <p key={j} className="py-0.5" dangerouslySetInnerHTML={{ __html: t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }} />;
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ──
export function NaverReviewMonitor() {
  const queryClient = useQueryClient();
  const [productName, setProductName] = useState('');
  const [productUrl, setProductUrl] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [starThreshold, setStarThreshold] = useState(3);
  const [analysisResult, setAnalysisResult] = useState<any>(null);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['monitored-products'],
    queryFn: reviewApi.listProducts,
  });

  const registerMutation = useMutation({
    mutationFn: () => reviewApi.registerProduct({ product_name: productName, product_url: productUrl }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monitored-products'] });
      setProductName('');
      setProductUrl('');
      toast.success('제품이 등록되었습니다.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || '등록 실패'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => reviewApi.deleteProduct(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monitored-products'] });
      if (selectedProductId) setSelectedProductId(null);
      setAnalysisResult(null);
      toast.success('삭제 완료');
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: () => reviewApi.analyze(selectedProductId!, starThreshold),
    onSuccess: (data) => setAnalysisResult(data),
    onError: (e: any) => toast.error(e?.response?.data?.detail || '분석 실패'),
  });

  const selectedProduct = products.find((p: any) => p.id === selectedProductId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <MessageSquare className="text-green-600" size={28} />
          리뷰 모니터링
        </h1>
        <p className="text-sm text-gray-500 mt-1">네이버 쇼핑 제품 리뷰 수집 · 별점 분석 · AI 이슈 진단</p>
      </div>

      {/* 제품 등록 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-800">제품 등록</h2>
        <div className="grid sm:grid-cols-[1fr_2fr_auto] gap-2">
          <input
            type="text"
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            placeholder="제품명 (예: 쫀득쿠키)"
            className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
          />
          <input
            type="text"
            value={productUrl}
            onChange={(e) => setProductUrl(e.target.value)}
            placeholder="네이버 쇼핑 제품 URL"
            className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
          />
          <button
            onClick={() => registerMutation.mutate()}
            disabled={!productName.trim() || !productUrl.trim() || registerMutation.isPending}
            className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            <Plus size={15} /> 등록
          </button>
        </div>
      </div>

      {/* 등록된 제품 목록 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">모니터링 제품 ({products.length})</h2>
        {products.length === 0 ? (
          <p className="text-xs text-gray-400 py-8 text-center">등록된 제품이 없습니다. 위에서 제품을 등록해주세요.</p>
        ) : (
          <div className="space-y-2">
            {products.map((p: any) => (
              <div
                key={p.id}
                onClick={() => { setSelectedProductId(p.id); setAnalysisResult(null); }}
                className={clsx(
                  'flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors',
                  selectedProductId === p.id ? 'border-green-500 bg-green-50' : 'border-gray-100 hover:bg-gray-50'
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center text-green-600">
                    <MessageSquare size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{p.product_name}</p>
                    <p className="text-xs text-gray-400 truncate max-w-xs">{p.product_url}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <a href={p.product_url} target="_blank" rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="p-1.5 text-gray-400 hover:text-blue-600"><ExternalLink size={14} /></a>
                  <button onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(p.id); }}
                    className="p-1.5 text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 리뷰 분석 */}
      {selectedProduct && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800">
              리뷰 분석: <span className="text-green-700">{selectedProduct.product_name}</span>
            </h2>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs text-gray-600">
                <span>별점 기준:</span>
                <select value={starThreshold} onChange={(e) => setStarThreshold(Number(e.target.value))}
                  className="px-2 py-1 border rounded text-sm">
                  {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}점 이하</option>)}
                </select>
              </div>
              <button
                onClick={() => analyzeMutation.mutate()}
                disabled={analyzeMutation.isPending}
                className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {analyzeMutation.isPending ? <><Loader2 size={14} className="animate-spin" /> 분석 중...</> : <><Search size={14} /> 리뷰 분석</>}
              </button>
            </div>
          </div>

          {/* 분석 결과 */}
          {analysisResult && analysisResult.stats && (
            <div className="space-y-5">
              {/* KPI 카드 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-blue-50 rounded-xl border border-blue-100 text-center">
                  <p className="text-2xl font-bold text-blue-700">{analysisResult.stats.total_reviews.toLocaleString()}</p>
                  <p className="text-xs text-blue-600 mt-0.5">전체 리뷰</p>
                </div>
                <div className="p-3 bg-yellow-50 rounded-xl border border-yellow-100 text-center">
                  <p className="text-2xl font-bold text-yellow-700">{analysisResult.stats.average_rating}</p>
                  <p className="text-xs text-yellow-600 mt-0.5 flex items-center justify-center gap-1"><Stars rating={Math.round(analysisResult.stats.average_rating)} size={10} /> 평균 별점</p>
                </div>
                <div className="p-3 bg-red-50 rounded-xl border border-red-100 text-center">
                  <p className="text-2xl font-bold text-red-700">{analysisResult.stats.low_star_total}</p>
                  <p className="text-xs text-red-600 mt-0.5">{starThreshold}점 이하 전체</p>
                </div>
                <div className="p-3 bg-orange-50 rounded-xl border border-orange-100 text-center">
                  <p className="text-2xl font-bold text-orange-700">{analysisResult.stats.low_star_count_7d}</p>
                  <p className="text-xs text-orange-600 mt-0.5">최근 7일</p>
                </div>
              </div>

              {/* 기간별 저별점 */}
              <div className="bg-gray-50 rounded-xl p-4 border">
                <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-1.5"><TrendingDown size={14} /> 기간별 {starThreshold}점 이하 리뷰</h3>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: '7일 이내', count: analysisResult.stats.low_star_count_7d, color: 'text-red-600' },
                    { label: '14일 이내', count: analysisResult.stats.low_star_count_14d, color: 'text-orange-600' },
                    { label: '30일 이내', count: analysisResult.stats.low_star_count_30d, color: 'text-yellow-700' },
                  ].map((item, idx) => (
                    <div key={idx} className="bg-white rounded-lg p-3 text-center border">
                      <p className={clsx('text-xl font-bold', item.color)}>{item.count}건</p>
                      <p className="text-xs text-gray-500">{item.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* 별점 분포 */}
              <div className="bg-gray-50 rounded-xl p-4 border">
                <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-1.5"><BarChart3 size={14} /> 별점 분포</h3>
                <div className="space-y-2">
                  {[5, 4, 3, 2, 1].map(star => {
                    const count = analysisResult.stats.star_distribution[star] || 0;
                    const total = analysisResult.stats.total_reviews || 1;
                    const pct = Math.round((count / total) * 100);
                    return (
                      <div key={star} className="flex items-center gap-2">
                        <span className="text-xs text-gray-600 w-12 flex items-center gap-0.5"><Star size={11} className="text-yellow-400 fill-yellow-400" /> {star}점</span>
                        <div className="flex-1 h-5 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={clsx('h-full rounded-full transition-all', star >= 4 ? 'bg-green-500' : star === 3 ? 'bg-yellow-500' : 'bg-red-500')}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-600 w-16 text-right">{count.toLocaleString()} ({pct}%)</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* AI 분석 */}
              {analysisResult.ai_analysis && (
                <ReviewAiAnalysis text={analysisResult.ai_analysis} />
              )}

              {/* 저별점 리뷰 샘플 */}
              {analysisResult.stats.low_reviews_sample?.length > 0 && (
                <div className="bg-gray-50 rounded-xl p-4 border">
                  <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-1.5">
                    <AlertTriangle size={14} className="text-red-500" /> 저별점 리뷰 ({analysisResult.stats.low_reviews_sample.length}건)
                  </h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {analysisResult.stats.low_reviews_sample.map((r: any, idx: number) => (
                      <div key={idx} className="bg-white rounded-lg p-3 border text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <Stars rating={r.rating} size={11} />
                            <span className="text-gray-500">{r.writer}</span>
                          </div>
                          <span className="text-gray-400">{r.date?.slice(0, 10)}</span>
                        </div>
                        <p className="text-gray-700 leading-relaxed">{r.content?.slice(0, 200)}{r.content?.length > 200 ? '...' : ''}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
