import { usePref } from '../lib/prefs';
import { Area, Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Kpis, Overview } from '../lib/api';
import { useDash } from '../lib/context';
import { bucketLabel, fmtDuration, fmtNumber, fmtPct } from '../lib/format';

type Metric = 'visitors' | 'revenue';

function Change({ cur, prev, invert = false }: { cur: number; prev: number; invert?: boolean }) {
  if (!prev) return <span className="text-xs text-stone-400">—</span>;
  const pct = (cur - prev) / prev;
  if (!Number.isFinite(pct)) return null;
  const up = pct >= 0;
  const good = invert ? !up : up;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs ${good ? 'text-emerald-600' : 'text-red-500'}`}>
      {Math.abs(Math.round(pct * 100))}% {up ? '↑' : '↓'}
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
        { key: 'visitors', label: 'Visitors', value: fmtNumber(c.visitors), metric: 'visitors', dot: 'bg-visitors' },
        { key: 'revenue', label: 'Revenue', value: money(c.revenue, true), metric: 'revenue', dot: 'bg-revenue' },
        { key: 'conversionRate', label: 'Conversion rate', value: fmtPct(c.conversionRate, c.conversionRate >= 0.1 ? 0 : 2) },
        { key: 'revenuePerVisitor', label: 'Revenue/visitor', value: money(c.revenuePerVisitor) },
        { key: 'bounceRate', label: 'Bounce rate', value: fmtPct(c.bounceRate), invert: true },
        { key: 'avgDuration', label: 'Session time', value: fmtDuration(c.avgDuration) },
      ]
    : [];

  const g = data?.range.granularity ?? 'day';

  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-2 border-b border-stone-100 sm:grid-cols-4 lg:grid-cols-7">
        {kpis.map((k) => (
          <button
            key={k.key}
            className={`border-stone-100 px-5 py-4 text-left lg:border-r ${k.metric ? 'hover:bg-stone-50' : 'cursor-default'}`}
            onClick={() => k.metric && setHidden((h) => ({ ...h, [k.metric!]: !h[k.metric!] }))}
            title={k.metric ? 'Show/hide on chart' : undefined}
          >
            <div className="flex items-center gap-1.5 text-sm text-stone-500">
              {k.dot && <span className={`h-2.5 w-2.5 rounded-sm ${k.dot} ${hidden[k.metric!] ? 'opacity-25' : ''}`} />}
              {k.label}
            </div>
            <div className="mt-1 text-[28px] font-semibold leading-tight tracking-tight">{k.value}</div>
            <Change cur={c![k.key as keyof Kpis]} prev={p![k.key as keyof Kpis]} invert={k.invert} />
          </button>
        ))}
        {data && (
          <button className="px-5 py-4 text-left hover:bg-stone-50" onClick={onLive} title="Open the live map (M)">
            <div className="flex items-center gap-1.5 text-sm text-stone-500">
              Online <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
            </div>
            <div className="mt-1 text-[28px] font-semibold leading-tight">{data.online}</div>
            <div className="text-xs text-stone-400">View on map →</div>
          </button>
        )}
        {!data && <div className="col-span-full h-[98px] animate-pulse bg-stone-50" />}
      </div>

      <div className="h-[340px] px-2 pb-3 pt-6 sm:px-4">
        {data && (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data.series} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="vis" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8dbdf0" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#8dbdf0" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="#efedea" strokeDasharray="4 4" />
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
                cursor={{ fill: 'rgba(28,25,23,0.03)' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as Overview['series'][0];
                  return (
                    <div className="card min-w-[180px] px-4 py-3 text-sm">
                      <div className="mb-2 font-medium">{bucketLabel(d.bucket, g, true)}</div>
                      <Row color="bg-visitors" label="Visitors" value={fmtNumber(d.visitors)} />
                      <Row color="bg-stone-300" label="Pageviews" value={fmtNumber(d.pageviews)} />
                      <Row color="bg-revenue" label="Revenue" value={money(d.revenue)} />
                      {d.payments > 0 && <Row color="bg-revenueSoft" label="Payments" value={String(d.payments)} />}
                    </div>
                  );
                }}
              />
              {!hidden.revenue && (
                <Bar yAxisId="r" dataKey="revenue" fill="#e07b5f" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
              )}
              {!hidden.visitors && (
                <Area
                  yAxisId="v"
                  type="monotone"
                  dataKey="visitors"
                  stroke="#7cb1ea"
                  strokeWidth={2.5}
                  fill="url(#vis)"
                  dot={false}
                  activeDot={{ r: 4, fill: '#7cb1ea', stroke: '#fff', strokeWidth: 2 }}
                  isAnimationActive={false}
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
