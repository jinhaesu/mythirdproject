'use client';

import { Search, Palette, Target, BarChart2, ClipboardList, Shield } from 'lucide-react';
import { useAppStore } from '@/store';
import { clsx } from 'clsx';

const tabs = [
  { id: 0, name: '시장 분석', icon: Search, description: '경쟁사/키워드 모니터링' },
  { id: 1, name: '소재 제작', icon: Palette, description: '이미지/영상 생성' },
  { id: 2, name: '캠페인 기획', icon: ClipboardList, description: '구조/타겟/카피 설계' },
  { id: 3, name: '광고 집행', icon: Target, description: '캠페인 생성 및 관리' },
  { id: 4, name: '성과 분석', icon: BarChart2, description: 'KPI 대시보드' },
  { id: 5, name: '자동 관리', icon: Shield, description: '룰 기반 자동 최적화' },
];

export function TabNav() {
  const { activeTab, setActiveTab, selectedCreatives } = useAppStore();

  return (
    <div style={{ backgroundColor: '#0F1011', borderBottom: '1px solid #23252A' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <nav className="flex space-x-1 overflow-x-auto" aria-label="Tabs">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  'group flex items-center gap-2 px-4 py-3 border-b-2 font-medium text-sm transition-colors whitespace-nowrap'
                )}
                style={{
                  borderBottomColor: isActive ? '#5E6AD2' : 'transparent',
                  color: isActive ? '#F7F8F8' : '#8A8F98',
                }}
                onMouseEnter={e => {
                  if (!isActive) {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(255,255,255,0.05)';
                    (e.currentTarget as HTMLButtonElement).style.color = '#D0D6E0';
                  }
                }}
                onMouseLeave={e => {
                  if (!isActive) {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = '';
                    (e.currentTarget as HTMLButtonElement).style.color = '#8A8F98';
                  }
                }}
              >
                <Icon
                  size={16}
                  style={{ color: isActive ? '#828FFF' : '#8A8F98' }}
                />
                <div className="hidden sm:block text-left">
                  <span>{tab.name}</span>
                  <p
                    className="text-xs font-normal"
                    style={{ color: isActive ? '#828FFF' : '#62666D' }}
                  >
                    {tab.description}
                  </p>
                </div>
                <span className="sm:hidden">{tab.name}</span>
                {tab.id === 3 && selectedCreatives.length > 0 && (
                  <span
                    className="ml-1 px-1.5 py-0.5 text-xs rounded-full"
                    style={{
                      backgroundColor: 'rgba(94,106,210,0.18)',
                      color: '#828FFF',
                      border: '1px solid rgba(130,143,255,0.3)',
                    }}
                  >
                    {selectedCreatives.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
