import { useEffect, useState } from 'react';
import { navigate, useMe } from '../App';
import { Favicon } from '../components/Icons';
import { Logo } from '../components/Logo';
import { Modal } from '../components/Modal';
import { PeriodPicker, PERIODS } from '../components/Toolbar';
import { api, qs, type Site, type SiteSummary } from '../lib/api';
import { fmtMoney, fmtNumber } from '../lib/format';
import { useApi } from '../lib/useApi';
import { useQueryState } from '../lib/useQueryState';

export function Sites() {
  const { me } = useMe();
  const [q, update] = useQueryState('24h');
  const query = qs({ period: q.period, from: q.from, to: q.to, filters: {} });
  const url = `/api/sites?${query}`;
  const periodLabel = PERIODS.find((p) => p.value === q.period)?.label ?? 'Custom range';
  const [reloadKey, setReloadKey] = useState(0);
  const { data, dataUrl, error } = useApi<SiteSummary[]>(url, reloadKey);
  const sites = dataUrl === url ? data : null;
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setReloadKey((key) => key + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (sites?.length === 0) setAdding(true);
  }, [sites?.length]);

  let activeUsers = 0;
  const revenueByCurrency = new Map<string, { amount: number; decimals: number }>();
  for (const site of sites ?? []) {
    activeUsers += site.online;
    const total = revenueByCurrency.get(site.currency);
    if (total) total.amount += site.revenue;
    else revenueByCurrency.set(site.currency, { amount: site.revenue, decimals: site.decimals });
  }

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
          <button className="btn" onClick={logout}>
            Log out
          </button>
          <button className="btn-dark" onClick={() => setAdding(true)}>
            + Add website
          </button>
        </div>
      </div>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Your websites</h1>
        <div className="ml-auto"><PeriodPicker q={q} update={update} align="right" /></div>
      </div>
      <p className="mt-2 text-xs text-stone-500">Dates follow each website’s timezone.</p>
      <section className="card mt-5 overflow-hidden" aria-labelledby="all-websites-heading">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-5 py-4">
          <h2 id="all-websites-heading" className="text-sm font-semibold">All websites</h2>
          <span className="text-xs text-stone-500">Updates every 30 seconds</span>
        </div>
        <dl className="grid divide-y divide-stone-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <div className="p-5 sm:p-6">
            <dt className="flex items-center gap-2 text-sm text-stone-600">
              <span className={`h-2 w-2 rounded-full ${activeUsers ? 'animate-pulse bg-green-500' : 'bg-stone-300'}`} aria-hidden="true" />
              Active users
            </dt>
            <dd className="mt-2 text-3xl font-semibold tabular-nums">{sites ? fmtNumber(activeUsers) : '—'}</dd>
            <p className="mt-2 text-xs text-stone-500">Active in the last 5 minutes · summed across websites</p>
          </div>
          <div className="p-5 sm:p-6">
            <dt className="text-sm text-stone-600">Revenue · {periodLabel}</dt>
            <dd className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-3xl font-semibold tabular-nums text-revenue">
              {sites?.length ? [...revenueByCurrency].map(([currency, total]) => (
                <span key={currency} className="min-w-0 break-all">
                  {fmtMoney(total.amount, currency, total.decimals)}
                  <span className="ml-2 text-xs font-medium text-stone-500">{currency}</span>
                </span>
              )) : sites ? '0' : '—'}
            </dd>
            <p className="mt-2 text-xs text-stone-500">
              Net of refunds{revenueByCurrency.size > 1 ? ' · currencies shown separately' : ' · across all websites'}
            </p>
          </div>
        </dl>
      </section>
      {error && <p role="alert" className="mt-4 text-sm text-red-600">{sites ? 'Unable to refresh. Showing the last loaded data.' : 'Unable to load websites.'} {error}</p>}
      {!sites && !error && <p role="status" className="mt-5 text-sm text-stone-500">Loading websites…</p>}
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sites?.map((s) => (
          <button key={s.id} onClick={() => navigate(`/site/${s.id}?${query}`)} className="card min-w-0 p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="flex items-center gap-3">
              <Favicon domain={s.domain} size={28} />
              <div className="min-w-0">
                <div className="truncate font-semibold">{s.name}</div>
                <div className="truncate text-sm text-stone-500">{s.domain}</div>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-4">
              <div className="min-w-0">
                <div className="break-all text-2xl font-semibold tabular-nums">{fmtNumber(s.visitors)}</div>
                <div className="mt-1 text-xs text-stone-500">Visitors</div>
              </div>
              <div className="min-w-0 text-right">
                <div className="break-all text-2xl font-semibold tabular-nums text-revenue">{fmtMoney(s.revenue, s.currency, s.decimals)}</div>
                <div className="mt-1 text-xs text-stone-500">Revenue</div>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-stone-100 pt-3 text-xs text-stone-500">
              <span className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${s.online ? 'animate-pulse bg-green-500' : 'bg-stone-300'}`} aria-hidden="true" />
                {fmtNumber(s.online)} online
              </span>
              <span>{periodLabel} · {s.currency}</span>
            </div>
          </button>
        ))}
        {sites && !sites.length && (
          <div className="card col-span-full p-10 text-center text-stone-500">No websites yet. Add your first one to get a tracking snippet.</div>
        )}
      </div>
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
