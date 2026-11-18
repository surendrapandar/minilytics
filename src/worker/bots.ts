import type { Context } from 'hono';
import { identifyBot, type BotInfo } from '../shared/bots';
import { siteOwnerActive } from './auth';
import { getSite, type AppEnv, type Site, type SiteWithOwner } from './env';
import { verifyBot, type Verdict } from './lib/botVerify';
import { bucketLabels, bucketSql, resolveRange, tzOffset, type Range } from './lib/time';
import { belongsTo, normalizePath } from './lib/url';
import { siteFromApiKey } from './payments';

// Bots, crawlers and AI agents. People are counted in sessions/events; bots only here, so they never
// inflate visitor numbers. Hits arrive two ways:
//  1. The tracking script, for the few bots that run JavaScript (AI browser agents, Googlebot rendering, headless
//     browsers). The collector sends those here instead of counting them as visitors.
//  2. POST /api/v1/hits from the site's own server, which sees every request, including the AI crawlers
//     (GPTBot, ClaudeBot, PerplexityBot…) that never run JavaScript.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface BotHit {
  bot: BotInfo;
  path: string;
  ts: number;
  verdict: Verdict;
  /** The server answered with a 4xx/5xx (only known when the server reports it). */
  error: boolean;
  /** The site's snippet cut this bot off for sending too many requests (429). */
  blocked?: boolean;
}

export interface BotRow {
  hour: number;
  bot: string;
  operator: string;
  category: string;
  path: string;
  hits: number;
  verified: number;
  spoofed: number;
  errors: number;
  blocked: number;
  last_seen: number;
}

// ---------- storing

/** Hits are kept per hour, bot and page: one row per combination however often a bot comes back. */
export function aggregateHits(hits: BotHit[]): BotRow[] {
  const rows = new Map<string, BotRow>();
  for (const h of hits) {
    const hour = Math.floor(h.ts / HOUR) * HOUR;
    const key = `${hour}\n${h.bot.name}\n${h.path}`;
    let r = rows.get(key);
    if (!r) {
      r = { hour, bot: h.bot.name, operator: h.bot.operator, category: h.bot.category, path: h.path, hits: 0, verified: 0, spoofed: 0, errors: 0, blocked: 0, last_seen: h.ts };
      rows.set(key, r);
    }
    r.hits++;
    if (h.verdict === 'verified') r.verified++;
    if (h.verdict === 'spoofed') r.spoofed++;
    if (h.error) r.errors++;
    if (h.blocked) r.blocked++;
    r.last_seen = Math.max(r.last_seen, h.ts);
  }
  return [...rows.values()];
}

const UPSERT = `INSERT INTO bot_hits (site_id, hour, bot, path, operator, category, hits, verified, spoofed, errors, blocked, last_seen)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (site_id, hour, bot, path) DO UPDATE SET
    hits = hits + excluded.hits, verified = verified + excluded.verified, spoofed = spoofed + excluded.spoofed,
    errors = errors + excluded.errors, blocked = blocked + excluded.blocked, last_seen = MAX(last_seen, excluded.last_seen)`;

export async function saveBotHits(db: D1Database, siteId: string, hits: BotHit[]) {
  const rows = aggregateHits(hits);
  for (let i = 0; i < rows.length; i += 100) {
    await db.batch(
      rows
        .slice(i, i + 100)
        .map((r) =>
          db.prepare(UPSERT).bind(siteId, r.hour, r.bot, r.path, r.operator, r.category, r.hits, r.verified, r.spoofed, r.errors, r.blocked, r.last_seen),
        ),
    );
  }
}

// ---------- 1. bots that ran the tracking script

/** The client's address, or null when the request came through a proxy (it would be the proxy's address). */
export function directIp(headers: Headers): string | null {
  const ip = headers.get('cf-connecting-ip');
  if (!ip || headers.has('x-vercel-ip-country')) return null;
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded && forwarded.split(',')[0].trim() !== ip) return null;
  return ip;
}

export async function recordBeaconBot(c: Context<AppEnv>, bot: BotInfo, siteId: string, pageUrl: string) {
  const site = await getSite(c.env.DB, siteId);
  if (!site || !siteOwnerActive(c.env, site)) return;
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return;
  }
  if (!belongsTo(url.hostname, site.domain)) return;
  const verdict = await verifyBot(bot, directIp(c.req.raw.headers), c.req.raw);
  await saveBotHits(c.env.DB, site.id, [{ bot, path: normalizePath(url.pathname), ts: Date.now(), verdict, error: false }]);
}

// ---------- 2. bots reported by the site's server

const MAX_HITS = 500;

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** When it happened: ms, seconds or an ISO date. Log lines up to a week old keep their time; anything else is "now". */
export function hitTime(v: unknown, now: number): number {
  const t = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) && t > now - 7 * DAY && t <= now + 5 * 60_000 ? Math.round(t) : now;
}

async function toHit(input: unknown, site: Site, now: number): Promise<BotHit | null> {
  if (!input || typeof input !== 'object') return null;
  const h = input as Record<string, unknown>;
  const ua = str(h.ua ?? h.user_agent, 1000) ?? '';
  const signatureAgent = str(h.signature_agent, 500);
  const bot = identifyBot(ua, { signatureAgent });
  if (!bot) return null; // a person: the tracking script already counts them

  let url: URL;
  try {
    url = new URL(str(h.url, 2000) ?? str(h.path, 2000) ?? '/', `https://${site.domain}`);
  } catch {
    return null;
  }
  // The original request, rebuilt from its signature headers, so a signed agent can be verified.
  const signature = str(h.signature, 4000);
  const signatureInput = str(h.signature_input, 4000);
  let req: Request | null = null;
  if (signature && signatureInput && signatureAgent) {
    try {
      req = new Request(url, {
        method: str(h.method, 16) ?? 'GET',
        headers: { signature, 'signature-input': signatureInput, 'signature-agent': signatureAgent },
      });
    } catch {}
  }
  const status = Number(h.status);
  return {
    bot,
    path: normalizePath(url.pathname),
    ts: hitTime(h.ts, now),
    verdict: await verifyBot(bot, str(h.ip, 64), req),
    error: status >= 400 && status < 600,
    blocked: h.blocked === true,
  };
}

/** Shows the server setup as connected. Written at most hourly (the cached site object remembers it). */
async function markFeedConnected(db: D1Database, site: SiteWithOwner, now: number) {
  if (site.bot_feed_at && now - site.bot_feed_at < HOUR) return;
  site.bot_feed_at = now;
  await db.prepare('UPDATE sites SET bot_feed_at = ? WHERE id = ?').bind(now, site.id).run();
}

/**
 * POST /api/v1/hits  Authorization: Bearer <site api key>
 * { "url": "https://example.com/pricing", "ua": "...GPTBot/1.2...", "ip": "20.171.207.1", "status": 200 }
 * or { "hits": [ up to 500 of those, each with an optional "ts" ] } for log batches.
 * Optional: "signature", "signature_input", "signature_agent" (the request's Web Bot Auth headers), and
 * "blocked": true when the snippet answered 429 because this bot sent too many requests (reported once per minute).
 * Requests from people are skipped, so sending more than bots is harmless (it just costs requests).
 */
export async function handleHitsApi(c: Context<AppEnv>) {
  const keyed = await siteFromApiKey(c);
  const site = keyed && (await getSite(c.env.DB, keyed.id));
  if (!site) return c.json({ error: 'invalid api key' }, 401);
  const body = await c.req.json<unknown>().catch(() => null);
  const list: unknown[] | null =
    body && typeof body === 'object' ? (Array.isArray((body as { hits?: unknown }).hits) ? (body as { hits: unknown[] }).hits : [body]) : null;
  if (!list) return c.json({ error: 'Send one hit {"url", "ua", "ip"} or {"hits": [...]}' }, 400);
  if (list.length > MAX_HITS) return c.json({ error: `At most ${MAX_HITS} hits per request` }, 413);
  // Hosted mode: quietly stop recording when the owner's plan has ended, like the tracking script.
  if (!siteOwnerActive(c.env, site)) return c.json({ ok: true, received: list.length, bots: 0 });

  const now = Date.now();
  const hits = (await Promise.all(list.map((h) => toHit(h, site, now)))).filter((h): h is BotHit => h !== null);
  await saveBotHits(c.env.DB, site.id, hits);
  await markFeedConnected(c.env.DB, site, now);
  return c.json({ ok: true, received: list.length, bots: hits.length });
}

// ---------- dashboard

/** Bot filters (separate from the visitor filters), keyed by the dimension the dashboard asks for. */
const BOT_DIMS = { bot: 'b.bot', operator: 'b.operator', category: 'b.category', page: 'b.path' } as const;
type BotDim = keyof typeof BOT_DIMS;
export type BotFilters = Partial<Record<BotDim, string>>;
const isDim = (d: string): d is BotDim => Object.prototype.hasOwnProperty.call(BOT_DIMS, d);

interface BotCtx {
  db: D1Database;
  site: Site;
  range: Range;
  offset: number;
  filters: BotFilters;
}

export function makeBotCtx(c: Context<AppEnv>): BotCtx {
  const site = c.get('site');
  const q = c.req.query();
  const range = resolveRange(q, site.timezone, site.created_at);
  const filters: BotFilters = {};
  try {
    const f = JSON.parse(q.filters || '{}');
    for (const k of Object.keys(BOT_DIMS)) if (isDim(k) && typeof f[k] === 'string') filters[k] = f[k].slice(0, 500);
  } catch {}
  return { db: c.env.DB, site, range, offset: tzOffset(site.timezone, range.to), filters };
}

function botsWhere(ctx: BotCtx, from = ctx.range.from, to = ctx.range.to) {
  // Rows are hourly, so the hour a period starts in counts whole.
  const parts = ['b.site_id = ?', 'b.hour >= ?', 'b.hour < ?'];
  const params: unknown[] = [ctx.site.id, Math.floor(from / HOUR) * HOUR, to];
  for (const [k, v] of Object.entries(ctx.filters)) {
    if (!isDim(k) || v === undefined) continue;
    parts.push(`${BOT_DIMS[k]} = ?`);
    params.push(v);
  }
  return { sql: parts.join(' AND '), params };
}

const AI = `b.category LIKE 'AI %'`;

const TOTALS_SQL = (where: string) => `
  SELECT COALESCE(SUM(b.hits), 0) AS hits, COALESCE(SUM(CASE WHEN ${AI} THEN b.hits END), 0) AS ai,
         COALESCE(SUM(b.verified), 0) AS verified, COALESCE(SUM(b.spoofed), 0) AS spoofed, COALESCE(SUM(b.blocked), 0) AS blocked,
         COUNT(DISTINCT b.bot) AS bots, COUNT(DISTINCT b.path) AS pages
  FROM bot_hits b WHERE ${where}`;

export interface BotTotals {
  hits: number;
  ai: number;
  verified: number;
  spoofed: number;
  blocked: number;
  bots: number;
  pages: number;
}

/** Totals against the previous period, and AI vs other bot hits over time. */
export async function botOverview(ctx: BotCtx) {
  const { db, range, site } = ctx;
  const cur = botsWhere(ctx);
  const prev = botsWhere(ctx, range.from - (range.to - range.from), range.from);
  const bucket = bucketSql('b.hour', range.granularity, ctx.offset);
  const [t1, t0, ts] = await db.batch([
    db.prepare(TOTALS_SQL(cur.sql)).bind(...cur.params),
    db.prepare(TOTALS_SQL(prev.sql)).bind(...prev.params),
    db
      .prepare(
        `SELECT ${bucket} AS b, SUM(CASE WHEN ${AI} THEN b.hits ELSE 0 END) AS ai, SUM(CASE WHEN ${AI} THEN 0 ELSE b.hits END) AS other
         FROM bot_hits b WHERE ${cur.sql} GROUP BY 1`,
      )
      .bind(...cur.params),
  ]);
  const by = new Map((ts.results as { b: string; ai: number; other: number }[]).map((r) => [r.b, r]));
  return {
    range,
    current: t1.results[0] as BotTotals,
    previous: t0.results[0] as BotTotals,
    series: bucketLabels(range, ctx.offset).map((b) => ({ bucket: b, ai: by.get(b)?.ai ?? 0, other: by.get(b)?.other ?? 0 })),
    /** When the site's server last reported bots: null means only bots that run JavaScript are visible. */
    serverReportAt: site.bot_feed_at ?? null,
  };
}

export async function botBreakdown(ctx: BotCtx, dim: string, limit = 100) {
  if (!isDim(dim)) throw new Error(`unknown dimension ${dim}`);
  const w = botsWhere(ctx);
  const lim = Math.max(1, Math.min(500, limit));
  const res = await ctx.db
    .prepare(
      `SELECT ${BOT_DIMS[dim]} AS label, SUM(b.hits) AS hits, SUM(b.verified) AS verified, SUM(b.spoofed) AS spoofed,
              SUM(b.errors) AS errors, SUM(b.blocked) AS blocked, COUNT(DISTINCT b.bot) AS bots, COUNT(DISTINCT b.path) AS pages,
              MAX(b.operator) AS operator, MAX(b.category) AS category, MAX(b.last_seen) AS last_seen
       FROM bot_hits b WHERE ${w.sql} GROUP BY 1 ORDER BY hits DESC LIMIT ${lim}`,
    )
    .bind(...w.params)
    .all();
  return res.results;
}
