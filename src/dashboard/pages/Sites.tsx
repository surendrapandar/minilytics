import { useEffect, useState } from 'react';
import { navigate, useMe } from '../App';
import { Favicon } from '../components/Icons';
import { Logo } from '../components/Logo';
import { Modal } from '../components/Modal';
import { TrendSparkline } from '../components/TrendSparkline';
import { api, type Site, type SiteTrends } from '../lib/api';
import { fmtNumber } from '../lib/format';
import { useApi } from '../lib/useApi';

const TREND_PERIODS = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '12m', label: 'Last 12 months' },
] as const;

type TrendPeriod = (typeof TREND_PERIODS)[number]['value'];
type TrendMetric = 'visitors' | 'pageviews' | 'sessions';
const TREND_METRICS: { value: TrendMetric; label: string }[] = [
  { value: 'visitors', label: 'Visitors' },
  { value: 'pageviews', label: 'Pageviews' },
  { value: 'sessions', label: 'Sessions' },
];

export function Sites() {
  const { me } = useMe();
  const [sites, setSites] = useState<Site[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [period, setPeriod] = useState<TrendPeriod>('7d');
  const [retryKey, setRetryKey] = useState(0);
  const [metrics, setMetrics] = useState<Record<string, TrendMetric>>({});

  // A single period control drives one shared API request for all site cards.
  const { data: trends, loading, error } = useApi<SiteTrends>(`/api/sites/trends?period=${period}`, retryKey);

  useEffect(() => {
    api<Site[]>('/api/sites').then((s) => {
      setSites(s);
      if (!s.length) setAdding(true);
    });
  }, []);

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    window.dispatchEvent(new Event('ml:logout'));
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="sm:hidden"><Logo small /></div>
        <div className="hidden sm:block"><Logo /></div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {me.hosted && me.user && (
            <button className="hidden items-center gap-2 rounded-xl px-2 py-1 text-sm text-stone-600 hover:bg-stone-100 sm:flex" onClick={() => navigate('/billing')} title="Plan & billing">
              {me.user.avatar ? <img src={me.user.avatar} alt="" className="h-7 w-7 rounded-full" referrerPolicy="no-referrer" /> : null}
              {me.user.email}
            </button>
          )}
          <button className="btn px-2.5 sm:px-3.5" onClick={logout}>Log out</button>
          <button className="btn-dark px-2.5 sm:px-4" onClick={() => setAdding(true)}>
            <span className="sm:hidden">+ Add</span><span className="hidden sm:inline">+ Add website</span>
          </button>
        </div>
      </div>

      <div className="mt-10 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Your websites</h1>
          <p className="mt-1 text-sm text-stone-500">Visitor trends across all your sites</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="site-trend-period" className="text-sm text-stone-500">Period</label>
          <select
            id="site-trend-period"
            className="input w-auto min-w-[160px] text-sm"
            value={period}
            onChange={(event) => setPeriod(event.target.value as TrendPeriod)}
          >
            {TREND_PERIODS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <span>Could not load visitor trends. {error}</span>
          <button className="font-medium underline" onClick={() => setRetryKey((key) => key + 1)}>Retry</button>
        </div>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sites?.map((s) => {
          const trend = trends?.period === period ? trends.sites[s.id] : undefined;
          const ready = !loading && !error && trends?.period === period;
          const metric = metrics[s.id] ?? 'visitors';
          return (
            <div key={s.id} className="card p-5 text-left">
              <div className="flex items-center gap-3">
                <Favicon domain={s.domain} size={28} />
                <div className="min-w-0">
                  <div className="truncate font-semibold">{s.name}</div>
                  <div className="truncate text-sm text-stone-500">{s.domain}</div>
                </div>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <div>
                  <div className="text-2xl font-semibold">{ready ? fmtNumber(trend?.visitors ?? 0) : '—'}</div>
                  <div className="text-xs text-stone-500">visitors in period</div>
                </div>
                <div>
                  <div className="text-2xl font-semibold">{ready ? fmtNumber(trend?.pageviews ?? 0) : '—'}</div>
                  <div className="text-xs text-stone-500">pageviews in period</div>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between gap-2">
                <label htmlFor={`metric-${s.id}`} className="text-xs text-stone-500">Trend</label>
                <select
                  id={`metric-${s.id}`}
                  aria-label={`${s.name} trend metric`}
                  className="input w-auto min-w-0 max-w-[70%] py-1 text-xs"
                  value={metric}
                  onChange={(event) => setMetrics((previous) => ({ ...previous, [s.id]: event.target.value as TrendMetric }))}
                >
                  {TREND_METRICS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
              <div className="mt-2" aria-busy={loading}>
                {!ready ? (
                  <div className="h-20 animate-pulse rounded-xl bg-stone-100" />
                ) : (
                  <TrendSparkline values={(trend?.series ?? []).map((point) => point[metric])} buckets={trends?.buckets ?? []} name={s.name} metric={metric} />
                )}
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-stone-100 pt-3">
                <div className="flex items-center gap-1.5 text-xs text-stone-500">
                  <span className={`h-2 w-2 rounded-full ${s.online ? 'animate-pulse bg-green-500' : 'bg-stone-300'}`} />
                  {s.online} online now
                </div>
                <button className="text-xs font-medium text-stone-600 hover:underline" onClick={() => navigate(`/site/${s.id}?period=${period}`)}>View dashboard →</button>
              </div>
            </div>
          );
        })}
        {sites && !sites.length && (
          <div className="card col-span-full p-10 text-center text-stone-500">No websites yet. Add your first one to get a tracking snippet.</div>
        )}
      </div>
      {sites?.length ? <p className="mt-4 text-xs text-stone-400">All trend periods use UTC dates for consistent cross-site comparisons.</p> : null}
      <AddSite open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'SGD', 'JPY', 'BRL'];

function AddSite({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [domain, setDomain] = useState('');
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [currency, setCurrency] = useState('USD');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const site = await api<Site>('/api/sites', { method: 'POST', json: { domain, name, timezone, currency } });
      navigate(`/site/${site.id}/settings`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a website" width="max-w-md">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">Domain</label>
          <input className="input" placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} autoFocus />
          <p className="mt-1 text-xs text-stone-500">Subdomains (app.example.com) are tracked under the same site.</p>
        </div>
        <div>
          <label className="label">Name</label>
          <input className="input" placeholder="My SaaS" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Timezone</label>
            <input className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
          </div>
          <div>
            <label className="label">Revenue currency</label>
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-dark w-full" disabled={!domain}>
          Add website
        </button>
      </form>
    </Modal>
  );
}
