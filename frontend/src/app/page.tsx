'use client';

import { useState, useEffect } from 'react';
import { useAuthStore, useAppStore } from '@/store';
import { authApi } from '@/lib/api';
import { Header, TabNav, NaverTabNav } from '@/components/layout';
import {
  PerformanceDashboard,
  AutoManagement,
  AffiliateManaging,
  MarketingKPI,
  ExternalMarketingKPI,
  DataDashboard,
} from '@/components/tabs';
import {
  NaverSearchAdsDashboard,
  NaverGFADashboard,
  NaverSearchAdsManager,
  NaverGFAManager,
  NaverAutoManagement,
  NaverReports,
  NaverKeywordResearch,
  NaverInsights,
} from '@/components/tabs/naver';
import { AICommandCenter } from '@/components/chat/AICommandCenter';
import NuldamSystemBar from '@/components/NuldamSystemBar';
import toast from 'react-hot-toast';

// React strict mode의 effect double-invoke 방어용 — 동일 매직링크 토큰은 1회만 verify
const _verifiedMagicTokens = new Set<string>();

export default function Home() {
  const { isAuthenticated, setAuth, logout } = useAuthStore();
  const { activeTab, activePlatform, naverActiveTab, setActiveTab, setNaverActiveTab } = useAppStore();
  const [verifying, setVerifying] = useState(false);

  // 탭 id 0은 데이터 대시보드로 재사용 (구 시장 분석 자리).
  // 소재 제작(1)·캠페인 기획(2)·광고 집행(3) 메뉴 제거 — 저장된 탭 상태는 대시보드로
  useEffect(() => {
    if (activeTab === 1 || activeTab === 2 || activeTab === 3) setActiveTab(0);
  }, [activeTab, setActiveTab]);

  // 리뷰 모니터링(7) 메뉴 제거 — 저장된 탭 상태는 네이버 인사이트로
  useEffect(() => {
    if (naverActiveTab === 7) setNaverActiveTab(8);
  }, [naverActiveTab, setNaverActiveTab]);

  // 인터셉터의 401 발생 알림을 받아 로그아웃 처리 — 강제 reload 대신
  useEffect(() => {
    const onExpired = () => {
      logout();
      toast.error('로그인이 만료되었습니다. 다시 로그인해 주세요.');
    };
    window.addEventListener('auth-expired', onExpired);
    return () => window.removeEventListener('auth-expired', onExpired);
  }, [logout]);

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
      // 같은 토큰 두 번 verify 방지 (strict mode/뒤로가기 등)
      if (_verifiedMagicTokens.has(token)) {
        window.history.replaceState({}, '', '/');
        return;
      }
      _verifiedMagicTokens.add(token);
      // URL에서 token 즉시 제거 — verify 실패해도 같은 토큰으로 재시도되지 않게 차단
      window.history.replaceState({}, '', '/');

      setVerifying(true);
      const pendingRef = localStorage.getItem('pending_ref') ?? undefined;
      authApi.verifyMagicLink(token, pendingRef)
        .then(async (data) => {
          localStorage.setItem('token', data.access_token);
          localStorage.removeItem('pending_ref');
          const user = await authApi.getMe();
          setAuth(user, data.access_token);
          toast.success('로그인 성공!');
        })
        .catch(() => {
          toast.error('로그인 링크가 만료되었거나 유효하지 않습니다.');
        })
        .finally(() => setVerifying(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <div className="min-h-screen flex items-center justify-center bg-bg-0">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-brand border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-text-tertiary text-lg">로그인 확인 중...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <div className="min-h-screen bg-bg-0">
      <NuldamSystemBar current="marketing" />
      <Header />
      {activePlatform === 'meta' ? <TabNav /> : activePlatform === 'naver' ? <NaverTabNav /> : null}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activePlatform === 'meta' && (
          <>
            {activeTab === 0 && <DataDashboard />}
            {activeTab === 4 && <PerformanceDashboard />}
            {activeTab === 5 && <AutoManagement />}
            {activeTab === 6 && <MarketingKPI />}
            {activeTab === 7 && <ExternalMarketingKPI />}
          </>
        )}
        {activePlatform === 'naver' && (
          <>
            {naverActiveTab === 0 && <NaverSearchAdsDashboard />}
            {naverActiveTab === 1 && <NaverKeywordResearch />}
            {naverActiveTab === 8 && <NaverInsights />}
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
  // 통합 SSO 자동 포워드 — 미인증 시 중앙 허브(auth.nuldam.com)로 즉시 이동.
  // 단, 인바운드 토큰(매직링크 ?token= 또는 /sso 콜백)을 처리 중일 때는
  // 리다이렉트하지 않는다 (상위 Home 이펙트 / SSOPage 가 처리 중).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    // 추천(ref) 코드가 있으면 가입 흐름 호환을 위해 저장만 해둔다.
    const ref = params.get('ref');
    if (ref) {
      localStorage.setItem('pending_ref', ref);
    }

    // 매직링크 토큰이 URL에 남아 있으면 상위 Home 이펙트가 검증 중 → 대기.
    const hasMagicToken = params.has('token');
    // /sso 경로는 SSOPage 가 별도로 콜백을 처리 → 대기.
    const isSsoRoute = window.location.pathname.startsWith('/sso');
    if (hasMagicToken || isSsoRoute) {
      return;
    }

    // 미인증 + 처리 중인 토큰 없음 → 중앙 SSO 허브로 즉시 포워드.
    window.location.href =
      'https://auth.nuldam.com/authorize?app=marketing&return=' +
      encodeURIComponent('https://marketing.nuldam.com/sso');
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-0 p-4">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-brand border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-text-tertiary text-lg">회사 계정으로 이동 중...</p>
      </div>
    </div>
  );
}
