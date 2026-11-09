import { describe, expect, it } from 'vitest';
import { bucketLabels } from '../src/worker/lib/time';
import { customTrendRange, impressionsByBucket, isSiteTrendPeriod, previousTrendRange, siteTrendRange } from '../src/worker/siteTrends';

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

  it('uses a rolling hourly window for the last 24 hours', () => {
    const range = siteTrendRange('24h', now);
    expect(range.granularity).toBe('hour');
    expect(range.from).toBe(now - 24 * 3_600_000);
    expect(range.to).toBe(now);
    expect(bucketLabels(range, 0)).toHaveLength(24);
    expect(bucketLabels(range, 0)[0]).toBe('2026-10-28T12:00');
    expect(bucketLabels(range, 0).at(-1)).toBe('2026-10-29T11:00');
  });

  it('supports one-day and arbitrary inclusive custom ranges', () => {
    const single = customTrendRange('2026-10-21', '2026-10-21', now)!;
    expect(single.granularity).toBe('hour');
    expect(bucketLabels(single, 0)).toHaveLength(24);
    const extended = customTrendRange('2026-10-15', '2026-10-22', now)!;
    expect(extended.granularity).toBe('day');
    expect(bucketLabels(extended, 0)).toHaveLength(8);
  });

  it('aligns previous period to the same elapsed time', () => {
    const range = siteTrendRange('24h', now);
    const prior = previousTrendRange(range, '24h');
    expect(prior.from).toBe(now - 48 * 3_600_000);
    expect(prior.to).toBe(now - 24 * 3_600_000);
    expect(bucketLabels(prior, 0)).toHaveLength(24);
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

describe('Search Console impressions in shared trends', () => {
  it('maps daily impressions onto matching UTC day buckets', () => {
    expect(impressionsByBucket(
      ['2026-11-03', '2026-11-04', '2026-11-05'],
      'day',
      [
        { date: '2026-11-03', impressions: 12 },
        { date: '2026-11-05', impressions: 30 },
      ],
    )).toEqual([12, 0, 30]);
  });

  it('sums daily impressions into calendar months', () => {
    expect(impressionsByBucket(
      ['2026-09', '2026-10', '2026-11'],
      'month',
      [
        { date: '2026-09-30', impressions: 4 },
        { date: '2026-10-01', impressions: 6 },
        { date: '2026-10-31', impressions: 8 },
        { date: '2026-11-01', impressions: 9 },
      ],
    )).toEqual([4, 14, 9]);
  });

  it('leaves hourly buckets empty because Search Console reports whole days', () => {
    expect(impressionsByBucket(['2026-11-05T10:00'], 'hour', [
      { date: '2026-11-05', impressions: 30 },
    ])).toEqual([0]);
  });
});
