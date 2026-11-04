import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DitherGlobe, type GlobeMarker } from '@/components/dithercn/dither-globe';
import { DotMap, type DotMapMarker } from '@/components/dithercn/dot-map';
import { displayName } from '../../shared/names';
import { api } from '../lib/api';
import { useDash } from '../lib/context';
import { countryName, flag, fmtAgo } from '../lib/format';
import { playPayment, playVisitor, unlockAudio } from '../lib/sounds';
import { DeviceIcon, Favicon, Flag, SourceIcon } from './Icons';
import { setTheme, useTheme } from '../lib/theme';
import type { Projection } from './LiveMap';

// MapLibre and its tiles are only downloaded when the map view is picked.
const LiveMap = lazy(() => import('./LiveMap'));

export interface LiveVisitor {
  visitor_id: string;
  lat: number | null;
  lon: number | null;
  country: string | null;
  region: string | null;
  city: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  source: string;
  referrer_domain: string | null;
  page: string | null;
  started_at: number;
  last_seen_at: number;
  pageviews: number;
  name: string | null;
  email: string | null;
  spent: number;
}

interface FeedItem {
  id: string;
  ts: number;
  type: 'pageview' | 'goal' | 'payment' | 'refund';
  label?: string;
  amount?: number;
  visitor_id: string | null;
  name: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
}

interface Realtime {
  now: number;
  domain: string;
  visitors: LiveVisitor[];
  feed: FeedItem[];
}

type View = 'globe' | 'dots' | 'map';
const VIEWS: { value: View; label: string; title: string }[] = [
  { value: 'globe', label: 'Globe', title: 'Dithered globe' },
  { value: 'dots', label: 'Dots', title: 'Dot map' },
  { value: 'map', label: 'Map', title: 'Street map' },
];

const POLL_MS = 5000;

function pref<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;
  }
}
function savePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function top(items: (string | null)[], n = 3): [string, number][] {
  const counts = new Map<string, number>();
  for (const i of items) if (i) counts.set(i, (counts.get(i) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

export default function LiveView({ onClose }: { onClose: () => void }) {
  const { site, money, openVisitor } = useDash();
  const rootRef = useRef<HTMLDivElement>(null);
  const knownVisitors = useRef<Set<string> | null>(null);
  const knownPayments = useRef<Set<string> | null>(null);

  const [data, setData] = useState<Realtime | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<View>(() => pref('ml_live_view', 'globe'));
  const [projection, setProjection] = useState<Projection>(() => pref('ml_live_projection', 'globe'));
  const [sound, setSound] = useState(() => pref<string>('ml_live_sound', 'off') === 'on');
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const [highlight, setHighlight] = useState<string | null>(null);
  // A new object each time a feed item is picked, so picking the same place again still moves the view.
  const [target, setTarget] = useState<{ lat: number; lon: number } | null>(null);
  const [, tick] = useState(0);

  // ---- data polling
  const load = useCallback(async () => {
    try {
      const d = await api<Realtime>(`/api/sites/${site.id}/realtime`);
      const vids = new Set(d.visitors.map((v) => v.visitor_id));
      const pays = new Set(d.feed.filter((f) => f.type === 'payment').map((f) => f.id));
      if (knownVisitors.current && soundRef.current) {
        if ([...pays].some((id) => !knownPayments.current!.has(id))) playPayment();
        else if ([...vids].some((id) => !knownVisitors.current!.has(id))) playVisitor();
      }
      knownVisitors.current = vids;
      knownPayments.current = pays;
      setData(d);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [site.id]);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') load();
      tick((n) => n + 1); // refresh "x min ago"
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => savePref('ml_live_view', view), [view]);
  useEffect(() => savePref('ml_live_projection', projection), [projection]);
  useEffect(() => savePref('ml_live_sound', sound ? 'on' : 'off'), [sound]);

  const focus = (item: { visitor_id: string | null; lat: number | null; lon: number | null }) => {
    if (item.lat !== null && item.lon !== null) setTarget({ lat: item.lat, lon: item.lon });
    setHighlight(item.visitor_id);
  };
  const globeFocus = useMemo(() => (target ? { at: [target.lat, target.lon] as const } : null), [target]);

  // ---- keyboard: Esc closes
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && !document.fullscreenElement && onClose();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);

  const visitors = useMemo(() => data?.visitors ?? [], [data]);
  // Memoised: the dot map rebuilds its layers whenever its markers change.
  const dotMarkers = useMemo<DotMapMarker[]>(
    () =>
      visitors.flatMap((v) => {
        if (v.lat === null || v.lon === null) return [];
        const picked = v.visitor_id === highlight;
        return [
          {
            at: [v.lat, v.lon],
            color: picked ? 'pink' : v.spent > 0 ? 'orange' : 'blue',
            label: picked ? `${displayName(v.visitor_id, v.name, v.email)}${v.city ? ` · ${v.city}` : ''}` : undefined,
          },
        ];
      }),
    [visitors, highlight],
  );
  const globeMarkers = useMemo<GlobeMarker[]>(() => dotMarkers.map(({ at, color }) => ({ at, color })), [dotMarkers]);
  const summary = useMemo(
    () => ({
      referrers: top(visitors.map((v) => v.source)),
      countries: top(visitors.map((v) => v.country)),
      devices: top(visitors.map((v) => v.device)),
      unplaced: visitors.filter((v) => v.lat === null).length,
    }),
    [visitors],
  );

  // Follows the app theme; the colours below flip with it (see styles.css).
  const { dark } = useTheme();
  const backdrop = view === 'map' ? 'bg-[#070b1a]' : 'bg-paper';
  const panel = 'bg-white/90 text-ink border-stone-200';
  const muted = 'text-stone-500';
  const btn = 'rounded-lg p-1.5 transition hover:bg-stone-100';

  return (
    <div ref={rootRef} className={`fixed inset-0 z-50 ${backdrop}`}>
      {view === 'map' && (
        <Suspense fallback={null}>
          <LiveMap visitors={visitors} style={dark ? 'dark' : 'light'} projection={projection} highlight={highlight} flyTo={target} onOpenVisitor={openVisitor} />
        </Suspense>
      )}
      {view === 'globe' && (
        // Beside the panels on wide screens, behind them on phones.
        <div className="absolute inset-0 sm:left-[380px]">
          <DitherGlobe className="h-full w-full" markers={globeMarkers} color="ink" accent="blue" cell={3} speed={5} ocean={dark ? 0.22 : 0.14} focus={globeFocus} />
        </div>
      )}
      {view === 'dots' && (
        <div className="absolute inset-0 flex items-center justify-center px-4 sm:pl-[400px] sm:pr-10">
          <DotMap className="max-w-[1500px]" markers={dotMarkers} color="grey" accent="blue" columns={180} halo={9} title="Live visitors" />
        </div>
      )}
      {view !== 'map' && (
        <p className={`pointer-events-none absolute bottom-3 right-4 hidden font-mono text-[10px] uppercase tracking-[0.08em] sm:block text-stone-400`}>
          {view === 'globe' ? 'Drag or use arrow keys to turn' : 'Live visitors · last 30 min'}
        </p>
      )}

      {/* Summary card */}
      <div className={`absolute left-3 top-3 w-[min(360px,calc(100%-24px))] rounded-2xl border p-4 shadow-xl backdrop-blur ${panel}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-semibold">
            <Favicon domain={site.domain} size={18} /> {site.name}
            <span className={`text-xs font-medium uppercase tracking-wider ${muted}`}>· Real-time</span>
          </div>
          <div className="flex items-center">
            <button
              className={btn}
              title={sound ? 'Sound on' : 'Sound off'}
              onClick={() => {
                unlockAudio();
                setSound((s) => !s);
              }}
            >
              {sound ? '🔔' : '🔕'}
            </button>
            {view === 'map' && (
              <button className={`${btn} font-mono text-[11px] font-medium`} title="3D globe / 2D map" onClick={() => setProjection((p) => (p === 'globe' ? 'mercator' : 'globe'))}>
                {projection === 'globe' ? '2D' : '3D'}
              </button>
            )}
            <button className={btn} title="Light / dark" onClick={() => setTheme(dark ? 'light' : 'dark')}>
              {dark ? '☀️' : '🌙'}
            </button>
            <button
              className={btn}
              title="Fullscreen"
              onClick={() => (document.fullscreenElement ? document.exitFullscreen() : rootRef.current?.requestFullscreen())}
            >
              ⛶
            </button>
            <button className={btn} title="Close (Esc)" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>
        <div className={`mt-3 flex rounded-lg border p-0.5 border-stone-200 bg-stone-50`} role="tablist" aria-label="View">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              role="tab"
              aria-selected={view === v.value}
              title={v.title}
              onClick={() => setView(v.value)}
              className={`flex-1 rounded-md py-1 font-mono text-[11px] uppercase tracking-[0.06em] transition ${
                view === v.value ? 'bg-white text-ink shadow-card ring-1 ring-stone-200' : 'text-stone-500 hover:text-ink'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 text-sm">
          <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
          <b>{visitors.length}</b> visitor{visitors.length === 1 ? '' : 's'} on <span className="font-medium">{site.domain}</span>
        </div>
        {visitors.length > 0 && (
          <div className="mt-3 space-y-1.5 text-xs">
            <Chips label="Referrers" muted={muted} items={summary.referrers.map(([k, n]) => [<SourceIcon key="i" source={k} size={14} />, k, n])} />
            <Chips label="Countries" muted={muted} items={summary.countries.map(([k, n]) => [<Flag key="i" cc={k} size={14} />, countryName(k), n])} />
            <Chips label="Devices" muted={muted} items={summary.devices.map(([k, n]) => [<DeviceIcon key="i" name={k} size={14} />, k, n])} />
          </div>
        )}
        {summary.unplaced > 0 && (
          <p className={`mt-2 text-[11px] ${muted}`}>
            {summary.unplaced} visitor{summary.unplaced > 1 ? 's' : ''} without a location (arrived before the globe was added) not shown.
          </p>
        )}
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
      </div>

      {/* Live event feed */}
      <div className={`absolute bottom-3 left-3 max-h-[45vh] w-[min(380px,calc(100%-24px))] overflow-y-auto rounded-2xl border p-2 shadow-xl backdrop-blur ${panel}`}>
        {!data && <p className={`p-3 text-sm ${muted}`}>Connecting…</p>}
        {data && data.feed.length === 0 && <p className={`p-3 text-sm ${muted}`}>No activity in the last 30 minutes.</p>}
        {data?.feed.map((f) => {
          const who = f.visitor_id ? displayName(f.visitor_id, f.name) : f.name ?? 'Someone';
          return (
            <button
              key={f.id}
              onClick={() => focus(f)}
              className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] leading-snug hover:bg-stone-100 ${
                f.visitor_id && f.visitor_id === highlight ? 'bg-stone-100' : ''
              }`}
            >
              <span className="mt-0.5 shrink-0">{f.type === 'payment' ? '💳' : f.type === 'refund' ? '↩️' : f.type === 'goal' ? '🎯' : '👁'}</span>
              <span className="min-w-0">
                <span className="font-semibold">{who}</span>
                {f.country && (
                  <span className={muted}>
                    {' '}
                    from {flag(f.country)} {countryName(f.country)}
                  </span>
                )}{' '}
                {f.type === 'pageview' && (
                  <>
                    visited <code className="font-medium">{f.label}</code>
                  </>
                )}
                {f.type === 'goal' && (
                  <>
                    completed <span className="font-medium text-violet-500">{f.label}</span>
                  </>
                )}
                {f.type === 'payment' && (
                  <>
                    made a <span className="font-semibold text-emerald-500">{money(f.amount ?? 0)}</span> payment
                  </>
                )}
                {f.type === 'refund' && <>was refunded {money(Math.abs(f.amount ?? 0))}</>}
                <span className={`block text-[11px] ${muted}`}>{fmtAgo(Date.now() - f.ts)} ago</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Chips({ label, items, muted }: { label: string; items: [React.ReactNode, string, number][]; muted: string }) {
  if (!items.length) return null;
  return (
    <div className="flex items-center gap-2">
      <span className={`w-16 shrink-0 ${muted}`}>{label}</span>
      <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
        {items.map(([icon, name, n]) => (
          <span key={name} className="flex items-center gap-1">
            {icon}
            <span className="max-w-[110px] truncate">{name}</span>
            <span className={muted}>({n})</span>
          </span>
        ))}
      </div>
    </div>
  );
}
