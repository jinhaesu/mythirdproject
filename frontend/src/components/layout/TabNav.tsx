'use client';

import { BarChart2, Shield, Gauge, Share2, Database } from 'lucide-react';
import { useAppStore } from '@/store';
import { clsx } from 'clsx';

const tabs = [
  { id: 0, name: '데이터 대시보드', icon: Database, description: '채널별 월간 ROAS·광고비·조회수' },
  { id: 4, name: '성과 분석', icon: BarChart2, description: 'KPI 대시보드' },
  { id: 6, name: '자사몰 마케팅 KPI', icon: Gauge, description: '목표·CAC·LTV 관리' },
  { id: 7, name: '그 외 마케팅 KPI', icon: Share2, description: '외부 채널·시딩·협찬' },
  { id: 5, name: '자동 관리', icon: Shield, description: '룰 기반 자동 최적화' },
];

export function TabNav() {
  const { activeTab, setActiveTab } = useAppStore();

  return (
    <div style={{ backgroundColor: 'var(--color-bg-level-1)', borderBottom: '1px solid var(--color-border-primary)' }}>
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
                  borderBottomColor: isActive ? 'var(--color-brand-bg)' : 'transparent',
                  color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                }}
                onMouseEnter={e => {
                  if (!isActive) {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgb(var(--color-overlay-rgb) / 0.05)';
                    (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-secondary)';
                  }
                }}
                onMouseLeave={e => {
                  if (!isActive) {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = '';
                    (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-tertiary)';
                  }
                }}
              >
                <Icon
                  size={16}
                  style={{ color: isActive ? 'var(--color-accent-hover)' : 'var(--color-text-tertiary)' }}
                />
                <div className="hidden sm:block text-left">
                  <span>{tab.name}</span>
                  <p
                    className="text-xs font-normal"
                    style={{ color: isActive ? 'var(--color-accent-hover)' : 'var(--color-text-quaternary)' }}
                  >
                    {tab.description}
                  </p>
                </div>
                <span className="sm:hidden">{tab.name}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
