import { useEffect, useState } from 'react';
import { navigate, useMe } from '../App';
import { Favicon } from '../components/Icons';
import { Logo } from '../components/Logo';
import { Modal } from '../components/Modal';
import { Area, Bar, ComposedChart, ResponsiveContainer, YAxis } from 'recharts';
import { currencyDecimals } from '../../shared/currency';
import { api, type Site, type SiteSpark } from '../lib/api';
import { fmtMoney, fmtNumber } from '../lib/format';
import { usePref } from '../lib/prefs';
import { useApi } from '../lib/useApi';

const PERIODS = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
];
const AUTO_REFRESH_MS = 60_000;

export function Sites() {
  const { me } = useMe();
  const [adding, setAdding] = useState(false);
  const [period, setPeriod] = usePref('ml_sites_period', '30d');
  const [reloadKey, setReloadKey] = useState(0);
  const { data: sites, loading: loadingSites } = useApi<Site[]>('/api/sites', reloadKey);
  const { data: sparks, loading: loadingSparks } = useApi<SiteSpark[]>(`/api/sites-overview?period=${period}`, reloadKey);
  const loading = loadingSites || loadingSparks;

  useEffect(() => {
    if (sites && !sites.length) setAdding(true);
  }, [sites]);

  // Keep the numbers fresh while the page sits open.
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && setReloadKey((k) => k + 1), AUTO_REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    window.dispatchEvent(new Event('ml:logout'));
  }

  const bySite = new Map(sparks?.map((s) => [s.id, s]));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
      <div className="flex items-center justify-between">
        <Logo />
        <div className="flex items-center gap-2">
          {me.hosted && me.user && (
            <button className="hidden items-center gap-2 rounded-xl px-2 py-1 text-sm text-stone-600 hover:bg-stone-100 sm:flex" onClick={() => navigate('/billing')} title="Plan & billing">
              {me.user.avatar ? <img src={me.user.avatar} alt="" className="h-7 w-7 rounded-full" referrerPolicy="no-referrer" /> : null}
              {me.user.email}
            </button>
          )}
          <button className="btn" onClick={logout}>
            Log out
          </button>
          <button className="btn-dark" onClick={() => setAdding(true)}>
            + Add website
          </button>
        </div>
      </div>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Your websites</h1>
        <div className="flex items-center gap-2">
          <div className="tabs">
            {PERIODS.map((p) => (
              <button key={p.value} className={`tab ${period === p.value ? 'tab-active' : ''}`} onClick={() => setPeriod(p.value)}>
                {p.label}
              </button>
            ))}
          </div>
          <button className="btn h-10 w-10 px-0" onClick={() => setReloadKey((k) => k + 1)} aria-label="Refresh" title="Refresh">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={loading ? 'animate-spin' : ''}>
              <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sites && sites.length > 1 && <AllSitesCard sites={sites} sparks={sparks} />}
        {sites?.map((s) => {
          const spark = bySite.get(s.id);
          return (
            <button key={s.id} onClick={() => navigate(`/site/${s.id}`)} className="card p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-center gap-3">
                <Favicon domain={s.domain} size={24} />
                <div className="min-w-0 flex-1 truncate font-semibold">{s.name}</div>
                {!!spark?.online && <Online n={spark.online} />}
              </div>
              <Sparkline series={spark?.series} />
              <Totals visitors={spark?.visitors} revenue={spark ? [{ currency: s.currency, amount: spark.revenue }] : undefined} />
            </button>
          );
        })}
        {sites && !sites.length && (
          <div className="card col-span-full p-10 text-center text-stone-500">No websites yet. Add your first one to get a tracking snippet.</div>
        )}
      </div>
      <AddSite open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

/** Every site added together. Revenue is only summed within a currency. */
function AllSitesCard({ sites, sparks }: { sites: Site[]; sparks: SiteSpark[] | null }) {
  const currency = new Map(sites.map((s) => [s.id, s.currency]));
  const series = sparks?.[0]?.series.map((_, i) => ({
    visitors: sparks.reduce((n, s) => n + s.series[i].visitors, 0),
    revenue: sparks.reduce((n, s) => n + s.series[i].revenue, 0),
  }));
  const revenue = new Map<string, number>();
  for (const s of sparks ?? []) {
    const c = currency.get(s.id) ?? 'USD';
    revenue.set(c, (revenue.get(c) ?? 0) + s.revenue);
  }
  const online = sparks?.reduce((n, s) => n + s.online, 0) ?? 0;
  return (
    <div className="card p-5">
      <div className="flex items-center gap-3">
        <div className="flex -space-x-2">
          {sites.slice(0, 3).map((s) => (
            <span key={s.id} className="rounded-md ring-2 ring-white">
              <Favicon domain={s.domain} size={20} />
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1 truncate font-semibold">{sites.length} websites</div>
        {!!online && <Online n={online} />}
      </div>
      <Sparkline series={series} />
      <Totals visitors={sparks?.reduce((n, s) => n + s.visitors, 0)} revenue={sparks ? [...revenue].map(([currency, amount]) => ({ currency, amount })) : undefined} />
    </div>
  );
}

function Online({ n }: { n: number }) {
  return (
    <span className="flex items-center gap-1.5 text-sm text-emerald-600" title={`${n} online now`}>
      <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
      {n}
    </span>
  );
}

function Sparkline({ series }: { series?: { visitors: number; revenue: number }[] }) {
  if (!series) return <div className="mt-4 h-20 animate-pulse rounded-lg bg-stone-100" />;
  return (
    <div className="mt-4 h-20">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={series} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8dbdf0" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#8dbdf0" stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis yAxisId="v" hide domain={[0, 'dataMax']} />
          <YAxis yAxisId="r" hide domain={[0, 'dataMax']} />
          <Bar yAxisId="r" dataKey="revenue" fill="#e07b5f" radius={[2, 2, 0, 0]} maxBarSize={6} isAnimationActive={false} />
          <Area yAxisId="v" type="monotone" dataKey="visitors" stroke="#8dbdf0" strokeWidth={2} fill="url(#spark-fill)" isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function Totals({ visitors, revenue }: { visitors?: number; revenue?: { currency: string; amount: number }[] }) {
  const paid = revenue?.filter((r) => r.amount !== 0) ?? [];
  return (
    <div className="mt-3 text-sm text-stone-500">
      <span className="font-semibold text-ink">{visitors === undefined ? '—' : fmtNumber(visitors)}</span> visitors
      {' · '}
      <span className="font-semibold text-ink">
        {revenue === undefined ? '—' : paid.length ? paid.map((r) => fmtMoney(r.amount, r.currency, currencyDecimals(r.currency), true)).join(' + ') : fmtMoney(0, revenue[0]?.currency ?? 'USD', 0)}
      </span>{' '}
      revenue
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
