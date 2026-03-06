'use client';

import { useState } from 'react';
import { Settings, LogOut, User, ChevronDown, Link2 } from 'lucide-react';
import { useAuthStore } from '@/store';
import { authApi } from '@/lib/api';
import toast from 'react-hot-toast';

export function Header() {
  const { user, logout, isAuthenticated, setAuth } = useAuthStore();
  const [showMenu, setShowMenu] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const handleMetaConnect = async () => {
    setConnecting(true);
    try {
      const { login_url } = await authApi.getMetaLoginUrl();
      window.location.href = login_url;
    } catch (err: any) {
      const msg = err?.response?.data?.detail || 'Meta 연결 URL을 가져올 수 없습니다.';
      toast.error(msg);
      setConnecting(false);
    }
  };

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-r from-meta-blue to-meta-instagram rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">M</span>
              </div>
              <span className="font-bold text-xl text-gray-900">Meta-Commander</span>
            </div>
            <span className="px-2 py-0.5 bg-primary-100 text-primary-700 rounded text-xs font-medium">Beta</span>
          </div>

          {isAuthenticated && user && (
            <div className="flex items-center gap-3">
              {!user.meta_connected && (
                <button
                  onClick={handleMetaConnect}
                  disabled={connecting}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  <Link2 size={16} />
                  {connecting ? '연결 중...' : 'Meta 연결하기'}
                </button>
              )}

              <div className="relative">
                <button
                  className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
                  onClick={() => setShowMenu(!showMenu)}
                >
                  <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                    <User size={16} className="text-primary-600" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-medium text-gray-900">{user.full_name || user.email}</p>
                    <p className={`text-xs ${user.meta_connected ? 'text-green-600' : 'text-orange-500'}`}>
                      {user.meta_connected ? 'Meta 연동됨' : 'Meta 연동 필요'}
                    </p>
                  </div>
                  <ChevronDown size={16} className="text-gray-400" />
                </button>

                {showMenu && (
                  <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                    {user.meta_connected ? (
                      <div className="px-4 py-2 border-b border-gray-100">
                        <p className="text-xs text-gray-500">Meta 계정</p>
                        <p className="text-sm font-medium text-green-600">연동됨</p>
                      </div>
                    ) : (
                      <button
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-blue-600 hover:bg-blue-50"
                        onClick={() => { setShowMenu(false); handleMetaConnect(); }}
                      >
                        <Link2 size={16} />
                        Meta 계정 연결
                      </button>
                    )}
                    <button
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      onClick={() => setShowMenu(false)}
                    >
                      <Settings size={16} />
                      설정
                    </button>
                    <button
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                      onClick={() => {
                        logout();
                        setShowMenu(false);
                      }}
                    >
                      <LogOut size={16} />
                      로그아웃
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
