import { useMemo, useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CATEGORY_INFO, botInfo, isAiCategory, operatorDomain, type BotCategory } from '../../shared/bots';
import { navigate } from '../App';
import { qs, type BotOverview, type BotRow, type BotTotals } from '../lib/api';
import { useDash } from '../lib/context';
import { bucketLabel, fmtAgo, fmtNumber, fmtPct } from '../lib/format';
import { usePref } from '../lib/prefs';
import { useApi } from '../lib/useApi';
import { Favicon } from './Icons';
import { Modal } from './Modal';

// Validated pair (light surface): AI bots violet, other bots aqua. Aqua is under 3:1 contrast, so the legend,
// tooltip and the list beside the chart always carry the numbers too.
const AI_COLOR = '#6250d6';
const OTHER_COLOR = '#1baf7a';

type Dim = 'bot' | 'operator' | 'category' | 'page';
const TABS: { dim: Dim; label: string }[] = [
  { dim: 'bot', label: 'Bot' },
  { dim: 'operator', label: 'Company' },
  { dim: 'category', label: 'Type' },
  { dim: 'page', label: 'Page' },
];
const FILTER_NAMES: Record<Dim, string> = { bot: 'Bot', operator: 'Company', category: 'Type', page: 'Page' };

const CATEGORY_ICON: Record<BotCategory, string> = {
  'AI training': '📚',
  'AI search': '🔎',
  'AI assistant': '💬',
  'AI agent': '🧭',
  'Search engine': '🌐',
  SEO: '📈',
  'Social preview': '🔗',
  Monitoring: '⏱️',
  Automation: '⚙️',
  Other: '🤖',
};

/** Files written for crawlers: worth knowing who reads them. */
const CRAWLER_FILE = /^\/(robots\.txt|llms(-full)?\.txt|sitemap[\w-]*\.xml|.+\.md)$/i;

const operatorLabel = (op: string | null) => op || 'Scripts & unknown';

function label(dim: Dim, row: Pick<BotRow, 'label' | 'operator' | 'category'>): ReactNode {
  const l = row.label ?? '';
  switch (dim) {
    case 'bot':
      return (
        <>
          <Favicon domain={botInfo(l)?.domain || operatorDomain(row.operator)} fallback="🤖" />
          <span className="truncate">{l}</span>
          {row.category && <span className="hidden shrink-0 rounded-md bg-stone-100 px-1.5 py-px text-[11px] text-stone-500 sm:inline">{row.category}</span>}
        </>
      );
    case 'operator':
      return (
        <>
          <Favicon domain={operatorDomain(l)} fallback="⚙️" />
          <span className="truncate">{operatorLabel(l)}</span>
        </>
      );
    case 'category':
      return (
        <>
          <Favicon fallback={CATEGORY_ICON[l as BotCategory] ?? '🤖'} />
          <span className="truncate">{l}</span>
        </>
      );
    case 'page':
      return (
        <>
          <span className="truncate">{l}</span>
          {CRAWLER_FILE.test(l) && <span className="shrink-0 rounded-md bg-violet-50 px-1.5 py-px text-[11px] text-violet-700">for crawlers</span>}
        </>
      );
  }
}

function describe(dim: Dim, row: BotRow): string | null {
  if (dim === 'bot') return botInfo(row.label)?.about ?? (row.category ? CATEGORY_INFO[row.category as BotCategory] : null);
  if (dim === 'category') return CATEGORY_INFO[row.label as BotCategory] ?? null;
  return null;
}

/** Bot hits go up and down for reasons that are neither good nor bad, so the change is shown in neutral ink. */
function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (!prev) return <span className="text-xs text-stone-400">—</span>;
  const pct = Math.round(((cur - prev) / prev) * 100);
  return (
    <span className="text-xs text-stone-500">
      {Math.abs(pct)}% {pct >= 0 ? '↑' : '↓'}
    </span>
  );
}

function Kpis({ c, p }: { c: BotTotals; p: BotTotals }) {
  const items: { label: string; value: string; sub: ReactNode; title?: string }[] = [
    { label: 'Bot hits', value: fmtNumber(c.hits), sub: <Delta cur={c.hits} prev={p.hits} /> },
    { label: 'AI bots', value: fmtNumber(c.ai), sub: <span className="text-xs text-stone-500">{c.hits ? `${fmtPct(c.ai / c.hits)} of bot hits` : '—'}</span> },
    { label: 'Different bots', value: fmtNumber(c.bots), sub: <span className="text-xs text-stone-500">{fmtNumber(c.pages)} pages read</span> },
    {
      label: 'Verified',
      value: c.hits ? fmtPct(c.verified / c.hits) : '—',
      sub: c.spoofed ? <span className="text-xs text-red-500">{fmtNumber(c.spoofed)} fake</span> : <span className="text-xs text-stone-500">no fakes seen</span>,
      title: "Proven to come from the bot's company: its published IP addresses or a signed request. Fake: claims to be a known bot from an address that company doesn't use.",
    },
    {
      label: 'Blocked',
      value: fmtNumber(c.blocked),
      sub: <span className="text-xs text-stone-500">floods rate-limited</span>,
      title: 'Times your server snippet answered 429 to a bot sending too many requests (counted once a minute per bot).',
    },
  ];
  return (
    <div className="grid grid-cols-2 border-y border-stone-100 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((k) => (
        <div key={k.label} className="border-stone-100 px-5 py-4 lg:border-r lg:last:border-r-0" title={k.title}>
          <div className="text-sm text-stone-500">{k.label}</div>
          <div className="mt-1 text-[26px] font-semibold leading-tight tracking-tight">{k.value}</div>
          {k.sub}
        </div>
      ))}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-4 px-2 text-sm text-stone-500">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: AI_COLOR }} /> AI bots
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: OTHER_COLOR }} /> Other bots
      </span>
    </div>
  );
}

function Chart({ data }: { data: BotOverview }) {
  const g = data.range.granularity;
  return (
    <div className="flex h-[320px] flex-col">
      <Legend />
      <div className="min-h-0 flex-1 pt-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.series} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#efedea" strokeDasharray="4 4" />
            <XAxis dataKey="bucket" tickFormatter={(b) => bucketLabel(b, g)} tick={{ fill: '#a8a29e', fontSize: 12 }} axisLine={false} tickLine={false} minTickGap={24} />
            <YAxis tick={{ fill: '#a8a29e', fontSize: 12 }} axisLine={false} tickLine={false} width={44} allowDecimals={false} tickFormatter={(v) => fmtNumber(v)} />
            <Tooltip
              cursor={{ fill: 'rgba(28,25,23,0.03)' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as BotOverview['series'][0];
                return (
                  <div className="card min-w-[170px] px-4 py-3 text-sm">
                    <div className="mb-2 font-medium">{bucketLabel(d.bucket, g, true)}</div>
                    <TipRow color={AI_COLOR} label="AI bots" value={d.ai} />
                    <TipRow color={OTHER_COLOR} label="Other bots" value={d.other} />
                    <div className="mt-1 flex justify-between border-t border-stone-100 pt-1 text-stone-500">
                      Total <span className="font-medium text-ink">{fmtNumber(d.ai + d.other)}</span>
                    </div>
                  </div>
                );
              }}
            />
            {/* The white stroke is the 2px surface gap between stacked segments. */}
            <Bar dataKey="ai" stackId="bots" fill={AI_COLOR} stroke="#fff" strokeWidth={2} maxBarSize={28} isAnimationActive={false} />
            <Bar dataKey="other" stackId="bots" fill={OTHER_COLOR} stroke="#fff" strokeWidth={2} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function TipRow({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-6 py-0.5">
      <span className="flex items-center gap-2 text-stone-500">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
        {label}
      </span>
      <span className="font-medium">{fmtNumber(value)}</span>
    </div>
  );
}

function barColor(dim: Dim, row: BotRow) {
  if (dim === 'bot' || dim === 'category') return isAiCategory(dim === 'bot' ? row.category : row.label) ? 'bg-violet-100' : 'bg-emerald-100';
  return 'bg-stone-100';
}

function Rows({ rows, dim, limit, onPick }: { rows: BotRow[]; dim: Dim; limit?: number; onPick: (r: BotRow) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.hits));
  const now = Date.now();
  return (
    <div className="space-y-1">
      {(limit ? rows.slice(0, limit) : rows).map((r, i) => {
        const about = describe(dim, r);
        return (
          <div key={`${r.label}-${i}`} className="group relative flex h-10 cursor-pointer items-center rounded-lg" onClick={() => onPick(r)}>
            <div className={`absolute inset-y-0 left-0 rounded-lg ${barColor(dim, r)}`} style={{ width: `${(r.hits / max) * 100}%`, minWidth: 4 }} />
            <div className="absolute inset-0 hidden rounded-lg ring-1 ring-stone-300/70 group-hover:block" />
            <div className="relative flex min-w-0 flex-1 items-center gap-2.5 px-3 text-[15px]">{label(dim, r)}</div>
            <div className="relative flex shrink-0 items-center gap-2 pr-3 text-[15px] font-medium">
              {r.spoofed > 0 && <span className="text-xs font-normal text-red-500">{fmtNumber(r.spoofed)} fake</span>}
              {r.blocked > 0 && <span className="text-xs font-normal text-amber-600">blocked {fmtNumber(r.blocked)}×</span>}
              {r.verified > 0 && r.verified >= r.hits / 2 && <span className="text-xs font-normal text-emerald-600" title="Verified">✓</span>}
              {fmtNumber(r.hits)}
            </div>
            <div className="pointer-events-none absolute left-1/2 top-full z-30 mt-1 hidden w-72 -translate-x-1/2 rounded-xl bg-ink px-3 py-2 text-xs text-white shadow-lg group-hover:block">
              <div className="truncate font-medium">{dim === 'operator' ? operatorLabel(r.label) : (r.label ?? '(none)')}</div>
              {about && <div className="mb-1 text-stone-300">{about}</div>}
              {dim === 'bot' && r.operator && <TipLine label="Company" value={r.operator} />}
              <TipLine label="Hits" value={fmtNumber(r.hits)} />
              <TipLine label="Verified" value={fmtPct(r.verified / Math.max(1, r.hits))} />
              {r.spoofed > 0 && <TipLine label="Fake (wrong IP)" value={fmtNumber(r.spoofed)} />}
              {r.errors > 0 && <TipLine label="Errors (4xx/5xx)" value={fmtNumber(r.errors)} />}
              {r.blocked > 0 && <TipLine label="Rate-limited" value={`${fmtNumber(r.blocked)}×`} />}
              {dim === 'page' ? <TipLine label="Bots" value={fmtNumber(r.bots)} /> : <TipLine label="Pages" value={fmtNumber(r.pages)} />}
              <TipLine label="Last seen" value={`${fmtAgo(now - r.last_seen)} ago`} />
              <div className="mt-1 text-stone-400">Click to filter</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TipLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-stone-400">{label}</span>
      {value}
    </div>
  );
}

export function BotsPanel() {
  const { site, q, reloadKey } = useDash();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [dim, setDim] = usePref<Dim>('ml_tab_bots', 'bot');
  const [details, setDetails] = useState(false);
  const [search, setSearch] = useState('');
  // Bots have their own filters: the visitor filters above describe people.
  const bq = useMemo(() => ({ ...q, filters }), [q, filters]);
  const { data } = useApi<BotOverview>(`/api/sites/${site.id}/bots?${qs(bq)}`, reloadKey);
  const { data: rows } = useApi<BotRow[]>(`/api/sites/${site.id}/bots/breakdown?${qs(bq, { dim })}`, reloadKey);
  const setup = () => navigate(`/site/${site.id}/settings#bots`);

  const pick = (r: BotRow) => {
    setDetails(false);
    setFilters((f) => ({ ...f, [dim]: r.label ?? '' }));
  };
  const empty = !!data && data.current.hits === 0 && !Object.keys(filters).length;
  const shown = (rows ?? []).filter((r) => !search || (r.label ?? '').toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div>
          <h2 className="text-lg font-semibold">Bots & AI crawlers</h2>
          <p className="text-sm text-stone-500">Who reads {site.domain} besides people: AI models, search engines, link previews and scripts.</p>
        </div>
        <button className="text-sm font-medium text-stone-500 hover:text-ink" onClick={setup}>
          {data?.serverReportAt ? 'Setup & blocking →' : 'Set up server tracking →'}
        </button>
      </div>

      {Object.keys(filters).length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-5 pt-3">
          {Object.entries(filters).map(([k, v]) => (
            <span key={k} className="flex items-center gap-2 rounded-xl border border-stone-200 bg-white py-1 pl-3 pr-1 text-sm shadow-card">
              <span className="text-stone-500">{FILTER_NAMES[k as Dim]} is</span>
              <span className="font-medium">{k === 'operator' ? operatorLabel(v) : v}</span>
              <button
                className="rounded-lg px-1.5 text-stone-400 hover:bg-stone-100 hover:text-ink"
                aria-label="Remove filter"
                onClick={() => setFilters(({ [k]: _, ...rest }) => rest)}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {!data && <div className="m-5 h-[420px] animate-pulse rounded-xl bg-stone-50" />}

      {data && empty && (
        <div className="px-5 pb-10 pt-8 text-center">
          <p className="font-medium">No bots seen in this period</p>
          {!data.serverReportAt ? (
            <>
              <p className="mx-auto mt-2 max-w-xl text-sm text-stone-500">
                AI crawlers such as GPTBot, ClaudeBot and PerplexityBot never run JavaScript, so the tracking script can't see them. A few lines on your
                server report every bot here, and can slow down any bot that floods your site.
              </p>
              <button className="btn-dark mt-4" onClick={setup}>
                Set up bot tracking
              </button>
            </>
          ) : (
            <p className="mt-2 text-sm text-stone-500">Your server is connected; bots will show up here as they visit.</p>
          )}
        </div>
      )}

      {data && !empty && (
        <>
          <div className="mt-4">
            <Kpis c={data.current} p={data.previous} />
          </div>
          <div className="grid gap-5 p-3 lg:grid-cols-2">
            <div className="pt-3">
              <Chart data={data} />
            </div>
            <div className="flex min-h-[360px] flex-col">
              <div className="tabs mb-3 self-start overflow-x-auto">
                {TABS.map((t) => (
                  <button key={t.dim} className={`tab whitespace-nowrap ${t.dim === dim ? 'tab-active' : ''}`} onClick={() => setDim(t.dim)}>
                    {t.label}
                  </button>
                ))}
              </div>
              <div className={`flex-1 ${!rows ? 'animate-pulse' : ''}`}>
                {rows && rows.length === 0 && <p className="p-6 text-center text-sm text-stone-400">No bots for this filter</p>}
                {rows && <Rows rows={rows} dim={dim} limit={8} onPick={pick} />}
              </div>
              {rows && rows.length > 8 && (
                <button className="mx-auto mt-3 text-xs font-semibold uppercase tracking-wider text-stone-500 hover:text-ink" onClick={() => setDetails(true)}>
                  ⛶ Details
                </button>
              )}
            </div>
          </div>
          {!data.serverReportAt && (
            <p className="border-t border-stone-100 px-5 py-3 text-sm text-stone-500">
              Showing only bots that run JavaScript (AI browser agents, Googlebot, headless browsers). AI crawlers like GPTBot and ClaudeBot need{' '}
              <button className="font-medium text-ink underline-offset-2 hover:underline" onClick={setup}>
                server tracking
              </button>
              .
            </p>
          )}
        </>
      )}

      <Modal open={details} onClose={() => setDetails(false)} title={`Bots by ${FILTER_NAMES[dim].toLowerCase()}`} width="max-w-3xl">
        <input className="input mb-4" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-stone-500">
                <th className="pb-2 font-medium">{FILTER_NAMES[dim]}</th>
                <th className="pb-2 text-right font-medium">Hits</th>
                <th className="pb-2 text-right font-medium">Verified</th>
                <th className="pb-2 text-right font-medium">Fake</th>
                <th className="pb-2 text-right font-medium">Blocked</th>
                <th className="pb-2 text-right font-medium">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={i} className="cursor-pointer border-t border-stone-100 hover:bg-stone-50" onClick={() => pick(r)}>
                  <td className="max-w-[320px] py-2">
                    <div className="flex min-w-0 items-center gap-2">{label(dim, r)}</div>
                  </td>
                  <td className="py-2 text-right">{fmtNumber(r.hits)}</td>
                  <td className="py-2 text-right">{fmtPct(r.verified / Math.max(1, r.hits))}</td>
                  <td className="py-2 text-right">{r.spoofed ? fmtNumber(r.spoofed) : '—'}</td>
                  <td className="py-2 text-right">{r.blocked ? `${fmtNumber(r.blocked)}×` : '—'}</td>
                  <td className="py-2 text-right text-stone-500">{fmtAgo(Date.now() - r.last_seen)} ago</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
    </div>
  );
}
