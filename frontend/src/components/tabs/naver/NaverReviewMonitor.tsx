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

const reviewApi = {
  listProducts: async () => { const { data } = await api.get('/naver/review-monitor/products'); return data as any[]; },
  registerProduct: async (body: { product_name: string; product_url: string }) => { const { data } = await api.post('/naver/review-monitor/products', body); return data; },
  deleteProduct: async (id: string) => { await api.delete(`/naver/review-monitor/products/${id}`); },
  analyze: async (productDbId: string, starThreshold: number) => {
    const { data } = await api.post(`/naver/review-monitor/analyze?product_db_id=${productDbId}&star_threshold=${starThreshold}`);
    return data;
  },
  listSchedules: async () => { const { data } = await api.get('/naver/review-monitor/schedules'); return data as any[]; },
  createSchedule: async (body: any) => { const { data } = await api.post('/naver/review-monitor/schedule', body); return data; },
  deleteSchedule: async (id: string) => { await api.delete(`/naver/review-monitor/schedule/${id}`); },
  runScheduleNow: async (id: string) => { const { data } = await api.post(`/naver/review-monitor/schedule/${id}/run-now`); return data; },
};

function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  return <span className="inline-flex gap-0.5">{[1,2,3,4,5].map(n => <Star key={n} size={size} className={n <= rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200'} />)}</span>;
}

function ReviewAiAnalysis({ text }: { text: string }) {
  const sections: { title: string; content: string; icon: string; color: string }[] = [];
  const lines = text.split('\n');
  let curTitle = '', curLines: string[] = [];
  const detectStyle = (t: string) => {
    const l = t.toLowerCase();
    if (l.includes('불만') || l.includes('이슈') || l.includes('top')) return { icon: '🔴', color: 'border-red-200 bg-red-50' };
    if (l.includes('긴급') || l.includes('대응')) return { icon: '⚡', color: 'border-orange-200 bg-orange-50' };
    if (l.includes('전략') || l.includes('개선')) return { icon: '🛠️', color: 'border-blue-200 bg-blue-50' };
    if (l.includes('긍정')) return { icon: '💚', color: 'border-green-200 bg-green-50' };
    return { icon: '📋', color: 'border-gray-200 bg-gray-50' };
  };
  const flush = () => { if (curTitle || curLines.length) sections.push({ title: curTitle, content: curLines.join('\n').trim(), ...detectStyle(curTitle) }); curTitle = ''; curLines = []; };
  for (const line of lines) {
    const hm = line.match(/^(?:\d+[\.\)]\s*\**|#{1,3}\s+|\*\*\d*[\.\)]?\s*)(.+?)(?:\**\s*)$/);
    if (hm) { flush(); curTitle = hm[1].replace(/\*\*/g, '').trim(); } else curLines.push(line);
  }
  flush();
  if (sections.length <= 1) return <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200"><h4 className="text-sm font-semibold text-emerald-900 mb-2 flex items-center gap-1.5"><Sparkles size={14} /> AI 리뷰 분석</h4><div className="text-xs text-gray-700 whitespace-pre-line leading-relaxed">{text}</div></div>;
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5"><Sparkles size={15} /> AI 리뷰 분석</h4>
      <div className="grid gap-3">{sections.map((sec, i) => (
        <div key={i} className={clsx('rounded-xl border p-4', sec.color)}>
          {sec.title && <div className="flex items-center gap-2 mb-2"><span className="text-base">{sec.icon}</span><h5 className="text-sm font-semibold text-gray-900">{sec.title}</h5></div>}
          <div className="text-xs text-gray-700 leading-relaxed whitespace-pre-line">{sec.content.split('\n').map((l, j) => { const t = l.trim(); if (!t) return null; const bm = t.match(/^[-•▸→]\s*(.+)/); return bm ? <div key={j} className="flex gap-1.5 py-0.5"><span className="text-green-500">▸</span><span dangerouslySetInnerHTML={{ __html: bm[1].replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }} /></div> : <p key={j} className="py-0.5" dangerouslySetInnerHTML={{ __html: t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }} />; })}</div>
        </div>
      ))}</div>
    </div>
  );
}

export function NaverReviewMonitor() {
  const queryClient = useQueryClient();
  const [productName, setProductName] = useState('');
  const [productUrl, setProductUrl] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [starThreshold, setStarThreshold] = useState(3);
  const [analysisResult, setAnalysisResult] = useState<any>(null);

  const { data: products = [] } = useQuery({ queryKey: ['monitored-products'], queryFn: reviewApi.listProducts });
  const registerMutation = useMutation({
    mutationFn: () => reviewApi.registerProduct({ product_name: productName, product_url: productUrl }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['monitored-products'] }); setProductName(''); setProductUrl(''); toast.success('제품 등록 완료'); },
    onError: (e: any) => toast.error(e?.response?.data?.detail || '등록 실패'),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => reviewApi.deleteProduct(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['monitored-products'] }); setSelectedProductId(null); setAnalysisResult(null); toast.success('삭제 완료'); },
  });

  const analyzeMutation = useMutation({
    mutationFn: () => reviewApi.analyze(selectedProductId!, starThreshold),
    onSuccess: (data) => {
      setAnalysisResult(data);
      if (data?.error) toast.error(data.error);
      else if (data?.stats?.total_reviews > 0) toast.success('리뷰 분석 완료!');
    },
    onError: (e: any) => {
      const detail = e?.response?.data?.detail || e?.response?.data?.error || e?.message || '분석 실패';
      toast.error(`리뷰 분석 오류: ${detail}`);
      if (e?.response?.data) setAnalysisResult(e.response.data);
    },
  });

  const selectedProduct = products.find((p: any) => p.id === selectedProductId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><MessageSquare className="text-green-600" size={28} /> 리뷰 모니터링</h1>
        <p className="text-sm text-gray-500 mt-1">네이버 쇼핑 제품 리뷰 수집 · 별점 분석 · AI 이슈 진단</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-800">제품 등록</h2>
        <div className="grid sm:grid-cols-[1fr_2fr_auto] gap-2">
          <input type="text" value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="제품명" className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-green-500" />
          <input type="text" value={productUrl} onChange={(e) => setProductUrl(e.target.value)} placeholder="네이버 쇼핑 제품 URL" className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-green-500" />
          <button onClick={() => registerMutation.mutate()} disabled={!productName.trim() || !productUrl.trim() || registerMutation.isPending} className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"><Plus size={15} /> 등록</button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">모니터링 제품 ({products.length})</h2>
        {products.length === 0 ? <p className="text-xs text-gray-400 py-8 text-center">등록된 제품이 없습니다.</p> : (
          <div className="space-y-2">{products.map((p: any) => (
            <div key={p.id} onClick={() => { setSelectedProductId(p.id); setAnalysisResult(null); }}
              className={clsx('flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors', selectedProductId === p.id ? 'border-green-500 bg-green-50' : 'border-gray-100 hover:bg-gray-50')}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center text-green-600"><MessageSquare size={16} /></div>
                <div><p className="text-sm font-medium text-gray-900">{p.product_name}</p><p className="text-xs text-gray-400 truncate max-w-xs">{p.product_url}</p></div>
              </div>
              <div className="flex items-center gap-2">
                <a href={p.product_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="p-1.5 text-gray-400 hover:text-blue-600"><ExternalLink size={14} /></a>
                <button onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(p.id); }} className="p-1.5 text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}</div>
        )}
      </div>

      {selectedProduct && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800">리뷰 분석: <span className="text-green-700">{selectedProduct.product_name}</span></h2>
            <div className="flex items-center gap-3">
              <select value={starThreshold} onChange={(e) => setStarThreshold(Number(e.target.value))} className="px-2 py-1 border rounded text-xs">{[1,2,3,4].map(n => <option key={n} value={n}>{n}점 이하</option>)}</select>
              <button onClick={() => analyzeMutation.mutate()} disabled={analyzeMutation.isPending} className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50">
                {analyzeMutation.isPending ? <><Loader2 size={14} className="animate-spin" /> 분석 중...</> : <><Search size={14} /> 리뷰 분석</>}
              </button>
            </div>
          </div>

          {analysisResult?.error && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
              <p className="font-semibold mb-1">리뷰 수집 실패</p><p>{analysisResult.error}</p>
            </div>
          )}

          {analysisResult?.stats && analysisResult.stats.total_reviews > 0 && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-blue-50 rounded-xl border border-blue-100 text-center"><p className="text-2xl font-bold text-blue-700">{analysisResult.stats.total_reviews.toLocaleString()}</p><p className="text-xs text-blue-600 mt-0.5">전체 리뷰</p></div>
                <div className="p-3 bg-yellow-50 rounded-xl border border-yellow-100 text-center"><p className="text-2xl font-bold text-yellow-700">{analysisResult.stats.average_rating}</p><p className="text-xs text-yellow-600 mt-0.5 flex items-center justify-center gap-1"><Stars rating={Math.round(analysisResult.stats.average_rating)} size={10} /> 평균</p></div>
                <div className="p-3 bg-red-50 rounded-xl border border-red-100 text-center"><p className="text-2xl font-bold text-red-700">{analysisResult.stats.low_star_total}</p><p className="text-xs text-red-600 mt-0.5">{starThreshold}점 이하</p></div>
                <div className="p-3 bg-orange-50 rounded-xl border border-orange-100 text-center"><p className="text-2xl font-bold text-orange-700">{analysisResult.stats.low_star_count_7d}</p><p className="text-xs text-orange-600 mt-0.5">최근 7일</p></div>
              </div>
              <div className="bg-gray-50 rounded-xl p-4 border">
                <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-1.5"><TrendingDown size={14} /> 기간별 {starThreshold}점 이하</h3>
                <div className="grid grid-cols-3 gap-3">{[
                  { label: '7일', count: analysisResult.stats.low_star_count_7d, color: 'text-red-600' },
                  { label: '14일', count: analysisResult.stats.low_star_count_14d, color: 'text-orange-600' },
                  { label: '30일', count: analysisResult.stats.low_star_count_30d, color: 'text-yellow-700' },
                ].map((item, i) => <div key={i} className="bg-white rounded-lg p-3 text-center border"><p className={clsx('text-xl font-bold', item.color)}>{item.count}건</p><p className="text-xs text-gray-500">{item.label} 이내</p></div>)}</div>
              </div>
              <div className="bg-gray-50 rounded-xl p-4 border">
                <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-1.5"><BarChart3 size={14} /> 별점 분포</h3>
                <div className="space-y-2">{[5,4,3,2,1].map(star => {
                  const count = analysisResult.stats.star_distribution[star] || 0;
                  const total = analysisResult.stats.total_reviews || 1;
                  const pct = Math.round((count / total) * 100);
                  return <div key={star} className="flex items-center gap-2"><span className="text-xs text-gray-600 w-12 flex items-center gap-0.5"><Star size={11} className="text-yellow-400 fill-yellow-400" /> {star}점</span><div className="flex-1 h-5 bg-gray-200 rounded-full overflow-hidden"><div className={clsx('h-full rounded-full', star >= 4 ? 'bg-green-500' : star === 3 ? 'bg-yellow-500' : 'bg-red-500')} style={{ width: `${pct}%` }} /></div><span className="text-xs text-gray-600 w-16 text-right">{count} ({pct}%)</span></div>;
                })}</div>
              </div>
              {analysisResult.ai_analysis && <ReviewAiAnalysis text={analysisResult.ai_analysis} />}
              {analysisResult.stats.low_reviews_sample?.length > 0 && (
                <div className="bg-gray-50 rounded-xl p-4 border">
                  <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-1.5"><AlertTriangle size={14} className="text-red-500" /> 저별점 리뷰</h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto">{analysisResult.stats.low_reviews_sample.map((r: any, idx: number) => (
                    <div key={idx} className="bg-white rounded-lg p-3 border text-xs">
                      <div className="flex items-center gap-2 mb-1"><Stars rating={r.rating} size={11} /><span className="text-gray-500">{r.writer}</span><span className="text-gray-400 ml-auto">{r.date?.slice(0, 10)}</span></div>
                      <p className="text-gray-700 leading-relaxed">{r.content?.slice(0, 200)}</p>
                    </div>
                  ))}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <ReviewSchedulePanel />
    </div>
  );
}

function ReviewSchedulePanel() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [days, setDays] = useState<number[]>([1,2,3,4,5]);
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [email, setEmail] = useState('');
  const [threshold, setThreshold] = useState(3);
  const toggleDay = (d: number) => setDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort());
  const { data: schedules = [] } = useQuery({ queryKey: ['review-schedules'], queryFn: reviewApi.listSchedules });
  const create = useMutation({ mutationFn: () => reviewApi.createSchedule({ name: '리뷰 리포트', star_threshold: threshold, days_of_week: days, send_hour: hour, send_minute: minute, email_to: email }), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['review-schedules'] }); setShowForm(false); toast.success('등록 완료'); }, onError: (e: any) => toast.error(e?.response?.data?.detail || '실패') });
  const del = useMutation({ mutationFn: (id: string) => reviewApi.deleteSchedule(id), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['review-schedules'] }); toast.success('삭제'); } });
  const runNow = useMutation({ mutationFn: (id: string) => reviewApi.runScheduleNow(id), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['review-schedules'] }); toast.success('실행 완료'); }, onError: (e: any) => toast.error(e?.response?.data?.detail || '실패') });
  const DOW = ['월','화','수','목','금','토','일'];
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4"><h2 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5"><BarChart3 size={15} /> 정기 리뷰 리포트</h2><button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 rounded-lg hover:bg-green-100 border border-green-200"><Plus size={13} /> 스케줄 추가</button></div>
      {showForm && (
        <div className="p-4 bg-gray-50 rounded-lg border space-y-4 mb-4">
          <div><label className="text-xs text-gray-500 mb-2 block">발송 요일</label><div className="flex gap-1.5">{DOW.map((label, idx) => { const val = idx < 5 ? idx + 1 : idx === 5 ? 6 : 0; return <button key={idx} onClick={() => toggleDay(val)} className={clsx('w-10 h-10 rounded-lg text-sm font-medium transition-all', days.includes(val) ? 'bg-green-600 text-white shadow-sm' : 'bg-white text-gray-500 border hover:border-green-300')}>{label}</button>; })}</div></div>
          <div className="flex items-center gap-4">
            <div><label className="text-xs text-gray-500 mb-1 block">시간</label><div className="flex items-center gap-1"><select value={hour} onChange={(e) => setHour(Number(e.target.value))} className="px-2 py-1.5 border rounded-lg text-sm w-20">{Array.from({length:24},(_,i)=><option key={i} value={i}>{String(i).padStart(2,'0')}시</option>)}</select><span className="text-gray-400 font-bold">:</span><select value={minute} onChange={(e) => setMinute(Number(e.target.value))} className="px-2 py-1.5 border rounded-lg text-sm w-20">{Array.from({length:60},(_,i)=><option key={i} value={i}>{String(i).padStart(2,'0')}분</option>)}</select></div></div>
            <div><label className="text-xs text-gray-500 mb-1 block">별점 기준</label><select value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="px-2 py-1.5 border rounded-lg text-sm">{[1,2,3,4].map(n=><option key={n} value={n}>{n}점 이하</option>)}</select></div>
          </div>
          <div><label className="text-xs text-gray-500 mb-1 block">이메일</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="report@example.com" className="w-full px-3 py-1.5 border rounded-lg text-sm" /></div>
          <div className="flex gap-2"><button onClick={() => create.mutate()} disabled={!email || days.length === 0 || create.isPending} className="px-4 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50">{create.isPending ? '등록 중...' : '스케줄 등록'}</button><button onClick={() => setShowForm(false)} className="px-4 py-1.5 text-sm text-gray-600 border rounded-lg hover:bg-gray-100">취소</button></div>
        </div>
      )}
      {schedules.length > 0 ? <div className="space-y-2">{schedules.map((s: any) => (
        <div key={s.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border text-xs">
          <div className="flex items-center gap-2 flex-wrap"><span className="font-medium text-gray-900">{s.name}</span><span className="text-gray-300">|</span><span className="text-gray-600">{(s.days_of_week||[]).map((d:number)=>['일','월','화','수','목','금','토'][d]).join('·')} {String(s.send_hour??9).padStart(2,'0')}:{String(s.send_minute??0).padStart(2,'0')}</span><span className="text-gray-300">&rarr;</span><span className="text-green-700">{s.email_to}</span><span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-[10px]">{s.star_threshold}점↓</span></div>
          <div className="flex gap-1.5 ml-2"><button onClick={() => runNow.mutate(s.id)} disabled={runNow.isPending} className="p-1.5 bg-green-50 text-green-700 rounded hover:bg-green-100" title="즉시 실행">{runNow.isPending ? <Loader2 size={13} className="animate-spin" /> : <Star size={13} />}</button><button onClick={() => del.mutate(s.id)} className="p-1.5 bg-red-50 text-red-700 rounded hover:bg-red-100" title="삭제"><Trash2 size={13} /></button></div>
        </div>
      ))}</div> : <p className="text-xs text-gray-400 py-2">등록된 스케줄이 없습니다.</p>}
    </div>
  );
}
