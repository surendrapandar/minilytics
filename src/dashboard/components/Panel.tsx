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
            className={`group relative flex h-9 items-center rounded-lg transition-colors ${tab.filter ? 'cursor-pointer' : ''}`}
            onClick={() => onPick?.(r)}
          >
            <div className="absolute inset-0 flex">
              <div className="rounded-l-lg bg-indigo-50/70 transition-all group-hover:bg-indigo-100/70" style={{ width: `${vw}%`, minWidth: r.visitors ? 4 : 0 }} />
              {rw > 0 && <div className="rounded-r-lg bg-emerald-50 transition-all group-hover:bg-emerald-100/70" style={{ width: `${rw}%` }} />}
            </div>
            <div className="absolute inset-0 hidden rounded-lg ring-1 ring-zinc-300/80 group-hover:block" />
            <div className="relative flex min-w-0 flex-1 items-center gap-2.5 px-3 text-xs font-medium text-zinc-800">{renderLabel(dim, r)}</div>
            <div className="relative flex shrink-0 items-center gap-3 pr-3 text-xs font-semibold text-zinc-900">
              {r.revenue !== 0 && <span className="hidden text-xs font-medium text-emerald-600 group-hover:inline">{money(r.revenue)}</span>}
              {sort === 'revenue' ? money(r.revenue, true) : fmtNumber(r.visitors)}
            </div>
            <div className="pointer-events-none absolute left-1/2 top-full z-30 mt-1 hidden w-60 -translate-x-1/2 rounded-lg bg-zinc-950 px-3 py-2 text-xs text-white shadow-xl group-hover:block border border-zinc-800">
              <div className="mb-1 truncate font-medium text-zinc-100">{r.label ?? '(none)'}</div>
              <div className="flex justify-between"><span className="text-zinc-400">Visitors</span>{fmtNumber(r.visitors)}</div>
              {r.pageviews !== undefined && dim === 'page' && <div className="flex justify-between"><span className="text-zinc-400">Pageviews</span>{fmtNumber(r.pageviews)}</div>}
              <div className="flex justify-between"><span className="text-zinc-400">Revenue</span>{money(r.revenue)}</div>
              <div className="flex justify-between"><span className="text-zinc-400">Customers</span>{r.customers}</div>
              <div className="flex justify-between"><span className="text-zinc-400">Conversion</span>{r.visitors ? fmtPct(r.customers / r.visitors, 1) : '—'}</div>
              {tab.filter && <div className="mt-1 text-zinc-400 text-[10px]">Click to filter</div>}
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
    <div className="card flex min-h-[540px] flex-col p-4 border border-zinc-200/80 shadow-sm">
      <div className="flex items-center justify-between gap-2 pb-3">
        <div className="tabs overflow-x-auto">
          {tabs.map((t) => (
            <button key={t.dim} className={`tab whitespace-nowrap ${t.dim === active ? 'tab-active' : ''}`} onClick={() => setActive(t.dim)}>
              {t.label}
            </button>
          ))}
        </div>
        <button
          className="flex shrink-0 items-center gap-1.5 px-2 text-xs font-semibold text-zinc-600 hover:text-zinc-900 transition-colors"
          onClick={() => setSort((s) => (s === 'visitors' ? 'revenue' : 'visitors'))}
          title="Sort by visitors or revenue"
        >
          <span>{sort === 'visitors' ? 'Visitors' : 'Revenue'}</span>
          <span className="text-zinc-400">↕</span>
        </button>
      </div>
      <div className={`flex-1 ${loading && !data ? 'animate-pulse' : ''}`}>
        {error && <p className="p-3 text-xs text-red-600">{error}</p>}
        {data && data.length === 0 && <p className="p-6 text-center text-xs text-zinc-400">No data for this period</p>}
        {data && <Bars rows={data} dim={active} tab={tab} sort={sort} limit={10} onPick={pick} />}
      </div>
      {data && data.length > 10 && (
        <button className="mx-auto mt-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 hover:text-zinc-800 transition-colors" onClick={() => setDetails(true)}>
          Show all ({data.length}) →
        </button>
      )}
      <Modal open={details} onClose={() => setDetails(false)} title={tab.label} width="max-w-3xl">
        <input className="input mb-4" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-100 text-left text-zinc-400 font-medium pb-2">
                <th className="pb-2 font-medium">{tab.label}</th>
                <th className="pb-2 text-right font-medium">Visitors</th>
                <th className="pb-2 text-right font-medium">Revenue</th>
                <th className="pb-2 text-right font-medium">Conv.</th>
                <th className="pb-2 text-right font-medium">Rev/visitor</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i} className={`border-b border-zinc-50 transition-colors ${tab.filter ? 'cursor-pointer hover:bg-zinc-50/80' : ''}`} onClick={() => pick(r)}>
                  <td className="max-w-[320px] py-2.5 font-medium text-zinc-800"><div className="flex min-w-0 items-center gap-2">{renderLabel(active, r)}</div></td>
                  <td className="py-2.5 text-right font-medium text-zinc-600">{fmtNumber(r.visitors)}</td>
                  <td className="py-2.5 text-right font-semibold text-emerald-600">{money(r.revenue)}</td>
                  <td className="py-2.5 text-right text-zinc-500">{r.visitors ? fmtPct(r.customers / r.visitors, 1) : '—'}</td>
                  <td className="py-2.5 text-right text-zinc-500">{r.visitors ? money(r.revenue / r.visitors) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
    </div>
  );
}
