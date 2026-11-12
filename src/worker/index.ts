import { Hono, type Context, type Next } from 'hono';
import { cors } from 'hono/cors';
import { handleEvent } from './collect';
import type { AppEnv, Site } from './env';
import { clearSession, currentUser, googleCallback, googleStart, isHosted, requireUser, setSession, siteAccessSql } from './auth';
import { billingWebhook, checkout, planInfo } from './billing';
import { passwordsMatch } from './lib/crypto';
import { UserError } from './lib/errors';
import {
  handleDodoWebhook,
  handleGoalApi,
  handlePaymentApi,
  handleStripeWebhook,
  learnDodoProducts,
  pendingPayments,
  rematchPayments,
} from './payments';
import { mcpHandler } from './mcp';
import {
  authorizationServerMetadata,
  authorizeDecision,
  authorizePage,
  deleteGrant,
  listGrants,
  protectedResourceMetadata,
  register,
  revoke,
  token,
} from './oauth';
import { rememberOwnerDevice } from './owner';
import {
  createFunnel,
  createSite,
  deleteFunnel,
  deleteSite,
  getFunnel,
  listFunnels,
  listSites,
  publicSite,
  rotateApiKey,
  updateSite,
} from './sites';
import { breakdown, customers, funnel, geo, makeCtx, overview, realtime, sparklines, visitorProfile, visitors, type FunnelStep } from './stats';

const app = new Hono<AppEnv>();
const MAX_FAILURES = 10;
const LOCKOUT_MS = 15 * 60_000;

// ---------- public: tracking, webhooks, server-side API

app.use('/api/event', cors({ origin: '*', allowMethods: ['POST', 'OPTIONS'], maxAge: 86400 }));
app.post('/api/event', handleEvent);
app.post('/api/webhooks/dodo/:siteId', handleDodoWebhook);
app.post('/api/webhooks/stripe/:siteId', handleStripeWebhook);
app.post('/api/v1/payments', handlePaymentApi);
app.post('/api/v1/goals', handleGoalApi);

// ---------- AI agents: MCP server + the OAuth that lets agents connect to it

const agentCors = cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type', 'Mcp-Protocol-Version', 'Mcp-Session-Id', 'Last-Event-ID'],
  exposeHeaders: ['WWW-Authenticate', 'Mcp-Session-Id'],
  maxAge: 86400,
});
for (const path of ['/mcp', '/oauth/token', '/oauth/register', '/oauth/revoke', '/.well-known/*']) app.use(path, agentCors);

app.get('/.well-known/oauth-protected-resource', protectedResourceMetadata);
app.get('/.well-known/oauth-protected-resource/mcp', protectedResourceMetadata);
app.get('/.well-known/oauth-authorization-server', authorizationServerMetadata);
app.post('/oauth/register', register);
app.get('/oauth/authorize', authorizePage);
app.post('/oauth/authorize', authorizeDecision);
app.post('/oauth/token', token);
app.post('/oauth/revoke', revoke);
app.all('/mcp', mcpHandler);

// ---------- login

app.post('/api/auth/login', async (c) => {
  if (isHosted(c.env)) return c.json({ error: 'Use "Continue with Google".' }, 400);
  if (!c.env.ADMIN_PASSWORD || !c.env.SESSION_SECRET) {
    return c.json({ error: 'Set ADMIN_PASSWORD and SESSION_SECRET (see README).' }, 500);
  }
  // Lock an IP out after too many wrong passwords, so a public dashboard can't be brute-forced.
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const now = Date.now();
  const recent = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND ts > ?')
    .bind(ip, now - LOCKOUT_MS)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_FAILURES) {
    return c.json({ error: 'Too many wrong attempts. Try again in 15 minutes.' }, 429);
  }
  const { password } = await c.req.json<{ password?: string }>().catch(() => ({ password: undefined }));
  if (!password || !passwordsMatch(password, c.env.ADMIN_PASSWORD)) {
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO login_failures (ip, ts) VALUES (?, ?)').bind(ip, now),
      c.env.DB.prepare('DELETE FROM login_failures WHERE ts < ?').bind(now - LOCKOUT_MS),
    ]);
    await new Promise((r) => setTimeout(r, 500));
    return c.json({ error: 'Wrong password' }, 401);
  }
  await c.env.DB.prepare('DELETE FROM login_failures WHERE ip = ?').bind(ip).run();
  await setSession(c, 'admin');
  return c.json({ ok: true });
});

app.get('/api/auth/google', googleStart);
app.get('/api/auth/google/callback', googleCallback);

app.post('/api/auth/logout', (c) => {
  clearSession(c);
  return c.json({ ok: true });
});

app.get('/api/auth/me', async (c) => {
  const user = await currentUser(c);
  if (user) c.executionCtx.waitUntil(rememberOwnerDevice(c, user).catch(() => {}));
  return c.json({ loggedIn: !!user, hosted: isHosted(c.env), user });
});

// ---------- billing (hosted mode)

app.get('/api/public/plan', async (c) => c.json(await planInfo(c.env)));
app.post('/api/billing/webhook', billingWebhook);
app.get('/api/billing/checkout', requireUser, checkout);

// ---------- dashboard API (login required)

app.use('/api/oauth/*', requireUser);
app.get('/api/oauth/grants', listGrants);
app.delete('/api/oauth/grants/:gid', deleteGrant);

app.use('/api/sites', requireUser);
app.use('/api/sites/*', requireUser);

const loadSite = async (c: Context<AppEnv>, next: Next) => {
  const access = siteAccessSql(c.env, c.get('user'));
  const site = await c.env.DB.prepare(`SELECT s.* FROM sites s WHERE s.id = ? AND ${access.sql}`)
    .bind(c.req.param('id'), ...access.params)
    .first<Site>();
  if (!site) return c.json({ error: 'site not found' }, 404);
  c.set('site', site);
  await next();
};
app.use('/api/sites/:id', loadSite);
app.use('/api/sites/:id/*', loadSite);

/** Turn a UserError from the shared site/funnel code into the JSON error the dashboard expects. */
async function handled(c: Context<AppEnv>, run: () => Promise<unknown>) {
  try {
    return c.json(await run());
  } catch (e) {
    if (e instanceof UserError) return c.json({ error: e.message }, e.status);
    throw e;
  }
}

app.get('/api/sites', async (c) => c.json(await listSites(c.env, c.get('user'))));

// Every site's totals and sparkline for the all-websites view.
app.use('/api/sites-overview', requireUser);
app.get('/api/sites-overview', async (c) => {
  const access = siteAccessSql(c.env, c.get('user'));
  const rows = await c.env.DB.prepare(`SELECT s.id FROM sites s WHERE ${access.sql}`).bind(...access.params).all<{ id: string }>();
  return c.json(await sparklines(c.env.DB, rows.results.map((r) => r.id), c.req.query('period') ?? '30d'));
});

app.post('/api/sites', async (c) => {
  const b = await c.req.json<Partial<Site>>().catch(() => ({}) as Partial<Site>);
  return handled(c, () => createSite(c.env, c.get('user'), b));
});

app.get('/api/sites/:id', (c) => c.json(publicSite(c.get('site'))));

app.patch('/api/sites/:id', async (c) => {
  const b = await c.req.json<Partial<Site>>().catch(() => ({}) as Partial<Site>);
  return handled(c, () => updateSite(c.env, c.get('site'), b));
});

app.post('/api/sites/:id/rotate-key', async (c) => c.json(await rotateApiKey(c.env, c.get('site'))));

app.delete('/api/sites/:id', async (c) => c.json(await deleteSite(c.env, c.get('site'))));

// ---------- stats

app.get('/api/sites/:id/overview', async (c) => c.json(await overview(makeCtx(c))));

app.get('/api/sites/:id/breakdown', async (c) => {
  try {
    return c.json(await breakdown(makeCtx(c), c.req.query('dim') ?? 'source', Number(c.req.query('limit')) || 100));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

app.get('/api/sites/:id/geo', async (c) => c.json(await geo(makeCtx(c))));

// Dodo payments that couldn't be placed on a site yet, grouped by product.
app.get('/api/sites/:id/pending-payments', async (c) => c.json(await pendingPayments(c.env.DB, c.get('site'))));
app.post('/api/sites/:id/pending-payments', async (c) => {
  const b = await c.req.json<{ product_id?: string }>().catch(() => ({}) as { product_id?: string });
  if (!b.product_id || !/^pdt_[\w-]+$/.test(b.product_id)) return c.json({ error: 'product_id is required' }, 400);
  await learnDodoProducts(c.env.DB, c.get('site'), [b.product_id]);
  return c.json({ ok: true });
});
app.post('/api/sites/:id/rematch', async (c) => c.json(await rematchPayments(c.env.DB, c.get('site'))));
app.get('/api/sites/:id/realtime', async (c) => c.json(await realtime(c.env.DB, c.get('site'))));
app.get('/api/sites/:id/customers', async (c) => c.json(await customers(makeCtx(c))));
app.get('/api/sites/:id/visitors', async (c) => c.json(await visitors(makeCtx(c))));
app.get('/api/sites/:id/visitors/:vid', async (c) =>
  c.json(await visitorProfile(c.env.DB, c.get('site'), c.req.param('vid'))),
);

app.get('/api/sites/:id/funnels', async (c) => c.json(await listFunnels(c.env.DB, c.get('site'))));

app.post('/api/sites/:id/funnels', async (c) => {
  const b = await c.req.json<{ name?: string; steps?: FunnelStep[] }>().catch(() => ({}) as { name?: string; steps?: FunnelStep[] });
  return handled(c, () => createFunnel(c.env.DB, c.get('site'), b));
});

app.delete('/api/sites/:id/funnels/:fid', async (c) => {
  await deleteFunnel(c.env.DB, c.get('site'), c.req.param('fid'));
  return c.json({ ok: true });
});

app.get('/api/sites/:id/funnels/:fid/stats', async (c) => {
  const f = await getFunnel(c.env.DB, c.get('site'), c.req.param('fid'));
  if (!f) return c.json({ error: 'funnel not found' }, 404);
  return c.json(await funnel(makeCtx(c), f.steps));
});

app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));

// Static files are served before the Worker runs. What reaches here is a client-side route, or a page that doesn't exist.
const PUBLIC_PAGES = /^\/(terms|privacy|refund)\/?$/;
const APP_PAGES = /^\/(billing(\/.*)?|site\/[\w-]+(\/settings)?\/?)$/;

app.all('*', async (c) => {
  const path = new URL(c.req.url).pathname;
  const index = await c.env.ASSETS.fetch(new URL('/', c.req.url));
  const headers = new Headers(index.headers);
  // Signed-in pages are private and unknown paths shouldn't rank: keep both out of search results.
  if (!PUBLIC_PAGES.test(path)) headers.set('X-Robots-Tag', 'noindex');
  const status = PUBLIC_PAGES.test(path) || APP_PAGES.test(path) ? 200 : 404;
  return new Response(index.body, { status, headers });
});

export default app;
