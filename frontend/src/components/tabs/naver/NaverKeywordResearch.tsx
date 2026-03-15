'use client';

import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Search, Loader2, TrendingUp, ShoppingBag, Star, AlertCircle, Sparkles, FileText,
  BarChart3, Monitor, Smartphone,
} from 'lucide-react';
import api from '@/lib/api';
import { naverKeywordResearchApi } from '@/lib/naver-api';
import { clsx } from 'clsx';

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
                {v}
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
                {d.ratio}
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
    // Headers
    .replace(/^### (.+)$/gm, '<h4 class="text-sm font-bold text-gray-900 mt-4 mb-2">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="text-base font-bold text-gray-900 mt-5 mb-2">$1</h3>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>')
    // Numbered lists
    .replace(/^(\d+)\. (.+)$/gm, '<div class="flex gap-2 ml-2 my-1"><span class="text-purple-600 font-semibold min-w-[1.2rem]">$1.</span><span>$2</span></div>')
    // Bullet points
    .replace(/^[-•] (.+)$/gm, '<div class="flex gap-2 ml-4 my-0.5"><span class="text-purple-400">•</span><span>$1</span></div>')
    // Line breaks
    .replace(/\n\n/g, '<div class="h-2"></div>')
    .replace(/\n/g, '<br/>');
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function NaverKeywordResearch() {
  const [inputValue, setInputValue] = useState('');
  const [searchedKeyword, setSearchedKeyword] = useState('');
  const [period, setPeriod] = useState<Period>('1y');
  const [timeUnit, setTimeUnit] = useState<TimeUnit>('month');
  const inputRef = useRef<HTMLInputElement>(null);

  // AI analysis state
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

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
        </div>
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
                <TrendChart data={trendPoints} height={240} />
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
                          {volumeData.data.slice(0, 20).map((item, idx) => (
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
                <div className="bg-gradient-to-br from-purple-50 to-white border border-purple-100 rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-3 text-purple-700 text-sm font-semibold">
                    <Sparkles size={14} />
                    Claude AI 분석 결과
                  </div>
                  <div
                    className="text-sm text-gray-700 leading-relaxed prose-sm"
                    dangerouslySetInnerHTML={{ __html: simpleMarkdownToHtml(aiAnalysis) }}
                  />
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
    </div>
  );
}
