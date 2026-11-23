import type { Context } from 'hono';
import { isHosted, siteAccessSql, type User } from './auth';
import type { AppEnv, Env, Site } from './env';
import { currencyDecimals } from './payments';
import { breakdown, ctxFor, customers, funnel, overview, realtime, sparklines, visitorProfile, visitors, type FunnelStep } from './stats';
import { userForBearer } from './tokens';
import { PERIODS } from './lib/time';

/**
 * Minilytics as an MCP server (Streamable HTTP, stateless, JSON responses): AI assistants can read a site's
 * analytics and revenue with a Bearer token from the OAuth flow (oauth.ts) or a personal token (tokens.ts).
 * Everything is read-only, and results are capped so a chat can't pull huge tables (or rack up D1 reads).
 */

const SERVER_VERSION = '1.0.0';
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const LATEST = '2025-06-18';

const INSTRUCTIONS = `Minilytics is the user's privacy-friendly web analytics with revenue attribution: it links each payment (Stripe, Dodo Payments or its API) to the visitor and traffic source that brought it.
- Start with list_sites to get site ids. Every other tool takes "site" (an id or the domain).
- Periods: today, yesterday, 24h, 48h, 7d, 30d (default), 90d, 12m, all, or custom with from/to dates (YYYY-MM-DD, inclusive, in the site's timezone).
- Money is in major units of the site's currency (e.g. 19.99 USD). Refunds are negative.
- "visitors" are unique people, "sessions" are visits. Bounce = a visit with one pageview and no goal.
- Filters (optional object) narrow everything to matching visits, e.g. {"source":"X"}, {"country":"DE"}, {"utm_campaign":"launch"}, {"page":"/pricing"}, {"goal":"signup"}. Use "" to match an empty value.
- Prefer short periods and small limits; for "which X made money" use get_breakdown and sort by revenue.`;

// ---------- tool definitions (JSON Schema)

const SITE = { type: 'string', description: 'Site id or domain, from list_sites.' };
const PERIOD = { type: 'string', enum: PERIODS, default: '30d', description: 'Time period. "custom" needs from/to.' };
const DATE = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const FILTER_KEYS = [
  'channel', 'source', 'referrer_domain', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref',
  'country', 'region', 'city', 'browser', 'os', 'device', 'entry_page', 'exit_page', 'hostname', 'page', 'goal',
];
const FILTERS = {
  type: 'object',
  description: 'Only count visits matching all of these. country is a 2-letter code; page/entry_page/exit_page are paths like /pricing; goal is a goal name.',
  properties: Object.fromEntries(FILTER_KEYS.map((k) => [k, { type: 'string' }])),
  additionalProperties: false,
};
const RANGE_PROPS = { period: PERIOD, from: { ...DATE, description: 'Start date for period=custom.' }, to: { ...DATE, description: 'End date (inclusive) for period=custom.' } };
const limit = (def: number, max: number) => ({ type: 'integer', minimum: 1, maximum: max, default: def, description: `Max rows (default ${def}, max ${max}).` });
export const DIMENSIONS = [
  'source', 'channel', 'referrer', 'campaign', 'keyword', 'utm_source', 'utm_medium', 'utm_content', 'ref',
  'page', 'entry_page', 'exit_page', 'exit_link', 'goal', 'hostname',
  'country', 'region', 'city', 'browser', 'os', 'device',
];

const readOnly = (title: string) => ({ title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

export const TOOLS = [
  {
    name: 'list_sites',
    title: 'List websites',
    description: 'All websites in this Minilytics account with id, domain, timezone, currency, visitors and revenue in the last 30 days, and people online now.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: readOnly('List websites'),
  },
  {
    name: 'get_overview',
    title: 'Traffic & revenue overview',
    description:
      'Headline numbers for a period compared with the previous period of the same length: visitors, sessions, pageviews, bounce rate, average visit duration, revenue, payments, customers, conversion rate, revenue per visitor. Also a time series (hour/day/week/month buckets in site time) and how many people are online now.',
    inputSchema: {
      type: 'object',
      properties: { site: SITE, ...RANGE_PROPS, granularity: { type: 'string', enum: ['hour', 'day', 'week', 'month'], description: 'Bucket size of the series (picked automatically if omitted).' }, filters: FILTERS },
      required: ['site'],
      additionalProperties: false,
    },
    annotations: readOnly('Traffic & revenue overview'),
  },
  {
    name: 'get_breakdown',
    title: 'Top sources, pages, countries…',
    description:
      'Visitors, pageviews, revenue and paying customers grouped by one dimension, sorted by visitors. Use it for "where does traffic / money come from", top pages, top countries, devices, UTM campaigns, goals (custom events) and outbound links (exit_link). For source, "extra" is the referrer domain; for region/city it is the country.',
    inputSchema: {
      type: 'object',
      properties: {
        site: SITE,
        dimension: { type: 'string', enum: DIMENSIONS, description: 'What to group by.' },
        ...RANGE_PROPS,
        filters: FILTERS,
        sort: { type: 'string', enum: ['visitors', 'revenue'], default: 'visitors' },
        limit: limit(20, 100),
      },
      required: ['site', 'dimension'],
      additionalProperties: false,
    },
    annotations: readOnly('Breakdown by dimension'),
  },
  {
    name: 'get_realtime',
    title: 'Live visitors',
    description: 'Who is on the site right now (active in the last 5 minutes: page, location, source, device) and the pageviews, goals and payments of the last 30 minutes.',
    inputSchema: { type: 'object', properties: { site: SITE, limit: limit(25, 100) }, required: ['site'], additionalProperties: false },
    annotations: readOnly('Live visitors'),
  },
  {
    name: 'list_customers',
    title: 'Customers & their journey',
    description: 'Payments in the period, newest first, each with the buyer (name/email if known), amount, whether it was a renewal, and where that customer came from (source, channel, campaign, ref, country, device, landing page, number of visits before paying).',
    inputSchema: { type: 'object', properties: { site: SITE, ...RANGE_PROPS, filters: FILTERS, limit: limit(25, 100) }, required: ['site'], additionalProperties: false },
    annotations: readOnly('Customers'),
  },
  {
    name: 'list_visitors',
    title: 'Recent visitors',
    description: 'Visitors seen in the period, most recent first: visits, pageviews, time on site, source, location, device, identity if known, and total spent.',
    inputSchema: { type: 'object', properties: { site: SITE, ...RANGE_PROPS, filters: FILTERS, limit: limit(25, 100) }, required: ['site'], additionalProperties: false },
    annotations: readOnly('Visitors'),
  },
  {
    name: 'get_visitor',
    title: 'One visitor’s full history',
    description: 'Everything one visitor did: identity, every visit with its source, the pages and goals in order, and their payments. visitor_id comes from list_visitors, list_customers or get_realtime.',
    inputSchema: { type: 'object', properties: { site: SITE, visitor_id: { type: 'string' } }, required: ['site', 'visitor_id'], additionalProperties: false },
    annotations: readOnly('Visitor profile'),
  },
  {
    name: 'list_funnels',
    title: 'Funnels',
    description: 'The conversion funnels set up for the site (ordered page or goal steps).',
    inputSchema: { type: 'object', properties: { site: SITE }, required: ['site'], additionalProperties: false },
    annotations: readOnly('Funnels'),
  },
  {
    name: 'get_funnel',
    title: 'Funnel conversion',
    description: 'How many visitors reached each step of a funnel in order during the period, with step-to-step and overall conversion. Pass a saved funnel_id, or your own steps (2-10) to test any path.',
    inputSchema: {
      type: 'object',
      properties: {
        site: SITE,
        funnel_id: { type: 'string', description: 'A funnel from list_funnels.' },
        steps: {
          type: 'array',
          minItems: 2,
          maxItems: 10,
          description: 'Ad-hoc steps instead of funnel_id. Page paths support * wildcards, e.g. /blog/*.',
          items: { type: 'object', properties: { type: { type: 'string', enum: ['page', 'goal'] }, value: { type: 'string' } }, required: ['type', 'value'], additionalProperties: false },
        },
        ...RANGE_PROPS,
        filters: FILTERS,
      },
      required: ['site'],
      additionalProperties: false,
    },
    annotations: readOnly('Funnel conversion'),
  },
] as const;

// ---------- shaping results for an AI (readable dates, money in major units, nothing huge)

const TIME_KEYS = new Set(['ts', 'started_at', 'last_seen_at', 'last_seen', 'first_seen', 'created_at', 'now']);
const MONEY_KEYS = new Set(['amount', 'spent', 'revenue', 'revenuePerVisitor']);
const DURATION_KEYS = new Set(['duration', 'avgDuration']); // stored in ms, shown in seconds
const DROP_KEYS = new Set(['site_id', 'lat', 'lon', 'api_key', 'dodo_webhook_secret', 'stripe_webhook_secret', 'payload', 'owner_id']);

export function humanize(value: unknown, decimals: number): unknown {
  if (Array.isArray(value)) return value.map((v) => humanize(v, decimals));
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (DROP_KEYS.has(k) || v === null || v === undefined) continue;
    if (TIME_KEYS.has(k) && typeof v === 'number') out[k] = new Date(v).toISOString();
    else if (MONEY_KEYS.has(k) && typeof v === 'number') out[k] = round(v / 10 ** decimals, decimals);
    else if (DURATION_KEYS.has(k) && typeof v === 'number') out[k] = Math.round(v / 1000);
    else if (k === 'props' && typeof v === 'string') out[k] = safeJson(v);
    else out[k] = humanize(v, decimals);
  }
  return out;
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
const pct = (n: number) => round(n * 100, 2);
const change = (cur: number, prev: number) => (prev ? pct((cur - prev) / prev) : null);
function safeJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

// ---------- tool implementations

class ToolError extends Error {}

type Args = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const int = (v: unknown, def: number, max: number) => Math.max(1, Math.min(max, Number.isFinite(Number(v)) && v !== undefined && v !== null ? Math.floor(Number(v)) : def));

async function findSite(env: Env, user: User, ref: unknown): Promise<Site> {
  const key = str(ref)?.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '');
  if (!key) throw new ToolError('"site" is required. Call list_sites to get site ids.');
  const access = siteAccessSql(env, user);
  const site = await env.DB.prepare(`SELECT s.* FROM sites s WHERE (s.id = ? OR s.domain = ?) AND ${access.sql} ORDER BY s.created_at LIMIT 1`)
    .bind(str(ref), key, ...access.params)
    .first<Site>();
  if (!site) throw new ToolError(`No site "${str(ref)}" in this account. Call list_sites to see the available sites.`);
  return site;
}

function rangeQuery(a: Args) {
  const period = str(a.period) ?? '30d';
  if (!(PERIODS as readonly string[]).includes(period)) throw new ToolError(`Unknown period "${period}". Use one of: ${PERIODS.join(', ')}.`);
  if (period === 'custom' && !str(a.from)) throw new ToolError('period=custom needs "from" (YYYY-MM-DD).');
  const filters = a.filters && typeof a.filters === 'object' ? JSON.stringify(a.filters) : undefined;
  return { period, from: str(a.from), to: str(a.to), granularity: str(a.granularity), filters };
}

function describeRange(site: Site, r: { from: number; to: number; granularity: string }) {
  return { from: new Date(r.from).toISOString(), to: new Date(r.to).toISOString(), timezone: site.timezone, granularity: r.granularity };
}

export async function callTool(env: Env, user: User, name: string, a: Args): Promise<unknown> {
  if (name === 'list_sites') {
    const access = siteAccessSql(env, user);
    const sites = (await env.DB.prepare(`SELECT s.* FROM sites s WHERE ${access.sql} ORDER BY s.created_at`).bind(...access.params).all<Site>()).results;
    const sparks = new Map((await sparklines(env.DB, sites.map((s) => s.id), '30d')).map((s) => [s.id, s]));
    return {
      sites: sites.map((s) => {
        const sp = sparks.get(s.id);
        const d = currencyDecimals(s.currency);
        return {
          id: s.id,
          name: s.name,
          domain: s.domain,
          timezone: s.timezone,
          currency: s.currency,
          created_at: new Date(s.created_at).toISOString(),
          visitors_30d: sp?.visitors ?? 0,
          revenue_30d: round((sp?.revenue ?? 0) / 10 ** d, d),
          online_now: sp?.online ?? 0,
        };
      }),
    };
  }

  const site = await findSite(env, user, a.site);
  const d = currencyDecimals(site.currency);
  const base = { site: { id: site.id, domain: site.domain }, currency: site.currency };

  switch (name) {
    case 'get_overview': {
      const o = await overview(ctxFor(env.DB, site, rangeQuery(a)));
      const keys = Object.keys(o.current) as (keyof typeof o.current)[];
      const shape = (k: typeof o.current) => {
        const h = humanize(k, d) as Record<string, number>;
        return { ...h, bounceRate: pct(k.bounceRate), conversionRate: pct(k.conversionRate) };
      };
      return {
        ...base,
        range: describeRange(site, o.range),
        notes: 'bounceRate and conversionRate are percentages; avgDuration is in seconds; change is % vs the previous period (null when it was 0).',
        current: shape(o.current),
        previous: shape(o.previous),
        change: Object.fromEntries(keys.map((k) => [k, change(o.current[k], o.previous[k])])),
        online_now: o.online,
        series: humanize(o.series, d),
      };
    }
    case 'get_breakdown': {
      const dim = str(a.dimension) ?? '';
      if (!DIMENSIONS.includes(dim)) throw new ToolError(`Unknown dimension "${dim}". Use one of: ${DIMENSIONS.join(', ')}.`);
      const ctx = ctxFor(env.DB, site, rangeQuery(a));
      const lim = int(a.limit, 20, 100);
      // Sorting by revenue has to see every row first (breakdown sorts by visitors).
      let rows = await breakdown(ctx, dim, a.sort === 'revenue' ? 500 : lim);
      if (a.sort === 'revenue') rows = rows.sort((x, y) => y.revenue - x.revenue || y.visitors - x.visitors);
      return { ...base, dimension: dim, range: describeRange(site, ctx.range), rows: humanize(rows.slice(0, lim), d) };
    }
    case 'get_realtime': {
      const r = await realtime(env.DB, site);
      const lim = int(a.limit, 25, 100);
      return {
        ...base,
        now: new Date(r.now).toISOString(),
        online_now: r.visitors.length,
        active_visitors: humanize(r.visitors.slice(0, lim), d),
        last_30_minutes: humanize(r.feed.slice(0, lim).map(({ id: _id, ...e }) => e), d),
      };
    }
    case 'list_customers': {
      const ctx = ctxFor(env.DB, site, rangeQuery(a));
      const rows = (await customers(ctx)) as Record<string, unknown>[];
      const lim = int(a.limit, 25, 100);
      return { ...base, range: describeRange(site, ctx.range), total_in_period: rows.length >= 200 ? '200+' : rows.length, customers: humanize(rows.slice(0, lim), d) };
    }
    case 'list_visitors': {
      const ctx = ctxFor(env.DB, site, rangeQuery(a));
      const rows = (await visitors(ctx)) as Record<string, unknown>[];
      const lim = int(a.limit, 25, 100);
      return { ...base, range: describeRange(site, ctx.range), notes: 'duration is in seconds.', visitors: humanize(rows.slice(0, lim), d) };
    }
    case 'get_visitor': {
      const vid = str(a.visitor_id);
      if (!vid) throw new ToolError('"visitor_id" is required.');
      const p = await visitorProfile(env.DB, site, vid);
      if (!p.visitor && !p.sessions.length) throw new ToolError(`No visitor "${vid}" on ${site.domain}.`);
      return {
        ...base,
        visitor: humanize(p.visitor, d),
        sessions: humanize(p.sessions.slice(0, 50), d),
        events: humanize(p.events.slice(0, 200), d),
        events_truncated: p.events.length > 200,
        payments: humanize(p.payments, d),
      };
    }
    case 'list_funnels': {
      const rows = (await env.DB.prepare('SELECT id, name, steps, created_at FROM funnels WHERE site_id = ? ORDER BY created_at').bind(site.id).all<{ id: string; name: string; steps: string; created_at: number }>()).results;
      return { ...base, funnels: rows.map((f) => ({ id: f.id, name: f.name, steps: JSON.parse(f.steps) })) };
    }
    case 'get_funnel': {
      let steps: FunnelStep[];
      let funnelName: string | undefined;
      if (str(a.funnel_id)) {
        const f = await env.DB.prepare('SELECT name, steps FROM funnels WHERE id = ? AND site_id = ?').bind(str(a.funnel_id), site.id).first<{ name: string; steps: string }>();
        if (!f) throw new ToolError(`No funnel "${str(a.funnel_id)}". Call list_funnels.`);
        steps = JSON.parse(f.steps);
        funnelName = f.name;
      } else {
        steps = (Array.isArray(a.steps) ? a.steps : [])
          .filter((s: any) => s && (s.type === 'page' || s.type === 'goal') && typeof s.value === 'string' && s.value.trim())
          .slice(0, 10)
          .map((s: any) => ({ type: s.type, value: s.value.trim().slice(0, 200) }));
        if (steps.length < 2) throw new ToolError('Give a funnel_id, or at least 2 steps like [{"type":"page","value":"/pricing"},{"type":"goal","value":"signup"}].');
      }
      const ctx = ctxFor(env.DB, site, rangeQuery(a));
      const res = await funnel(ctx, steps);
      const first = res[0]?.visitors ?? 0;
      return {
        ...base,
        funnel: funnelName,
        range: describeRange(site, ctx.range),
        steps: res.map((s, i) => ({
          ...s,
          from_previous_pct: i === 0 ? 100 : res[i - 1].visitors ? pct(s.visitors / res[i - 1].visitors) : 0,
          overall_pct: first ? pct(s.visitors / first) : 0,
        })),
      };
    }
  }
  throw new ToolError(`Unknown tool "${name}".`);
}

// ---------- JSON-RPC over Streamable HTTP

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: any;
}

const rpcResult = (id: RpcRequest['id'], result: unknown) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id: RpcRequest['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/** Best-effort per-isolate limit, so a runaway agent can't hammer the database. */
const WINDOW_MS = 5 * 60_000;
const MAX_CALLS = 150;
const calls = new Map<string, { n: number; at: number }>();
export function rateLimited(key: string, now = Date.now()): boolean {
  const c = calls.get(key);
  if (!c || now - c.at > WINDOW_MS) {
    if (calls.size > 5000) calls.clear();
    calls.set(key, { n: 1, at: now });
    return false;
  }
  c.n++;
  return c.n > MAX_CALLS;
}

export async function handleRpc(env: Env, user: User, msg: RpcRequest, limitKey: string): Promise<object | null> {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return rpcError(msg?.id, -32600, 'Invalid JSON-RPC request');
  }
  const isNotification = msg.id === undefined;
  if (isNotification) return null; // notifications/initialized, cancelled… need no answer.
  const p = msg.params ?? {};

  switch (msg.method) {
    case 'initialize': {
      const asked = typeof p.protocolVersion === 'string' ? p.protocolVersion : LATEST;
      return rpcResult(msg.id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : LATEST,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'minilytics', title: 'Minilytics', version: SERVER_VERSION },
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return rpcResult(msg.id, {});
    case 'tools/list':
      return rpcResult(msg.id, { tools: TOOLS });
    case 'resources/list':
      return rpcResult(msg.id, { resources: [] });
    case 'resources/templates/list':
      return rpcResult(msg.id, { resourceTemplates: [] });
    case 'prompts/list':
      return rpcResult(msg.id, { prompts: [] });
    case 'tools/call': {
      const name = String(p.name ?? '');
      if (!TOOLS.some((t) => t.name === name)) return rpcError(msg.id, -32602, `Unknown tool: ${name}`);
      if (rateLimited(limitKey)) {
        return rpcResult(msg.id, { isError: true, content: [{ type: 'text', text: 'Rate limit reached (150 calls per 5 minutes). Wait a few minutes and try again.' }] });
      }
      try {
        const data = await callTool(env, user, name, p.arguments && typeof p.arguments === 'object' ? p.arguments : {});
        return rpcResult(msg.id, { content: [{ type: 'text', text: JSON.stringify(data) }] });
      } catch (e) {
        const text = e instanceof ToolError ? e.message : `Minilytics error: ${(e as Error).message}`;
        if (!(e instanceof ToolError)) console.error('mcp tool failed', name, e);
        return rpcResult(msg.id, { isError: true, content: [{ type: 'text', text }] });
      }
    }
    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export function unauthorized(c: Context<AppEnv>, message = 'Connect with OAuth or send "Authorization: Bearer <token>" (create one in Minilytics → Connect AI).') {
  const o = new URL(c.req.url).origin;
  c.header('WWW-Authenticate', `Bearer resource_metadata="${o}/.well-known/oauth-protected-resource", scope="read"`);
  return c.json({ error: 'unauthorized', error_description: message }, 401);
}

export async function mcpPost(c: Context<AppEnv>) {
  const auth = await userForBearer(c);
  if (!auth) return unauthorized(c);
  if (isHosted(c.env) && !auth.user.paid) {
    return c.json(rpcError(null, -32001, 'Your Minilytics plan is not active. Choose a plan in the dashboard to use the AI connector.'), 403);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(rpcError(null, -32700, 'Parse error'), 400);
  }
  const batch = Array.isArray(body);
  const msgs = (batch ? body : [body]) as RpcRequest[];
  if (!msgs.length || msgs.length > 20) return c.json(rpcError(null, -32600, 'Send 1 to 20 messages'), 400);
  const out = (await Promise.all(msgs.map((m) => handleRpc(c.env, auth.user, m, auth.token.grant_id)))).filter((r): r is object => r !== null);
  if (!out.length) return c.body(null, 202);
  return c.json(batch ? out : out[0]);
}

/** No server-to-client stream: everything is answered inline. */
export const mcpOther = (c: Context<AppEnv>) => {
  c.header('Allow', 'POST');
  return c.json(rpcError(null, -32000, 'Method not allowed. POST JSON-RPC messages to this URL.'), 405);
};
