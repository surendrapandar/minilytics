import { useEffect, useRef, useState } from 'react';
import { navigate, useMe } from '../App';
import { Favicon } from '../components/Icons';
import { Logo } from '../components/Logo';
import { Modal } from '../components/Modal';
import { TrendSparkline } from '../components/TrendSparkline';
import { api, type Site, type SiteTrends } from '../lib/api';
import { fmtNumber } from '../lib/format';
import { useApi } from '../lib/useApi';
import { DEFAULT_TREND_METRICS, MAX_TREND_METRICS, TREND_METRICS, toggleTrendMetric, type TrendMetric } from '../lib/trendMetrics';

const TREND_PERIODS = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '12m', label: 'Last 12 months' },
] as const;

type TrendPeriod = (typeof TREND_PERIODS)[number]['value'];

function FilterChevron({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`h-4 w-4 shrink-0 text-stone-400 ${className}`}>
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

export function Sites() {
  const { me } = useMe();
  const [sites, setSites] = useState<Site[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [period, setPeriod] = useState<TrendPeriod>('7d');
  const [retryKey, setRetryKey] = useState(0);
  const [selectedMetrics, setSelectedMetrics] = useState<TrendMetric[]>(DEFAULT_TREND_METRICS);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const metricsMenuRef = useRef<HTMLDivElement>(null);

  // Dismiss the shared metric menu on an outside click or Escape.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !metricsMenuRef.current?.contains(event.target)) {
        setMetricsOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMetricsOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

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

  const selectedMetricLabel = selectedMetrics.map((metric) => TREND_METRICS.find((item) => item.value === metric)?.label).join(' + ');

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
          <p className="mt-1 text-sm text-stone-500">Performance trends across all your sites</p>
        </div>
        <div className="grid w-full grid-cols-2 gap-3 sm:flex sm:w-auto sm:items-end">
          <div className="min-w-0 sm:w-[160px] sm:flex-none">
            <div className="mb-1 flex h-4 items-center justify-between gap-2">
              <label htmlFor="site-trend-period" className="text-xs font-medium leading-4 text-stone-500">Period</label>
            </div>
            <div className="relative">
              <select
                id="site-trend-period"
                className="filter-control truncate pr-7"
                value={period}
                title={TREND_PERIODS.find((option) => option.value === period)?.label}
                onChange={(event) => setPeriod(event.target.value as TrendPeriod)}
              >
                {TREND_PERIODS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <FilterChevron className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2" />
            </div>
          </div>
          <div className="relative min-w-0 sm:w-[220px] sm:flex-none" ref={metricsMenuRef}>
            <div className="mb-1 flex h-4 items-center justify-between gap-2">
              <span id="site-trend-metrics-label" className="text-xs font-medium leading-4 text-stone-500">Metrics</span>
              <span id="site-trend-metrics-hint" className="text-[11px] leading-4 text-stone-400">Up to 2</span>
            </div>
            <button
              type="button"
              id="site-trend-metrics"
              aria-labelledby="site-trend-metrics-label site-trend-metrics"
              aria-describedby="site-trend-metrics-hint"
              aria-haspopup="true"
              aria-expanded={metricsOpen}
              aria-controls="site-trend-metrics-menu"
              title={selectedMetricLabel}
              className="filter-control flex items-center justify-between gap-2"
              onClick={() => setMetricsOpen((open) => !open)}
            >
              <span className="min-w-0 truncate">{selectedMetricLabel}</span>
              <FilterChevron className="-mr-1" />
            </button>
            {metricsOpen && (
              <div id="site-trend-metrics-menu" role="group" aria-label="Select up to two shared metrics" className="absolute right-0 top-full z-30 mt-2 w-full min-w-[218px] rounded-xl border border-stone-200 bg-white p-2 shadow-lg">
                <div className="px-2 pb-2 text-xs text-stone-500">Applies to every website</div>
                {TREND_METRICS.map((item) => {
                  const checked = selectedMetrics.includes(item.value);
                  const disabled = !checked && selectedMetrics.length >= MAX_TREND_METRICS;
                  return (
                    <label key={item.value} className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm hover:bg-stone-50 ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => setSelectedMetrics((current) => toggleTrendMetric(current, item.value))}
                        className="h-4 w-4 accent-stone-800"
                      />
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                      <span>{item.label}</span>
                    </label>
                  );
                })}
                <p className="border-t border-stone-100 px-2 pt-2 text-xs text-stone-400">Choose 1 or 2. Uncheck one to change.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <span>Could not load website trends. {error}</span>
          <button className="font-medium underline" onClick={() => setRetryKey((key) => key + 1)}>Retry</button>
        </div>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sites?.map((s) => {
          const trend = trends?.period === period ? trends.sites[s.id] : undefined;
          const ready = !loading && !error && trends?.period === period;
          const dashboardPath = `/site/${s.id}?period=${period}`;
          function openDashboard(event: React.MouseEvent<HTMLDivElement>) {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            if (event.target instanceof Element && event.target.closest('a, button, input, select, textarea, label, [tabindex]')) return;
            const selection = window.getSelection();
            if (selection && !selection.isCollapsed) return;
            navigate(dashboardPath);
          }
          return (
            <div key={s.id} className="card cursor-pointer p-5 text-left transition hover:border-stone-300" onClick={openDashboard}>
              <div className="flex items-center gap-3">
                <Favicon domain={s.domain} size={28} />
                <div className="min-w-0">
                  <a
                    href={dashboardPath}
                    className="block truncate rounded-sm font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:ring-offset-2"
                    onClick={(event) => {
                      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                      event.preventDefault();
                      const selection = window.getSelection();
                      if (selection && !selection.isCollapsed) return;
                      navigate(dashboardPath);
                    }}
                  >
                    {s.name}
                  </a>
                  <div className="truncate text-sm text-stone-500">{s.domain}</div>
                </div>
              </div>
              <div className={`mt-5 grid gap-3 ${selectedMetrics.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                {selectedMetrics.map((metric) => {
                  const meta = TREND_METRICS.find((item) => item.value === metric)!;
                  return (
                    <div key={metric} className="min-w-0">
                      <div className="truncate text-2xl font-semibold">{ready ? fmtNumber(trend?.[metric] ?? 0) : '—'}</div>
                      <div className="text-xs text-stone-500">{meta.label.toLowerCase()} in period</div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-stone-500">Trend</span>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {selectedMetrics.map((metric) => {
                    const meta = TREND_METRICS.find((item) => item.value === metric)!;
                    return (
                      <span key={metric} className="flex items-center gap-1.5 text-xs text-stone-500">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }} />
                        {meta.label}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="mt-2" aria-busy={loading}>
                {!ready ? (
                  <div className="h-20 animate-pulse rounded-xl bg-stone-100" />
                ) : (
                  <TrendSparkline
                    name={s.name}
                    buckets={trends?.buckets ?? []}
                    series={selectedMetrics.map((metric) => {
                      const meta = TREND_METRICS.find((item) => item.value === metric)!;
                      return {
                        key: metric,
                        label: meta.label,
                        color: meta.color,
                        values: (trend?.series ?? []).map((point) => point[metric]),
                      };
                    })}
                  />
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
      {sites?.length ? <p className="mt-4 text-xs text-stone-400">UTC date buckets. The same period and metrics apply to all website cards.</p> : null}
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
