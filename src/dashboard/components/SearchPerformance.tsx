import { useEffect, useState } from 'react';
import { api, type Site } from '../lib/api';
import { SelectDropdown } from './SelectDropdown';

type Row = { label: string; clicks: number; impressions: number; ctr: number; position: number };
type Dimension = 'query' | 'page' | 'country' | 'device';
type Result = { connected: boolean; rows: Row[]; property: string | null; from?: string; to?: string };
const DIMENSIONS: { value: Dimension; label: string }[] = [
  { value: 'query', label: 'Queries' },
  { value: 'page', label: 'Pages' },
  { value: 'country', label: 'Countries' },
  { value: 'device', label: 'Devices' },
];
const fmt = new Intl.NumberFormat('en-US');
const pct = (value: number) => (100 * value).toFixed(1) + '%';
const date = (offset: number) => {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  now.setUTCDate(now.getUTCDate() + offset);
  return now.toISOString().slice(0, 10);
};

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

  useEffect(() => { setProperty(site.gsc_property ?? ''); }, [site.id, site.gsc_property]);
  useEffect(() => {
    if (!site.gsc_property) { setData(null); return; }
    let cancelled = false;
    setBusy(true);
    setError('');
    const params = new URLSearchParams({ dimension, from, to });
    api<Result>(`/api/sites/${site.id}/gsc?${params}`)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((e: Error) => { if (!cancelled) { setError(e.message); setData(null); } })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [site.id, site.gsc_property, dimension, from, to, reload]);

  async function showProperties() {
    setEditing(true);
    setError('');
    try {
      const response = await api<{ properties: string[] }>(`/api/sites/${site.id}/gsc/properties`);
      setProperties(response.properties);
    } catch (e) { setError((e as Error).message); }
  }
  async function saveProperty(value: string | null) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/sites/${site.id}/gsc`, { method: 'PUT', json: { property: value } });
      // The site object is loaded by the parent; update without a page reload through navigation refresh.
      window.location.reload();
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  const rows = data?.rows ?? [];
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  const position = impressions ? rows.reduce((sum, row) => sum + row.position * row.impressions, 0) / impressions : 0;

  return (
    <section className="card min-w-0 p-4 sm:p-5" aria-label="Search Performance">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Search Performance</h2>
          <p className="mt-0.5 text-xs text-stone-500">Google Search Console · Search dates in Pacific Time</p>
        </div>
        <button type="button" className="btn text-xs" onClick={showProperties}>
          {site.gsc_property ? 'Change property' : 'Connect Search Console'}
        </button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      {editing && (
        <div className="mt-4 rounded-xl bg-stone-50 p-3">
          <p className="mb-2 text-sm font-medium">Choose a Search Console property</p>
          <div className="flex flex-wrap items-center gap-2">
            {properties.length > 0 ? (
              <SelectDropdown
                value={property}
                ariaLabel="Search Console property"
                options={properties.map((item) => ({ value: item, label: item }))}
                onChange={setProperty}
                className="min-w-0 flex-1"
                buttonClassName="input"
              />
            ) : (
              <input className="input min-w-0 flex-1" placeholder="sc-domain:example.com" value={property}
                onChange={(event) => setProperty(event.target.value)} />
            )}
            <button type="button" className="btn-dark" disabled={busy || !property} onClick={() => saveProperty(property)}>Connect</button>
            {site.gsc_property && <button type="button" className="btn" disabled={busy} onClick={() => saveProperty(null)}>Disconnect</button>}
            <button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button>
          </div>
          <p className="mt-2 text-xs text-stone-500">Grant your Cloudflare service account access to the exact GSC property first. Only administrators can connect properties.</p>
        </div>
      )}
      {!site.gsc_property ? (
        <p className="mt-5 text-sm text-stone-500">Connect a Search Console property to view Google search queries and landing pages.</p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <label className="min-w-0 text-xs text-stone-500">From
              <input className="input mt-1 w-[145px] max-w-full" type="date" value={from} max={date(-1)} onChange={(event) => setFrom(event.target.value)} />
            </label>
            <label className="min-w-0 text-xs text-stone-500">To
              <input className="input mt-1 w-[145px] max-w-full" type="date" value={to} max={date(-1)} onChange={(event) => setTo(event.target.value)} />
            </label>
            <SelectDropdown value={dimension} options={DIMENSIONS}
              onChange={(value) => setDimension(value as Dimension)} ariaLabel="Search dimension"
              className="w-[145px]" buttonClassName="input" />
            <button className="btn" onClick={() => setReload((v) => v + 1)} disabled={busy}>Refresh</button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Clicks', fmt.format(clicks)],
              ['Impressions', fmt.format(impressions)],
              ['CTR', impressions ? pct(clicks / impressions) : '—'],
              ['Avg. position', impressions ? position.toFixed(1) : '—'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-stone-50 p-3">
                <div className="text-xs text-stone-500">{label}</div>
                <div className="mt-1 text-xl font-semibold">{busy ? '…' : value}</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-stone-400">Metrics summarize returned top rows, not necessarily all GSC traffic. Privacy-filtered queries may be omitted.</p>
          <div className="mt-4 max-h-[420px] overflow-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="sticky top-0 bg-white text-xs text-stone-500">
                <tr><th className="pb-2 font-medium">{DIMENSIONS.find((d) => d.value === dimension)?.label}</th>
                  <th className="pb-2 text-right font-medium">Clicks</th>
                  <th className="pb-2 text-right font-medium">Impressions</th>
                  <th className="pb-2 text-right font-medium">CTR</th>
                  <th className="pb-2 text-right font-medium">Position</th></tr>
              </thead>
              <tbody>{rows.map((row) => (
                <tr key={row.label} className="border-t border-stone-100">
                  <td className="max-w-[320px] truncate py-2 pr-3" title={row.label}>{row.label}</td>
                  <td className="py-2 text-right">{fmt.format(row.clicks)}</td>
                  <td className="py-2 text-right">{fmt.format(row.impressions)}</td>
                  <td className="py-2 text-right">{pct(row.ctr)}</td>
                  <td className="py-2 text-right">{row.position.toFixed(1)}</td>
                </tr>
              ))}</tbody>
            </table>
            {!busy && !rows.length && !error && <p className="py-5 text-center text-sm text-stone-500">No search data for this period.</p>}
          </div>
        </>
      )}
    </section>
  );
}
