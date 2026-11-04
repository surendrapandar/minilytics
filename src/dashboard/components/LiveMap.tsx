import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { displayName, persona } from '../../shared/names';
import type { LiveVisitor } from './LiveView';

// Free vector tiles from OpenFreeMap (no account or API key).
const STYLES = {
  light: 'https://tiles.openfreemap.org/styles/liberty',
  dark: 'https://tiles.openfreemap.org/styles/dark',
} as const;
export type MapStyle = keyof typeof STYLES;
export type Projection = 'globe' | 'mercator';

function markerElement(v: LiveVisitor, onClick: () => void): HTMLElement {
  const p = persona(v.visitor_id);
  // MapLibre positions the outer element with a CSS transform; we only animate the inner bubble.
  const wrap = document.createElement('div');
  const el = document.createElement('button');
  el.className = 'ml-live-bubble';
  el.title = `${displayName(v.visitor_id, v.name, v.email)}${v.city ? ` · ${v.city}` : ''}`;
  el.style.cssText = `width:44px;height:44px;border-radius:9999px;background:${p.color};border:3px solid ${v.spent > 0 ? '#e06a45' : '#fff'};
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

/** The MapLibre view of the live page: real map tiles, one bubble per visitor. Loaded only when picked. */
export default function LiveMap({
  visitors,
  style,
  projection,
  highlight,
  flyTo,
  onOpenVisitor,
}: {
  visitors: LiveVisitor[];
  style: MapStyle;
  projection: Projection;
  highlight: string | null;
  /** A new object flies the map there. */
  flyTo: { lat: number; lon: number } | null;
  onOpenVisitor: (id: string) => void;
}) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new Map<string, maplibregl.Marker>());
  const interacting = useRef(0);
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
    try {
      if (map?.isStyleLoaded()) map.setProjection({ type: projection });
    } catch {}
  }, [projection]);

  const firstStyle = useRef(true);
  useEffect(() => {
    if (firstStyle.current) {
      firstStyle.current = false;
      return;
    }
    mapRef.current?.setStyle(STYLES[style]);
  }, [style]);

  // ---- keep one marker per live visitor
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const live = new Set<string>();
    for (const v of visitors) {
      if (v.lat === null || v.lon === null) continue;
      live.add(v.visitor_id);
      const existing = markers.current.get(v.visitor_id);
      if (existing) existing.setLngLat([v.lon, v.lat]);
      else {
        const m = new maplibregl.Marker({ element: markerElement(v, () => onOpenVisitor(v.visitor_id)) })
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
  }, [visitors, onOpenVisitor]);

  useEffect(() => {
    for (const [id, m] of markers.current) {
      const wrap = m.getElement();
      const bubble = wrap.firstElementChild as HTMLElement | null;
      if (bubble) bubble.style.transform = id === highlight ? 'scale(1.35)' : '';
      wrap.style.zIndex = id === highlight ? '10' : '';
    }
  }, [highlight, visitors]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo) return;
    interacting.current = Date.now();
    map.flyTo({ center: [flyTo.lon, flyTo.lat], zoom: Math.max(map.getZoom(), 3), duration: 1500 });
  }, [flyTo]);

  // MapLibre's CSS makes its container position:relative, so it gets its own full-size wrapper.
  return (
    <div className="absolute inset-0 bg-[#070b1a]">
      <div ref={mapEl} className="h-full w-full" />
    </div>
  );
}
