import { describe, expect, it } from 'vitest';
import { bucketLabels } from '../src/worker/lib/time';
import { isSiteTrendPeriod, siteTrendRange } from '../src/worker/siteTrends';

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

  it('rejects invalid or dangerous period inputs', () => {
    expect(isSiteTrendPeriod('7d')).toBe(true);
    expect(isSiteTrendPeriod('custom')).toBe(false);
    expect(isSiteTrendPeriod("7d'; DROP TABLE sessions; --")).toBe(false);
  });
});
