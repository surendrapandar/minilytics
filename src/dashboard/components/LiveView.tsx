import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { displayName, persona } from '../../shared/names';
import { api } from '../lib/api';
import { useDash } from '../lib/context';
import { countryName, flag, fmtAgo } from '../lib/format';
import { playPayment, playVisitor, unlockAudio } from '../lib/sounds';
import { DeviceIcon, Favicon, Flag, SourceIcon } from './Icons';

interface LiveVisitor {
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

// Free vector tiles from OpenFreeMap (no account or API key).
const STYLES = {
  light: 'https://tiles.openfreemap.org/styles/liberty',
  dark: 'https://tiles.openfreemap.org/styles/dark',
} as const;
type StyleName = keyof typeof STYLES;
type Projection = 'globe' | 'mercator';

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

function markerElement(v: LiveVisitor, onClick: () => void): HTMLElement {
  const p = persona(v.visitor_id);
  // MapLibre positions the outer element with a CSS transform; we only animate the inner bubble.
  const wrap = document.createElement('div');
  const el = document.createElement('button');
  el.className = 'ml-live-bubble';
  el.title = `${displayName(v.visitor_id, v.name, v.email)}${v.city ? ` · ${v.city}` : ''}`;
  el.style.cssText = `width:44px;height:44px;border-radius:9999px;background:${p.color};border:3px solid ${v.spent > 0 ? '#e07b5f' : '#fff'};
    box-shadow:0 4px 14px rgba(0,0,0,.35);font-size:24px;display:flex;align-items:center;justify-content:center;cursor:pointer;
    transition:transform .2s;`;
  el.textContent = p.emoji;
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  wrap.appendChild(el);
  return wrap;
}

export default function LiveView({ onClose }: { onClose: () => void }) {
  const { site, money, openVisitor } = useDash();
  const rootRef = useRef<HTMLDivElement>(null);
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new Map<string, maplibregl.Marker>());
  const knownVisitors = useRef<Set<string> | null>(null);
  const knownPayments = useRef<Set<string> | null>(null);
  const interacting = useRef(0);

  const [data, setData] = useState<Realtime | null>(null);
  const [error, setError] = useState('');
  const [style, setStyle] = useState<StyleName>(() => pref('ml_live_style', 'light'));
  const [projection, setProjection] = useState<Projection>(() => pref('ml_live_projection', 'globe'));
  const [sound, setSound] = useState(() => pref<string>('ml_live_sound', 'off') === 'on');
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const [highlight, setHighlight] = useState<string | null>(null);
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

  const projectionRef = useRef(projection);
  projectionRef.current = projection;

  // ---- map setup
  useEffect(() => {
    if (!mapEl.current) return;
    const map = new maplibregl.Map({
      container: mapEl.current,
      style: STYLES[style],
      center: [10, 25],
      zoom: 1.4,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    const applyProjection = () => {
      try {
        map.setProjection({ type: projectionRef.current });
      } catch {}
    };
    map.on('style.load', applyProjection);
    const stop = () => (interacting.current = Date.now());
    map.on('mousedown', stop);
    map.on('touchstart', stop);
    map.on('wheel', stop);

    // Slow spin while nobody touches the map, like a desk globe.
    let raf = 0;
    const spin = () => {
      if (projectionRef.current === 'globe' && Date.now() - interacting.current > 8000 && !map.isMoving()) {
        const c = map.getCenter();
        map.setCenter([c.lng + 0.04, c.lat]);
      }
      raf = requestAnimationFrame(spin);
    };
    raf = requestAnimationFrame(spin);

    return () => {
      cancelAnimationFrame(raf);
      markers.current.forEach((m) => m.remove());
      markers.current.clear();
      map.remove();
      mapRef.current = null;
    };
    // The map is created once; style and projection changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    savePref('ml_live_projection', projection);
    try {
      if (map.isStyleLoaded()) map.setProjection({ type: projection });
    } catch {}
  }, [projection]);

  const firstStyle = useRef(true);
  useEffect(() => {
    savePref('ml_live_style', style);
    if (firstStyle.current) {
      firstStyle.current = false;
      return;
    }
    mapRef.current?.setStyle(STYLES[style]);
  }, [style]);

  useEffect(() => savePref('ml_live_sound', sound ? 'on' : 'off'), [sound]);

  // ---- keep one marker per live visitor
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    const live = new Set<string>();
    for (const v of data.visitors) {
      if (v.lat === null || v.lon === null) continue;
      live.add(v.visitor_id);
      const existing = markers.current.get(v.visitor_id);
      if (existing) existing.setLngLat([v.lon, v.lat]);
      else {
        const m = new maplibregl.Marker({ element: markerElement(v, () => openVisitor(v.visitor_id)) })
          .setLngLat([v.lon, v.lat])
          .addTo(map);
        markers.current.set(v.visitor_id, m);
      }
    }
    for (const [id, m] of markers.current) {
      if (!live.has(id)) {
        m.remove();
        markers.current.delete(id);
      }
    }
  }, [data, openVisitor]);

  useEffect(() => {
    for (const [id, m] of markers.current) {
      const wrap = m.getElement();
      const bubble = wrap.firstElementChild as HTMLElement | null;
      if (bubble) bubble.style.transform = id === highlight ? 'scale(1.35)' : '';
      wrap.style.zIndex = id === highlight ? '10' : '';
    }
  }, [highlight, data]);

  const focus = (item: { visitor_id: string | null; lat: number | null; lon: number | null }) => {
    interacting.current = Date.now();
    if (item.lat !== null && item.lon !== null) {
      mapRef.current?.flyTo({ center: [item.lon, item.lat], zoom: Math.max(mapRef.current.getZoom(), 3), duration: 1500 });
    }
    setHighlight(item.visitor_id);
  };

  // ---- keyboard: Esc closes
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && !document.fullscreenElement && onClose();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);

  const visitors = data?.visitors ?? [];
  const summary = useMemo(
    () => ({
      referrers: top(visitors.map((v) => v.source)),
      countries: top(visitors.map((v) => v.country)),
      devices: top(visitors.map((v) => v.device)),
      unplaced: visitors.filter((v) => v.lat === null).length,
    }),
    [visitors],
  );

  const dark = style === 'dark';
  const panel = dark ? 'bg-stone-900/85 text-stone-100 border-white/10' : 'bg-white/90 text-ink border-stone-200';
  const muted = dark ? 'text-stone-400' : 'text-stone-500';
  const btn = `rounded-lg p-1.5 transition ${dark ? 'hover:bg-white/10' : 'hover:bg-stone-100'}`;

  return (
    <div ref={rootRef} className="fixed inset-0 z-50 bg-[#070b1a]">
      {/* MapLibre's CSS makes its container position:relative, so it gets its own full-size wrapper. */}
      <div className="absolute inset-0">
        <div ref={mapEl} className="h-full w-full" />
      </div>

      {/* Summary card */}
      <div className={`absolute left-3 top-3 w-[min(360px,calc(100%-24px))] rounded-2xl border p-4 shadow-xl backdrop-blur ${panel}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 font-semibold">
            <Favicon domain={site.domain} size={18} />
            <span className="truncate" title={site.name}>{site.name}</span>
            <span className={`hidden whitespace-nowrap text-xs font-medium uppercase tracking-wider sm:inline ${muted}`}>· Real-time</span>
          </div>
          <div className="flex shrink-0 items-center">
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
            <button className={`${btn} text-xs font-semibold`} title="3D globe / 2D map" onClick={() => setProjection((p) => (p === 'globe' ? 'mercator' : 'globe'))}>
              {projection === 'globe' ? '2D' : '3D'}
            </button>
            <button className={btn} title="Light / dark map" onClick={() => setStyle((s) => (s === 'light' ? 'dark' : 'light'))}>
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
        <div className="mt-2 flex items-center gap-2 text-sm">
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
            {summary.unplaced} visitor{summary.unplaced > 1 ? 's' : ''} without a location (arrived before the globe was added) not shown on the map.
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
              className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] leading-snug ${
                dark ? 'hover:bg-white/10' : 'hover:bg-stone-100'
              } ${f.visitor_id && f.visitor_id === highlight ? (dark ? 'bg-white/10' : 'bg-stone-100') : ''}`}
            >
              <span className="mt-0.5 shrink-0">{f.type === 'payment' ? '💳' : f.type === 'refund' ? '↩️' : f.type === 'goal' ? '🎯' : '👁'}</span>
              <span className="min-w-0 break-words">
                <span className="font-semibold">{who}</span>
                {f.country && (
                  <span className={muted}>
                    {' '}
                    from {flag(f.country)} {countryName(f.country)}
                  </span>
                )}{' '}
                {f.type === 'pageview' && (
                  <>
                    visited <code className="break-all font-medium">{f.label}</code>
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
