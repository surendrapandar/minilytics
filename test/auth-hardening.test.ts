import { describe, expect, it } from 'vitest';
import app from '../src/worker/index';
import { crossSiteRequest, ipBucket, secretProblem } from '../src/worker/auth';
import type { Env } from '../src/worker/env';
import { passwordsMatch, signToken } from '../src/worker/lib/crypto';

const PASSWORD = 'correct horse battery staple';
const SECRET = 'a'.repeat(64);
const PROD = 'https://dash.example.com';

/** Just enough of D1 for the login lockout: the login_failures table, kept in memory. */
function fakeDb() {
  let rows: { ip: string; ts: number }[] = [];
  const stats = { writes: 0 };
  const exec = (sql: string, a: any[]): any[] => {
    if (sql.startsWith('SELECT COUNT(*) AS n FROM login_failures WHERE ip = ?')) return [{ n: rows.filter((r) => r.ip === a[0] && r.ts > a[1]).length }];
    if (sql.startsWith('SELECT COUNT(*) AS n FROM login_failures WHERE ts > ?')) return [{ n: rows.filter((r) => r.ts > a[0]).length }];
    if (sql.startsWith('INSERT INTO login_failures')) {
      stats.writes++;
      rows.push({ ip: a[0], ts: a[1] });
    } else if (sql.startsWith('DELETE FROM login_failures WHERE ts < ?')) rows = rows.filter((r) => r.ts >= a[0]);
    else if (sql.startsWith('DELETE FROM login_failures WHERE ip = ?')) rows = rows.filter((r) => r.ip !== a[0]);
    return [];
  };
  const prepare = (sql: string) => ({
    bind: (...args: any[]) => ({
      sql,
      args,
      run: async () => (exec(sql, args), {}),
      first: async () => exec(sql, args)[0] ?? null,
      all: async () => ({ results: exec(sql, args) }),
    }),
  });
  const db = { prepare, batch: async (stmts: any[]) => stmts.map((s) => ({ results: exec(s.sql, s.args) })) };
  return { db: db as unknown as D1Database, stats };
}

function makeEnv(over: Partial<Env> = {}): Env {
  return { DB: fakeDb().db, ASSETS: {} as Fetcher, ADMIN_PASSWORD: PASSWORD, SESSION_SECRET: SECRET, ...over };
}

const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

function login(env: Env, password: string, opts: { ip?: string; cookie?: string; origin?: string } = {}) {
  return app.request(
    `${opts.origin ?? PROD}/api/auth/login`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
        'cf-connecting-ip': opts.ip ?? '203.0.113.7',
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
      },
      body: JSON.stringify({ password }),
    },
    env,
    ctx,
  );
}

const cookie = (res: Response, name: string) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith(`${name}=`));

async function loggedIn(env: Env, authCookie: string | undefined, origin = PROD) {
  const res = await app.request(`${origin}/api/auth/me`, { headers: authCookie ? { cookie: authCookie } : {} }, env, ctx);
  return ((await res.json()) as { loggedIn: boolean }).loggedIn;
}

describe('password brute force', () => {
  it('locks an address out after 10 wrong passwords, even when they arrive all at once', async () => {
    const env = makeEnv();
    const statuses = (await Promise.all(Array.from({ length: 12 }, () => login(env, 'guess')))).map((r) => r.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(10);
    expect(statuses.filter((s) => s === 429)).toHaveLength(2);
    // Even the right password is refused from that address now; other addresses are unaffected.
    expect((await login(env, PASSWORD)).status).toBe(429);
    expect((await login(env, PASSWORD, { ip: '198.51.100.1' })).status).toBe(200);
  });

  it('counts a whole IPv6 /64 as one address', async () => {
    const env = makeEnv();
    const ips = Array.from({ length: 11 }, (_, i) => `2001:db8:1:2::${(i + 1).toString(16)}`);
    const statuses = (await Promise.all(ips.map((ip) => login(env, 'guess', { ip })))).map((r) => r.status);
    expect(statuses).toContain(429);
    expect((await login(env, PASSWORD, { ip: '2001:db8:1:2:ffff::1' })).status).toBe(429);
    expect((await login(env, PASSWORD, { ip: '2001:db8:1:3::1' })).status).toBe(200);
  });

  it("doesn't write to the database for attempts that are already locked out", async () => {
    const { db, stats } = fakeDb();
    const env = makeEnv({ DB: db });
    await Promise.all(Array.from({ length: 11 }, () => login(env, 'guess')));
    const before = stats.writes;
    await Promise.all(Array.from({ length: 20 }, () => login(env, 'guess')));
    expect(stats.writes).toBe(before);
  });

  it('stops guesses spread over many addresses, but never locks out a browser that signed in before', async () => {
    const env = makeEnv();
    const first = await login(env, PASSWORD, { ip: '192.0.2.1' });
    const device = cookie(first, 'ml_device');
    expect(device).toBeTruthy();

    await Promise.all(Array.from({ length: 101 }, (_, i) => login(env, 'guess', { ip: `10.0.${i >> 8}.${i & 255}` })));
    // A fresh address with the right password must wait: it could be the attacker's next guess.
    expect((await login(env, PASSWORD, { ip: '192.0.2.200' })).status).toBe(429);
    // The owner's browser still gets in, from anywhere.
    expect((await login(env, PASSWORD, { ip: '192.0.2.201', cookie: device })).status).toBe(200);
    // A made-up device cookie doesn't.
    expect((await login(env, PASSWORD, { ip: '192.0.2.202', cookie: 'ml_device=device.x.forged' })).status).toBe(429);
  });
});

describe('sessions', () => {
  it('changing ADMIN_PASSWORD signs every browser out', async () => {
    const env = makeEnv();
    const auth = cookie(await login(env, PASSWORD), 'ml_auth');
    expect(await loggedIn(env, auth)).toBe(true);
    expect(await loggedIn({ ...env, ADMIN_PASSWORD: 'a different strong password' }, auth)).toBe(false);
  });

  it('a deployed dashboard ignores cookies signed with the example SESSION_SECRET (anyone could forge one)', async () => {
    const env = makeEnv({ SESSION_SECRET: 'any-long-random-string', ADMIN_PASSWORD: 'change-me' });
    const forged = `ml_auth=${await signToken('any-long-random-string\nchange-me', `admin.${Date.now() + 86_400_000}`)}`;
    expect(await loggedIn(env, forged)).toBe(false);
    // Local development may keep the example values.
    expect(await loggedIn(env, forged, 'http://localhost:8787')).toBe(true);
  });

  it('refuses to sign in with weak secrets once deployed, with a message saying what to fix', async () => {
    const weakPw = await login(makeEnv({ ADMIN_PASSWORD: 'change-me' }), 'change-me');
    expect(weakPw.status).toBe(500);
    expect(((await weakPw.json()) as { error: string }).error).toMatch(/ADMIN_PASSWORD is too weak/);
    const weakSecret = await login(makeEnv({ SESSION_SECRET: 'short' }), PASSWORD);
    expect(((await weakSecret.json()) as { error: string }).error).toMatch(/SESSION_SECRET is too weak/);
    expect((await login(makeEnv({ ADMIN_PASSWORD: 'change-me' }), 'change-me', { origin: 'http://localhost:8787' })).status).toBe(200);
  });
});

describe('secretProblem', () => {
  const env = (o: Partial<Env>) => ({ ADMIN_PASSWORD: PASSWORD, SESSION_SECRET: SECRET, ...o }) as Env;
  it('accepts strong secrets and flags weak or missing ones', () => {
    expect(secretProblem(env({}), PROD)).toBeNull();
    expect(secretProblem(env({ SESSION_SECRET: '' }), PROD)).toMatch(/Set ADMIN_PASSWORD and SESSION_SECRET/);
    expect(secretProblem(env({ SESSION_SECRET: 'x'.repeat(31) }), PROD)).toMatch(/SESSION_SECRET/);
    expect(secretProblem(env({ ADMIN_PASSWORD: 'elevenchars' }), PROD)).toMatch(/ADMIN_PASSWORD/);
    expect(secretProblem(env({ ADMIN_PASSWORD: 'twelve chars' }), PROD)).toBeNull();
  });
  it("doesn't need ADMIN_PASSWORD in hosted (Google sign-in) mode", () => {
    expect(secretProblem(env({ ADMIN_PASSWORD: '', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' }), PROD)).toBeNull();
  });
});

describe('ipBucket', () => {
  it('keeps IPv4 as is and groups IPv6 by /64', () => {
    expect(ipBucket('203.0.113.7')).toBe('203.0.113.7');
    expect(ipBucket('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64');
    expect(ipBucket('2001:0DB8:0001:0002:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(ipBucket('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(ipBucket('::1')).toBe('0:0:0:0::/64');
    expect(ipBucket('::ffff:192.0.2.1')).toBe('::ffff:192.0.2.1');
  });
});

describe('cross-site requests', () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it('lets the dashboard, scripts and reads through and blocks other sites', () => {
    expect(crossSiteRequest('POST', PROD, h({ 'sec-fetch-site': 'same-origin' }))).toBe(false);
    expect(crossSiteRequest('POST', PROD, h({}))).toBe(false); // curl, server scripts
    expect(crossSiteRequest('GET', PROD, h({ 'sec-fetch-site': 'cross-site' }))).toBe(false);
    expect(crossSiteRequest('POST', PROD, h({ 'sec-fetch-site': 'cross-site' }))).toBe(true);
    expect(crossSiteRequest('DELETE', PROD, h({ 'sec-fetch-site': 'same-site' }))).toBe(true); // a sibling subdomain
    expect(crossSiteRequest('POST', PROD, h({ origin: 'https://evil.example' }))).toBe(true);
    expect(crossSiteRequest('POST', PROD, h({ origin: PROD }))).toBe(false);
  });

  it('applies to the dashboard API but not to tracking or webhooks', async () => {
    const env = makeEnv();
    const post = (path: string) =>
      app.request(`${PROD}${path}`, { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' }, body: '{}' }, env, ctx);
    expect((await post('/api/auth/logout')).status).toBe(403);
    expect((await post('/api/sites/abc/rotate-key')).status).toBe(403);
    expect((await post('/api/event')).status).toBe(400); // reaches the handler (and fails on the empty payload)
  });
});

describe('passwordsMatch', () => {
  it('compares whole passwords of any length', async () => {
    expect(await passwordsMatch(PASSWORD, PASSWORD)).toBe(true);
    expect(await passwordsMatch('short', PASSWORD)).toBe(false);
    expect(await passwordsMatch(PASSWORD + 'x', PASSWORD)).toBe(false);
  });
});
