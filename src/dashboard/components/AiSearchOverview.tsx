import { qs, type AiSourceSeries, type BreakdownRow, type Overview } from '../lib/api';
import { useDash } from '../lib/context';
import { bucketLabel, fmtNumber, fmtPct } from '../lib/format';
import { useApi } from '../lib/useApi';
import { SourceIcon } from './Icons';
import { Area, Bar, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const SOURCE_COLORS = ['#7c3aed', '#2563eb', '#059669', '#ea580c', '#db2777', '#78716c'];

export function AiSearchOverview() {
  const { site, q, reloadKey, money } = useDash();
  const filters: Record<string, string> = { ...q.filters, channel: 'AI' };
  delete filters.source;
  const aiQuery = { ...q, filters };
  const { data: overview, error: overviewError } = useApi<Overview>(`/api/sites/${site.id}/overview?${qs(aiQuery)}`, reloadKey);
  const { data: sources, error: sourcesError } = useApi<BreakdownRow[]>(
    `/api/sites/${site.id}/breakdown?${qs(aiQuery, { dim: 'source', limit: 5 })}`,
    reloadKey,
  );
  const { data: trends, error: trendsError } = useApi<AiSourceSeries>(`/api/sites/${site.id}/ai-sources?${qs(q)}`, reloadKey);

  return (
    <section className="card p-5">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">AI search overview</h2>
        <p className="text-sm text-stone-500">Compare visitors referred by AI assistants over time</p>
      </div>

      {(overviewError || sourcesError || trendsError) && <p className="mb-3 text-sm text-red-600">{overviewError ?? sourcesError ?? trendsError}</p>}

      {overview && (
        <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Metric label="Visitors" value={fmtNumber(overview.current.visitors)} />
          <Metric label="Revenue" value={money(overview.current.revenue, true)} />
          <Metric label="Conversion rate" value={fmtPct(overview.current.conversionRate, 1)} />
        </div>
      )}

      {trends && (
        <div className="mb-6">
          <h3 className="mb-2 text-sm font-medium text-stone-600">AI visitors and revenue</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trends.series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="ai-visitors" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8dbdf0" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#8dbdf0" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#efedea" strokeDasharray="4 4" />
                <XAxis dataKey="bucket" tickFormatter={(value) => bucketLabel(value, trends.granularity)} tick={{ fill: '#a8a29e', fontSize: 12 }} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis yAxisId="visitors" tick={{ fill: '#a8a29e', fontSize: 12 }} axisLine={false} tickLine={false} width={44} allowDecimals={false} tickFormatter={fmtNumber} />
                <YAxis yAxisId="revenue" orientation="right" tick={{ fill: '#a8a29e', fontSize: 12 }} axisLine={false} tickLine={false} width={56} tickFormatter={(value) => money(value, true)} domain={[0, (max: number) => Math.max(1, Math.ceil(max * 1.6))]} />
                <Tooltip
                  labelFormatter={(value) => bucketLabel(String(value), trends.granularity, true)}
                  formatter={(value, name) => [name === 'Revenue' ? money(Number(value)) : fmtNumber(Number(value)), String(name)]}
                  contentStyle={{ borderRadius: 12, borderColor: '#e7e5e4', fontSize: 13 }}
                />
                <Bar yAxisId="revenue" dataKey="revenue" name="Revenue" fill="#e07b5f" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
                <Area yAxisId="visitors" type="monotone" dataKey="visitors" name="Visitors" stroke="#7cb1ea" strokeWidth={2.5} fill="url(#ai-visitors)" dot={false} activeDot={{ r: 4, fill: '#7cb1ea', stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex gap-4 text-xs text-stone-600">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-revenue" />Revenue</span>
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 bg-[#7cb1ea]" />Visitors</span>
          </div>
        </div>
      )}

      {trends && trends.sources.length > 0 && (
        <div className="mb-3">
          <h3 className="mb-2 text-sm font-medium text-stone-600">Visitors by AI source</h3>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trends.series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#efedea" strokeDasharray="4 4" />
                <XAxis dataKey="bucket" tickFormatter={(value) => bucketLabel(value, trends.granularity)} tick={{ fill: '#a8a29e', fontSize: 12 }} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis tick={{ fill: '#a8a29e', fontSize: 12 }} axisLine={false} tickLine={false} width={44} allowDecimals={false} />
                <Tooltip
                  labelFormatter={(value) => bucketLabel(String(value), trends.granularity, true)}
                  formatter={(value, name) => [fmtNumber(Number(value)), String(name)]}
                  contentStyle={{ borderRadius: 12, borderColor: '#e7e5e4', fontSize: 13 }}
                />
                {trends.sources.map((source, index) => (
                  <Line key={source} type="monotone" dataKey={source} name={source} stroke={SOURCE_COLORS[index % SOURCE_COLORS.length]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {trends && trends.sources.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-x-4 gap-y-2">
          {trends.sources.map((source, index) => (
            <span key={source} className="flex items-center gap-1.5 text-xs text-stone-600">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SOURCE_COLORS[index % SOURCE_COLORS.length] }} />
              {source}
            </span>
          ))}
        </div>
      )}

      {sources && sources.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-stone-600">AI source performance</h3>
          <div className="divide-y divide-stone-100">
            {sources.map((source, index) => (
              <div key={`${source.label}-${index}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <SourceIcon source={source.label} domain={source.extra} />
                  <span className="truncate">{source.label ?? 'Unknown'}</span>
                </span>
                <span className="flex shrink-0 items-center gap-4 text-stone-500">
                  <span>{fmtNumber(source.visitors)} visitors</span>
                  <span className="font-medium text-ink">{money(source.revenue, true)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {overview && sources && !sources.length && <p className="text-sm text-stone-400">No AI-referred visits for this period.</p>}
      {!overview && !overviewError && <div className="h-16 animate-pulse rounded-lg bg-stone-50" />}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-sm text-stone-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}
