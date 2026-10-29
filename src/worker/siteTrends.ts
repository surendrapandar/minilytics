import type { Context } from 'hono';
import { siteAccessSql } from './auth';
import type { AppEnv } from './env';
import { bucketLabels, bucketSql, resolveRange, type Range } from './lib/time';

export const SITE_TREND_PERIODS = ['7d', '30d', '90d', '12m'] as const;
export type SiteTrendPeriod = (typeof SITE_TREND_PERIODS)[number];

export function isSiteTrendPeriod(value: string): value is SiteTrendPeriod {
  return SITE_TREND_PERIODS.some((period) => period === value);
}

/** Use a shared UTC timeline so trends are directly comparable across websites. */
export function siteTrendRange(period: SiteTrendPeriod, now = Date.now()): Range {
  const range = resolveRange(
    { period, granularity: period === '12m' ? 'month' : 'day' },
    'UTC',
    now - 365 * 86_400_000,
    now,
  );
  if (period === '12m') {
    const date = new Date(now);
    range.from = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 11, 1);
  }
  return range;
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

/** Fetch all authorized websites' statistics in one batch, not one request per card. */
export async function siteTrends(c: Context<AppEnv>) {
  const period = c.req.query('period') ?? '7d';
  if (!isSiteTrendPeriod(period)) return c.json({ error: 'Invalid trend period' }, 400);

  const range = siteTrendRange(period);
  const buckets = bucketLabels(range, 0);
  const access = siteAccessSql(c.env, c.get('user'));
  const where = `${access.sql} AND ss.started_at >= ? AND ss.started_at < ?`;
  const params = [...access.params, range.from, range.to];
  const bucket = bucketSql('ss.started_at', range.granularity, 0);

  const [trendRows, totals] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT ss.site_id, ${bucket} AS bucket,
              COUNT(DISTINCT ss.visitor_id) AS visitors,
              COUNT(*) AS sessions,
              COALESCE(SUM(ss.pageviews), 0) AS pageviews
       FROM sessions ss JOIN sites s ON s.id = ss.site_id
       WHERE ${where} GROUP BY ss.site_id, bucket ORDER BY bucket`,
    ).bind(...params),
    c.env.DB.prepare(
      `SELECT ss.site_id,
              COUNT(DISTINCT ss.visitor_id) AS visitors,
              COUNT(*) AS sessions,
              COALESCE(SUM(ss.pageviews), 0) AS pageviews
       FROM sessions ss JOIN sites s ON s.id = ss.site_id
       WHERE ${where} GROUP BY ss.site_id`,
    ).bind(...params),
  ]);

  const bySite = new Map<string, Map<string, TrendRow>>();
  for (const row of trendRows.results as unknown as TrendRow[]) {
    if (!bySite.has(row.site_id)) bySite.set(row.site_id, new Map());
    bySite.get(row.site_id)!.set(row.bucket, row);
  }

  const sites: Record<string, { visitors: number; pageviews: number; sessions: number; series: { visitors: number; pageviews: number; sessions: number }[] }> = {};
  for (const row of totals.results as unknown as TotalRow[]) {
    const points = bySite.get(row.site_id);
    sites[row.site_id] = {
      visitors: row.visitors,
      pageviews: row.pageviews,
      sessions: row.sessions,
      series: buckets.map((label) => ({ visitors: points?.get(label)?.visitors ?? 0, pageviews: points?.get(label)?.pageviews ?? 0, sessions: points?.get(label)?.sessions ?? 0 })),
    };
  }

  return c.json({ period, buckets, sites });
}
