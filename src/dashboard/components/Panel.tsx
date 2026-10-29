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
export function renderLabel(dim: string, row: Pick<BreakdownRow, 'label' | 'extra'>, wrap = false): ReactNode {
  const l = row.label;
  const text = (s: ReactNode) => (
    <span className={wrap ? 'min-w-0 break-words' : 'truncate'} title={typeof s === 'string' ? s : undefined}>
      {s}
    </span>
  );
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

function Bars({
  rows,
  dim,
  tab,
  sort,
  limit,
  onPick,
  onDetails,
}: {
  rows: BreakdownRow[];
  dim: string;
  tab: TabDef;
  sort: 'visitors' | 'revenue';
  limit?: number;
  onPick?: (r: BreakdownRow) => void;
  onDetails: (r: BreakdownRow) => void;
}) {
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
          <div key={`${r.label}-${i}`} className="group relative flex min-h-11 items-center rounded-lg sm:min-h-10">
            <div className="absolute inset-0 flex">
              <div className="rounded-l-lg bg-visitorsSoft transition-all" style={{ width: `${vw}%`, minWidth: r.visitors ? 4 : 0 }} />
              {rw > 0 && <div className="rounded-r-lg bg-revenueSoft" style={{ width: `${rw}%` }} />}
            </div>
            <div className="pointer-events-none absolute inset-0 hidden rounded-lg ring-1 ring-stone-300/70 group-hover:block group-focus-within:block" />
            <button
              type="button"
              className={`relative flex min-w-0 flex-1 items-center gap-2 py-2 pl-3 text-left text-[15px] ${tab.filter ? 'cursor-pointer' : ''}`}
              onClick={() => (tab.filter ? onPick?.(r) : onDetails(r))}
              aria-label={`${r.label ?? '(none)'}: ${fmtNumber(r.visitors)} visitors, ${money(r.revenue)} revenue. ${
                tab.filter ? 'Filter dashboard' : 'Show details'
              }`}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2.5">{renderLabel(dim, r)}</span>
              <span className="flex shrink-0 items-center gap-3 pr-3 text-[15px] font-medium">
                {r.revenue !== 0 && <span className="hidden text-sm font-normal text-revenue group-hover:inline">{money(r.revenue)}</span>}
                {sort === 'revenue' ? money(r.revenue, true) : fmtNumber(r.visitors)}
              </span>
            </button>
            <button
              type="button"
              className="relative mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-stone-300 hover:bg-stone-100 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300"
              onClick={() => onDetails(r)}
              aria-label={`Details for ${r.label ?? '(none)'}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 11v5M12 8h.01" />
              </svg>
            </button>
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
  const [detailRow, setDetailRow] = useState<BreakdownRow | null>(null);
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
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
        <div className="tabs flex-wrap">
          {tabs.map((t) => (
            <button key={t.dim} className={`tab whitespace-nowrap ${t.dim === active ? 'tab-active' : ''}`} onClick={() => setActive(t.dim)}>
              {t.label}
            </button>
          ))}
        </div>
        <button
          className="ml-auto flex shrink-0 items-center gap-1 px-2 text-sm font-medium text-stone-600 hover:text-ink"
          onClick={() => setSort((s) => (s === 'visitors' ? 'revenue' : 'visitors'))}
          title="Sort by visitors or revenue"
        >
          {sort === 'visitors' ? 'Visitors' : 'Revenue'} <span className="text-stone-400">↑↓</span>
        </button>
      </div>
      <div className={`flex-1 ${loading && !data ? 'animate-pulse' : ''}`}>
        {error && <p className="p-3 text-sm text-red-600">{error}</p>}
        {data && data.length === 0 && <p className="p-6 text-center text-sm text-stone-400">No data for this period</p>}
        {data && <Bars rows={data} dim={active} tab={tab} sort={sort} limit={10} onPick={pick} onDetails={setDetailRow} />}
      </div>
      {data && data.length > 10 && (
        <button className="mx-auto mt-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-stone-500 hover:text-ink" onClick={() => setDetails(true)}>
          ⛶ Details
        </button>
      )}
      <Modal open={details} onClose={() => setDetails(false)} title={tab.label} width="max-w-3xl">
        <input className="input mb-4" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
        <div className="space-y-2 sm:hidden">
          {filtered.map((r, i) => (
            <div
              key={i}
              className={`rounded-xl border border-stone-200 p-3 ${tab.filter ? 'cursor-pointer active:bg-stone-50' : ''}`}
              onClick={tab.filter ? () => pick(r) : undefined}
              onKeyDown={
                tab.filter
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.currentTarget.click();
                      }
                    }
                  : undefined
              }
              role={tab.filter ? 'button' : undefined}
              tabIndex={tab.filter ? 0 : undefined}
            >
              <div className="flex min-w-0 items-center gap-2 text-[15px] font-medium">{renderLabel(active, r, true)}</div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <Detail label="Visitors" value={fmtNumber(r.visitors)} />
                <Detail label="Revenue" value={money(r.revenue)} />
                <Detail label="Customers" value={fmtNumber(r.customers)} />
                <Detail label="Conversion" value={r.visitors ? fmtPct(r.customers / r.visitors, 1) : '—'} />
                <Detail label="Rev/visitor" value={r.visitors ? money(r.revenue / r.visitors) : '—'} />
                {r.pageviews !== undefined && active === 'page' && <Detail label="Pageviews" value={fmtNumber(r.pageviews)} />}
              </dl>
              {tab.filter && <div className="mt-2 text-xs text-stone-400">Tap to filter the dashboard</div>}
            </div>
          ))}
          {!filtered.length && <p className="py-6 text-center text-sm text-stone-400">No matches</p>}
        </div>
        <div className="hidden overflow-x-auto sm:block">
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
                <tr
                  key={i}
                  className={`border-t border-stone-100 ${tab.filter ? 'cursor-pointer hover:bg-stone-50 focus-visible:bg-stone-100' : ''}`}
                  onClick={() => pick(r)}
                  onKeyDown={
                    tab.filter
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.currentTarget.click();
                          }
                        }
                      : undefined
                  }
                  role={tab.filter ? 'button' : undefined}
                  tabIndex={tab.filter ? 0 : undefined}
                >
                  <td className="max-w-[320px] py-2"><div className="flex min-w-0 items-center gap-2">{renderLabel(active, r, true)}</div></td>
                  <td className="py-2 text-right">{fmtNumber(r.visitors)}</td>
                  <td className="py-2 text-right">{money(r.revenue)}</td>
                  <td className="py-2 text-right">{r.visitors ? fmtPct(r.customers / r.visitors, 1) : '—'}</td>
                  <td className="py-2 text-right">{r.visitors ? money(r.revenue / r.visitors) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <p className="py-6 text-center text-sm text-stone-400">No matches</p>}
        </div>
      </Modal>
      <Modal open={!!detailRow} onClose={() => setDetailRow(null)} title={detailRow ? `${tab.label} details` : 'Details'} width="max-w-md">
        {detailRow && (
          <div>
            <div className="flex min-w-0 items-center gap-2 text-lg font-semibold">{renderLabel(active, detailRow, true)}</div>
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <Detail label="Visitors" value={fmtNumber(detailRow.visitors)} />
              <Detail label="Revenue" value={money(detailRow.revenue)} />
              <Detail label="Customers" value={fmtNumber(detailRow.customers)} />
              <Detail label="Conversion" value={detailRow.visitors ? fmtPct(detailRow.customers / detailRow.visitors, 1) : '—'} />
              <Detail label="Rev/visitor" value={detailRow.visitors ? money(detailRow.revenue / detailRow.visitors) : '—'} />
              {detailRow.pageviews !== undefined && active === 'page' && <Detail label="Pageviews" value={fmtNumber(detailRow.pageviews)} />}
            </dl>
            {tab.filter && (
              <button
                className="btn-dark mt-5 w-full"
                onClick={() => {
                  setDetailRow(null);
                  addFilter(tab.filter!, detailRow.label ?? '');
                }}
              >
                Filter dashboard by this {tab.label.toLowerCase()}
              </button>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-stone-500">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium" title={value}>
        {value}
      </dd>
    </div>
  );
}
