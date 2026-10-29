import { useState, type ReactNode } from 'react';
import { usePref } from '../lib/prefs';
import { api, qs, type BreakdownRow } from '../lib/api';
import { displayName } from '../../shared/names';
import { useDash } from '../lib/context';
import { countryName, fmtAgo, fmtDateTime, fmtDuration, fmtNumber, fmtPct } from '../lib/format';
import { useApi } from '../lib/useApi';
import { Avatar, BrowserIcon, DeviceIcon, Flag, OSIcon, SourceIcon } from './Icons';

type Tab = 'goal' | 'funnel' | 'user' | 'journey';

export function GoalsPanel({ totalVisitors }: { totalVisitors: number }) {
  const [tab, setTab] = usePref<Tab>('ml_tab_goals', 'journey');
  const [search, setSearch] = useState('');
  return (
    <div className="card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
        <div className="tabs flex-wrap">
          {(['goal', 'funnel', 'user', 'journey'] as const).map((t) => (
            <button key={t} className={`tab capitalize ${tab === t ? 'tab-active' : ''}`} onClick={() => setTab(t)}>
              {t === 'journey' ? 'Journey' : t === 'user' ? 'Users' : t === 'goal' ? 'Goals' : 'Funnel'}
            </button>
          ))}
        </div>
        {(tab === 'user' || tab === 'journey') && (
          <input className="input w-full py-1.5 sm:max-w-[240px]" placeholder="🔍 Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        )}
      </div>
      {tab === 'goal' && <Goals totalVisitors={totalVisitors} />}
      {tab === 'funnel' && <Funnels />}
      {tab === 'user' && <Users search={search} />}
      {tab === 'journey' && <Journey search={search} />}
    </div>
  );
}

function Goals({ totalVisitors }: { totalVisitors: number }) {
  const { site, q, reloadKey, money, addFilter } = useDash();
  const { data } = useApi<BreakdownRow[]>(`/api/sites/${site.id}/breakdown?${qs(q, { dim: 'goal' })}`, reloadKey);
  if (!data) return <div className="h-40 animate-pulse" />;
  if (!data.length)
    return (
      <div className="p-8 text-center text-sm text-stone-500">
        No goals yet. Add <code className="rounded bg-stone-100 px-1">data-ml-goal="signup_click"</code> to any button, or call{' '}
        <code className="rounded bg-stone-100 px-1">window.minilytics('goal', 'signup')</code>.
      </div>
    );
  return (
    <table className="w-full text-sm">
      <thead className="hidden sm:table-header-group">
        <tr className="text-left text-stone-500">
          <th className="px-3 pb-2 font-medium">Goal</th>
          <th className="pb-2 text-right font-medium">Visitors</th>
          <th className="pb-2 text-right font-medium">Completions</th>
          <th className="pb-2 text-right font-medium">Conversion</th>
          <th className="px-3 pb-2 text-right font-medium">Revenue</th>
        </tr>
      </thead>
      <tbody>
        {data.map((g) => (
          <tr
            key={g.label}
            className="block cursor-pointer border-t border-stone-100 py-3 hover:bg-stone-50 focus-visible:bg-stone-100 sm:table-row sm:py-0"
            onClick={() => addFilter('goal', g.label ?? '')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.currentTarget.click();
              }
            }}
            role="button"
            tabIndex={0}
            title="Filter by visitors who completed this goal"
          >
            <td className="block px-1 font-medium sm:table-cell sm:px-3 sm:py-2.5">
              <span className="break-words [overflow-wrap:anywhere]">🎯 {g.label}</span>
            </td>
            <td className="mt-1 flex items-baseline justify-between gap-4 px-1 sm:mt-0 sm:table-cell sm:py-2.5 sm:text-right">
              <span className="text-stone-500 sm:hidden">Visitors</span>
              {fmtNumber(g.visitors)}
            </td>
            <td className="flex items-baseline justify-between gap-4 px-1 sm:table-cell sm:py-2.5 sm:text-right">
              <span className="text-stone-500 sm:hidden">Completions</span>
              {fmtNumber(g.pageviews ?? 0)}
            </td>
            <td className="flex items-baseline justify-between gap-4 px-1 sm:table-cell sm:py-2.5 sm:text-right">
              <span className="text-stone-500 sm:hidden">Conversion</span>
              {totalVisitors ? fmtPct(g.visitors / totalVisitors, 1) : '—'}
            </td>
            <td className="flex items-baseline justify-between gap-4 px-1 sm:table-cell sm:px-3 sm:py-2.5 sm:text-right">
              <span className="text-stone-500 sm:hidden">Revenue</span>
              {money(g.revenue)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface FunnelDef {
  id: string;
  name: string;
  steps: { type: 'page' | 'goal'; value: string }[];
}

function Funnels() {
  const { site, q, reloadKey } = useDash();
  const [version, setVersion] = useState(0);
  const { data: funnels } = useApi<FunnelDef[]>(`/api/sites/${site.id}/funnels`, version);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const current = funnels?.find((f) => f.id === selected) ?? funnels?.[0];
  const { data: stats } = useApi<(FunnelDef['steps'][0] & { visitors: number })[]>(
    current ? `/api/sites/${site.id}/funnels/${current.id}/stats?${qs(q)}` : null,
    reloadKey + version,
  );

  if (!funnels) return <div className="h-40 animate-pulse" />;
  if (creating || !funnels.length)
    return (
      <FunnelForm
        onDone={(id) => {
          setCreating(false);
          if (id) setSelected(id);
          setVersion((v) => v + 1);
        }}
        canCancel={funnels.length > 0}
      />
    );

  const top = stats?.[0]?.visitors || 0;
  return (
    <div className="px-3 pb-3">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select className="input w-auto min-w-0 max-w-full truncate py-1.5" value={current?.id} title={current?.name} onChange={(e) => setSelected(e.target.value)}>
          {funnels.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <button className="btn py-1.5" onClick={() => setCreating(true)}>
          + New funnel
        </button>
        {current && (
          <button
            className="btn py-1.5 text-red-600"
            onClick={async () => {
              if (!confirm(`Delete funnel "${current.name}"?`)) return;
              await api(`/api/sites/${site.id}/funnels/${current.id}`, { method: 'DELETE' });
              setSelected(null);
              setVersion((v) => v + 1);
            }}
          >
            Delete
          </button>
        )}
      </div>
      <div
        className="-mx-3 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0"
        tabIndex={stats && stats.length > 2 ? 0 : undefined}
        role={stats && stats.length > 2 ? 'region' : undefined}
        aria-label={stats && stats.length > 2 ? 'Funnel steps, scroll sideways to see every step' : undefined}
      >
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.max(1, stats?.length ?? 1)}, minmax(130px, 1fr))` }}>
          {stats?.map((s, i) => {
            const pct = top ? s.visitors / top : 0;
            const prev = i ? stats[i - 1].visitors : s.visitors;
            return (
              <div key={i} className="min-w-0">
                <div className="flex h-48 items-end rounded-xl bg-stone-50">
                  <div className="w-full rounded-xl bg-visitors/70 transition-all" style={{ height: `${Math.max(pct * 100, 2)}%` }} />
                </div>
                <div className="mt-2 break-words text-sm font-medium [overflow-wrap:anywhere]" title={s.value}>
                  {i + 1}. {s.type === 'goal' ? '🎯 ' : ''}
                  {s.value}
                </div>
                <div className="text-sm text-stone-600">
                  {fmtNumber(s.visitors)} visitors · {fmtPct(pct)}
                </div>
                {i > 0 && <div className="text-xs text-red-500">−{prev ? fmtPct(1 - s.visitors / prev) : '0%'} drop-off</div>}
              </div>
            );
          })}
        </div>
      </div>
      {stats && stats.length > 2 && <p className="mt-2 text-xs text-stone-400 sm:hidden">Swipe sideways to see every step.</p>}
    </div>
  );
}

function FunnelForm({ onDone, canCancel }: { onDone: (id?: string) => void; canCancel: boolean }) {
  const { site } = useDash();
  const [name, setName] = useState('Signup funnel');
  const [steps, setSteps] = useState<FunnelDef['steps']>([
    { type: 'page', value: '/' },
    { type: 'page', value: '/pricing' },
    { type: 'goal', value: 'checkout' },
  ]);
  const [error, setError] = useState('');
  const set = (i: number, patch: Partial<FunnelDef['steps'][0]>) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <form
      className="max-w-xl space-y-3 px-3 pb-3"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          const f = await api<FunnelDef>(`/api/sites/${site.id}/funnels`, { method: 'POST', json: { name, steps } });
          onDone(f.id);
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <p className="text-sm text-stone-500">Steps are counted in order per visitor. Page paths support wildcards like <code>/blog/*</code>.</p>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Funnel name" />
      {steps.map((s, i) => (
        <div key={i} className="flex gap-2">
          <select className="input w-28" value={s.type} onChange={(e) => set(i, { type: e.target.value as 'page' | 'goal' })}>
            <option value="page">Page</option>
            <option value="goal">Goal</option>
          </select>
          <input className="input" value={s.value} onChange={(e) => set(i, { value: e.target.value })} placeholder={s.type === 'page' ? '/pricing' : 'signup'} />
          <button type="button" className="btn px-3" onClick={() => setSteps((x) => x.filter((_, j) => j !== i))} disabled={steps.length <= 2}>
            ✕
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <button type="button" className="btn" onClick={() => setSteps((s) => [...s, { type: 'page', value: '' }])} disabled={steps.length >= 10}>
          + Step
        </button>
        <button className="btn-dark">Save funnel</button>
        {canCancel && (
          <button type="button" className="btn" onClick={() => onDone()}>
            Cancel
          </button>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}

function VisitorCell({ id, name, email, country, city, device, os, browser, badge }: Record<string, any>) {
  return (
    <div className="flex items-center gap-3">
      <Avatar id={id} size={44} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{displayName(id, name, email)}</span>
          {badge}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-stone-500">
          <span className="flex items-center gap-1">
            <Flag cc={country} size={15} /> {city ? `${city}, ` : ''}
            {countryName(country)}
          </span>
          <span className="flex items-center gap-1">
            <DeviceIcon name={device} size={15} /> {device}
          </span>
          <span className="flex items-center gap-1">
            <OSIcon name={os} size={15} /> {os}
          </span>
          <span className="flex items-center gap-1">
            <BrowserIcon name={browser} size={15} /> {browser}
          </span>
        </div>
      </div>
    </div>
  );
}

function matches(r: Record<string, any>, search: string) {
  if (!search) return true;
  const s = search.toLowerCase();
  return ['name', 'email', 'pay_email', 'pay_name', 'source', 'country', 'city', 'visitor_id', 'utm_campaign', 'ref'].some((k) =>
    String(r[k] ?? '').toLowerCase().includes(s),
  );
}

function ShowAll({ total, shown, onClick }: { total: number; shown: number; onClick: () => void }) {
  if (total <= shown) return null;
  return (
    <button className="mx-auto mt-3 block text-xs font-semibold uppercase tracking-wider text-stone-500 hover:text-ink" onClick={onClick}>
      Show all {total}
    </button>
  );
}

const MATCH_LABELS: Record<string, string> = {
  return_page: 'return page',
  customer: 'earlier payment',
  email: 'email',
  timing: 'checkout click timing',
};

function MobileStat({ label, value, className = '' }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${className}`}>
      <dt className="shrink-0 text-stone-500">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-stone-700" title={typeof value === 'string' ? value : undefined}>
        {value}
      </dd>
    </div>
  );
}

function SourceInfo({ r }: { r: Record<string, any> }) {
  if (!r.session_id) {
    return (
      <span className="text-stone-400" title="No visitor id in the payment metadata, and no return-page, email or timing match">
        Not attributed
      </span>
    );
  }
  return (
    <div className="flex min-w-0 items-start gap-2">
      <SourceIcon source={r.source} domain={r.referrer_domain} />
      <div className="min-w-0">
        <div className="break-words [overflow-wrap:anywhere]" title={r.source ?? undefined}>
          {r.source}
        </div>
        {(r.utm_campaign || r.ref) && (
          <div className="break-words text-xs text-stone-500 [overflow-wrap:anywhere]" title={r.utm_campaign || r.ref}>
            {r.utm_campaign || r.ref}
          </div>
        )}
        {r.matched_by && r.matched_by !== 'metadata' && (
          <div className="break-words text-xs text-stone-400" title="How this payment was linked to the visitor">
            matched by {MATCH_LABELS[r.matched_by] ?? r.matched_by}
          </div>
        )}
      </div>
    </div>
  );
}

function Journey({ search }: { search: string }) {
  const { site, q, reloadKey, money, openVisitor } = useDash();
  const [all, setAll] = useState(false);
  const [version, setVersion] = useState(0);
  const [rematch, setRematch] = useState<string | null>(null);
  const [reasons, setReasons] = useState<{ id: string; name: string | null; matched: boolean; reason: string | null }[]>([]);
  const { data } = useApi<any[]>(`/api/sites/${site.id}/customers?${qs(q)}`, reloadKey + version);
  if (!data) return <div className="h-40 animate-pulse" />;
  if (!data.length)
    return <div className="p-8 text-center text-sm text-stone-500">No payments in this period. Connect Dodo Payments or Stripe in site settings to see who paid and where they came from.</div>;
  const unmatched = data.filter((r) => !r.visitor_id).length;
  return (
    <div className="overflow-x-auto">
      {unmatched > 0 && (
        <div className="mx-3 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>
            {unmatched} payment{unmatched > 1 ? 's' : ''} not linked to a visitor yet.{' '}
            <a className="underline" href={`/site/${site.id}/settings`}>
              Why?
            </a>
          </span>
          <button
            className="btn py-1.5"
            disabled={rematch === 'working'}
            onClick={async () => {
              setRematch('working');
              const r = await api<{ matched: number; checked: number; details: typeof reasons }>(`/api/sites/${site.id}/rematch`, {
                method: 'POST',
              });
              setRematch(`Matched ${r.matched} of ${r.checked}`);
              setReasons(r.details ?? []);
              setVersion((v) => v + 1);
            }}
          >
            {rematch === 'working' ? 'Matching…' : rematch ?? 'Try matching again'}
          </button>
          {reasons.length > 0 && (
            <ul className="w-full space-y-1 border-t border-amber-200 pt-2 text-xs">
              {reasons.map((r) => (
                <li key={r.id}>
                  <b>{r.name ?? r.id}</b>: {r.matched ? '✓ matched' : '✗ not matched'}
                  {r.reason ? ` · ${r.reason}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <table className="w-full text-[15px] sm:min-w-[760px]">
        <thead className="hidden sm:table-header-group">
          <tr className="text-left text-sm text-stone-500">
            <th className="px-3 pb-3 font-medium">Visitor</th>
            <th className="pb-3 font-medium">Source</th>
            <th className="pb-3 font-medium">Spent</th>
            <th className="pb-3 font-medium">Time to complete</th>
            <th className="pb-3 font-medium">Completed at</th>
          </tr>
        </thead>
        <tbody>
          {data
            .filter((r) => matches(r, search))
            .slice(0, all || search ? undefined : 10)
            .map((r) => (
              <tr
                key={r.id}
                className={`block border-t border-stone-100 py-3 sm:table-row sm:py-0 ${
                  r.visitor_id ? 'cursor-pointer hover:bg-stone-50 focus-visible:bg-stone-100' : ''
                }`}
                onClick={() => r.visitor_id && openVisitor(r.visitor_id)}
                onKeyDown={
                  r.visitor_id
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.currentTarget.click();
                        }
                      }
                    : undefined
                }
                role={r.visitor_id ? 'button' : undefined}
                tabIndex={r.visitor_id ? 0 : undefined}
              >
                <td className="block px-1 sm:table-cell sm:px-3 sm:py-4">
                  <VisitorCell
                    id={r.visitor_id ?? r.id}
                    name={r.name ?? r.pay_name}
                    email={r.email ?? r.pay_email}
                    country={r.country}
                    city={null}
                    device={r.device}
                    os={r.os}
                    browser={r.browser}
                    badge={
                      <span className="rounded-md border border-revenue/30 bg-revenueSoft/50 px-1.5 py-0.5 text-xs text-revenue">
                        {r.renewal ? 'Returning' : 'Customer'}
                      </span>
                    }
                  />
                  <div className="mt-3 text-sm sm:hidden">
                    <SourceInfo r={r} />
                  </div>
                  <dl className="mt-2 space-y-1 text-sm sm:hidden">
                    <MobileStat label="Spent" value={money(r.amount)} />
                    <MobileStat label="Time to complete" value={r.first_seen ? fmtAgo(r.ts - r.first_seen) : '—'} />
                    <MobileStat label="Completed at" value={fmtDateTime(r.ts, site.timezone)} />
                    {r.visits > 0 && <MobileStat label="Visits" value={r.visits} />}
                  </dl>
                </td>
                <td className="hidden py-4 sm:table-cell">
                  <SourceInfo r={r} />
                </td>
                <td className="hidden py-4 font-medium sm:table-cell">{money(r.amount)}</td>
                <td className="hidden py-4 sm:table-cell">
                  {r.first_seen ? fmtAgo(r.ts - r.first_seen) : '—'}
                  {r.visits > 0 && <div className="text-xs text-stone-500">{r.visits} visit{r.visits > 1 ? 's' : ''}</div>}
                </td>
                <td className="hidden py-4 sm:table-cell">{fmtDateTime(r.ts, site.timezone)}</td>
              </tr>
            ))}
        </tbody>
      </table>
      {!search && <ShowAll total={data.length} shown={all ? data.length : 10} onClick={() => setAll(true)} />}
    </div>
  );
}

function Users({ search }: { search: string }) {
  const { site, q, reloadKey, money, openVisitor } = useDash();
  const [all, setAll] = useState(false);
  const { data } = useApi<any[]>(`/api/sites/${site.id}/visitors?${qs(q)}`, reloadKey);
  if (!data) return <div className="h-40 animate-pulse" />;
  if (!data.length) return <div className="p-8 text-center text-sm text-stone-500">No visitors in this period.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[15px] sm:min-w-[760px]">
        <thead className="hidden sm:table-header-group">
          <tr className="text-left text-sm text-stone-500">
            <th className="px-3 pb-3 font-medium">Visitor</th>
            <th className="pb-3 font-medium">Source</th>
            <th className="pb-3 text-right font-medium">Visits</th>
            <th className="pb-3 text-right font-medium">Pages</th>
            <th className="pb-3 text-right font-medium">Time</th>
            <th className="pb-3 text-right font-medium">Spent</th>
            <th className="px-3 pb-3 text-right font-medium">Last seen</th>
          </tr>
        </thead>
        <tbody>
          {data
            .filter((r) => matches(r, search))
            .slice(0, all || search ? undefined : 10)
            .map((r) => (
              <tr
                key={r.visitor_id}
                className="block cursor-pointer border-t border-stone-100 py-3 hover:bg-stone-50 focus-visible:bg-stone-100 sm:table-row sm:py-0"
                onClick={() => openVisitor(r.visitor_id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.currentTarget.click();
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <td className="block px-1 sm:table-cell sm:px-3 sm:py-3">
                  <VisitorCell
                    id={r.visitor_id}
                    name={r.name}
                    email={r.email}
                    country={r.country}
                    city={r.city}
                    device={r.device}
                    os={r.os}
                    browser={r.browser}
                    badge={r.spent > 0 ? <span className="rounded-md border border-revenue/30 bg-revenueSoft/50 px-1.5 py-0.5 text-xs text-revenue">Customer</span> : null}
                  />
                  <div className="mt-3 flex min-w-0 items-center gap-2 text-sm text-stone-600 sm:hidden">
                    <SourceIcon source={r.source} domain={r.referrer_domain} />
                    <span className="truncate" title={r.source}>
                      {r.source}
                    </span>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:hidden">
                    <MobileStat label="Visits" value={r.sessions} />
                    <MobileStat label="Pages" value={r.pageviews} />
                    <MobileStat label="Time" value={fmtDuration(r.duration)} />
                    <MobileStat label="Spent" value={r.spent ? money(r.spent) : '—'} />
                    <MobileStat label="Last seen" value={`${fmtAgo(Date.now() - r.last_seen)} ago`} className="col-span-2" />
                  </dl>
                </td>
                <td className="hidden py-3 sm:table-cell">
                  <div className="flex items-center gap-2">
                    <SourceIcon source={r.source} domain={r.referrer_domain} /> {r.source}
                  </div>
                </td>
                <td className="hidden py-3 text-right sm:table-cell">{r.sessions}</td>
                <td className="hidden py-3 text-right sm:table-cell">{r.pageviews}</td>
                <td className="hidden py-3 text-right sm:table-cell">{fmtDuration(r.duration)}</td>
                <td className="hidden py-3 text-right sm:table-cell">{r.spent ? money(r.spent) : '—'}</td>
                <td className="hidden px-3 py-3 text-right text-stone-500 sm:table-cell">{fmtAgo(Date.now() - r.last_seen)} ago</td>
              </tr>
            ))}
        </tbody>
      </table>
      {!search && <ShowAll total={data.length} shown={all ? data.length : 10} onClick={() => setAll(true)} />}
    </div>
  );
}
