import { useCallback, useState } from 'react';

/** Per-browser dashboard preferences. Storage can throw (private mode, blocked site data), so every access is guarded. */
export function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/** useState that remembers its value across visits. */
export function usePref<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => loadPref(key, fallback));
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const v = typeof next === 'function' ? (next as (prev: T) => T)(prev) : next;
        savePref(key, v);
        return v;
      });
    },
    [key],
  );
  return [value, set] as const;
}
