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

export function Sites() {
  const { me } = useMe();
  const [sites, setSites] = useState<Site[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [period, setPeriod] = useState<TrendPeriod>('7d');
  const [retryKey, setRetryKey] = useState(0);

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
      <div className="flex items-center justify-between">
        <Logo />
        <div className="flex items-center gap-2">
          {me.hosted && me.user && (
            <button className="hidden items-center gap-2 rounded-xl px-2 py-1 text-sm text-stone-600 hover:bg-stone-100 sm:flex" onClick={() => navigate('/billing')} title="Plan & billing">
              {me.user.avatar ? <img src={me.user.avatar} alt="" className="h-7 w-7 rounded-full" referrerPolicy="no-referrer" /> : null}
              {me.user.email}
            </button>
          )}
          <button className="btn" onClick={logout}>Log out</button>
          <button className="btn-dark" onClick={() => setAdding(true)}>+ Add website</button>
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
          return (
            <button key={s.id} onClick={() => navigate(`/site/${s.id}?period=${period}`)} className="card p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md">
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
              <div className="mt-4" aria-busy={loading}>
                {!ready ? (
                  <div className="h-20 animate-pulse rounded-xl bg-stone-100" />
                ) : (
                  <TrendSparkline values={trend?.series ?? []} name={s.name} />
                )}
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-stone-100 pt-3">
                <div className="flex items-center gap-1.5 text-xs text-stone-500">
                  <span className={`h-2 w-2 rounded-full ${s.online ? 'animate-pulse bg-green-500' : 'bg-stone-300'}`} />
                  {s.online} online now
                </div>
                <span className="text-xs font-medium text-stone-600">View dashboard →</span>
              </div>
            </button>
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
