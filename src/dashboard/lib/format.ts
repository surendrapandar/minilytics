/**
 * Active locale for Intl formatting. The I18nProvider keeps this in sync with
 * the selected language via setFormatLocale(), so these helpers stay plain
 * functions (no hook, no prop drilling through 30+ call sites).
 */
let locale = 'en';
export function setFormatLocale(l: string) {
  locale = l;
}

// Words for the relative-time helpers, per language. English is the fallback.
const DURATION_UNITS: Record<string, { day: string }> = {
  en: { day: 'days' },
  es: { day: 'días' },
};
const AGO: Record<string, { seconds: string; minute: [string, string]; hour: [string, string]; day: [string, string]; month: [string, string] }> = {
  en: {
    seconds: 'a few seconds',
    minute: ['a minute', 'minutes'],
    hour: ['an hour', 'hours'],
    day: ['a day', 'days'],
    month: ['a month', 'months'],
  },
  es: {
    seconds: 'unos segundos',
    minute: ['un minuto', 'minutos'],
    hour: ['una hora', 'horas'],
    day: ['un día', 'días'],
    month: ['un mes', 'meses'],
  },
};

export function fmtNumber(n: number): string {
  if (n >= 10_000) return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n).toLowerCase();
  return new Intl.NumberFormat(locale).format(Math.round(n));
}

export function fmtMoney(minor: number, currency: string, decimals: number, compact = false): string {
  const v = minor / 10 ** decimals;
  try {
    return new Intl.NumberFormat(locale, {
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
  return `${Math.floor(h / 24)} ${(DURATION_UNITS[locale] ?? DURATION_UNITS.en).day}`;
}

export function fmtAgo(ms: number): string {
  const w = AGO[locale] ?? AGO.en;
  const s = Math.round(ms / 1000);
  if (s < 60) return w.seconds;
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? w.minute[0] : `${m} ${w.minute[1]}`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? w.hour[0] : `${h} ${w.hour[1]}`;
  const d = Math.round(h / 24);
  if (d < 30) return d === 1 ? w.day[0] : `${d} ${w.day[1]}`;
  const mo = Math.round(d / 30);
  return mo === 1 ? w.month[0] : `${mo} ${w.month[1]}`;
}

export function fmtDateTime(ts: number, tz: string): string {
  return new Intl.DateTimeFormat(locale, {
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

const WEEK_OF: Record<string, (d: string) => string> = {
  en: (d) => `Week of ${d}`,
  es: (d) => `Semana del ${d}`,
};

export function bucketLabel(bucket: string, g: string, long = false): string {
  if (g === 'hour') {
    const d = new Date(bucket + ':00Z');
    const time = d.toLocaleTimeString(locale, { hour: 'numeric', timeZone: 'UTC' });
    return long ? `${d.toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })}, ${time}` : time;
  }
  if (g === 'month') {
    return new Date(bucket + '-01T00:00:00Z').toLocaleDateString(locale, { month: 'short', year: long ? 'numeric' : '2-digit', timeZone: 'UTC' });
  }
  const d = new Date(bucket + 'T00:00:00Z');
  const s = d.toLocaleDateString(locale, { day: '2-digit', month: 'short', timeZone: 'UTC' });
  return g === 'week' && long ? (WEEK_OF[locale] ?? WEEK_OF.en)(s) : long ? d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : s;
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
