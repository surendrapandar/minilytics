/** Shared overview filters: one selection applies to every website card. */
export const TREND_METRICS = [
  { value: 'visitors', label: 'Visitors', color: '#679bd3' },
  { value: 'pageviews', label: 'Pageviews', color: '#e07b5f' },
  { value: 'sessions', label: 'Sessions', color: '#4b8a74' },
  { value: 'impressions', label: 'Search impressions', color: '#8b7bb8' },
  { value: 'revenue', label: 'Revenue', color: '#b07d3a' },
] as const;

export type TrendMetric = (typeof TREND_METRICS)[number]['value'];
/** Adjustable cap; the menu can show any four of the available metrics at once. */
export const MAX_TREND_METRICS = 4;
export const DEFAULT_TREND_METRICS: TrendMetric[] = ['visitors', 'pageviews', 'impressions', 'revenue'];

/** Never an empty selection, never more metrics than the cap. */
export function toggleTrendMetric(current: TrendMetric[], metric: TrendMetric): TrendMetric[] {
  if (current.includes(metric)) {
    return current.length > 1 ? current.filter((item) => item !== metric) : current;
  }
  if (current.length >= MAX_TREND_METRICS) return current;
  return [...current, metric];
}
