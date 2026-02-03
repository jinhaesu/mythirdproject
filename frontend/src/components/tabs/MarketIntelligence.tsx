'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Search, TrendingUp, MessageCircle, Sparkles, ArrowRight } from 'lucide-react';
import { Button, Input, Card, CardTitle, Select } from '@/components/ui';
import { benchmarkApi } from '@/lib/api';
import { useAppStore } from '@/store';
import type { BenchmarkResponse, CollectedPost, AISummary, SentimentAnalysis } from '@/types';
import toast from 'react-hot-toast';

export function MarketIntelligence() {
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d');
  const [sortBy, setSortBy] = useState<'popular' | 'recent' | 'most_comments'>('popular');
  const [benchmark, setBenchmark] = useState<BenchmarkResponse | null>(null);
  const [aiSummary, setAiSummary] = useState<AISummary | null>(null);
  const [sentiment, setSentiment] = useState<SentimentAnalysis | null>(null);
  const [styleUrl, setStyleUrl] = useState('');

  const { setSelectedStyle, setActiveTab } = useAppStore();

  const searchMutation = useMutation({
    mutationFn: () => benchmarkApi.search({ query, period, sort_by: sortBy, limit: 20 }),
    onSuccess: (data) => {
      setBenchmark(data);
      setAiSummary(null);
      setSentiment(null);
      toast.success(`${data.total_posts_analyzed}개 게시물 분석 완료`);
    },
    onError: () => toast.error('검색 중 오류가 발생했습니다'),
  });

  const aiSummaryMutation = useMutation({
    mutationFn: () => benchmarkApi.getAISummary(benchmark!.id),
    onSuccess: (data) => {
      setAiSummary(data);
      toast.success('AI 분석 완료');
    },
    onError: () => toast.error('AI 분석 중 오류가 발생했습니다'),
  });

  const sentimentMutation = useMutation({
    mutationFn: () => benchmarkApi.getSentiment(benchmark!.id),
    onSuccess: (data) => {
      setSentiment(data);
      toast.success('감성 분석 완료');
    },
    onError: () => toast.error('감성 분석 중 오류가 발생했습니다'),
  });

  const extractStyleMutation = useMutation({
    mutationFn: () => benchmarkApi.extractStyle(styleUrl),
    onSuccess: (data) => {
      setSelectedStyle(data.style, data.prompt_template);
      toast.success(data.preview_description);
    },
    onError: () => toast.error('스타일 추출 중 오류가 발생했습니다'),
  });

  const handleMakeWithStyle = () => {
    setActiveTab(1); // Creative Studio로 이동
  };

  return (
    <div className="space-y-6">
      {/* 검색 패널 */}
      <Card variant="bordered">
        <CardTitle className="flex items-center gap-2 mb-4">
          <Search size={20} />
          경쟁사/키워드 모니터링
        </CardTitle>

        <div className="flex gap-4 mb-4">
          <div className="flex-1">
            <Input
              placeholder="@계정명 또는 #해시태그 입력"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              leftIcon={<Search size={18} />}
            />
          </div>
          <Select
            options={[
              { value: '7d', label: '최근 7일' },
              { value: '30d', label: '최근 30일' },
              { value: '90d', label: '최근 90일' },
            ]}
            value={period}
            onChange={(e) => setPeriod(e.target.value as any)}
            className="w-36"
          />
          <Select
            options={[
              { value: 'popular', label: '인기순' },
              { value: 'recent', label: '최신순' },
              { value: 'most_comments', label: '댓글많은순' },
            ]}
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="w-36"
          />
          <Button onClick={() => searchMutation.mutate()} loading={searchMutation.isPending}>
            조회하기
          </Button>
        </div>

        {/* 콘텐츠 그리드 */}
        {benchmark && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-gray-600">
                총 {benchmark.total_posts_analyzed}개 게시물 | 평균 참여율: {benchmark.avg_engagement_rate.toFixed(1)}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => aiSummaryMutation.mutate()}
                  loading={aiSummaryMutation.isPending}
                  disabled={!benchmark}
                >
                  <Sparkles size={16} className="mr-1" />
                  AI 요약 분석
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => sentimentMutation.mutate()}
                  loading={sentimentMutation.isPending}
                  disabled={!benchmark}
                >
                  <MessageCircle size={16} className="mr-1" />
                  댓글 여론 분석
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
                    <span className="text-primary-600">•</span> {insight}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="font-medium text-gray-900 mb-2">추천 전략</h4>
              <ul className="space-y-1">
                {aiSummary.recommendations.map((rec, i) => (
                  <li key={i} className="text-sm text-gray-600 flex items-start gap-2">
                    <span className="text-green-600">✓</span> {rec}
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
            전체 감성: <span className={sentiment.overall_sentiment === 'positive' ? 'text-green-600' : sentiment.overall_sentiment === 'negative' ? 'text-red-600' : 'text-gray-600'}>
              {sentiment.overall_sentiment === 'positive' ? '긍정적' : sentiment.overall_sentiment === 'negative' ? '부정적' : '중립'}
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

      {/* 스타일 추출 */}
      <Card variant="bordered">
        <CardTitle className="flex items-center gap-2 mb-4">
          <TrendingUp size={20} />
          레퍼런스 역설계 (Benchmark Engine)
        </CardTitle>

        <div className="flex gap-4">
          <div className="flex-1">
            <Input
              placeholder="분석하고 싶은 타사 게시물/랜딩페이지 URL 입력"
              value={styleUrl}
              onChange={(e) => setStyleUrl(e.target.value)}
            />
          </div>
          <Button
            onClick={() => extractStyleMutation.mutate()}
            loading={extractStyleMutation.isPending}
            disabled={!styleUrl}
          >
            스타일 추출하기
          </Button>
        </div>

        {extractStyleMutation.data && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-700 mb-3">{extractStyleMutation.data.preview_description}</p>
            <div className="flex flex-wrap gap-2 mb-4">
              <span className="px-2 py-1 bg-primary-100 text-primary-800 rounded text-sm">
                스타일: {extractStyleMutation.data.style.visual_style}
              </span>
              <span className="px-2 py-1 bg-primary-100 text-primary-800 rounded text-sm">
                소구: {extractStyleMutation.data.style.appeal_type}
              </span>
              <span className="px-2 py-1 bg-primary-100 text-primary-800 rounded text-sm">
                구도: {extractStyleMutation.data.style.composition}
              </span>
            </div>
            <Button onClick={handleMakeWithStyle}>
              이 스타일로 만들기 <ArrowRight size={16} className="ml-1" />
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

function PostCard({ post }: { post: CollectedPost }) {
  return (
    <div className="relative group rounded-lg overflow-hidden bg-gray-100 aspect-square">
      {post.media_url ? (
        <img
          src={post.media_url}
          alt=""
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-gray-400">
          No Image
        </div>
      )}
      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
        <div className="text-white text-sm">
          <div className="flex gap-3 mb-1">
            <span>❤️ {post.metrics.likes.toLocaleString()}</span>
            <span>💬 {post.metrics.comments.toLocaleString()}</span>
          </div>
          {post.caption && (
            <p className="line-clamp-2 text-xs text-gray-200">{post.caption}</p>
          )}
        </div>
      </div>
    </div>
  );
}
