import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, StyleExtraction, Creative, Campaign, AutoPlanResponse } from '@/types';

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

interface AppState {
  activeTab: number;
  setActiveTab: (tab: number) => void;

  // Style from TAB 1 to pass to TAB 2
  selectedStyle: StyleExtraction | null;
  stylePrompt: string | null;
  setSelectedStyle: (style: StyleExtraction | null, prompt: string | null) => void;

  // Creatives from TAB 2 for TAB 3
  selectedCreatives: Creative[];
  setSelectedCreatives: (creatives: Creative[]) => void;
  addSelectedCreative: (creative: Creative) => void;
  removeSelectedCreative: (id: number) => void;
  clearSelectedCreatives: () => void;

  // Campaign for TAB 4
  selectedCampaign: Campaign | null;
  setSelectedCampaign: (campaign: Campaign | null) => void;

  // Auto Plan result from CampaignPlanner → AdsController
  autoPlanResult: AutoPlanResponse | null;
  setAutoPlanResult: (result: AutoPlanResponse | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeTab: 0,
  setActiveTab: (tab) => set({ activeTab: tab }),

  selectedStyle: null,
  stylePrompt: null,
  setSelectedStyle: (style, prompt) => set({ selectedStyle: style, stylePrompt: prompt }),

  selectedCreatives: [],
  setSelectedCreatives: (creatives) => set({ selectedCreatives: creatives }),
  addSelectedCreative: (creative) =>
    set((state) => ({
      selectedCreatives: state.selectedCreatives.some((c) => c.id === creative.id)
        ? state.selectedCreatives
        : [...state.selectedCreatives, creative],
    })),
  removeSelectedCreative: (id) =>
    set((state) => ({
      selectedCreatives: state.selectedCreatives.filter((c) => c.id !== id),
    })),
  clearSelectedCreatives: () => set({ selectedCreatives: [] }),

  selectedCampaign: null,
  setSelectedCampaign: (campaign) => set({ selectedCampaign: campaign }),

  autoPlanResult: null,
  setAutoPlanResult: (result) => set({ autoPlanResult: result }),
}));
