'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search, TrendingUp, Plus, Trash2, RefreshCw, BarChart3,
  ExternalLink, ArrowRight, Hash, MessageCircle, Sparkles,
  Eye, Youtube, Instagram, Globe, X, Check,
} from 'lucide-react';
import { Button, Card, CardTitle, Input } from '@/components/ui';
import { marketApi, benchmarkApi } from '@/lib/api';
import { useAppStore } from '@/store';
import toast from 'react-hot-toast';

// -------- Types --------

interface PlatformMetrics {
  content_count: number;
  total_views: number;
  total_comments: number;
  total_likes?: number;
  tags?: string[];
}

interface NaverMetrics {
  blog_post_count: number;
  search_query_volume: number;
}

interface DailyTrend {
  date: string;
  youtube_views: number;
  instagram_views: number;
  naver_searches: number;
}

interface MonthlyTrend {
  month: string;
  youtube_views: number;
  instagram_views: number;
  naver_searches: number;
}

interface PlatformData {
  youtube: PlatformMetrics | null;
  instagram: PlatformMetrics | null;
  naver: NaverMetrics | null;
  daily_trends: DailyTrend[];
  monthly_trends: MonthlyTrend[];
  api_sources?: string[];
  api_errors?: Record<string, string>;
}

interface SentimentData {
  positive_ratio: number;
  negative_ratio: number;
  neutral_ratio: number;
  positive_keywords: { keyword: string; count: number }[];
  negative_keywords: { keyword: string; count: number }[];
  emotion_keywords: { keyword: string; count: number; emotion: string }[];
  source?: string;
}

interface MarketKeyword {
  id: string;
  user_id: number;
  keyword: string;
  platform_data: PlatformData | null;
  sentiment_data: SentimentData | null;
  hashtags: string[];
  last_analyzed_at: string | null;
  created_at: string;
}

// -------- SVG Line Chart Component --------

const CHART_COLORS = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
  '#EC4899', '#06B6D4', '#F97316', '#6366F1', '#14B8A6',
];

interface LineChartProps {
  datasets: {
    label: string;
    data: number[];
    color: string;
  }[];
  labels: string[];
  height?: number;
  title?: string;
}

function SVGLineChart({ datasets, labels, height = 160, title }: LineChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const padding = { top: 16, right: 16, bottom: 28, left: 48 };
  const width = 600;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const allValues = datasets.flatMap((d) => d.data);
  const maxVal = Math.max(...allValues, 1);
  const minVal = Math.min(...allValues, 0);
  const range = maxVal - minVal || 1;

  const getX = (i: number) => padding.left + (i / Math.max(labels.length - 1, 1)) * chartWidth;
  const getY = (v: number) => padding.top + chartHeight - ((v - minVal) / range) * chartHeight;

  const yTicks = 4;
  const yTickValues = Array.from({ length: yTicks }, (_, i) => minVal + (range * i) / (yTicks - 1));

  const formatNumber = (n: number) => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
    return n.toFixed(0);
  };

  return (
    <div className="w-full overflow-x-auto">
      {title && <h4 className="text-xs font-medium text-[#D0D6E0] mb-1">{title}</h4>}
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ minWidth: 300 }}
        onMouseLeave={() => setHoveredIdx(null)}>
        {/* Grid lines + Y-axis */}
        {yTickValues.map((val, i) => (
          <g key={`grid-${i}`}>
            <line x1={padding.left} y1={getY(val)} x2={width - padding.right} y2={getY(val)} stroke="#E5E7EB" strokeWidth="0.5" />
            <text x={padding.left - 6} y={getY(val) + 3} textAnchor="end" fill="#9CA3AF" fontSize="7">{formatNumber(val)}</text>
          </g>
        ))}

        {/* X-axis labels */}
        {labels.map((label, i) => {
          const showEvery = Math.max(1, Math.ceil(labels.length / 7));
          if (i % showEvery !== 0 && i !== labels.length - 1) return null;
          return (
            <text key={`xlabel-${i}`} x={getX(i)} y={height - 5} textAnchor="middle" fill="#9CA3AF" fontSize="7">{label}</text>
          );
        })}

        {/* Lines */}
        {datasets.map((dataset, di) => {
          if (dataset.data.length < 2) return null;
          const pathD = dataset.data.map((v, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(v)}`).join(' ');
          const lastIdx = dataset.data.length - 1;
          const lastVal = dataset.data[lastIdx];
          return (
            <g key={`line-${di}`}>
              <path d={pathD} fill="none" stroke={dataset.color} strokeWidth="1.5" strokeLinejoin="round" />
              {dataset.data.map((v, i) => (
                <circle key={`dot-${di}-${i}`} cx={getX(i)} cy={getY(v)}
                  r={hoveredIdx === i ? 3 : 1.5} fill={dataset.color}
                  style={{ transition: 'r 0.1s' }} />
              ))}
              {/* Last value label */}
              <text x={getX(lastIdx) + 4} y={getY(lastVal) + 3} fill={dataset.color} fontSize="7" fontWeight={600}>
                {formatNumber(lastVal)}
              </text>
            </g>
          );
        })}

        {/* Hover detector rects */}
        {labels.map((_, i) => {
          const rectW = chartWidth / Math.max(labels.length - 1, 1);
          return (
            <rect key={`hover-${i}`} x={getX(i) - rectW / 2} y={padding.top} width={rectW} height={chartHeight}
              fill="transparent" onMouseEnter={() => setHoveredIdx(i)} />
          );
        })}

        {/* Hover tooltip */}
        {hoveredIdx !== null && (
          <g>
            <line x1={getX(hoveredIdx)} y1={padding.top} x2={getX(hoveredIdx)} y2={padding.top + chartHeight}
              stroke="#9ca3af" strokeWidth="0.5" strokeDasharray="2,2" />
            {datasets.map((ds, di) => {
              const v = ds.data[hoveredIdx];
              if (v === undefined) return null;
              const y = getY(v);
              const tooltipW = 55;
              const tooltipX = Math.min(Math.max(getX(hoveredIdx) - tooltipW / 2, 2), width - tooltipW - 2);
              const tooltipY = y - 14 - di * 14;
              return (
                <g key={`tt-${di}`}>
                  <rect x={tooltipX} y={tooltipY} width={tooltipW} height={12} rx={2} fill={ds.color} opacity={0.9} />
                  <text x={tooltipX + tooltipW / 2} y={tooltipY + 9} textAnchor="middle" fill="white" fontSize="7" fontWeight={600}>
                    {formatNumber(v)}
                  </text>
                </g>
              );
            })}
          </g>
        )}
      </svg>

      {/* Legend */}
      {datasets.length > 1 && (
        <div className="flex flex-wrap gap-3 mt-1 justify-center">
          {datasets.map((d, i) => (
            <div key={i} className="flex items-center gap-1 text-[10px] text-[#8A8F98]">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
              {d.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// -------- Sentiment Bar --------

function SentimentBar({ positive, negative, neutral }: { positive: number; negative: number; neutral: number }) {
  const total = positive + negative + neutral || 1;
  const pPct = ((positive / total) * 100).toFixed(1);
  const nPct = ((negative / total) * 100).toFixed(1);
  const neuPct = ((neutral / total) * 100).toFixed(1);

  return (
    <div>
      <div className="flex h-6 rounded-full overflow-hidden bg-[#141516]">
        {positive > 0 && (
          <div className="bg-[#27A644] flex items-center justify-center text-white text-xs font-medium"
            style={{ width: `${pPct}%` }}>
            {parseFloat(pPct) > 10 ? `${pPct}%` : ''}
          </div>
        )}
        {neutral > 0 && (
          <div className="bg-[#28282C] flex items-center justify-center text-white text-xs font-medium"
            style={{ width: `${neuPct}%` }}>
            {parseFloat(neuPct) > 10 ? `${neuPct}%` : ''}
          </div>
        )}
        {negative > 0 && (
          <div className="bg-[#EB5757] flex items-center justify-center text-white text-xs font-medium"
            style={{ width: `${nPct}%` }}>
            {parseFloat(nPct) > 10 ? `${nPct}%` : ''}
          </div>
        )}
      </div>
      <div className="flex justify-between mt-1 text-xs text-[#8A8F98]">
        <span className="text-[#27A644]">긍정 {pPct}%</span>
        <span className="text-[#8A8F98]">중립 {neuPct}%</span>
        <span className="text-[#EB5757]">부정 {nPct}%</span>
      </div>
    </div>
  );
}

// -------- Main Component --------

export function MarketIntelligence() {
  const [newKeyword, setNewKeyword] = useState('');
  const [selectedKeywordId, setSelectedKeywordId] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [chartView, setChartView] = useState<'daily' | 'monthly'>('daily');
  const [analysisDays, setAnalysisDays] = useState(30);
  const [styleUrl, setStyleUrl] = useState('');
  const { setSelectedStyle, setActiveTab } = useAppStore();
  const queryClient = useQueryClient();

  // ---- Queries ----

  const { data: keywords = [], isLoading: isLoadingKeywords } = useQuery<MarketKeyword[]>({
    queryKey: ['market-keywords'],
    queryFn: marketApi.listKeywords,
  });

  const selectedKeyword = useMemo(
    () => keywords.find((k) => k.id === selectedKeywordId) || null,
    [keywords, selectedKeywordId]
  );

  // ---- Mutations ----

  const addKeywordMutation = useMutation({
    mutationFn: (keyword: string) => marketApi.registerKeyword(keyword),
    onSuccess: (data: MarketKeyword) => {
      queryClient.invalidateQueries({ queryKey: ['market-keywords'] });
      setNewKeyword('');
      setSelectedKeywordId(data.id);
      toast.success(`"${data.keyword}" 키워드가 등록되었습니다.`);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || '키워드 등록에 실패했습니다.';
      toast.error(msg);
    },
  });

  const removeKeywordMutation = useMutation({
    mutationFn: (id: string) => marketApi.removeKeyword(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['market-keywords'] });
      if (selectedKeywordId) setSelectedKeywordId(null);
      toast.success('키워드가 삭제되었습니다.');
    },
    onError: () => toast.error('키워드 삭제에 실패했습니다.'),
  });

  const analyzeMutation = useMutation({
    mutationFn: ({ id, days }: { id: string; days?: number }) => marketApi.analyzeKeyword(id, days),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['market-keywords'] });
      toast.success('키워드 분석이 완료되었습니다.');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || '분석 중 오류가 발생했습니다.';
      toast.error(msg);
    },
  });

  const compareMutation = useMutation({
    mutationFn: (ids: string[]) => marketApi.compareKeywords(ids),
    onError: () => toast.error('비교 분석에 실패했습니다.'),
  });

  const extractStyleMutation = useMutation({
    mutationFn: () => benchmarkApi.extractStyle(styleUrl),
    onSuccess: (data) => {
      setSelectedStyle(data.style, data.prompt_template);
      toast.success('스타일 추출 완료!');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || '스타일 추출에 실패했습니다.';
      toast.error(msg);
    },
  });

  // ---- Handlers ----

  const handleAddKeyword = useCallback(() => {
    const trimmed = newKeyword.trim();
    if (!trimmed) return;
    addKeywordMutation.mutate(trimmed);
  }, [newKeyword, addKeywordMutation]);

  const toggleCompareId = useCallback((id: string) => {
    setCompareIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 5 ? [...prev, id] : prev
    );
  }, []);

  const handleCompare = useCallback(() => {
    if (compareIds.length >= 2) {
      compareMutation.mutate(compareIds);
    }
  }, [compareIds, compareMutation]);

  // ---- Comparison chart data ----

  const comparisonKeywords = useMemo(() => {
    if (!compareMutation.data) return [];
    return (compareMutation.data as any).keywords as MarketKeyword[];
  }, [compareMutation.data]);

  const comparisonSummary = useMemo(() => {
    if (!compareMutation.data) return '';
    return (compareMutation.data as any).comparison_summary || '';
  }, [compareMutation.data]);

  // ---- Format helpers ----

  const fmt = (n: number) => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toLocaleString();
  };

  return (
    <div className="space-y-6">
      {/* ===== 키워드 등록 섹션 ===== */}
      <Card variant="bordered">
        <CardTitle className="flex items-center gap-2 mb-4">
          <BarChart3 size={20} />
          키워드 모니터링
        </CardTitle>

        {/* Add keyword input */}
        <div className="flex gap-2 mb-4">
          <div className="flex-1 relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#62666D]" />
            <input
              type="text"
              placeholder="모니터링할 키워드를 입력하세요 (예: 스킨케어, 나이키)"
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddKeyword()}
              className="w-full pl-10 pr-4 py-3 border border-[#23252A] rounded-lg text-base focus:ring-2 focus:ring-[#5E6AD2] focus:border-[#5E6AD2] outline-none"
            />
          </div>
          <Button onClick={handleAddKeyword} loading={addKeywordMutation.isPending} disabled={!newKeyword.trim()}>
            <Plus size={16} className="mr-1" /> 등록
          </Button>
        </div>

        {/* Registered keywords list */}
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#D0D6E0]">등록된 키워드 ({keywords.length})</h3>
          <div className="flex gap-2">
            <button
              onClick={() => { setCompareMode(!compareMode); setCompareIds([]); compareMutation.reset(); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                compareMode ? 'bg-[#5E6AD2] text-white' : 'bg-[#141516] text-[#8A8F98] hover:bg-[#141516]/7'
              }`}
            >
              {compareMode ? '비교 모드 해제' : '키워드 비교'}
            </button>
          </div>
        </div>

        {isLoadingKeywords ? (
          <div className="text-center py-8 text-[#62666D]">키워드를 불러오는 중...</div>
        ) : keywords.length === 0 ? (
          <div className="text-center py-12 text-[#62666D]">
            <Search size={48} className="mx-auto mb-3 opacity-50" />
            <p className="text-[#8A8F98]">등록된 키워드가 없습니다</p>
            <p className="text-sm mt-1">위 입력란에 키워드를 입력하고 등록 버튼을 눌러주세요</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {keywords.map((kw) => {
              const isSelected = selectedKeywordId === kw.id;
              const isCompareSelected = compareIds.includes(kw.id);
              return (
                <div
                  key={kw.id}
                  className={`group flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all ${
                    compareMode
                      ? isCompareSelected
                        ? 'border-[#5E6AD2] bg-[#5E6AD2]/10 ring-2 ring-primary-200'
                        : 'border-[#23252A] hover:border-primary-300'
                      : isSelected
                        ? 'border-[#5E6AD2] bg-[#5E6AD2]/10 ring-2 ring-primary-200'
                        : 'border-[#23252A] hover:border-[#23252A]'
                  }`}
                  onClick={() => {
                    if (compareMode) {
                      toggleCompareId(kw.id);
                    } else {
                      setSelectedKeywordId(isSelected ? null : kw.id);
                    }
                  }}
                >
                  {compareMode && (
                    <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                      isCompareSelected ? 'bg-[#5E6AD2]/100 border-[#5E6AD2] text-white' : 'border-[#23252A]'
                    }`}>
                      {isCompareSelected && <Check size={12} />}
                    </div>
                  )}
                  <span className="text-sm font-medium text-[#F7F8F8]">{kw.keyword}</span>
                  {kw.last_analyzed_at && (
                    <span className="w-2 h-2 rounded-full bg-green-400" title="분석 완료" />
                  )}
                  {!compareMode && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); analyzeMutation.mutate({ id: kw.id, days: analysisDays }); }}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[#141516]/5 rounded transition-all"
                        title="분석 실행"
                      >
                        <RefreshCw size={14} className={`text-[#8A8F98] ${analyzeMutation.isPending && analyzeMutation.variables?.id === kw.id ? 'animate-spin' : ''}`} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeKeywordMutation.mutate(kw.id); }}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[#EB5757]/10 rounded transition-all"
                        title="삭제"
                      >
                        <Trash2 size={14} className="text-red-400" />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Compare button */}
        {compareMode && compareIds.length >= 2 && (
          <div className="mt-3">
            <Button onClick={handleCompare} loading={compareMutation.isPending}>
              <BarChart3 size={16} className="mr-1" /> {compareIds.length}개 키워드 비교 분석
            </Button>
          </div>
        )}
      </Card>

      {/* ===== 선택된 키워드 상세 ===== */}
      {selectedKeyword && !compareMode && (
        <>
          {/* Analysis trigger */}
          {/* Period selector */}
          <Card variant="bordered">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium text-[#D0D6E0]">분석 기간:</span>
              {[7, 14, 30, 60, 90, 180].map((d) => (
                <button key={d} onClick={() => setAnalysisDays(d)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    analysisDays === d ? 'bg-[#5E6AD2] text-white' : 'bg-[#141516] text-[#8A8F98] hover:bg-[#141516]/7'
                  }`}>
                  {d}일
                </button>
              ))}
              <div className="ml-auto">
                <Button
                  onClick={() => analyzeMutation.mutate({ id: selectedKeyword.id, days: analysisDays })}
                  loading={analyzeMutation.isPending}
                  size="sm"
                >
                  <RefreshCw size={14} className="mr-1" /> 분석 실행
                </Button>
              </div>
            </div>
          </Card>

          {!selectedKeyword.platform_data && (
            <Card variant="bordered" className="text-center py-8">
              <Sparkles size={32} className="mx-auto mb-3 text-[#62666D]" />
              <p className="text-[#8A8F98] mb-3">"{selectedKeyword.keyword}" 키워드의 분석 데이터가 없습니다</p>
              <p className="text-sm text-[#62666D]">위에서 기간을 선택하고 분석 실행 버튼을 눌러주세요</p>
            </Card>
          )}

          {/* Platform metric cards */}
          {selectedKeyword.platform_data && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* YouTube */}
                <Card variant="bordered">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-lg bg-[#EB5757]/15 flex items-center justify-center">
                      <Youtube size={18} className="text-[#EB5757]" />
                    </div>
                    <h4 className="font-semibold text-[#F7F8F8]">YouTube</h4>
                    {selectedKeyword.platform_data.api_sources?.includes('youtube') && (
                      <span className="ml-auto text-[9px] bg-[#27A644]/15 text-[#27A644] px-1.5 py-0.5 rounded font-medium">API</span>
                    )}
                  </div>
                  {selectedKeyword.platform_data.youtube ? (
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm text-[#8A8F98]">콘텐츠 수</span>
                        <span className="text-sm font-semibold">{fmt(selectedKeyword.platform_data.youtube.content_count)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-[#8A8F98]">총 조회수</span>
                        <span className="text-sm font-semibold">{fmt(selectedKeyword.platform_data.youtube.total_views)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-[#8A8F98]">총 좋아요</span>
                        <span className="text-sm font-semibold">{fmt(selectedKeyword.platform_data.youtube.total_likes || 0)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-[#8A8F98]">총 댓글</span>
                        <span className="text-sm font-semibold">{fmt(selectedKeyword.platform_data.youtube.total_comments)}</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-[#EB5757]">{selectedKeyword.platform_data.api_errors?.youtube || '데이터를 가져올 수 없습니다.'}</p>
                  )}
                </Card>

                {/* Instagram */}
                <Card variant="bordered">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-lg bg-pink-100 flex items-center justify-center">
                      <Instagram size={18} className="text-pink-600" />
                    </div>
                    <h4 className="font-semibold text-[#F7F8F8]">Instagram</h4>
                    {selectedKeyword.platform_data.api_sources?.includes('instagram') && (
                      <span className="ml-auto text-[9px] bg-[#27A644]/15 text-[#27A644] px-1.5 py-0.5 rounded font-medium">API</span>
                    )}
                  </div>
                  {selectedKeyword.platform_data.instagram ? (
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm text-[#8A8F98]">콘텐츠 수</span>
                        <span className="text-sm font-semibold">{fmt(selectedKeyword.platform_data.instagram.content_count)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-[#8A8F98]">총 조회수</span>
                        <span className="text-sm font-semibold">{fmt(selectedKeyword.platform_data.instagram.total_views)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-[#8A8F98]">총 댓글</span>
                        <span className="text-sm font-semibold">{fmt(selectedKeyword.platform_data.instagram.total_comments)}</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-[#EB5757]">{selectedKeyword.platform_data.api_errors?.instagram || '데이터를 가져올 수 없습니다.'}</p>
                  )}
                </Card>

                {/* Naver */}
                <Card variant="bordered">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-lg bg-[#27A644]/15 flex items-center justify-center">
                      <Globe size={18} className="text-[#27A644]" />
                    </div>
                    <h4 className="font-semibold text-[#F7F8F8]">Naver</h4>
                    {selectedKeyword.platform_data.api_sources?.includes('naver') && (
                      <span className="ml-auto text-[9px] bg-[#27A644]/15 text-[#27A644] px-1.5 py-0.5 rounded font-medium">API</span>
                    )}
                  </div>
                  {selectedKeyword.platform_data.naver ? (
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm text-[#8A8F98]">블로그 포스트 수</span>
                        <span className="text-sm font-semibold">{fmt(selectedKeyword.platform_data.naver.blog_post_count)}건</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-[#8A8F98]">검색 관심도</span>
                        <div className="text-right">
                          <span className="text-sm font-semibold">{selectedKeyword.platform_data.naver.search_query_volume}</span>
                          <span className="text-xs text-[#62666D] ml-1">/ 100</span>
                        </div>
                      </div>
                      <p className="text-[10px] text-[#62666D] mt-1">* 검색 관심도: 네이버 DataLab 기준 상대값 (최대 100)</p>
                    </div>
                  ) : (
                    <p className="text-xs text-[#EB5757]">{selectedKeyword.platform_data.api_errors?.naver || '데이터를 가져올 수 없습니다.'}</p>
                  )}
                </Card>
              </div>

              {/* Trend Charts */}
              <Card variant="bordered">
                <div className="flex items-center justify-between mb-4">
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp size={20} />
                    트렌드 차트 - "{selectedKeyword.keyword}"
                  </CardTitle>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setChartView('daily')}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        chartView === 'daily' ? 'bg-[#5E6AD2] text-white' : 'bg-[#141516] text-[#8A8F98] hover:bg-[#141516]/7'
                      }`}
                    >
                      일별
                    </button>
                    <button
                      onClick={() => setChartView('monthly')}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        chartView === 'monthly' ? 'bg-[#5E6AD2] text-white' : 'bg-[#141516] text-[#8A8F98] hover:bg-[#141516]/7'
                      }`}
                    >
                      월별
                    </button>
                  </div>
                </div>

                {chartView === 'daily' && selectedKeyword.platform_data.daily_trends.length > 0 && (() => {
                  const trends = selectedKeyword.platform_data!.daily_trends;
                  const hasYt = trends.some((d) => d.youtube_views > 0);
                  const hasIg = trends.some((d) => d.instagram_views > 0);
                  const hasNv = trends.some((d) => d.naver_searches > 0);
                  const datasets = [];
                  if (hasYt) datasets.push({ label: 'YouTube 조회수', data: trends.map((d) => d.youtube_views || 0), color: '#EF4444' });
                  if (hasIg) datasets.push({ label: 'Instagram 조회수', data: trends.map((d) => d.instagram_views || 0), color: '#EC4899' });
                  if (hasNv) datasets.push({ label: 'Naver 검색 관심도 (0-100)', data: trends.map((d) => d.naver_searches || 0), color: '#10B981' });
                  if (datasets.length === 0) return <p className="text-center text-[#62666D] py-6">일별 트렌드 데이터가 없습니다.</p>;
                  return (
                    <SVGLineChart
                      title="일별 트렌드 (실제 API 데이터)"
                      labels={trends.map((d) => d.date.slice(5))}
                      datasets={datasets}
                    />
                  );
                })()}

                {chartView === 'monthly' && selectedKeyword.platform_data.monthly_trends.length > 0 && (() => {
                  const trends = selectedKeyword.platform_data!.monthly_trends;
                  const hasYt = trends.some((d) => d.youtube_views > 0);
                  const hasIg = trends.some((d) => d.instagram_views > 0);
                  const hasNv = trends.some((d) => d.naver_searches > 0);
                  const datasets = [];
                  if (hasYt) datasets.push({ label: 'YouTube 조회수', data: trends.map((d) => d.youtube_views || 0), color: '#EF4444' });
                  if (hasIg) datasets.push({ label: 'Instagram 조회수', data: trends.map((d) => d.instagram_views || 0), color: '#EC4899' });
                  if (hasNv) datasets.push({ label: 'Naver 검색 관심도 (0-100)', data: trends.map((d) => d.naver_searches || 0), color: '#10B981' });
                  if (datasets.length === 0) return <p className="text-center text-[#62666D] py-6">월별 트렌드 데이터가 없습니다.</p>;
                  return (
                    <SVGLineChart
                      title="월별 트렌드 (실제 API 데이터)"
                      labels={trends.map((d) => d.month)}
                      datasets={datasets}
                    />
                  );
                })()}

                {selectedKeyword.platform_data.daily_trends.length === 0 && selectedKeyword.platform_data.monthly_trends.length === 0 && (
                  <p className="text-center text-[#62666D] py-8">일별 트렌드 데이터가 없습니다. (Naver DataLab API 연동 시 트렌드 차트가 표시됩니다)</p>
                )}
                <p className="text-[10px] text-[#62666D] mt-2 text-center">* YouTube/Instagram은 일별 트렌드 API를 제공하지 않아 집계 데이터만 표시됩니다</p>
              </Card>

              {/* Sentiment Analysis */}
              {selectedKeyword.sentiment_data && (
                <Card variant="bordered">
                  <CardTitle className="flex items-center gap-2 mb-4">
                    <MessageCircle size={20} />
                    감성 분석 - "{selectedKeyword.keyword}"
                    {selectedKeyword.sentiment_data.source && (
                      <span className="ml-2 text-[9px] bg-[#4EA7FC]/15 text-[#828FFF] px-1.5 py-0.5 rounded font-medium">
                        {selectedKeyword.sentiment_data.source === 'naver_blog_titles' ? 'Naver 블로그' : selectedKeyword.sentiment_data.source === 'youtube_engagement' ? 'YouTube' : '실제 데이터'}
                      </span>
                    )}
                  </CardTitle>

                  <SentimentBar
                    positive={selectedKeyword.sentiment_data.positive_ratio}
                    negative={selectedKeyword.sentiment_data.negative_ratio}
                    neutral={selectedKeyword.sentiment_data.neutral_ratio}
                  />

                  <div className="grid md:grid-cols-2 gap-6 mt-4">
                    <div>
                      <h4 className="font-medium text-[#27A644] mb-2">긍정 키워드</h4>
                      <div className="flex flex-wrap gap-2">
                        {selectedKeyword.sentiment_data.positive_keywords.map((kw, i) => (
                          <span key={i} className="px-2 py-1 bg-[#27A644]/15 text-[#27A644] rounded text-sm">
                            {kw.keyword} ({kw.count})
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="font-medium text-[#EB5757] mb-2">부정 키워드</h4>
                      <div className="flex flex-wrap gap-2">
                        {selectedKeyword.sentiment_data.negative_keywords.map((kw, i) => (
                          <span key={i} className="px-2 py-1 bg-[#EB5757]/15 text-[#EB5757] rounded text-sm">
                            {kw.keyword} ({kw.count})
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {selectedKeyword.sentiment_data.emotion_keywords.length > 0 && (
                    <div className="mt-4">
                      <h4 className="font-medium text-[#D0D6E0] mb-2">감정 키워드</h4>
                      <div className="flex flex-wrap gap-2">
                        {selectedKeyword.sentiment_data.emotion_keywords.map((ek, i) => {
                          const emotionColors: Record<string, string> = {
                            '기쁨': 'bg-[#F0BF00]/15 text-[#F0BF00]',
                            '슬픔': 'bg-[#4EA7FC]/15 text-[#828FFF]',
                            '분노': 'bg-[#EB5757]/15 text-[#EB5757]',
                            '놀라움': 'bg-[#5E6AD2]/15 text-purple-800',
                            '기대': 'bg-[#FC7840]/15 text-orange-800',
                          };
                          const cls = emotionColors[ek.emotion] || 'bg-[#141516] text-[#F7F8F8]';
                          return (
                            <span key={i} className={`px-2 py-1 rounded text-sm ${cls}`}>
                              {ek.keyword} ({ek.emotion}, {ek.count})
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </Card>
              )}

              {/* Related Hashtags */}
              {selectedKeyword.hashtags.length > 0 && (
                <Card variant="bordered">
                  <CardTitle className="flex items-center gap-2 mb-3">
                    <Hash size={20} className="text-[#7070FF]" />
                    관련 해시태그
                  </CardTitle>
                  <div className="flex flex-wrap gap-2">
                    {selectedKeyword.hashtags.map((tag, i) => (
                      <span key={i} className="px-3 py-1.5 bg-[#4EA7FC]/10 text-[#828FFF] rounded-full text-sm font-medium border border-[#5E6AD2]/30">
                        {tag}
                      </span>
                    ))}
                  </div>
                </Card>
              )}

              {/* Last analyzed info */}
              <p className="text-center text-xs text-[#62666D]">
                마지막 분석: {selectedKeyword.last_analyzed_at
                  ? new Date(selectedKeyword.last_analyzed_at).toLocaleString('ko-KR')
                  : '없음'}
              </p>
            </>
          )}
        </>
      )}

      {/* ===== 비교 결과 ===== */}
      {compareMode && compareMutation.data && comparisonKeywords.length >= 2 && (
        <>
          {/* Comparison summary */}
          {comparisonSummary && (
            <Card variant="bordered" className="bg-gradient-to-r from-[#08090A] to-[#08090A]">
              <CardTitle className="flex items-center gap-2 mb-3">
                <Sparkles size={20} className="text-[#7070FF]" />
                비교 분석 요약
              </CardTitle>
              <p className="text-[#D0D6E0] leading-relaxed">{comparisonSummary}</p>
            </Card>
          )}

          {/* Comparison metrics cards */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 text-[#8A8F98]">플랫폼</th>
                  {comparisonKeywords.map((kw) => (
                    <th key={kw.id} className="text-right py-2 px-3 font-semibold text-[#F7F8F8]">{kw.keyword}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b">
                  <td className="py-2 px-3 text-[#8A8F98] flex items-center gap-1"><Youtube size={14} className="text-[#EB5757]" /> YouTube 조회수</td>
                  {comparisonKeywords.map((kw) => (
                    <td key={kw.id} className="text-right py-2 px-3 font-medium">
                      {kw.platform_data?.youtube ? fmt(kw.platform_data.youtube.total_views) : <span className="text-[#62666D] text-xs">N/A</span>}
                    </td>
                  ))}
                </tr>
                <tr className="border-b">
                  <td className="py-2 px-3 text-[#8A8F98] flex items-center gap-1"><Instagram size={14} className="text-pink-500" /> Instagram 조회수</td>
                  {comparisonKeywords.map((kw) => (
                    <td key={kw.id} className="text-right py-2 px-3 font-medium">
                      {kw.platform_data?.instagram ? fmt(kw.platform_data.instagram.total_views) : <span className="text-[#62666D] text-xs">N/A</span>}
                    </td>
                  ))}
                </tr>
                <tr className="border-b">
                  <td className="py-2 px-3 text-[#8A8F98] flex items-center gap-1"><Globe size={14} className="text-green-500" /> Naver 검색 관심도</td>
                  {comparisonKeywords.map((kw) => (
                    <td key={kw.id} className="text-right py-2 px-3 font-medium">
                      {kw.platform_data?.naver ? fmt(kw.platform_data.naver.search_query_volume) : <span className="text-[#62666D] text-xs">N/A</span>}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 px-3 text-[#8A8F98]">감성 (긍정)</td>
                  {comparisonKeywords.map((kw) => (
                    <td key={kw.id} className="text-right py-2 px-3 font-medium text-[#27A644]">
                      {kw.sentiment_data ? `${(kw.sentiment_data.positive_ratio * 100).toFixed(0)}%` : '-'}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          {/* Comparison Charts */}
          <Card variant="bordered">
            <div className="flex items-center justify-between mb-4">
              <CardTitle className="flex items-center gap-2">
                <TrendingUp size={20} />
                키워드 비교 차트
              </CardTitle>
              <div className="flex gap-1">
                <button
                  onClick={() => setChartView('daily')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    chartView === 'daily' ? 'bg-[#5E6AD2] text-white' : 'bg-[#141516] text-[#8A8F98] hover:bg-[#141516]/7'
                  }`}
                >
                  일별
                </button>
                <button
                  onClick={() => setChartView('monthly')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    chartView === 'monthly' ? 'bg-[#5E6AD2] text-white' : 'bg-[#141516] text-[#8A8F98] hover:bg-[#141516]/7'
                  }`}
                >
                  월별
                </button>
              </div>
            </div>

            {chartView === 'daily' && (() => {
              const kwsWithData = comparisonKeywords.filter((k) => k.platform_data?.daily_trends?.length);
              if (kwsWithData.length === 0) return <p className="text-center text-[#62666D] py-6">일별 트렌드 데이터가 없습니다.</p>;
              const labels = kwsWithData[0].platform_data!.daily_trends.map((d) => d.date.slice(5));
              return (
                <div className="space-y-6">
                  <SVGLineChart
                    title="YouTube 조회수 비교"
                    labels={labels}
                    datasets={kwsWithData.map((kw, i) => ({
                      label: kw.keyword,
                      data: kw.platform_data!.daily_trends.map((d) => d.youtube_views),
                      color: CHART_COLORS[i % CHART_COLORS.length],
                    }))}
                  />
                  <SVGLineChart
                    title="Instagram 조회수 비교"
                    labels={labels}
                    datasets={kwsWithData.map((kw, i) => ({
                      label: kw.keyword,
                      data: kw.platform_data!.daily_trends.map((d) => d.instagram_views),
                      color: CHART_COLORS[i % CHART_COLORS.length],
                    }))}
                  />
                  <SVGLineChart
                    title="Naver 검색량 비교"
                    labels={labels}
                    datasets={kwsWithData.map((kw, i) => ({
                      label: kw.keyword,
                      data: kw.platform_data!.daily_trends.map((d) => d.naver_searches),
                      color: CHART_COLORS[i % CHART_COLORS.length],
                    }))}
                  />
                </div>
              );
            })()}

            {chartView === 'monthly' && (() => {
              const kwsWithData = comparisonKeywords.filter((k) => k.platform_data?.monthly_trends?.length);
              if (kwsWithData.length === 0) return <p className="text-center text-[#62666D] py-6">월별 트렌드 데이터가 없습니다.</p>;
              const labels = kwsWithData[0].platform_data!.monthly_trends.map((d) => d.month);
              return (
                <div className="space-y-6">
                  <SVGLineChart
                    title="YouTube 조회수 비교 (월별)"
                    labels={labels}
                    datasets={kwsWithData.map((kw, i) => ({
                      label: kw.keyword,
                      data: kw.platform_data!.monthly_trends.map((d) => d.youtube_views),
                      color: CHART_COLORS[i % CHART_COLORS.length],
                    }))}
                  />
                  <SVGLineChart
                    title="Instagram 조회수 비교 (월별)"
                    labels={labels}
                    datasets={kwsWithData.map((kw, i) => ({
                      label: kw.keyword,
                      data: kw.platform_data!.monthly_trends.map((d) => d.instagram_views),
                      color: CHART_COLORS[i % CHART_COLORS.length],
                    }))}
                  />
                  <SVGLineChart
                    title="Naver 검색량 비교 (월별)"
                    labels={labels}
                    datasets={kwsWithData.map((kw, i) => ({
                      label: kw.keyword,
                      data: kw.platform_data!.monthly_trends.map((d) => d.naver_searches),
                      color: CHART_COLORS[i % CHART_COLORS.length],
                    }))}
                  />
                </div>
              );
            })()}
          </Card>
        </>
      )}

      {/* ===== 레퍼런스 역설계 (kept from original) ===== */}
      <Card variant="bordered">
        <CardTitle className="flex items-center gap-2 mb-2">
          <TrendingUp size={20} />
          레퍼런스 역설계
        </CardTitle>
        <p className="text-sm text-[#8A8F98] mb-4">
          경쟁사의 광고/게시물/랜딩페이지 URL을 입력하면, AI가 비주얼 스타일을 분석합니다.
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-[#D0D6E0] mb-1">분석할 URL</label>
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <ExternalLink size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#62666D]" />
                <input
                  type="url"
                  placeholder="이미지 URL, Instagram 게시물, 또는 웹페이지 URL"
                  value={styleUrl}
                  onChange={(e) => setStyleUrl(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-[#23252A] rounded-lg text-base focus:ring-2 focus:ring-[#5E6AD2] focus:border-[#5E6AD2] outline-none"
                />
              </div>
              <Button onClick={() => extractStyleMutation.mutate()} loading={extractStyleMutation.isPending} disabled={!styleUrl}>
                스타일 추출
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="text-xs px-2 py-1 bg-[#141516] rounded text-[#8A8F98]">지원: 직접 이미지 URL (.jpg, .png)</span>
              <span className="text-xs px-2 py-1 bg-[#141516] rounded text-[#8A8F98]">Instagram 게시물 URL</span>
              <span className="text-xs px-2 py-1 bg-[#141516] rounded text-[#8A8F98]">웹페이지 URL (OG Image 추출)</span>
            </div>
          </div>

          {extractStyleMutation.data && (
            <div className="p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg space-y-3">
              <h4 className="font-medium text-[#F7F8F8]">추출된 스타일</h4>
              <p className="text-sm text-[#D0D6E0]">{extractStyleMutation.data.preview_description}</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {[
                  { label: '비주얼 스타일', value: extractStyleMutation.data.style.visual_style },
                  { label: '소구 유형', value: extractStyleMutation.data.style.appeal_type },
                  { label: '구도', value: extractStyleMutation.data.style.composition },
                  { label: '톤 & 매너', value: extractStyleMutation.data.style.tone_and_manner },
                  { label: '텍스트 오버레이', value: extractStyleMutation.data.style.text_overlay ? '있음' : '없음' },
                ].map((item, i) => (
                  <div key={i} className="bg-[#0F1011]/70 px-3 py-2 rounded-lg">
                    <p className="text-xs text-[#8A8F98]">{item.label}</p>
                    <p className="text-sm font-medium text-[#F7F8F8]">{item.value}</p>
                  </div>
                ))}
              </div>
              {extractStyleMutation.data.style.color_palette?.length > 0 && (
                <div>
                  <p className="text-xs text-[#8A8F98] mb-1">컬러 팔레트</p>
                  <div className="flex gap-2">
                    {extractStyleMutation.data.style.color_palette.map((color: string, i: number) => (
                      <div key={i} className="flex items-center gap-1">
                        <div className="w-6 h-6 rounded-full border border-[#23252A]" style={{ backgroundColor: color }} />
                        <span className="text-xs text-[#8A8F98]">{color}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <Button onClick={() => setActiveTab(1)}>
                이 스타일로 소재 제작하기 <ArrowRight size={16} className="ml-1" />
              </Button>
            </div>
          )}
        </div>
      </Card>

    </div>
  );
}
