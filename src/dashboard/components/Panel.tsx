import { useMemo, useState, type ReactNode } from 'react';
import { usePref } from '../lib/prefs';
import { qs, type BreakdownRow } from '../lib/api';
import { useDash } from '../lib/context';
import { countryName, fmtNumber, fmtPct } from '../lib/format';
import { useApi } from '../lib/useApi';
import { BrowserIcon, ChannelIcon, DeviceIcon, Favicon, Flag, OSIcon, SourceIcon } from './Icons';
import { Modal } from './Modal';

export interface TabDef {
  label: string;
  dim: string;
  /** Session filter applied when a row is clicked (omit for non-filterable tabs). */
  filter?: string;
}

/** How each dimension's label and icon are shown. */
export function renderLabel(dim: string, row: Pick<BreakdownRow, 'label' | 'extra'>): ReactNode {
  const l = row.label;
  const text = (s: ReactNode) => <span className="truncate">{s}</span>;
  switch (dim) {
    case 'channel':
      return (
        <>
          <ChannelIcon channel={l} />
          {text(l)}
        </>
      );
    case 'source':
      return (
        <>
          <SourceIcon source={l} domain={row.extra} />
          {text(l ?? 'Direct/None')}
        </>
      );
    case 'country':
      return (
        <>
          <Flag cc={l} />
          {text(countryName(l))}
        </>
      );
    case 'region':
    case 'city':
      return (
        <>
          <Flag cc={row.extra ?? null} />
          {text(l ?? 'Unknown')}
        </>
      );
    case 'browser':
      return (
        <>
          <BrowserIcon name={l} />
          {text(l)}
        </>
      );
    case 'os':
      return (
        <>
          <OSIcon name={l} />
          {text(l)}
        </>
      );
    case 'device':
      return (
        <>
          <DeviceIcon name={l} />
          {text(l)}
        </>
      );
    case 'hostname':
      return (
        <>
          <Favicon domain={l} />
          {text(l)}
        </>
      );
    case 'exit_link': {
      let host: string | null = null;
      try {
        host = l ? new URL(l).hostname : null;
      } catch {}
      return (
        <>
          <Favicon domain={host} />
          {text(l?.replace(/^https?:\/\/(www\.)?/, ''))}
        </>
      );
    }
    default:
      return text(l ?? <span className="text-stone-400">(none)</span>);
  }
}

function Bars({ rows, dim, tab, sort, limit, onPick }: { rows: BreakdownRow[]; dim: string; tab: TabDef; sort: 'visitors' | 'revenue'; limit?: number; onPick?: (r: BreakdownRow) => void }) {
  const { money } = useDash();
  const sorted = useMemo(() => [...rows].sort((a, b) => (b[sort] ?? 0) - (a[sort] ?? 0) || b.visitors - a.visitors), [rows, sort]);
  const shown = limit ? sorted.slice(0, limit) : sorted;
  const maxV = Math.max(1, ...rows.map((r) => r.visitors));
  const maxR = Math.max(1, ...rows.map((r) => r.revenue));
  const hasRevenue = rows.some((r) => r.revenue > 0);

  return (
    <div className="space-y-1">
      {shown.map((r, i) => {
        const vw = (r.visitors / maxV) * (hasRevenue ? 62 : 100);
        const rw = hasRevenue ? (Math.max(0, r.revenue) / maxR) * 38 : 0;
        return (
          <div
            key={`${r.label}-${i}`}
            className={`group relative flex h-10 items-center rounded-lg ${tab.filter ? 'cursor-pointer' : ''}`}
            onClick={() => onPick?.(r)}
          >
            <div className="absolute inset-0 flex">
              <div className="rounded-l-lg bg-visitorsSoft transition-all" style={{ width: `${vw}%`, minWidth: r.visitors ? 4 : 0 }} />
              {rw > 0 && <div className="rounded-r-lg bg-revenueSoft" style={{ width: `${rw}%` }} />}
            </div>
            <div className="absolute inset-0 hidden rounded-lg ring-1 ring-stone-300/70 group-hover:block" />
            <div className="relative flex min-w-0 flex-1 items-center gap-2.5 px-3 text-[15px]">{renderLabel(dim, r)}</div>
            <div className="relative flex shrink-0 items-center gap-3 pr-3 text-[15px] font-medium">
              {r.revenue !== 0 && <span className="hidden text-sm font-normal text-revenue group-hover:inline">{money(r.revenue)}</span>}
              {sort === 'revenue' ? money(r.revenue, true) : fmtNumber(r.visitors)}
            </div>
            <div className="pointer-events-none absolute left-1/2 top-full z-30 mt-1 hidden w-60 -translate-x-1/2 rounded-xl bg-ink px-3 py-2 text-xs text-white shadow-lg group-hover:block">
              <div className="mb-1 truncate font-medium">{r.label ?? '(none)'}</div>
              <div className="flex justify-between"><span className="text-stone-400">Visitors</span>{fmtNumber(r.visitors)}</div>
              {r.pageviews !== undefined && dim === 'page' && <div className="flex justify-between"><span className="text-stone-400">Pageviews</span>{fmtNumber(r.pageviews)}</div>}
              <div className="flex justify-between"><span className="text-stone-400">Revenue</span>{money(r.revenue)}</div>
              <div className="flex justify-between"><span className="text-stone-400">Customers</span>{r.customers}</div>
              <div className="flex justify-between"><span className="text-stone-400">Conversion</span>{r.visitors ? fmtPct(r.customers / r.visitors, 1) : '—'}</div>
              {tab.filter && <div className="mt-1 text-stone-400">Click to filter</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Panel({ tabs }: { tabs: TabDef[] }) {
  const { site, q, reloadKey, addFilter, money } = useDash();
  const [saved, setActive] = usePref(`ml_tab_${tabs[0].dim}`, tabs[0].dim);
  const active = tabs.some((t) => t.dim === saved) ? saved : tabs[0].dim;
  const [sort, setSort] = usePref<'visitors' | 'revenue'>(`ml_sort_${tabs[0].dim}`, 'visitors');
  const [details, setDetails] = useState(false);
  const [search, setSearch] = useState('');
  const tab = tabs.find((t) => t.dim === active)!;
  const { data, loading, error } = useApi<BreakdownRow[]>(`/api/sites/${site.id}/breakdown?${qs(q, { dim: active })}`, reloadKey);

  const pick = (r: BreakdownRow) => {
    if (!tab.filter) return;
    setDetails(false);
    addFilter(tab.filter, r.label ?? '');
  };

  const filtered = (data ?? []).filter((r) => !search || (r.label ?? '').toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="card flex min-h-[560px] flex-col p-3">
      <div className="flex items-center justify-between gap-2 pb-3">
        <div className="tabs overflow-x-auto">
          {tabs.map((t) => (
            <button key={t.dim} className={`tab whitespace-nowrap ${t.dim === active ? 'tab-active' : ''}`} onClick={() => setActive(t.dim)}>
              {t.label}
            </button>
          ))}
        </div>
        <button
          className="flex shrink-0 items-center gap-1 px-2 text-sm font-medium text-stone-600 hover:text-ink"
          onClick={() => setSort((s) => (s === 'visitors' ? 'revenue' : 'visitors'))}
          title="Sort by visitors or revenue"
        >
          {sort === 'visitors' ? 'Visitors' : 'Revenue'} <span className="text-stone-400">↑↓</span>
        </button>
      </div>
      <div className={`flex-1 ${loading && !data ? 'animate-pulse' : ''}`}>
        {error && <p className="p-3 text-sm text-red-600">{error}</p>}
        {data && data.length === 0 && <p className="p-6 text-center text-sm text-stone-400">No data for this period</p>}
        {data && <Bars rows={data} dim={active} tab={tab} sort={sort} limit={10} onPick={pick} />}
      </div>
      {data && data.length > 10 && (
        <button className="mx-auto mt-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-stone-500 hover:text-ink" onClick={() => setDetails(true)}>
          ⛶ Details
        </button>
      )}
      <Modal open={details} onClose={() => setDetails(false)} title={tab.label} width="max-w-3xl">
        <input className="input mb-4" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-stone-500">
                <th className="pb-2 font-medium">{tab.label}</th>
                <th className="pb-2 text-right font-medium">Visitors</th>
                <th className="pb-2 text-right font-medium">Revenue</th>
                <th className="pb-2 text-right font-medium">Conv.</th>
                <th className="pb-2 text-right font-medium">Rev/visitor</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i} className={`border-t border-stone-100 ${tab.filter ? 'cursor-pointer hover:bg-stone-50' : ''}`} onClick={() => pick(r)}>
                  <td className="max-w-[320px] py-2"><div className="flex min-w-0 items-center gap-2">{renderLabel(active, r)}</div></td>
                  <td className="py-2 text-right">{fmtNumber(r.visitors)}</td>
                  <td className="py-2 text-right">{money(r.revenue)}</td>
                  <td className="py-2 text-right">{r.visitors ? fmtPct(r.customers / r.visitors, 1) : '—'}</td>
                  <td className="py-2 text-right">{r.visitors ? money(r.revenue / r.visitors) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
    </div>
  );
}
