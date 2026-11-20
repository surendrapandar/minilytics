import type { Context } from 'hono';
import type { AppEnv, Site } from './env';
import { currencyDecimals } from './payments';
import { BREAKDOWN_DIMENSIONS, breakdown, ctxFrom, overview } from './stats';

/**
 * Read-only REST stats API for servers (dashboards, agents) that want a site's numbers without speaking MCP.
 *   GET /api/v1/stats/overview?from=YYYY-MM-DD&to=YYYY-MM-DD           daily visitors, pageviews, revenue, payments + totals
 *   GET /api/v1/stats/breakdown?dimension=source&from=…&to=…&limit=20  top values of one dimension
 * Authorization: Bearer <site API key> (Settings). One key = one site. Same queries as the dashboard and the MCP server.
 * Without from/to the last 30 days are used; days are in the site's timezone; amounts are in major units.
 */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 400;

async function siteFromKey(c: Context<AppEnv>): Promise<Site | null> {
  const key = c.req.header('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!key || !key.startsWith('ml_')) return null;
  return c.env.DB.prepare('SELECT * FROM sites WHERE api_key = ?').bind(key).first<Site>();
}

/** The window from the query: a custom from/to (both days, inclusive) or the default last 30 days. */
function windowFrom(c: Context<AppEnv>): { period: string; from?: string; to?: string } | { error: string } {
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!from && !to) return { period: '30d' };
  if (!from || !to || !DAY_RE.test(from) || !DAY_RE.test(to)) return { error: 'from and to must both be YYYY-MM-DD' };
  if (from > to) return { error: 'from must be on or before to' };
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > MAX_DAYS) return { error: `at most ${MAX_DAYS} days per request` };
  return { period: 'custom', from, to };
}

const money = (site: Site) => {
  const d = currencyDecimals(site.currency);
  return (minor: number) => Math.round(minor) / 10 ** d;
};

const unauthorized = (c: Context<AppEnv>) => c.json({ error: 'Use "Authorization: Bearer <site API key>" (Minilytics → Settings).' }, 401);

export async function statsOverviewApi(c: Context<AppEnv>) {
  const site = await siteFromKey(c);
  if (!site) return unauthorized(c);
  const win = windowFrom(c);
  if ('error' in win) return c.json({ error: win.error }, 400);
  const o = await overview(ctxFrom(c.env.DB, site, { ...win, granularity: 'day' }));
  const m = money(site);
  const totals = (k: typeof o.current) => ({
    visitors: k.visitors,
    sessions: k.sessions,
    pageviews: k.pageviews,
    bounceRate: k.bounceRate,
    avgSessionSeconds: Math.round(k.avgDuration / 1000),
    revenue: m(k.revenue),
    payments: k.payments,
    customers: k.customers,
    conversionRate: k.conversionRate,
  });
  return c.json({
    site: { domain: site.domain, timezone: site.timezone, currency: site.currency },
    from: win.from ?? null,
    to: win.to ?? null,
    totals: totals(o.current),
    previous: totals(o.previous),
    days: o.series.map((s) => ({ date: s.bucket, visitors: s.visitors, pageviews: s.pageviews, revenue: m(s.revenue), payments: s.payments })),
  });
}

export async function statsBreakdownApi(c: Context<AppEnv>) {
  const site = await siteFromKey(c);
  if (!site) return unauthorized(c);
  const win = windowFrom(c);
  if ('error' in win) return c.json({ error: win.error }, 400);
  const dimension = c.req.query('dimension') ?? 'source';
  if (!BREAKDOWN_DIMENSIONS.includes(dimension)) return c.json({ error: `dimension must be one of: ${BREAKDOWN_DIMENSIONS.join(', ')}` }, 400);
  const limit = Math.max(1, Math.min(100, Number(c.req.query('limit')) || 20));
  const rows = (await breakdown(ctxFrom(c.env.DB, site, win), dimension, limit)).slice(0, limit);
  const m = money(site);
  return c.json({
    dimension,
    currency: site.currency,
    rows: rows.map((r) => ({ label: r.label ?? '(none)', visitors: r.visitors, pageviews: r.pageviews ?? null, revenue: m(r.revenue), customers: r.customers })),
  });
}
