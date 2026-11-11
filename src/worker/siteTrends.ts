import type { Context } from 'hono';
import { siteAccessSql } from './auth';
import type { AppEnv } from './env';
import { gscDailyImpressions, gscHourlyImpressions, googleToken, trendGscHourlyWindow, trendGscWindow } from './gsc';
import { bucketLabels, bucketSql, resolveRange, type Granularity, type Range } from './lib/time';

export const TREND_METRICS = ['visitors', 'pageviews', 'sessions', 'impressions'] as const;
export type SiteTrendMetric = (typeof TREND_METRICS)[number];

export const SITE_TREND_PERIODS = ['24h', '7d', '30d', '90d', '12m', 'custom'] as const;
export type SiteTrendPeriod = (typeof SITE_TREND_PERIODS)[number];
type ActivePeriod = Exclude<SiteTrendPeriod, 'custom'>;
const DAY = 86_400_000;
const MAX_CUSTOM_DAYS = 366;

export function isSiteTrendPeriod(value: string): value is SiteTrendPeriod {
  return SITE_TREND_PERIODS.some((period) => period === value);
}

/** All overview cards use UTC buckets to keep different sites comparable. */
export function siteTrendRange(period: ActivePeriod, now = Date.now()): Range {
  const range = resolveRange(
    { period, granularity: period === '12m' ? 'month' : period === '24h' ? 'hour' : 'day' },
    'UTC',
    now - 365 * DAY,
    now,
  );
  if (period === '12m') {
    const date = new Date(now);
    range.from = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 11, 1);
  }
  return range;
}

function utcDay(input: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
  const timestamp = Date.parse(input + 'T00:00:00Z');
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== input) return null;
  return timestamp;
}

/** User-picked days are inclusive, up to 366 calendar days; one or two days show hourly data. */
export function customTrendRange(from: string, to: string, now = Date.now()): Range | null {
  const start = utcDay(from);
  const end = utcDay(to);
  if (start === null || end === null || start > end || (end - start) / DAY >= MAX_CUSTOM_DAYS || start > now) return null;
  const finish = Math.min(end + DAY, now);
  if (finish <= start) return null;
  const days = Math.round((end - start) / DAY) + 1;
  return { from: start, to: finish, granularity: days <= 2 ? 'hour' : days <= 120 ? 'day' : 'month' };
}

/** Same-length preceding interval. */
export function previousTrendRange(range: Range, period: SiteTrendPeriod): Range {
  if (period === '12m') {
    const start = new Date(range.from);
    return {
      from: Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 12, 1),
      to: range.from,
      granularity: 'month',
    };
  }
  const calendarDays = Math.ceil((range.to - range.from) / DAY);
  const shift = calendarDays * DAY;
  return { from: range.from - shift, to: range.to - shift, granularity: range.granularity };
}

interface TrendRow {
  site_id: string;
  bucket: string;
  visitors: number;
  pageviews: number;
  sessions: number;
}

interface TotalRow {
  site_id: string;
  visitors: number;
  pageviews: number;
  sessions: number;
}

interface RevenueRow {
  site_id: string;
  bucket: string;
  revenue: number;
}

interface RevenueTotalRow {
  site_id: string;
  revenue: number;
}

interface TrendPoint {
  visitors: number;
  pageviews: number;
  sessions: number;
  impressions: number | null;
  revenue: number;
}

type GscState = {
  connected: boolean;
  available: boolean;
  reason: 'not_connected' | 'hourly' | 'admin' | 'stale' | 'unconfigured' | 'error' | null;
};

type TrendSummary = {
  buckets: string[];
  sites: Record<string, TrendPoint & { series: TrendPoint[] }>;
};

/** Keep the same authorized-site predicate for both independently selected windows. */
function summaryStatements(db: AppEnv['Bindings']['DB'], access: ReturnType<typeof siteAccessSql>, range: Range) {
  const where = `${access.sql} AND ss.started_at >= ? AND ss.started_at < ?`;
  const params = [...access.params, range.from, range.to];
  const bucket = bucketSql('ss.started_at', range.granularity, 0);
  return [
    db.prepare(
      `SELECT ss.site_id, ${bucket} AS bucket,
              COUNT(DISTINCT ss.visitor_id) AS visitors,
              COUNT(*) AS sessions,
              COALESCE(SUM(ss.pageviews), 0) AS pageviews
       FROM sessions ss JOIN sites s ON s.id = ss.site_id
       WHERE ${where} GROUP BY ss.site_id, bucket ORDER BY bucket`,
    ).bind(...params),
    db.prepare(
      `SELECT ss.site_id,
              COUNT(DISTINCT ss.visitor_id) AS visitors,
              COUNT(*) AS sessions,
              COALESCE(SUM(ss.pageviews), 0) AS pageviews
       FROM sessions ss JOIN sites s ON s.id = ss.site_id
       WHERE ${where} GROUP BY ss.site_id`,
    ).bind(...params),
  ];
}

/** Payments share the same UTC buckets so revenue stays comparable across sites. */
function revenueStatements(db: AppEnv['Bindings']['DB'], access: ReturnType<typeof siteAccessSql>, range: Range) {
  const where = `${access.sql} AND p.ts >= ? AND p.ts < ?`;
  const params = [...access.params, range.from, range.to];
  const bucket = bucketSql('p.ts', range.granularity, 0);
  return [
    db.prepare(
      `SELECT p.site_id, ${bucket} AS bucket, COALESCE(SUM(p.amount), 0) AS revenue
       FROM payments p JOIN sites s ON s.id = p.site_id
       WHERE ${where} GROUP BY p.site_id, bucket ORDER BY bucket`,
    ).bind(...params),
    db.prepare(
      `SELECT p.site_id, COALESCE(SUM(p.amount), 0) AS revenue
       FROM payments p JOIN sites s ON s.id = p.site_id
       WHERE ${where} GROUP BY p.site_id`,
    ).bind(...params),
  ];
}

function summarize(
  range: Range, trendRows: TrendRow[], totals: TotalRow[],
  revenueRows: RevenueRow[] = [], revenueTotals: RevenueTotalRow[] = [],
): TrendSummary {
  const buckets = bucketLabels(range, 0);
  const bySite = new Map<string, Map<string, TrendRow>>();
  for (const row of trendRows) {
    if (!bySite.has(row.site_id)) bySite.set(row.site_id, new Map());
    bySite.get(row.site_id)!.set(row.bucket, row);
  }
  const revenueBySite = new Map<string, Map<string, RevenueRow>>();
  for (const row of revenueRows) {
    if (!revenueBySite.has(row.site_id)) revenueBySite.set(row.site_id, new Map());
    revenueBySite.get(row.site_id)!.set(row.bucket, row);
  }
  const totalBySite = new Map(totals.map((row) => [row.site_id, row]));
  const revenueTotalBySite = new Map(revenueTotals.map((row) => [row.site_id, row.revenue]));

  // Payment-only sites (no tracked sessions) still belong on the revenue card.
  const ids = new Set([...totalBySite.keys(), ...revenueTotalBySite.keys()]);
  const sites: TrendSummary['sites'] = {};
  for (const id of ids) {
    const points = bySite.get(id);
    const revenuePoints = revenueBySite.get(id);
    const row = totalBySite.get(id);
    sites[id] = {
      visitors: row?.visitors ?? 0,
      pageviews: row?.pageviews ?? 0,
      sessions: row?.sessions ?? 0,
      impressions: null,
      revenue: revenueTotalBySite.get(id) ?? 0,
      series: buckets.map((label) => ({
        visitors: points?.get(label)?.visitors ?? 0,
        pageviews: points?.get(label)?.pageviews ?? 0,
        sessions: points?.get(label)?.sessions ?? 0,
        impressions: null,
        revenue: revenuePoints?.get(label)?.revenue ?? 0,
      })),
    };
  }
  return { buckets, sites };
}

/** Aggregate Search Console daily impressions into the overview's UTC buckets. */
export function impressionsByBucket(
  buckets: string[], granularity: Granularity, days: { date: string; impressions: number }[],
): number[] {
  if (granularity === 'hour') return buckets.map(() => 0);
  const totals = new Map<string, number>();
  for (const day of days) {
    const key = granularity === 'month' ? day.date.slice(0, 7) : day.date;
    totals.set(key, (totals.get(key) ?? 0) + day.impressions);
  }
  return buckets.map((bucket) => totals.get(bucket) ?? 0);
}

/** Hourly GSC labels carry offsets; normalize to the matching UTC dashboard bucket. */
export function hourlyImpressionsByBucket(
  buckets: string[], hours: { hour: string; impressions: number }[],
): number[] {
  const totals = new Map<string, number>();
  for (const hour of hours) totals.set(hour.hour, (totals.get(hour.hour) ?? 0) + hour.impressions);
  return buckets.map((bucket) => totals.get(bucket) ?? 0);
}

function requestedMetrics(raw: string | undefined): Set<SiteTrendMetric> {
  if (!raw) return new Set();
  const values = raw.split(',').map((value) => value.trim());
  return new Set(values.filter((value): value is SiteTrendMetric =>
    (TREND_METRICS as readonly string[]).includes(value)));
}

/**
 * Search Console data is per governed property, so each bound site is fetched
 * independently; sites without a property or with API errors stay empty instead
 * of reporting zero impressions.
 */
async function attachImpressions(
  c: Context<AppEnv>, access: ReturnType<typeof siteAccessSql>, summary: TrendSummary, range: Range, now: number,
): Promise<Record<string, GscState>> {
  const rows = await c.env.DB.prepare(`SELECT s.id, s.gsc_property FROM sites s WHERE ${access.sql}`)
    .bind(...access.params).all<{ id: string; gsc_property: string | null }>();
  const properties = new Map(rows.results.map((row) => [row.id, row.gsc_property]));

  const states: Record<string, GscState> = {};
  for (const [id, property] of properties) {
    states[id] = property
      ? { connected: true, available: false, reason: null }
      : { connected: false, available: false, reason: 'not_connected' };
  }
  const blocked = (reason: GscState['reason']) => {
    for (const state of Object.values(states)) {
      if (state.connected) state.reason = reason;
    }
    return states;
  };

  const user = c.get('user');
  if (c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET && !user?.admin) return blocked('admin');
  const hourly = range.granularity === 'hour';
  const window = hourly
    ? trendGscHourlyWindow(range.from, range.to, now)
    : trendGscWindow(range.from, range.to, now);
  if (!window.available) return blocked(hourly ? 'hourly' : 'stale');

  const bound = [...properties].filter(([, property]) => property);
  if (!bound.length) return states;

  let token: string;
  try {
    token = await googleToken(c.env.GSC_SERVICE_ACCOUNT_JSON);
  } catch {
    return blocked('unconfigured');
  }

  await Promise.all(bound.map(async ([id, property]) => {
    try {
      const values = hourly
        ? hourlyImpressionsByBucket(summary.buckets, await gscHourlyImpressions(token, property!, range.from, range.to))
        : impressionsByBucket(summary.buckets, range.granularity,
          await gscDailyImpressions(token, property!, window.from, window.to));
      const site = summary.sites[id];
      if (site) {
        site.impressions = values.reduce((total, value) => total + value, 0);
        site.series = site.series.map((point, index) => ({ ...point, impressions: values[index] ?? 0 }));
      }
      states[id] = { connected: true, available: true, reason: null };
    } catch {
      states[id] = { connected: true, available: false, reason: 'error' };
    }
  }));
  return states;
}

/** Fetch selected and optional comparison periods in one D1 batch. */
export async function siteTrends(c: Context<AppEnv>) {
  const requested = c.req.query('period') ?? '7d';
  const period = requested === 'today' || requested === 'yesterday' ? '24h' : requested;
  if (!isSiteTrendPeriod(period)) return c.json({ error: 'Invalid trend period' }, 400);

  const now = Date.now();
  const range = period === 'custom'
    ? customTrendRange(c.req.query('from') ?? '', c.req.query('to') ?? '', now)
    : siteTrendRange(period, now);
  if (!range) return c.json({ error: 'Invalid date range (maximum 366 days)' }, 400);

  const mode = c.req.query('compare') ?? 'none';
  if (!['none', 'previous', 'custom'].includes(mode)) return c.json({ error: 'Invalid comparison mode' }, 400);
  const comparison = mode === 'previous'
    ? previousTrendRange(range, period)
    : mode === 'custom'
      ? customTrendRange(c.req.query('compareFrom') ?? '', c.req.query('compareTo') ?? '', now)
      : null;
  if (mode !== 'none' && !comparison) return c.json({ error: 'Invalid comparison date range' }, 400);

  const access = siteAccessSql(c.env, c.get('user'));
  const windows = comparison ? [range, comparison] : [range];
  const statements = windows.flatMap((window) => [
    ...summaryStatements(c.env.DB, access, window),
    ...revenueStatements(c.env.DB, access, window),
  ]);
  const results = await c.env.DB.batch(statements);
  const summarizeAt = (offset: number, window: Range) => summarize(
    window,
    results[offset].results as unknown as TrendRow[],
    results[offset + 1].results as unknown as TotalRow[],
    results[offset + 2].results as unknown as RevenueRow[],
    results[offset + 3].results as unknown as RevenueTotalRow[],
  );
  const current = summarizeAt(0, range);
  const compared = comparison ? summarizeAt(4, comparison) : null;

  let gsc: Record<string, GscState> | null = null;
  let comparedGsc: Record<string, GscState> | null = null;
  if (requestedMetrics(c.req.query('metrics')).has('impressions')) {
    [gsc, comparedGsc] = await Promise.all([
      attachImpressions(c, access, current, range, now),
      compared && comparison ? attachImpressions(c, access, compared, comparison, now) : Promise.resolve(null),
    ]);
  }

  return c.json({
    period,
    range: { from: range.from, to: range.to, granularity: range.granularity },
    ...current,
    ...(gsc ? { gsc } : {}),
    comparison: compared ? {
      mode,
      range: { from: comparison!.from, to: comparison!.to, granularity: comparison!.granularity },
      ...compared,
      ...(comparedGsc ? { gsc: comparedGsc } : {}),
    } : null,
  });
}
