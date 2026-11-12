import { isHosted, type User } from '../auth';
import type { Env, Site } from '../env';
import { UserError } from '../lib/errors';
import { PERIODS } from '../lib/time';
import type { Scope } from '../oauth';
import { learnDodoProducts, pendingPayments, recordApiPayment, recordGoal, rematchPayments } from '../payments';
import {
  createFunnel,
  createSite,
  deleteFunnel,
  deleteGoal,
  deleteSite,
  findSite,
  getFunnel,
  listFunnels,
  listSites,
  publicSite,
  renameGoal,
  rotateApiKey,
  updateFunnel,
  updateSite,
} from '../sites';
import {
  DIMENSIONS,
  FILTER_KEYS,
  breakdown,
  cleanFilters,
  ctxFor,
  customers,
  funnel,
  geo,
  overview,
  realtime,
  sparklines,
  visitorProfile,
  visitors,
} from '../stats';
import type { Schema } from './schema';

export interface ToolContext {
  env: Env;
  user: User;
  scopes: Set<Scope>;
  clientName: string;
  origin: string;
}

export interface Tool {
  name: string;
  title: string;
  description: string;
  scope: Scope;
  input: Schema & { type: 'object' };
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  run: (args: any, ctx: ToolContext) => Promise<unknown>;
}

// ---------- shared inputs

const SITE: Schema = { type: 'string', description: 'Website id (or its domain), from list_sites.' };

const RANGE: Record<string, Schema> = {
  period: {
    type: 'string',
    enum: PERIODS,
    description: 'Time range in the site’s timezone. Default 30d. "today", "7d", "30d" etc. include today; use "custom" with from/to for exact dates.',
  },
  from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'First day, YYYY-MM-DD (sets period to custom).' },
  to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Last day, inclusive, YYYY-MM-DD (sets period to custom).' },
  filters: {
    type: 'object',
    description:
      'Only count visits matching all of these, like clicking rows in the dashboard. E.g. {"source":"Google","country":"US"}. ' +
      'Values are exact labels as returned by get_breakdown (countries are ISO codes). An empty string matches "none". ' +
      '"page" keeps visits that viewed that path, "goal" visits that completed that goal.',
    properties: Object.fromEntries(FILTER_KEYS.map((k) => [k, { type: 'string' } as Schema])),
    additionalProperties: false,
  },
};

const LIMIT = (def: number, max: number): Schema => ({ type: 'integer', minimum: 1, maximum: max, default: def, description: `How many rows (default ${def}, max ${max}).` });

const STEP: Schema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['page', 'goal'], description: '"page" for a visited path, "goal" for a completed goal.' },
    value: { type: 'string', maxLength: 200, description: 'Page path (supports * wildcards, e.g. /blog/*) or exact goal name.' },
  },
  required: ['type', 'value'],
  additionalProperties: false,
};

const obj = (properties: Record<string, Schema>, required: string[] = []): Schema & { type: 'object' } => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const DESTROY = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

// ---------- helpers

async function site(ctx: ToolContext, idOrDomain: string): Promise<Site> {
  const s = await findSite(ctx.env, ctx.user, idOrDomain);
  if (!s) throw new UserError(404, `No website "${idOrDomain}" on this account. Call list_sites for the ids.`);
  return s;
}

function statsCtx(ctx: ToolContext, s: Site, a: { period?: string; from?: string; to?: string; granularity?: string; filters?: Record<string, string> }) {
  const period = a.from || a.to ? 'custom' : (a.period ?? '30d');
  return ctxFor(ctx.env.DB, s, { period, from: a.from, to: a.to, granularity: a.granularity }, cleanFilters(a.filters));
}

const ratio = (a: number, b: number) => (b ? Number((a / b).toFixed(4)) : null);

const search = <T extends Record<string, unknown>>(rows: T[], q: string | undefined, keys: string[]) => {
  if (!q) return rows;
  const needle = q.toLowerCase();
  return rows.filter((r) => keys.some((k) => String(r[k] ?? '').toLowerCase().includes(needle)));
};

function setupInfo(origin: string, s: Site, withKey: boolean) {
  return {
    dashboard_url: `${origin}/site/${s.id}`,
    settings_url: `${origin}/site/${s.id}/settings`,
    script_tag: `<script defer data-website-id="${s.id}" src="${origin}/js/script.js"></script>`,
    track_goal_in_html: '<button data-ml-goal="signup">Get started</button>',
    track_goal_in_js: "window.minilytics('goal', 'signup', { plan: 'pro' })",
    identify_in_js: "window.minilytics('identify', { email: user.email, name: user.name })",
    dodo_webhook_url: `${origin}/api/webhooks/dodo/${s.id}`,
    stripe_webhook_url: `${origin}/api/webhooks/stripe/${s.id}`,
    payments_api: `POST ${origin}/api/v1/payments (Authorization: Bearer <api_key>)`,
    goals_api: `POST ${origin}/api/v1/goals (Authorization: Bearer <api_key>)`,
    ...(withKey ? { api_key: s.api_key } : {}),
    payments_connected: { dodo: !!s.dodo_webhook_secret, stripe: !!s.stripe_webhook_secret, dodo_product_ids: s.dodo_product_ids ?? null },
  };
}

/** What the dashboard calls each breakdown column, so rows read naturally. */
function breakdownRows(dim: string, rows: Awaited<ReturnType<typeof breakdown>>) {
  const countKey = dim === 'goal' ? 'completions' : dim === 'exit_link' ? 'clicks' : 'pageviews';
  const extraKey = dim === 'source' ? 'referrer_domain' : dim === 'region' || dim === 'city' ? 'country' : null;
  return rows.map((r) => ({
    label: r.label,
    visitors: r.visitors,
    ...(r.pageviews !== undefined ? { [countKey]: r.pageviews } : {}),
    revenue: r.revenue,
    customers: r.customers,
    ...(extraKey && r.extra ? { [extraKey]: r.extra } : {}),
  }));
}

// ---------- tools

export const TOOLS: Tool[] = [
  // ----- account & sites
  {
    name: 'get_account',
    title: 'Account',
    description: 'Who this connection belongs to, what it may do (scopes), and the plan (hosted Minilytics). Call this first if unsure.',
    scope: 'read',
    input: obj({}),
    annotations: READ,
    run: async (_a, ctx) => ({
      mode: isHosted(ctx.env) ? 'hosted' : 'self-hosted',
      user: isHosted(ctx.env)
        ? { email: ctx.user.email, name: ctx.user.name, paid: ctx.user.paid, plan: ctx.user.plan, plan_status: ctx.user.plan_status, plan_until: ctx.user.plan_until }
        : { owner: true },
      connected_app: ctx.clientName,
      scopes: [...ctx.scopes],
      dashboard_url: ctx.origin,
      ...(isHosted(ctx.env) && !ctx.user.paid ? { note: `No active plan: adding websites needs one (${ctx.origin}/billing).` } : {}),
    }),
  },
  {
    name: 'list_sites',
    title: 'List websites',
    description:
      'Every website on the account with visitors in the last 24h, people online now, and visitors and revenue for `period` ' +
      '(like the all-websites page). Use the ids with the other tools.',
    scope: 'read',
    input: obj({
      period: { type: 'string', enum: ['24h', '7d', '30d', '90d'], description: 'Window for the totals (default 30d).' },
      include_series: { type: 'boolean', description: 'Also return a small visitors/revenue series per site (sparkline).' },
    }),
    annotations: READ,
    run: async (a, ctx) => {
      const period = a.period ?? '30d';
      const sites = await listSites(ctx.env, ctx.user);
      const sparks = new Map((await sparklines(ctx.env.DB, sites.map((s) => s.id), period)).map((s) => [s.id, s]));
      return {
        period,
        sites: sites.map((s) => {
          const sp = sparks.get(s.id);
          return {
            id: s.id,
            name: s.name,
            domain: s.domain,
            timezone: s.timezone,
            currency: s.currency,
            created_at: s.created_at,
            visitors_24h: s.visitors24h,
            online_now: s.online,
            visitors: sp?.visitors ?? 0,
            revenue: sp?.revenue ?? 0,
            ...(a.include_series ? { series: sp?.series ?? [] } : {}),
            dashboard_url: `${ctx.origin}/site/${s.id}`,
          };
        }),
      };
    },
  },
  {
    name: 'get_site',
    title: 'Website settings',
    description:
      'A website’s settings plus everything on its settings page: the tracking script tag, how to track goals, webhook URLs for Dodo/Stripe, ' +
      'the server-side payments and goals APIs, and which payment providers are connected. The API key is included only with write access.',
    scope: 'read',
    input: obj({ site: SITE }, ['site']),
    annotations: READ,
    run: async (a, ctx) => {
      const s = await site(ctx, a.site);
      const { api_key, owner_id, ...settings } = publicSite(s);
      return { ...settings, setup: setupInfo(ctx.origin, s, ctx.scopes.has('write')) };
    },
  },
  {
    name: 'create_site',
    title: 'Add website',
    description: 'Add a website to track. Returns its id and the script tag to install on every page.',
    scope: 'write',
    input: obj(
      {
        domain: { type: 'string', maxLength: 253, description: 'e.g. example.com (subdomains are counted too).' },
        name: { type: 'string', maxLength: 100, description: 'Display name (defaults to the domain).' },
        timezone: { type: 'string', description: 'IANA timezone for days and charts, e.g. Europe/Berlin (default UTC).' },
        currency: { type: 'string', pattern: '^[A-Za-z]{3}$', description: 'Revenue currency, ISO code (default USD).' },
      },
      ['domain'],
    ),
    annotations: WRITE,
    run: async (a, ctx) => {
      const { api_key, ...settings } = await createSite(ctx.env, ctx.user, a);
      return { ...settings, setup: setupInfo(ctx.origin, { ...settings, api_key }, true) };
    },
  },
  {
    name: 'update_site',
    title: 'Edit website',
    description:
      'Change a website’s name, domain, timezone or currency, connect payments by setting the Dodo or Stripe webhook signing secret ' +
      '(an empty string disconnects), or set which Dodo product ids belong to it. Only the fields given change.',
    scope: 'write',
    input: obj(
      {
        site: SITE,
        name: { type: 'string', maxLength: 100 },
        domain: { type: 'string', maxLength: 253 },
        timezone: { type: 'string', description: 'IANA timezone, e.g. America/New_York.' },
        currency: { type: 'string', pattern: '^[A-Za-z]{3}$' },
        dodo_webhook_secret: { type: 'string', description: 'Dodo webhook signing secret (whsec_...), "" to remove.' },
        stripe_webhook_secret: { type: 'string', description: 'Stripe webhook signing secret (whsec_...), "" to remove.' },
        dodo_product_ids: { type: 'string', description: 'Comma-separated Dodo product ids (pdt_...) sold on this site, "" for all.' },
      },
      ['site'],
    ),
    annotations: { ...WRITE, idempotentHint: true },
    run: async ({ site: id, ...changes }, ctx) => {
      const { api_key, owner_id, ...settings } = await updateSite(ctx.env, await site(ctx, id), changes);
      return settings;
    },
  },
  {
    name: 'rotate_api_key',
    title: 'Rotate API key',
    description: 'Replace the website’s API key (used by the server-side payments and goals APIs). The old key stops working immediately.',
    scope: 'write',
    input: obj({ site: SITE }, ['site']),
    annotations: DESTROY,
    run: async (a, ctx) => rotateApiKey(ctx.env, await site(ctx, a.site)),
  },
  {
    name: 'delete_site',
    title: 'Delete website',
    description:
      'Permanently delete a website and ALL its data (visits, events, payments, funnels). This cannot be undone. ' +
      'Only do this when the user explicitly asked; pass the site’s domain again as confirm_domain.',
    scope: 'write',
    input: obj({ site: SITE, confirm_domain: { type: 'string', description: 'The website’s domain, exactly, to confirm.' } }, ['site', 'confirm_domain']),
    annotations: DESTROY,
    run: async (a, ctx) => {
      const s = await site(ctx, a.site);
      if (a.confirm_domain.trim().toLowerCase() !== s.domain) {
        throw new UserError(400, `confirm_domain must be "${s.domain}" to delete this website.`);
      }
      await deleteSite(ctx.env, s);
      return { ok: true, deleted: { id: s.id, domain: s.domain } };
    },
  },

  // ----- analytics
  {
    name: 'get_overview',
    title: 'Overview',
    description:
      'The headline numbers for a period, compared with the period before it: visitors, visits, pageviews, bounce rate, session time, revenue, ' +
      'payments, customers, conversion rate and revenue per visitor, plus people online now and a time series for the chart.',
    scope: 'read',
    input: obj(
      {
        site: SITE,
        ...RANGE,
        granularity: { type: 'string', enum: ['hour', 'day', 'week', 'month'], description: 'Series bucket size (chosen automatically if omitted).' },
        include_series: { type: 'boolean', description: 'Include the time series (default true).' },
      },
      ['site'],
    ),
    annotations: READ,
    run: async (a, ctx) => {
      const s = await site(ctx, a.site);
      const sc = statsCtx(ctx, s, a);
      const o = await overview(sc);
      const span = o.range.to - o.range.from;
      const change = Object.fromEntries(
        Object.entries(o.current).map(([k, v]) => {
          const prev = (o.previous as Record<string, number>)[k];
          return [k, prev ? Number(((v - prev) / Math.abs(prev)).toFixed(4)) : null];
        }),
      );
      return {
        site: { id: s.id, domain: s.domain, timezone: s.timezone },
        currency: o.currency,
        range: o.range,
        previous_range: { from: o.range.from - span, to: o.range.from },
        filters: sc.filters,
        online_now: o.online,
        current: o.current,
        previous: o.previous,
        change_vs_previous: change,
        ...(a.include_series === false ? {} : { series: o.series }),
      };
    },
  },
  {
    name: 'get_breakdown',
    title: 'Breakdown',
    description:
      'Visitors, revenue and customers grouped by one dimension, like each dashboard panel. Dimensions: ' +
      'channel, source, referrer, campaign (utm_campaign), keyword (utm_term), utm_source, utm_medium, utm_content, ref; ' +
      'page, entry_page, exit_page, exit_link (outbound clicks), hostname; country (ISO code), region, city; browser, os, device; goal. ' +
      'Revenue is credited to the visit that brought the paying visitor.',
    scope: 'read',
    input: obj({ site: SITE, dimension: { type: 'string', enum: DIMENSIONS }, ...RANGE, limit: LIMIT(20, 500) }, ['site', 'dimension']),
    annotations: READ,
    run: async (a, ctx) => {
      const s = await site(ctx, a.site);
      const sc = statsCtx(ctx, s, a);
      const limit = a.limit ?? 20;
      // breakdown() appends revenue-only labels after the top rows; keep it a true top `limit`.
      const rows = (await breakdown(sc, a.dimension, limit)).slice(0, limit);
      return { dimension: a.dimension, currency: s.currency, range: sc.range, filters: sc.filters, rows: breakdownRows(a.dimension, rows) };
    },
  },
  {
    name: 'get_visitor_map',
    title: 'Visitor map',
    description: 'Where visitors were in the period, one point per city with coordinates, visitors and revenue (the dot map).',
    scope: 'read',
    input: obj({ site: SITE, ...RANGE, limit: LIMIT(50, 500) }, ['site']),
    annotations: READ,
    run: async (a, ctx) => {
      const s = await site(ctx, a.site);
      const sc = statsCtx(ctx, s, a);
      return { currency: s.currency, range: sc.range, cities: await geo(sc, a.limit ?? 50) };
    },
  },
  {
    name: 'get_realtime',
    title: 'Live view',
    description: 'Who is on the website right now (active in the last 5 minutes: page, source, location) and a feed of pageviews, goals and payments from the last 30 minutes.',
    scope: 'read',
    input: obj({ site: SITE, limit: LIMIT(50, 500) }, ['site']),
    annotations: READ,
    run: async (a, ctx) => {
      const r = await realtime(ctx.env.DB, await site(ctx, a.site));
      const limit = a.limit ?? 50;
      return { now: r.now, currency: r.currency, online_now: r.visitors.length, visitors: r.visitors.slice(0, limit), feed: r.feed.slice(0, limit) };
    },
  },
  {
    name: 'list_customers',
    title: 'Customers (journey)',
    description:
      'Payments in the period, newest first, each with who paid and the journey that led there: source, campaign, landing page, location, device, ' +
      'number of visits before paying, and how the payment was matched to the visitor.',
    scope: 'read',
    input: obj({ site: SITE, ...RANGE, search: { type: 'string', description: 'Only rows whose name, email or source contains this.' }, limit: LIMIT(50, 200) }, ['site']),
    annotations: READ,
    run: async (a, ctx) => {
      const s = await site(ctx, a.site);
      const sc = statsCtx(ctx, s, a);
      const rows = search(await customers(sc), a.search, ['name', 'email', 'pay_name', 'pay_email', 'source', 'utm_campaign']);
      return { currency: s.currency, range: sc.range, total: rows.length, customers: rows.slice(0, a.limit ?? 50) };
    },
  },
  {
    name: 'list_visitors',
    title: 'Visitors (users)',
    description: 'Recent visitors in the period, most recent first: visits, pageviews, time on site, source, location, device, identity (if identified) and total spent.',
    scope: 'read',
    input: obj({ site: SITE, ...RANGE, search: { type: 'string', description: 'Only rows whose name, email, source, country or city contains this.' }, limit: LIMIT(50, 200) }, ['site']),
    annotations: READ,
    run: async (a, ctx) => {
      const s = await site(ctx, a.site);
      const sc = statsCtx(ctx, s, a);
      const rows = search(await visitors(sc), a.search, ['name', 'email', 'source', 'country', 'city', 'visitor_id']);
      return { currency: s.currency, range: sc.range, total: rows.length, visitors: rows.slice(0, a.limit ?? 50) };
    },
  },
  {
    name: 'get_visitor',
    title: 'Visitor profile',
    description: 'Everything one visitor did: identity, every visit with its source, the pages, goals and outbound clicks in order, and their payments.',
    scope: 'read',
    input: obj({ site: SITE, visitor_id: { type: 'string' }, events_limit: LIMIT(200, 1000) }, ['site', 'visitor_id']),
    annotations: READ,
    run: async (a, ctx) => {
      const p = await visitorProfile(ctx.env.DB, await site(ctx, a.site), a.visitor_id);
      if (!p.visitor && !p.sessions.length) throw new UserError(404, 'visitor not found');
      return { ...p, events: p.events.slice(0, a.events_limit ?? 200) };
    },
  },

  // ----- goals
  {
    name: 'list_goals',
    title: 'Goals',
    description:
      'Goals completed in the period: visitors who completed each, completions, conversion rate (share of all visitors) and revenue from those visitors. ' +
      'A goal exists once the site records it, via data-ml-goal="name" on an element, window.minilytics(\'goal\', \'name\') or record_goal.',
    scope: 'read',
    input: obj({ site: SITE, ...RANGE, limit: LIMIT(50, 500) }, ['site']),
    annotations: READ,
    run: async (a, ctx) => {
      const s = await site(ctx, a.site);
      const sc = statsCtx(ctx, s, a);
      const limit = a.limit ?? 50;
      const [rows, o] = await Promise.all([breakdown(sc, 'goal', limit).then((r) => r.slice(0, limit)), overview(sc)]);
      const total = o.current.visitors;
      return {
        currency: s.currency,
        range: sc.range,
        total_visitors: total,
        goals: rows.map((r) => ({ name: r.label, visitors: r.visitors, completions: r.pageviews ?? 0, conversion_rate: ratio(r.visitors, total), revenue: r.revenue })),
        how_to_add_goals: setupInfo(ctx.origin, s, false).track_goal_in_html,
      };
    },
  },
  {
    name: 'record_goal',
    title: 'Record goal',
    description:
      'Record a goal completion for an existing visitor (like the server-side goals API), e.g. "signup" after your backend creates an account. ' +
      'It lands on the visitor’s latest visit. New goal names appear in list_goals as soon as they are recorded.',
    scope: 'write',
    input: obj(
      {
        site: SITE,
        visitor_id: { type: 'string', description: 'The visitor (ml_vid cookie value, or an id from list_visitors).' },
        name: { type: 'string', maxLength: 64, description: 'Goal name, e.g. signup.' },
        props: { type: 'object', description: 'Optional details, e.g. {"plan":"pro"}.' },
      },
      ['site', 'visitor_id', 'name'],
    ),
    annotations: WRITE,
    run: async (a, ctx) => recordGoal(ctx.env.DB, await site(ctx, a.site), a),
  },
  {
    name: 'rename_goal',
    title: 'Rename goal',
    description: 'Rename a goal in all its recorded completions and in funnel steps that use it. Update the site’s tracking code too, or new completions keep the old name.',
    scope: 'write',
    input: obj({ site: SITE, name: { type: 'string', description: 'Current goal name.' }, new_name: { type: 'string', maxLength: 64 } }, ['site', 'name', 'new_name']),
    annotations: { ...WRITE, idempotentHint: true },
    run: async (a, ctx) => renameGoal(ctx.env.DB, await site(ctx, a.site), a.name, a.new_name),
  },
  {
    name: 'delete_goal',
    title: 'Delete goal',
    description:
      'Permanently delete every recorded completion of a goal (e.g. test data or a goal you no longer track). Visits and pageviews stay. ' +
      'Cannot be undone. If the site still tracks it, it reappears with new completions.',
    scope: 'write',
    input: obj({ site: SITE, name: { type: 'string', description: 'Exact goal name.' } }, ['site', 'name']),
    annotations: DESTROY,
    run: async (a, ctx) => deleteGoal(ctx.env.DB, await site(ctx, a.site), a.name),
  },

  // ----- funnels
  {
    name: 'list_funnels',
    title: 'Funnels',
    description: 'The website’s saved funnels and their steps. Use get_funnel_stats for the numbers.',
    scope: 'read',
    input: obj({ site: SITE }, ['site']),
    annotations: READ,
    run: async (a, ctx) => ({ funnels: await listFunnels(ctx.env.DB, await site(ctx, a.site)) }),
  },
  {
    name: 'get_funnel_stats',
    title: 'Funnel results',
    description:
      'How many visitors completed each funnel step in order within the period, with conversion from the first step, from the previous step, and drop-off.',
    scope: 'read',
    input: obj({ site: SITE, funnel_id: { type: 'string' }, ...RANGE }, ['site', 'funnel_id']),
    annotations: READ,
    run: async (a, ctx) => {
      const s = await site(ctx, a.site);
      const f = await getFunnel(ctx.env.DB, s, a.funnel_id);
      if (!f) throw new UserError(404, 'funnel not found (see list_funnels)');
      const sc = statsCtx(ctx, s, a);
      const steps = await funnel(sc, f.steps);
      const top = steps[0]?.visitors ?? 0;
      return {
        funnel: { id: f.id, name: f.name },
        range: sc.range,
        filters: sc.filters,
        overall_conversion: ratio(steps[steps.length - 1]?.visitors ?? 0, top),
        steps: steps.map((st, i) => {
          const prev = i ? steps[i - 1].visitors : st.visitors;
          return {
            step: i + 1,
            type: st.type,
            value: st.value,
            visitors: st.visitors,
            conversion_from_start: ratio(st.visitors, top),
            conversion_from_previous: i ? ratio(st.visitors, prev) : null,
            drop_off: i ? prev - st.visitors : null,
          };
        }),
      };
    },
  },
  {
    name: 'create_funnel',
    title: 'Create funnel',
    description: 'Save a funnel: 2 to 10 ordered steps, each a page path (with * wildcards) or a goal name. Visitors count for a step only after completing the steps before it.',
    scope: 'write',
    input: obj(
      { site: SITE, name: { type: 'string', maxLength: 100 }, steps: { type: 'array', items: STEP, minItems: 2, maxItems: 10 } },
      ['site', 'name', 'steps'],
    ),
    annotations: WRITE,
    run: async (a, ctx) => createFunnel(ctx.env.DB, await site(ctx, a.site), a),
  },
  {
    name: 'update_funnel',
    title: 'Edit funnel',
    description: 'Rename a funnel and/or replace its steps.',
    scope: 'write',
    input: obj(
      {
        site: SITE,
        funnel_id: { type: 'string' },
        name: { type: 'string', maxLength: 100 },
        steps: { type: 'array', items: STEP, minItems: 2, maxItems: 10, description: 'The full new list of steps.' },
      },
      ['site', 'funnel_id'],
    ),
    annotations: { ...WRITE, idempotentHint: true },
    run: async (a, ctx) => updateFunnel(ctx.env.DB, await site(ctx, a.site), a.funnel_id, a),
  },
  {
    name: 'delete_funnel',
    title: 'Delete funnel',
    description: 'Delete a saved funnel. Only the definition goes; no visit data is touched.',
    scope: 'write',
    input: obj({ site: SITE, funnel_id: { type: 'string' } }, ['site', 'funnel_id']),
    annotations: { ...DESTROY, idempotentHint: true },
    run: async (a, ctx) => {
      const r = await deleteFunnel(ctx.env.DB, await site(ctx, a.site), a.funnel_id);
      if (!r.deleted) throw new UserError(404, 'funnel not found (see list_funnels)');
      return r;
    },
  },

  // ----- payments
  {
    name: 'record_payment',
    title: 'Record payment',
    description:
      'Record a payment or refund from any provider (like the server-side payments API). Pass visitor_id when known; otherwise it is matched by ' +
      'customer, email or timing. Recording the same transaction_id again updates it instead of counting twice.',
    scope: 'write',
    input: obj(
      {
        site: SITE,
        transaction_id: { type: 'string', description: 'Your unique id for the payment.' },
        amount: { type: 'number', description: 'In major units, e.g. 29.99.' },
        currency: { type: 'string', pattern: '^[A-Za-z]{3}$', description: 'Defaults to the site currency.' },
        visitor_id: { type: 'string' },
        session_id: { type: 'string' },
        customer_id: { type: 'string' },
        email: { type: 'string' },
        name: { type: 'string' },
        refunded: { type: 'boolean', description: 'true records a refund of this transaction.' },
        renewal: { type: 'boolean', description: 'true for a subscription renewal (not a new customer).' },
        timestamp: { type: 'string', description: 'ISO 8601 time of the payment (default now).' },
      },
      ['site', 'transaction_id', 'amount'],
    ),
    annotations: { ...WRITE, idempotentHint: true },
    run: async (a, ctx) => recordApiPayment(ctx.env.DB, await site(ctx, a.site), a),
  },
  {
    name: 'list_pending_payments',
    title: 'Unplaced Dodo payments',
    description:
      'Dodo payments that could not be placed on a website yet (the Dodo account serves several sites and the product is unknown), grouped by product. ' +
      'Use assign_dodo_product to count them on this site.',
    scope: 'read',
    input: obj({ site: SITE }, ['site']),
    annotations: READ,
    run: async (a, ctx) => ({ products: await pendingPayments(ctx.env.DB, await site(ctx, a.site)) }),
  },
  {
    name: 'assign_dodo_product',
    title: 'Assign Dodo product',
    description: 'Mark a Dodo product (pdt_...) as sold on this website, which counts its pending payments here and places future ones automatically.',
    scope: 'write',
    input: obj({ site: SITE, product_id: { type: 'string', pattern: '^pdt_[\\w-]+$' } }, ['site', 'product_id']),
    annotations: { ...WRITE, idempotentHint: true },
    run: async (a, ctx) => {
      await learnDodoProducts(ctx.env.DB, await site(ctx, a.site), [a.product_id]);
      return { ok: true };
    },
  },
  {
    name: 'rematch_payments',
    title: 'Re-match payments',
    description: 'Try again to link payments that have no visitor yet to the visitor who paid (by return page, customer, email or checkout timing). Reports why each one did or didn’t match.',
    scope: 'write',
    input: obj({ site: SITE }, ['site']),
    annotations: { ...WRITE, idempotentHint: true },
    run: async (a, ctx) => rematchPayments(ctx.env.DB, await site(ctx, a.site)),
  },
];
