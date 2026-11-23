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
    <div className="card overflow-hidden border border-zinc-200/80 shadow-sm">
      <div className="grid grid-cols-2 divide-y divide-zinc-100 border-b border-zinc-100 sm:grid-cols-4 sm:divide-y-0 lg:grid-cols-7 lg:divide-x lg:divide-zinc-100">
        {kpis.map((k) => (
          <button
            key={k.key}
            className={`p-4 text-left transition-colors ${k.metric ? 'hover:bg-zinc-50/80' : 'cursor-default'}`}
            onClick={() => k.metric && setHidden((h) => ({ ...h, [k.metric!]: !h[k.metric!] }))}
            title={k.metric ? 'Show/hide on chart' : undefined}
          >
            <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
              {k.dot && <span className={`h-2 w-2 rounded-full ${k.dot} ${hidden[k.metric!] ? 'opacity-25' : ''}`} />}
              {k.label}
            </div>
            <div className="mt-1 text-2xl font-bold tracking-tight text-zinc-900">{k.value}</div>
            <div className="mt-0.5">
              <Change cur={c![k.key as keyof Kpis]} prev={p![k.key as keyof Kpis]} invert={k.invert} />
            </div>
          </button>
        ))}
        {data && (
          <button className="p-4 text-left transition-colors hover:bg-zinc-50/80" onClick={onLive} title="Open the live map (M)">
            <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
              Online <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            </div>
            <div className="mt-1 text-2xl font-bold tracking-tight text-zinc-900">{data.online}</div>
            <div className="mt-0.5 text-xs font-medium text-indigo-600">View map →</div>
          </button>
        )}
        {!data && <div className="col-span-full h-[98px] animate-pulse bg-zinc-50" />}
      </div>

      <div className="h-[340px] px-2 pb-3 pt-6 sm:px-4">
        {data && (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data.series} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="vis" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="#f1f5f9" strokeDasharray="3 3" />
              <XAxis
                dataKey="bucket"
                tickFormatter={(b) => bucketLabel(b, g)}
                tick={{ fill: '#71717a', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                minTickGap={28}
              />
              <YAxis
                yAxisId="v"
                tick={{ fill: '#71717a', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={40}
                allowDecimals={false}
                tickFormatter={(v) => fmtNumber(v)}
              />
              <YAxis
                yAxisId="r"
                orientation="right"
                tick={{ fill: '#71717a', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={50}
                tickFormatter={(v) => money(v, true)}
                hide={hidden.revenue}
                // Headroom keeps revenue bars in the lower part of the chart, under the visitors line.
                domain={[0, (max: number) => Math.max(1, Math.ceil(max * 1.6))]}
              />
              <Tooltip
                cursor={{ fill: 'rgba(99, 102, 241, 0.04)' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as Overview['series'][0];
                  return (
                    <div className="card min-w-[180px] border border-zinc-200 bg-white/95 px-3.5 py-2.5 text-xs shadow-lg backdrop-blur">
                      <div className="mb-2 font-semibold text-zinc-900">{bucketLabel(d.bucket, g, true)}</div>
                      <Row color="bg-indigo-500" label="Visitors" value={fmtNumber(d.visitors)} />
                      <Row color="bg-zinc-300" label="Pageviews" value={fmtNumber(d.pageviews)} />
                      <Row color="bg-emerald-500" label="Revenue" value={money(d.revenue)} />
                      {d.payments > 0 && <Row color="bg-emerald-200" label="Payments" value={String(d.payments)} />}
                    </div>
                  );
                }}
              />
              {!hidden.revenue && (
                <Bar yAxisId="r" dataKey="revenue" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={32} isAnimationActive={false} />
              )}
              {!hidden.visitors && (
                <Area
                  yAxisId="v"
                  type="monotone"
                  dataKey="visitors"
                  stroke="#6366f1"
                  strokeWidth={2}
                  fill="url(#vis)"
                  dot={false}
                  activeDot={{ r: 4, fill: '#6366f1', stroke: '#fff', strokeWidth: 2 }}
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
