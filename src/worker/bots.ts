import type { Context } from 'hono';
import { getSite, type AppEnv, type Site } from './env';
import { siteOwnerActive } from './auth';
import { belongsTo, normalizePath } from './collect';
import { isBot } from './lib/ua';
import { bucketLabels, bucketSql, tzOffset, resolveRange } from './lib/time';

/** User-agent claims only; this does not verify crawler ownership.
 * OpenAI: https://developers.openai.com/api/docs/bots
 * Anthropic: https://privacy.claude.com/en/articles/8896518
 */
export function classifyBot(ua: string): { bot: string; category: string } | null {
  const rules: [RegExp, string, string][] = [
    [/ChatGPT-User/i, 'ChatGPT-User', 'AI assistant'],
    [/Claude-User/i, 'Claude-User', 'AI assistant'],
    [/Perplexity-User/i, 'Perplexity-User', 'AI assistant'],
    [/GPTBot/i, 'GPTBot', 'AI training'],
    [/ClaudeBot/i, 'ClaudeBot', 'AI training'],
    [/Bytespider/i, 'Bytespider', 'AI training'],
    [/OAI-SearchBot/i, 'OAI-SearchBot', 'AI search'],
    [/Claude-SearchBot/i, 'Claude-SearchBot', 'AI search'],
    [/PerplexityBot/i, 'PerplexityBot', 'AI search'],
    [/Googlebot/i, 'Googlebot', 'Search engine'],
    [/bingbot/i, 'Bingbot', 'Search engine'],
    [/DuckDuckBot/i, 'DuckDuckBot', 'Search engine'],
    [/Baiduspider/i, 'Baiduspider', 'Search engine'],
    [/YandexBot/i, 'YandexBot', 'Search engine'],
    [/facebookexternalhit|Twitterbot|LinkedInBot|Slackbot|Discordbot|TelegramBot|WhatsApp/i, 'Link preview', 'Preview'],
    [/AhrefsBot|SemrushBot|MJ12bot|DotBot/i, 'SEO crawler', 'SEO'],
  ];
  const rule = rules.find(([re]) => re.test(ua));
  if (rule) return { bot: rule[1], category: rule[2] };
  return ua && isBot(ua) ? { bot: 'Other bot', category: 'Other' } : null;
}

export async function collectBot(c: Context<AppEnv>) {
  const key = /^Bearer\s+(.+)$/i.exec(c.req.header('authorization') ?? '')?.[1];
  if (!key) return c.json({ error: 'Invalid API key' }, 401);
  const keyed = await c.env.DB.prepare('SELECT id FROM sites WHERE api_key = ?').bind(key).first<Pick<Site, 'id'>>();
  if (!keyed) return c.json({ error: 'Invalid API key' }, 401);
  const site = await getSite(c.env.DB, keyed.id);
  if (!site || !siteOwnerActive(c.env, site)) return c.body(null, 202);
  const raw = await c.req.text();
  if (raw.length > 4096) return c.json({ error: 'Payload too large' }, 413);
  let b: { url?: unknown; user_agent?: unknown };
  try { b = JSON.parse(raw); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  if (!b || typeof b.url !== 'string' || typeof b.user_agent !== 'string' || b.user_agent.length > 1024)
    return c.json({ error: 'Expected url and user_agent strings' }, 400);
  let url: URL;
  try { url = new URL(b.url); } catch { return c.json({ error: 'Invalid URL' }, 400); }
  if (!/^https?:$/.test(url.protocol) || !belongsTo(url.hostname, site.domain))
    return c.json({ error: 'URL must belong to this site' }, 403);
  const bot = classifyBot(b.user_agent);
  if (!bot) return c.body(null, 202);
  await c.env.DB.prepare('INSERT INTO bot_requests (site_id, ts, bot, category, hostname, path) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(site.id, Date.now(), bot.bot, bot.category, url.hostname, normalizePath(url.pathname)).run();
  return c.body(null, 202);
}

export async function botStats(c: Context<AppEnv>) {
  const site = c.get('site');
  const range = resolveRange(c.req.query(), site.timezone, site.created_at);
  let where = 'site_id = ? AND ts >= ? AND ts < ?';
  const params: (string | number)[] = [site.id, range.from, range.to];
  for (const [query, column] of [['bot_names', 'bot'], ['page_paths', 'path']] as const) {
    const raw = c.req.query(query);
    if (raw === undefined) continue;
    let values: unknown;
    try { values = JSON.parse(raw); } catch { return c.json({ error: 'Invalid bot filters' }, 400); }
    if (!Array.isArray(values) || values.length > 100 || values.some(v => typeof v !== 'string' || v.length > 500))
      return c.json({ error: 'Invalid bot filters' }, 400);
    if (!values.length) where += ' AND 0';
    else {
      where += ` AND ${column} IN (SELECT value FROM json_each(?))`;
      params.push(JSON.stringify(values));
    }
  }
  const categories: Record<string, string[]> = {
    answers: ['AI assistant'], indexing: ['AI search', 'Search engine'], training: ['AI training'], other: ['Other', 'SEO', 'Preview'],
  };
  const category = c.req.query('bot_group');
  if (category) {
    if (!Object.hasOwn(categories, category)) return c.json({ error: 'Invalid bot category' }, 400);
    where += ` AND category IN (${categories[category].map(() => '?').join(',')})`;
    params.push(...categories[category]);
  }
  const offset = tzOffset(site.timezone, range.to);
  const bucket = bucketSql('ts', range.granularity, offset);
  const [total, bots, pages, recent, traffic, pageBots, pageTraffic] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT COUNT(*) AS requests, COUNT(DISTINCT bot) AS bots FROM bot_requests WHERE ${where}`).bind(...params),
    c.env.DB.prepare(`SELECT bot, category, COUNT(*) AS requests FROM bot_requests WHERE ${where} GROUP BY bot, category ORDER BY requests DESC, bot LIMIT 100`).bind(...params),
    c.env.DB.prepare(`SELECT path, COUNT(*) AS requests FROM bot_requests WHERE ${where} GROUP BY path ORDER BY requests DESC, path LIMIT 100`).bind(...params),
    c.env.DB.prepare(`SELECT ts, bot, category, hostname, path FROM bot_requests WHERE ${where} ORDER BY ts DESC, id DESC LIMIT 30`).bind(...params),
    c.env.DB.prepare(`SELECT ${bucket} AS bucket, bot, category, COUNT(*) AS requests FROM bot_requests WHERE ${where} GROUP BY bucket, bot, category ORDER BY bucket`).bind(...params),
    c.env.DB.prepare(`SELECT hostname, path, bot, category, COUNT(*) AS requests FROM bot_requests WHERE ${where} GROUP BY hostname, path, bot, category ORDER BY requests DESC LIMIT 1000`).bind(...params),
    c.env.DB.prepare(`SELECT ${bucket} AS bucket, path, COUNT(*) AS requests FROM bot_requests WHERE ${where}
      AND path IN (SELECT path FROM bot_requests WHERE ${where} GROUP BY path ORDER BY COUNT(*) DESC, path LIMIT 100)
      GROUP BY bucket, path ORDER BY bucket`).bind(...params, ...params),
  ]);
  const labels = bucketLabels(range, offset);
  // A rolling range can end partway through a bucket: include that final bucket too.
  if (range.to > range.from) {
    for (const label of bucketLabels({ ...range, from: range.to - 1 }, offset)) {
      if (!labels.includes(label)) labels.push(label);
    }
  }
  return c.json({ range, labels, pageTraffic: pageTraffic.results, traffic: traffic.results, pageBots: pageBots.results,
    total: total.results[0], bots: bots.results, pages: pages.results, recent: recent.results });
}
