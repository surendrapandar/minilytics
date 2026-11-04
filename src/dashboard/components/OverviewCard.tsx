import { usePref } from '../lib/prefs';
import type { Kpis, Overview } from '../lib/api';
import { useDash } from '../lib/context';
import { bucketLabel, fmtDuration, fmtNumber, fmtPct } from '../lib/format';
import { TrafficChart } from './TrafficChart';

type Metric = 'visitors' | 'revenue';

function Change({ cur, prev, invert = false }: { cur: number; prev: number; invert?: boolean }) {
  if (!prev) return <span className="font-mono text-[11px] text-stone-400">—</span>;
  const pct = (cur - prev) / prev;
  if (!Number.isFinite(pct)) return null;
  const up = pct >= 0;
  const good = invert ? !up : up;
  return (
    <span className={`inline-flex items-center gap-0.5 font-mono text-[11px] ${good ? 'text-emerald-600' : 'text-red-500'}`}>
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
            <div className="eyebrow flex items-center gap-1.5">
              {k.dot && <span className={`h-2 w-2 ${k.dot} ${hidden[k.metric!] ? 'opacity-25' : ''}`} />}
              {k.label}
            </div>
            <div className="mt-1.5 text-[28px] font-semibold leading-tight tracking-tight">{k.value}</div>
            <Change cur={c![k.key as keyof Kpis]} prev={p![k.key as keyof Kpis]} invert={k.invert} />
          </button>
        ))}
        {data && (
          <button className="px-5 py-4 text-left hover:bg-stone-50" onClick={onLive} title="Open the live map (M)">
            <div className="eyebrow flex items-center gap-1.5">
              Online <span className="h-2 w-2 animate-pulse bg-green-500" />
            </div>
            <div className="mt-1.5 text-[28px] font-semibold leading-tight">{data.online}</div>
            <div className="font-mono text-[11px] text-stone-400">View on globe →</div>
          </button>
        )}
        {!data && <div className="col-span-full h-[98px] animate-pulse bg-stone-50" />}
      </div>

      <div className="h-[340px] px-3 pb-3 pt-6 sm:px-5">
        {data && (
          <TrafficChart
            data={data.series}
            label={(d) => bucketLabel(d.bucket, g)}
            longLabel={(d) => bucketLabel(d.bucket, g, true)}
            money={money}
            showVisitors={!hidden.visitors}
            showRevenue={!hidden.revenue}
            height={310}
          />
        )}
      </div>
    </div>
  );
}

