'use client';

/**
 * 업무 중심 메인 네비게이션 (2026-09 전면 개편).
 *
 * 기존 "플랫폼(Meta/Naver/어필) 스위처 + 플랫폼별 탭바" 2단 구조를
 * 마케팅팀 업무 단위 메뉴 + 컨텍스트 서브탭으로 교체.
 * 기존 탭 컴포넌트는 그대로 재사용하고 배치만 바꾼다 (page.tsx 참조).
 */
import {
  Home, Megaphone, PenLine, Activity, Compass, Target, Wrench,
} from 'lucide-react';
import { useAppStore, type MenuKey } from '@/store';

export interface SubTabDef {
  id: number;
  name: string;
}

// 속성 기반 재편(2026-10): 홈(브리핑) → 입력(결과·계획 기입) →
// 성과 분석(계획 대비 결과) → 실시간 채널(자동 수집) → 인텔리전스 → 운영 → 도구
export const MENUS: { key: MenuKey; name: string; icon: any; subTabs: SubTabDef[] }[] = [
  { key: 'home', name: '홈', icon: Home, subTabs: [] },
  {
    key: 'input', name: '입력', icon: PenLine,
    subTabs: [
      { id: 0, name: '광고비 일보' },
      { id: 1, name: '활동 기록' },
      { id: 2, name: '월 목표 입력' },
    ],
  },
  {
    key: 'analysis', name: '성과 분석', icon: Target,
    subTabs: [
      { id: 0, name: 'KPI 대시보드' },
      { id: 1, name: '자사몰 KPI' },
      { id: 2, name: '외부 채널 KPI' },
    ],
  },
  {
    key: 'live', name: '실시간 채널', icon: Activity,
    subTabs: [
      { id: 0, name: 'Meta 성과' },
      { id: 1, name: 'Meta 일별 데이터' },
      { id: 2, name: '네이버 검색광고' },
      { id: 3, name: 'GFA' },
    ],
  },
  {
    key: 'intel', name: '브랜드 인텔리전스', icon: Compass,
    subTabs: [
      { id: 0, name: '네이버 인사이트' },
      { id: 1, name: '키워드 리서치·순위' },
    ],
  },
  {
    key: 'affiliate', name: '공구·어필리에이트', icon: Megaphone,
    subTabs: [
      { id: 0, name: '공구 보드' },
      { id: 1, name: '어필리에이트 운영' },
    ],
  },
  {
    key: 'tools', name: '도구', icon: Wrench,
    subTabs: [
      { id: 0, name: '검색광고 캠페인 관리' },
      { id: 1, name: 'GFA 캠페인 관리' },
      { id: 2, name: 'Meta 자동화·리포트' },
      { id: 3, name: '네이버 자동화' },
      { id: 4, name: '네이버 리포트' },
    ],
  },
];

export function MainNav() {
  const { activeMenu, setActiveMenu, menuSubTab, setMenuSubTab } = useAppStore();
  const current = MENUS.find((m) => m.key === activeMenu) ?? MENUS[0];
  const currentSub = menuSubTab[activeMenu] ?? 0;

  return (
    <div style={{ backgroundColor: 'var(--color-bg-level-1)', borderBottom: '1px solid var(--color-border-primary)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* 1단: 업무 메뉴 */}
        <nav className="flex space-x-1 overflow-x-auto" aria-label="주 메뉴">
          {MENUS.map((menu) => {
            const Icon = menu.icon;
            const isActive = activeMenu === menu.key;
            return (
              <button
                key={menu.key}
                onClick={() => setActiveMenu(menu.key)}
                className="group flex items-center gap-2 px-3.5 py-3 border-b-2 font-medium text-sm transition-colors whitespace-nowrap"
                style={{
                  borderBottomColor: isActive ? 'var(--color-brand-bg)' : 'transparent',
                  color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.backgroundColor = 'rgb(var(--color-overlay-rgb) / 0.05)';
                    e.currentTarget.style.color = 'var(--color-text-secondary)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.backgroundColor = '';
                    e.currentTarget.style.color = 'var(--color-text-tertiary)';
                  }
                }}
              >
                <Icon
                  size={16}
                  style={{ color: isActive ? 'var(--color-accent-hover)' : 'var(--color-text-tertiary)' }}
                />
                <span>{menu.name}</span>
              </button>
            );
          })}
        </nav>

        {/* 2단: 컨텍스트 서브탭 (있을 때만) */}
        {current.subTabs.length > 0 && (
          <nav
            className="flex space-x-1 overflow-x-auto pb-1"
            aria-label="서브 메뉴"
            style={{ borderTop: '1px solid rgb(var(--color-overlay-rgb) / 0.04)' }}
          >
            {current.subTabs.map((sub) => {
              const isActive = currentSub === sub.id;
              return (
                <button
                  key={sub.id}
                  onClick={() => setMenuSubTab(current.key, sub.id)}
                  className="px-3 py-1.5 mt-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap"
                  style={
                    isActive
                      ? { backgroundColor: 'rgb(var(--color-overlay-rgb) / 0.08)', color: 'var(--color-text-primary)' }
                      : { color: 'var(--color-text-tertiary)' }
                  }
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.color = 'var(--color-text-secondary)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.color = 'var(--color-text-tertiary)';
                  }}
                >
                  {sub.name}
                </button>
              );
            })}
          </nav>
        )}
      </div>
    </div>
  );
}
