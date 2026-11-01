import { describe, expect, it } from 'vitest';
import { gscDailySeries, previousGscWindow, validGscDates, validGscProperty } from '../src/worker/gsc';

describe('Google Search Console service account input validation', () => {
  it('accepts exact domain and URL-prefix property formats', () => {
    expect(validGscProperty('sc-domain:example.com')).toBe(true);
    expect(validGscProperty('https://www.example.com/')).toBe(true);
    expect(validGscProperty('https://example.com/blog/')).toBe(true);
  });

  it('rejects invalid property formats', () => {
    expect(validGscProperty('example.com')).toBe(false);
    expect(validGscProperty('sc-domain:localhost')).toBe(false);
    expect(validGscProperty('file:///etc/passwd')).toBe(false);
    expect(validGscProperty('https://name:password@example.com/')).toBe(false);
  });

  it('enforces calendar-valid date windows, up to 366 inclusive days', () => {
    const today = '2026-11-01';
    expect(validGscDates('2026-10-01', '2026-10-28', today)).toBe(true);
    expect(validGscDates('2026-10-01', '2026-10-01', today)).toBe(true);
    expect(validGscDates('2025-10-31', '2026-10-31', today)).toBe(true);
    expect(validGscDates('2025-01-01', '2026-10-01', today)).toBe(false);
    expect(validGscDates('2026-10-30', '2026-10-29', today)).toBe(false);
    expect(validGscDates('2026-11-01', '2026-11-01', today)).toBe(false);
    expect(validGscDates('2026-02-30', '2026-03-01', today)).toBe(false);
  });
});

describe('Google Search Console date aggregation', () => {
  it('compares with the immediately preceding equal-length inclusive window', () => {
    expect(previousGscWindow('2026-10-02', '2026-10-29'))
      .toEqual({ from: '2026-09-04', to: '2026-10-01' });
    expect(previousGscWindow('2026-03-01', '2026-03-01'))
      .toEqual({ from: '2026-02-28', to: '2026-02-28' });
    expect(previousGscWindow('2024-03-01', '2024-03-02'))
      .toEqual({ from: '2024-02-28', to: '2024-02-29' });
  });

  it('inserts explicit zero-activity dates while preserving actual Google metrics', () => {
    expect(gscDailySeries('2026-10-02', '2026-10-04', [
      { keys: ['2026-10-04'], clicks: 2, impressions: 10, ctr: 0.2, position: 7.5 },
      { keys: ['2026-10-02'], clicks: 0, impressions: 5, ctr: 0, position: 12 },
    ])).toEqual([
      { date: '2026-10-02', clicks: 0, impressions: 5, ctr: 0, position: 12 },
      { date: '2026-10-03', clicks: 0, impressions: 0, ctr: 0, position: 0 },
      { date: '2026-10-04', clicks: 2, impressions: 10, ctr: 0.2, position: 7.5 },
    ]);
  });
});
