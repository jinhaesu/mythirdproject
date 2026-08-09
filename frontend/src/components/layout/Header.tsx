'use client';

import { useState, useEffect } from 'react';
import { Settings, LogOut, User, ChevronDown, Link2, Unlink, X, Instagram, Facebook, Globe } from 'lucide-react';
import { useAuthStore, useAppStore } from '@/store';
import { authApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { ThemeToggle } from '@/components/ThemeToggle';

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
  const [metaExpired, setMetaExpired] = useState(false);

  // Meta 토큰 만료 여부 확인 (연동돼 있어도 토큰이 만료됐을 수 있음)
  useEffect(() => {
    if (isAuthenticated && user?.meta_connected) {
      authApi.getConnectionsStatus()
        .then(s => setMetaExpired(!!s.meta?.token_expired))
        .catch(() => {});
    } else {
      setMetaExpired(false);
    }
  }, [isAuthenticated, user?.meta_connected]);

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
    <header style={{ backgroundColor: 'var(--color-bg-level-1)', borderBottom: '1px solid var(--color-border-primary)' }} className="sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between flex-wrap gap-y-2 py-2 lg:py-0 lg:h-14 lg:flex-nowrap">
          <div className="flex items-center gap-3">
            {/* Dynamic logo based on active platform */}
            <div className="flex items-center gap-2">
              {activePlatform === 'meta' ? (
                <div className="w-7 h-7 bg-gradient-to-r from-meta-blue to-meta-instagram rounded-md flex items-center justify-center">
                  <span className="text-white font-bold text-xs">M</span>
                </div>
              ) : activePlatform === 'naver' ? (
                <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: '#2DB400' }}>
                  <span className="text-white font-bold text-xs">N</span>
                </div>
              ) : (
                <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: '#059669' }}>
                  <span className="text-white font-bold text-xs">A</span>
                </div>
              )}
              <span className="font-semibold text-base" style={{ color: 'var(--color-brand-bg)', letterSpacing: '-0.022em' }}>
                {activePlatform === 'meta' ? 'Meta-Commander' : activePlatform === 'naver' ? '네이버 커맨더' : '어필리에이트 매니징'}
              </span>
            </div>
            <span
              className="hidden sm:inline-block px-2 py-0.5 rounded text-xs font-medium"
              style={{
                backgroundColor: 'rgba(94,106,210,0.18)',
                color: 'var(--color-text-primary)',
                border: '1px solid rgba(130,143,255,0.4)',
              }}
            >
              Beta
            </span>

            {/* Platform Switcher */}
            {isAuthenticated && (
              <div
                className="flex items-center rounded-full p-0.5 ml-2"
                style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.05)', border: '1px solid rgb(var(--color-overlay-rgb) / 0.08)' }}
              >
                <button
                  onClick={() => setActivePlatform('meta')}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all"
                  style={
                    activePlatform === 'meta'
                      ? { backgroundColor: 'var(--color-brand-bg)', color: 'var(--color-text-primary)' }
                      : { color: 'var(--color-text-tertiary)' }
                  }
                  onMouseEnter={e => {
                    if (activePlatform !== 'meta') {
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgb(var(--color-overlay-rgb) / 0.07)';
                      (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-primary)';
                    }
                  }}
                  onMouseLeave={e => {
                    if (activePlatform !== 'meta') {
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor = '';
                      (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-tertiary)';
                    }
                  }}
                >
                  <span className="w-4 h-4 flex items-center justify-center text-[10px] font-bold">M</span>
                  <span className="hidden sm:inline">Meta</span>
                </button>
                <button
                  onClick={() => setActivePlatform('naver')}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all"
                  style={
                    activePlatform === 'naver'
                      ? { backgroundColor: '#2DB400', color: 'var(--color-text-primary)' }
                      : { color: 'var(--color-text-tertiary)' }
                  }
                  onMouseEnter={e => {
                    if (activePlatform !== 'naver') {
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgb(var(--color-overlay-rgb) / 0.07)';
                      (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-primary)';
                    }
                  }}
                  onMouseLeave={e => {
                    if (activePlatform !== 'naver') {
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor = '';
                      (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-tertiary)';
                    }
                  }}
                >
                  <span className="w-4 h-4 flex items-center justify-center text-[10px] font-bold">N</span>
                  <span className="hidden sm:inline">Naver</span>
                </button>
                <button
                  onClick={() => setActivePlatform('affiliate')}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all"
                  style={
                    activePlatform === 'affiliate'
                      ? { backgroundColor: '#059669', color: 'var(--color-text-primary)' }
                      : { color: 'var(--color-text-tertiary)' }
                  }
                  onMouseEnter={e => {
                    if (activePlatform !== 'affiliate') {
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgb(var(--color-overlay-rgb) / 0.07)';
                      (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-primary)';
                    }
                  }}
                  onMouseLeave={e => {
                    if (activePlatform !== 'affiliate') {
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor = '';
                      (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-tertiary)';
                    }
                  }}
                >
                  <span className="w-4 h-4 flex items-center justify-center text-[10px] font-bold">A</span>
                  <span className="hidden sm:inline">어필리에이트</span>
                </button>
              </div>
            )}
          </div>

          {isAuthenticated && user && (
            <div className="flex items-center gap-2 sm:gap-3">
              <ThemeToggle />
              {(!user.meta_connected || metaExpired) && (
                <button
                  onClick={handleMetaConnect}
                  disabled={connecting}
                  className="flex items-center gap-2 px-2.5 sm:px-4 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                  style={{ backgroundColor: metaExpired ? 'var(--color-red)' : 'var(--color-brand-bg)', color: metaExpired ? '#fff' : 'var(--color-text-primary)', border: '1px solid transparent' }}
                  onMouseEnter={e => { if (!metaExpired) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--color-accent-hover)'; }}
                  onMouseLeave={e => { if (!metaExpired) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--color-brand-bg)'; }}
                >
                  <Link2 size={14} />
                  <span className="hidden sm:inline">{connecting ? '연결 중...' : metaExpired ? 'Meta 재연동 필요' : 'Meta 연결하기'}</span>
                </button>
              )}

              <div className="relative">
                <button
                  className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 rounded-lg transition-colors"
                  style={{ color: 'var(--color-text-primary)' }}
                  onClick={() => setShowMenu(!showMenu)}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgb(var(--color-overlay-rgb) / 0.07)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = ''; }}
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: 'rgba(94,106,210,0.2)', border: '1px solid rgba(94,106,210,0.4)' }}
                  >
                    <User size={14} style={{ color: 'var(--color-accent-hover)' }} />
                  </div>
                  <div className="hidden sm:block text-left">
                    <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{user.full_name || user.email}</p>
                    <p className="text-xs" style={{ color: metaExpired ? 'var(--color-red)' : user.meta_connected ? 'var(--color-green)' : 'var(--color-orange)' }}>
                      {metaExpired ? 'Meta 토큰 만료' : user.meta_connected ? 'Meta 연동됨' : 'Meta 연동 필요'}
                    </p>
                  </div>
                  <ChevronDown size={14} style={{ color: 'var(--color-text-tertiary)' }} />
                </button>

                {showMenu && (
                  <div
                    className="absolute right-0 mt-1 w-56 rounded-lg py-1 z-50"
                    style={{
                      backgroundColor: 'var(--color-bg-secondary)',
                      border: '1px solid var(--color-border-secondary)',
                      boxShadow: '0px 7px 32px rgba(0,0,0,0.35)',
                    }}
                  >
                    {user.meta_connected ? (
                      <div style={{ borderBottom: '1px solid var(--color-border-secondary)' }}>
                        <div className="px-4 py-2">
                          <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Meta 계정</p>
                          <p className="text-sm font-medium" style={{ color: metaExpired ? 'var(--color-red)' : 'var(--color-green)' }}>
                            {metaExpired ? '토큰 만료 — 재연동 필요' : '연동됨'}
                          </p>
                        </div>
                        <div className="flex" style={{ borderTop: '1px solid var(--color-border-secondary)' }}>
                          <button
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs transition-colors"
                            style={{ color: 'var(--color-accent-hover)' }}
                            onClick={() => { setShowMenu(false); handleMetaConnect(); }}
                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgb(var(--color-overlay-rgb) / 0.07)'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = ''; }}
                          >
                            <Link2 size={12} />
                            재연동
                          </button>
                          <button
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs transition-colors"
                            style={{ color: 'var(--color-red)', borderLeft: '1px solid var(--color-border-secondary)' }}
                            onClick={handleMetaDisconnect}
                            disabled={disconnecting}
                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(235,87,87,0.1)'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = ''; }}
                          >
                            <Unlink size={12} />
                            {disconnecting ? '해제중...' : '연동 해제'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors"
                        style={{ color: 'var(--color-accent-hover)' }}
                        onClick={() => { setShowMenu(false); handleMetaConnect(); }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgb(var(--color-overlay-rgb) / 0.07)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = ''; }}
                      >
                        <Link2 size={16} />
                        Meta 계정 연결
                      </button>
                    )}
                    <button
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors"
                      style={{ color: 'var(--color-text-secondary)' }}
                      onClick={() => { setShowMenu(false); setShowSettings(true); }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgb(var(--color-overlay-rgb) / 0.07)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = ''; }}
                    >
                      <Settings size={16} />
                      계정 설정
                    </button>
                    <button
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors"
                      style={{ color: 'var(--color-red)' }}
                      onClick={() => {
                        logout();
                        setShowMenu(false);
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(235,87,87,0.1)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = ''; }}
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
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
          onClick={() => setShowSettings(false)}
        >
          <div
            className="rounded-xl w-full max-w-lg max-h-[80vh] overflow-y-auto m-4"
            style={{
              backgroundColor: 'var(--color-bg-level-2)',
              border: '1px solid var(--color-border-primary)',
              boxShadow: '0px 7px 32px rgba(0,0,0,0.35)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between px-6 py-4"
              style={{ borderBottom: '1px solid var(--color-border-primary)' }}
            >
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)', letterSpacing: '-0.012em' }}>계정 설정</h2>
              <button
                onClick={() => setShowSettings(false)}
                className="transition-colors rounded-md p-1"
                style={{ color: 'var(--color-text-tertiary)' }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgb(var(--color-overlay-rgb) / 0.07)';
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-primary)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = '';
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-tertiary)';
                }}
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* User Info */}
              <div>
                <h3 className="text-xs font-semibold mb-3" style={{ color: 'var(--color-text-tertiary)', letterSpacing: '-0.01em' }}>사용자 정보</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--color-text-tertiary)' }}>이메일</span>
                    <span className="font-medium" style={{ color: 'var(--color-text-secondary)' }}>{user?.email}</span>
                  </div>
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--color-text-tertiary)' }}>이름</span>
                    <span className="font-medium" style={{ color: 'var(--color-text-secondary)' }}>{user?.full_name || '-'}</span>
                  </div>
                </div>
              </div>

              {/* Meta Connection */}
              <div>
                <h3 className="text-xs font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--color-text-tertiary)' }}>
                  <Facebook size={14} style={{ color: 'var(--color-blue)' }} /> Meta 연동 상태
                </h3>
                {user?.meta_connected ? (
                  <div className="space-y-3">
                    <div
                      className="p-3 rounded-lg"
                      style={{ backgroundColor: 'rgba(39,166,68,0.1)', border: '1px solid rgba(39,166,68,0.3)' }}
                    >
                      <p className="text-sm font-medium" style={{ color: 'var(--color-green)' }}>연동됨</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>광고 계정 ID: {user.meta_ad_account_id || '-'}</p>
                    </div>

                    {loadingStatus ? (
                      <p className="text-xs" style={{ color: 'var(--color-text-quaternary)' }}>계정 정보 로딩 중...</p>
                    ) : metaStatus && (
                      <div className="space-y-3">
                        {/* Facebook Pages — selectable dropdown */}
                        {metaStatus.pages?.length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
                              <Facebook size={12} /> Facebook 페이지
                            </h4>
                            <select
                              value={selectedPageId}
                              onChange={e => setSelectedPageId(e.target.value)}
                              className="w-full px-2 py-1.5 rounded-lg text-xs"
                              style={{
                                backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.03)',
                                border: '1px solid rgb(var(--color-overlay-rgb) / 0.08)',
                                color: 'var(--color-text-primary)',
                              }}
                            >
                              {metaStatus.pages.map((page: any) => (
                                <option key={page.id} value={page.id} style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                                  {page.name} (ID: {page.id})
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        {/* Instagram Account — selectable dropdown if multiple, otherwise display */}
                        {metaStatus.ig_account_id && (
                          <div>
                            <h4 className="text-xs font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
                              <Instagram size={12} /> Instagram 계정
                            </h4>
                            {metaStatus.ig_accounts?.length > 1 ? (
                              <select
                                value={selectedIgId}
                                onChange={e => setSelectedIgId(e.target.value)}
                                className="w-full px-2 py-1.5 rounded-lg text-xs"
                                style={{
                                  backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.03)',
                                  border: '1px solid rgb(var(--color-overlay-rgb) / 0.08)',
                                  color: 'var(--color-text-primary)',
                                }}
                              >
                                {metaStatus.ig_accounts.map((acc: any) => (
                                  <option key={acc.id} value={acc.id} style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                                    {acc.username ? `@${acc.username}` : acc.id}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <div
                                className="p-2 rounded-lg text-xs"
                                style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.03)', border: '1px solid rgb(var(--color-overlay-rgb) / 0.08)' }}
                              >
                                <span className="font-medium" style={{ color: 'var(--color-text-secondary)' }}>
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
                            className="w-full py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                            style={{ backgroundColor: 'var(--color-brand-bg)', color: 'var(--color-text-primary)' }}
                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--color-accent-hover)'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--color-brand-bg)'; }}
                          >
                            {savingSettings ? '저장 중...' : '설정 저장'}
                          </button>
                        )}

                        {/* Ad Accounts */}
                        {metaStatus.ad_accounts?.length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-tertiary)' }}>광고 계정 목록</h4>
                            <div className="space-y-1">
                              {metaStatus.ad_accounts.map((acc: any) => (
                                <div
                                  key={acc.id}
                                  className="flex items-center justify-between p-2 rounded-lg text-xs"
                                  style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.03)', border: '1px solid rgb(var(--color-overlay-rgb) / 0.06)' }}
                                >
                                  <span className="font-medium" style={{ color: 'var(--color-text-secondary)' }}>{acc.name || acc.id}</span>
                                  <button
                                    onClick={async () => {
                                      try {
                                        await authApi.selectAdAccount(acc.id);
                                        const me = await authApi.getMe();
                                        setAuth(me, token!);
                                        toast.success(`광고 계정 "${acc.name || acc.id}" 선택됨`);
                                      } catch { toast.error('계정 전환 실패'); }
                                    }}
                                    className="px-2 py-0.5 rounded text-xs transition-colors"
                                    style={
                                      user.meta_ad_account_id === acc.id
                                        ? { backgroundColor: 'rgba(39,166,68,0.15)', color: 'var(--color-green)', border: '1px solid rgba(39,166,68,0.3)' }
                                        : { backgroundColor: 'rgba(94,106,210,0.15)', color: 'var(--color-accent-hover)', border: '1px solid rgba(94,106,210,0.3)' }
                                    }
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
                          <h4 className="text-xs font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
                            <Globe size={12} /> Threads 프로필
                          </h4>
                          <div
                            className="p-2 rounded-lg text-xs"
                            style={{ backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.03)', border: '1px solid rgb(var(--color-overlay-rgb) / 0.06)' }}
                          >
                            {metaStatus.threads_profile
                              ? <span className="font-medium" style={{ color: 'var(--color-text-secondary)' }}>{metaStatus.threads_profile}</span>
                              : <span style={{ color: 'var(--color-text-quaternary)' }}>Threads 연동은 Meta Business Suite에서 설정하세요.</span>
                            }
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    className="p-3 rounded-lg"
                    style={{ backgroundColor: 'rgba(252,120,64,0.1)', border: '1px solid rgba(252,120,64,0.3)' }}
                  >
                    <p className="text-sm font-medium" style={{ color: 'var(--color-orange)' }}>연동 안됨</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>Meta 계정을 연결하면 광고 관리 기능을 사용할 수 있습니다.</p>
                    <button
                      onClick={handleMetaConnect}
                      disabled={connecting}
                      className="mt-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                      style={{ backgroundColor: 'var(--color-brand-bg)', color: 'var(--color-text-primary)' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--color-accent-hover)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--color-brand-bg)'; }}
                    >
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
