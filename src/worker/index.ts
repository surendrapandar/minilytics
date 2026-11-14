import { Hono, type Context, type Next } from 'hono';
import { cors } from 'hono/cors';
import { handleEvent } from './collect';
import { forgetSite, type AppEnv, type Site } from './env';
import { ADMIN_ID, adminEmail, clearSession, currentUser, emailLogin, googleCallback, googleStart, isHosted, requireUser, setSession, signupOpen, siteAccessSql } from './auth';
import { billingWebhook, checkout, planInfo } from './billing';
import { hashPassword, passwordsMatch, randomId, verifyPassword } from './lib/crypto';
import { handleDodoWebhook, handleGoalApi, handlePaymentApi, handlePolarWebhook, handleStripeWebhook, learnDodoProducts, rematchPayments } from './payments';
import { rememberOwnerDevice } from './owner';
import { breakdown, customers, funnel, makeCtx, overview, realtime, sparklines, visitorProfile, visitors, type FunnelStep } from './stats';

const app = new Hono<AppEnv>();
const MAX_FAILURES = 10;
const LOCKOUT_MS = 15 * 60_000;

// Basic hardening for everything the Worker answers (API and app pages). Static files get the same
// headers from public/_headers. The tracking script and endpoint stay embeddable on customers' sites.
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (c.req.path.startsWith('/api/')) {
    // Stats, settings and secrets must never sit in a shared or browser cache.
    if (c.req.path !== '/api/event' && !c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
  } else {
    // The dashboard can't be framed by another site (clickjacking).
    c.header('X-Frame-Options', 'DENY');
    c.header('Content-Security-Policy', "frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
  }
});

// ---------- public: tracking, webhooks, server-side API

app.use('/api/event', cors({ origin: '*', allowMethods: ['POST', 'OPTIONS'], maxAge: 86400 }));
app.post('/api/event', handleEvent);
app.post('/api/webhooks/dodo/:siteId', handleDodoWebhook);
app.post('/api/webhooks/stripe/:siteId', handleStripeWebhook);
app.post('/api/webhooks/polar/:siteId', handlePolarWebhook);
app.post('/api/v1/payments', handlePaymentApi);
app.post('/api/v1/goals', handleGoalApi);

// ---------- login

/**
 * Lock an IP out after too many attempts (login, sign-up, password change), so a public dashboard can't be
 * brute-forced. The attempt is recorded and counted in one atomic batch BEFORE the password is checked: checking
 * first and recording afterwards would let a burst of parallel guesses all slip under the limit.
 */
async function tooManyAttempts(c: Context<AppEnv>) {
  const now = Date.now();
  const [, , attempts] = await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM login_failures WHERE ts < ?').bind(now - LOCKOUT_MS),
    c.env.DB.prepare('INSERT INTO login_failures (ip, ts) VALUES (?, ?)').bind(clientIp(c), now),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND ts > ?').bind(clientIp(c), now - LOCKOUT_MS),
  ]);
  return ((attempts.results[0] as { n: number } | undefined)?.n ?? 0) > MAX_FAILURES;
}
const clientIp = (c: Context<AppEnv>) => c.req.header('cf-connecting-ip') ?? 'unknown';
const forgetAttempts = (c: Context<AppEnv>) => c.env.DB.prepare('DELETE FROM login_failures WHERE ip = ?').bind(clientIp(c)).run();
const slowDown = () => new Promise((r) => setTimeout(r, 500));
const TOO_MANY = 'Too many attempts. Try again in 15 minutes.';
const MIN_PASSWORD = 8;

/** Is this the admin's password? A password set in the dashboard replaces ADMIN_PASSWORD. */
async function adminPasswordOk(c: Context<AppEnv>, password: string) {
  const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(ADMIN_ID).first<{ password_hash: string | null }>();
  return row?.password_hash ? verifyPassword(password, row.password_hash) : passwordsMatch(password, c.env.ADMIN_PASSWORD);
}

async function accountPasswordOk(c: Context<AppEnv>, userId: string, password: string) {
  const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(userId).first<{ password_hash: string | null }>();
  return verifyPassword(password, row?.password_hash);
}

app.post('/api/auth/login', async (c) => {
  if (isHosted(c.env)) return c.json({ error: 'Use "Continue with Google".' }, 400);
  if (!c.env.ADMIN_PASSWORD || !c.env.SESSION_SECRET) {
    return c.json({ error: 'Set ADMIN_PASSWORD and SESSION_SECRET (see README).' }, 500);
  }
  if (await tooManyAttempts(c)) return c.json({ error: TOO_MANY }, 429);
  const b = await c.req.json<{ email?: string; password?: string }>().catch(() => ({}) as { email?: string; password?: string });
  const email = (b.email ?? '').trim().toLowerCase();
  const password = b.password ?? '';
  const admin = adminEmail(c.env);
  let subject: string | null = null;
  if (password && (admin ? email === admin : !email)) {
    if (await adminPasswordOk(c, password)) subject = ADMIN_ID;
  } else if (password && email) {
    const row = await c.env.DB.prepare('SELECT id FROM users WHERE email = ? AND id != ? AND password_hash IS NOT NULL')
      .bind(email, ADMIN_ID)
      .first<{ id: string }>();
    if (row && (await accountPasswordOk(c, row.id, password))) subject = `u:${row.id}`;
  }
  if (!subject) {
    await slowDown();
    return c.json({ error: emailLogin(c.env) ? 'Wrong email or password' : 'Wrong password' }, 401);
  }
  await forgetAttempts(c);
  await setSession(c, subject);
  return c.json({ ok: true });
});

app.post('/api/auth/signup', async (c) => {
  if (!signupOpen(c.env)) return c.json({ error: 'Sign-up is closed.' }, 403);
  if (!c.env.SESSION_SECRET) return c.json({ error: 'Set SESSION_SECRET (see README).' }, 500);
  // Counts toward the same limit as logins, so one IP can't create accounts in bulk.
  if (await tooManyAttempts(c)) return c.json({ error: TOO_MANY }, 429);
  const b = await c.req.json<{ email?: string; password?: string }>().catch(() => ({}) as { email?: string; password?: string });
  const email = (b.email ?? '').trim().toLowerCase();
  const password = b.password ?? '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: 'Enter a valid email.' }, 400);
  if (password.length < MIN_PASSWORD) return c.json({ error: `Use at least ${MIN_PASSWORD} characters for the password.` }, 400);
  if (password.length > 200) return c.json({ error: 'That password is too long.' }, 400);
  const taken = email === adminEmail(c.env) || !!(await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first());
  if (taken) return c.json({ error: 'An account with this email already exists. Log in instead.' }, 409);
  const id = randomId(10);
  try {
    await c.env.DB.prepare('INSERT INTO users (id, email, created_at, password_hash) VALUES (?, ?, ?, ?)')
      .bind(id, email, Date.now(), await hashPassword(password))
      .run();
  } catch {
    // Two sign-ups with the same email at once: the unique index stops the second.
    return c.json({ error: 'An account with this email already exists. Log in instead.' }, 409);
  }
  await setSession(c, `u:${id}`);
  return c.json({ ok: true });
});

app.post('/api/auth/password', requireUser, async (c) => {
  if (isHosted(c.env)) return c.json({ error: 'You sign in with Google, so there is no password to change.' }, 400);
  if (await tooManyAttempts(c)) return c.json({ error: TOO_MANY }, 429);
  const user = c.get('user');
  const b = await c.req.json<{ current?: string; next?: string }>().catch(() => ({}) as { current?: string; next?: string });
  const current = b.current ?? '';
  const next = b.next ?? '';
  if (next.length < MIN_PASSWORD) return c.json({ error: `Use at least ${MIN_PASSWORD} characters for the new password.` }, 400);
  if (next.length > 200) return c.json({ error: 'That password is too long.' }, 400);
  const ok = !!current && (user.id === ADMIN_ID ? await adminPasswordOk(c, current) : await accountPasswordOk(c, user.id, current));
  if (!ok) {
    await slowDown();
    return c.json({ error: 'Your current password is wrong.' }, 400);
  }
  const hash = await hashPassword(next);
  const now = Date.now();
  if (user.id === ADMIN_ID) {
    // The admin gets a users row the first time; from then on it holds their password instead of ADMIN_PASSWORD.
    await c.env.DB.prepare(
      `INSERT INTO users (id, email, created_at, password_hash, password_changed_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET password_hash = excluded.password_hash, password_changed_at = excluded.password_changed_at`,
    )
      .bind(ADMIN_ID, adminEmail(c.env) ?? 'admin', now, hash, now)
      .run();
  } else {
    await c.env.DB.prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?').bind(hash, now, user.id).run();
  }
  await forgetAttempts(c);
  // Other browsers are now signed out; keep this one signed in.
  await setSession(c, user.id === ADMIN_ID ? ADMIN_ID : `u:${user.id}`);
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
  return c.json({ loggedIn: !!user, hosted: isHosted(c.env), emailLogin: emailLogin(c.env), signup: signupOpen(c.env), user });
});

// ---------- billing (hosted mode)

app.get('/api/public/plan', async (c) => c.json(await planInfo(c.env)));
app.post('/api/billing/webhook', billingWebhook);
app.get('/api/billing/checkout', requireUser, checkout);

// ---------- dashboard API (login required, except viewing a public site)

app.use('/api/sites', requireUser);

// What a visitor without access may load from a public site: the dashboard's data, never its settings.
const PUBLIC_READS = /^\/api\/sites\/[\w-]+(\/(overview|breakdown|realtime|customers|visitors(\/[\w-]+)?|funnels(\/[\w-]+\/stats)?))?\/?$/;

const loadSite = async (c: Context<AppEnv>, next: Next) => {
  const id = c.req.param('id');
  const user = await currentUser(c);
  if (user) {
    c.set('user', user);
    const access = siteAccessSql(c.env, user);
    const site = await c.env.DB.prepare(`SELECT s.* FROM sites s WHERE s.id = ? AND ${access.sql}`)
      .bind(id, ...access.params)
      .first<Site>();
    if (site) {
      c.set('site', site);
      c.set('readOnly', false);
      return next();
    }
  }
  if (c.req.method === 'GET' && PUBLIC_READS.test(c.req.path)) {
    const site = await c.env.DB.prepare('SELECT * FROM sites WHERE id = ? AND public = 1').bind(id).first<Site>();
    if (site) {
      c.set('site', site);
      c.set('readOnly', true);
      return next();
    }
  }
  return user ? c.json({ error: 'site not found' }, 404) : c.json({ error: 'unauthorized' }, 401);
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
const ownerSite = (s: Site) => ({
  ...s,
  dodo_webhook_secret: mask(s.dodo_webhook_secret),
  stripe_webhook_secret: mask(s.stripe_webhook_secret),
  polar_webhook_secret: mask(s.polar_webhook_secret),
  readOnly: false,
});
// Someone viewing a public site: what the dashboard needs, and none of the keys or secrets.
const viewerSite = (s: Site) => ({
  id: s.id,
  name: s.name,
  domain: s.domain,
  timezone: s.timezone,
  currency: s.currency,
  created_at: s.created_at,
  public: s.public,
  readOnly: true,
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
      ...ownerSite(s),
      visitors24h: by.get(s.id)?.visitors ?? 0,
      online: by.get(s.id)?.online ?? 0,
    })),
  );
});

// Every site's totals and sparkline for the all-websites view.
app.use('/api/sites-overview', requireUser);
app.get('/api/sites-overview', async (c) => {
  const access = siteAccessSql(c.env, c.get('user'));
  const rows = await c.env.DB.prepare(`SELECT s.id FROM sites s WHERE ${access.sql}`).bind(...access.params).all<{ id: string }>();
  return c.json(await sparklines(c.env.DB, rows.results.map((r) => r.id), c.req.query('period') ?? '30d'));
});

app.post('/api/sites', async (c) => {
  const user = c.get('user');
  if (isHosted(c.env) && !user.paid) return c.json({ error: 'Choose a plan to add websites.' }, 402);
  const b = await c.req.json<Partial<Site>>().catch(() => ({}) as Partial<Site>);
  const domain = cleanDomain(b.domain ?? '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return c.json({ error: 'Enter a domain like example.com' }, 400);
  if (b.timezone && !validTimezone(b.timezone)) return c.json({ error: 'Unknown timezone' }, 400);
  const tz = b.timezone || 'UTC';
  const site: Site = {
    id: randomId(8),
    name: (b.name || domain).slice(0, 100),
    domain,
    timezone: tz,
    currency: (b.currency || 'USD').toUpperCase().slice(0, 3),
    api_key: 'ml_' + randomId(16),
    dodo_webhook_secret: null,
    polar_webhook_secret: null,
    created_at: Date.now(),
  };
  await c.env.DB.prepare(
    'INSERT INTO sites (id, name, domain, timezone, currency, api_key, dodo_webhook_secret, polar_webhook_secret, created_at, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    // Self-hosted admin sites have no owner (the admin owns those); every account owns its own.
    .bind(site.id, site.name, site.domain, site.timezone, site.currency, site.api_key, null, null, site.created_at, user.admin && !isHosted(c.env) ? null : user.id)
    .run();
  return c.json(ownerSite(site));
});

app.get('/api/sites/:id', (c) => c.json(c.get('readOnly') ? viewerSite(c.get('site')) : ownerSite(c.get('site'))));

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
  if (typeof b.polar_webhook_secret === 'string' && !b.polar_webhook_secret.includes('•')) {
    next.polar_webhook_secret = b.polar_webhook_secret.trim() || null;
  }
  if (typeof b.dodo_product_ids === 'string') {
    const ids = b.dodo_product_ids.split(/[\s,]+/).filter((x) => /^pdt_[\w-]+$/.test(x));
    next.dodo_product_ids = ids.join(',') || null;
  }
  if (b.public !== undefined) next.public = b.public ? 1 : 0;
  await c.env.DB.prepare(
    'UPDATE sites SET name = ?, domain = ?, timezone = ?, currency = ?, dodo_webhook_secret = ?, dodo_product_ids = ?, stripe_webhook_secret = ?, polar_webhook_secret = ?, public = ? WHERE id = ?',
  )
    .bind(
      next.name,
      next.domain,
      next.timezone,
      next.currency,
      next.dodo_webhook_secret,
      next.dodo_product_ids ?? null,
      next.stripe_webhook_secret ?? null,
      next.polar_webhook_secret ?? null,
      next.public ? 1 : 0,
      site.id,
    )
    .run();
  forgetSite(site.id);
  return c.json(ownerSite(next));
});

app.post('/api/sites/:id/rotate-key', async (c) => {
  const key = 'ml_' + randomId(16);
  await c.env.DB.prepare('UPDATE sites SET api_key = ? WHERE id = ?').bind(key, c.get('site').id).run();
  return c.json({ api_key: key });
});

app.delete('/api/sites/:id', async (c) => {
  const id = c.get('site').id;
  await c.env.DB.batch(
    // Everything stored for the site, so deleting it really removes its visitors' data.
    ['events', 'sessions', 'visitors', 'payments', 'funnels', 'payment_claims', 'pending_payments', 'dodo_products'].map((t) =>
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

// Static files are served before the Worker runs. What reaches here is a client-side route, or a page that doesn't exist.
const PUBLIC_PAGES = /^\/(terms|privacy|refund)\/?$/;
const APP_PAGES = /^\/(billing(\/.*)?|account\/?|site\/[\w-]+(\/settings)?\/?)$/;

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
