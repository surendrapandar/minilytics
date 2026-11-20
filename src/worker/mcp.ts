import type { Context } from 'hono';
import { CRAWLER_CATEGORIES } from '../shared/crawlers';
import { crawlerStats, parseCrawlerQuery } from './crawlers';
import type { AppEnv, Site } from './env';
import { PERIODS } from './lib/time';
import { currencyDecimals } from './payments';
import { BREAKDOWN_DIMENSIONS, breakdown, ctxFrom, customers, funnel, overview, realtime, type FunnelStep } from './stats';

/**
 * Read-only MCP server (Streamable HTTP, stateless, JSON responses) so AI assistants can query a site's analytics.
 *   POST /api/mcp        Authorization: Bearer <site api key>
 *   POST /api/mcp/<key>  for clients that can't send headers
 * One API key = one site; every tool answers for that site only.
 */

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'minilytics', version: '0.1.0' };

interface RpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

type Args = Record<string, unknown>;

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

// ---- shared argument schemas

const periodProps = {
  period: { type: 'string', enum: PERIODS, default: '30d', description: 'Time range. Use "custom" with from/to.' },
  from: { type: 'string', description: 'YYYY-MM-DD, first day (period "custom")' },
  to: { type: 'string', description: 'YYYY-MM-DD, last day, inclusive (period "custom")' },
};
const filterProp = {
  filters: {
    type: 'object',
    additionalProperties: { type: 'string' },
    description:
      'Only count sessions matching all of these, e.g. {"channel":"AI"}, {"source":"Google"}, {"country":"US"}, {"page":"/pricing"}, {"goal":"signup_click"}. ' +
      'Keys: channel, source, referrer_domain, utm_source, utm_medium, utm_campaign, utm_term, utm_content, ref, country, region, city, browser, os, device, entry_page, exit_page, hostname, page, goal.',
  },
};

function statsQuery(a: Args) {
  const filters = a.filters && typeof a.filters === 'object' ? JSON.stringify(a.filters) : undefined;
  return { period: str(a.period) ?? '30d', from: str(a.from), to: str(a.to), filters };
}

const READ_ONLY = { readOnlyHint: true, openWorldHint: false };

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (db: D1Database, site: Site, a: Args) => Promise<unknown>;
}

const TOOLS: Tool[] = [
  {
    name: 'get_site',
    title: 'Site details',
    description: 'The website this connection reads: name, domain, timezone and revenue currency.',
    inputSchema: { type: 'object', properties: {} },
    run: async (_db, site) => ({
      name: site.name,
      domain: site.domain,
      timezone: site.timezone,
      currency: site.currency,
      created_at: new Date(site.created_at).toISOString(),
    }),
  },
  {
    name: 'get_overview',
    title: 'Traffic and revenue overview',
    description:
      'Headline numbers for a period compared with the previous period of the same length: visitors, sessions, pageviews, bounce rate, ' +
      'average session time, revenue, payments, customers, conversion rate, revenue per visitor, people online now, plus a time series.',
    inputSchema: { type: 'object', properties: { ...periodProps, ...filterProp } },
    run: async (db, site, a) => {
      const o = await overview(ctxFrom(db, site, statsQuery(a)));
      const m = money(site);
      const kpis = (k: typeof o.current) => ({
        ...k,
        revenue: m(k.revenue),
        revenuePerVisitor: m(k.revenuePerVisitor),
        avgSessionSeconds: Math.round(k.avgDuration / 1000),
        avgDuration: undefined,
      });
      return {
        currency: site.currency,
        range: range(o.range),
        current: kpis(o.current),
        previous: kpis(o.previous),
        onlineNow: o.online,
        series: o.series.map((s) => ({ bucket: s.bucket, visitors: s.visitors, pageviews: s.pageviews, revenue: m(s.revenue), payments: s.payments })),
      };
    },
  },
  {
    name: 'get_breakdown',
    title: 'Breakdown by dimension',
    description:
      'Top values of one dimension with visitors, revenue and customers: channel, source (referrer), campaign, keyword, utm_*, ref, ' +
      'country/region/city, browser/os/device, page, entry_page, exit_page, exit_link (outbound clicks), goal (custom events), hostname.',
    inputSchema: {
      type: 'object',
      properties: {
        dimension: { type: 'string', enum: BREAKDOWN_DIMENSIONS },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        ...periodProps,
        ...filterProp,
      },
      required: ['dimension'],
    },
    run: async (db, site, a) => {
      const dim = str(a.dimension);
      if (!dim || !BREAKDOWN_DIMENSIONS.includes(dim)) throw new ToolError(`dimension must be one of: ${BREAKDOWN_DIMENSIONS.join(', ')}`);
      const limit = Math.max(1, Math.min(100, Number(a.limit) || 20));
      const ctx = ctxFrom(db, site, statsQuery(a));
      const rows = (await breakdown(ctx, dim, limit)).slice(0, limit);
      const m = money(site);
      return {
        dimension: dim,
        currency: site.currency,
        range: range(ctx.range),
        rows: rows.map((r) => ({
          [dim]: r.label ?? '(none)',
          visitors: r.visitors,
          ...(r.pageviews !== undefined ? { [dim === 'goal' || dim === 'exit_link' ? 'events' : 'pageviews']: r.pageviews } : {}),
          revenue: m(r.revenue),
          customers: r.customers,
        })),
      };
    },
  },
  {
    name: 'get_realtime',
    title: 'Right now',
    description: 'People on the site in the last 5 minutes (page, source, country, device) and pageviews, goals and payments of the last 30 minutes.',
    inputSchema: { type: 'object', properties: {} },
    run: async (db, site) => {
      const r = await realtime(db, site);
      const m = money(site);
      return {
        onlineNow: r.visitors.length,
        visitors: (r.visitors as any[]).slice(0, 50).map((v) => ({
          page: v.page,
          source: v.source ?? v.referrer_domain ?? 'Direct/None',
          country: v.country,
          city: v.city,
          device: v.device,
          pageviews: v.pageviews,
          since: new Date(v.started_at).toISOString(),
        })),
        last30Minutes: r.feed.slice(0, 50).map((e: any) => ({
          at: new Date(e.ts).toISOString(),
          type: e.type,
          ...(e.label !== undefined ? { what: e.label } : {}),
          ...(e.amount !== undefined ? { amount: m(e.amount), currency: site.currency } : {}),
          country: e.country,
        })),
      };
    },
  },
  {
    name: 'get_customers',
    title: 'Customers and attribution',
    description:
      'Payments in the period (newest first, up to 200) with what brought each buyer: source, channel, campaign, ref, entry page, ' +
      'country, device, number of visits before paying, and how the payment was matched to the visitor.',
    inputSchema: { type: 'object', properties: { ...periodProps, ...filterProp } },
    run: async (db, site, a) => {
      const ctx = ctxFrom(db, site, statsQuery(a));
      const rows = (await customers(ctx)) as any[];
      return {
        range: range(ctx.range),
        payments: rows.map((p) => ({
          at: new Date(p.ts).toISOString(),
          amount: p.amount / 10 ** currencyDecimals(p.currency ?? site.currency),
          currency: p.currency ?? site.currency,
          renewal: !!p.renewal,
          customer: p.name ?? p.pay_name ?? null,
          email: p.email ?? p.pay_email ?? null,
          source: p.source,
          channel: p.channel,
          campaign: p.utm_campaign,
          ref: p.ref,
          entryPage: p.entry_page,
          country: p.country,
          device: p.device,
          visitsBeforePaying: p.visits,
          matchedBy: p.matched_by,
        })),
      };
    },
  },
  {
    name: 'list_funnels',
    title: 'Saved funnels',
    description: 'Funnels saved in the dashboard, with their steps. Use get_funnel to see conversion through one.',
    inputSchema: { type: 'object', properties: {} },
    run: async (db, site) => {
      const res = await db.prepare('SELECT id, name, steps FROM funnels WHERE site_id = ? ORDER BY created_at').bind(site.id).all<any>();
      return res.results.map((f) => ({ id: f.id, name: f.name, steps: JSON.parse(f.steps) }));
    },
  },
  {
    name: 'get_funnel',
    title: 'Funnel conversion',
    description:
      'Visitors who completed each step in order. Pass a saved funnel id, or ad-hoc steps such as ' +
      '[{"type":"page","value":"/pricing"},{"type":"goal","value":"signup_click"}] (page values accept * wildcards).',
    inputSchema: {
      type: 'object',
      properties: {
        funnel_id: { type: 'string' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: { type: { type: 'string', enum: ['page', 'goal'] }, value: { type: 'string' } },
            required: ['type', 'value'],
          },
        },
        ...periodProps,
        ...filterProp,
      },
    },
    run: async (db, site, a) => {
      let steps: FunnelStep[] = [];
      if (str(a.funnel_id)) {
        const f = await db.prepare('SELECT steps FROM funnels WHERE id = ? AND site_id = ?').bind(str(a.funnel_id), site.id).first<{ steps: string }>();
        if (!f) throw new ToolError('funnel not found');
        steps = JSON.parse(f.steps);
      } else if (Array.isArray(a.steps)) {
        steps = (a.steps as any[])
          .filter((s) => (s?.type === 'page' || s?.type === 'goal') && typeof s.value === 'string' && s.value.trim())
          .slice(0, 10)
          .map((s) => ({ type: s.type, value: s.value.trim().slice(0, 200) }));
      }
      if (steps.length < 2) throw new ToolError('pass funnel_id or at least 2 steps');
      const ctx = ctxFrom(db, site, statsQuery(a));
      const res = await funnel(ctx, steps);
      return {
        range: range(ctx.range),
        steps: res.map((s, i) => ({
          ...s,
          conversionFromPrevious: i && res[i - 1].visitors ? s.visitors / res[i - 1].visitors : null,
          conversionFromFirst: res[0].visitors ? s.visitors / res[0].visitors : null,
        })),
      };
    },
  },
  {
    name: 'get_ai_crawlers',
    title: 'AI crawler visibility',
    description:
      'Which AI assistants and crawlers read the site. category: answers (fetched live for a user question: ChatGPT, Claude, Perplexity…), ' +
      'indexing (search crawlers: Googlebot, Bingbot, OAI-SearchBot…), training (GPTBot, ClaudeBot…). by: crawler or page. ' +
      'Only populated when the site reports crawler hits (Settings → AI crawlers).',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: CRAWLER_CATEGORIES, default: 'answers' },
        by: { type: 'string', enum: ['crawler', 'page'], default: 'crawler' },
        crawlers: { type: 'array', items: { type: 'string' }, description: 'Only these crawlers, e.g. ["ChatGPT","Claude"]' },
        ...periodProps,
      },
    },
    run: async (db, site, a) => {
      const ctx = ctxFrom(db, site, statsQuery(a));
      const q = parseCrawlerQuery({
        category: str(a.category) ?? 'answers',
        by: str(a.by) ?? 'crawler',
        crawlers: Array.isArray(a.crawlers) ? a.crawlers.filter((c) => typeof c === 'string').join(',') : '',
      });
      const s = await crawlerStats(ctx, q);
      return {
        range: range(ctx.range),
        totalsByCategory: s.totals,
        category: q.category,
        crawlersInCategory: s.crawlers.map((c) => ({ crawler: c.name, hits: c.hits })),
        [q.by === 'page' ? 'topPages' : 'topCrawlers']: s.rows.map((r) => ({ [q.by]: r.key, hits: r.hits })),
        series: s.series.map((p) => ({ bucket: p.bucket, ...Object.fromEntries(s.keys.map((k, i) => [k, p.values[i]])) })),
      };
    },
  },
];

class ToolError extends Error {}

function money(site: Site) {
  const d = currencyDecimals(site.currency);
  return (minor: number) => Math.round(minor) / 10 ** d;
}

function range(r: { from: number; to: number; granularity: string }) {
  return { from: new Date(r.from).toISOString(), to: new Date(r.to).toISOString(), granularity: r.granularity };
}

// ---- JSON-RPC

const result = (id: RpcRequest['id'], res: unknown) => ({ jsonrpc: '2.0' as const, id: id ?? null, result: res });
const error = (id: RpcRequest['id'], code: number, message: string) => ({ jsonrpc: '2.0' as const, id: id ?? null, error: { code, message } });

/** Handles one JSON-RPC message; returns null for notifications. */
export async function handleRpc(msg: RpcRequest, db: D1Database, site: Site) {
  const isNotification = msg.id === undefined;
  if (msg?.jsonrpc !== '2.0' || typeof msg.method !== 'string') return error(msg?.id, -32600, 'Invalid Request');

  switch (msg.method) {
    case 'initialize': {
      const asked = str(msg.params?.protocolVersion);
      return result(msg.id, {
        protocolVersion: asked && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          `Read-only analytics for ${site.domain} (timezone ${site.timezone}, revenue in ${site.currency}). ` +
          'Amounts are in major units (e.g. 29.99). Periods default to the last 30 days.',
      });
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return result(msg.id, {});
    case 'tools/list':
      return result(msg.id, {
        tools: TOOLS.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema, annotations: { title, ...READ_ONLY } })),
      });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === msg.params?.name);
      if (!tool) return error(msg.id, -32602, `Unknown tool: ${String(msg.params?.name)}`);
      const args = (msg.params?.arguments && typeof msg.params.arguments === 'object' ? msg.params.arguments : {}) as Args;
      try {
        const data = await tool.run(db, site, args);
        return result(msg.id, { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: Array.isArray(data) ? { items: data } : data });
      } catch (e) {
        const message = e instanceof ToolError ? e.message : `Failed: ${(e as Error).message}`;
        return result(msg.id, { content: [{ type: 'text', text: message }], isError: true });
      }
    }
    default:
      return isNotification ? null : error(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function handleMcp(c: Context<AppEnv>) {
  if (c.req.method !== 'POST') {
    // Stateless server: no SSE stream to resume and no session to delete.
    return c.json(error(null, -32000, 'Method not allowed: POST JSON-RPC messages to this endpoint'), 405, { Allow: 'POST' });
  }
  const key = c.req.param('key') ?? c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  const site = key ? await c.env.DB.prepare('SELECT * FROM sites WHERE api_key = ?').bind(key).first<Site>() : null;
  if (!site) {
    return c.json(error(null, -32001, 'Unauthorized: use "Authorization: Bearer <site API key>" (Minilytics → Settings)'), 401);
  }
  const body = await c.req.json<RpcRequest | RpcRequest[]>().catch(() => null);
  if (!body) return c.json(error(null, -32700, 'Parse error'), 400);

  if (Array.isArray(body)) {
    const out = (await Promise.all(body.slice(0, 20).map((m) => handleRpc(m, c.env.DB, site)))).filter(Boolean);
    return out.length ? c.json(out) : c.body(null, 202);
  }
  const out = await handleRpc(body, c.env.DB, site);
  return out ? c.json(out) : c.body(null, 202);
}
