import type { Context } from 'hono';
import { classifyCrawler, crawlerDomain, CRAWLER_CATEGORIES, type CrawlerCategory } from '../shared/crawlers';
import type { AppEnv, Site } from './env';
import { bucketLabels, bucketSql } from './lib/time';
import type { Ctx } from './stats';

const MAX_BATCH = 100;
/** Lines drawn on the chart; the list on the right shows more. */
const MAX_SERIES = 8;
const LIST_LIMIT = 50;

// Personal data in URLs never gets stored (same list as the tracker).
const PRIVATE_PARAM = /^(e-?mail|name|phone|password|pass|token|access_token|id_token|auth|code|secret|key|api_key|license_key|license)$/i;

/** "/pricing?via=app" style path: decoded, no trailing slash, private params dropped. */
export function crawlerPath(input: string): string {
  let u: URL;
  try {
    u = new URL(input, 'https://x.invalid');
  } catch {
    return '/';
  }
  let p = u.pathname || '/';
  try {
    p = decodeURI(p);
  } catch {}
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  for (const k of [...u.searchParams.keys()]) if (PRIVATE_PARAM.test(k)) u.searchParams.delete(k);
  const q = u.searchParams.toString();
  return (q ? `${p}?${q}` : p).slice(0, 500);
}

async function siteFromApiKey(c: Context<AppEnv>): Promise<Site | null> {
  const key = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!key) return null;
  return c.env.DB.prepare('SELECT * FROM sites WHERE api_key = ?').bind(key).first<Site>();
}

/**
 * Crawler hits from the site's server (middleware), since crawlers don't run JavaScript.
 * POST /api/v1/crawlers  Authorization: Bearer <site api key>
 * { "ua": "<User-Agent>", "path": "/pricing?via=app" }   or   { "hits": [{ "ua", "path", "ts"? }, …] }
 * Unknown user agents are ignored, so the middleware can forward anything that looks like a bot.
 */
export async function handleCrawlerApi(c: Context<AppEnv>) {
  const site = await siteFromApiKey(c);
  if (!site) return c.json({ error: 'invalid api key' }, 401);
  const b = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!b) return c.json({ error: 'invalid json' }, 400);
  const raw = (Array.isArray(b.hits) ? b.hits : [b]).slice(0, MAX_BATCH) as Record<string, unknown>[];
  const now = Date.now();
  const rows = raw.flatMap((h) => {
    const crawler = classifyCrawler(typeof h.ua === 'string' ? h.ua.slice(0, 500) : null);
    if (!crawler) return [];
    // A batch may arrive late; accept timestamps from the last day, never from the future.
    const ts = typeof h.ts === 'number' && h.ts <= now && h.ts > now - 86_400_000 ? Math.floor(h.ts) : now;
    return [{ ts, crawler: crawler.name, category: crawler.category, path: crawlerPath(typeof h.path === 'string' ? h.path : '/') }];
  });
  if (rows.length) {
    await c.env.DB.batch(
      rows.map((r) =>
        c.env.DB.prepare('INSERT INTO crawler_hits (site_id, ts, crawler, category, path) VALUES (?, ?, ?, ?, ?)').bind(
          site.id,
          r.ts,
          r.crawler,
          r.category,
          r.path,
        ),
      ),
    );
  }
  return c.json({ ok: true, recorded: rows.length });
}

export interface CrawlerStatsQuery {
  category: CrawlerCategory;
  by: 'crawler' | 'page';
  /** Only count these crawlers (empty = all). */
  crawlers: string[];
}

export function parseCrawlerQuery(q: Record<string, string>): CrawlerStatsQuery {
  const category = (CRAWLER_CATEGORIES as string[]).includes(q.category) ? (q.category as CrawlerCategory) : 'answers';
  const by = q.by === 'page' ? 'page' : 'crawler';
  const crawlers = (q.crawlers ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);
  return { category, by, crawlers };
}

/** Totals per category, the crawlers in the active category, and a chart + ranked list by crawler or page. */
export async function crawlerStats(ctx: Ctx, q: CrawlerStatsQuery) {
  const { db, site, range } = ctx;
  const base = 'site_id = ? AND ts >= ? AND ts < ?';
  const baseParams = [site.id, range.from, range.to];
  const only = q.crawlers.length ? ` AND crawler IN (${q.crawlers.map(() => '?').join(',')})` : '';
  const where = `${base} AND category = ?${only}`;
  const whereParams = [...baseParams, q.category, ...q.crawlers];
  const key = q.by === 'page' ? 'path' : 'crawler';
  const b = bucketSql('ts', range.granularity, ctx.offset);

  const [totals, crawlers, list] = await db.batch([
    db.prepare(`SELECT category, COUNT(*) AS hits FROM crawler_hits WHERE ${base} GROUP BY category`).bind(...baseParams),
    db
      .prepare(`SELECT crawler, COUNT(*) AS hits FROM crawler_hits WHERE ${base} AND category = ? GROUP BY crawler ORDER BY hits DESC`)
      .bind(...baseParams, q.category),
    db
      .prepare(`SELECT ${key} AS k, COUNT(*) AS hits FROM crawler_hits WHERE ${where} GROUP BY k ORDER BY hits DESC LIMIT ${LIST_LIMIT}`)
      .bind(...whereParams),
  ]);

  const rows = (list.results as { k: string; hits: number }[]).map((r) => ({
    key: r.k,
    hits: r.hits,
    domain: q.by === 'crawler' ? crawlerDomain(r.k) : null,
  }));
  const keys = rows.slice(0, MAX_SERIES).map((r) => r.key);

  const byBucket = new Map<string, Record<string, number>>();
  if (keys.length) {
    const ts = await db
      .prepare(
        `SELECT ${b} AS b, ${key} AS k, COUNT(*) AS hits FROM crawler_hits
         WHERE ${where} AND ${key} IN (${keys.map(() => '?').join(',')}) GROUP BY b, k`,
      )
      .bind(...whereParams, ...keys)
      .all<{ b: string; k: string; hits: number }>();
    for (const r of ts.results) {
      const m = byBucket.get(r.b) ?? {};
      m[r.k] = r.hits;
      byBucket.set(r.b, m);
    }
  }
  const series = bucketLabels(range, ctx.offset).map((bucket) => {
    const m = byBucket.get(bucket) ?? {};
    return { bucket, values: keys.map((k) => m[k] ?? 0) };
  });

  const totalBy = new Map((totals.results as { category: string; hits: number }[]).map((r) => [r.category, r.hits]));
  return {
    range,
    totals: Object.fromEntries(CRAWLER_CATEGORIES.map((c) => [c, totalBy.get(c) ?? 0])) as Record<CrawlerCategory, number>,
    crawlers: (crawlers.results as { crawler: string; hits: number }[]).map((r) => ({
      name: r.crawler,
      hits: r.hits,
      domain: crawlerDomain(r.crawler),
    })),
    keys,
    series,
    rows,
  };
}
