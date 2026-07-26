'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/store';

// React strict mode의 effect double-invoke 방어용 — 동일 SSO 토큰은 1회만 교환
const _exchangedSsoTokens = new Set<string>();

export default function SSOPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 허브가 #token=<jwt> 형태로 리다이렉트한다
    const hash = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash;
    const params = new URLSearchParams(hash);
    const token = params.get('token');

    // 토큰을 URL(주소창/히스토리)에서 즉시 제거
    window.history.replaceState({}, '', '/sso');

    if (!token) {
      setError('SSO 토큰을 찾을 수 없습니다. 다시 로그인해 주세요.');
      return;
    }

    if (_exchangedSsoTokens.has(token)) {
      return;
    }
    _exchangedSsoTokens.add(token);

    authApi
      .sso(token)
      .then(async (data) => {
        // 매직링크 핸들러(page.tsx)와 동일한 순서로 처리:
        // 1) access_token 을 먼저 저장해야 api 클라이언트 인터셉터가
        //    이어지는 getMe() 요청에 Authorization: Bearer 를 첨부한다.
        localStorage.setItem('token', data.access_token);
        // 2) 저장된 토큰으로 사용자 정보 조회 (cross-origin GET /auth/me)
        const user = await authApi.getMe();
        // 3) 스토어 반영 후 홈으로 이동
        useAuthStore.getState().setAuth(user, data.access_token);
        router.push('/');
      })
      .catch((err) => {
        // 실패 원인 진단용 상세 로깅 (CORS/401/네트워크 구분)
        // eslint-disable-next-line no-console
        console.error(
          '[SSO] 로그인 실패 — status:',
          err?.response?.status,
          'data:',
          err?.response?.data,
          'message:',
          err?.message,
          err,
        );
        setError('회사 계정 로그인에 실패했습니다. 다시 시도해 주세요.');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#08090A] p-4">
      <div className="text-center">
        {error ? (
          <div className="w-full max-w-sm">
            <div className="w-16 h-16 bg-[#E5484D]/10 border border-[#E5484D]/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-[#E5484D]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-[#F7F8F8] mb-2">로그인 실패</h1>
            <p className="text-sm text-[#8A8F98] mb-6">{error}</p>
            <Link
              href="/"
              className="inline-block px-5 py-2.5 rounded-lg bg-[#5E6AD2] text-white text-sm font-medium hover:bg-[#4E5ABF] transition-colors duration-150"
            >
              로그인 화면으로 돌아가기
            </Link>
          </div>
        ) : (
          <>
            <div className="w-12 h-12 border-4 border-[#5E6AD2] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-[#8A8F98] text-lg">회사 계정으로 로그인 중...</p>
          </>
        )}
      </div>
    </div>
  );
}
