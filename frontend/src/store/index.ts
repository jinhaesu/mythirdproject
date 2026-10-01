import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/types';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  setAuth: (user: User, token: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      setAuth: (user, token) => {
        localStorage.setItem('token', token);
        set({ user, token, isAuthenticated: true });
      },
      logout: () => {
        localStorage.removeItem('token');
        set({ user: null, token: null, isAuthenticated: false });
      },
    }),
    {
      name: 'auth-storage',
    }
  )
);

// 속성 기반 메뉴 재편(2026-10): 입력(결과·계획) / 분석(계획 대비) / 실시간(자동 수집)
export type MenuKey = 'home' | 'input' | 'analysis' | 'live' | 'intel' | 'affiliate' | 'tools';

interface AppState {
  activeMenu: MenuKey;
  setActiveMenu: (menu: MenuKey) => void;
  menuSubTab: Partial<Record<MenuKey, number>>;
  setMenuSubTab: (menu: MenuKey, tab: number) => void;
}

// 구 플랫폼 스위처(activeTab/naverActiveTab 등)와 소재→캠페인 전달 상태는
// 2026-09 개편에서 해당 화면들과 함께 제거됐다.
export const useAppStore = create<AppState>((set) => ({
  activeMenu: 'home',
  setActiveMenu: (menu) => set({ activeMenu: menu }),
  menuSubTab: {},
  setMenuSubTab: (menu, tab) =>
    set((state) => ({ menuSubTab: { ...state.menuSubTab, [menu]: tab } })),
}));
