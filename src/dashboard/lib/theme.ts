import { useLayoutEffect, useSyncExternalStore } from 'react';

export type Theme = 'system' | 'light' | 'dark';

const KEY = 'ml_theme';
/** Set once the app (not the marketing pages) has been shown, so index.html can apply the theme before first paint. */
const APP_KEY = 'ml_app';
const THEME_COLORS = { light: '#f8f6f3', dark: '#0f0e0d' };

const listeners = new Set<() => void>();
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

function stored(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}
let current = stored();

export function setTheme(theme: Theme) {
  current = theme;
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {}
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const mq = media();
  mq.addEventListener('change', listener);
  return () => {
    listeners.delete(listener);
    mq.removeEventListener('change', listener);
  };
}
const snapshot = () => `${current}:${media().matches ? 'dark' : 'light'}`;

/** The chosen theme, and whether it currently resolves to dark. Shared by every caller. */
export function useTheme() {
  const [theme, system] = useSyncExternalStore(subscribe, snapshot).split(':');
  return { theme: theme as Theme, dark: theme === 'dark' || (theme === 'system' && system === 'dark') };
}

/** Puts the theme on <html>. `false` keeps a page light (marketing); `null` leaves it as it is (still loading). */
export function useApplyTheme(enabled: boolean | null) {
  const { dark } = useTheme();
  useLayoutEffect(() => {
    if (enabled === null) return;
    const on = enabled && dark;
    document.documentElement.classList.toggle('dark', on);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[on ? 'dark' : 'light']);
    if (enabled) {
      try {
        localStorage.setItem(APP_KEY, '1');
      } catch {}
    }
  }, [enabled, dark]);
}
