import { useCallback, useEffect, useState } from 'react';
import type { Filters, Query } from './api';

/** Period, granularity and filters live in the URL so a refresh or shared link keeps them. */
function read(defaultPeriod: string): Query {
  const p = new URLSearchParams(window.location.search);
  let filters: Filters = {};
  try {
    filters = JSON.parse(p.get('filters') || '{}');
  } catch {}
  return {
    period: p.get('period') || defaultPeriod,
    from: p.get('from') || undefined,
    to: p.get('to') || undefined,
    granularity: p.get('granularity') || undefined,
    filters,
  };
}

export function useQueryState(defaultPeriod = '30d') {
  const [q, setQ] = useState<Query>(() => read(defaultPeriod));

  useEffect(() => {
    const on = () => setQ(read(defaultPeriod));
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, [defaultPeriod]);

  const update = useCallback((patch: Partial<Query>) => {
    setQ((prev) => {
      const next = { ...prev, ...patch };
      if (patch.period && patch.period !== 'custom') {
        next.from = undefined;
        next.to = undefined;
      }
      const p = new URLSearchParams();
      p.set('period', next.period);
      if (next.from) p.set('from', next.from);
      if (next.to) p.set('to', next.to);
      if (next.granularity) p.set('granularity', next.granularity);
      if (Object.keys(next.filters).length) p.set('filters', JSON.stringify(next.filters));
      window.history.replaceState(null, '', `${window.location.pathname}?${p}`);
      return next;
    });
  }, []);

  return [q, update] as const;
}
