'use client';

import { memo, useCallback, useRef } from 'react';

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];

/** 값 → 배경색 (0=투명, max=보라 최대 농도) */
export function heatmapCellColor(value: number, max: number): string {
  if (!value || max <= 0) return 'rgba(255,255,255,0.02)';
  const t = Math.min(1, value / max);
  const alpha = 0.12 + t * 0.83;
  return `rgba(94,106,210,${alpha.toFixed(2)})`;
}

/** 행 단위 메모 — 같은 지표로 되돌아오면(동일 배열 identity) 행 재렌더 생략 */
const HeatmapRow = memo(function HeatmapRow({
  day,
  w,
  row,
  max,
}: {
  day: string;
  w: number;
  row: number[];
  max: number;
}) {
  return (
    <div className="grid gap-[2px] mb-[2px]" style={{ gridTemplateColumns: '28px repeat(24, 1fr)' }}>
      <div className="text-[10px] text-[#8A8F98] flex items-center">{day}</div>
      {Array.from({ length: 24 }, (_, h) => (
        <div
          key={h}
          data-w={w}
          data-h={h}
          className="h-5 rounded-[3px] cursor-default hover:ring-1 hover:ring-[#7070FF]"
          style={{ background: heatmapCellColor(row[h] ?? 0, max) }}
        />
      ))}
    </div>
  );
});

interface HeatmapGridProps {
  /** 7(월~일) × 24시간 매트릭스 */
  matrix: number[][];
  max: number;
  /** 툴팁 값 표기 (텍스트만 — HTML 금지) */
  formatValue: (v: number) => string;
}

/**
 * 요일×24시간 히트맵 그리드.
 * 호버 툴팁은 React state 대신 DOM 직접 갱신 — 셀 168개 리렌더로 인한 랙 방지.
 */
export const HeatmapGrid = memo(function HeatmapGrid({ matrix, max, formatValue }: HeatmapGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const tipValueRef = useRef<HTMLElement>(null);
  const tipLabelRef = useRef<HTMLElement>(null);

  const handleOver = useCallback(
    (e: React.MouseEvent) => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-w]');
      const tip = tipRef.current;
      const grid = gridRef.current;
      if (!cell || !tip || !grid || !tipLabelRef.current || !tipValueRef.current) return;
      const w = Number(cell.dataset.w);
      const h = Number(cell.dataset.h);
      if (!matrix[w]) return;
      tipLabelRef.current.textContent = `${WEEKDAYS[w]}요일 ${h}시 · `;
      tipValueRef.current.textContent = formatValue(matrix[w][h] ?? 0);
      const g = grid.getBoundingClientRect();
      const c = cell.getBoundingClientRect();
      const y = c.top - g.top;
      tip.style.left = `${c.left - g.left + c.width / 2}px`;
      if (y < 30) {
        tip.style.top = `${y + 24}px`;
        tip.style.transform = 'translateX(-50%)';
      } else {
        tip.style.top = `${y - 4}px`;
        tip.style.transform = 'translate(-50%, -100%)';
      }
      tip.style.opacity = '1';
    },
    [matrix, formatValue],
  );

  const handleLeave = useCallback(() => {
    if (tipRef.current) tipRef.current.style.opacity = '0';
  }, []);

  return (
    <div className="overflow-x-auto">
      <div
        ref={gridRef}
        className="min-w-[640px] relative"
        onMouseOver={handleOver}
        onMouseLeave={handleLeave}
      >
        <div
          ref={tipRef}
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md border border-[#2E3035] bg-[#1C1D21] px-2 py-1 text-[10px] text-[#D0D6E0] shadow-lg"
          style={{ opacity: 0 }}
        >
          <span ref={tipLabelRef} />
          <b ref={tipValueRef} className="text-white" />
        </div>
        <div className="grid mb-1" style={{ gridTemplateColumns: '28px repeat(24, 1fr)' }}>
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="text-center text-[9px] text-[#62666D]">
              {h % 3 === 0 ? h : ''}
            </div>
          ))}
        </div>
        {WEEKDAYS.map((day, w) => (
          <HeatmapRow key={day} day={day} w={w} row={matrix[w] ?? []} max={max} />
        ))}
      </div>
    </div>
  );
});
