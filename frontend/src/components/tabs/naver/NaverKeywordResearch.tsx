'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search, Loader2, TrendingUp, ShoppingBag, Star, AlertCircle, Sparkles, FileText,
  BarChart3, Monitor, Smartphone, Target, Clock, Plus, Trash2, Play, RefreshCw,
} from 'lucide-react';
import api, { marketApi } from '@/lib/api';
import { naverKeywordResearchApi } from '@/lib/naver-api';
import { clsx } from 'clsx';
import toast from 'react-hot-toast';

// ─── Constants ───────────────────────────────────────────────────────────────

const BRAND_NAME = '널담';

// ─── Types ───────────────────────────────────────────────────────────────────

type Period = '6m' | '1y' | '3y';
type TimeUnit = 'date' | 'week' | 'month';

interface TrendPoint {
  period: string;
  ratio: number;
}

interface ShoppingItem {
  title: string;
  image: string;
  lprice: string | number;
  hprice?: string | number;
  mallName: string;
  productId?: string;
  link?: string;
  reviewCount?: number;
  reviewAverage?: number;
}

const PERIOD_OPTIONS: { label: string; value: Period }[] = [
  { label: '6개월', value: '6m' },
  { label: '1년', value: '1y' },
  { label: '3년', value: '3y' },
];

const TIME_UNIT_OPTIONS: { label: string; value: TimeUnit }[] = [
  { label: '일별', value: 'date' },
  { label: '주별', value: 'week' },
  { label: '월별', value: 'month' },
];

// ─── SVG Trend Chart ─────────────────────────────────────────────────────────

function TrendChart({
  data,
  color = '#16a34a',
  height = 240,
}: {
  data: TrendPoint[];
  color?: string;
  height?: number;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (!data || data.length < 2) {
    return (
      <div
        className="w-full bg-gray-50 rounded-xl flex items-center justify-center text-gray-400 text-sm"
        style={{ height }}
      >
        데이터 없음
      </div>
    );
  }

  const width = 800; // internal SVG coordinate space
  const paddingX = 52;
  const paddingY = 20;
  const paddingBottom = 36;
  const chartWidth = width - paddingX * 2;
  const chartHeight = height - paddingY - paddingBottom;

  const ratios = data.map((d) => d.ratio);
  const max = Math.max(...ratios, 1);
  const min = Math.min(...ratios);
  const range = max - min || 1;

  const toX = (i: number) => paddingX + (i / (data.length - 1)) * chartWidth;
  const toY = (v: number) =>
    paddingY + chartHeight - ((v - min) / range) * chartHeight;

  const points = data
    .map((d, i) => `${toX(i)},${toY(d.ratio)}`)
    .join(' ');

  // Smooth filled area path
  const firstX = toX(0);
  const lastX = toX(data.length - 1);
  const bottomY = paddingY + chartHeight;
  const areaPoints = `${firstX},${bottomY} ${points} ${lastX},${bottomY}`;

  // X-axis labels
  const labelIndices = [
    0,
    Math.floor(data.length / 4),
    Math.floor(data.length / 2),
    Math.floor((3 * data.length) / 4),
    data.length - 1,
  ].filter((v, i, arr) => arr.indexOf(v) === i);

  // Y-axis reference lines — spread across actual data range
  const yRefValues = [
    min,
    min + range * 0.25,
    min + range * 0.5,
    min + range * 0.75,
    max,
  ].map((v) => Math.round(v));

  const gradientId = 'trendGradient';

  return (
    <div className="w-full overflow-hidden rounded-xl bg-gradient-to-b from-green-50/60 to-white border border-green-100">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full"
        style={{ height }}
        onMouseLeave={() => setHoveredIndex(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {/* Y gridlines + labels */}
        {yRefValues.map((v, idx) => {
          const y = toY(v);
          if (y < paddingY - 2 || y > paddingY + chartHeight + 2) return null;
          return (
            <g key={idx}>
              <line
                x1={paddingX}
                y1={y}
                x2={width - paddingX}
                y2={y}
                stroke="#e5e7eb"
                strokeWidth={idx === 0 || idx === yRefValues.length - 1 ? '1.5' : '1'}
                strokeDasharray={idx === 0 || idx === yRefValues.length - 1 ? '' : '4 3'}
              />
              <text
                x={paddingX - 6}
                y={y + 4}
                textAnchor="end"
                fontSize="10"
                fill="#9ca3af"
              >
                {v.toLocaleString()}
              </text>
            </g>
          );
        })}

        {/* Area fill */}
        <polygon
          points={areaPoints}
          fill={`url(#${gradientId})`}
        />

        {/* Line */}
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={points}
        />

        {/* Invisible wide hit targets for hover */}
        {data.map((d, i) => {
          const x = toX(i);
          const segW = chartWidth / (data.length - 1);
          return (
            <rect
              key={i}
              x={x - segW / 2}
              y={paddingY}
              width={segW}
              height={chartHeight}
              fill="transparent"
              onMouseEnter={() => setHoveredIndex(i)}
            />
          );
        })}

        {/* Hovered point: vertical guide + dot + tooltip */}
        {hoveredIndex !== null && (() => {
          const d = data[hoveredIndex];
          const x = toX(hoveredIndex);
          const y = toY(d.ratio);
          const tooltipW = 120;
          const tooltipH = 44;
          const tooltipX = Math.min(
            Math.max(x - tooltipW / 2, paddingX),
            width - paddingX - tooltipW,
          );
          const tooltipY = y - tooltipH - 10 < paddingY ? y + 12 : y - tooltipH - 10;

          return (
            <>
              {/* Vertical guide line */}
              <line
                x1={x}
                y1={paddingY}
                x2={x}
                y2={paddingY + chartHeight}
                stroke={color}
                strokeWidth="1"
                strokeDasharray="4 3"
                strokeOpacity="0.5"
              />
              {/* Dot */}
              <circle cx={x} cy={y} r="5" fill={color} stroke="white" strokeWidth="2" />
              {/* Tooltip bubble */}
              <rect
                x={tooltipX}
                y={tooltipY}
                width={tooltipW}
                height={tooltipH}
                rx="7"
                ry="7"
                fill="white"
                stroke="#e5e7eb"
                strokeWidth="1"
                filter="drop-shadow(0 2px 6px rgba(0,0,0,0.10))"
              />
              <text
                x={tooltipX + tooltipW / 2}
                y={tooltipY + 16}
                textAnchor="middle"
                fontSize="10"
                fill="#6b7280"
              >
                {formatPeriodLabel(d.period)}
              </text>
              <text
                x={tooltipX + tooltipW / 2}
                y={tooltipY + 32}
                textAnchor="middle"
                fontSize="13"
                fontWeight="600"
                fill={color}
              >
                {d.ratio.toLocaleString()}
              </text>
            </>
          );
        })()}

        {/* Dots: only visible on hover */}
        {data.map((d, i) => (
          <circle
            key={i}
            cx={toX(i)}
            cy={toY(d.ratio)}
            r="3"
            fill={color}
            fillOpacity={hoveredIndex === i ? 1 : 0}
            stroke="white"
            strokeWidth="1.5"
            strokeOpacity={hoveredIndex === i ? 1 : 0}
          />
        ))}

        {/* X-axis labels */}
        {labelIndices.map((i) => (
          <text
            key={i}
            x={toX(i)}
            y={height - 8}
            textAnchor="middle"
            fontSize="11"
            fill={hoveredIndex === i ? color : '#9ca3af'}
            fontWeight={hoveredIndex === i ? '600' : '400'}
          >
            {formatPeriodLabel(data[i].period)}
          </text>
        ))}
      </svg>
    </div>
  );
}

function formatPeriodLabel(period: string): string {
  // period can be "2025-01-01", "2025-01", "2025-W04", etc.
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) {
    return period.slice(5); // "MM-DD"
  }
  if (/^\d{4}-\d{2}$/.test(period)) {
    return period.slice(2); // "YY-MM"
  }
  return period.slice(-5);
}

// ─── Shopping Product Card ────────────────────────────────────────────────────

function ProductCard({ item, rank }: { item: ShoppingItem; rank: number }) {
  const price = Number(item.lprice) || 0;
  const highPrice = Number(item.hprice) || 0;
  const hasRange = highPrice > 0 && highPrice !== price;

  // Strip HTML tags from title (Naver API sometimes returns <b>tags</b>)
  const cleanTitle = item.title.replace(/<[^>]*>/g, '');

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition-shadow group">
      {/* Image area */}
      <div className="relative aspect-square bg-gray-100 overflow-hidden">
        {item.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.image}
            alt={cleanTitle}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ShoppingBag size={40} className="text-gray-300" />
          </div>
        )}
        {/* Rank badge */}
        <div className="absolute top-2 left-2 w-7 h-7 rounded-full bg-green-600 text-white text-xs font-bold flex items-center justify-center shadow">
          {rank}
        </div>
      </div>

      {/* Info */}
      <div className="p-3 space-y-1">
        <p className="text-xs text-gray-500 truncate">{item.mallName}</p>
        <p className="text-sm font-medium text-gray-900 line-clamp-2 leading-tight min-h-[2.5rem]">
          {cleanTitle}
        </p>
        <div className="flex items-baseline gap-1 pt-0.5">
          <span className="text-sm font-bold text-green-700">
            {price > 0 ? `₩${price.toLocaleString('ko-KR')}` : '가격 미정'}
          </span>
          {hasRange && (
            <span className="text-xs text-gray-400">
              ~ ₩{highPrice.toLocaleString('ko-KR')}
            </span>
          )}
        </div>
        {(item.reviewCount ?? 0) > 0 && (
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <Star size={10} className="text-yellow-400 fill-yellow-400" />
            <span>{item.reviewAverage?.toFixed(1)}</span>
            <span>({(item.reviewCount ?? 0).toLocaleString()})</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Markdown Helper ─────────────────────────────────────────────────────────

function simpleMarkdownToHtml(text: string): string {
  return text
    // H2 headers - section headers
    .replace(/^## (.+)$/gm, '<h3 class="text-base font-bold text-gray-900 mt-6 mb-3 pb-2 border-b border-gray-200">$1</h3>')
    // H3 headers
    .replace(/^### (.+)$/gm, '<h4 class="text-sm font-bold text-purple-800 mt-4 mb-2 flex items-center gap-1"><span class="w-1 h-4 bg-purple-500 rounded-full inline-block mr-1"></span>$1</h4>')
    // H4 headers
    .replace(/^#### (.+)$/gm, '<h5 class="text-sm font-semibold text-gray-700 mt-3 mb-1">$1</h5>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>')
    // Numbered lists with better spacing
    .replace(/^(\d+)\. (.+)$/gm, '<div class="flex gap-3 ml-1 my-1.5"><span class="flex-shrink-0 w-6 h-6 rounded-full bg-purple-100 text-purple-700 text-xs font-bold flex items-center justify-center">$1</span><span class="pt-0.5">$2</span></div>')
    // Bullet points
    .replace(/^[-•] (.+)$/gm, '<div class="flex gap-2 ml-3 my-1"><span class="text-purple-400 mt-1.5">▸</span><span>$1</span></div>')
    // Double line breaks = paragraph gap
    .replace(/\n\n/g, '<div class="h-3"></div>')
    .replace(/\n/g, '<br/>');
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function NaverKeywordResearch() {
  const [inputValue, setInputValue] = useState('');
  const [searchedKeyword, setSearchedKeyword] = useState('');
  const [period, setPeriod] = useState<Period>('1y');
  const [timeUnit, setTimeUnit] = useState<TimeUnit>('month');
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // AI analysis state
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiCollapsed, setAiCollapsed] = useState(true);

  const handleSearch = () => {
    const kw = inputValue.trim();
    if (!kw) return;
    setSearchedKeyword(kw);
    // Reset AI analysis when new keyword is searched
    setAiAnalysis(null);
    setAiError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSearch();
  };

  // ── 키워드 등록/관리 (DB 저장) ──
  const { data: registeredKeywords = [], isLoading: kwLoading } = useQuery<any[]>({
    queryKey: ['market-keywords'],
    queryFn: marketApi.listKeywords,
  });

  const registerKeyword = useMutation({
    mutationFn: (kw: string) => marketApi.registerKeyword(kw),
    onSuccess: (d: any) => { queryClient.invalidateQueries({ queryKey: ['market-keywords'] }); toast.success(`"${d.keyword}" 등록 완료`); },
    onError: (e: any) => toast.error(e?.response?.data?.detail || '등록 실패'),
  });

  const removeKeyword = useMutation({
    mutationFn: (id: string) => marketApi.removeKeyword(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['market-keywords'] }); toast.success('키워드 삭제'); },
  });

  const handleAiAnalysis = async () => {
    if (!searchedKeyword || shoppingItems.length === 0) return;
    setAiLoading(true);
    setAiError(null);
    setAiAnalysis(null);
    try {
      const top10 = shoppingItems.slice(0, 10).map((item, idx) => ({
        rank: idx + 1,
        title: item.title.replace(/<[^>]*>/g, ''),
        price: Number(item.lprice) || null,
        mallName: item.mallName || null,
      }));
      const result = await naverKeywordResearchApi.analyzeRanking(
        searchedKeyword,
        BRAND_NAME,
        top10,
      );
      setAiAnalysis(result.analysis);
    } catch (err: any) {
      setAiError('AI 분석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleDownloadPdf = () => {
    if (!aiAnalysis) return;
    const htmlContent = `
    <!DOCTYPE html>
    <html><head>
      <meta charset="utf-8">
      <title>키워드 리서치 분석 - ${searchedKeyword}</title>
      <style>
        body { font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; color: #333; line-height: 1.7; }
        h1 { color: #7c3aed; border-bottom: 2px solid #7c3aed; padding-bottom: 8px; }
        h2 { color: #374151; margin-top: 24px; }
        h4 { color: #4b5563; margin-top: 16px; }
        strong { color: #111827; }
        .meta { color: #6b7280; font-size: 14px; margin-bottom: 24px; }
        .content { font-size: 15px; }
      </style>
    </head><body>
      <h1>키워드 리서치 AI 분석</h1>
      <div class="meta">
        <p>키워드: <strong>${searchedKeyword}</strong> | 브랜드: <strong>${BRAND_NAME}</strong></p>
        <p>분석일: ${new Date().toLocaleDateString('ko-KR')}</p>
      </div>
      <div class="content">${simpleMarkdownToHtml(aiAnalysis)}</div>
    </body></html>
  `;
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const printWindow = window.open(url, '_blank');
    if (printWindow) {
      printWindow.onload = () => {
        printWindow.print();
        URL.revokeObjectURL(url);
      };
    }
  };

  // ── Shopping query ────────────────────────────────────────────────────────
  const {
    data: shoppingData,
    isLoading: shoppingLoading,
    isError: shoppingError,
  } = useQuery({
    queryKey: ['keyword-research-shopping', searchedKeyword],
    queryFn: async () => {
      const { data } = await api.get('/naver/keyword-research/shopping', {
        params: { keyword: searchedKeyword, display: 40 },
      });
      return data as { items: ShoppingItem[] };
    },
    enabled: !!searchedKeyword,
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });

  // ── Trend query ───────────────────────────────────────────────────────────
  const {
    data: trendData,
    isLoading: trendLoading,
    isError: trendError,
  } = useQuery({
    queryKey: ['keyword-research-trend', searchedKeyword, period, timeUnit],
    queryFn: async () => {
      const { data } = await api.get('/naver/keyword-research/trend', {
        params: {
          keyword: searchedKeyword,
          time_unit: timeUnit,
          period,
        },
      });
      return data as { data: TrendPoint[]; keyword: string; time_unit: string };
    },
    enabled: !!searchedKeyword,
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });

  // ── Search volume (absolute) query ──────────────────────────────────────
  const {
    data: volumeData,
    isLoading: volumeLoading,
  } = useQuery({
    queryKey: ['keyword-research-volume', searchedKeyword],
    queryFn: async () => {
      const { data } = await api.get('/naver/keyword-research/search-volume', {
        params: { keyword: searchedKeyword },
      });
      return data as {
        keyword: string;
        available: boolean;
        message?: string;
        data: { keyword: string; monthlyPcQcCnt: number; monthlyMobileQcCnt: number; monthlyTotalQcCnt: number; compIdx: string }[];
      };
    },
    enabled: !!searchedKeyword,
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });

  const shoppingItems: ShoppingItem[] = shoppingData?.items ?? [];
  const trendPoints: TrendPoint[] = trendData?.data ?? [];
  const isLoading = shoppingLoading || trendLoading;

  // Scale trend ratios to approximate absolute values if volume data is available
  const scaledTrendPoints: TrendPoint[] = (() => {
    if (!volumeData?.available || !volumeData.data.length || !trendPoints.length) return trendPoints;
    const exact = volumeData.data.find(d => d.keyword === searchedKeyword) || volumeData.data[0];
    const totalMonthly = exact.monthlyTotalQcCnt;
    if (!totalMonthly) return trendPoints;
    // The max ratio in trend data = 100 corresponds to the peak month
    // Scale all ratios proportionally. Peak month ≈ totalMonthly (current)
    const maxRatio = Math.max(...trendPoints.map(p => p.ratio), 1);
    return trendPoints.map(p => ({
      ...p,
      ratio: Math.round((p.ratio / maxRatio) * totalMonthly),
    }));
  })();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Search className="text-green-600" size={28} />
            키워드 리서치
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            네이버 쇼핑 랭킹 & 검색 트렌드 분석
          </p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            />
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="검색할 키워드를 입력하세요 (예: 에어프라이어)"
              className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-gray-300 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-500 focus:outline-none"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={!inputValue.trim() || isLoading}
            className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Search size={16} />
            )}
            검색
          </button>
          <button
            onClick={() => { const kw = inputValue.trim(); if (kw) registerKeyword.mutate(kw); }}
            disabled={!inputValue.trim() || registerKeyword.isPending}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-white text-green-700 border border-green-300 rounded-lg text-sm font-medium hover:bg-green-50 disabled:opacity-50 transition-colors"
            title="순위 모니터링용 키워드 등록"
          >
            <Plus size={15} /> 등록
          </button>
        </div>

        {/* 등록된 키워드 목록 */}
        {registeredKeywords.length > 0 && (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">등록 키워드:</span>
            {registeredKeywords.map((kw: any) => (
              <span key={kw.id} className="inline-flex items-center gap-1 px-2.5 py-1 bg-green-50 text-green-800 rounded-full text-xs border border-green-200">
                <button onClick={() => { setInputValue(kw.keyword); setSearchedKeyword(kw.keyword); }} className="hover:underline">{kw.keyword}</button>
                <button onClick={() => removeKeyword.mutate(kw.id)} className="text-green-400 hover:text-red-500 ml-0.5"><Trash2 size={11} /></button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Empty state */}
      {!searchedKeyword && (
        <div className="bg-white rounded-xl border border-gray-200 py-20 flex flex-col items-center gap-4 text-gray-400">
          <Search size={56} className="text-gray-200" />
          <p className="text-base font-medium">키워드를 검색하면 결과가 여기에 표시됩니다</p>
          <p className="text-sm">쇼핑 랭킹과 검색량 트렌드를 한눈에 확인하세요</p>
        </div>
      )}

      {/* Results */}
      {searchedKeyword && (
        <>
          {/* ── Trend Section ─────────────────────────────────────────── */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
              <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                <TrendingUp size={18} className="text-green-600" />
                검색량 트렌드
                <span className="ml-1 px-2 py-0.5 bg-green-50 text-green-700 rounded text-xs font-medium border border-green-200">
                  {searchedKeyword}
                </span>
              </h2>

              {/* Controls */}
              <div className="flex items-center gap-3">
                {/* Period */}
                <div className="flex items-center bg-gray-100 rounded-lg p-0.5 gap-0.5">
                  {PERIOD_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setPeriod(opt.value)}
                      className={clsx(
                        'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                        period === opt.value
                          ? 'bg-white shadow-sm text-green-700'
                          : 'text-gray-500 hover:text-gray-700'
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Time Unit */}
                <div className="flex items-center bg-gray-100 rounded-lg p-0.5 gap-0.5">
                  {TIME_UNIT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setTimeUnit(opt.value)}
                      className={clsx(
                        'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                        timeUnit === opt.value
                          ? 'bg-white shadow-sm text-green-700'
                          : 'text-gray-500 hover:text-gray-700'
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Chart body */}
            {trendLoading ? (
              <div className="flex items-center justify-center py-16 gap-2 text-gray-400">
                <Loader2 size={22} className="animate-spin text-green-500" />
                <span className="text-sm">트렌드 데이터 로딩 중...</span>
              </div>
            ) : trendError ? (
              <div className="flex items-center justify-center py-16 gap-2 text-red-400">
                <AlertCircle size={20} />
                <span className="text-sm">트렌드 데이터를 불러오지 못했습니다.</span>
              </div>
            ) : trendPoints.length > 0 ? (
              <div>
                <TrendChart data={scaledTrendPoints} height={240} />
              </div>
            ) : (
              <div className="flex items-center justify-center py-16 text-gray-400 text-sm">
                검색 결과가 없습니다.
              </div>
            )}
          </div>

          {/* ── Absolute Search Volume ─────────────────────────────────── */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2 mb-4">
              <BarChart3 size={18} className="text-green-600" />
              월간 검색량 (절대값)
              <span className="ml-1 px-2 py-0.5 bg-green-50 text-green-700 rounded text-xs font-medium border border-green-200">
                {searchedKeyword}
              </span>
            </h2>
            {volumeLoading ? (
              <div className="flex items-center justify-center py-10 gap-2 text-gray-400">
                <Loader2 size={20} className="animate-spin text-green-500" />
                <span className="text-sm">검색량 조회 중...</span>
              </div>
            ) : volumeData?.available && volumeData.data.length > 0 ? (
              <>
                {/* Summary cards for exact keyword */}
                {(() => {
                  const exact = volumeData.data.find(d => d.keyword === searchedKeyword) || volumeData.data[0];
                  return (
                    <div className="grid grid-cols-3 gap-4 mb-5">
                      <div className="bg-gradient-to-br from-green-50 to-white border border-green-200 rounded-xl p-4 text-center">
                        <div className="flex items-center justify-center gap-1.5 text-xs text-gray-500 mb-1">
                          <BarChart3 size={13} /> 총 월간 검색량
                        </div>
                        <p className="text-2xl font-bold text-green-700">{exact.monthlyTotalQcCnt.toLocaleString()}</p>
                      </div>
                      <div className="bg-gradient-to-br from-blue-50 to-white border border-blue-200 rounded-xl p-4 text-center">
                        <div className="flex items-center justify-center gap-1.5 text-xs text-gray-500 mb-1">
                          <Monitor size={13} /> PC 검색량
                        </div>
                        <p className="text-2xl font-bold text-blue-700">{exact.monthlyPcQcCnt.toLocaleString()}</p>
                      </div>
                      <div className="bg-gradient-to-br from-orange-50 to-white border border-orange-200 rounded-xl p-4 text-center">
                        <div className="flex items-center justify-center gap-1.5 text-xs text-gray-500 mb-1">
                          <Smartphone size={13} /> 모바일 검색량
                        </div>
                        <p className="text-2xl font-bold text-orange-700">{exact.monthlyMobileQcCnt.toLocaleString()}</p>
                      </div>
                    </div>
                  );
                })()}
                {/* Related keywords table */}
                {volumeData.data.length > 1 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">연관 키워드 검색량</h3>
                    <div className="overflow-x-auto rounded-lg border border-gray-200">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 text-gray-600 text-xs">
                            <th className="text-left px-3 py-2 font-medium">키워드</th>
                            <th className="text-right px-3 py-2 font-medium">총 검색량</th>
                            <th className="text-right px-3 py-2 font-medium">PC</th>
                            <th className="text-right px-3 py-2 font-medium">모바일</th>
                            <th className="text-right px-3 py-2 font-medium">경쟁강도</th>
                          </tr>
                        </thead>
                        <tbody>
                          {volumeData.data.slice(0, 10).map((item, idx) => (
                            <tr key={idx} className={clsx('border-t border-gray-100', item.keyword === searchedKeyword && 'bg-green-50 font-semibold')}>
                              <td className="px-3 py-2 text-gray-900">{item.keyword}</td>
                              <td className="text-right px-3 py-2 text-gray-700">{item.monthlyTotalQcCnt.toLocaleString()}</td>
                              <td className="text-right px-3 py-2 text-gray-500">{item.monthlyPcQcCnt.toLocaleString()}</td>
                              <td className="text-right px-3 py-2 text-gray-500">{item.monthlyMobileQcCnt.toLocaleString()}</td>
                              <td className="text-right px-3 py-2">
                                <span className={clsx('px-1.5 py-0.5 rounded text-xs', {
                                  'bg-red-100 text-red-700': item.compIdx === '높음',
                                  'bg-yellow-100 text-yellow-700': item.compIdx === '중간',
                                  'bg-green-100 text-green-700': item.compIdx === '낮음',
                                  'bg-gray-100 text-gray-600': !item.compIdx || !['높음', '중간', '낮음'].includes(item.compIdx),
                                })}>
                                  {item.compIdx || '-'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="bg-gray-50 rounded-xl p-5 text-center text-sm text-gray-500">
                <BarChart3 size={28} className="text-gray-300 mx-auto mb-2" />
                {volumeData?.message || '검색광고 API 연동 후 절대 검색량을 확인할 수 있습니다.'}
              </div>
            )}
          </div>

          {/* ── AI Ranking Analysis ─────────────────────────────────────── */}
          {shoppingItems.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                  <Sparkles size={18} className="text-purple-500" />
                  AI 랭킹 분석
                  <span className="ml-1 px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-xs font-medium border border-purple-200">
                    {BRAND_NAME}
                  </span>
                </h2>
                <div className="flex items-center gap-2">
                  {aiAnalysis && (
                    <button
                      onClick={handleDownloadPdf}
                      className="flex items-center gap-2 px-4 py-2 bg-white border border-purple-300 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-50 transition-colors"
                    >
                      <FileText size={15} />
                      PDF 다운로드
                    </button>
                  )}
                  <button
                    onClick={handleAiAnalysis}
                    disabled={aiLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {aiLoading ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Sparkles size={15} />
                    )}
                    {aiLoading ? '분석 중...' : 'AI 랭킹 분석'}
                  </button>
                </div>
              </div>

              {aiLoading && (
                <div className="flex items-center justify-center py-16 gap-2 text-gray-400">
                  <Loader2 size={22} className="animate-spin text-purple-500" />
                  <span className="text-sm">Claude AI가 랭킹을 분석하고 있습니다...</span>
                </div>
              )}

              {aiError && !aiLoading && (
                <div className="flex items-center gap-2 py-4 text-red-500 text-sm">
                  <AlertCircle size={16} />
                  {aiError}
                </div>
              )}

              {aiAnalysis && !aiLoading && (
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  {/* Report header */}
                  <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-4">
                    <div className="flex items-center gap-2 text-white">
                      <Sparkles size={16} />
                      <span className="font-bold text-sm">AI 마케팅 전략 리포트</span>
                    </div>
                    <div className="flex items-center gap-4 mt-1.5 text-purple-200 text-xs">
                      <span>키워드: {searchedKeyword}</span>
                      <span>브랜드: {BRAND_NAME}</span>
                      <span>{new Date().toLocaleDateString('ko-KR')}</span>
                    </div>
                  </div>
                  {/* Report body */}
                  <div className={clsx('px-6 py-5 relative', aiCollapsed && 'max-h-[400px] overflow-hidden')}>
                    <div
                      className="text-sm text-gray-700 leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: simpleMarkdownToHtml(aiAnalysis) }}
                    />
                    {aiCollapsed && (
                      <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-white to-transparent" />
                    )}
                  </div>
                  {/* Toggle button */}
                  <div className="px-6 py-3 border-t border-gray-100 flex justify-center">
                    <button
                      onClick={() => setAiCollapsed(!aiCollapsed)}
                      className="text-sm text-purple-600 font-medium hover:text-purple-700 flex items-center gap-1"
                    >
                      {aiCollapsed ? '전체 보기 ▼' : '접기 ▲'}
                    </button>
                  </div>
                </div>
              )}

              {!aiAnalysis && !aiLoading && !aiError && (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-gray-400">
                  <Sparkles size={40} className="text-purple-200" />
                  <p className="text-sm">버튼을 눌러 "{BRAND_NAME}" 브랜드의 랭킹 전략을 AI로 분석해보세요.</p>
                </div>
              )}
            </div>
          )}

          {/* ── Shopping Results ───────────────────────────────────────── */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                <ShoppingBag size={18} className="text-green-600" />
                네이버 쇼핑 랭킹
                <span className="ml-1 px-2 py-0.5 bg-green-50 text-green-700 rounded text-xs font-medium border border-green-200">
                  {searchedKeyword}
                </span>
              </h2>
              {shoppingItems.length > 0 && (
                <span className="text-xs text-gray-400">
                  상위 {shoppingItems.length}개 상품
                </span>
              )}
            </div>

            {shoppingLoading ? (
              <div className="flex items-center justify-center py-20 gap-2 text-gray-400">
                <Loader2 size={22} className="animate-spin text-green-500" />
                <span className="text-sm">쇼핑 데이터 로딩 중...</span>
              </div>
            ) : shoppingError ? (
              <div className="flex items-center justify-center py-20 gap-2 text-red-400">
                <AlertCircle size={20} />
                <span className="text-sm">쇼핑 데이터를 불러오지 못했습니다.</span>
              </div>
            ) : shoppingItems.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {shoppingItems.map((item, idx) => (
                  <ProductCard key={item.productId ?? idx} item={item} rank={idx + 1} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-400">
                <ShoppingBag size={48} className="text-gray-200" />
                <p className="text-sm">쇼핑 결과가 없습니다.</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* ═══ 키워드 순위 모니터링 ═══ */}
      <KeywordRankMonitor brandName={BRAND_NAME} registeredKeywords={registeredKeywords} />
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// AiRankAnalysis — AI 분석 결과를 섹션별 카드로 렌더링
// ═══════════════════════════════════════════════════════════════════════════════

function AiRankAnalysis({ text }: { text: string }) {
  // 텍스트를 섹션별로 파싱 (숫자. 또는 ** 로 시작하는 헤딩 기준)
  const sections: { title: string; content: string; type: 'status' | 'up' | 'keep' | 'action' | 'default' }[] = [];
  const lines = text.split('\n');
  let currentTitle = '';
  let currentLines: string[] = [];

  const detectType = (title: string): 'status' | 'up' | 'keep' | 'action' | 'default' => {
    const t = title.toLowerCase();
    if (t.includes('평가') || t.includes('현황') || t.includes('현재')) return 'status';
    if (t.includes('올리') || t.includes('개선') || t.includes('낮') || t.includes('높이')) return 'up';
    if (t.includes('유지') || t.includes('높') || t.includes('방어')) return 'keep';
    if (t.includes('액션') || t.includes('요약') || t.includes('핵심') || t.includes('전략') || t.includes('결론')) return 'action';
    return 'default';
  };

  const flush = () => {
    if (currentTitle || currentLines.length > 0) {
      sections.push({
        title: currentTitle,
        content: currentLines.join('\n').trim(),
        type: detectType(currentTitle),
      });
    }
    currentTitle = '';
    currentLines = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(/^(?:\d+[\.\)]\s*\**|#{1,3}\s+|\*\*\d*[\.\)]?\s*)(.+?)(?:\**\s*)$/);
    if (headingMatch) {
      flush();
      currentTitle = headingMatch[1].replace(/\*\*/g, '').trim();
    } else {
      currentLines.push(line);
    }
  }
  flush();

  // 섹션이 하나뿐이면(파싱 실패) 전체를 하나의 카드로
  if (sections.length <= 1) {
    sections.length = 0;
    sections.push({ title: '', content: text, type: 'default' });
  }

  const typeStyles = {
    status: { border: 'border-blue-200', bg: 'bg-blue-50', icon: '📊', iconBg: 'bg-blue-100', titleColor: 'text-blue-900' },
    up: { border: 'border-orange-200', bg: 'bg-orange-50', icon: '📈', iconBg: 'bg-orange-100', titleColor: 'text-orange-900' },
    keep: { border: 'border-green-200', bg: 'bg-green-50', icon: '🛡️', iconBg: 'bg-green-100', titleColor: 'text-green-900' },
    action: { border: 'border-purple-200', bg: 'bg-purple-50', icon: '🎯', iconBg: 'bg-purple-100', titleColor: 'text-purple-900' },
    default: { border: 'border-gray-200', bg: 'bg-gray-50', icon: '💡', iconBg: 'bg-gray-100', titleColor: 'text-gray-900' },
  };

  const renderContent = (content: string) => {
    return content.split('\n').map((line, i) => {
      const trimmed = line.trim();
      if (!trimmed) return null;
      // 불릿 라인
      const bulletMatch = trimmed.match(/^[-•▸▹→]\s*(.+)/);
      if (bulletMatch) {
        return (
          <div key={i} className="flex gap-2 items-start py-0.5">
            <span className="text-green-500 mt-0.5 flex-shrink-0">▸</span>
            <span dangerouslySetInnerHTML={{ __html: boldify(bulletMatch[1]) }} />
          </div>
        );
      }
      return <p key={i} className="py-0.5" dangerouslySetInnerHTML={{ __html: boldify(trimmed) }} />;
    });
  };

  const boldify = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '<strong class="text-gray-900">$1</strong>');

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-emerald-900 flex items-center gap-1.5">
        <Sparkles size={15} /> AI 순위 분석 & 전략 제안
      </h4>
      <div className="grid gap-3">
        {sections.map((sec, i) => {
          const style = typeStyles[sec.type];
          return (
            <div key={i} className={clsx('rounded-xl border p-4', style.border, style.bg)}>
              {sec.title && (
                <div className="flex items-center gap-2 mb-2.5">
                  <span className={clsx('w-7 h-7 rounded-lg flex items-center justify-center text-sm', style.iconBg)}>{style.icon}</span>
                  <h5 className={clsx('text-sm font-semibold', style.titleColor)}>{sec.title}</h5>
                </div>
              )}
              <div className="text-xs text-gray-700 leading-relaxed pl-0.5">
                {renderContent(sec.content)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// KeywordRankMonitor — 브랜드 키워드 순위 체크 + 스케줄 이메일 리포트
// ═══════════════════════════════════════════════════════════════════════════════

function KeywordRankMonitor({ brandName, registeredKeywords = [] }: { brandName: string; registeredKeywords: any[] }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [rankResult, setRankResult] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState('');
  const [schedDays, setSchedDays] = useState<number[]>([1, 2, 3, 4, 5]); // 1=월~5=금
  const [schedHour, setSchedHour] = useState(9);
  const [schedMinute, setSchedMinute] = useState(0);

  const toggleDay = (d: number) => setSchedDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort());

  const rankCheck = useMutation({
    mutationFn: () => naverKeywordResearchApi.checkRanks(undefined, brandName),
    onSuccess: (d: any) => { setRankResult(d); toast.success('순위 체크 완료!'); },
    onError: (e: any) => toast.error(e?.response?.data?.detail || '순위 체크 실패'),
  });

  const { data: schedules = [], refetch: refetchSchedules } = useQuery<any[]>({
    queryKey: ['naver-rank-schedules'],
    queryFn: naverKeywordResearchApi.listRankSchedules,
    enabled: open,
  });

  const createSched = useMutation({
    mutationFn: () => naverKeywordResearchApi.createRankSchedule({
      name: `${brandName} 순위 리포트`,
      brand_name: brandName,
      schedule_type: schedDays.length >= 5 ? 'daily' : 'weekly',
      days_of_week: schedDays,
      send_hour: schedHour,
      send_minute: schedMinute,
      email_to: email,
    }),
    onSuccess: () => { refetchSchedules(); setShowForm(false); toast.success('스케줄 등록 완료'); },
    onError: (e: any) => toast.error(e?.response?.data?.detail || '등록 실패'),
  });

  const deleteSched = useMutation({
    mutationFn: (id: string) => naverKeywordResearchApi.deleteRankSchedule(id),
    onSuccess: () => { refetchSchedules(); toast.success('삭제 완료'); },
  });

  const runNow = useMutation({
    mutationFn: (id: string) => naverKeywordResearchApi.runRankScheduleNow(id),
    onSuccess: (d: any) => { setRankResult(d); refetchSchedules(); toast.success('즉시 실행 완료!'); },
    onError: (e: any) => toast.error(e?.response?.data?.detail || '실행 실패'),
  });

  return (
    <div className="mt-8 rounded-xl border border-green-200 bg-white overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-green-50 transition-colors"
      >
        <span className="flex items-center gap-2 font-semibold text-green-900">
          <Target size={18} /> 키워드 순위 모니터링
        </span>
        <span className={clsx('text-xs px-3 py-1 rounded-full font-medium', open ? 'bg-green-600 text-white' : 'bg-green-100 text-green-700')}>
          {open ? '접기' : '펼치기'}
        </span>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-green-100">
          {/* 즉시 체크 */}
          <div className="flex items-center gap-3 p-3 mt-4 bg-green-50 rounded-lg">
            <div className="flex-1">
              <p className="text-sm font-medium text-green-900">등록된 {registeredKeywords.length}개 키워드의 &quot;{brandName}&quot; 네이버 쇼핑/블로그 순위 체크</p>
              <p className="text-xs text-green-600 mt-0.5">위 검색바에서 키워드를 등록한 후 순위를 체크하세요</p>
            </div>
            <button
              onClick={() => rankCheck.mutate()}
              disabled={rankCheck.isPending || registeredKeywords.length === 0}
              className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {rankCheck.isPending ? <><RefreshCw size={14} className="animate-spin" /> 체크 중...</> : <><Search size={14} /> 순위 체크</>}
            </button>
          </div>
          {registeredKeywords.length === 0 && (
            <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded-lg">키워드가 등록되지 않았습니다. 위 검색바에서 키워드를 입력하고 [+ 등록] 버튼을 눌러주세요.</p>
          )}

          {/* 결과 테이블 */}
          {rankResult?.rank_results && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-800">
                순위 결과 ({rankResult.keywords_checked || rankResult.rank_results.length}개 키워드)
              </h3>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-gray-600">
                      <th className="px-4 py-2.5 text-left font-medium">키워드</th>
                      <th className="px-4 py-2.5 text-left font-medium">네이버 쇼핑</th>
                      <th className="px-4 py-2.5 text-left font-medium">네이버 블로그</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankResult.rank_results.map((r: any, i: number) => (
                      <tr key={i} className="border-t hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-medium text-gray-900">{r.keyword}</td>
                        <td className="px-4 py-2.5">
                          {r.shopping_ranks?.length > 0
                            ? <span className={clsx('font-bold', r.shopping_ranks[0].rank <= 10 ? 'text-green-600' : r.shopping_ranks[0].rank <= 30 ? 'text-yellow-600' : 'text-red-600')}>{r.shopping_ranks[0].rank}위</span>
                            : <span className="text-red-500 font-medium">미노출</span>}
                          <span className="text-gray-400 ml-1.5">/ {r.shopping_total?.toLocaleString()}건</span>
                        </td>
                        <td className="px-4 py-2.5">
                          {r.blog_ranks?.length > 0
                            ? <span className={clsx('font-bold', r.blog_ranks[0].rank <= 10 ? 'text-green-600' : r.blog_ranks[0].rank <= 30 ? 'text-yellow-600' : 'text-red-600')}>{r.blog_ranks[0].rank}위</span>
                            : <span className="text-red-500 font-medium">미노출</span>}
                          <span className="text-gray-400 ml-1.5">/ {r.blog_total?.toLocaleString()}건</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* AI 분석 */}
              {rankResult.ai_analysis && (
                <AiRankAnalysis text={rankResult.ai_analysis} />
              )}
            </div>
          )}

          {/* 스케줄 */}
          <div className="border-t border-green-100 pt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                <Clock size={14} /> 자동 순위 리포트 스케줄
              </h3>
              <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 rounded-lg hover:bg-green-100 border border-green-200">
                <Plus size={13} /> 스케줄 추가
              </button>
            </div>

            {showForm && (
              <div className="p-4 bg-gray-50 rounded-lg space-y-4 mb-3 border">
                {/* 요일 선택 */}
                <div>
                  <label className="text-xs text-gray-500 mb-2 block">발송 요일 (클릭하여 선택)</label>
                  <div className="flex gap-1.5">
                    {['월','화','수','목','금','토','일'].map((label, i) => {
                      const dayVal = i < 5 ? i + 1 : i === 5 ? 6 : 0; // 월=1,화=2,...금=5,토=6,일=0
                      const active = schedDays.includes(dayVal);
                      return (
                        <button key={i} onClick={() => toggleDay(dayVal)}
                          className={clsx('w-10 h-10 rounded-lg text-sm font-medium transition-all',
                            active ? 'bg-green-600 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200 hover:border-green-300')}>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  {schedDays.length === 0 && <p className="text-xs text-red-500 mt-1">최소 1개 요일을 선택해주세요.</p>}
                </div>
                {/* 시간 입력 */}
                <div>
                  <label className="text-xs text-gray-500 mb-2 block">발송 시간 (KST)</label>
                  <div className="flex items-center gap-1.5">
                    <select value={schedHour} onChange={(e) => setSchedHour(Number(e.target.value))} className="px-2.5 py-2 border rounded-lg text-sm w-20">
                      {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}시</option>)}
                    </select>
                    <span className="text-gray-400 font-bold">:</span>
                    <select value={schedMinute} onChange={(e) => setSchedMinute(Number(e.target.value))} className="px-2.5 py-2 border rounded-lg text-sm w-20">
                      {Array.from({ length: 60 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}분</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">수신 이메일</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="report@example.com" className="w-full px-3 py-1.5 border rounded-lg text-sm" />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => createSched.mutate()} disabled={!email || schedDays.length === 0 || createSched.isPending}
                    className="px-4 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50">
                    {createSched.isPending ? '등록 중...' : '스케줄 등록'}
                  </button>
                  <button onClick={() => setShowForm(false)} className="px-4 py-1.5 text-sm text-gray-600 border rounded-lg hover:bg-gray-100">취소</button>
                </div>
              </div>
            )}

            {schedules.length > 0 ? (
              <div className="space-y-2">
                {schedules.map((s: any) => (
                  <div key={s.id} className="flex items-center justify-between p-3 bg-white rounded-lg border text-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900">{s.name}</span>
                      <span className="text-gray-300">|</span>
                      <span className="text-gray-600">
                        {s.days_of_week
                          ? (s.days_of_week as number[]).map((d: number) => ['일','월','화','수','목','금','토'][d]).join('·')
                          : s.schedule_type === 'daily' ? '평일' : ['일','월','화','수','목','금','토'][s.day_of_week || 0]}
                        {' '}{String(s.send_hour ?? 9).padStart(2, '0')}:{String(s.send_minute ?? 0).padStart(2, '0')}
                      </span>
                      <span className="text-gray-300">&rarr;</span>
                      <span className="text-green-700">{s.email_to}</span>
                      {s.next_run_at && <span className="text-gray-400">(다음: {new Date(s.next_run_at).toLocaleString('ko-KR')})</span>}
                    </div>
                    <div className="flex gap-1.5 ml-2">
                      <button onClick={() => runNow.mutate(s.id)} disabled={runNow.isPending}
                        className="p-1.5 bg-green-50 text-green-700 rounded hover:bg-green-100" title="즉시 실행"><Play size={13} /></button>
                      <button onClick={() => deleteSched.mutate(s.id)}
                        className="p-1.5 bg-red-50 text-red-700 rounded hover:bg-red-100" title="삭제"><Trash2 size={13} /></button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400 py-2">등록된 스케줄이 없습니다. 스케줄을 추가하면 정해진 시간에 순위 리포트가 이메일로 발송됩니다.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
