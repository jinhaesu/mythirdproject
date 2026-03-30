'use client';

import { useState, useEffect } from 'react';
import { Settings, LogOut, User, ChevronDown, Link2, Unlink, X, Instagram, Facebook, Globe } from 'lucide-react';
import { useAuthStore, useAppStore } from '@/store';
import { authApi } from '@/lib/api';
import toast from 'react-hot-toast';

export function Header() {
  const { user, logout, isAuthenticated, setAuth, token } = useAuthStore();
  const { activePlatform, setActivePlatform } = useAppStore();
  const [showMenu, setShowMenu] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [metaStatus, setMetaStatus] = useState<any>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [selectedPageId, setSelectedPageId] = useState('');
  const [selectedIgId, setSelectedIgId] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);

  // Load Meta account details when settings is opened
  useEffect(() => {
    if (showSettings && user?.meta_connected) {
      setLoadingStatus(true);
      authApi.getMetaStatus()
        .then(data => {
          setMetaStatus(data);
          // Pre-select current values if available
          if (data.pages?.length > 0) {
            setSelectedPageId(data.selected_page_id || data.pages[0]?.id || '');
          }
          if (data.ig_account_id) {
            setSelectedIgId(data.ig_account_id);
          }
        })
        .catch(() => {})
        .finally(() => setLoadingStatus(false));
    }
  }, [showSettings, user?.meta_connected]);

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

  const handleMetaDisconnect = async () => {
    if (!confirm('Meta 계정 연동을 해제하시겠습니까?\n해제 후 다시 연동하면 Instagram 권한도 새로 부여됩니다.')) return;
    setDisconnecting(true);
    try {
      await authApi.disconnectMeta();
      // Refresh user data
      const me = await authApi.getMe();
      setAuth(me, token!);
      toast.success('Meta 연동이 해제되었습니다. 다시 연동해주세요.');
      setShowMenu(false);
    } catch (err: any) {
      toast.error('연동 해제에 실패했습니다.');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            {/* Dynamic logo based on active platform */}
            <div className="flex items-center gap-2">
              {activePlatform === 'meta' ? (
                <div className="w-8 h-8 bg-gradient-to-r from-meta-blue to-meta-instagram rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-sm">M</span>
                </div>
              ) : (
                <div className="w-8 h-8 bg-gradient-to-r from-green-500 to-green-600 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-sm">N</span>
                </div>
              )}
              <span className="font-bold text-xl text-gray-900">
                {activePlatform === 'meta' ? 'Meta-Commander' : '네이버 커맨더'}
              </span>
            </div>
            <span className="px-2 py-0.5 bg-primary-100 text-primary-700 rounded text-xs font-medium">Beta</span>

            {/* Platform Switcher */}
            {isAuthenticated && (
              <div className="flex items-center bg-gray-100 rounded-full p-0.5 ml-2">
                <button
                  onClick={() => setActivePlatform('meta')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    activePlatform === 'meta'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <span className="w-4 h-4 flex items-center justify-center text-[10px] font-bold">M</span>
                  <span className="hidden sm:inline">Meta</span>
                </button>
                <button
                  onClick={() => setActivePlatform('naver')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    activePlatform === 'naver'
                      ? 'bg-green-600 text-white shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <span className="w-4 h-4 flex items-center justify-center text-[10px] font-bold">N</span>
                  <span className="hidden sm:inline">Naver</span>
                </button>
              </div>
            )}
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
                      <div className="border-b border-gray-100">
                        <div className="px-4 py-2">
                          <p className="text-xs text-gray-500">Meta 계정</p>
                          <p className="text-sm font-medium text-green-600">연동됨</p>
                        </div>
                        <div className="flex border-t border-gray-100">
                          <button
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-blue-600 hover:bg-blue-50"
                            onClick={() => { setShowMenu(false); handleMetaConnect(); }}
                          >
                            <Link2 size={12} />
                            재연동
                          </button>
                          <button
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-red-500 hover:bg-red-50 border-l border-gray-100"
                            onClick={handleMetaDisconnect}
                            disabled={disconnecting}
                          >
                            <Unlink size={12} />
                            {disconnecting ? '해제중...' : '연동 해제'}
                          </button>
                        </div>
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
                      onClick={() => { setShowMenu(false); setShowSettings(true); }}
                    >
                      <Settings size={16} />
                      계정 설정
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
      {/* Account Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onClick={() => setShowSettings(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto m-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">계정 설정</h2>
              <button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-6">
              {/* User Info */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">사용자 정보</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-gray-500">이메일</span><span className="font-medium">{user?.email}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">이름</span><span className="font-medium">{user?.full_name || '-'}</span></div>
                </div>
              </div>

              {/* Meta Connection */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <Facebook size={16} className="text-blue-600" /> Meta 연동 상태
                </h3>
                {user?.meta_connected ? (
                  <div className="space-y-3">
                    <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                      <p className="text-sm font-medium text-green-700">연동됨</p>
                      <p className="text-xs text-green-600 mt-0.5">광고 계정 ID: {user.meta_ad_account_id || '-'}</p>
                    </div>

                    {loadingStatus ? (
                      <p className="text-xs text-gray-400">계정 정보 로딩 중...</p>
                    ) : metaStatus && (
                      <div className="space-y-3">
                        {/* Facebook Pages — selectable dropdown */}
                        {metaStatus.pages?.length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1.5">
                              <Facebook size={12} /> Facebook 페이지
                            </h4>
                            <select
                              value={selectedPageId}
                              onChange={e => setSelectedPageId(e.target.value)}
                              className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white"
                            >
                              {metaStatus.pages.map((page: any) => (
                                <option key={page.id} value={page.id}>{page.name} (ID: {page.id})</option>
                              ))}
                            </select>
                          </div>
                        )}

                        {/* Instagram Account — selectable dropdown if multiple, otherwise display */}
                        {metaStatus.ig_account_id && (
                          <div>
                            <h4 className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1.5">
                              <Instagram size={12} /> Instagram 계정
                            </h4>
                            {metaStatus.ig_accounts?.length > 1 ? (
                              <select
                                value={selectedIgId}
                                onChange={e => setSelectedIgId(e.target.value)}
                                className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white"
                              >
                                {metaStatus.ig_accounts.map((acc: any) => (
                                  <option key={acc.id} value={acc.id}>{acc.username ? `@${acc.username}` : acc.id}</option>
                                ))}
                              </select>
                            ) : (
                              <div className="p-2 bg-gray-50 rounded-lg text-xs">
                                <span className="font-medium text-gray-800">
                                  {metaStatus.ig_username ? `@${metaStatus.ig_username}` : `ID: ${metaStatus.ig_account_id}`}
                                </span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Save button for page/IG selection */}
                        {(metaStatus.pages?.length > 0 || metaStatus.ig_account_id) && (
                          <button
                            onClick={async () => {
                              setSavingSettings(true);
                              try {
                                await authApi.updateMetaSettings({
                                  page_id: selectedPageId || undefined,
                                  instagram_account_id: selectedIgId || undefined,
                                });
                                const me = await authApi.getMe();
                                setAuth(me, token!);
                                toast.success('설정이 저장되었습니다.');
                              } catch {
                                toast.error('설정 저장에 실패했습니다.');
                              } finally {
                                setSavingSettings(false);
                              }
                            }}
                            disabled={savingSettings}
                            className="w-full py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                          >
                            {savingSettings ? '저장 중...' : '설정 저장'}
                          </button>
                        )}

                        {/* Ad Accounts */}
                        {metaStatus.ad_accounts?.length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold text-gray-600 mb-2">광고 계정 목록</h4>
                            <div className="space-y-1">
                              {metaStatus.ad_accounts.map((acc: any) => (
                                <div key={acc.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg text-xs">
                                  <span className="font-medium text-gray-800">{acc.name || acc.id}</span>
                                  <button
                                    onClick={async () => {
                                      try {
                                        await authApi.selectAdAccount(acc.id);
                                        const me = await authApi.getMe();
                                        setAuth(me, token!);
                                        toast.success(`광고 계정 "${acc.name || acc.id}" 선택됨`);
                                      } catch { toast.error('계정 전환 실패'); }
                                    }}
                                    className={`px-2 py-0.5 rounded text-xs ${
                                      user.meta_ad_account_id === acc.id
                                        ? 'bg-green-100 text-green-700 font-medium'
                                        : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                                    }`}
                                  >
                                    {user.meta_ad_account_id === acc.id ? '사용 중' : '선택'}
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Threads / Other accounts info */}
                        <div>
                          <h4 className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1.5">
                            <Globe size={12} /> Threads 프로필
                          </h4>
                          <div className="p-2 bg-gray-50 rounded-lg text-xs text-gray-500">
                            {metaStatus.threads_profile
                              ? <span className="font-medium text-gray-800">{metaStatus.threads_profile}</span>
                              : <span>Threads 연동은 Meta Business Suite에서 설정하세요.</span>
                            }
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                    <p className="text-sm font-medium text-orange-700">연동 안됨</p>
                    <p className="text-xs text-orange-600 mt-1">Meta 계정을 연결하면 광고 관리 기능을 사용할 수 있습니다.</p>
                    <button onClick={handleMetaConnect} disabled={connecting}
                      className="mt-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700">
                      {connecting ? '연결 중...' : 'Meta 연결하기'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
