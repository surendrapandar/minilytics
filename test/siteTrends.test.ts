import { describe, expect, it } from 'vitest';
import { bucketLabels } from '../src/worker/lib/time';
import { customTrendRange, isSiteTrendPeriod, previousTrendRange, siteTrendRange } from '../src/worker/siteTrends';

describe('site overview trends', () => {
  const now = Date.UTC(2026, 9, 29, 12);

  it('defaults to seven daily buckets', () => {
    const range = siteTrendRange('7d', now);
    expect(bucketLabels(range, 0)).toEqual([
      '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26',
      '2026-10-27', '2026-10-28', '2026-10-29',
    ]);
  });

  it('uses daily buckets for 30 and 90 days', () => {
    for (const [period, length] of [['30d', 30], ['90d', 90]] as const) {
      const range = siteTrendRange(period, now);
      expect(range.granularity).toBe('day');
      expect(bucketLabels(range, 0)).toHaveLength(length);
    }
  });

  it('includes twelve calendar months for 12m', () => {
    const range = siteTrendRange('12m', now);
    expect(bucketLabels(range, 0)).toEqual([
      '2025-11', '2025-12', '2026-01', '2026-02',
      '2026-03', '2026-04', '2026-05', '2026-06',
      '2026-07', '2026-08', '2026-09', '2026-10',
    ]);
  });

  it('uses exclusive end boundaries for exact-hour queries', () => {
    const today = siteTrendRange('today', now);
    const yesterday = siteTrendRange('yesterday', now);
    expect(today.granularity).toBe('hour');
    expect(today.from).toBe(Date.UTC(2026, 9, 29));
    expect(today.to).toBe(now);
    // At exactly 12:00 the range [00:00, 12:00) contains 12 hours.
    expect(bucketLabels(today, 0)).toHaveLength(12);
    expect(bucketLabels(today, 0)[0]).toBe('2026-10-29T00:00');
    expect(bucketLabels(today, 0).at(-1)).toBe('2026-10-29T11:00');
    expect(bucketLabels(yesterday, 0)).toHaveLength(24);
    expect(bucketLabels(yesterday, 0)[0]).toBe('2026-10-28T00:00');
    expect(bucketLabels(yesterday, 0).at(-1)).toBe('2026-10-28T23:00');
  });

  it('includes the current partial hour after the hour begins', () => {
    const at = now + 15 * 60_000;
    const today = siteTrendRange('today', at);
    expect(bucketLabels(today, 0)).toHaveLength(13);
    expect(bucketLabels(today, 0).at(-1)).toBe('2026-10-29T12:00');
    const prior = previousTrendRange(today, 'today');
    expect(prior.from).toBe(Date.UTC(2026, 9, 28));
    expect(prior.to).toBe(Date.UTC(2026, 9, 28, 12, 15));
    expect(bucketLabels(prior, 0)).toHaveLength(13);
    expect(bucketLabels(prior, 0).at(-1)).toBe('2026-10-28T12:00');
  });

  it('has no elapsed today hour exactly at UTC midnight', () => {
    const midnight = Date.UTC(2026, 9, 29);
    const today = siteTrendRange('today', midnight);
    expect(bucketLabels(today, 0)).toHaveLength(0);
    expect(bucketLabels(siteTrendRange('yesterday', midnight), 0)).toHaveLength(24);
  });

  it('supports one-day and arbitrary inclusive custom ranges', () => {
    const single = customTrendRange('2026-10-21', '2026-10-21', now)!;
    expect(single.granularity).toBe('hour');
    expect(bucketLabels(single, 0)).toHaveLength(24);
    const extended = customTrendRange('2026-10-15', '2026-10-22', now)!;
    expect(extended.granularity).toBe('day');
    expect(bucketLabels(extended, 0)).toHaveLength(8);
  });

  it('aligns previous period to the same elapsed hours', () => {
    const today = siteTrendRange('today', now);
    const prior = previousTrendRange(today, 'today');
    expect(prior.from).toBe(Date.UTC(2026, 9, 28));
    expect(prior.to).toBe(Date.UTC(2026, 9, 28, 12));
    expect(bucketLabels(prior, 0)).toHaveLength(12);
    expect(bucketLabels(prior, 0)[0]).toBe('2026-10-28T00:00');
    expect(bucketLabels(prior, 0).at(-1)).toBe('2026-10-28T11:00');
    const older = previousTrendRange(siteTrendRange('7d', now), '7d');
    expect(bucketLabels(older, 0)).toHaveLength(7);
    const yearAgo = previousTrendRange(siteTrendRange('12m', now), '12m');
    expect(bucketLabels(yearAgo, 0)).toHaveLength(12);
    expect(bucketLabels(yearAgo, 0)[0]).toBe('2024-11');
  });

  it('rejects invalid, future, inverted and overlong date windows', () => {
    expect(customTrendRange('2026-02-30', '2026-03-01', now)).toBeNull();
    expect(customTrendRange('2026-10-30', '2026-10-30', now)).toBeNull();
    expect(customTrendRange('2026-10-25', '2026-10-24', now)).toBeNull();
    expect(customTrendRange('2025-01-01', '2026-10-01', now)).toBeNull();
    expect(customTrendRange('2026-10-29', '2026-10-29', now)?.granularity).toBe('hour');
  });

  it('rejects invalid or dangerous period inputs', () => {
    expect(isSiteTrendPeriod('7d')).toBe(true);
    expect(isSiteTrendPeriod('custom')).toBe(true);
    expect(isSiteTrendPeriod('nonsense')).toBe(false);
    expect(isSiteTrendPeriod("7d'; DROP TABLE sessions; --")).toBe(false);
  });
});
