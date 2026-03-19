'use client';

import { BarChart3, Monitor, Settings, Layers, Zap, FileText, Search, MessageSquare } from 'lucide-react';
import { useAppStore } from '@/store';
import { clsx } from 'clsx';

const naverTabs = [
  { id: 0, name: '검색광고 대시보드', icon: BarChart3, description: '검색광고 성과 분석' },
  { id: 1, name: '키워드 리서치', icon: Search, description: '쇼핑 검색 랭킹 & 트렌드' },
  { id: 7, name: '리뷰 모니터링', icon: MessageSquare, description: '제품 리뷰 분석 & 이슈 진단' },
  { id: 2, name: '검색광고 관리', icon: Settings, description: '캠페인/키워드 관리' },
  { id: 3, name: 'GFA 대시보드', icon: Monitor, description: '디스플레이 광고 분석' },
  { id: 4, name: 'GFA 관리', icon: Layers, description: '디스플레이 캠페인 관리' },
  { id: 5, name: '자동관리', icon: Zap, description: '룰 기반 자동 최적화' },
  { id: 6, name: '리포트', icon: FileText, description: '통합 리포트 생성' },
];

export function NaverTabNav() {
  const { naverActiveTab, setNaverActiveTab } = useAppStore();

  return (
    <div className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <nav className="flex space-x-1 overflow-x-auto" aria-label="Naver Tabs">
          {naverTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = naverActiveTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => setNaverActiveTab(tab.id)}
                className={clsx(
                  'group flex items-center gap-2 px-4 py-3 border-b-2 font-medium text-sm transition-colors whitespace-nowrap',
                  isActive
                    ? 'border-green-600 text-green-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                )}
              >
                <Icon size={18} />
                <div className="hidden sm:block text-left">
                  <span>{tab.name}</span>
                  <p className={clsx('text-xs font-normal', isActive ? 'text-green-400' : 'text-gray-400')}>
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
