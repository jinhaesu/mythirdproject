'use client';

/**
 * 소셜 채널 — 유튜브(공개 데이터)·인스타그램(자사 계정) 오가닉 지표·댓글 조회.
 *
 * - 유튜브: 채널 핸들/영상 URL로 조회수·좋아요·댓글수 + 댓글 내용 (API 키, 누구 영상이든)
 * - 인스타: 연결된 자사 비즈니스 계정의 최근 게시물 + 좋아요/댓글/도달 + 댓글
 *   (instagram_basic·instagram_manage_insights — 2026-10-06 이전 연결은 Meta 재연동 필요)
 */
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  Tooltip as RechartsTooltip, Legend, CartesianGrid,
} from 'recharts';
import { Search, Youtube, Instagram, MessageCircle, ExternalLink, RefreshCw, CornerDownRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { socialApi } from '@/lib/api';
import { fmtNum } from '@/components/tabs/kpi/format';

const card: React.CSSProperties = { backgroundColor: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)' };

export function SocialChannels() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-text-primary">소셜 채널</h2>
        <p className="text-xs text-text-tertiary mt-0.5">
          유튜브는 공개 데이터라 누구의 채널·영상이든 조회 가능(PPL·인플루언서 추적용), 인스타그램은 연결된 자사 계정 기준입니다
        </p>
      </div>
      <YouTubeSection />
      <InstagramSection />
    </div>
  );
}

// ─── 유튜브 ──────────────────────────────────────────────────────────────────

function YouTubeSection() {
  const [channelQ, setChannelQ] = useState(() => {
    try { return localStorage.getItem('social_yt_channel') || ''; } catch { return ''; }
  });
  const [channel, setChannel] = useState(channelQ);
  const [videoQ, setVideoQ] = useState('');
  const [video, setVideo] = useState('');
  const [showComments, setShowComments] = useState(false);

  const chQuery = useQuery({
    queryKey: ['social', 'yt-channel', channel],
    queryFn: () => socialApi.ytChannel(channel, 10),
    enabled: !!channel,
    retry: false,
  });
  const vQuery = useQuery({
    queryKey: ['social', 'yt-video', video],
    queryFn: () => socialApi.ytVideo(video),
    enabled: !!video,
    retry: false,
  });
  const cQuery = useQuery({
    queryKey: ['social', 'yt-comments', video],
    queryFn: () => socialApi.ytComments(video, 20),
    enabled: !!video && showComments,
    retry: false,
  });

  const searchChannel = () => {
    const q = channelQ.trim();
    if (!q) return;
    try { localStorage.setItem('social_yt_channel', q); } catch { /* ignore */ }
    setChannel(q);
  };

  return (
    <div className="rounded-xl p-4 space-y-3" style={card}>
      <div className="flex items-center gap-2">
        <Youtube size={16} className="text-red" />
        <h3 className="text-sm font-semibold text-text-primary">유튜브</h3>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* 채널 조회 */}
        <div className="space-y-2">
          <div className="flex gap-1.5">
            <input value={channelQ} onChange={(e) => setChannelQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchChannel()}
              placeholder="채널 핸들 (@nuldam) 또는 채널 URL"
              className="flex-1 px-2.5 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary" />
            <button onClick={searchChannel}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-white" style={{ backgroundColor: 'var(--color-brand-bg)' }}>
              <Search size={13} />
            </button>
          </div>
          {chQuery.isLoading && <p className="text-xs text-text-tertiary py-3">채널 조회 중...</p>}
          {chQuery.isError && <p className="text-xs text-red py-2">{(chQuery.error as any)?.response?.data?.detail || '채널 조회 실패'}</p>}
          {chQuery.data && (
            <div className="space-y-2">
              <div className="flex gap-5 flex-wrap text-xs">
                <span className="font-semibold text-text-primary">{chQuery.data.title}</span>
                <span className="text-text-tertiary">구독 <b className="text-text-primary">{chQuery.data.subscribers != null ? fmtNum(chQuery.data.subscribers) : '비공개'}</b></span>
                <span className="text-text-tertiary">총 조회 <b className="text-text-primary">{fmtNum(chQuery.data.total_views)}</b></span>
                <span className="text-text-tertiary">영상 <b className="text-text-primary">{fmtNum(chQuery.data.video_count)}</b></span>
              </div>
              <table className="w-full text-[11px]">
                <thead><tr className="text-text-quaternary">
                  <th className="text-left py-1 font-medium">최근 영상</th>
                  <th className="text-right py-1 font-medium">조회수</th>
                  <th className="text-right py-1 font-medium">좋아요</th>
                  <th className="text-right py-1 font-medium">댓글</th>
                </tr></thead>
                <tbody>
                  {(chQuery.data.recent_videos || []).map((v: any) => (
                    <tr key={v.video_id} style={{ borderTop: '1px solid rgb(var(--color-overlay-rgb) / 0.05)' }}>
                      <td className="py-1 pr-2">
                        <button onClick={() => { setVideoQ(v.url); setVideo(v.url); setShowComments(false); }}
                          className="text-left text-text-secondary hover:text-text-primary hover:underline line-clamp-1" title={v.title}>
                          {v.title}
                        </button>
                      </td>
                      <td className="py-1 text-right tabular-nums text-text-primary">{fmtNum(v.views)}</td>
                      <td className="py-1 text-right tabular-nums text-text-tertiary">{v.likes != null ? fmtNum(v.likes) : '-'}</td>
                      <td className="py-1 text-right tabular-nums text-text-tertiary">{v.comments != null ? fmtNum(v.comments) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 영상 조회 + 댓글 */}
        <div className="space-y-2">
          <div className="flex gap-1.5">
            <input value={videoQ} onChange={(e) => setVideoQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && videoQ.trim() && (setVideo(videoQ.trim()), setShowComments(false))}
              placeholder="영상 URL (PPL·인플루언서 영상 추적)"
              className="flex-1 px-2.5 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary" />
            <button onClick={() => { if (videoQ.trim()) { setVideo(videoQ.trim()); setShowComments(false); } }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-white" style={{ backgroundColor: 'var(--color-brand-bg)' }}>
              <Search size={13} />
            </button>
          </div>
          {vQuery.isLoading && <p className="text-xs text-text-tertiary py-3">영상 조회 중...</p>}
          {vQuery.isError && <p className="text-xs text-red py-2">{(vQuery.error as any)?.response?.data?.detail || '영상 조회 실패'}</p>}
          {vQuery.data && (
            <div className="rounded-lg p-3 space-y-2" style={{ border: '1px solid var(--color-border-primary)' }}>
              <div className="flex items-start gap-2">
                {vQuery.data.thumbnail && <img src={vQuery.data.thumbnail} alt="" className="w-24 rounded" />}
                <div className="min-w-0">
                  <p className="text-xs font-medium text-text-primary line-clamp-2">{vQuery.data.title}</p>
                  <p className="text-[10px] text-text-quaternary mt-0.5">{vQuery.data.channel} · {vQuery.data.published_at?.slice(0, 10)}</p>
                  <a href={vQuery.data.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[10px] text-brand hover:underline mt-0.5">
                    열기 <ExternalLink size={9} />
                  </a>
                </div>
              </div>
              <div className="flex gap-5 text-xs">
                <span className="text-text-tertiary">조회 <b className="text-text-primary tabular-nums">{fmtNum(vQuery.data.views)}</b></span>
                <span className="text-text-tertiary">좋아요 <b className="text-text-primary tabular-nums">{vQuery.data.likes != null ? fmtNum(vQuery.data.likes) : '-'}</b></span>
                <span className="text-text-tertiary">댓글 <b className="text-text-primary tabular-nums">{vQuery.data.comments != null ? fmtNum(vQuery.data.comments) : '-'}</b></span>
                <button onClick={() => setShowComments(!showComments)}
                  className="flex items-center gap-1 text-brand hover:underline"><MessageCircle size={11} /> 댓글 보기</button>
              </div>
              {showComments && (
                <div className="max-h-64 overflow-y-auto space-y-1.5 pt-1" style={{ borderTop: '1px solid rgb(var(--color-overlay-rgb) / 0.06)' }}>
                  {cQuery.isLoading && <p className="text-[11px] text-text-tertiary">댓글 불러오는 중...</p>}
                  {cQuery.data?.disabled && <p className="text-[11px] text-text-quaternary">{cQuery.data.note}</p>}
                  {(cQuery.data?.comments || []).map((c: any, i: number) => (
                    <div key={i} className="text-[11px]">
                      <span className="font-medium text-text-secondary">{c.author}</span>
                      <span className="text-text-quaternary ml-1.5 text-[10px]">👍 {fmtNum(c.likes)}{c.replies ? ` · 답글 ${c.replies}` : ''}</span>
                      <p className="text-text-tertiary whitespace-pre-wrap">{c.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 인스타그램 (자사 계정) ───────────────────────────────────────────────────

const IG_VIEWS = [
  { key: 'media', label: '게시물' },
  { key: 'insights', label: '계정 인사이트' },
  { key: 'hashtag', label: '해시태그 모니터링' },
  { key: 'tagged', label: '태그된 게시물' },
] as const;

function InstagramSection() {
  const [view, setView] = useState<(typeof IG_VIEWS)[number]['key']>('media');
  const [openMedia, setOpenMedia] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [showTokenForm, setShowTokenForm] = useState(false);
  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ['social', 'ig-status'],
    queryFn: socialApi.igStatus,
    staleTime: 60 * 1000,
    retry: false,
  });
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['social', 'ig-media'],
    queryFn: () => socialApi.igMedia(24),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const saveToken = async () => {
    const t = tokenInput.trim();
    if (t.length < 20) { toast.error('토큰을 붙여넣어 주세요'); return; }
    try {
      const r = await socialApi.igSetToken(t);
      toast.success(`연결 완료 — @${r.username}${r.followers != null ? ` (팔로워 ${r.followers.toLocaleString()})` : ''}`);
      setTokenInput(''); setShowTokenForm(false);
      refetchStatus(); refetch();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '토큰 검증 실패');
    }
  };
  const cQuery = useQuery({
    queryKey: ['social', 'ig-comments', openMedia],
    queryFn: () => socialApi.igComments(openMedia!, 30),
    enabled: !!openMedia,
    retry: false,
  });

  return (
    <div className="rounded-xl p-4 space-y-3" style={card}>
      <div className="flex items-center gap-2">
        <Instagram size={16} style={{ color: '#C06EF3' }} />
        <h3 className="text-sm font-semibold text-text-primary">인스타그램 (자사 계정)</h3>
        {data?.account?.username && (
          <span className="text-xs text-text-tertiary">
            @{data.account.username}
            {data.account.followers_count != null && <> · 팔로워 <b className="text-text-primary">{fmtNum(data.account.followers_count)}</b></>}
            {data.account.media_count != null && <> · 게시물 {fmtNum(data.account.media_count)}</>}
          </span>
        )}
        <div className="flex-1" />
        {status?.connected ? (
          <button onClick={async () => { if (confirm('인스타그램 연결을 해제할까요?')) { await socialApi.igDisconnect(); refetchStatus(); refetch(); } }}
            className="px-2 py-1 rounded-lg text-[11px] text-text-quaternary border border-border-primary hover:text-red">
            연결 해제
          </button>
        ) : (
          <button onClick={() => setShowTokenForm(!showTokenForm)}
            className="px-2.5 py-1 rounded-lg text-[11px] font-medium text-white"
            style={{ backgroundColor: 'var(--color-brand-bg)' }}>
            토큰으로 연결
          </button>
        )}
        <button onClick={() => refetch()} disabled={isFetching}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-text-tertiary border border-border-primary hover:text-text-primary disabled:opacity-50">
          <RefreshCw size={11} className={isFetching ? 'animate-spin' : ''} /> 새로고침
        </button>
      </div>
      {showTokenForm && !status?.connected && (
        <div className="rounded-lg p-3 space-y-2" style={{ border: '1px solid var(--color-border-primary)' }}>
          <p className="text-[11px] text-text-tertiary">
            developers.facebook.com → 앱 → 좌측 <b className="text-text-secondary">Instagram → API 설정(Instagram 로그인 포함)</b> →
            1단계에서 자사 인스타 계정 추가 → <b className="text-text-secondary">토큰 생성</b> 버튼으로 받은 장기 토큰(60일)을 붙여넣으세요.
            이후 만료 전 자동 연장됩니다.
          </p>
          <div className="flex gap-1.5">
            <input type="password" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveToken()}
              placeholder="IGAAR... 형식의 액세스 토큰 붙여넣기"
              className="flex-1 px-2.5 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary" />
            <button onClick={saveToken}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-white" style={{ backgroundColor: 'var(--color-brand-bg)' }}>
              연결
            </button>
          </div>
        </div>
      )}
      {/* 뷰 전환 */}
      <div className="flex items-center gap-1 flex-wrap">
        {IG_VIEWS.map((v) => (
          <button key={v.key} onClick={() => setView(v.key)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border ${
              view === v.key ? 'text-white border-transparent' : 'text-text-tertiary border-border-primary hover:text-text-primary'
            }`}
            style={view === v.key ? { backgroundColor: 'var(--color-brand-bg)' } : undefined}
          >{v.label}</button>
        ))}
      </div>

      {view === 'insights' && <IgInsightsView />}
      {view === 'hashtag' && <IgHashtagView />}
      {view === 'tagged' && <IgTaggedView />}

      {view === 'media' && isLoading && <p className="text-xs text-text-tertiary py-4">게시물 불러오는 중...</p>}
      {view === 'media' && isError && !status?.connected && (
        <p className="text-xs text-yellow py-3">
          아직 연결 전입니다 — Meta 재연동(인스타 권한 포함) 또는 위 &quot;토큰으로 연결&quot;을 사용하세요.
        </p>
      )}
      {view === 'media' && isError && status?.connected && (
        <p className="text-xs text-red py-3">{(error as any)?.response?.data?.detail || '인스타그램 조회 실패'}</p>
      )}
      {view === 'media' && data && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2.5">
          {(data.media || []).map((m: any) => (
            <div key={m.id} className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border-primary)' }}>
              <a href={m.permalink} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.thumbnail_url || m.media_url} alt="" className="w-full h-32 object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              </a>
              <div className="p-2 space-y-1">
                <p className="text-[10px] text-text-quaternary">{m.timestamp?.slice(0, 10)} · {m.media_type}</p>
                <p className="text-[11px] text-text-tertiary line-clamp-2 min-h-[28px]">{m.caption || ''}</p>
                <div className="flex items-center gap-3 text-[11px] tabular-nums">
                  <span className="text-text-secondary">❤ {fmtNum(m.like_count)}</span>
                  <button onClick={() => setOpenMedia(openMedia === m.id ? null : m.id)}
                    className="text-brand hover:underline">💬 {fmtNum(m.comments_count)}</button>
                  {m.reach != null && <span className="text-text-quaternary">도달 {fmtNum(m.reach)}</span>}
                  {m.views != null && <span className="text-text-quaternary">조회 {fmtNum(m.views)}</span>}
                </div>
                {openMedia === m.id && (
                  <div className="max-h-48 overflow-y-auto space-y-1 pt-1" style={{ borderTop: '1px solid rgb(var(--color-overlay-rgb) / 0.06)' }}>
                    {cQuery.isLoading && <p className="text-[10px] text-text-tertiary">댓글 불러오는 중...</p>}
                    {cQuery.isError && <p className="text-[10px] text-red">{(cQuery.error as any)?.response?.data?.detail || '댓글 조회 실패'}</p>}
                    {(cQuery.data?.comments || []).map((c: any) => (
                      <CommentRow key={c.id || c.timestamp} comment={c} onReplied={() => cQuery.refetch()} />
                    ))}
                    {cQuery.data && !cQuery.data.comments?.length && <p className="text-[10px] text-text-quaternary">댓글 없음</p>}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {view === 'media' && data && <p className="text-[10px] text-text-quaternary">기준: {data.as_of?.slice(0, 16).replace('T', ' ')} UTC · 도달·조회는 Meta 인사이트 권한이 있는 미디어만 표시</p>}
    </div>
  );
}

// ─── 댓글 행 (+답글 작성) ─────────────────────────────────────────────────────

function CommentRow({ comment, onReplied }: { comment: any; onReplied: () => void }) {
  const [showReply, setShowReply] = useState(false);
  const [msg, setMsg] = useState('');
  const send = async () => {
    if (!msg.trim()) return;
    try {
      await socialApi.igCommentReply(comment.id, msg.trim());
      toast.success('답글을 게시했습니다');
      setMsg(''); setShowReply(false); onReplied();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '답글 실패');
    }
  };
  return (
    <div className="text-[10px]">
      <p className="text-text-tertiary">
        <b className="text-text-secondary">{comment.username}</b> {comment.text}
        <button onClick={() => setShowReply(!showReply)} className="ml-1.5 text-brand hover:underline">답글</button>
      </p>
      {showReply && (
        <div className="flex gap-1 mt-0.5">
          <CornerDownRight size={10} className="text-text-quaternary mt-1 shrink-0" />
          <input autoFocus value={msg} onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="답글 입력 후 Enter (자사 계정으로 게시됨)"
            className="flex-1 px-1.5 py-1 rounded text-[10px] bg-bg-2 border border-border-primary text-text-primary" />
        </div>
      )}
    </div>
  );
}

// ─── 계정 인사이트 (도달·팔로워 추이) ─────────────────────────────────────────

function IgInsightsView() {
  const [days, setDays] = useState(30);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['social', 'ig-insights', days],
    queryFn: () => socialApi.igAccountInsights(days),
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  if (isLoading) return <p className="text-xs text-text-tertiary py-4">인사이트 불러오는 중...</p>;
  if (isError) return <p className="text-xs text-yellow py-3">{(error as any)?.response?.data?.detail || '조회 실패 — 인스타 연결·권한을 확인하세요'}</p>;
  const reach = data?.series?.reach || [];
  const followers = data?.series?.follower_count || [];
  const byDate: Record<string, any> = {};
  reach.forEach((p: any) => { byDate[p.date] = { date: p.date.slice(5), reach: p.value }; });
  followers.forEach((p: any) => { byDate[p.date] = { ...(byDate[p.date] || { date: p.date.slice(5) }), followers: p.value }; });
  const rows = Object.values(byDate);
  const acc = data?.account || {};
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4 flex-wrap text-xs">
        {acc.username && <span className="font-semibold text-text-primary">@{acc.username}</span>}
        {acc.followers_count != null && <span className="text-text-tertiary">팔로워 <b className="text-text-primary">{fmtNum(acc.followers_count)}</b></span>}
        {acc.follows_count != null && <span className="text-text-tertiary">팔로잉 {fmtNum(acc.follows_count)}</span>}
        {acc.media_count != null && <span className="text-text-tertiary">게시물 {fmtNum(acc.media_count)}</span>}
        <div className="flex-1" />
        {[14, 30, 60, 90].map((d) => (
          <button key={d} onClick={() => setDays(d)}
            className={`px-2 py-0.5 rounded text-[10px] border ${days === d ? 'text-text-primary border-brand' : 'text-text-quaternary border-border-primary'}`}>{d}일</button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-text-quaternary py-4">일별 인사이트 데이터가 없습니다 (계정 규모·권한에 따라 제한될 수 있음)</p>
      ) : (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--color-text-quaternary)' }} tickLine={false} axisLine={false} />
              <YAxis yAxisId="l" tick={{ fontSize: 9, fill: 'var(--color-text-quaternary)' }} tickLine={false} axisLine={false} width={44} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 9, fill: '#27A644' }} tickLine={false} axisLine={false} width={44} />
              <RechartsTooltip contentStyle={{ backgroundColor: 'var(--color-bg-level-2)', border: '1px solid var(--color-border-primary)', borderRadius: 8, fontSize: 11 }}
                formatter={(v: any, n: any) => [fmtNum(Number(v)), n]} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar yAxisId="l" dataKey="reach" name="일 도달" fill="#4EA7FC" opacity={0.6} radius={[2, 2, 0, 0]} />
              <Line yAxisId="r" dataKey="followers" name="팔로워 증감" stroke="#27A644" strokeWidth={2} dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ─── 해시태그 모니터링 (관련 콘텐츠 발굴) ─────────────────────────────────────

function IgHashtagView() {
  const [tagQ, setTagQ] = useState('널담');
  const [tag, setTag] = useState('');
  const [mode, setMode] = useState<'top' | 'recent'>('top');
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['social', 'ig-hashtag', tag, mode],
    queryFn: () => socialApi.igHashtag(tag, mode),
    enabled: !!tag,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  return (
    <div className="space-y-2">
      <div className="flex gap-1.5 items-center flex-wrap">
        <input value={tagQ} onChange={(e) => setTagQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && tagQ.trim() && setTag(tagQ.trim())}
          placeholder="#해시태그 (예: 널담, 비건디저트, 단백질간식)"
          className="px-2.5 py-1.5 rounded-lg text-xs bg-bg-2 border border-border-primary text-text-primary w-64" />
        <button onClick={() => tagQ.trim() && setTag(tagQ.trim())}
          className="px-3 py-1.5 rounded-lg text-xs font-medium text-white" style={{ backgroundColor: 'var(--color-brand-bg)' }}>
          <Search size={13} />
        </button>
        {(['top', 'recent'] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)}
            className={`px-2 py-1 rounded-lg text-[11px] border ${mode === m ? 'text-text-primary border-brand' : 'text-text-quaternary border-border-primary'}`}>
            {m === 'top' ? '인기' : '최신'}
          </button>
        ))}
        <span className="text-[10px] text-text-quaternary">· 주당 해시태그 30개 조회 제한(Meta 정책) · 작성자명은 게시물 링크에서 확인</span>
      </div>
      {isLoading && <p className="text-xs text-text-tertiary py-4">조회 중...</p>}
      {isError && <p className="text-xs text-yellow py-3">{(error as any)?.response?.data?.detail || '조회 실패'}</p>}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
          {(data.media || []).map((m: any) => (
            <a key={m.id} href={m.permalink} target="_blank" rel="noreferrer"
              className="rounded-lg p-2.5 space-y-1 hover:bg-[rgb(var(--color-overlay-rgb)/0.04)]"
              style={{ border: '1px solid var(--color-border-primary)' }}>
              <p className="text-[10px] text-text-quaternary">{m.timestamp?.slice(0, 10)} · {m.media_type}</p>
              <p className="text-[11px] text-text-secondary line-clamp-3 min-h-[40px]">{m.caption || '(캡션 없음)'}</p>
              <p className="text-[11px] tabular-nums text-text-tertiary">❤ {fmtNum(m.like_count)} · 💬 {fmtNum(m.comments_count)}</p>
            </a>
          ))}
          {data.media?.length === 0 && <p className="text-xs text-text-quaternary py-3">게시물이 없습니다</p>}
        </div>
      )}
    </div>
  );
}

// ─── 태그된 게시물 (협찬·유상구좌 모니터링) ───────────────────────────────────

function IgTaggedView() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['social', 'ig-tagged'],
    queryFn: () => socialApi.igTagged(40),
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  if (isLoading) return <p className="text-xs text-text-tertiary py-4">불러오는 중...</p>;
  if (isError) return <p className="text-xs text-yellow py-3">{(error as any)?.response?.data?.detail || '조회 실패'}</p>;
  const media = data?.media || [];
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-text-quaternary">
        자사 계정이 태그된 게시물 — 협찬·유상 크리에이터가 @계정 태그만 하면 여기 자동 수집됩니다.
        크리에이터 풀(브랜드 인텔리전스 › 크리에이터 풀)에 등록해 성과를 추적하세요.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-text-quaternary" style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
            <th className="text-left py-1.5 px-2 font-medium">작성자</th>
            <th className="text-left py-1.5 px-2 font-medium">게시일</th>
            <th className="text-left py-1.5 px-2 font-medium">내용</th>
            <th className="text-right py-1.5 px-2 font-medium">좋아요</th>
            <th className="text-right py-1.5 px-2 font-medium">댓글</th>
            <th className="py-1.5 px-2" />
          </tr></thead>
          <tbody>
            {media.map((m: any) => (
              <tr key={m.id} style={{ borderBottom: '1px solid rgb(var(--color-overlay-rgb) / 0.04)' }}>
                <td className="py-1.5 px-2 font-medium text-text-primary whitespace-nowrap">@{m.username || '?'}</td>
                <td className="py-1.5 px-2 text-text-tertiary whitespace-nowrap tabular-nums">{m.timestamp?.slice(0, 10)}</td>
                <td className="py-1.5 px-2 text-text-secondary max-w-[360px] truncate" title={m.caption || ''}>{m.caption || ''}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-text-primary">{m.like_count != null ? fmtNum(m.like_count) : '-'}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-text-tertiary">{fmtNum(m.comments_count)}</td>
                <td className="py-1.5 px-2 text-right">
                  <a href={m.permalink} target="_blank" rel="noreferrer" className="text-brand hover:underline text-[11px]">열기</a>
                </td>
              </tr>
            ))}
            {media.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-text-quaternary text-xs">태그된 게시물이 없습니다</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
