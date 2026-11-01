import { useEffect, useState } from 'react';
import { api, type Site } from '../lib/api';
import { monotoneCurvePath } from '../lib/curvePath';
import { GscTrendChart } from './GscTrendChart';
import { SelectDropdown } from './SelectDropdown';

export type GscTotals = { clicks: number; impressions: number; ctr: number; position: number };
export type GscDaily = GscTotals & { date: string };
type Row = { label: string } & GscTotals;
type Dimension = 'query' | 'page' | 'country' | 'device';
type Result = {
  connected: boolean; rows: Row[]; property: string | null; from?: string; to?: string;
  totals: GscTotals; previous: GscTotals; series: GscDaily[];
};
type Metric = keyof GscTotals;
const DIMENSIONS: { value: Dimension; label: string }[] = [
  { value: 'query', label: 'Queries' },
  { value: 'page', label: 'Pages' },
  { value: 'country', label: 'Countries' },
  { value: 'device', label: 'Devices' },
];
const METRICS: { key: Metric; label: string }[] = [
  { key: 'clicks', label: 'Clicks' }, { key: 'impressions', label: 'Impressions' },
  { key: 'ctr', label: 'CTR' }, { key: 'position', label: 'Avg. position' },
];
const fmt = new Intl.NumberFormat('en-US');
const pct = (value: number) => (100 * value).toFixed(1) + '%';
const date = (offset: number) => {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  now.setUTCDate(now.getUTCDate() + offset);
  return now.toISOString().slice(0, 10);
};

function metricValue(metric: Metric, totals: GscTotals): string {
  if (metric === 'clicks' || metric === 'impressions') return fmt.format(totals[metric]);
  if (!totals.impressions) return '—';
  return metric === 'ctr' ? pct(totals.ctr) : totals.position.toFixed(1);
}

function metricChange(metric: Metric, current: GscTotals, previous: GscTotals) {
  if ((metric === 'ctr' || metric === 'position') && (!current.impressions || !previous.impressions)) {
    return { text: '—', tone: 'neutral' };
  }
  const a = current[metric];
  const b = previous[metric];
  if (metric === 'ctr' || metric === 'position') {
    const difference = a - b;
    const change = metric === 'ctr' ? difference * 100 : difference;
    const good = metric === 'position' ? difference < 0 : difference > 0;
    return { text: (change > 0 ? '+' : '') + change.toFixed(1) + (metric === 'ctr' ? ' pp' : ''),
      tone: change === 0 ? 'neutral' : good ? 'good' : 'bad' };
  }
  if (!b) return { text: a ? 'New' : '—', tone: 'neutral' };
  const change = ((a - b) / b) * 100;
  return { text: (change > 0 ? '+' : '') + Math.round(change) + '%',
    tone: change === 0 ? 'neutral' : change > 0 ? 'good' : 'bad' };
}

/** A compact SVG curve based only on actual Google date buckets, never placeholder data. */
function MiniTrend({ metric, series }: { metric: Metric; series: GscDaily[] }) {
  const values = series.filter((point) => metric !== 'position' || point.impressions > 0).map((point) => point[metric]);
  if (!values.length || values.every((value) => value === 0)) {
    return <span className="text-xs text-stone-400">No trend</span>;
  }
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low;
  const points = values.map((value, index) => ({
    x: 2 + (index / Math.max(1, values.length - 1)) * 94,
    y: span ? 33 - ((value - low) / span) * 26 : 20,
  }));
  const path = monotoneCurvePath(points);
  const fill = path + ' L96,40 L2,40 Z';
  return (
    <svg className="h-11 w-24 shrink-0" viewBox="0 0 98 42" aria-hidden="true">
      <path d={fill} fill="#dbeafe" opacity=".45" />
      <path d={path} stroke="#659fdf" strokeWidth="1.9" strokeLinecap="round"
        strokeLinejoin="round" vectorEffect="non-scaling-stroke" fill="none" />
    </svg>
  );
}

function MetricCard({ metric, label, current, previous, series }: {
  metric: Metric; label: string; current: GscTotals; previous: GscTotals; series: GscDaily[];
}) {
  const change = metricChange(metric, current, previous);
  const tone = change.tone === 'good' ? 'bg-emerald-50 text-emerald-700'
    : change.tone === 'bad' ? 'bg-red-50 text-red-600' : 'bg-stone-100 text-stone-500';
  return (
    <div className="min-w-0 rounded-xl border border-stone-200/80 bg-white px-3 py-3.5 sm:px-4">
      <div className="text-xs text-stone-500">{label}</div>
      <div className="mt-2 flex min-w-0 flex-col items-start gap-1 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 truncate text-xl font-semibold tracking-tight sm:text-2xl">
          {metricValue(metric, current)}
        </div>
        <MiniTrend metric={metric} series={series} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className={'rounded-md px-1.5 py-0.5 font-medium ' + tone}>{change.text}</span>
        <span className="text-stone-400">vs. previous period</span>
      </div>
    </div>
  );
}

export function SearchPerformance({ site }: { site: Site }) {
  const [dimension, setDimension] = useState<Dimension>('query');
  const [from, setFrom] = useState(() => date(-30));
  const [to, setTo] = useState(() => date(-3));
  const [property, setProperty] = useState(site.gsc_property ?? '');
  const [properties, setProperties] = useState<string[]>([]);
  const [data, setData] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const invalidRange = from > to;

  useEffect(() => { setProperty(site.gsc_property ?? ''); }, [site.id, site.gsc_property]);
  useEffect(() => {
    if (!site.gsc_property || invalidRange) { setData(null); setBusy(false); return; }
    let cancelled = false;
    setBusy(true);
    setData(null);
    setError('');
    const params = new URLSearchParams({ dimension, from, to });
    api<Result>('/api/sites/' + site.id + '/gsc?' + params)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((e: Error) => { if (!cancelled) { setError(e.message); setData(null); } })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [site.id, site.gsc_property, dimension, from, to, reload, invalidRange]);

  async function showProperties() {
    setEditing(true);
    setError('');
    try {
      const response = await api<{ properties: string[] }>('/api/sites/' + site.id + '/gsc/properties');
      setProperties(response.properties);
    } catch (e) { setError((e as Error).message); }
  }
  async function saveProperty(value: string | null) {
    setBusy(true);
    setError('');
    try {
      await api('/api/sites/' + site.id + '/gsc', { method: 'PUT', json: { property: value } });
      // The parent owns site state; reload the site mapping after a property change.
      window.location.reload();
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  const rows = data?.rows ?? [];
  return (
    <section className="card min-w-0 p-4 sm:p-5" aria-label="Search Performance">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Search Performance</h2>
          <p className="mt-0.5 text-xs text-stone-500">Google Search Console · Search dates in Pacific Time</p>
        </div>
        <button type="button" className="btn text-xs" onClick={showProperties}>
          {site.gsc_property ? 'Change property' : 'Connect Search Console'}
        </button>
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {editing && (
        <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-3">
          <p className="mb-2 text-sm font-medium">Choose a Search Console property</p>
          <div className="flex flex-wrap items-center gap-2">
            {properties.length > 0 ? (
              <SelectDropdown value={property} ariaLabel="Search Console property"
                options={properties.map((item) => ({ value: item, label: item }))}
                onChange={setProperty} className="min-w-0 flex-1" buttonClassName="input" />
            ) : (
              <input className="input min-w-0 flex-1" placeholder="sc-domain:example.com" value={property}
                onChange={(event) => setProperty(event.target.value)} />
            )}
            <button type="button" className="btn-dark" disabled={busy || !property} onClick={() => saveProperty(property)}>Connect</button>
            {site.gsc_property && <button type="button" className="btn" disabled={busy} onClick={() => saveProperty(null)}>Disconnect</button>}
            <button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button>
          </div>
          <p className="mt-2 text-xs text-stone-500">
            Grant the service account access to the exact property first. Only administrators can connect properties.
          </p>
        </div>
      )}
      {!site.gsc_property ? (
        <p className="mt-5 text-sm text-stone-500">Connect a Search Console property to view search performance.</p>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-end gap-2 rounded-xl border border-stone-200/80 bg-stone-50/70 p-3">
            <label className="min-w-0 text-xs text-stone-500">From
              <input className="input mt-1 w-[150px] max-w-full" type="date" value={from} max={date(-1)}
                onChange={(event) => setFrom(event.target.value)} />
            </label>
            <label className="min-w-0 text-xs text-stone-500">To
              <input className="input mt-1 w-[150px] max-w-full" type="date" value={to} max={date(-1)}
                onChange={(event) => setTo(event.target.value)} />
            </label>
            <div className="w-[150px] min-w-0">
              <span className="mb-1 block text-xs text-stone-500">Breakdown</span>
              <SelectDropdown value={dimension} options={DIMENSIONS}
                onChange={(value) => setDimension(value as Dimension)} ariaLabel="Search dimension"
                buttonClassName="input" />
            </div>
            <button type="button" className="btn" onClick={() => setReload((v) => v + 1)} disabled={busy || invalidRange}>
              Refresh
            </button>
          </div>
          {invalidRange && <p role="alert" className="mt-2 text-xs text-red-600">From must be on or before To.</p>}

          {busy && !data ? (
            <div className="mt-4 space-y-3" role="status" aria-label="Loading Search Console performance">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
                {METRICS.map((metric) => <div key={metric.key} className="h-28 animate-pulse rounded-xl bg-stone-100" />)}
              </div>
              <div className="h-64 animate-pulse rounded-xl bg-stone-100" />
            </div>
          ) : data ? (
            <>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
                {METRICS.map(({ key, label }) => (
                  <MetricCard key={key} metric={key} label={label}
                    current={data.totals} previous={data.previous} series={data.series} />
                ))}
              </div>
              <GscTrendChart series={data.series} />
              <p className="mt-3 text-xs leading-relaxed text-stone-500">
                Search Console site totals can differ from the top query rows below because anonymized queries
                may be omitted. Search data can lag several days.
              </p>
              <div className="mt-4 min-w-0 overflow-hidden rounded-xl border border-stone-200/80">
                <div className="max-h-[420px] overflow-auto">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead className="sticky top-0 z-10 bg-stone-50 text-xs text-stone-500">
                      <tr>
                        <th scope="col" className="px-3 py-3 font-medium sm:px-4">
                          {DIMENSIONS.find((d) => d.value === dimension)?.label}
                        </th>
                        <th scope="col" className="px-3 py-3 text-right font-medium">Clicks</th>
                        <th scope="col" className="px-3 py-3 text-right font-medium">Impressions</th>
                        <th scope="col" className="px-3 py-3 text-right font-medium">CTR</th>
                        <th scope="col" className="px-3 py-3 text-right font-medium sm:pr-4">Position</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.label} className="border-t border-stone-100 hover:bg-stone-50/80">
                          <td className="max-w-[340px] truncate px-3 py-2.5 sm:px-4" title={row.label}>{row.label}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{fmt.format(row.clicks)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{fmt.format(row.impressions)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{pct(row.ctr)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums sm:pr-4">{row.position.toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!rows.length && <p className="p-6 text-center text-sm text-stone-500">No {dimension} data for this period.</p>}
                </div>
              </div>
            </>
          ) : !error && !invalidRange ? (
            <p className="mt-5 text-sm text-stone-500">No search data for this period.</p>
          ) : null}
        </>
      )}
    </section>
  );
}
