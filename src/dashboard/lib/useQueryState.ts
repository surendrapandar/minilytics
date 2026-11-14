import { useCallback, useEffect, useState } from 'react';
import type { Filters, Query } from './api';
import { loadPref, savePref } from './prefs';

const DEFAULT: Query = { period: '30d', filters: {} };
const storeKey = (siteId: string) => `ml_query_${siteId}`;

/** Period, granularity and filters live in the URL so a refresh or shared link keeps them. */
function fromUrl(): Query | null {
  const p = new URLSearchParams(window.location.search);
  if (!p.has('period') && !p.has('filters') && !p.has('granularity')) return null;
  let filters: Filters = {};
  try {
    filters = JSON.parse(p.get('filters') || '{}');
  } catch {}
  return {
    period: p.get('period') || '30d',
    from: p.get('from') || undefined,
    to: p.get('to') || undefined,
    granularity: p.get('granularity') || undefined,
    filters,
  };
}

/** No view in the URL means a fresh visit: fall back to the last view used on this site. */
function read(siteId: string): Query {
  const saved = loadPref<Query>(storeKey(siteId), DEFAULT);
  return fromUrl() ?? { ...DEFAULT, ...saved, filters: saved.filters ?? {} };
}

function writeUrl(q: Query) {
  const p = new URLSearchParams(window.location.search);
  for (const k of ['period', 'from', 'to', 'granularity', 'filters']) p.delete(k);
  p.set('period', q.period);
  if (q.from) p.set('from', q.from);
  if (q.to) p.set('to', q.to);
  if (q.granularity) p.set('granularity', q.granularity);
  if (Object.keys(q.filters).length) p.set('filters', JSON.stringify(q.filters));
  window.history.replaceState(window.history.state, '', `${window.location.pathname}?${p}`);
}

export function useQueryState(siteId: string) {
  const [q, setQ] = useState<Query>(() => read(siteId));

  // Reflect a restored view in the URL so it can be refreshed or shared.
  useEffect(() => writeUrl(q), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const on = () => setQ(read(siteId));
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, [siteId]);

  const update = useCallback(
    (patch: Partial<Query>) => {
      setQ((prev) => {
        const next = { ...prev, ...patch };
        if (patch.period && patch.period !== 'custom') {
          next.from = undefined;
          next.to = undefined;
        }
        writeUrl(next);
        savePref(storeKey(siteId), next);
        return next;
      });
    },
    [siteId],
  );

  return [q, update] as const;
}
