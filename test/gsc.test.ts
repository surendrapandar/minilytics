import { describe, expect, it } from 'vitest';
import { gscDailySeries, previousGscWindow, resolveGscWindow, trendGscWindow, validGscDates, validGscProperty } from '../src/worker/gsc';

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

describe('GSC periods follow the shared dashboard selector', () => {
  // November 1 2026 includes a Pacific DST transition; the date ranges stay calendar based.
  const now = Date.parse('2026-11-01T20:00:00Z');
  const created = Date.parse('2024-01-01T12:00:00Z');

  it('uses the same last-seven-days preset, excluding only the incomplete PT date', () => {
    expect(resolveGscWindow({ period: '7d' }, created, now)).toEqual({
      from: '2026-10-26', to: '2026-10-31',
      requestedFrom: '2026-10-26', requestedTo: '2026-11-01',
      available: true, truncated: false,
    });
  });

  it('retains custom dates exactly and does not apply a separate date selection', () => {
    expect(resolveGscWindow({
      period: 'custom', from: '2026-10-02', to: '2026-10-29',
    }, created, now)).toEqual({
      from: '2026-10-02', to: '2026-10-29',
      requestedFrom: '2026-10-02', requestedTo: '2026-10-29',
      available: true, truncated: false,
    });
  });

  it('does not silently substitute earlier results for Today', () => {
    const range = resolveGscWindow({ period: 'today' }, created, now);
    expect(range.available).toBe(false);
    expect(range.requestedFrom).toBe('2026-11-01');
    expect(range.to).toBe('2026-10-31');
  });

  it('maps hourly periods to overlapping daily Pacific dates', () => {
    const range = resolveGscWindow({ period: '24h' }, created, now);
    expect(range.from).toBe('2026-10-31');
    expect(range.to).toBe('2026-10-31');
    expect(range.available).toBe(true);
  });

  it('caps a long shared custom period instead of rejecting the dashboard selection', () => {
    const range = resolveGscWindow({
      period: 'custom', from: '2024-01-10', to: '2026-10-29',
    }, created, now);
    expect(range.from).toBe('2025-10-29');
    expect(range.to).toBe('2026-10-29');
    expect(range.truncated).toBe(true);
  });

  it('caps All time to the existing 366-day API limit and labels the truncation', () => {
    const range = resolveGscWindow({ period: 'all' }, created, now);
    expect(range.from).toBe('2025-10-31');
    expect(range.to).toBe('2026-10-31');
    expect(range.truncated).toBe(true);
  });
});

describe('shared trend impressions window', () => {
  // 12:00 UTC is 05:00 Pacific on the same date.
  const now = Date.parse('2026-11-06T12:00:00Z');

  it('requests whole days through yesterday in Pacific Time', () => {
    expect(trendGscWindow(Date.UTC(2026, 10, 1), Date.UTC(2026, 10, 6), now))
      .toEqual({ from: '2026-11-01', to: '2026-11-05', available: true, truncated: false });
  });

  it('reports no data for windows that only cover the current Pacific day', () => {
    const today = trendGscWindow(Date.UTC(2026, 10, 6), Date.UTC(2026, 10, 6, 8), now);
    expect(today.available).toBe(false);
    expect(today.to).toBe('2026-11-05');
  });

  it('uses the Pacific calendar around UTC midnight', () => {
    // 06:00 UTC on Nov 6 is still Nov 5 in Pacific Time.
    const window = trendGscWindow(
      Date.UTC(2026, 9, 30), Date.UTC(2026, 10, 6),
      Date.parse('2026-11-06T06:00:00Z'),
    );
    expect(window.to).toBe('2026-11-04');
  });

  it('caps requests at the 365-day Search Console history', () => {
    const window = trendGscWindow(Date.UTC(2024, 0, 1), Date.UTC(2026, 10, 6), now);
    expect(window.from).toBe('2025-11-05');
    expect(window.truncated).toBe(true);
    expect(window.available).toBe(true);
  });
});
