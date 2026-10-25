import { useEffect, useRef, useState, type ReactNode } from 'react';
import { navigate } from '../App';
import type { Overview, Query, Site } from '../lib/api';
import { dayInTz } from '../lib/format';
import { useI18n, LANGUAGES } from '../lib/i18n';
import { Favicon } from './Icons';

export const PERIODS: { value: string; tKey: string }[] = [
  { value: 'today', tKey: 'period.today' },
  { value: 'yesterday', tKey: 'period.yesterday' },
  { value: '24h', tKey: 'period.24h' },
  { value: '48h', tKey: 'period.48h' },
  { value: '7d', tKey: 'period.7d' },
  { value: '30d', tKey: 'period.30d' },
  { value: '90d', tKey: 'period.90d' },
  { value: '12m', tKey: 'period.12m' },
  { value: 'all', tKey: 'period.all' },
];

const GRANULARITIES = [
  { value: 'hour', tKey: 'granularity.hour' },
  { value: 'day', tKey: 'granularity.day' },
  { value: 'week', tKey: 'granularity.week' },
  { value: 'month', tKey: 'granularity.month' },
];

export function Dropdown({ button, children, align = 'left' }: { button: ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, [open]);
  return (
    <div className="relative flex" ref={ref}>
      <div className="flex" onClick={() => setOpen((o) => !o)}>
        {button}
      </div>
      {open && (
        <div className={`card absolute top-full z-40 mt-2 min-w-[200px] overflow-hidden p-1 ${align === 'right' ? 'right-0' : 'left-0'}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

const Chevron = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-stone-400">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

function itemCls(active: boolean) {
  return `flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-stone-100 ${active ? 'font-medium text-ink' : 'text-stone-600'}`;
}

export function Toolbar({
  site,
  sites,
  q,
  update,
  overview,
  onRefresh,
  loading,
}: {
  site: Site;
  sites: Site[];
  q: Query;
  update: (p: Partial<Query>) => void;
  overview: Overview | null;
  onRefresh: () => void;
  loading: boolean;
}) {
  const { t, lang, setLang } = useI18n();
  const [from, setFrom] = useState(q.from ?? '');
  const [to, setTo] = useState(q.to ?? '');

  const period = PERIODS.find((p) => p.value === q.period);
  const label =
    q.period === 'custom'
      ? q.from === q.to
        ? new Date(q.from + 'T00:00:00Z').toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
        : `${q.from} → ${q.to}`
      : period
        ? t(period.tKey)
        : t('period.30d');

  function shift(dir: -1 | 1) {
    if (!overview) return;
    const { from, to } = overview.range;
    const span = Math.max(to - from, 86_400_000);
    const nf = from + dir * span;
    const nt = nf + span - 1;
    if (nf > Date.now()) return;
    update({ period: 'custom', from: dayInTz(nf, site.timezone), to: dayInTz(Math.min(nt, Date.now()), site.timezone) });
  }
  const canForward = overview ? overview.range.to < Date.now() - 60_000 : false;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Dropdown
        button={
          <button className="btn h-11 px-4 text-base">
            <Favicon domain={site.domain} size={22} />
            <span className="max-w-[180px] truncate font-semibold">{site.name}</span>
            <Chevron />
          </button>
        }
      >
        {(close) => (
          <>
            {sites.map((s) => (
              <button
                key={s.id}
                className={itemCls(s.id === site.id)}
                onClick={() => {
                  close();
                  navigate(`/site/${s.id}${window.location.search}`);
                }}
              >
                <Favicon domain={s.domain} size={16} /> {s.name}
              </button>
            ))}
            <div className="my-1 border-t border-stone-100" />
            <button className={itemCls(false)} onClick={() => navigate(`/site/${site.id}/settings`)}>
              {t('toolbar.settings')}
            </button>
            <button className={itemCls(false)} onClick={() => navigate('/')}>
              {t('toolbar.allWebsites')}
            </button>
            <div className="my-1 border-t border-stone-100" />
            <div className="px-3 pb-1 pt-1 text-xs font-medium text-stone-400">{t('toolbar.language')}</div>
            {LANGUAGES.map((l) => (
              <button key={l.value} className={itemCls(l.value === lang)} onClick={() => setLang(l.value)}>
                {l.value === lang ? '✓ ' : '　'}
                {l.label}
              </button>
            ))}
          </>
        )}
      </Dropdown>

      <div className="flex h-11 items-stretch rounded-xl border border-stone-200 bg-white shadow-card">
        <button className="rounded-l-xl px-3 text-xl text-stone-500 hover:bg-stone-50" onClick={() => shift(-1)} aria-label={t('toolbar.prevPeriod')}>
          ‹
        </button>
        <Dropdown
          button={
            <button className="flex h-full items-center gap-2 border-x border-stone-200 px-4 text-base font-medium hover:bg-stone-50">
              {label} <Chevron />
            </button>
          }
        >
          {(close) => (
            <>
              {PERIODS.map((p) => (
                <button
                  key={p.value}
                  className={itemCls(q.period === p.value)}
                  onClick={() => {
                    close();
                    update({ period: p.value, granularity: undefined });
                  }}
                >
                  {t(p.tKey)}
                </button>
              ))}
              <div className="my-1 border-t border-stone-100" />
              <form
                className="space-y-2 p-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!from || !to) return;
                  close();
                  update({ period: 'custom', from, to: to < from ? from : to, granularity: undefined });
                }}
              >
                <div className="text-xs font-medium text-stone-500">{t('toolbar.customRange')}</div>
                <input type="date" className="input py-1.5" value={from} onChange={(e) => setFrom(e.target.value)} />
                <input type="date" className="input py-1.5" value={to} onChange={(e) => setTo(e.target.value)} />
                <button className="btn-dark w-full py-1.5">{t('toolbar.apply')}</button>
              </form>
            </>
          )}
        </Dropdown>
        <button
          className="rounded-r-xl px-3 text-xl text-stone-500 hover:bg-stone-50 disabled:opacity-30"
          onClick={() => shift(1)}
          disabled={!canForward}
          aria-label={t('toolbar.nextPeriod')}
        >
          ›
        </button>
      </div>

      <Dropdown
        button={
          <button className="btn h-11 px-4 text-base">
            {(() => {
              const g = GRANULARITIES.find((g) => g.value === (q.granularity ?? overview?.range.granularity));
              return g ? t(g.tKey) : t('granularity.day');
            })()}{' '}
            <Chevron />
          </button>
        }
      >
        {(close) =>
          GRANULARITIES.map((g) => (
            <button
              key={g.value}
              className={itemCls((q.granularity ?? overview?.range.granularity) === g.value)}
              onClick={() => {
                close();
                update({ granularity: g.value });
              }}
            >
              {t(g.tKey)}
            </button>
          ))
        }
      </Dropdown>

      <button className="btn h-11 w-11 px-0" onClick={onRefresh} aria-label={t('toolbar.refresh')}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={loading ? 'animate-spin' : ''}>
          <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
          <path d="M21 3v5h-5" />
        </svg>
      </button>
    </div>
  );
}
