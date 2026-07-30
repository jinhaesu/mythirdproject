'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

type Theme = 'dark' | 'light';

const STORAGE_KEY = 'theme';

function readStoredTheme(): Theme {
  if (typeof document === 'undefined') return 'dark';
  const attr = document.documentElement.dataset.theme;
  return attr === 'light' ? 'light' : 'dark';
}

/**
 * Persistent light/dark theme toggle.
 *
 * Theme state lives on `<html data-theme="dark|light">`, set synchronously before
 * hydration by the inline script in `src/app/layout.tsx` (reads `localStorage.theme`,
 * defaults to dark) to avoid a flash of the wrong theme. This component only flips
 * the attribute + persists the choice; it does not own the source of truth on first
 * paint.
 */
export function ThemeToggle() {
  // Mirrors document.documentElement.dataset.theme. Starts 'dark' (SSR-safe default,
  // matches the product default) and syncs from the DOM after mount.
  const [theme, setTheme] = useState<Theme>('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(readStoredTheme());
    setMounted(true);
  }, []);

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage unavailable (private mode, etc.) — theme still applies for this session
    }
  };

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={mounted && theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
      title={mounted && theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
      className="flex items-center justify-center w-8 h-8 rounded-lg text-text-tertiary hover:text-text-primary transition-colors"
      style={{ backgroundColor: 'transparent' }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgb(var(--color-overlay-rgb) / 0.07)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; }}
    >
      {/* Render nothing theme-specific until mounted to avoid hydration mismatch;
          the button is still interactive immediately (falls back to dark icon). */}
      {mounted && theme === 'light' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
