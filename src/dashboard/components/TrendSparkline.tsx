/** Render an SVG sparkline without mounting a heavy charting library for each website. */
export function TrendSparkline({ values, name }: { values: number[]; name: string }) {
  if (!values.length || values.every((value) => value === 0)) {
    return <div className="flex h-20 items-center justify-center rounded-xl bg-stone-50 text-xs text-stone-400">No visits in this period</div>;
  }

  const max = Math.max(1, ...values);
  const coordinates = values.map((value, i) => ({
    x: values.length > 1 ? (i / (values.length - 1)) * 100 : 50,
    y: 46 - (value / max) * 40,
  }));
  const line = coordinates.map(({ x, y }, i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `${line} L100,48 L0,48 Z`;

  return (
    <svg className="h-20 w-full overflow-visible" viewBox="0 0 100 48" preserveAspectRatio="none" role="img" aria-label={`${name} visitor trend`}>
      <path d={area} fill="#8dbdf0" fillOpacity="0.17" />
      <path d={line} fill="none" stroke="#679bd3" strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
