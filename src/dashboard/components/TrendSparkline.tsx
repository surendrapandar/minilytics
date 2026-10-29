import { useEffect, useRef, useState } from 'react';

type Props = { values: number[]; buckets: string[]; name: string; metric: string };
const WIDTH = 320;
const HEIGHT = 84;
const TOP = 8;
const BOTTOM = 72;
const DURATION = 280;

function resample(values: number[], length: number) {
  if (!values.length) return Array(length).fill(0) as number[];
  if (values.length === 1) return Array(length).fill(values[0]) as number[];
  return Array.from({ length }, (_, i) => {
    const index = (i / Math.max(1, length - 1)) * (values.length - 1);
    const low = Math.floor(index);
    const t = index - low;
    return values[low] * (1 - t) + values[Math.min(low + 1, values.length - 1)] * t;
  });
}

function makePaths(values: number[], scale: number) {
  const points = values.map((value, index) => ({
    x: (index / Math.max(1, values.length - 1)) * WIDTH,
    y: BOTTOM - (Math.max(0, value) / Math.max(1, scale)) * (BOTTOM - TOP),
  }));
  const line = points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
  return { line, area: `${line} L${WIDTH},${BOTTOM} L0,${BOTTOM} Z`, points };
}

/** Animate actual chart geometry via RAF, including metric switches with different bucket counts. */
export function TrendSparkline({ values, buckets, name, metric }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const [rendered, setRendered] = useState(values);
  const renderedRef = useRef(values);
  const frameRef = useRef<number | null>(null);
  const reducedMotion = useRef(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { reducedMotion.current = media.matches; };
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    setActive(null);
    if (reducedMotion.current || !values.length) {
      renderedRef.current = values;
      setRendered(values);
      return;
    }

    const count = Math.max(2, values.length, renderedRef.current.length);
    const from = resample(renderedRef.current, count);
    const to = resample(values, count);
    const start = performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / DURATION);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = from.map((value, i) => value + (to[i] - value) * eased);
      renderedRef.current = next;
      setRendered(next);
      if (progress < 1) frameRef.current = requestAnimationFrame(tick);
      else {
        frameRef.current = null;
        renderedRef.current = values;
        setRendered(values);
      }
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => { if (frameRef.current !== null) cancelAnimationFrame(frameRef.current); };
  }, [values.join(',')]);

  const max = Math.max(1, ...values, ...rendered);
  const { line, area, points } = makePaths(rendered, max);
  const empty = !values.length || values.every((value) => value === 0);
  // A new period may have fewer buckets before the effect clears the previous hover index.
  const safeActive = active !== null && active < values.length ? active : null;
  const focus = safeActive === null ? null : points[Math.round((safeActive / Math.max(1, values.length - 1)) * (points.length - 1))];

  if (empty) return <div className="flex h-20 items-center justify-center rounded-xl bg-stone-50 text-xs text-stone-400">No {metric} in this period</div>;

  return (
    <div className="relative" onPointerLeave={() => setActive(null)}>
      <svg className="h-20 w-full" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={`${name} ${metric} trend`}>
        <path d={area} fill="#8dbdf0" fillOpacity="0.17" />
        <path d={line} fill="none" stroke="#679bd3" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
        {focus && <><line x1={focus.x} x2={focus.x} y1={TOP} y2={BOTTOM} stroke="#a8b8c8" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" /><circle cx={focus.x} cy={focus.y} r="4" fill="#3678ba" stroke="white" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></>}
      </svg>
      <div className="absolute inset-0 flex">
        {values.map((value, index) => (
          <button key={index} type="button" className="h-full min-w-0 flex-1 cursor-crosshair bg-transparent" aria-label={`${buckets[index] ?? 'Period'}: ${value} ${metric}`} onPointerEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} onClick={() => setActive(index)} />
        ))}
      </div>
      {safeActive !== null && (
        <div className="pointer-events-none absolute -top-9 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg bg-stone-800 px-2 py-1 text-xs text-white shadow-sm" style={{ left: `${Math.max(18, Math.min(82, ((safeActive + 0.5) / values.length) * 100))}%` }}>
          {buckets[safeActive]} · {values[safeActive].toLocaleString()} {metric}
        </div>
      )}
    </div>
  );
}
