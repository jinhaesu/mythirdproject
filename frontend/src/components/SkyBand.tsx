'use client';
import { useEffect, useRef, type ReactNode } from 'react';

// 밤하늘 머리띠 — 정본은 nuldam-design-system/cosmos/SkyBand.tsx. 각 저장소에 그대로 복사한다.
// 의존 라이브러리 없음(React 18·19 공통). nd-cosmos.css 의 .nd-sky / .nd-limb 가 필요하다.
// 한 시스템에 한 군데(첫 화면 머리)만 쓴다. 표·입력 화면 위에는 쓰지 않는다.

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** 별: 씨앗이 고정이라 늘 같은 하늘. 아주 느리게 흐르고, 화면 밖이거나 탭이 숨겨지면 멈춘다. */
export function Starfield({ count = 70, seed = 11 }: { count?: number; seed?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const rnd = seeded(seed);
    const stars = Array.from({ length: count }, () => {
      const d = rnd();
      return { x: rnd(), y: rnd(), s: 0.3 + d, a: 0.18 + d * 0.7, p: rnd() * 6.28, v: 0.2 + rnd() * 0.8 };
    });
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let visible = true;
    const draw = (t: number) => {
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#eef0f5';
      for (const s of stars) {
        ctx.globalAlpha = s.a * (0.78 + 0.22 * Math.sin(t * 0.0007 * s.v + s.p));
        ctx.beginPath();
        ctx.arc(((s.x + t * 0.0000018 * s.v) % 1) * w, s.y * h, s.s, 0, 6.2832);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    const loop = (t: number) => {
      draw(t);
      if (visible && !reduce && !document.hidden) raf = requestAnimationFrame(loop);
      else raf = 0;
    };
    const start = () => {
      if (!raf) raf = requestAnimationFrame(loop);
    };
    draw(0);
    const io = new IntersectionObserver((es) => {
      visible = es[0]?.isIntersecting ?? true;
      if (visible) start();
    });
    io.observe(cv);
    const onVis = () => {
      if (!document.hidden) start();
    };
    const onResize = () => draw(performance.now());
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('resize', onResize);
    if (!reduce) start();
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('resize', onResize);
    };
  }, [count, seed]);
  return <canvas ref={ref} className="nd-stars" aria-hidden="true" />;
}

/** 궤도선: 타원 위의 점 하나로 진도(0~1)를 알린다. 예) 이달 9/30일 → value={9/30} */
export function OrbitDial({ value, label, sub }: { value: number; label?: string; sub?: string }) {
  const v = Math.max(0, Math.min(1, value));
  const pt = (f: number) => {
    const a = -Math.PI / 2 + f * 2 * Math.PI;
    return [66 + 60 * Math.cos(a), 30 + 24 * Math.sin(a)] as const;
  };
  let arc = '';
  for (let i = 0; i <= 24; i++) {
    const [x, y] = pt((v * i) / 24);
    arc += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  const [dx, dy] = pt(v);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, color: 'var(--nd-sky-fg-2)' }}>
      <svg width="132" height="60" viewBox="0 0 132 60" style={{ overflow: 'visible', flex: 'none' }} role="img" aria-label={`${label ?? ''} ${sub ?? ''}`.trim() || '진도'}>
        <ellipse cx="66" cy="30" rx="60" ry="24" fill="none" stroke="rgba(238,240,245,.2)" strokeWidth="1" />
        <path d={arc} fill="none" stroke="#8fb2ff" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="66" cy="30" r="5" fill="#d8c9a8" opacity=".9" />
        <circle cx={dx} cy={dy} r="5" fill="#eef0f5" />
      </svg>
      {(label || sub) && (
        <div>
          {label && <div style={{ color: 'var(--nd-sky-fg)', fontVariantNumeric: 'tabular-nums' }}>{label}</div>}
          {sub && <div style={{ fontVariantNumeric: 'tabular-nums' }}>{sub}</div>}
        </div>
      )}
    </div>
  );
}

/** 이달 며칠째인지(한국 시간)로 궤도 값을 만든다 */
export function monthProgress(now = new Date()) {
  const k = new Date(now.getTime() + 9 * 3600e3);
  const day = k.getUTCDate();
  const days = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth() + 1, 0)).getUTCDate();
  return { day, days, value: day / days, month: k.getUTCMonth() + 1, year: k.getUTCFullYear() };
}

/**
 * 시스템 첫 화면의 머리띠. title 은 화면 이름이나 기간("2026년 11월"), meta 는 그 위의 작은 설명.
 * right 를 주지 않으면 이달 진도 궤도가 들어간다.
 */
export default function SkyBand({
  title,
  meta,
  right,
  children,
  stars = 70,
  className = '',
}: {
  title: ReactNode;
  meta?: ReactNode;
  right?: ReactNode | null;
  children?: ReactNode;
  stars?: number;
  className?: string;
}) {
  const m = monthProgress();
  return (
    <section
      className={`nd-sky ${className}`}
      style={{ borderRadius: 'var(--nd-r-card)', border: '1px solid var(--nd-sky-line)', padding: '20px 24px', minHeight: 124, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 12 }}
    >
      <Starfield count={stars} />
      <div className="nd-limb" aria-hidden="true" />
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          {meta && <div style={{ fontSize: 12, color: 'var(--nd-sky-fg-3)', marginBottom: 4 }}>{meta}</div>}
          <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2, fontWeight: 300, letterSpacing: '-0.01em', color: 'var(--nd-sky-fg)' }}>{title}</h1>
        </div>
        {right === undefined ? <OrbitDial value={m.value} label={`${m.month}월 ${m.day}일`} sub={`이달 ${m.day}/${m.days}일 경과`} /> : right}
      </div>
      {children}
    </section>
  );
}
