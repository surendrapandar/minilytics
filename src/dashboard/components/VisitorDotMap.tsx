import { useMemo } from 'react';
import { DotMap, type DotMapMarker } from '@/components/dithercn/dot-map';
import { qs, type GeoPoint } from '../lib/api';
import { useDash } from '../lib/context';
import { countryName, fmtNumber } from '../lib/format';
import { useApi } from '../lib/useApi';
import { DitherBar } from './DitherBar';
import { Flag } from './Icons';

/** Markers past this many crowd the map without telling you more. */
const MAX_MARKERS = 60;
const LABELLED = 4;

/** Where visitors were in the period, as a dithered dot map with the top cities underneath. */
export function VisitorDotMap({ sort }: { sort: 'visitors' | 'revenue' }) {
  const { site, q, reloadKey, addFilter, money } = useDash();
  const { data, loading, error } = useApi<GeoPoint[]>(`/api/sites/${site.id}/geo?${qs(q)}`, reloadKey);

  const ranked = useMemo(
    () => [...(data ?? [])].sort((a, b) => (sort === 'revenue' ? b.revenue - a.revenue : 0) || b.visitors - a.visitors),
    [data, sort],
  );
  // Memoised: the map rebuilds its dot layers whenever the markers change.
  const markers = useMemo<DotMapMarker[]>(
    () =>
      ranked.slice(0, MAX_MARKERS).map((p, i) => ({
        at: [p.lat, p.lon],
        color: p.revenue > 0 ? 'orange' : 'blue',
        label: i < LABELLED ? `${p.city ?? countryName(p.country)} · ${sort === 'revenue' && p.revenue ? money(p.revenue, true) : fmtNumber(p.visitors)}` : undefined,
      })),
    [ranked, sort, money],
  );
  const max = Math.max(1, ...ranked.map((p) => (sort === 'revenue' ? p.revenue : p.visitors)));

  return (
    <div className={loading && !data ? 'animate-pulse' : ''}>
      <DotMap markers={markers} color="grey" accent="blue" columns={150} halo={10} title="Visitors by city" className="px-1 pt-2" />
      <div className="mt-2 flex items-center gap-4 px-1 font-mono text-[10px] uppercase tracking-[0.08em] text-stone-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 bg-visitors" /> Visitors
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 bg-revenue" /> Paying
        </span>
      </div>
      {error && <p className="p-3 text-sm text-red-600">{error}</p>}
      {data && data.length === 0 && <p className="p-6 text-center text-sm text-stone-400">No visitor locations for this period</p>}
      <div className="mt-3 space-y-1">
        {ranked.slice(0, 5).map((p) => {
          const value = sort === 'revenue' ? p.revenue : p.visitors;
          return (
            <button
              key={`${p.country}|${p.city}`}
              className="group relative flex h-9 w-full items-center rounded-md text-left"
              onClick={() => (p.city ? addFilter('city', p.city) : p.country && addFilter('country', p.country))}
              title="Click to filter"
            >
              <div className="absolute inset-0 flex">
                <DitherBar width={`${Math.max(2, (Math.max(0, value) / max) * 100)}%`} color={p.revenue > 0 ? 'orange' : 'blue'} />
              </div>
              <div className="absolute inset-0 hidden rounded-md ring-1 ring-stone-300/70 group-hover:block" />
              <span className="relative flex min-w-0 flex-1 items-center gap-2.5 px-3 text-[15px]">
                <Flag cc={p.country} />
                <span className="truncate">{p.city ?? countryName(p.country)}</span>
              </span>
              <span className="relative pr-3 text-[15px] font-medium">{sort === 'revenue' ? money(p.revenue, true) : fmtNumber(p.visitors)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
