import { useEffect, useState } from 'react';
import { api } from './api';

/** Fetch `url` whenever it changes (or `reloadKey` bumps). `null` skips fetching. */
export function useApi<T>(url: string | null, reloadKey = 0) {
  const [data, setData] = useState<T | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!url) return;
    let alive = true;
    setLoading(true);
    setError(null);
    api<T>(url)
      .then((d) => { if (alive) { setData(d); setLoadedUrl(url); } })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [url, reloadKey]);

  return { data, error, loading, loadedUrl, setData };
}
