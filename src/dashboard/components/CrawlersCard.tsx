import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { navigate } from '../App';
import { qs, type CrawlerCategory, type CrawlerStats } from '../lib/api';
import { useDash } from '../lib/context';
import { bucketLabel, fmtNumber } from '../lib/format';
import { useApi } from '../lib/useApi';
import { Favicon } from './Icons';

const svg = (d: ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);
const SparkIcon = () => svg(<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />);
const SearchIcon = () => svg(<><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>);
const BrainIcon = () =>
  svg(<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1" />);
const BotIcon = () => svg(<><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 4v4M9 13h.01M15 13h.01" /></>);
const PageIcon = () => svg(<><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>);

const TABS: { key: CrawlerCategory; label: string; icon: () => ReactNode; hint: string }[] = [
  { key: 'answers', label: 'AI answers', icon: SparkIcon, hint: 'Fetched live because someone asked an AI (ChatGPT, Claude, Perplexity…)' },
  { key: 'indexing', label: 'Indexing', icon: SearchIcon, hint: 'Search crawlers building the index AI answers draw on' },
  { key: 'training', label: 'Training', icon: BrainIcon, hint: 'Crawlers collecting data to train AI models' },
];

const BRAND: Record<string, string> = {
  ChatGPT: '#6b7280',
  OpenAI: '#6b7280',
  Claude: '#d97757',
  Anthropic: '#d97757',
  Gemini: '#4f7df3',
  Google: '#34a853',
  Bing: '#2f7fe0',
  Perplexity: '#20a4b8',
  DuckDuckGo: '#de5833',
  Amazon: '#f59e0b',
  Apple: '#a3a3a3',
  Meta: '#0866ff',
  'Meta AI': '#0866ff',
};
const PALETTE = ['#7c8ea6', '#e0a43a', '#3fa877', '#d0574f', '#5b8def', '#9a6fd6', '#d6649a', '#2fb5a8'];

function colorFor(key: string, i: number, byCrawler: boolean) {
  return (byCrawler && BRAND[key]) || PALETTE[i % PALETTE.length];
}

/** Checkbox list of crawlers (or pages) that limits what the chart and list show. */
function Picker({
  label,
  icon,
  items,
  selected,
  onChange,
}: {
  label: string;
  icon: ReactNode;
  items: { key: string; hits: number; domain: string | null }[];
  selected: string[] | null;
  onChange: (next: string[] | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const isOn = (k: string) => selected === null || selected.includes(k);
  const toggle = (k: string) => {
    const cur = selected ?? items.map((i) => i.key);
    const next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
    onChange(next.length === items.length ? null : next);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        className={`flex items-center gap-1.5 rounded-xl border border-dashed px-3 py-1.5 text-sm font-medium transition ${
          selected !== null ? 'border-stone-400 text-ink' : 'border-stone-300 text-stone-600 hover:text-ink'
        }`}
        onClick={() => setOpen((o) => !o)}
      >
        {icon} {label}
        {selected !== null && <span className="text-stone-400">{selected.length}/{items.length}</span>}
      </button>
      {open && (
        <div className="card absolute right-0 top-full z-40 mt-2 w-72 p-2">
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {items.length === 0 && <p className="p-3 text-center text-sm text-stone-400">Nothing yet</p>}
            {items.map((it) => (
              <label key={it.key} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm hover:bg-stone-50">
                <input type="checkbox" className="h-4 w-4 accent-stone-800" checked={isOn(it.key)} onChange={() => toggle(it.key)} />
                {it.domain !== null && <Favicon domain={it.domain} />}
                <span className="min-w-0 flex-1 truncate">{it.key}</span>
                <span className="text-stone-400">{fmtNumber(it.hits)}</span>
              </label>
            ))}
          </div>
          <div className="mt-1 flex justify-between border-t border-stone-100 px-2 pt-2 text-sm">
            <button className="text-stone-500 hover:text-ink" onClick={() => onChange([])}>
              Clear all
            </button>
            <button className="text-stone-500 hover:text-ink" onClick={() => onChange(null)}>
              All {items.length}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function CrawlersCard() {
  const { site, q, reloadKey } = useDash();
  const [category, setCategory] = useState<CrawlerCategory>('answers');
  const [by, setBy] = useState<'crawler' | 'page'>('crawler');
  // null = everything; [] = nothing. Crawler choice is applied by the API (so page counts follow it),
  // page choice only hides lines and rows here.
  const [crawlers, setCrawlers] = useState<string[] | null>(null);
  const [pages, setPages] = useState<string[] | null>(null);

  useEffect(() => {
    setCrawlers(null);
    setPages(null);
  }, [category]);

  const params: Record<string, string> = { category, by };
  if (crawlers !== null) params.crawlers = crawlers.length ? crawlers.join(',') : '-';
  const { data, loading, error } = useApi<CrawlerStats>(`/api/sites/${site.id}/crawlers?${qs(q, params)}`, reloadKey);

  const byCrawler = by === 'crawler';
  const g = data?.range.granularity ?? 'day';
  const visible = (k: string) => byCrawler || pages === null || pages.includes(k);

  const lines = useMemo(
    () => (data?.keys ?? []).map((key, i) => ({ key, i, color: colorFor(key, i, byCrawler) })).filter((l) => visible(l.key)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, byCrawler, pages],
  );
  const chartData = useMemo(
    () => (data?.series ?? []).map((s) => ({ bucket: s.bucket, ...Object.fromEntries(data!.keys.map((k, i) => [k, s.values[i]])) })),
    [data],
  );
  const rows = (data?.rows ?? []).filter((r) => visible(r.key));
  const maxHits = Math.max(1, ...rows.map((r) => r.hits));
  const noData = data && Object.values(data.totals).every((n) => n === 0);

  return (
    <div className="card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
        <div className="tabs overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              title={t.hint}
              className={`tab flex items-center gap-1.5 whitespace-nowrap ${t.key === category ? 'tab-active' : ''}`}
              onClick={() => setCategory(t.key)}
            >
              <t.icon /> {t.label}
              <span className="text-stone-400">{data ? fmtNumber(data.totals[t.key]) : '…'}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {byCrawler ? (
            <Picker
              label="Crawlers"
              icon={<BotIcon />}
              items={(data?.crawlers ?? []).map((c) => ({ key: c.name, hits: c.hits, domain: c.domain }))}
              selected={crawlers}
              onChange={setCrawlers}
            />
          ) : (
            <Picker
              label="Pages"
              icon={<PageIcon />}
              items={(data?.rows ?? []).map((r) => ({ key: r.key, hits: r.hits, domain: null }))}
              selected={pages}
              onChange={setPages}
            />
          )}
          <button
            className="rounded-xl p-2 text-stone-500 hover:bg-stone-100 hover:text-ink"
            title={byCrawler ? 'Show pages' : 'Show crawlers'}
            onClick={() => setBy(byCrawler ? 'page' : 'crawler')}
          >
            {byCrawler ? <PageIcon /> : <BotIcon />}
          </button>
        </div>
      </div>

      {error && <p className="p-3 text-sm text-red-600">{error}</p>}
      {noData && (
        <p className="px-3 pb-2 text-sm text-stone-500">
          No AI crawler visits in this period. Crawlers don't run JavaScript, so your server has to report them —{' '}
          <button className="underline underline-offset-2" onClick={() => navigate(`/site/${site.id}/settings`)}>
            see Settings → AI crawlers
          </button>
          .
        </p>
      )}

      <div className={`grid gap-4 lg:grid-cols-[1fr_340px] ${loading && !data ? 'animate-pulse' : ''}`}>
        <div className="h-[320px]">
          {data && (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="rgb(var(--chart-grid))" strokeDasharray="4 4" />
                <XAxis
                  dataKey="bucket"
                  tickFormatter={(b) => bucketLabel(b, g)}
                  tick={{ fill: 'rgb(var(--stone-400))', fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={24}
                />
                <YAxis tick={{ fill: 'rgb(var(--stone-400))', fontSize: 12 }} axisLine={false} tickLine={false} width={40} allowDecimals={false} />
                <Tooltip
                  cursor={{ stroke: 'rgb(var(--stone-300))' }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const items = payload
                      .map((p) => ({ key: String(p.dataKey), value: Number(p.value) || 0, color: p.color ?? '#999' }))
                      .filter((p) => p.value > 0)
                      .sort((a, b) => b.value - a.value);
                    const total = items.reduce((s, p) => s + p.value, 0);
                    return (
                      <div className="card min-w-[200px] px-4 py-3 text-sm">
                        <div className="mb-2 font-medium">{bucketLabel(String(label), g, true)}</div>
                        {items.length === 0 && <div className="text-stone-400">No hits</div>}
                        {items.map((p) => (
                          <div key={p.key} className="flex items-center justify-between gap-6 py-0.5">
                            <span className="flex min-w-0 items-center gap-2 text-stone-600">
                              <span className="h-3.5 w-1 shrink-0 rounded-full" style={{ background: p.color }} />
                              {byCrawler && <Favicon domain={data.rows.find((r) => r.key === p.key)?.domain} size={16} />}
                              <span className="truncate">{p.key}</span>
                            </span>
                            <span className="font-medium">{fmtNumber(p.value)}</span>
                          </div>
                        ))}
                        {items.length > 1 && (
                          <div className="mt-1.5 flex justify-between border-t border-stone-100 pt-1.5">
                            <span className="text-stone-500">Total</span>
                            <span className="font-medium">{fmtNumber(total)}</span>
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
                {lines.map((l) => (
                  <Line
                    key={l.key}
                    type="monotone"
                    dataKey={l.key}
                    stroke={l.color}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, stroke: 'rgb(var(--surface))', strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="max-h-[320px] space-y-1 overflow-y-auto rounded-xl border border-stone-100 p-2">
          {data && rows.length === 0 && <p className="p-6 text-center text-sm text-stone-400">No data for this period</p>}
          {rows.map((r) => {
            const i = data!.keys.indexOf(r.key);
            const color = i >= 0 ? colorFor(r.key, i, byCrawler) : 'rgb(var(--stone-300))';
            return (
              <div key={r.key} className="relative flex h-10 items-center rounded-lg" title={r.key}>
                <div
                  className="absolute inset-y-0 left-0 rounded-lg opacity-15"
                  style={{ width: `${(r.hits / maxHits) * 100}%`, minWidth: 4, background: color }}
                />
                <div className="relative flex min-w-0 flex-1 items-center gap-2.5 px-3 text-[15px]">
                  {byCrawler && <Favicon domain={r.domain} />}
                  <span className="truncate">{r.key}</span>
                </div>
                <div className="relative pr-3 text-[15px] font-medium">{fmtNumber(r.hits)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
