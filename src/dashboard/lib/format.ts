import { currencyDecimals } from '../../shared/currency';
export function fmtNumber(n: number): string {
  if (n >= 10_000) return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n).toLowerCase();
  return new Intl.NumberFormat('en').format(Math.round(n));
}

export function fmtMoney(minor: number, currency: string, decimals: number, compact = false): string {
  const v = minor / 10 ** decimals;
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
      notation: compact && Math.abs(v) >= 10_000 ? 'compact' : 'standard',
      maximumFractionDigits: compact || Math.abs(v) >= 1000 ? 0 : Math.abs(v) < 10 && v !== 0 ? 2 : 0,
      minimumFractionDigits: 0,
    }).format(v);
  } catch {
    return `${v.toFixed(decimals)} ${currency}`;
  }
}

/** What the buyer actually paid, when it was in another currency than the site's (e.g. "€4.56"). */
export function fmtPaidIn(p: { original_amount?: number | null; original_currency?: string | null }): string | null {
  if (p.original_amount == null || !p.original_currency) return null;
  return fmtMoney(Math.abs(p.original_amount), p.original_currency, currencyDecimals(p.original_currency));
}

export function fmtPct(n: number, digits = 0): string {
  const v = n * 100;
  return `${v < 1 && v > 0 && digits === 0 ? v.toFixed(2) : v.toFixed(digits)}%`;
}

export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)} days`;
}

export function fmtAgo(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return 'a few seconds';
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? 'a minute' : `${m} minutes`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? 'an hour' : `${h} hours`;
  const d = Math.round(h / 24);
  if (d < 30) return d === 1 ? 'a day' : `${d} days`;
  const mo = Math.round(d / 30);
  return mo === 1 ? 'a month' : `${mo} months`;
}

export function fmtDateTime(ts: number, tz: string): string {
  return new Intl.DateTimeFormat('en', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(ts);
}

/** YYYY-MM-DD of a timestamp in the site's timezone. */
export function dayInTz(ts: number, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ts);
}

export function bucketLabel(bucket: string, g: string, long = false): string {
  if (g === 'hour') {
    const d = new Date(bucket + ':00Z');
    const time = d.toLocaleTimeString('en', { hour: 'numeric', timeZone: 'UTC' });
    return long ? `${d.toLocaleDateString('en', { day: 'numeric', month: 'short', timeZone: 'UTC' })}, ${time}` : time;
  }
  if (g === 'month') {
    return new Date(bucket + '-01T00:00:00Z').toLocaleDateString('en', { month: 'short', year: long ? 'numeric' : '2-digit', timeZone: 'UTC' });
  }
  const d = new Date(bucket + 'T00:00:00Z');
  const s = d.toLocaleDateString('en', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  return g === 'week' && long ? `Week of ${s}` : long ? d.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : s;
}

export function flag(cc: string | null | undefined): string {
  if (!cc || cc.length !== 2 || cc === 'XX' || cc === 'T1') return '🌐';
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();

export function countryName(cc: string | null | undefined): string {
  if (!cc) return 'Unknown';
  try {
    return regionNames?.of(cc) ?? cc;
  } catch {
    return cc;
  }
}

export function shortId(id: string) {
  return id.replace(/-/g, '').slice(0, 6);
}
