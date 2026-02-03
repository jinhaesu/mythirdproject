'use client';

import { Search, Palette, Target, BarChart2 } from 'lucide-react';
import { useAppStore } from '@/store';
import { clsx } from 'clsx';

const tabs = [
  { id: 0, name: 'Market Intelligence', icon: Search, description: '시장 분석 및 아이디어' },
  { id: 1, name: 'Creative Studio', icon: Palette, description: '콘텐츠 생성' },
  { id: 2, name: 'Ads Controller', icon: Target, description: '매체 전략 및 집행' },
  { id: 3, name: 'Performance Dashboard', icon: BarChart2, description: '성과 분석 및 최적화' },
];

export function TabNav() {
  const { activeTab, setActiveTab, selectedCreatives } = useAppStore();

  return (
    <div className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <nav className="flex space-x-1" aria-label="Tabs">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  'group flex items-center gap-2 px-4 py-4 border-b-2 font-medium text-sm transition-colors',
                  isActive
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                )}
              >
                <Icon size={18} />
                <span className="hidden sm:inline">{tab.name}</span>
                {tab.id === 2 && selectedCreatives.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 bg-primary-100 text-primary-700 text-xs rounded-full">
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
