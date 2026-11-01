/** Shared overview filters: one selection applies to every website card. */
export const TREND_METRICS = [
  { value: 'visitors', label: 'Visitors', color: '#679bd3' },
  { value: 'pageviews', label: 'Pageviews', color: '#e07b5f' },
  { value: 'sessions', label: 'Sessions', color: '#4b8a74' },
] as const;

export type TrendMetric = (typeof TREND_METRICS)[number]['value'];
export const MAX_TREND_METRICS = 2;
export const DEFAULT_TREND_METRICS: TrendMetric[] = ['visitors', 'pageviews'];

/** Allow one or two metrics; never an empty selection or a third metric. */
export function toggleTrendMetric(current: TrendMetric[], metric: TrendMetric): TrendMetric[] {
  if (current.includes(metric)) {
    return current.length > 1 ? current.filter((item) => item !== metric) : current;
  }
  if (current.length >= MAX_TREND_METRICS) return current;
  return [...current, metric];
}
