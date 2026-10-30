import { useEffect, useMemo, useRef, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { qs } from '../lib/api';
import { useApi } from '../lib/useApi';
import { useDash } from '../lib/context';
import { matchesPageSearch } from '../lib/botFilters';
import { bucketLabel, fmtNumber } from '../lib/format';

type Group = 'answers' | 'indexing' | 'training' | 'other';
type BotRow = { bot: string; category: string; requests: number };
interface BotData {
  range: { granularity: 'hour' | 'day' | 'week' | 'month' };
  labels: string[];
  total: { requests: number; bots: number };
  bots: BotRow[];
  traffic: (BotRow & { bucket: string })[];
  pages: { path: string; requests: number }[];
  pageTraffic: { bucket: string; path: string; requests: number }[];
  pageBots: (BotRow & { hostname: string; path: string })[];
  recent: { ts: number; bot: string; category: string; hostname: string; path: string }[];
}
const GROUPS: { key: Group; label: string }[] = [
  { key: 'answers', label: 'AI answers' },
  { key: 'indexing', label: 'Indexing' },
  { key: 'training', label: 'Training' },
  { key: 'other', label: 'Other' },
];
function CategoryIcon({ type }: { type: Group | 'robot' }) {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {type === 'answers' ? <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" /><path d="M20 2v4m-2-2h4" /></>
      : type === 'indexing' ? <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>
      : type === 'training' ? <><path d="M12 4c-3-3-7 0-6 3-4 1-4 6-1 7-1 4 4 7 7 4 3 3 8 0 7-4 3-1 3-6-1-7 1-3-3-6-6-3Zm0 0v14M8 8l4 2m4-2-4 2m-5 4 5-1m5 1-5-1" /></>
      : type === 'robot' ? <><rect x="5" y="6" width="14" height="13" rx="3" /><path d="M12 3v3M2 11v4m20-4v4M9 15h6m-6-5v1m6-1v1" /></>
      : <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>}
  </svg>;
}
function group(category: string): Group {
  return category === 'AI assistant' ? 'answers' : category === 'AI training' ? 'training'
    : category === 'AI search' || category === 'Search engine' ? 'indexing' : 'other';
}
const COLORS = ['#7c8fa5', '#d18060', '#639fe2', '#86a77c', '#b49ac9', '#ccab61', '#6db5b2', '#bb8598'];
function provider(bot: string): string {
  if (/GPTBot|ChatGPT|OAI-/.test(bot)) return 'ChatGPT';
  if (/Claude/.test(bot)) return 'Claude';
  if (/Perplexity/.test(bot)) return 'Perplexity';
  if (/Google/.test(bot)) return 'Google';
  if (/Bing/.test(bot)) return 'Bing';
  if (/DuckDuck/.test(bot)) return 'DuckDuckGo';
  return bot;
}

export function BotAnalytics() {
  const { site, q, reloadKey } = useDash();
  const [active, setActive] = useState<Group>('answers');
  // null means all; [] deliberately means none.
  const [selectedBots, setSelectedBots] = useState<string[] | null>(null);
  const [selectedPages, setSelectedPages] = useState<string[] | null>(null);
  const [view, setView] = useState<'crawlers' | 'pages'>('crawlers');
  const [menu, setMenu] = useState<'crawlers' | 'pages' | null>(null);
  const [search, setSearch] = useState('');
  const [showRecent, setShowRecent] = useState(false);
  const controls = useRef<HTMLDivElement>(null);
  const crawlerButton = useRef<HTMLButtonElement>(null);
  const pagesButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => { if (!controls.current?.contains(e.target as Node)) setMenu(null); };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setMenu(null); (menu === 'pages' ? pagesButton : crawlerButton).current?.focus(); }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    controls.current?.querySelector<HTMLInputElement>('[role="dialog"] input')?.focus();
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [menu]);
  const url = `/api/sites/${site.id}/bots?${qs({ ...q, filters: {} })}`;
  const { data: all, error: baseError } = useApi<BotData>(url, reloadKey);
  const options = useMemo(() => {
    if (!all) return null;
    const counts: Record<Group, number> = { answers: 0, indexing: 0, training: 0, other: 0 };
    const bots = new Map<string, number>();
    const paths = new Map<string, number>();
    for (const r of all.bots) {
      counts[group(r.category)] += r.requests;
      if (group(r.category) === active) bots.set(provider(r.bot), (bots.get(provider(r.bot)) ?? 0) + r.requests);
    }
    for (const r of all.pageBots) if (group(r.category) === active) paths.set(r.path, (paths.get(r.path) ?? 0) + r.requests);
    const sorted = (m: Map<string, number>) => [...m].map(([name, requests]) => ({ name, requests })).sort((a, b) => b.requests - a.requests || a.name.localeCompare(b.name));
    return { counts, bots: sorted(bots), pages: sorted(paths).slice(0, 100) };
  }, [all, active]);
  const extra: Record<string, string> = { bot_group: active };
  if (selectedBots !== null) extra.bot_names = JSON.stringify((all?.bots ?? []).filter(b => selectedBots.includes(provider(b.bot))).map(b => b.bot));
  if (selectedPages !== null) extra.page_paths = JSON.stringify(selectedPages);
  const { data, error, loading } = useApi<BotData>(all ? `${url}&${new URLSearchParams(extra)}` : null, reloadKey);
  const content = useMemo(() => {
    if (!data || !options) return null;
    const botTotals = new Map<string, number>();
    const pageTotals = new Map<string, number>();
    for (const r of data.bots) botTotals.set(provider(r.bot), (botTotals.get(provider(r.bot)) ?? 0) + r.requests);
    for (const r of data.pages) pageTotals.set(r.path, (pageTotals.get(r.path) ?? 0) + r.requests);
    const totals = view === 'crawlers' ? botTotals : pageTotals;
    const palette = view === 'crawlers' ? options.bots : options.pages;
    const rows = [...totals].map(([name, requests]) => ({ name, requests, color: COLORS[Math.max(0, palette.findIndex(o => o.name === name)) % COLORS.length] }))
      .sort((a, b) => b.requests - a.requests || a.name.localeCompare(b.name)).slice(0, 100);
    const lines = rows.slice(0, 10).map((r, i) => ({ ...r, key: `series${i}` }));
    const byName = new Map(lines.map(l => [l.name, l.key]));
    const points = new Map(data.labels.map(bucket => [bucket, { bucket } as Record<string, string | number>]));
    const traffic = view === 'crawlers' ? data.traffic.map(r => ({ ...r, name: provider(r.bot) })) : data.pageTraffic.map(r => ({ ...r, name: r.path }));
    for (const r of traffic) { const point = points.get(r.bucket); const key = byName.get(r.name); if (point && key) point[key] = Number(point[key] ?? 0) + r.requests; }
    for (const point of points.values()) for (const line of lines) point[line.key] ??= 0;
    return { rows, lines, series: [...points.values()] };
  }, [data, options, view]);
  const toggle = (name: string, current: string[] | null, names: string[], setter: (v: string[] | null) => void) => {
    const set = new Set(current ?? names); if (set.has(name)) set.delete(name); else set.add(name);
    setter(set.size === names.length ? null : [...set]);
  };
  const open = (which: 'crawlers' | 'pages') => {
    if (view !== which) { setView(which); setMenu(null); }
    else setMenu(menu === which ? null : which);
  };
  const filterCount = (selectedBots === null ? 0 : 1) + (selectedPages === null ? 0 : 1);
  const menuOptions = menu === 'pages' ? options?.pages ?? [] : options?.bots ?? [];
  const menuSelected = menu === 'pages' ? selectedPages : selectedBots;
  const setMenuSelected = menu === 'pages' ? setSelectedPages : setSelectedBots;
  const filteredOptions = menu === 'pages' ? menuOptions.filter(o => matchesPageSearch(o.name, search)) : menuOptions;

  return <section className="card relative mt-6" aria-label="Crawler traffic">
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 sm:px-5">
      <div role="group" aria-label="Crawler category" className="flex max-w-full flex-wrap gap-1 rounded-2xl bg-stone-100/70 p-1">
        {GROUPS.filter(g => g.key !== 'other' || (options?.counts.other ?? 0) > 0).map(g => <button key={g.key}
          aria-pressed={active === g.key} onClick={() => { setActive(g.key); setSelectedBots(null); setSelectedPages(null); setMenu(null); }}
          className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${active === g.key ? 'bg-white text-ink shadow-sm ring-1 ring-stone-200' : 'text-stone-500 hover:text-ink'}`}>
          <CategoryIcon type={g.key} />{g.label}<span className="tabular-nums text-stone-400">{options ? fmtNumber(options.counts[g.key]) : '—'}</span>
        </button>)}
      </div>
      <div ref={controls} className="relative ml-auto flex items-center gap-2" role="group" aria-label="Crawler breakdown">
        <button ref={crawlerButton} aria-pressed={view === 'crawlers'} aria-expanded={menu === 'crawlers'} aria-haspopup="dialog" onClick={() => open('crawlers')}
          title={view === 'crawlers' ? 'Filter crawlers' : 'Group by crawlers'}
          className={`inline-flex items-center gap-2 rounded-xl border border-dashed px-3 py-2 text-sm font-medium ${view === 'crawlers' ? 'border-stone-400 text-ink' : 'border-transparent text-stone-400 hover:text-ink'}`}>
          <CategoryIcon type="robot" /> Crawlers{selectedBots !== null && <span className="text-xs text-stone-400">{selectedBots.length}</span>}
        </button>
        <button ref={pagesButton} aria-pressed={view === 'pages'} aria-expanded={menu === 'pages'} aria-haspopup="dialog" onClick={() => open('pages')}
          title={view === 'pages' ? 'Filter pages' : 'Group by pages'}
          className={`rounded-xl border border-dashed px-3 py-2 text-sm font-medium ${view === 'pages' ? 'border-stone-400 text-ink' : 'border-transparent text-stone-400 hover:text-ink'}`}>Pages{selectedPages !== null && <span className="ml-2 text-xs text-stone-400">{selectedPages.length}</span>}</button>
        {menu && <div role="dialog" aria-label={menu === 'pages' ? 'Page filters' : 'Crawler filters'} className="absolute right-0 top-full z-30 mt-3 w-[min(360px,calc(100vw-48px))] overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3 text-sm font-medium"><span>{menu === 'pages' ? 'Filter pages' : 'Filter crawlers'}</span><button aria-label="Close filters" onClick={() => setMenu(null)} className="px-2 text-stone-400">×</button></div>
          {menu === 'pages' && <div className="border-b border-stone-100 p-3"><input aria-label="Search pages" placeholder="Search (llms.txt, /blog/*)" className="w-full rounded-lg bg-stone-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-300" value={search} onChange={e => setSearch(e.target.value)} /></div>}
          <div className="max-h-72 overflow-y-auto p-2">{filteredOptions.map(o => <label key={o.name} className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-3 hover:bg-stone-50">
            <input type="checkbox" aria-label={o.name} checked={menuSelected === null || menuSelected.includes(o.name)} onChange={() => toggle(o.name, menuSelected, menuOptions.map(o => o.name), setMenuSelected)} className="h-4 w-4 shrink-0 accent-stone-700" />
            <span className="min-w-0 flex-1 break-all text-sm font-medium">{o.name}</span><span className="text-sm tabular-nums text-stone-400">{fmtNumber(o.requests)}</span>
          </label>)}{filteredOptions.length === 0 && <p className="p-4 text-sm text-stone-400">No matching {menu === 'pages' ? 'pages' : 'crawlers'}.</p>}</div>
          <div className="flex items-center justify-between border-t border-stone-100 px-4 py-3 text-sm text-stone-500"><button onClick={() => setMenuSelected([])}>Clear all</button>
            <span className="text-xs text-stone-400">{menu === 'pages' ? `${filteredOptions.length} ${filteredOptions.length === 1 ? 'page' : 'pages'}` : `${menuSelected?.length ?? menuOptions.length} selected`}</span>
            <button onClick={() => setMenuSelected(null)}>All {menuOptions.length}</button></div>
        </div>}
      </div>
    </div>
    {baseError || error ? <p role="alert" className="p-8 text-red-700">Could not load crawler traffic: {baseError || error}</p>
      : !data || !content || !options ? <p role="status" className="p-12 text-center text-sm text-stone-500">Loading crawler traffic…</p>
      : <>
        <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]" aria-busy={loading}>
          <div className="min-w-0">
            <div className="mb-3 flex min-h-6 flex-wrap items-center justify-between gap-2 px-2 text-xs text-stone-400">
              <span>{GROUPS.find(g => g.key === active)?.label} · {loading ? 'Updating…' : `${fmtNumber(data.total.requests)} requests`} · by {view}</span>
              {filterCount > 0 && <button className="text-stone-600 hover:underline" onClick={() => { setSelectedBots(null); setSelectedPages(null); }}>Reset filters ({filterCount}) ×</button>}
            </div>
            {content.rows.length ? <div className="h-[300px] sm:h-[350px]">
              <ResponsiveContainer width="100%" height="100%"><LineChart data={content.series} margin={{ top: 10, right: 12, left: -12, bottom: 8 }}>
                <CartesianGrid vertical={false} stroke="#e7e5e4" strokeDasharray="4 5" />
                <XAxis dataKey="bucket" tickFormatter={b => bucketLabel(b, data.range.granularity)} tick={{ fill: '#a8a29e', fontSize: 12 }} axisLine={false} tickLine={false} minTickGap={30} />
                <YAxis domain={[0, 'auto']} allowDecimals={false} tick={{ fill: '#a8a29e', fontSize: 12 }} axisLine={false} tickLine={false} width={45} />
                <Tooltip labelFormatter={b => bucketLabel(String(b), data.range.granularity)} contentStyle={{ borderRadius: 12, borderColor: '#e7e5e4', fontSize: 13 }} />
                {content.lines.map(c => <Line key={c.key} name={c.name} dataKey={c.key} type="monotone" stroke={c.color} strokeWidth={2} dot={content.series.length === 1} activeDot={{ r: 4 }} isAnimationActive={false} />)}
              </LineChart></ResponsiveContainer>
            </div> : <div className="flex h-[300px] flex-col items-center justify-center rounded-2xl bg-stone-50/60 p-8 text-center sm:h-[350px]"><h3 className="font-medium">No matching requests</h3><p className="mt-2 text-sm text-stone-400">Change the date range or select more crawlers and pages.</p></div>}
          </div>
          <div className="min-w-0 overflow-hidden rounded-2xl border border-stone-200" aria-label={view === 'crawlers' ? 'Crawler list' : 'Requested pages'}>
            <div className="max-h-[390px] overflow-auto">{content.rows.map(c => <button key={c.name}
              aria-label={`Only ${c.name}`} onClick={() => view === 'crawlers' ? setSelectedBots(selectedBots?.length === 1 && selectedBots[0] === c.name ? null : [c.name]) : setSelectedPages(selectedPages?.length === 1 && selectedPages[0] === c.name ? null : [c.name])}
              className="relative flex w-full items-center gap-3 overflow-hidden px-4 py-4 text-left transition-colors hover:bg-stone-50">
              <span className="absolute inset-y-1 left-0 rounded-r-xl opacity-[0.08]" style={{ width: `${100 * c.requests / content.rows[0].requests}%`, backgroundColor: c.color }} />
              {view === 'crawlers' && <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white" style={{ backgroundColor: c.color }}>{c.name.slice(0, 2)}</span>}
              <span className="relative min-w-0 flex-1 break-all font-medium">{c.name}</span><span className="relative font-semibold tabular-nums">{fmtNumber(c.requests)}</span>
            </button>)}{!content.rows.length && <p className="p-6 text-sm text-stone-400">No matching {view}.</p>}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 px-5 py-3 text-xs text-stone-400"><p>Server-reported traffic · {site.timezone} · Human filters do not apply · Identities unverified</p><button className="font-medium text-stone-500 hover:text-ink" aria-expanded={showRecent} onClick={() => setShowRecent(!showRecent)}>{showRecent ? 'Hide' : 'Show'} recent requests {showRecent ? '↑' : '↓'}</button></div>
        {content.rows.length > 10 && <p className="px-5 pb-3 text-xs text-stone-400">Chart shows the top 10 {view}. Select specific items to compare them.</p>}
        {showRecent && <div className="overflow-auto border-t border-stone-100 px-5 pb-4"><table className="w-full text-left text-sm"><thead><tr className="text-stone-400"><th scope="col" className="py-3">Time ({site.timezone})</th><th scope="col">Crawler</th><th scope="col">Page</th></tr></thead><tbody>{data.recent.map((r, i) => <tr key={i} className="border-t border-stone-100"><td className="whitespace-nowrap py-3 pr-4">{new Date(r.ts).toLocaleString(undefined, { timeZone: site.timezone })}</td><td className="pr-4">{r.bot}</td><td className="break-all">{r.hostname}{r.path}</td></tr>)}</tbody></table><p className="text-xs text-stone-400">Up to 30 recent matching requests. Page picker shows up to 100 paths.</p></div>}
      </>}
  </section>;
}
