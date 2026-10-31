import type { Context } from 'hono';
import { siteAccessSql } from './auth';
import type { AppEnv } from './env';
import { bucketLabels, bucketSql, resolveRange, type Range } from './lib/time';

export const SITE_TREND_PERIODS = ['today', 'yesterday', '7d', '30d', '90d', '12m', 'custom'] as const;
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
    { period, granularity: period === '12m' ? 'month' : period === 'today' || period === 'yesterday' ? 'hour' : 'day' },
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

/** Same-length preceding interval, keeping today's elapsed hours aligned with yesterday. */
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

type TrendSummary = {
  buckets: string[];
  sites: Record<string, { visitors: number; pageviews: number; sessions: number; series: { visitors: number; pageviews: number; sessions: number }[] }>;
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

function summarize(range: Range, trendRows: TrendRow[], totals: TotalRow[]): TrendSummary {
  const buckets = bucketLabels(range, 0);
  const bySite = new Map<string, Map<string, TrendRow>>();
  for (const row of trendRows) {
    if (!bySite.has(row.site_id)) bySite.set(row.site_id, new Map());
    bySite.get(row.site_id)!.set(row.bucket, row);
  }

  const sites: TrendSummary['sites'] = {};
  for (const row of totals) {
    const points = bySite.get(row.site_id);
    sites[row.site_id] = {
      visitors: row.visitors,
      pageviews: row.pageviews,
      sessions: row.sessions,
      series: buckets.map((label) => ({
        visitors: points?.get(label)?.visitors ?? 0,
        pageviews: points?.get(label)?.pageviews ?? 0,
        sessions: points?.get(label)?.sessions ?? 0,
      })),
    };
  }
  return { buckets, sites };
}

/** Fetch selected and optional comparison periods in one D1 batch. */
export async function siteTrends(c: Context<AppEnv>) {
  const period = c.req.query('period') ?? '7d';
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
  const statements = [
    ...summaryStatements(c.env.DB, access, range),
    ...(comparison ? summaryStatements(c.env.DB, access, comparison) : []),
  ];
  const results = await c.env.DB.batch(statements);
  const current = summarize(range, results[0].results as unknown as TrendRow[], results[1].results as unknown as TotalRow[]);
  const compared = comparison
    ? summarize(comparison, results[2].results as unknown as TrendRow[], results[3].results as unknown as TotalRow[])
    : null;
  return c.json({
    period,
    range: { from: range.from, to: range.to, granularity: range.granularity },
    ...current,
    comparison: compared ? {
      mode,
      range: { from: comparison!.from, to: comparison!.to, granularity: comparison!.granularity },
      ...compared,
    } : null,
  });
}
