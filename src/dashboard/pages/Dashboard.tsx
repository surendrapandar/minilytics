import { useCallback, useMemo, useState } from 'react';
import { navigate } from '../App';
import { GoalsPanel } from '../components/GoalsPanel';
import { OverviewCard } from '../components/OverviewCard';
import { Panel, renderLabel } from '../components/Panel';
import { Toolbar } from '../components/Toolbar';
import { VisitorModal } from '../components/VisitorModal';
import { qs, type Overview, type Site } from '../lib/api';
import { DashContext, type Dash } from '../lib/context';
import { fmtMoney } from '../lib/format';
import { useT } from '../lib/i18n';
import { useApi } from '../lib/useApi';
import { useQueryState } from '../lib/useQueryState';

const FILTER_LABELS: Record<string, { tKey: string; dim: string }> = {
  channel: { tKey: 'dashboard.filter.channel', dim: 'channel' },
  source: { tKey: 'dashboard.filter.source', dim: 'source' },
  utm_campaign: { tKey: 'dashboard.filter.utm_campaign', dim: 'campaign' },
  utm_term: { tKey: 'dashboard.filter.utm_term', dim: 'keyword' },
  utm_source: { tKey: 'dashboard.filter.utm_source', dim: 'utm_source' },
  utm_medium: { tKey: 'dashboard.filter.utm_medium', dim: 'utm_medium' },
  ref: { tKey: 'dashboard.filter.ref', dim: 'ref' },
  country: { tKey: 'dashboard.filter.country', dim: 'country' },
  region: { tKey: 'dashboard.filter.region', dim: 'region' },
  city: { tKey: 'dashboard.filter.city', dim: 'city' },
  browser: { tKey: 'dashboard.filter.browser', dim: 'browser' },
  os: { tKey: 'dashboard.filter.os', dim: 'os' },
  device: { tKey: 'dashboard.filter.device', dim: 'device' },
  page: { tKey: 'dashboard.filter.page', dim: 'page' },
  entry_page: { tKey: 'dashboard.filter.entry_page', dim: 'entry_page' },
  hostname: { tKey: 'dashboard.filter.hostname', dim: 'hostname' },
  goal: { tKey: 'dashboard.filter.goal', dim: 'goal' },
};

export function Dashboard({ siteId }: { siteId: string }) {
  const t = useT();
  const [q, update] = useQueryState();
  const [reloadKey, setReloadKey] = useState(0);
  const [visitor, setVisitor] = useState<string | null>(null);
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
        {t('dashboard.siteNotFound')}{' '}
        <button className="underline" onClick={() => navigate('/')}>
          {t('dashboard.backToWebsites')}
        </button>
      </div>
    );
  }
  if (!dash || !site) return null;

  return (
    <DashContext.Provider value={dash}>
      <div className="mx-auto max-w-[1480px] px-3 py-6 sm:px-6 lg:py-10">
        <Toolbar site={site} sites={sites!} q={q} update={update} overview={overview} onRefresh={() => setReloadKey((k) => k + 1)} loading={loading} />

        {Object.keys(q.filters).length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {Object.entries(q.filters).map(([k, v]) => (
              <span key={k} className="flex items-center gap-2 rounded-xl border border-stone-200 bg-white py-1 pl-3 pr-1 text-sm shadow-card">
                <span className="text-stone-500">{FILTER_LABELS[k] ? t(FILTER_LABELS[k].tKey) : k} {t('dashboard.filterIs')}</span>
                <span className="flex items-center gap-1.5 font-medium">{renderLabel(FILTER_LABELS[k]?.dim ?? k, { label: v || null }, t)}</span>
                <button className="rounded-lg px-1.5 text-stone-400 hover:bg-stone-100 hover:text-ink" onClick={() => removeFilter(k)} aria-label={t('common.removeFilter')}>
                  ✕
                </button>
              </span>
            ))}
            <button className="text-sm text-stone-500 underline-offset-2 hover:underline" onClick={() => update({ filters: {} })}>
              {t('common.clearAll')}
            </button>
          </div>
        )}

        <div className="mt-5">
          <OverviewCard data={overview} />
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <Panel
            tabs={[
              { tKey: 'panel.tab.channel', dim: 'channel', filter: 'channel' },
              { tKey: 'panel.tab.source', dim: 'source', filter: 'source' },
              { tKey: 'panel.tab.campaign', dim: 'campaign', filter: 'utm_campaign' },
              { tKey: 'panel.tab.keyword', dim: 'keyword', filter: 'utm_term' },
            ]}
          />
          <Panel
            tabs={[
              { tKey: 'panel.tab.country', dim: 'country', filter: 'country' },
              { tKey: 'panel.tab.region', dim: 'region', filter: 'region' },
              { tKey: 'panel.tab.city', dim: 'city', filter: 'city' },
            ]}
          />
          <Panel
            tabs={[
              { tKey: 'panel.tab.page', dim: 'page', filter: 'page' },
              { tKey: 'panel.tab.entry_page', dim: 'entry_page', filter: 'entry_page' },
              { tKey: 'panel.tab.exit_link', dim: 'exit_link' },
              { tKey: 'panel.tab.hostname', dim: 'hostname', filter: 'hostname' },
            ]}
          />
          <Panel
            tabs={[
              { tKey: 'panel.tab.browser', dim: 'browser', filter: 'browser' },
              { tKey: 'panel.tab.os', dim: 'os', filter: 'os' },
              { tKey: 'panel.tab.device', dim: 'device', filter: 'device' },
            ]}
          />
        </div>

        <div className="mt-5">
          <GoalsPanel totalVisitors={overview?.current.visitors ?? 0} />
        </div>

        <p className="mt-8 text-center text-xs text-stone-400">
          {t('dashboard.timesIn', { tz: site.timezone })} · {t('dashboard.revenueIn', { currency: site.currency })} ·{' '}
          <button className="underline-offset-2 hover:underline" onClick={() => navigate(`/site/${site.id}/settings`)}>
            {t('dashboard.settingsInstall')}
          </button>
        </p>
      </div>
      <VisitorModal key={visitor ?? 'none'} visitorId={visitor} onClose={() => setVisitor(null)} />
    </DashContext.Provider>
  );
}
