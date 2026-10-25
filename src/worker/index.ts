import { Hono, type Context, type Next } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import { handleEvent } from './collect';
import { forgetSite, type AppEnv, type Site } from './env';
import { passwordsMatch, randomId, signToken, verifyToken } from './lib/crypto';
import { handleDodoWebhook, handleGoalApi, handlePaymentApi, rematchPayments } from './payments';
import { breakdown, customers, funnel, makeCtx, overview, visitorProfile, visitors, type FunnelStep } from './stats';

const app = new Hono<AppEnv>();
const AUTH_COOKIE = 'ml_auth';
const AUTH_DAYS = 30;
const MAX_FAILURES = 10;
const LOCKOUT_MS = 15 * 60_000;

// API responses are never sniffed, and (except the tracking endpoint) never cached.
// Headers for the static dashboard live in public/_headers.
app.use('/api/*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  if (c.req.path !== '/api/event') c.header('Cache-Control', 'no-store');
});

// ---------- public: tracking, webhooks, server-side API

app.use('/api/event', cors({ origin: '*', allowMethods: ['POST', 'OPTIONS'], maxAge: 86400 }));
app.post('/api/event', handleEvent);
app.post('/api/webhooks/dodo/:siteId', handleDodoWebhook);
app.post('/api/v1/payments', handlePaymentApi);
app.post('/api/v1/goals', handleGoalApi);

// ---------- login

/**
 * The id of the logged-in dashboard session, or null. The cookie must be correctly signed, unexpired
 * AND still listed in admin_sessions, so logging out really ends the session on the server.
 */
async function sessionId(c: Context<AppEnv>): Promise<string | null> {
  if (!c.env.SESSION_SECRET) return null;
  const value = await verifyToken(c.env.SESSION_SECRET, getCookie(c, AUTH_COOKIE));
  const [id, expires] = value?.split('.') ?? [];
  const now = Date.now();
  if (!id || !(Number(expires) > now)) return null;
  const row = await c.env.DB.prepare('SELECT 1 AS ok FROM admin_sessions WHERE id = ? AND expires_at > ?').bind(id, now).first();
  return row ? id : null;
}

const isLoggedIn = async (c: Context<AppEnv>) => (await sessionId(c)) !== null;

app.post('/api/auth/login', async (c) => {
  if (!c.env.ADMIN_PASSWORD || !c.env.SESSION_SECRET) {
    return c.json({ error: 'Set ADMIN_PASSWORD and SESSION_SECRET (see README).' }, 500);
  }
  // Lock an IP out after too many wrong passwords, so a public dashboard can't be brute-forced.
  // Every attempt is counted BEFORE the password is checked, in one atomic batch: checking first and
  // recording afterwards would let a burst of parallel guesses all slip under the limit.
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const now = Date.now();
  const [, , attempts] = await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM login_failures WHERE ts < ?').bind(now - LOCKOUT_MS),
    c.env.DB.prepare('INSERT INTO login_failures (ip, ts) VALUES (?, ?)').bind(ip, now),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND ts > ?').bind(ip, now - LOCKOUT_MS),
  ]);
  if ((attempts.results[0] as { n: number }).n > MAX_FAILURES) {
    return c.json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
  }
  const { password } = await c.req.json<{ password?: string }>().catch(() => ({ password: undefined }));
  if (!password || !passwordsMatch(password, c.env.ADMIN_PASSWORD)) {
    await new Promise((r) => setTimeout(r, 500));
    return c.json({ error: 'Wrong password' }, 401);
  }
  const id = randomId(16);
  const expires = now + AUTH_DAYS * 86_400_000;
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM login_failures WHERE ip = ?').bind(ip),
    c.env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').bind(now),
    c.env.DB.prepare('INSERT INTO admin_sessions (id, created_at, expires_at) VALUES (?, ?, ?)').bind(id, now, expires),
  ]);
  setCookie(c, AUTH_COOKIE, await signToken(c.env.SESSION_SECRET, `${id}.${expires}`), {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: AUTH_DAYS * 86_400,
  });
  return c.json({ ok: true });
});

app.post('/api/auth/logout', async (c) => {
  const id = await sessionId(c);
  if (id) await c.env.DB.prepare('DELETE FROM admin_sessions WHERE id = ?').bind(id).run();
  deleteCookie(c, AUTH_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

app.get('/api/auth/me', async (c) => c.json({ loggedIn: await isLoggedIn(c) }));

// ---------- dashboard API (login required)

const requireAuth = async (c: Context<AppEnv>, next: Next) => {
  if (!(await isLoggedIn(c))) return c.json({ error: 'unauthorized' }, 401);
  await next();
};

// End every dashboard session on every device (e.g. after a stolen cookie or laptop).
app.post('/api/auth/logout-all', requireAuth, async (c) => {
  await c.env.DB.prepare('DELETE FROM admin_sessions').run();
  deleteCookie(c, AUTH_COOKIE, { path: '/' });
  return c.json({ ok: true });
});
app.use('/api/sites', requireAuth);
app.use('/api/sites/*', requireAuth);

const loadSite = async (c: Context<AppEnv>, next: Next) => {
  const site = await c.env.DB.prepare('SELECT * FROM sites WHERE id = ?').bind(c.req.param('id')).first<Site>();
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

const publicSite = (s: Site) => ({ ...s, dodo_webhook_secret: s.dodo_webhook_secret ? '••••••••' : null });

app.get('/api/sites', async (c) => {
  const now = Date.now();
  const [sites, stats] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT * FROM sites ORDER BY created_at'),
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
    'INSERT INTO sites (id, name, domain, timezone, currency, api_key, dodo_webhook_secret, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(site.id, site.name, site.domain, site.timezone, site.currency, site.api_key, null, site.created_at)
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
  await c.env.DB.prepare('UPDATE sites SET name = ?, domain = ?, timezone = ?, currency = ?, dodo_webhook_secret = ? WHERE id = ?')
    .bind(next.name, next.domain, next.timezone, next.currency, next.dodo_webhook_secret, site.id)
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

app.post('/api/sites/:id/rematch', async (c) => c.json(await rematchPayments(c.env.DB, c.get('site'))));
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
