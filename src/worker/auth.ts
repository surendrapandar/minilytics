import type { Context, Next } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv, Env, Site } from './env';
import { passwordsMatch, randomId, signToken, verifyToken } from './lib/crypto';

/**
 * Two modes:
 *  - self-hosted (default): one owner, password login (ADMIN_PASSWORD), sees every site.
 *  - hosted: set GOOGLE_CLIENT_ID/SECRET; anyone can sign in with Google, pays for a plan and sees only their own sites.
 *    Emails in ADMIN_EMAILS never pay and also own the sites created before accounts existed.
 */
export const isHosted = (env: Env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

export interface User {
  id: string;
  email: string | null;
  name: string | null;
  avatar: string | null;
  admin: boolean;
  paid: boolean;
  plan_status: string;
  plan_until: number | null;
  /** 'lifetime' | 'monthly' once they've paid. */
  plan: string | null;
}

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  avatar: string | null;
  plan_status: string;
  plan_until: number | null;
  plan: string | null;
}

const SELF_HOSTED_OWNER: User = {
  id: 'admin',
  email: null,
  name: null,
  avatar: null,
  admin: true,
  paid: true,
  plan_status: 'active',
  plan_until: null,
  plan: null,
};

export const AUTH_COOKIE = 'ml_auth';
const AUTH_DAYS = 30;
const OAUTH_COOKIE = 'ml_oauth';

export function isAdminEmail(env: Env, email: string | null | undefined) {
  if (!email) return false;
  return (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

/** Paid and not expired. plan_until NULL with an active plan means a one-time (lifetime) payment. */
export function planActive(status: string | null | undefined, until: number | null | undefined, now = Date.now()) {
  if (until) return until > now;
  return status === 'active';
}

/** Should events for this site still be recorded? (Self-hosted: always. Hosted: only while the owner has access.) */
export function siteOwnerActive(env: Env, site: Site & { owner_email?: string | null; owner_plan_status?: string | null; owner_plan_until?: number | null }) {
  if (!isHosted(env) || !site.owner_id) return true;
  return isAdminEmail(env, site.owner_email) || planActive(site.owner_plan_status, site.owner_plan_until);
}

// ---------- secrets

/** The example values from .dev.vars.example: public, so they protect nothing. */
const PLACEHOLDERS = new Set(['change-me', 'any-long-random-string']);
const MIN_PASSWORD = 12;
const MIN_SECRET = 32;

/** Local `wrangler dev` may keep the example values; a deployed dashboard may not. */
function isLocal(url: string) {
  const host = new URL(url).hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

/** Anyone who knows (or can guess) SESSION_SECRET can mint a login cookie, so a weak one is as good as none. */
function weakSessionSecret(env: Env, url: string) {
  const s = env.SESSION_SECRET;
  return !s || (!isLocal(url) && (s.length < MIN_SECRET || PLACEHOLDERS.has(s)));
}

/** Why this deployment can't sign anyone in safely, or null when its secrets are fine. */
export function secretProblem(env: Env, url: string): string | null {
  if (!env.SESSION_SECRET || (!isHosted(env) && !env.ADMIN_PASSWORD)) return 'Set ADMIN_PASSWORD and SESSION_SECRET (see README).';
  if (weakSessionSecret(env, url)) {
    return `SESSION_SECRET is too weak: set at least ${MIN_SECRET} random characters (openssl rand -hex 32).`;
  }
  const pw = env.ADMIN_PASSWORD ?? '';
  if (!isHosted(env) && !isLocal(url) && (pw.length < MIN_PASSWORD || PLACEHOLDERS.has(pw.toLowerCase()))) {
    return `ADMIN_PASSWORD is too weak: set one with at least ${MIN_PASSWORD} characters.`;
  }
  return null;
}

/**
 * Self-hosted sessions are signed with the password mixed in, so changing ADMIN_PASSWORD signs out every
 * browser, including any that got hold of a cookie.
 */
function sessionKey(env: Env) {
  return isHosted(env) ? env.SESSION_SECRET : `${env.SESSION_SECRET}\n${env.ADMIN_PASSWORD ?? ''}`;
}

export async function setSession(c: Context<AppEnv>, subject: string) {
  const expires = Date.now() + AUTH_DAYS * 86_400_000;
  setCookie(c, AUTH_COOKIE, await signToken(sessionKey(c.env), `${subject}.${expires}`), {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: AUTH_DAYS * 86_400,
  });
}

export function clearSession(c: Context<AppEnv>) {
  deleteCookie(c, AUTH_COOKIE, { path: '/' });
}

export async function currentUser(c: Context<AppEnv>): Promise<User | null> {
  if (weakSessionSecret(c.env, c.req.url)) return null;
  const value = await verifyToken(sessionKey(c.env), getCookie(c, AUTH_COOKIE));
  if (!value) return null;
  const parts = value.split('.');
  if (Number(parts[parts.length - 1]) <= Date.now()) return null;
  // Self-hosted password session: "admin.<expires>"
  if (parts[0] === 'admin') return isHosted(c.env) ? null : SELF_HOSTED_OWNER;
  // Hosted Google session: "u:<userId>.<expires>"
  if (!parts[0].startsWith('u:') || !isHosted(c.env)) return null;
  const row = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(parts[0].slice(2)).first<UserRow>();
  if (!row) return null;
  const admin = isAdminEmail(c.env, row.email);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatar: row.avatar,
    admin,
    paid: admin || planActive(row.plan_status, row.plan_until),
    plan_status: row.plan_status,
    plan_until: row.plan_until,
    plan: row.plan,
  };
}

export const requireUser = async (c: Context<AppEnv>, next: Next) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  c.set('user', user);
  await next();
};

/** SQL that limits `sites s` to the ones this user may see. */
export function siteAccessSql(env: Env, user: User): { sql: string; params: unknown[] } {
  if (!isHosted(env)) return { sql: '1 = 1', params: [] };
  if (user.admin) return { sql: '(s.owner_id = ? OR s.owner_id IS NULL)', params: [user.id] };
  return { sql: 's.owner_id = ?', params: [user.id] };
}

/**
 * Cross-site request forgery: another page (including a sibling subdomain, which SameSite cookies don't stop) must
 * not be able to make a signed-in browser change settings, rotate keys or delete sites. Browsers say where a
 * request comes from (Sec-Fetch-Site, or Origin in older ones); scripts and curl send neither and pass.
 */
export function crossSiteRequest(method: string, url: string, headers: { get(name: string): string | null }) {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
  const site = headers.get('sec-fetch-site');
  if (site) return site !== 'same-origin' && site !== 'none';
  const origin = headers.get('origin');
  return !!origin && origin !== new URL(url).origin;
}

// ---------- password sign-in (self-hosted)

const MAX_FAILURES_PER_IP = 10;
/** Across every address: a botnet gets this many guesses per window in total, not 10 per machine. */
const MAX_FAILURES_TOTAL = 100;
const LOCKOUT_MS = 15 * 60_000;
const DEVICE_COOKIE = 'ml_device';
const DEVICE_DAYS = 365;

/** Anyone on IPv6 controls a whole /64 (2^64 addresses), so IPv6 is limited per /64 rather than per address. */
export function ipBucket(ip: string): string {
  if (!ip.includes(':') || ip.includes('.')) return ip;
  const [head, tail] = ip.toLowerCase().split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return groups
    .slice(0, 4)
    .map((g) => (parseInt(g, 16) || 0).toString(16))
    .join(':') + '::/64';
}

// A browser that has signed in before keeps a device cookie. Attackers can't get one, so when guesses come from
// everywhere at once, those browsers may still sign in while everyone else waits: the owner can't be locked out.
const deviceKey = (env: Env) => `${env.SESSION_SECRET}\ndevice`;

async function isTrustedDevice(c: Context<AppEnv>) {
  const value = await verifyToken(deviceKey(c.env), getCookie(c, DEVICE_COOKIE));
  return !!value?.startsWith('device.');
}

async function trustDevice(c: Context<AppEnv>) {
  setCookie(c, DEVICE_COOKIE, await signToken(deviceKey(c.env), `device.${randomId(8)}`), {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Strict',
    path: '/api/auth/login',
    maxAge: DEVICE_DAYS * 86_400,
  });
}

/** POST /api/auth/login { password } */
export async function passwordLogin(c: Context<AppEnv>) {
  if (isHosted(c.env)) return c.json({ error: 'Use "Continue with Google".' }, 400);
  const problem = secretProblem(c.env, c.req.url);
  if (problem) return c.json({ error: problem }, 500);

  const ip = ipBucket(c.req.header('cf-connecting-ip') ?? 'unknown');
  const busy = () => c.json({ error: 'Too many sign-in attempts. Try again in 15 minutes.' }, 429);
  // Optional Workers rate limit (see wrangler.jsonc): a flood is turned away before it costs any database work.
  if (c.env.LOGIN_LIMITER && !(await c.env.LOGIN_LIMITER.limit({ key: ip })).success) return busy();

  const db = c.env.DB;
  const since = Date.now() - LOCKOUT_MS;
  const trusted = await isTrustedDevice(c);
  const counts = () => [
    db.prepare('SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND ts > ?').bind(ip, since),
    db.prepare('SELECT COUNT(*) AS n FROM login_failures WHERE ts > ?').bind(since),
  ];
  const n = (r: D1Result) => (r.results[0] as { n: number } | undefined)?.n ?? 0;
  const lockedOut = (mine: number, all: number) => mine > MAX_FAILURES_PER_IP || (!trusted && all > MAX_FAILURES_TOTAL);

  // Already locked out: answer without writing, so a flood can't run up the database's daily write quota.
  const [mine0, all0] = await db.batch(counts());
  if (lockedOut(n(mine0) + 1, n(all0) + 1)) return busy();
  // Record the attempt and count it in one atomic batch BEFORE checking the password: checking first and recording
  // afterwards would let a burst of parallel guesses all slip under the limit.
  const [, , mine, all] = await db.batch([
    db.prepare('DELETE FROM login_failures WHERE ts < ?').bind(since),
    db.prepare('INSERT INTO login_failures (ip, ts) VALUES (?, ?)').bind(ip, Date.now()),
    ...counts(),
  ]);
  if (lockedOut(n(mine), n(all))) return busy();

  const { password } = await c.req.json<{ password?: unknown }>().catch(() => ({ password: undefined }));
  if (typeof password !== 'string' || !password || password.length > 1000 || !(await passwordsMatch(password, c.env.ADMIN_PASSWORD))) {
    await new Promise((r) => setTimeout(r, 500));
    return c.json({ error: 'Wrong password' }, 401);
  }
  await db.prepare('DELETE FROM login_failures WHERE ip = ?').bind(ip).run();
  await setSession(c, 'admin');
  await trustDevice(c);
  return c.json({ ok: true });
}

// ---------- Google sign-in (OAuth 2.0 authorization code flow)

function redirectUri(c: Context<AppEnv>) {
  return `${new URL(c.req.url).origin}/api/auth/google/callback`;
}

export async function googleStart(c: Context<AppEnv>) {
  if (!isHosted(c.env)) return c.text('Google sign-in is not configured', 404);
  const problem = secretProblem(c.env, c.req.url);
  if (problem) return c.redirect(`/?login_error=${encodeURIComponent(problem)}`);
  const state = randomId(16);
  setCookie(c, OAUTH_COOKIE, state, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/api/auth/google',
    maxAge: 600,
  });
  const q = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(c),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
}

function decodeJwtPayload(jwt: string): Record<string, any> {
  const part = jwt.split('.')[1] ?? '';
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))));
}

export async function googleCallback(c: Context<AppEnv>) {
  if (!isHosted(c.env)) return c.text('Google sign-in is not configured', 404);
  const fail = (msg: string) => c.redirect(`/?login_error=${encodeURIComponent(msg)}`);
  const state = c.req.query('state');
  const expected = getCookie(c, OAUTH_COOKIE);
  deleteCookie(c, OAUTH_COOKIE, { path: '/api/auth/google' });
  if (!state || !expected || state !== expected) return fail('Sign-in expired, please try again.');
  const code = c.req.query('code');
  if (!code) return fail(c.req.query('error') ?? 'Sign-in was cancelled.');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID!,
      client_secret: c.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(c),
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) return fail('Google sign-in failed.');
  const tokens = await res.json<{ id_token?: string }>();
  if (!tokens.id_token) return fail('Google sign-in failed.');
  // The token came straight from Google over TLS, so its claims can be trusted; still check who it's for.
  const claims = decodeJwtPayload(tokens.id_token);
  const issOk = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
  // Accounts are matched by email, so an unverified one could claim someone else's account.
  const verified = claims.email_verified === true || claims.email_verified === 'true';
  if (!issOk || claims.aud !== c.env.GOOGLE_CLIENT_ID || !claims.sub || !claims.email || !verified) {
    return fail('Google sign-in failed.');
  }
  const email = String(claims.email).toLowerCase();
  const now = Date.now();
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE google_sub = ? OR email = ?')
    .bind(claims.sub, email)
    .first<{ id: string }>();
  const id = existing?.id ?? randomId(10);
  const stmts = [
    existing
      ? c.env.DB.prepare('UPDATE users SET google_sub = ?, email = ?, name = ?, avatar = ? WHERE id = ?').bind(
          claims.sub,
          email,
          claims.name ?? null,
          claims.picture ?? null,
          id,
        )
      : c.env.DB.prepare('INSERT INTO users (id, google_sub, email, name, avatar, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
          id,
          claims.sub,
          email,
          claims.name ?? null,
          claims.picture ?? null,
          now,
        ),
  ];
  // The owner takes over the sites that existed before accounts were turned on.
  if (isAdminEmail(c.env, email)) stmts.push(c.env.DB.prepare('UPDATE sites SET owner_id = ? WHERE owner_id IS NULL').bind(id));
  await c.env.DB.batch(stmts);
  await setSession(c, `u:${id}`);
  // ?signup=1 lets the app record a "signup_completed" goal for brand-new accounts.
  return c.redirect(existing ? '/' : '/?signup=1');
}
