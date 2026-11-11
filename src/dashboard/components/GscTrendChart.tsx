import { useId, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { GscDaily } from './SearchPerformance';

type SeriesKey = 'clicks' | 'impressions';
const COLORS: Record<SeriesKey, string> = { clicks: '#477dc8', impressions: '#8dbdf0' };
const dateLabel = (value: string, granularity: 'day' | 'hour') => granularity === 'hour'
  ? new Date(value).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric',
  })
  : new Date(value + 'T12:00:00Z').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  });
const fmt = new Intl.NumberFormat('en-US');

/** Recharts renders a responsive SVG with shape-preserving monotone curves. */
export function GscTrendChart({ series, granularity = 'day' }: {
  series: GscDaily[]; granularity?: 'day' | 'hour';
}) {
  const id = useId().replace(/:/g, '-');
  const [visible, setVisible] = useState<Record<SeriesKey, boolean>>({ clicks: true, impressions: true });
  const hasActivity = series.some((day) => day.impressions > 0 || day.clicks > 0);

  function toggle(metric: SeriesKey) {
    setVisible((previous) => {
      // Always leave at least one series visible for a meaningful chart.
      if (previous[metric] && Object.values(previous).filter(Boolean).length === 1) return previous;
      return { ...previous, [metric]: !previous[metric] };
    });
  }

  return (
    <div className="mt-4 min-w-0 rounded-xl border border-stone-200/80 bg-white px-3 pb-3 pt-4 sm:px-5 sm:pb-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold sm:text-base">Performance over time</h3>
        <div className="flex flex-wrap items-center gap-2" aria-label="Visible search metrics">
          {(['clicks', 'impressions'] as const).map((metric) => (
            <button key={metric} type="button" aria-pressed={visible[metric]} onClick={() => toggle(metric)}
              className={'inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ' +
                (visible[metric] ? 'border-stone-200 bg-white text-stone-700' : 'border-stone-100 bg-stone-50 text-stone-400')}>
              <span className="h-2 w-2 rounded-full" style={{
                backgroundColor: COLORS[metric], opacity: visible[metric] ? 1 : 0.4,
              }} aria-hidden="true" />
              {metric === 'clicks' ? 'Clicks' : 'Impressions'}
            </button>
          ))}
        </div>
      </div>
      {hasActivity ? (
        <div className="mt-4 h-[230px] min-w-0 sm:h-[285px]" role="group"
          aria-label={`${granularity === 'hour' ? 'Hourly' : 'Daily'} Google Search clicks and impressions trend for the selected date range`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart accessibilityLayer data={series} margin={{ top: 8, right: 2, left: -8, bottom: 0 }}>
              <defs>
                <linearGradient id={id + '-impressions'} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.impressions} stopOpacity={0.24} />
                  <stop offset="100%" stopColor={COLORS.impressions} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="#eeece9" strokeDasharray="3 4" />
              <XAxis dataKey="date" tickFormatter={(value: string) => dateLabel(value, granularity)} minTickGap={28}
                axisLine={false} tickLine={false} tick={{ fill: '#a8a29e', fontSize: 11 }} />
              <YAxis yAxisId="clicks" hide={!visible.clicks} width={40} allowDecimals={false}
                tick={{ fill: '#a8a29e', fontSize: 11 }} axisLine={false} tickLine={false}
                tickFormatter={(value: number) => fmt.format(value)} />
              <YAxis yAxisId="impressions" hide={!visible.impressions} orientation="right" width={45}
                allowDecimals={false} tick={{ fill: '#a8a29e', fontSize: 11 }}
                axisLine={false} tickLine={false} tickFormatter={(value: number) => fmt.format(value)} />
              <Tooltip
                cursor={{ stroke: '#d6d3d1', strokeDasharray: '3 3' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const point = payload[0].payload as GscDaily;
                  return (
                    <div className="card min-w-[170px] px-3 py-2 text-xs shadow-card">
                      <div className="mb-2 font-medium">{dateLabel(point.date, granularity)}</div>
                      {visible.clicks && (
                        <div className="flex items-center justify-between gap-6 py-0.5">
                          <span className="text-stone-500">Clicks</span><span className="font-medium">{fmt.format(point.clicks)}</span>
                        </div>
                      )}
                      {visible.impressions && (
                        <div className="flex items-center justify-between gap-6 py-0.5">
                          <span className="text-stone-500">Impressions</span>
                          <span className="font-medium">{fmt.format(point.impressions)}</span>
                        </div>
                      )}
                    </div>
                  );
                }}
              />
              {visible.impressions && (
                <Area yAxisId="impressions" type="monotone" dataKey="impressions"
                  stroke={COLORS.impressions} strokeWidth={2.3}
                  fill={'url(#' + id + '-impressions)'} dot={false}
                  activeDot={{ r: 4, fill: COLORS.impressions, stroke: '#fff', strokeWidth: 2 }}
                  isAnimationActive={false} />
              )}
              {visible.clicks && (
                <Area yAxisId="clicks" type="monotone" dataKey="clicks" stroke={COLORS.clicks}
                  strokeWidth={2.3} fillOpacity={0} dot={false}
                  activeDot={{ r: 4, fill: COLORS.clicks, stroke: '#fff', strokeWidth: 2 }}
                  isAnimationActive={false} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="flex h-[230px] items-center justify-center text-sm text-stone-400 sm:h-[285px]">
          No search activity in this period.
        </div>
      )}
    </div>
  );
}
