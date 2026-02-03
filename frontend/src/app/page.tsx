'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useAuthStore, useAppStore } from '@/store';
import { authApi } from '@/lib/api';
import { Header, TabNav } from '@/components/layout';
import { Button, Input, Card, CardTitle } from '@/components/ui';
import {
  MarketIntelligence,
  CreativeStudio,
  AdsController,
  PerformanceDashboard,
} from '@/components/tabs';
import toast from 'react-hot-toast';

export default function Home() {
  const { isAuthenticated, setAuth } = useAuthStore();
  const { activeTab } = useAppStore();

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <TabNav />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 0 && <MarketIntelligence />}
        {activeTab === 1 && <CreativeStudio />}
        {activeTab === 2 && <AdsController />}
        {activeTab === 3 && <PerformanceDashboard />}
      </main>
    </div>
  );
}

function LoginPage() {
  const { setAuth } = useAuthStore();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');

  const loginMutation = useMutation({
    mutationFn: () => authApi.login(email, password),
    onSuccess: async (data) => {
      const user = await authApi.getMe();
      setAuth(user, data.access_token);
      toast.success('로그인 성공!');
    },
    onError: () => toast.error('로그인 실패. 이메일과 비밀번호를 확인하세요.'),
  });

  const registerMutation = useMutation({
    mutationFn: () => authApi.register({ email, password, full_name: name, company_name: company }),
    onSuccess: () => {
      toast.success('회원가입 완료! 로그인해주세요.');
      setIsLogin(true);
    },
    onError: () => toast.error('회원가입 실패. 다시 시도해주세요.'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLogin) {
      loginMutation.mutate();
    } else {
      registerMutation.mutate();
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
          <div className="flex gap-2 mb-6">
            <button
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
                isLogin ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}
              onClick={() => setIsLogin(true)}
            >
              로그인
            </button>
            <button
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
                !isLogin ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}
              onClick={() => setIsLogin(false)}
            >
              회원가입
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <>
                <Input
                  label="이름"
                  placeholder="홍길동"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <Input
                  label="회사명"
                  placeholder="회사명 (선택)"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                />
              </>
            )}
            <Input
              label="이메일"
              type="email"
              placeholder="email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              label="비밀번호"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <Button
              type="submit"
              className="w-full"
              loading={loginMutation.isPending || registerMutation.isPending}
            >
              {isLogin ? '로그인' : '회원가입'}
            </Button>
          </form>
        </Card>

        <p className="text-center text-sm text-gray-500 mt-6">
          시장 분석부터 광고 집행까지, AI가 도와드립니다
        </p>
      </div>
    </div>
  );
}
