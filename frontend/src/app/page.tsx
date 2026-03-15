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
} from '@/components/tabs';
import {
  NaverSearchAdsDashboard,
  NaverGFADashboard,
  NaverSearchAdsManager,
  NaverGFAManager,
  NaverAutoManagement,
  NaverReports,
  NaverKeywordResearch,
} from '@/components/tabs/naver';
import { AICommandCenter } from '@/components/chat/AICommandCenter';
import toast from 'react-hot-toast';

export default function Home() {
  const { isAuthenticated, setAuth } = useAuthStore();
  const { activeTab, activePlatform, naverActiveTab } = useAppStore();
  const [verifying, setVerifying] = useState(false);

  // Handle magic link token from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token && !isAuthenticated) {
      setVerifying(true);
      authApi.verifyMagicLink(token)
        .then(async (data) => {
          localStorage.setItem('token', data.access_token);
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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 via-white to-purple-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600 text-lg">로그인 확인 중...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      {activePlatform === 'meta' ? <TabNav /> : <NaverTabNav />}
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
            {naverActiveTab === 2 && <NaverSearchAdsManager />}
            {naverActiveTab === 3 && <NaverGFADashboard />}
            {naverActiveTab === 4 && <NaverGFAManager />}
            {naverActiveTab === 5 && <NaverAutoManagement />}
            {naverActiveTab === 6 && <NaverReports />}
          </>
        )}
      </main>
      <AICommandCenter />
    </div>
  );
}

function LoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 via-white to-purple-50 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-gradient-to-r from-meta-blue to-meta-instagram rounded-xl flex items-center justify-center">
              <span className="text-white font-bold text-xl">M</span>
            </div>
            <h1 className="text-3xl font-bold text-gray-900">Meta-Commander</h1>
          </div>
          <p className="text-gray-600">AI 기반 Meta 마케팅 올인원 플랫폼</p>
        </div>

        <Card variant="elevated" padding="lg">
          {!sent ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="text-center mb-2">
                <h2 className="text-lg font-semibold text-gray-900">이메일로 시작하기</h2>
                <p className="text-sm text-gray-500 mt-1">로그인 링크를 이메일로 보내드립니다</p>
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
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">이메일을 확인하세요</h2>
              <p className="text-sm text-gray-500 mb-1">
                <span className="font-medium text-gray-700">{email}</span>
              </p>
              <p className="text-sm text-gray-500 mb-6">
                로 로그인 링크를 보냈습니다
              </p>
              <button
                className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                onClick={() => { setSent(false); setEmail(''); }}
              >
                다른 이메일로 시도
              </button>
            </div>
          )}
        </Card>

        <p className="text-center text-sm text-gray-500 mt-6">
          시장 분석부터 광고 집행까지, AI가 도와드립니다
        </p>
      </div>
    </div>
  );
}
