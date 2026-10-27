import { Hono, type Context, type Next } from 'hono';
import { cors } from 'hono/cors';
import { handleEvent } from './collect';
import { forgetSite, type AppEnv, type Site } from './env';
import { clearSession, currentUser, googleCallback, googleStart, isHosted, requireUser, setSession, siteAccessSql } from './auth';
import { billingWebhook, checkout, planInfo } from './billing';
import { passwordsMatch, randomId } from './lib/crypto';
import { handleDodoWebhook, handleGoalApi, handlePaymentApi, handleStripeWebhook, learnDodoProducts, rematchPayments } from './payments';
import { handleRazorpayWebhook } from './razorpay';
import { breakdown, customers, funnel, makeCtx, overview, realtime, visitorProfile, visitors, type FunnelStep } from './stats';

const app = new Hono<AppEnv>();
const MAX_FAILURES = 10;
const LOCKOUT_MS = 15 * 60_000;

// ---------- public: tracking, webhooks, server-side API

app.use('/api/event', cors({ origin: '*', allowMethods: ['POST', 'OPTIONS'], maxAge: 86400 }));
app.post('/api/event', handleEvent);
app.post('/api/webhooks/dodo/:siteId', handleDodoWebhook);
app.post('/api/webhooks/stripe/:siteId', handleStripeWebhook);
app.post('/api/webhooks/razorpay/:siteId', handleRazorpayWebhook);
app.post('/api/v1/payments', handlePaymentApi);
app.post('/api/v1/goals', handleGoalApi);

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
  return c.json({ loggedIn: !!user, hosted: isHosted(c.env), user });
});

// ---------- billing (hosted mode)

app.get('/api/public/plan', async (c) => c.json(await planInfo(c.env)));
app.post('/api/billing/webhook', billingWebhook);
app.get('/api/billing/checkout', requireUser, checkout);

// ---------- dashboard API (login required)

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

function cleanDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '');
}

function validTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const mask = (secret: string | null | undefined) => (secret ? '••••••••' : null);
const publicSite = (s: Site) => ({
  ...s,
  dodo_webhook_secret: mask(s.dodo_webhook_secret),
  stripe_webhook_secret: mask(s.stripe_webhook_secret),
  razorpay_webhook_secret: mask(s.razorpay_webhook_secret),
});

app.get('/api/sites', async (c) => {
  const now = Date.now();
  const access = siteAccessSql(c.env, c.get('user'));
  const [sites, stats] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT s.* FROM sites s WHERE ${access.sql} ORDER BY s.created_at`).bind(...access.params),
    c.env.DB.prepare(
      `SELECT site_id, COUNT(DISTINCT visitor_id) AS visitors,
              COUNT(DISTINCT CASE WHEN last_seen_at > ? THEN visitor_id END) AS online
       FROM sessions WHERE started_at > ? GROUP BY site_id`,
    ).bind(now - 5 * 60_000, now - 86_400_000),
  ]);
  const by = new Map((stats.results as any[]).map((r) => [r.site_id, r]));
  return c.json(
    (sites.results as unknown as Site[]).map((s) => ({
      ...publicSite(s),
      visitors24h: by.get(s.id)?.visitors ?? 0,
      online: by.get(s.id)?.online ?? 0,
    })),
  );
});

app.post('/api/sites', async (c) => {
  const user = c.get('user');
  if (isHosted(c.env) && !user.paid) return c.json({ error: 'Choose a plan to add websites.' }, 402);
  const b = await c.req.json<Partial<Site>>().catch(() => ({}) as Partial<Site>);
  const domain = cleanDomain(b.domain ?? '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return c.json({ error: 'Enter a domain like example.com' }, 400);
  const tz = b.timezone && validTimezone(b.timezone) ? b.timezone : 'UTC';
  const site: Site = {
    id: randomId(8),
    name: (b.name || domain).slice(0, 100),
    domain,
    timezone: tz,
    currency: (b.currency || 'USD').toUpperCase().slice(0, 3),
    api_key: 'ml_' + randomId(16),
    dodo_webhook_secret: null,
    created_at: Date.now(),
  };
  await c.env.DB.prepare(
    'INSERT INTO sites (id, name, domain, timezone, currency, api_key, dodo_webhook_secret, created_at, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(site.id, site.name, site.domain, site.timezone, site.currency, site.api_key, null, site.created_at, isHosted(c.env) ? user.id : null)
    .run();
  return c.json(publicSite(site));
});

app.get('/api/sites/:id', (c) => c.json(publicSite(c.get('site'))));

app.patch('/api/sites/:id', async (c) => {
  const site = c.get('site');
  const b = await c.req.json<Partial<Site>>().catch(() => ({}) as Partial<Site>);
  const next = { ...site };
  if (typeof b.name === 'string' && b.name.trim()) next.name = b.name.trim().slice(0, 100);
  if (typeof b.domain === 'string') {
    const d = cleanDomain(b.domain);
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return c.json({ error: 'Enter a domain like example.com' }, 400);
    next.domain = d;
  }
  if (typeof b.timezone === 'string') {
    if (!validTimezone(b.timezone)) return c.json({ error: 'Unknown timezone' }, 400);
    next.timezone = b.timezone;
  }
  if (typeof b.currency === 'string' && /^[A-Za-z]{3}$/.test(b.currency)) next.currency = b.currency.toUpperCase();
  if (typeof b.dodo_webhook_secret === 'string' && !b.dodo_webhook_secret.includes('•')) {
    next.dodo_webhook_secret = b.dodo_webhook_secret.trim() || null;
  }
  if (typeof b.stripe_webhook_secret === 'string' && !b.stripe_webhook_secret.includes('•')) {
    next.stripe_webhook_secret = b.stripe_webhook_secret.trim() || null;
  }
  if (typeof b.razorpay_webhook_secret === 'string' && !b.razorpay_webhook_secret.includes('•')) {
    next.razorpay_webhook_secret = b.razorpay_webhook_secret.trim() || null;
  }
  if (typeof b.razorpay_filter_ids === 'string') {
    const ids = b.razorpay_filter_ids.split(/[\s,]+/).filter((x) => /^(plink|plan)_[\w-]+$/.test(x));
    next.razorpay_filter_ids = ids.join(',') || null;
  }
  if (typeof b.dodo_product_ids === 'string') {
    const ids = b.dodo_product_ids.split(/[\s,]+/).filter((x) => /^pdt_[\w-]+$/.test(x));
    next.dodo_product_ids = ids.join(',') || null;
  }
  await c.env.DB.prepare(
    `UPDATE sites SET name = ?, domain = ?, timezone = ?, currency = ?, dodo_webhook_secret = ?, dodo_product_ids = ?, stripe_webhook_secret = ?,
       razorpay_webhook_secret = ?, razorpay_filter_ids = ? WHERE id = ?`,
  )
    .bind(
      next.name,
      next.domain,
      next.timezone,
      next.currency,
      next.dodo_webhook_secret,
      next.dodo_product_ids ?? null,
      next.stripe_webhook_secret ?? null,
      next.razorpay_webhook_secret ?? null,
      next.razorpay_filter_ids ?? null,
      site.id,
    )
    .run();
  forgetSite(site.id);
  return c.json(publicSite(next));
});

app.post('/api/sites/:id/rotate-key', async (c) => {
  const key = 'ml_' + randomId(16);
  await c.env.DB.prepare('UPDATE sites SET api_key = ? WHERE id = ?').bind(key, c.get('site').id).run();
  return c.json({ api_key: key });
});

app.delete('/api/sites/:id', async (c) => {
  const id = c.get('site').id;
  await c.env.DB.batch(
    ['events', 'sessions', 'visitors', 'payments', 'funnels'].map((t) =>
      c.env.DB.prepare(`DELETE FROM ${t} WHERE site_id = ?`).bind(id),
    ).concat(c.env.DB.prepare('DELETE FROM sites WHERE id = ?').bind(id)),
  );
  forgetSite(id);
  return c.json({ ok: true });
});

// ---------- stats

app.get('/api/sites/:id/overview', async (c) => c.json(await overview(makeCtx(c))));

app.get('/api/sites/:id/breakdown', async (c) => {
  try {
    return c.json(await breakdown(makeCtx(c), c.req.query('dim') ?? 'source', Number(c.req.query('limit')) || 100));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

// Dodo payments that couldn't be placed on a site yet, grouped by product.
app.get('/api/sites/:id/pending-payments', async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT product_id, COUNT(*) AS count, SUM(json_extract(payload, '$.amount')) AS amount, MAX(json_extract(payload, '$.currency')) AS currency
     FROM pending_payments WHERE site_id = ? GROUP BY product_id ORDER BY MAX(ts) DESC`,
  )
    .bind(c.get('site').id)
    .all();
  return c.json(r.results);
});
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

app.get('/api/sites/:id/funnels', async (c) => {
  const res = await c.env.DB.prepare('SELECT * FROM funnels WHERE site_id = ? ORDER BY created_at').bind(c.get('site').id).all();
  return c.json(res.results.map((f: any) => ({ ...f, steps: JSON.parse(f.steps) })));
});

app.post('/api/sites/:id/funnels', async (c) => {
  const b = await c.req.json<{ name?: string; steps?: FunnelStep[] }>().catch(() => ({}) as { name?: string; steps?: FunnelStep[] });
  const steps = (b.steps ?? [])
    .filter((s) => (s.type === 'page' || s.type === 'goal') && typeof s.value === 'string' && s.value.trim())
    .slice(0, 10)
    .map((s) => ({ type: s.type, value: s.value.trim().slice(0, 200) }));
  if (!b.name?.trim() || steps.length < 2) return c.json({ error: 'A funnel needs a name and at least 2 steps' }, 400);
  const id = randomId(8);
  await c.env.DB.prepare('INSERT INTO funnels (id, site_id, name, steps, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, c.get('site').id, b.name.trim().slice(0, 100), JSON.stringify(steps), Date.now())
    .run();
  return c.json({ id, name: b.name.trim(), steps });
});

app.delete('/api/sites/:id/funnels/:fid', async (c) => {
  await c.env.DB.prepare('DELETE FROM funnels WHERE id = ? AND site_id = ?').bind(c.req.param('fid'), c.get('site').id).run();
  return c.json({ ok: true });
});

app.get('/api/sites/:id/funnels/:fid/stats', async (c) => {
  const f = await c.env.DB.prepare('SELECT * FROM funnels WHERE id = ? AND site_id = ?')
    .bind(c.req.param('fid'), c.get('site').id)
    .first<{ steps: string }>();
  if (!f) return c.json({ error: 'funnel not found' }, 404);
  return c.json(await funnel(makeCtx(c), JSON.parse(f.steps)));
});

app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));

// Everything else is the dashboard (static files).
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
