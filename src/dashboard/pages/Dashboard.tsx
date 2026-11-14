import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { navigate } from '../App';
import { GoalsPanel } from '../components/GoalsPanel';
import { OverviewCard } from '../components/OverviewCard';
import { Panel, renderLabel } from '../components/Panel';
import { Toolbar } from '../components/Toolbar';
import { VisitorModal } from '../components/VisitorModal';
import { qs, type Overview, type Site } from '../lib/api';
import { DashContext, type Dash } from '../lib/context';
import { fmtMoney } from '../lib/format';
import { useApi } from '../lib/useApi';
import { useQueryState } from '../lib/useQueryState';

// The globe pulls in a map library, so it's only downloaded when opened.
const LiveView = lazy(() => import('../components/LiveView'));

const FILTER_LABELS: Record<string, { label: string; dim: string }> = {
  channel: { label: 'Channel', dim: 'channel' },
  source: { label: 'Referrer', dim: 'source' },
  utm_campaign: { label: 'Campaign', dim: 'campaign' },
  utm_term: { label: 'Keyword', dim: 'keyword' },
  utm_source: { label: 'UTM source', dim: 'utm_source' },
  utm_medium: { label: 'UTM medium', dim: 'utm_medium' },
  ref: { label: 'Ref', dim: 'ref' },
  country: { label: 'Country', dim: 'country' },
  region: { label: 'Region', dim: 'region' },
  city: { label: 'City', dim: 'city' },
  browser: { label: 'Browser', dim: 'browser' },
  os: { label: 'OS', dim: 'os' },
  device: { label: 'Device', dim: 'device' },
  page: { label: 'Visited page', dim: 'page' },
  entry_page: { label: 'Entry page', dim: 'entry_page' },
  hostname: { label: 'Hostname', dim: 'hostname' },
  goal: { label: 'Completed goal', dim: 'goal' },
};

export function Dashboard({ siteId }: { siteId: string }) {
  const [q, update] = useQueryState(siteId);
  const [reloadKey, setReloadKey] = useState(0);
  const [visitor, setVisitor] = useState<string | null>(null);
  const [live, setLive] = useState(() => new URLSearchParams(window.location.search).get('live') === '1');

  // "M" opens the live map, like DataFast.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key.toLowerCase() === 'm' && !e.metaKey && !e.ctrlKey && !/INPUT|TEXTAREA|SELECT/.test(t.tagName)) setLive(true);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  const { data: sites } = useApi<Site[]>('/api/sites');
  const site = sites?.find((s) => s.id === siteId);
  const { data: overview, loading } = useApi<Overview>(site ? `/api/sites/${siteId}/overview?${qs(q)}` : null, reloadKey);

  const addFilter = useCallback((key: string, value: string) => update({ filters: { ...q.filters, [key]: value } }), [q.filters, update]);
  const removeFilter = (key: string) => {
    const { [key]: _, ...rest } = q.filters;
    update({ filters: rest });
  };

  const dash: Dash | null = useMemo(() => {
    if (!site) return null;
    const decimals = overview?.decimals ?? 2;
    return {
      site,
      q,
      reloadKey,
      decimals,
      money: (minor, compact) => fmtMoney(minor, site.currency, decimals, compact),
      addFilter,
      openVisitor: setVisitor,
    };
  }, [site, q, reloadKey, overview?.decimals, addFilter]);

  if (sites && !site) {
    return (
      <div className="p-10 text-center">
        Site not found.{' '}
        <button className="underline" onClick={() => navigate('/')}>
          Back to websites
        </button>
      </div>
    );
  }
  if (!dash || !site) return null;

  return (
    <DashContext.Provider value={dash}>
      <div className="mx-auto max-w-[1480px] px-3 py-6 sm:px-6 lg:py-10">
        <Toolbar
          site={site}
          sites={sites!}
          q={q}
          update={update}
          overview={overview}
          onRefresh={() => setReloadKey((k) => k + 1)}
          onLive={() => setLive(true)}
          loading={loading}
        />

        {Object.keys(q.filters).length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {Object.entries(q.filters).map(([k, v]) => (
              <span key={k} className="flex items-center gap-2 rounded-xl border border-stone-200 bg-white py-1 pl-3 pr-1 text-sm shadow-card">
                <span className="text-stone-500">{FILTER_LABELS[k]?.label ?? k} is</span>
                <span className="flex items-center gap-1.5 font-medium">{renderLabel(FILTER_LABELS[k]?.dim ?? k, { label: v || null })}</span>
                <button className="rounded-lg px-1.5 text-stone-400 hover:bg-stone-100 hover:text-ink" onClick={() => removeFilter(k)} aria-label="Remove filter">
                  ✕
                </button>
              </span>
            ))}
            <button className="text-sm text-stone-500 underline-offset-2 hover:underline" onClick={() => update({ filters: {} })}>
              Clear all
            </button>
          </div>
        )}

        <div className="mt-5">
          <OverviewCard data={overview} onLive={() => setLive(true)} />
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <Panel
            tabs={[
              { label: 'Channel', dim: 'channel', filter: 'channel' },
              { label: 'Referrer', dim: 'source', filter: 'source' },
              { label: 'Campaign', dim: 'campaign', filter: 'utm_campaign' },
              { label: 'Keyword', dim: 'keyword', filter: 'utm_term' },
            ]}
          />
          <Panel
            tabs={[
              { label: 'Country', dim: 'country', filter: 'country' },
              { label: 'Region', dim: 'region', filter: 'region' },
              { label: 'City', dim: 'city', filter: 'city' },
            ]}
          />
          <Panel
            tabs={[
              { label: 'Page', dim: 'page', filter: 'page' },
              { label: 'Entry page', dim: 'entry_page', filter: 'entry_page' },
              { label: 'Exit link', dim: 'exit_link' },
              { label: 'Hostname', dim: 'hostname', filter: 'hostname' },
            ]}
          />
          <Panel
            tabs={[
              { label: 'Browser', dim: 'browser', filter: 'browser' },
              { label: 'OS', dim: 'os', filter: 'os' },
              { label: 'Device', dim: 'device', filter: 'device' },
            ]}
          />
        </div>

        <div className="mt-5">
          <GoalsPanel totalVisitors={overview?.current.visitors ?? 0} />
        </div>

        <p className="mt-8 text-center text-xs text-stone-400">
          Times in {site.timezone} · Revenue in {site.currency} ·{' '}
          <button className="underline-offset-2 hover:underline" onClick={() => navigate(`/site/${site.id}/settings`)}>
            Settings & install
          </button>
        </p>
      </div>
      {live && (
        <Suspense fallback={<div className="fixed inset-0 z-50 bg-[#070b1a]" />}>
          <LiveView onClose={() => setLive(false)} />
        </Suspense>
      )}
      <VisitorModal key={visitor ?? 'none'} visitorId={visitor} onClose={() => setVisitor(null)} />
    </DashContext.Provider>
  );
}
