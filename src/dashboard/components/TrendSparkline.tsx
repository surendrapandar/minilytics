import { useState } from 'react';

export function TrendSparkline({ values, buckets, name, metric }: { values: number[]; buckets: string[]; name: string; metric: string }) {
  const [active, setActive] = useState<number | null>(null);
  if (!values.length || values.every((value) => value === 0)) {
    return <div className="flex h-20 items-center justify-center rounded-xl bg-stone-50 text-xs text-stone-400">No {metric} in this period</div>;
  }

  const max = Math.max(1, ...values);
  const coordinates = values.map((value, i) => ({
    x: values.length > 1 ? (i / (values.length - 1)) * 100 : 50,
    y: 46 - (value / max) * 40,
  }));
  const line = coordinates.map(({ x, y }, i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `${line} L100,48 L0,48 Z`;
  const focus = active === null ? null : coordinates[active];

  return (
    <div className="relative">
      <svg className="h-20 w-full overflow-visible" viewBox="0 0 100 48" preserveAspectRatio="none" role="img" aria-label={`${name} ${metric} trend`}>
        <path d={area} fill="#8dbdf0" fillOpacity="0.17" />
        <path d={line} fill="none" stroke="#679bd3" strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'd 180ms ease' }} />
        {focus && <circle cx={focus.x} cy={focus.y} r="2.5" fill="#3678ba" stroke="white" strokeWidth="1" />}
      </svg>
      <div className="absolute inset-0 flex" onMouseLeave={() => setActive(null)}>
        {values.map((value, index) => (
          <button key={index} type="button" className="h-full flex-1 cursor-crosshair" aria-label={`${buckets[index] ?? 'Period'}: ${value} ${metric}`} onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} onClick={() => setActive(index)} />
        ))}
      </div>
      {active !== null && <div className="pointer-events-none absolute -top-9 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg bg-stone-800 px-2 py-1 text-xs text-white">{buckets[active]} · {values[active].toLocaleString()} {metric}</div>}
    </div>
  );
}
