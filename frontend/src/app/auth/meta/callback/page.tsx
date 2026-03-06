'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import api from '@/lib/api';

interface AdAccount {
  id: string;
  account_id: string;
  name: string;
  currency: string;
  timezone: string;
  status: number;
}

interface MetaPage {
  id: string;
  name: string;
  instagram?: { id: string; username: string };
}

function MetaCallbackContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<'processing' | 'select_account' | 'success' | 'error'>('processing');
  const [error, setError] = useState('');
  const [adAccounts, setAdAccounts] = useState<AdAccount[]>([]);
  const [pages, setPages] = useState<MetaPage[]>([]);
  const [metaName, setMetaName] = useState('');

  useEffect(() => {
    const code = searchParams.get('code');
    const errorParam = searchParams.get('error');

    if (errorParam) {
      setStatus('error');
      setError(searchParams.get('error_description') || 'Facebook 로그인이 취소되었습니다.');
      return;
    }

    if (!code) {
      setStatus('error');
      setError('인증 코드가 없습니다.');
      return;
    }

    const state = searchParams.get('state') || '';
    handleCallback(code, state);
  }, [searchParams]);

  const handleCallback = async (code: string, state: string) => {
    try {
      const { data } = await api.post('/auth/meta/callback', null, {
        params: { code, state },
      });

      setMetaName(data.meta_name || '');
      setAdAccounts(data.ad_accounts || []);
      setPages(data.pages || []);

      if (data.ad_accounts && data.ad_accounts.length > 1) {
        setStatus('select_account');
      } else {
        setStatus('success');
        setTimeout(() => router.push('/'), 2000);
      }
    } catch (err: any) {
      setStatus('error');
      setError(err.response?.data?.detail || 'Meta 연동에 실패했습니다.');
    }
  };

  const selectAccount = async (accountId: string) => {
    try {
      await api.post('/auth/meta/select-ad-account', null, {
        params: { ad_account_id: accountId },
      });
      setStatus('success');
      setTimeout(() => router.push('/'), 2000);
    } catch (err: any) {
      setError(err.response?.data?.detail || '계정 선택에 실패했습니다.');
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg max-w-md w-full p-8">
      {status === 'processing' && (
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Meta 계정 연결 중...</h2>
          <p className="text-gray-500">잠시만 기다려주세요.</p>
        </div>
      )}

      {status === 'select_account' && (
        <div>
          <div className="text-center mb-6">
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <span className="text-2xl">📊</span>
            </div>
            <h2 className="text-xl font-semibold text-gray-900">광고 계정 선택</h2>
            <p className="text-gray-500 mt-1">{metaName}님, 사용할 광고 계정을 선택하세요.</p>
          </div>
          <div className="space-y-3">
            {adAccounts.map((acc) => (
              <button
                key={acc.id}
                onClick={() => selectAccount(acc.account_id)}
                className="w-full text-left p-4 border border-gray-200 rounded-xl hover:border-blue-400 hover:bg-blue-50 transition-colors"
              >
                <div className="font-medium text-gray-900">{acc.name}</div>
                <div className="text-sm text-gray-500 mt-1">
                  ID: {acc.account_id} · {acc.currency} · {acc.timezone}
                </div>
              </button>
            ))}
          </div>
          {pages.length > 0 && (
            <div className="mt-6 pt-4 border-t">
              <h3 className="text-sm font-medium text-gray-700 mb-2">연결된 페이지</h3>
              {pages.map((page) => (
                <div key={page.id} className="text-sm text-gray-600">
                  {page.name}
                  {page.instagram && (
                    <span className="text-pink-500 ml-2">@{page.instagram.username}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {status === 'success' && (
        <div className="text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Meta 연동 완료!</h2>
          <p className="text-gray-500">{metaName}님의 계정이 연결되었습니다.</p>
          <p className="text-sm text-gray-400 mt-2">잠시 후 메인 페이지로 이동합니다...</p>
        </div>
      )}

      {status === 'error' && (
        <div className="text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">연결 실패</h2>
          <p className="text-red-500 mb-4">{error}</p>
          <button
            onClick={() => router.push('/')}
            className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
          >
            돌아가기
          </button>
        </div>
      )}
    </div>
  );
}

export default function MetaCallbackPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <Suspense
        fallback={
          <div className="bg-white rounded-2xl shadow-lg max-w-md w-full p-8 text-center">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">로딩 중...</h2>
          </div>
        }
      >
        <MetaCallbackContent />
      </Suspense>
    </div>
  );
}
