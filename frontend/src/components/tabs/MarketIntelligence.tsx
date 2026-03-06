'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Search, TrendingUp, MessageCircle, Sparkles, ArrowRight, ExternalLink, Database, Brain, Hash, Target, X } from 'lucide-react';
import { Button, Card, CardTitle } from '@/components/ui';
import { benchmarkApi } from '@/lib/api';
import { useAppStore } from '@/store';
import type { BenchmarkResponse, CollectedPost, AISummary, SentimentAnalysis, MarketIntelligenceReport } from '@/types';
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
  const [selectedPost, setSelectedPost] = useState<CollectedPost | null>(null);

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
      const msg = err?.response?.data?.detail || '검색 중 오류가 발생했습니다.';
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
      const msg = err?.response?.data?.detail || '스타일 추출에 실패했습니다.';
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

        {/* 데이터 소스 배너 */}
        {benchmark && (
          <div className={`mb-4 px-4 py-2.5 rounded-lg text-sm flex items-center gap-2 ${
            benchmark.data_source === 'meta_api'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-blue-50 text-blue-700 border border-blue-200'
          }`}>
            {benchmark.data_source === 'meta_api' ? (
              <><Database size={16} /> Meta API에서 가져온 실제 데이터입니다</>
            ) : (
              <><Brain size={16} /> AI 기반 시장 분석 리포트입니다 (Meta 연동 시 실제 데이터로 전환됩니다)</>
            )}
          </div>
        )}

        {/* 검색 결과 */}
        {benchmark && (
          <div className="mt-4">
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
                <PostCard key={post.id} post={post} onClick={() => setSelectedPost(post)} />
              ))}
            </div>
          </div>
        )}

        {!benchmark && !searchMutation.isPending && (
          <div className="text-center py-12 text-gray-400">
            <Search size={48} className="mx-auto mb-3 opacity-50" />
            <p className="text-gray-500">검색어를 입력하고 분석을 시작하세요</p>
            <p className="text-sm mt-1">경쟁사 인스타그램, 키워드 트렌드를 AI가 분석합니다</p>
          </div>
        )}
      </Card>

      {/* AI 시장 분석 리포트 (미연동 유저) */}
      {benchmark?.ai_report && <AIReportView report={benchmark.ai_report} />}

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
                    <span className="text-primary-600 mt-0.5">&#8226;</span> {insight}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="font-medium text-gray-900 mb-2">추천 전략</h4>
              <ul className="space-y-1">
                {aiSummary.recommendations.map((rec, i) => (
                  <li key={i} className="text-sm text-gray-600 flex items-start gap-2">
                    <span className="text-green-600 mt-0.5">&#10003;</span> {rec}
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
                  <span key={i} className="px-3 py-1 bg-white rounded-full text-sm text-gray-700 shadow-sm">#{topic}</span>
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
                  <span key={i} className="px-2 py-1 bg-green-100 text-green-800 rounded text-sm">{kw.keyword} ({kw.count})</span>
                ))}
              </div>
            </div>
            <div>
              <h4 className="font-medium text-red-600 mb-2">부정 키워드</h4>
              <div className="flex flex-wrap gap-2">
                {sentiment.negative_keywords.map((kw, i) => (
                  <span key={i} className="px-2 py-1 bg-red-100 text-red-800 rounded text-sm">{kw.keyword} ({kw.count})</span>
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
          경쟁사의 광고/게시물/랜딩페이지 URL을 입력하면, AI가 비주얼 스타일을 분석합니다.
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">분석할 URL</label>
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <ExternalLink size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="url"
                  placeholder="이미지 URL, Instagram 게시물, 또는 웹페이지 URL"
                  value={styleUrl}
                  onChange={(e) => setStyleUrl(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                />
              </div>
              <Button onClick={() => extractStyleMutation.mutate()} loading={extractStyleMutation.isPending} disabled={!styleUrl}>
                스타일 추출
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="text-xs px-2 py-1 bg-gray-100 rounded text-gray-500">지원: 직접 이미지 URL (.jpg, .png)</span>
              <span className="text-xs px-2 py-1 bg-gray-100 rounded text-gray-500">Instagram 게시물 URL</span>
              <span className="text-xs px-2 py-1 bg-gray-100 rounded text-gray-500">웹페이지 URL (OG Image 추출)</span>
            </div>
          </div>

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
              <Button onClick={handleMakeWithStyle}>
                이 스타일로 소재 제작하기 <ArrowRight size={16} className="ml-1" />
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* Post Detail Modal */}
      {selectedPost && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelectedPost(null)}>
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <h3 className="font-semibold text-lg">게시물 상세</h3>
                <button onClick={() => setSelectedPost(null)} className="p-1 hover:bg-gray-100 rounded-lg">
                  <X size={20} />
                </button>
              </div>
              {selectedPost.media_url && (
                <img src={selectedPost.media_url} alt="" className="w-full rounded-lg mb-4" />
              )}
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="text-center p-3 bg-gray-50 rounded-lg">
                  <p className="text-lg font-semibold">{selectedPost.metrics.likes.toLocaleString()}</p>
                  <p className="text-xs text-gray-500">좋아요</p>
                </div>
                <div className="text-center p-3 bg-gray-50 rounded-lg">
                  <p className="text-lg font-semibold">{selectedPost.metrics.comments.toLocaleString()}</p>
                  <p className="text-xs text-gray-500">댓글</p>
                </div>
                <div className="text-center p-3 bg-gray-50 rounded-lg">
                  <p className="text-lg font-semibold">{selectedPost.metrics.engagement_rate.toFixed(2)}%</p>
                  <p className="text-xs text-gray-500">참여율</p>
                </div>
              </div>
              {selectedPost.caption && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-1">캡션</p>
                  <p className="text-sm text-gray-600 whitespace-pre-wrap">{selectedPost.caption}</p>
                </div>
              )}
              {selectedPost.post_url && (
                <a href={selectedPost.post_url} target="_blank" rel="noopener noreferrer"
                  className="mt-4 inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700">
                  <ExternalLink size={14} /> 원본 보기
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* AI 시장 분석 리포트 뷰 */
function AIReportView({ report }: { report: MarketIntelligenceReport }) {
  return (
    <div className="space-y-4">
      {/* 시장 개요 */}
      <Card variant="bordered" className="bg-gradient-to-r from-indigo-50 to-blue-50">
        <CardTitle className="flex items-center gap-2 mb-3">
          <Brain size={20} className="text-indigo-600" />
          AI 시장 분석 리포트
        </CardTitle>
        <p className="text-gray-700 leading-relaxed">{report.market_overview}</p>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        {/* 콘텐츠 트렌드 */}
        {report.content_trends.length > 0 && (
          <Card variant="bordered">
            <CardTitle className="flex items-center gap-2 mb-3">
              <TrendingUp size={18} className="text-green-600" />
              콘텐츠 트렌드
            </CardTitle>
            <div className="space-y-3">
              {report.content_trends.map((trend, i) => (
                <div key={i} className="p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm">{trend.topic}</span>
                    <span className={`px-1.5 py-0.5 rounded text-xs ${
                      trend.engagement_level === 'high' ? 'bg-green-100 text-green-700' :
                      trend.engagement_level === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>{trend.engagement_level}</span>
                  </div>
                  <p className="text-xs text-gray-600">{trend.description}</p>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* 해시태그 그룹 */}
        {report.hashtag_groups.length > 0 && (
          <Card variant="bordered">
            <CardTitle className="flex items-center gap-2 mb-3">
              <Hash size={18} className="text-blue-600" />
              추천 해시태그
            </CardTitle>
            <div className="space-y-3">
              {report.hashtag_groups.map((group, i) => (
                <div key={i} className="p-3 bg-gray-50 rounded-lg">
                  <p className="font-medium text-sm mb-1">{group.theme}</p>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {group.hashtags.map((tag, j) => (
                      <span key={j} className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">{tag}</span>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500">{group.recommendation}</p>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* 콘텐츠 축 */}
      {report.content_pillars.length > 0 && (
        <Card variant="bordered">
          <CardTitle className="flex items-center gap-2 mb-3">
            <Target size={18} className="text-purple-600" />
            콘텐츠 전략 축
          </CardTitle>
          <div className="grid md:grid-cols-3 gap-3">
            {report.content_pillars.map((pillar, i) => (
              <div key={i} className="p-4 bg-gradient-to-b from-purple-50 to-white rounded-lg border border-purple-100">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-sm">{pillar.pillar_name}</span>
                  <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-semibold">{pillar.content_ratio}%</span>
                </div>
                <p className="text-xs text-gray-600 mb-2">{pillar.description}</p>
                <div className="flex flex-wrap gap-1">
                  {pillar.example_topics.map((topic, j) => (
                    <span key={j} className="text-xs text-gray-500">&#8226; {topic}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 추천 전략 */}
      {report.recommendations.length > 0 && (
        <Card variant="bordered" className="bg-gradient-to-r from-green-50 to-emerald-50">
          <CardTitle className="mb-3">실행 추천 전략</CardTitle>
          <ul className="space-y-2">
            {report.recommendations.map((rec, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                <span className="text-green-600 font-bold mt-0.5">{i + 1}.</span> {rec}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function PostCard({ post, onClick }: { post: CollectedPost; onClick: () => void }) {
  return (
    <div
      className="relative group rounded-lg overflow-hidden bg-gray-100 aspect-square cursor-pointer hover:ring-2 hover:ring-primary-400 transition-all"
      onClick={onClick}
    >
      {post.media_url ? (
        <img src={post.media_url} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center p-3 text-center">
          <p className="text-xs text-gray-500 line-clamp-4">{post.caption || '텍스트 콘텐츠'}</p>
          <div className="mt-2 flex gap-2 text-xs text-gray-400">
            <span>&#10084; {post.metrics.likes.toLocaleString()}</span>
            <span>&#128172; {post.metrics.comments.toLocaleString()}</span>
          </div>
        </div>
      )}
      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
        <div className="text-white text-sm w-full">
          <div className="flex gap-3 mb-1">
            <span>&#10084; {post.metrics.likes.toLocaleString()}</span>
            <span>&#128172; {post.metrics.comments.toLocaleString()}</span>
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
