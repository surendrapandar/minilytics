import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';

export interface SparklineSeries {
  key: string;
  label: string;
  color: string;
  values: number[];
}

const WIDTH = 320;
const HEIGHT = 84;
const TOP = 7;
const BOTTOM = 75;
const DURATION = 300;

function resample(values: number[], length: number): number[] {
  if (!values.length) return Array(length).fill(0) as number[];
  if (values.length === 1) return Array(length).fill(values[0]) as number[];
  return Array.from({ length }, (_, index) => {
    const position = (index / Math.max(1, length - 1)) * (values.length - 1);
    const low = Math.floor(position);
    const ratio = position - low;
    return values[low] * (1 - ratio) + values[Math.min(low + 1, values.length - 1)] * ratio;
  });
}

function coordinates(values: number[]) {
  return values.map((value, index) => ({
    x: (index / Math.max(1, values.length - 1)) * WIDTH,
    y: BOTTOM - Math.max(0, value) * (BOTTOM - TOP),
  }));
}

function pathFor(values: number[]) {
  return coordinates(values)
    .map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');
}

/** Animate the SVG geometry with RAF; switch series without a charting dependency. */
function AnimatedLine({ normalized, color, gradientId, fill }: {
  normalized: number[];
  color: string;
  gradientId: string;
  fill: boolean;
}) {
  const [rendered, setRendered] = useState<number[]>(() => normalized.map(() => 0));
  const current = useRef<number[]>(normalized.map(() => 0));
  const frame = useRef<number | null>(null);
  const signature = normalized.join(',');

  useEffect(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reducedMotion || !normalized.length) {
      current.current = normalized;
      setRendered(normalized);
      return;
    }
    const count = Math.max(2, normalized.length, current.current.length);
    const startValues = resample(current.current, count);
    const endValues = resample(normalized, count);
    const start = performance.now();

    function animate(now: number) {
      const progress = Math.min(1, Math.max(0, (now - start) / DURATION));
      const ease = 1 - Math.pow(1 - progress, 3);
      const next = startValues.map((value, index) => value + (endValues[index] - value) * ease);
      current.current = next;
      setRendered(next);
      if (progress < 1) frame.current = requestAnimationFrame(animate);
      else {
        frame.current = null;
        current.current = normalized;
        setRendered(normalized);
      }
    }
    frame.current = requestAnimationFrame(animate);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [signature]);

  const d = pathFor(rendered);
  return (
    <>
      {fill && d && <path d={`${d} L${WIDTH},${BOTTOM} L0,${BOTTOM} Z`} fill={`url(#${gradientId})`} />}
      <path d={d} fill="none" stroke={color} strokeWidth="2.2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

/** Render up to two globally selected metrics on the same absolute-value scale. */
export function TrendSparkline({ series, buckets, name }: { series: SparklineSeries[]; buckets: string[]; name: string }) {
  const gradientId = useId().replace(/:/g, '-');
  const [active, setActive] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const count = buckets.length;
  const max = Math.max(1, ...series.flatMap((item) => item.values));
  const empty = !count || series.every((item) => item.values.every((value) => value === 0));
  const safeActive = active !== null && active >= 0 && active < count ? active : null;
  const focusX = safeActive === null ? 0 : (safeActive / Math.max(1, count - 1)) * WIDTH;

  useEffect(() => { setActive(null); }, [buckets.join('|'), series.map((item) => item.key).join('|')]);

  function move(event: PointerEvent<HTMLDivElement>) {
    const bounds = root.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || count === 0) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    setActive(Math.round(ratio * (count - 1)));
  }

  if (empty) {
    return <div className="flex h-20 items-center justify-center rounded-xl bg-stone-50 text-xs text-stone-400">No activity for the selected metrics</div>;
  }

  return (
    <div
      ref={root}
      className="relative cursor-crosshair rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
      role="group"
      tabIndex={0}
      aria-label={`${name} trend chart. Use arrow keys to inspect dates.`}
      onPointerMove={(event) => { if (event.pointerType !== 'touch') move(event); }}
      onPointerDown={move}
      onPointerLeave={(event) => { if (event.pointerType !== 'touch') setActive(null); }}
      onBlur={() => setActive(null)}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const delta = event.key === 'ArrowRight' ? 1 : -1;
        setActive((index) => Math.max(0, Math.min(count - 1, (index ?? (delta > 0 ? -1 : count)) + delta)));
      }}
    >
      <svg className="h-20 w-full" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#8dbdf0" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#8dbdf0" stopOpacity="0.015" />
          </linearGradient>
        </defs>
        <line x1="0" x2={WIDTH} y1={BOTTOM} y2={BOTTOM} stroke="#ece9e6" strokeWidth="1" />
        {series.map((item, index) => (
          <AnimatedLine
            key={item.key}
            normalized={item.values.map((value) => value / max)}
            color={item.color}
            gradientId={gradientId}
            fill={index === 0}
          />
        ))}
        {safeActive !== null && (
          <>
            <line x1={focusX} x2={focusX} y1={TOP} y2={BOTTOM} stroke="#a8a29e" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            {series.map((item) => (
              <circle
                key={item.key}
                cx={focusX}
                cy={BOTTOM - ((item.values[safeActive] ?? 0) / max) * (BOTTOM - TOP)}
                r="3.7"
                fill={item.color}
                stroke="white"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </>
        )}
      </svg>
      {safeActive !== null && (
        <div
          className="pointer-events-none absolute top-0 z-20 -translate-x-1/2 rounded-lg border border-stone-200 bg-white/95 px-3 py-2 text-xs shadow-md backdrop-blur-sm"
          style={{ left: `${Math.max(24, Math.min(76, ((safeActive + 0.5) / count) * 100))}%` }}
        >
          <div className="mb-1 whitespace-nowrap font-semibold text-stone-700">{buckets[safeActive]}</div>
          {series.map((item) => (
            <div key={item.key} className="flex min-w-[140px] items-center justify-between gap-4 whitespace-nowrap text-stone-600">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                {item.label}
              </span>
              <span className="font-medium text-stone-800">{(item.values[safeActive] ?? 0).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
