import { describe, expect, it } from 'vitest';
import { DEFAULT_TREND_METRICS, MAX_TREND_METRICS, toggleTrendMetric } from '../src/dashboard/lib/trendMetrics';

describe('shared website trend metrics', () => {
  it('defaults to the two globally selected series', () => {
    expect(DEFAULT_TREND_METRICS).toEqual(['visitors', 'pageviews']);
    expect(MAX_TREND_METRICS).toBe(2);
  });

  it('rejects a third checked metric without dropping another', () => {
    expect(toggleTrendMetric(['visitors', 'pageviews'], 'sessions')).toEqual(['visitors', 'pageviews']);
  });

  it('allows replacing a metric after unchecking one', () => {
    const one = toggleTrendMetric(['visitors', 'pageviews'], 'visitors');
    expect(one).toEqual(['pageviews']);
    expect(toggleTrendMetric(one, 'sessions')).toEqual(['pageviews', 'sessions']);
  });

  it('keeps at least one selected metric', () => {
    expect(toggleTrendMetric(['sessions'], 'sessions')).toEqual(['sessions']);
  });
});
