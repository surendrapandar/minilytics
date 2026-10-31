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
const DURATION = 780;

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

/** A fixed path is revealed from left to right by the parent SVG clip. */
function ChartLine({ normalized, color, gradientId, fill, dashed = false }: {
  normalized: number[];
  color: string;
  gradientId: string;
  fill: boolean;
  dashed?: boolean;
}) {
  const d = pathFor(normalized);
  return (
    <>
      {fill && d && <path d={`${d} L${WIDTH},${BOTTOM} L0,${BOTTOM} Z`} fill={`url(#${gradientId})`} />}
      <path d={d} fill="none" stroke={color} strokeOpacity={dashed ? 0.58 : 1}
        strokeDasharray={dashed ? '6 5' : undefined}
        strokeWidth={dashed ? '1.8' : '2.2'} vectorEffect="non-scaling-stroke"
        strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

/** Current values use solid lines; optional independent-window comparisons use dashed lines. */
export function TrendSparkline({
  series, buckets, name, comparison,
}: {
  series: SparklineSeries[];
  buckets: string[];
  name: string;
  comparison?: { buckets: string[]; series: SparklineSeries[] } | null;
}) {
  const gradientId = useId().replace(/:/g, '-');
  const clipId = `${gradientId}-reveal`;
  const [active, setActive] = useState<number | null>(null);
  const [reveal, setReveal] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const count = buckets.length;
  const comparisonCount = comparison?.buckets.length ?? 0;
  const comparisonSeries = comparison?.series ?? [];
  const max = Math.max(1, ...series.flatMap((item) => item.values), ...comparisonSeries.flatMap((item) => item.values));
  const empty = !count || [...series, ...comparisonSeries].every((item) => item.values.every((value) => value === 0));
  const safeActive = active !== null && active >= 0 && active < count ? active : null;
  const focusX = safeActive === null ? 0 : (safeActive / Math.max(1, count - 1)) * WIDTH;
  const comparisonIndex = safeActive === null || !comparisonCount ? null
    : Math.round((safeActive / Math.max(1, count - 1)) * (comparisonCount - 1));
  const drawingKey = [buckets.join('|'), series.map((item) => item.key).join('|'),
    comparison?.buckets.join('|') ?? '', comparisonSeries.map((item) => item.key).join('|')].join('::');

  // Replays for date / metric selections, but not on background polling of the same window.
  useEffect(() => {
    setActive(null);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reduced) {
      setReveal(1);
      return;
    }
    setReveal(0);
    const start = performance.now();
    let frame = 0;
    function draw(now: number) {
      const t = Math.max(0, Math.min(1, (now - start) / DURATION));
      setReveal(1 - Math.pow(1 - t, 3));
      if (t < 1) frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [drawingKey]);

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
    <div ref={root} className="relative cursor-crosshair rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
      role="group" tabIndex={0} aria-label={`${name} trend chart. Use arrow keys to inspect dates.`}
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
      <span className="sr-only" aria-live="polite">
        {safeActive !== null
          ? `${buckets[safeActive]}: ${series.map((item) => `${item.label} ${(item.values[safeActive] ?? 0).toLocaleString()}`).join(', ')}${comparisonIndex !== null
            ? `; comparison ${comparison?.buckets[comparisonIndex]}: ${comparisonSeries.map((item) => `${item.label} ${(item.values[comparisonIndex] ?? 0).toLocaleString()}`).join(', ')}`
            : ''}`
          : ''}
      </span>
      <svg className="h-20 w-full" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={series[0]?.color ?? '#8dbdf0'} stopOpacity="0.25" />
            <stop offset="100%" stopColor={series[0]?.color ?? '#8dbdf0'} stopOpacity="0.015" />
          </linearGradient>
          <clipPath id={clipId}><rect x="0" y="0" width={WIDTH * reveal} height={HEIGHT} /></clipPath>
        </defs>
        <line x1="0" x2={WIDTH} y1={BOTTOM} y2={BOTTOM} stroke="#ece9e6" strokeWidth="1" />
        <g clipPath={`url(#${clipId})`}>
          {comparisonSeries.map((item) => (
            <ChartLine key={`compare-${item.key}`}
              normalized={resample(item.values, count).map((value) => value / max)}
              color={item.color} gradientId={gradientId} fill={false} dashed />
          ))}
          {series.map((item, index) => (
            <ChartLine key={item.key} normalized={item.values.map((value) => value / max)}
              color={item.color} gradientId={gradientId} fill={index === 0} />
          ))}
        </g>
        {safeActive !== null && (
          <>
            <line x1={focusX} x2={focusX} y1={TOP} y2={BOTTOM} stroke="#a8a29e" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            {series.map((item) => (
              <circle key={item.key} cx={focusX}
                cy={BOTTOM - ((item.values[safeActive] ?? 0) / max) * (BOTTOM - TOP)}
                r="3.7" fill={item.color} stroke="white" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            ))}
          </>
        )}
      </svg>
      {safeActive !== null && (
        <div aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-0 z-20 max-w-[calc(100%-0.5rem)] -translate-x-1/2 rounded-lg border border-stone-200 bg-white/95 px-3 py-2 text-xs shadow-md backdrop-blur-sm"
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
          {comparisonIndex !== null && (
            <>
              <div className="mt-2 border-t border-stone-100 pt-1 text-stone-500">Compare · {comparison?.buckets[comparisonIndex]}</div>
              {comparisonSeries.map((item) => (
                <div key={item.key} className="flex items-center justify-between gap-4 whitespace-nowrap text-stone-600">
                  <span>{item.label}</span>
                  <span className="font-medium text-stone-800">{(item.values[comparisonIndex] ?? 0).toLocaleString()}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
