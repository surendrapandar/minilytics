const DAY = 86_400_000;
const HOUR = 3_600_000;

/** Offset of `tz` from UTC in ms at `at` (positive east of UTC). */
export function tzOffset(tz: string, at: number = Date.now()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(at));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return Math.round((asUTC - Math.floor(at / 1000) * 1000) / 60_000) * 60_000;
  } catch {
    return 0;
  }
}

/** Midnight (site time) of the day containing `at`, as a UTC timestamp. */
export function startOfDay(at: number, tz: string): number {
  const off = tzOffset(tz, at);
  return Math.floor((at + off) / DAY) * DAY - off;
}

/** Parse YYYY-MM-DD as midnight in the site's timezone. */
function parseDay(s: string, tz: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return utc - tzOffset(tz, utc);
}

export type Granularity = 'hour' | 'day' | 'week' | 'month';

/**
 * Keep the chart useful by only offering bucket sizes that make sense for the
 * selected time span. This is shared by the API's validation; the dashboard
 * mirrors the same thresholds when rendering its picker.
 */
export function granularitiesForSpan(span: number): Granularity[] {
  if (span <= 2 * DAY + HOUR) return ['hour'];
  if (span <= 7 * DAY + HOUR) return ['hour', 'day'];
  if (span <= 31 * DAY + HOUR) return ['day', 'week'];
  if (span <= 120 * DAY + HOUR) return ['day', 'week', 'month'];
  if (span <= 400 * DAY + HOUR) return ['week', 'month'];
  return ['month'];
}

export interface Range {
  from: number;
  to: number;
  granularity: Granularity;
}

export const PERIODS = ['today', 'yesterday', '24h', '48h', '7d', '30d', '90d', '12m', 'all', 'custom'] as const;
export type Period = (typeof PERIODS)[number];

export function resolveRange(
  q: { period?: string; from?: string; to?: string; granularity?: string },
  tz: string,
  siteCreatedAt: number,
  now = Date.now(),
): Range {
  const today = startOfDay(now, tz);
  let from: number;
  let to = now;
  switch (q.period as Period) {
    case 'today':
      from = today;
      break;
    case 'yesterday':
      from = startOfDay(today - 1, tz);
      to = today;
      break;
    case '24h':
      from = now - 24 * HOUR;
      break;
    case '48h':
      from = now - 48 * HOUR;
      break;
    case '7d':
      from = startOfDay(today - 6 * DAY + HOUR, tz);
      break;
    case '90d':
      from = startOfDay(today - 89 * DAY + HOUR, tz);
      break;
    case '12m':
      from = startOfDay(today - 364 * DAY + HOUR, tz);
      break;
    case 'all':
      from = startOfDay(siteCreatedAt, tz);
      break;
    case 'custom': {
      const f = q.from ? parseDay(q.from, tz) : null;
      const t = q.to ? parseDay(q.to, tz) : null;
      from = f ?? today;
      // `to` is inclusive of the whole day.
      to = Math.min(t !== null ? startOfDay(t + DAY + HOUR, tz) : now, now);
      if (to <= from) to = from + DAY;
      break;
    }
    case '30d':
    default:
      from = startOfDay(today - 29 * DAY + HOUR, tz);
  }
  const span = to - from;
  const auto: Granularity = span <= 2 * DAY + HOUR ? 'hour' : span <= 120 * DAY ? 'day' : span <= 400 * DAY ? 'week' : 'month';
  const g = (['hour', 'day', 'week', 'month'] as const).includes(q.granularity as Granularity)
    ? (q.granularity as Granularity)
    : auto;
  const granularity = granularitiesForSpan(span).includes(g) ? g : auto;
  return { from, to, granularity };
}

/** SQLite expression that turns a ms timestamp column into a bucket label in site time. */
export function bucketSql(col: string, g: Granularity, offsetMs: number): string {
  const t = `((${col} + ${Math.trunc(offsetMs)}) / 1000)`;
  switch (g) {
    case 'hour':
      return `strftime('%Y-%m-%dT%H:00', ${t}, 'unixepoch')`;
    case 'day':
      return `strftime('%Y-%m-%d', ${t}, 'unixepoch')`;
    case 'week':
      return `date(${t}, 'unixepoch', 'weekday 0', '-6 days')`;
    case 'month':
      return `strftime('%Y-%m', ${t}, 'unixepoch')`;
  }
}

/** Every bucket label in the range, so the chart has no gaps. Mirrors bucketSql. */
export function bucketLabels(range: Range, offsetMs: number): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  const step = range.granularity === 'hour' ? HOUR : DAY;
  for (let t = range.from; t < range.to; t += step) {
    const d = new Date(t + offsetMs);
    let label: string;
    const iso = d.toISOString();
    if (range.granularity === 'hour') label = iso.slice(0, 13) + ':00';
    else if (range.granularity === 'day') label = iso.slice(0, 10);
    else if (range.granularity === 'month') label = iso.slice(0, 7);
    else {
      // Monday of this week (matches SQLite 'weekday 0', '-6 days', i.e. next Sunday minus 6).
      const dow = d.getUTCDay();
      const daysToSunday = (7 - dow) % 7;
      label = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + daysToSunday - 6)).toISOString().slice(0, 10);
    }
    if (!seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }
  return labels;
}
