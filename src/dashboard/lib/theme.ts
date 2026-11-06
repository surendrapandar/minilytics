import { useEffect, useState } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';

const KEY = 'ml_theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function resolve(pref: ThemePref): 'light' | 'dark' {
  return pref === 'system' ? (media().matches ? 'dark' : 'light') : pref;
}

/** Same logic as the inline script in index.html, which runs before paint to avoid a flash. */
function apply(pref: ThemePref) {
  document.documentElement.classList.toggle('dark', resolve(pref) === 'dark');
}

/** Light / dark / system preference, persisted per browser. Returns the resolved theme too. */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(readPref);
  const [resolved, setResolved] = useState(() => resolve(pref));

  useEffect(() => {
    apply(pref);
    setResolved(resolve(pref));
    if (pref !== 'system') return;
    const m = media();
    const on = () => {
      apply('system');
      setResolved(resolve('system'));
    };
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [pref]);

  // Keep several toggles on the page (and other tabs) in sync.
  useEffect(() => {
    const on = () => setPref(readPref());
    window.addEventListener('ml:theme', on);
    window.addEventListener('storage', on);
    return () => {
      window.removeEventListener('ml:theme', on);
      window.removeEventListener('storage', on);
    };
  }, []);

  const set = (next: ThemePref) => {
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {}
    setPref(next);
    window.dispatchEvent(new Event('ml:theme'));
  };

  return { pref, resolved, set };
}

/** Current resolved theme without subscribing; for one-off defaults. */
export function currentTheme(): 'light' | 'dark' {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}
