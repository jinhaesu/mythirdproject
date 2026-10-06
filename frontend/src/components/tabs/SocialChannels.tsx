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
import { Search, Youtube, Instagram, MessageCircle, ExternalLink, RefreshCw } from 'lucide-react';
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

function InstagramSection() {
  const [openMedia, setOpenMedia] = useState<string | null>(null);
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['social', 'ig-media'],
    queryFn: () => socialApi.igMedia(24),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
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
        <button onClick={() => refetch()} disabled={isFetching}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-text-tertiary border border-border-primary hover:text-text-primary disabled:opacity-50">
          <RefreshCw size={11} className={isFetching ? 'animate-spin' : ''} /> 새로고침
        </button>
      </div>
      {isLoading && <p className="text-xs text-text-tertiary py-4">게시물 불러오는 중...</p>}
      {isError && (
        <p className="text-xs text-yellow py-3">
          {(error as any)?.response?.data?.detail || '인스타그램 조회 실패'} — 우측 상단 Meta 연동을 한 번 재연결하면
          인스타 권한(instagram_basic)이 추가됩니다.
        </p>
      )}
      {data && (
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
                  <div className="max-h-40 overflow-y-auto space-y-1 pt-1" style={{ borderTop: '1px solid rgb(var(--color-overlay-rgb) / 0.06)' }}>
                    {cQuery.isLoading && <p className="text-[10px] text-text-tertiary">댓글 불러오는 중...</p>}
                    {cQuery.isError && <p className="text-[10px] text-red">{(cQuery.error as any)?.response?.data?.detail || '댓글 조회 실패'}</p>}
                    {(cQuery.data?.comments || []).map((c: any) => (
                      <p key={c.id || c.timestamp} className="text-[10px] text-text-tertiary">
                        <b className="text-text-secondary">{c.username}</b> {c.text}
                      </p>
                    ))}
                    {cQuery.data && !cQuery.data.comments?.length && <p className="text-[10px] text-text-quaternary">댓글 없음</p>}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {data && <p className="text-[10px] text-text-quaternary">기준: {data.as_of?.slice(0, 16).replace('T', ' ')} UTC · 도달·조회는 Meta 인사이트 권한이 있는 미디어만 표시</p>}
    </div>
  );
}
