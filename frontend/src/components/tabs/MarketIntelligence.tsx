'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Search, TrendingUp, MessageCircle, Sparkles, ArrowRight, ExternalLink, HelpCircle } from 'lucide-react';
import { Button, Card, CardTitle } from '@/components/ui';
import { benchmarkApi } from '@/lib/api';
import { useAppStore } from '@/store';
import type { BenchmarkResponse, CollectedPost, AISummary, SentimentAnalysis } from '@/types';
import toast from 'react-hot-toast';

export function MarketIntelligence() {
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState<'7d' | '30d' | '90d' | 'custom'>('30d');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortBy, setSortBy] = useState<'popular' | 'recent' | 'most_comments'>('popular');
  const [benchmark, setBenchmark] = useState<BenchmarkResponse | null>(null);
  const [aiSummary, setAiSummary] = useState<AISummary | null>(null);
  const [sentiment, setSentiment] = useState<SentimentAnalysis | null>(null);
  const [styleUrl, setStyleUrl] = useState('');

  const { setSelectedStyle, setActiveTab } = useAppStore();

  const searchMutation = useMutation({
    mutationFn: () => benchmarkApi.search({ query, period: period === 'custom' ? '90d' : period, sort_by: sortBy, limit: 20 }),
    onSuccess: (data) => {
      setBenchmark(data);
      setAiSummary(null);
      setSentiment(null);
      toast.success(`${data.total_posts_analyzed}개 게시물 분석 완료`);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || '검색 중 오류가 발생했습니다. 검색어를 확인해주세요.';
      toast.error(msg);
    },
  });

  const aiSummaryMutation = useMutation({
    mutationFn: () => benchmarkApi.getAISummary(benchmark!.id),
    onSuccess: (data) => { setAiSummary(data); toast.success('AI 분석 완료'); },
    onError: () => toast.error('AI 분석 중 오류가 발생했습니다'),
  });

  const sentimentMutation = useMutation({
    mutationFn: () => benchmarkApi.getSentiment(benchmark!.id),
    onSuccess: (data) => { setSentiment(data); toast.success('감성 분석 완료'); },
    onError: () => toast.error('감성 분석 중 오류가 발생했습니다'),
  });

  const extractStyleMutation = useMutation({
    mutationFn: () => benchmarkApi.extractStyle(styleUrl),
    onSuccess: (data) => {
      setSelectedStyle(data.style, data.prompt_template);
      toast.success('스타일 추출 완료!');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || '스타일 추출에 실패했습니다. URL을 확인해주세요.';
      toast.error(msg);
    },
  });

  const handleMakeWithStyle = () => {
    setActiveTab(1);
  };

  return (
    <div className="space-y-6">
      {/* 검색 패널 */}
      <Card variant="bordered">
        <CardTitle className="flex items-center gap-2 mb-4">
          <Search size={20} />
          경쟁사 / 키워드 모니터링
        </CardTitle>

        {/* 검색어 입력 - 전체 너비 */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">검색어</label>
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="브랜드명, @인스타계정, #해시태그, 또는 키워드를 입력하세요"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && query && searchMutation.mutate()}
              className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
          </div>
          <p className="text-xs text-gray-400 mt-1">예: "나이키", "@nike", "#운동화추천", "여름 스킨케어"</p>
        </div>

        {/* 필터 옵션 */}
        <div className="flex flex-wrap gap-3 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">기간</label>
            <div className="flex gap-1">
              {[
                { value: '7d', label: '7일' },
                { value: '30d', label: '30일' },
                { value: '90d', label: '90일' },
                { value: 'custom', label: '직접 설정' },
              ].map((opt) => (
                <button key={opt.value}
                  onClick={() => setPeriod(opt.value as any)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    period === opt.value ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {period === 'custom' && (
            <div className="flex gap-2 items-end">
              <div>
                <label className="block text-xs text-gray-500 mb-1">시작일</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
              </div>
              <span className="py-1.5 text-gray-400">~</span>
              <div>
                <label className="block text-xs text-gray-500 mb-1">종료일</label>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-500 mb-1">정렬</label>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white">
              <option value="popular">인기순</option>
              <option value="recent">최신순</option>
              <option value="most_comments">댓글 많은 순</option>
            </select>
          </div>

          <div className="flex items-end">
            <Button onClick={() => searchMutation.mutate()} loading={searchMutation.isPending} disabled={!query}>
              <Search size={16} className="mr-1" /> 분석 시작
            </Button>
          </div>
        </div>

        {/* 검색 결과 */}
        {benchmark && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-gray-600">
                총 <span className="font-semibold text-gray-900">{benchmark.total_posts_analyzed}개</span> 게시물 분석 완료
                {' · '}평균 참여율: <span className="font-semibold">{benchmark.avg_engagement_rate.toFixed(2)}%</span>
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => aiSummaryMutation.mutate()} loading={aiSummaryMutation.isPending}>
                  <Sparkles size={16} className="mr-1" /> AI 요약
                </Button>
                <Button variant="outline" size="sm" onClick={() => sentimentMutation.mutate()} loading={sentimentMutation.isPending}>
                  <MessageCircle size={16} className="mr-1" /> 여론 분석
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {benchmark.posts.map((post) => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>
          </div>
        )}

        {/* 빈 상태 */}
        {!benchmark && !searchMutation.isPending && (
          <div className="text-center py-12 text-gray-400">
            <Search size={48} className="mx-auto mb-3 opacity-50" />
            <p className="text-gray-500">검색어를 입력하고 분석을 시작하세요</p>
            <p className="text-sm mt-1">경쟁사 인스타그램, 키워드 트렌드를 AI가 분석합니다</p>
          </div>
        )}
      </Card>

      {/* AI 요약 결과 */}
      {aiSummary && (
        <Card variant="bordered" className="bg-gradient-to-r from-blue-50 to-purple-50">
          <CardTitle className="flex items-center gap-2 mb-4">
            <Sparkles size={20} className="text-purple-600" />
            AI 분석 결과
          </CardTitle>
          <p className="text-gray-700 mb-4">{aiSummary.summary}</p>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <h4 className="font-medium text-gray-900 mb-2">주요 인사이트</h4>
              <ul className="space-y-1">
                {aiSummary.key_insights.map((insight, i) => (
                  <li key={i} className="text-sm text-gray-600 flex items-start gap-2">
                    <span className="text-primary-600 mt-0.5">•</span> {insight}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="font-medium text-gray-900 mb-2">추천 전략</h4>
              <ul className="space-y-1">
                {aiSummary.recommendations.map((rec, i) => (
                  <li key={i} className="text-sm text-gray-600 flex items-start gap-2">
                    <span className="text-green-600 mt-0.5">✓</span> {rec}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {aiSummary.trending_topics.length > 0 && (
            <div className="mt-4">
              <h4 className="font-medium text-gray-900 mb-2">트렌딩 토픽</h4>
              <div className="flex flex-wrap gap-2">
                {aiSummary.trending_topics.map((topic, i) => (
                  <span key={i} className="px-3 py-1 bg-white rounded-full text-sm text-gray-700 shadow-sm">
                    #{topic}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* 감성 분석 결과 */}
      {sentiment && (
        <Card variant="bordered">
          <CardTitle className="flex items-center gap-2 mb-4">
            <MessageCircle size={20} />
            댓글 감성 분석
          </CardTitle>
          <p className="text-sm text-gray-600 mb-4">
            전체 감성:{' '}
            <span className={`font-semibold ${
              sentiment.overall_sentiment === 'positive' ? 'text-green-600' :
              sentiment.overall_sentiment === 'negative' ? 'text-red-600' : 'text-gray-600'
            }`}>
              {sentiment.overall_sentiment === 'positive' ? '긍정적' :
               sentiment.overall_sentiment === 'negative' ? '부정적' : '중립'}
            </span>
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-medium text-green-600 mb-2">긍정 키워드</h4>
              <div className="flex flex-wrap gap-2">
                {sentiment.positive_keywords.map((kw, i) => (
                  <span key={i} className="px-2 py-1 bg-green-100 text-green-800 rounded text-sm">
                    {kw.keyword} ({kw.count})
                  </span>
                ))}
              </div>
            </div>
            <div>
              <h4 className="font-medium text-red-600 mb-2">부정 키워드</h4>
              <div className="flex flex-wrap gap-2">
                {sentiment.negative_keywords.map((kw, i) => (
                  <span key={i} className="px-2 py-1 bg-red-100 text-red-800 rounded text-sm">
                    {kw.keyword} ({kw.count})
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* 레퍼런스 역설계 */}
      <Card variant="bordered">
        <CardTitle className="flex items-center gap-2 mb-2">
          <TrendingUp size={20} />
          레퍼런스 역설계
        </CardTitle>
        <p className="text-sm text-gray-500 mb-4">
          경쟁사의 광고/게시물/랜딩페이지 URL을 입력하면, AI가 비주얼 스타일·톤·구도를 분석하여
          동일한 스타일로 소재를 제작할 수 있습니다.
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">분석할 URL</label>
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <ExternalLink size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="url"
                  placeholder="https://www.instagram.com/p/xxxxx 또는 랜딩페이지 URL"
                  value={styleUrl}
                  onChange={(e) => setStyleUrl(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                />
              </div>
              <Button onClick={() => extractStyleMutation.mutate()} loading={extractStyleMutation.isPending} disabled={!styleUrl}>
                스타일 추출
              </Button>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              인스타그램 게시물, Facebook 광고, 쇼핑몰 랜딩페이지 등의 URL을 붙여넣으세요
            </p>
          </div>

          {/* 분석 결과 */}
          {extractStyleMutation.data && (
            <div className="p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg space-y-3">
              <h4 className="font-medium text-gray-900">추출된 스타일</h4>
              <p className="text-sm text-gray-700">{extractStyleMutation.data.preview_description}</p>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {[
                  { label: '비주얼 스타일', value: extractStyleMutation.data.style.visual_style },
                  { label: '소구 유형', value: extractStyleMutation.data.style.appeal_type },
                  { label: '구도', value: extractStyleMutation.data.style.composition },
                  { label: '톤 & 매너', value: extractStyleMutation.data.style.tone_and_manner },
                  { label: '텍스트 오버레이', value: extractStyleMutation.data.style.text_overlay ? '있음' : '없음' },
                ].map((item, i) => (
                  <div key={i} className="bg-white/70 px-3 py-2 rounded-lg">
                    <p className="text-xs text-gray-500">{item.label}</p>
                    <p className="text-sm font-medium text-gray-900">{item.value}</p>
                  </div>
                ))}
              </div>

              {extractStyleMutation.data.style.color_palette?.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 mb-1">컬러 팔레트</p>
                  <div className="flex gap-2">
                    {extractStyleMutation.data.style.color_palette.map((color: string, i: number) => (
                      <div key={i} className="flex items-center gap-1">
                        <div className="w-6 h-6 rounded-full border border-gray-200" style={{ backgroundColor: color }} />
                        <span className="text-xs text-gray-500">{color}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {extractStyleMutation.data.style.key_elements?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {extractStyleMutation.data.style.key_elements.map((el: string, i: number) => (
                    <span key={i} className="px-2 py-0.5 bg-white text-gray-700 rounded text-xs">{el}</span>
                  ))}
                </div>
              )}

              <Button onClick={handleMakeWithStyle}>
                이 스타일로 소재 제작하기 <ArrowRight size={16} className="ml-1" />
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function PostCard({ post }: { post: CollectedPost }) {
  return (
    <div className="relative group rounded-lg overflow-hidden bg-gray-100 aspect-square">
      {post.media_url ? (
        <img src={post.media_url} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
          미리보기 없음
        </div>
      )}
      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
        <div className="text-white text-sm w-full">
          <div className="flex gap-3 mb-1">
            <span>❤️ {post.metrics.likes.toLocaleString()}</span>
            <span>💬 {post.metrics.comments.toLocaleString()}</span>
            <span>🔄 {post.metrics.shares.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-xs text-gray-300">
            <span>참여율: {post.metrics.engagement_rate.toFixed(2)}%</span>
            <span>도달: {post.metrics.estimated_reach.toLocaleString()}</span>
          </div>
          {post.caption && (
            <p className="line-clamp-2 text-xs text-gray-200 mt-1">{post.caption}</p>
          )}
        </div>
      </div>
    </div>
  );
}
