'use client';
import { useEffect, useState } from 'react';

// 전 시스템 공용 상단 바 — 정본은 nuldam-design-system/cosmos/NuldamSystemBar.tsx.
// 각 저장소에는 이 파일을 그대로 복사한다(여기서만 고치고 다시 복사).
// 허브 /me 로 접근 가능한 시스템을 받아, 권한 없는 시스템은 흐리게 잠금 표시한다.
// 색은 일부러 고정값: 어느 시스템·어느 테마에서도 같은 밤하늘 띠로 보여야 한다.
const SYS = [
  { key: 'hub', label: '널담', url: 'https://auth.nuldam.com' },
  { key: 'plan', label: '보고·계획', url: 'https://plan.nuldam.com' },
  { key: 'scm', label: '매출·SCM', url: 'https://scm.nuldam.com' },
  { key: 'account', label: '회계', url: 'https://account.nuldam.com' },
  { key: 'marketing', label: '마케팅', url: 'https://marketing.nuldam.com' },
  { key: 'mes', label: 'MES', url: 'https://mes.nuldam.com' },
  { key: 'hr', label: 'HR', url: 'https://hr.nuldam.com' },
  { key: 'aisystem', label: '근태·급여', url: 'https://aisystem.nuldam.com' },
  { key: 'pmanage', label: '제품 출시', url: 'https://pmanage.nuldam.com' },
  { key: 'cx', label: 'CX', url: 'https://cx.nuldam.com' },
  { key: 'cafe', label: '카페', url: 'https://cafe.nuldam.com' },
  { key: 'report', label: '경영 리포트', url: 'https://ceoreport.nuldam.com' },
];

const CSS = `
.ndbar{position:sticky;top:0;z-index:9999;display:flex;align-items:center;gap:2px;height:40px;padding:0 12px;
  background:#05060b;border-bottom:1px solid rgba(238,240,245,.1);overflow-x:auto;white-space:nowrap;
  font-size:13px;line-height:1;scrollbar-width:none;-webkit-font-smoothing:antialiased}
.ndbar::-webkit-scrollbar{display:none}
.ndbar a,.ndbar button{flex-shrink:0;display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:8px;
  border:0;background:transparent;font:inherit;font-weight:400;color:#a3a9b8;text-decoration:none;cursor:pointer;
  transition:color .15s cubic-bezier(.22,1,.36,1),background-color .15s cubic-bezier(.22,1,.36,1)}
.ndbar a:hover{color:#eef0f5;background:rgba(238,240,245,.07)}
.ndbar a:focus-visible,.ndbar button:focus-visible{outline:2px solid #8fb2ff;outline-offset:1px}
.ndbar .ndbar-home{color:#eef0f5;font-weight:500;margin-right:8px;padding-left:6px}
.ndbar .ndbar-mark{width:18px;height:18px;border-radius:5px;background:#eef0f5;color:#05060b;display:grid;place-items:center;font-size:11px;font-weight:600}
.ndbar .ndbar-on{color:#eef0f5;font-weight:500;background:rgba(238,240,245,.1);box-shadow:inset 0 0 0 1px rgba(238,240,245,.1)}
.ndbar .ndbar-dot{width:5px;height:5px;border-radius:50%;background:#8fb2ff}
.ndbar .ndbar-lock{color:#596074;cursor:not-allowed}
.ndbar .ndbar-msg{margin-left:8px;color:#a3a9b8;font-size:12px}
@media (prefers-reduced-motion:reduce){.ndbar a,.ndbar button{transition:none}}
`;

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export default function NuldamSystemBar({ current }: { current: string }) {
  const [allowed, setAllowed] = useState<Set<string> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('https://auth-api.nuldam.com/me', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d || !Array.isArray(d.systems)) return;
        setAllowed(new Set(d.systems.map((s: { app_key: string }) => s.app_key)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3200);
    return () => clearTimeout(t);
  }, [msg]);

  return (
    <nav className="ndbar" aria-label="널담 시스템">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {SYS.map((s) => {
        const isHub = s.key === 'hub';
        const active = s.key === current;
        const accessible = isHub || active || allowed === null || allowed.has(s.key);
        if (isHub) {
          return (
            <a key={s.key} href={s.url} className="ndbar-home">
              <span className="ndbar-mark">N</span>
              {s.label}
            </a>
          );
        }
        if (accessible) {
          return (
            <a key={s.key} href={s.url} className={active ? 'ndbar-on' : undefined} aria-current={active ? 'page' : undefined}>
              {active && <span className="ndbar-dot" />}
              {s.label}
            </a>
          );
        }
        return (
          <button
            key={s.key}
            type="button"
            className="ndbar-lock"
            title="접근 권한 없음"
            onClick={() => setMsg(`${s.label}: 접근 권한이 없습니다. 관리자에게 문의하세요.`)}
          >
            {s.label}
            <LockIcon />
          </button>
        );
      })}
      {msg && (
        <span className="ndbar-msg" role="status">
          {msg}
        </span>
      )}
    </nav>
  );
}
