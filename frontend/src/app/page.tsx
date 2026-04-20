'use client';

import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useAuthStore, useAppStore } from '@/store';
import { authApi } from '@/lib/api';
import { Header, TabNav, NaverTabNav } from '@/components/layout';
import { Button, Input, Card } from '@/components/ui';
import {
  MarketIntelligence,
  CreativeStudio,
  CampaignPlanner,
  AdsController,
  PerformanceDashboard,
  AutoManagement,
  AffiliateManaging,
} from '@/components/tabs';
import {
  NaverSearchAdsDashboard,
  NaverGFADashboard,
  NaverSearchAdsManager,
  NaverGFAManager,
  NaverAutoManagement,
  NaverReports,
  NaverKeywordResearch,
  NaverReviewMonitor,
} from '@/components/tabs/naver';
import { AICommandCenter } from '@/components/chat/AICommandCenter';
import toast from 'react-hot-toast';

export default function Home() {
  const { isAuthenticated, setAuth } = useAuthStore();
  const { activeTab, activePlatform, naverActiveTab } = useAppStore();
  const [verifying, setVerifying] = useState(false);

  // Handle magic link token from URL + cafe24 callback query
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const cafe24Status = params.get('cafe24');

    // Cafe24 OAuth callback result
    if (cafe24Status) {
      if (cafe24Status === 'connected') {
        toast.success('Cafe24 스토어가 연결되었습니다.');
      } else if (cafe24Status === 'error') {
        const reason = params.get('reason') || 'unknown';
        const reasonMap: Record<string, string> = {
          invalid_scope: 'Cafe24 개발자센터에서 앱 권한(Scope)을 확인하세요.',
          access_denied: '사용자가 승인을 거부했습니다.',
          no_code: 'Cafe24에서 인증 코드를 받지 못했습니다. Redirect URI 등록을 확인하세요.',
          missing_mall_id: '쇼핑몰 ID를 복원하지 못했습니다.',
          invalid_state: '인증 state가 올바르지 않습니다.',
          token_exchange_failed: '토큰 교환 중 오류가 발생했습니다. Client Secret을 확인하세요.',
          user_not_found: '사용자를 찾을 수 없습니다.',
        };
        const msg = reasonMap[reason] || `Cafe24 연결 실패 (${reason})`;
        toast.error(msg, { duration: 8000 });
      }
      const clean = new URL(window.location.href);
      clean.searchParams.delete('cafe24');
      clean.searchParams.delete('reason');
      window.history.replaceState({}, '', clean.pathname + (clean.search || ''));
    }

    if (token && !isAuthenticated) {
      setVerifying(true);
      const pendingRef = localStorage.getItem('pending_ref') ?? undefined;
      authApi.verifyMagicLink(token, pendingRef)
        .then(async (data) => {
          localStorage.setItem('token', data.access_token);
          localStorage.removeItem('pending_ref');
          const user = await authApi.getMe();
          setAuth(user, data.access_token);
          window.history.replaceState({}, '', '/');
          toast.success('로그인 성공!');
        })
        .catch(() => {
          toast.error('로그인 링크가 만료되었거나 유효하지 않습니다.');
          window.history.replaceState({}, '', '/');
        })
        .finally(() => setVerifying(false));
    }
  }, []);

  // Refresh user info on page load (meta_connected status 등 갱신)
  useEffect(() => {
    if (isAuthenticated) {
      authApi.getMe()
        .then((user) => {
          const token = localStorage.getItem('token');
          if (token) setAuth(user, token);
        })
        .catch(() => {});
    }
  }, [isAuthenticated]);

  if (verifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#08090A]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#5E6AD2] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[#8A8F98] text-lg">로그인 확인 중...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <div className="min-h-screen bg-[#08090A]">
      <Header />
      {activePlatform === 'meta' ? <TabNav /> : activePlatform === 'naver' ? <NaverTabNav /> : null}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activePlatform === 'meta' && (
          <>
            {activeTab === 0 && <MarketIntelligence />}
            {activeTab === 1 && <CreativeStudio />}
            {activeTab === 2 && <CampaignPlanner />}
            {activeTab === 3 && <AdsController />}
            {activeTab === 4 && <PerformanceDashboard />}
            {activeTab === 5 && <AutoManagement />}
          </>
        )}
        {activePlatform === 'naver' && (
          <>
            {naverActiveTab === 0 && <NaverSearchAdsDashboard />}
            {naverActiveTab === 1 && <NaverKeywordResearch />}
            {naverActiveTab === 7 && <NaverReviewMonitor />}
            {naverActiveTab === 2 && <NaverSearchAdsManager />}
            {naverActiveTab === 3 && <NaverGFADashboard />}
            {naverActiveTab === 4 && <NaverGFAManager />}
            {naverActiveTab === 5 && <NaverAutoManagement />}
            {naverActiveTab === 6 && <NaverReports />}
          </>
        )}
        {activePlatform === 'affiliate' && <AffiliateManaging />}
      </main>
      <AICommandCenter />
    </div>
  );
}

function LoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [refCode, setRefCode] = useState<string | null>(null);
  const [showRefBanner, setShowRefBanner] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref) {
      setRefCode(ref);
      setShowRefBanner(true);
      localStorage.setItem('pending_ref', ref);
    }
  }, []);

  const sendMagicLinkMutation = useMutation({
    mutationFn: () => authApi.sendMagicLink(email),
    onSuccess: () => {
      setSent(true);
      toast.success('로그인 링크가 이메일로 전송되었습니다!');
    },
    onError: (error: any) => {
      const msg = error?.response?.data?.detail || '이메일 전송에 실패했습니다. 다시 시도해주세요.';
      toast.error(msg);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email) {
      sendMagicLinkMutation.mutate();
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#08090A] p-4">
      <div className="w-full max-w-md">
        {showRefBanner && refCode && (
          <div className="mb-4 flex items-start gap-3 px-4 py-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
            <span className="text-emerald-400 text-base leading-none mt-0.5">&#127881;</span>
            <div className="flex-1">
              <p className="text-sm font-medium text-emerald-300">친구 추천 링크로 접속하셨습니다</p>
              <p className="text-xs text-emerald-400/70 mt-0.5">가입 완료 시 포인트가 지급됩니다.</p>
            </div>
            <button
              onClick={() => setShowRefBanner(false)}
              className="text-emerald-400/50 hover:text-emerald-300 transition-colors"
              aria-label="닫기"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          </div>
        )}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-[#5E6AD2] rounded-xl flex items-center justify-center shadow-[0px_4px_24px_rgba(0,0,0,0.4)]">
              <span className="text-white font-bold text-xl">M</span>
            </div>
            <h1 className="text-3xl font-semibold text-[#F7F8F8] tracking-tight">Meta-Commander</h1>
          </div>
          <p className="text-[#8A8F98] text-sm">AI 기반 Meta 마케팅 올인원 플랫폼</p>
        </div>

        <div className="bg-[#0F1011] border border-[#23252A] rounded-2xl p-6 shadow-[0px_7px_32px_rgba(0,0,0,0.35)]">
          {!sent ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="text-center mb-2">
                <h2 className="text-base font-semibold text-[#F7F8F8]">이메일로 시작하기</h2>
                <p className="text-sm text-[#8A8F98] mt-1">로그인 링크를 이메일로 보내드립니다</p>
              </div>
              <Input
                label="이메일"
                type="email"
                placeholder="email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Button
                type="submit"
                className="w-full"
                loading={sendMagicLinkMutation.isPending}
              >
                로그인 링크 받기
              </Button>
            </form>
          ) : (
            <div className="text-center py-4">
              <div className="w-16 h-16 bg-[#27A644]/10 border border-[#27A644]/30 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-[#27A644]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h2 className="text-base font-semibold text-[#F7F8F8] mb-2">이메일을 확인하세요</h2>
              <p className="text-sm text-[#8A8F98] mb-1">
                <span className="font-medium text-[#D0D6E0]">{email}</span>
              </p>
              <p className="text-sm text-[#8A8F98] mb-6">
                로 로그인 링크를 보냈습니다
              </p>
              <button
                className="text-sm text-[#7070FF] hover:text-[#828FFF] font-medium transition-colors duration-150"
                onClick={() => { setSent(false); setEmail(''); }}
              >
                다른 이메일로 시도
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-sm text-[#62666D] mt-6">
          시장 분석부터 광고 집행까지, AI가 도와드립니다
        </p>
      </div>
    </div>
  );
}
