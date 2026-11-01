import { describe, expect, it } from 'vitest';
import { validGscDates, validGscProperty } from '../src/worker/gsc';

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
