'use client';

import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Search, Loader2, TrendingUp, ShoppingBag, Star, AlertCircle,
} from 'lucide-react';
import api from '@/lib/api';
import { clsx } from 'clsx';

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

// ─── Constants ───────────────────────────────────────────────────────────────

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
  height = 160,
}: {
  data: TrendPoint[];
  color?: string;
  height?: number;
}) {
  if (!data || data.length < 2) {
    return (
      <div
        className="w-full bg-gray-50 rounded-lg flex items-center justify-center text-gray-400 text-sm"
        style={{ height }}
      >
        데이터 없음
      </div>
    );
  }

  const width = 800; // internal SVG coordinate space
  const paddingX = 40;
  const paddingY = 16;
  const chartWidth = width - paddingX * 2;
  const chartHeight = height - paddingY * 2;

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

  // Fill area under line
  const firstX = toX(0);
  const lastX = toX(data.length - 1);
  const bottomY = paddingY + chartHeight;
  const areaPoints = `${firstX},${bottomY} ${points} ${lastX},${bottomY}`;

  // X-axis labels: show first, middle, last
  const labelIndices = [
    0,
    Math.floor(data.length / 4),
    Math.floor(data.length / 2),
    Math.floor((3 * data.length) / 4),
    data.length - 1,
  ].filter((v, i, arr) => arr.indexOf(v) === i);

  // Y-axis gridlines at 0, 25, 50, 75, 100
  const yGridValues = [0, 25, 50, 75, 100];

  return (
    <div className="w-full overflow-hidden">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
      >
        {/* Y gridlines */}
        {yGridValues.map((v) => {
          const y = toY(Math.min(v, max));
          if (y < paddingY || y > paddingY + chartHeight) return null;
          return (
            <line
              key={v}
              x1={paddingX}
              y1={y}
              x2={width - paddingX}
              y2={y}
              stroke="#e5e7eb"
              strokeWidth="1"
            />
          );
        })}

        {/* Area fill */}
        <polygon
          points={areaPoints}
          fill={color}
          fillOpacity="0.08"
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

        {/* Dots at data points */}
        {data.map((d, i) => (
          <circle
            key={i}
            cx={toX(i)}
            cy={toY(d.ratio)}
            r="3"
            fill={color}
            fillOpacity="0.7"
          />
        ))}

        {/* X-axis labels */}
        {labelIndices.map((i) => (
          <text
            key={i}
            x={toX(i)}
            y={height - 2}
            textAnchor="middle"
            fontSize="11"
            fill="#9ca3af"
          >
            {formatPeriodLabel(data[i].period)}
          </text>
        ))}

        {/* Y-axis label: max */}
        <text
          x={paddingX - 4}
          y={paddingY + 4}
          textAnchor="end"
          fontSize="11"
          fill="#9ca3af"
        >
          {max}
        </text>
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

// ─── Main Component ───────────────────────────────────────────────────────────

export function NaverKeywordResearch() {
  const [inputValue, setInputValue] = useState('');
  const [searchedKeyword, setSearchedKeyword] = useState('');
  const [period, setPeriod] = useState<Period>('1y');
  const [timeUnit, setTimeUnit] = useState<TimeUnit>('month');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSearch = () => {
    const kw = inputValue.trim();
    if (!kw) return;
    setSearchedKeyword(kw);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSearch();
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
                <TrendChart data={trendPoints} height={180} />
                <div className="flex justify-between text-xs text-gray-400 mt-1 px-1">
                  <span>0</span>
                  <span className="text-gray-500">상대적 검색량 (최대=100)</span>
                  <span>100</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center py-16 text-gray-400 text-sm">
                검색 결과가 없습니다.
              </div>
            )}
          </div>

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
