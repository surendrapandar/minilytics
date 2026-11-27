import { useState, type MouseEvent } from 'react';
import { usePref } from '../lib/prefs';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Kpis, Overview } from '../lib/api';
import { useDash } from '../lib/context';
import { bucketLabel, fmtDuration, fmtNumber, fmtPct } from '../lib/format';

type Metric = 'visitors' | 'revenue';

// Keep in sync with chartVisitors / chartRevenue in tailwind.config.js.
const VISITORS = '#7b6ff0';
const REVENUE = '#e2a24f';

// Hover spotlight on the visitors line: full strength near the cursor, dimmed elsewhere.
const SPOT_HALF = 70; // px of full-strength line on each side of the cursor
const SPOT_FADE = 35; // px over which it fades to the dimmed strength
const SPOT_DIM = 0.3;

type Spot = { x: number; width: number };

function SpotlightDefs({ spot }: { spot: Spot }) {
  const at = (px: number) => `${Math.min(100, Math.max(0, (px / spot.width) * 100))}%`;
  const stops: [number, number][] = [
    [0, SPOT_DIM],
    [spot.x - SPOT_HALF - SPOT_FADE, SPOT_DIM],
    [spot.x - SPOT_HALF, 1],
    [spot.x + SPOT_HALF, 1],
    [spot.x + SPOT_HALF + SPOT_FADE, SPOT_DIM],
    [spot.width, SPOT_DIM],
  ];
  return (
    <>
      <linearGradient id="spot-grad" gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={spot.width} y2={0}>
        {stops.map(([px, o], i) => (
          <stop key={i} offset={at(px)} stopColor="white" stopOpacity={o} />
        ))}
      </linearGradient>
      <mask id="spot-mask" maskUnits="userSpaceOnUse" x={0} y={0} width="100%" height="100%">
        <rect width="100%" height="100%" fill="url(#spot-grad)" />
      </mask>
      <filter id="spot-glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation={4} result="glow" />
        <feMerge>
          <feMergeNode in="glow" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </>
  );
}

function Change({ cur, prev, invert = false }: { cur: number; prev: number; invert?: boolean }) {
  if (!prev) return <span className="text-xs text-stone-400">—</span>;
  const pct = (cur - prev) / prev;
  if (!Number.isFinite(pct)) return null;
  const up = pct >= 0;
  const good = invert ? !up : up;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${good ? 'text-emerald-600' : 'text-red-500'}`}>
      {up ? '↑' : '↓'} {Math.abs(pct * 100).toFixed(1)}%
    </span>
  );
}

export function OverviewCard({ data, onLive }: { data: Overview | null; onLive: () => void }) {
  const { money } = useDash();
  const [hidden, setHidden] = usePref<Record<Metric, boolean>>('ml_chart_hidden', { visitors: false, revenue: false });
  const c = data?.current;
  const p = data?.previous;

  const kpis: { key: keyof Kpis | 'online'; label: string; value: string; invert?: boolean; metric?: Metric; dot?: string }[] = c
    ? [
        { key: 'visitors', label: 'Visitors', value: fmtNumber(c.visitors), metric: 'visitors', dot: 'bg-chartVisitors' },
        { key: 'revenue', label: 'Revenue', value: money(c.revenue, true), metric: 'revenue', dot: 'bg-chartRevenue' },
        { key: 'conversionRate', label: 'Conversion rate', value: fmtPct(c.conversionRate, c.conversionRate >= 0.1 ? 0 : 2) },
        { key: 'revenuePerVisitor', label: 'Revenue/visitor', value: money(c.revenuePerVisitor) },
        { key: 'bounceRate', label: 'Bounce rate', value: fmtPct(c.bounceRate), invert: true },
        { key: 'avgDuration', label: 'Session time', value: fmtDuration(c.avgDuration) },
      ]
    : [];

  const g = data?.range.granularity ?? 'day';
  const [spot, setSpot] = useState<Spot | null>(null);
  const moveSpot = (e: MouseEvent<HTMLDivElement>) => {
    const svg = e.currentTarget.querySelector('svg.recharts-surface');
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    setSpot({ x: e.clientX - r.left, width: r.width });
  };

  return (
    <div className="card overflow-hidden p-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {kpis.map((k) => {
          const on = k.metric && !hidden[k.metric];
          return (
            <button
              key={k.key}
              className={`flex min-h-[132px] flex-col rounded-xl border border-stone-200/80 bg-white px-4 py-4 text-left transition ${
                k.metric ? 'hover:border-stone-300' : 'cursor-default'
              }`}
              onClick={() => k.metric && setHidden((h) => ({ ...h, [k.metric!]: !h[k.metric!] }))}
              title={k.metric ? 'Show/hide on chart' : undefined}
            >
              {k.metric ? (
                <span
                  className={`inline-flex items-center gap-2 self-start rounded-lg border-2 px-2 py-1 text-sm font-semibold transition ${
                    on ? 'border-chartVisitors/70 text-ink' : 'border-stone-200 text-stone-400'
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded border ${
                      on ? 'border-chartVisitors bg-chartVisitors text-white' : 'border-stone-300 bg-white'
                    }`}
                  >
                    {on && (
                      <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M2.5 6.5l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  {k.label}
                  <span className={`h-2 w-2 rounded-full ${k.dot}`} />
                </span>
              ) : (
                <span className="text-sm font-medium text-stone-500">{k.label}</span>
              )}
              <div className="mt-auto pt-4 text-[26px] font-semibold leading-tight tracking-tight">{k.value}</div>
              <Change cur={c![k.key as keyof Kpis]} prev={p![k.key as keyof Kpis]} invert={k.invert} />
            </button>
          );
        })}
        {data && (
          <button
            className="flex min-h-[132px] flex-col rounded-xl border border-stone-200/80 bg-white px-4 py-4 text-left transition hover:border-stone-300"
            onClick={onLive}
            title="Open the live map (M)"
          >
            <span className="flex items-center gap-1.5 text-sm font-medium text-stone-500">
              Online <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
            </span>
            <div className="mt-auto pt-4 text-[26px] font-semibold leading-tight tracking-tight">{data.online}</div>
            <div className="text-xs text-stone-400">View on map →</div>
          </button>
        )}
        {!data && <div className="col-span-full h-[132px] animate-pulse rounded-xl bg-stone-50" />}
      </div>

      <div
        className="mt-3 h-[360px] rounded-xl border border-stone-200/80 bg-white px-2 pb-3 pt-6 sm:px-4"
        onMouseMove={moveSpot}
        onMouseLeave={() => setSpot(null)}
      >
        {data && (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data.series} margin={{ top: 5, right: 5, left: 0, bottom: 0 }} barCategoryGap="12%">
              <defs>
                <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={REVENUE} stopOpacity={0.95} />
                  <stop offset="100%" stopColor={REVENUE} stopOpacity={0.35} />
                </linearGradient>
                {spot && <SpotlightDefs spot={spot} />}
              </defs>
              <CartesianGrid vertical={false} stroke="#e7e5e4" strokeDasharray="2 5" />
              <XAxis
                dataKey="bucket"
                tickFormatter={(b) => bucketLabel(b, g)}
                tick={{ fill: '#a8a29e', fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis
                yAxisId="v"
                tick={{ fill: '#a8a29e', fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                width={44}
                allowDecimals={false}
                tickFormatter={(v) => fmtNumber(v)}
              />
              <YAxis
                yAxisId="r"
                orientation="right"
                tick={{ fill: '#a8a29e', fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                width={56}
                tickFormatter={(v) => money(v, true)}
                hide={hidden.revenue}
                // Headroom keeps revenue bars in the lower part of the chart, under the visitors line.
                domain={[0, (max: number) => Math.max(1, Math.ceil(max * 1.6))]}
              />
              <Tooltip
                cursor={{ fill: 'rgba(28,25,23,0.04)' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as Overview['series'][0];
                  return (
                    <div className="card min-w-[180px] px-4 py-3 text-sm">
                      <div className="mb-2 font-medium">{bucketLabel(d.bucket, g, true)}</div>
                      <Row color="bg-chartVisitors" label="Visitors" value={fmtNumber(d.visitors)} />
                      <Row color="bg-stone-300" label="Pageviews" value={fmtNumber(d.pageviews)} />
                      <Row color="bg-chartRevenue" label="Revenue" value={money(d.revenue)} />
                      {d.payments > 0 && <Row color="bg-chartRevenue/40" label="Payments" value={String(d.payments)} />}
                    </div>
                  );
                }}
              />
              {!hidden.revenue && (
                <Bar yAxisId="r" dataKey="revenue" fill="url(#rev)" radius={[3, 3, 0, 0]} maxBarSize={32} isAnimationActive={false} />
              )}
              {!hidden.visitors && (
                <Line
                  yAxisId="v"
                  type="monotone"
                  dataKey="visitors"
                  stroke={VISITORS}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  dot={false}
                  activeDot={{ r: 4.5, fill: VISITORS, stroke: '#fff', strokeWidth: 2 }}
                  isAnimationActive={false}
                  mask={spot ? 'url(#spot-mask)' : undefined}
                  filter={spot ? 'url(#spot-glow)' : undefined}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function Row({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-6 py-0.5">
      <span className="flex items-center gap-2 text-stone-500">
        <span className={`h-2.5 w-2.5 rounded-sm ${color}`} />
        {label}
      </span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
