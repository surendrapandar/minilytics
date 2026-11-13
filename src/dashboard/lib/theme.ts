import { useSyncExternalStore } from 'react';
import { loadPref, savePref } from './prefs';

export type Theme = 'light' | 'dark';

// Until someone picks a theme, the dashboard follows the system setting (and changes with it).
const media = window.matchMedia('(prefers-color-scheme: dark)');
let chosen = loadPref<Theme | null>('ml_theme', null);
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
media.addEventListener('change', emit);

const current = (): Theme => chosen ?? (media.matches ? 'dark' : 'light');

export function setTheme(theme: Theme) {
  chosen = theme;
  savePref('ml_theme', theme);
  emit();
}

/** The dashboard theme, shared by every component that reads it. */
export function useTheme(): Theme {
  return useSyncExternalStore((l) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, current);
}
