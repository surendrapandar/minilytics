import type { Context } from 'hono';
import { currentUser, isHosted, subjectOf, userForSubject, type User } from './auth';
import type { AppEnv, Env } from './env';
import { hmacHex, passwordsMatch, randomId, sha256Base64Url, signToken, verifyToken } from './lib/crypto';

/**
 * OAuth 2.1 for AI agents connecting over MCP (authorization code + PKCE, refresh tokens, dynamic client registration).
 * The agent registers itself, sends the owner here to approve it, and gets tokens for /mcp.
 * Owners sign in the usual way (password or Google) and can revoke an agent from the dashboard.
 */

const CODE_TTL = 10 * 60_000;
const ACCESS_TTL = 60 * 60_000;
const REFRESH_TTL = 60 * 86_400_000;
/** Registered apps nobody approved are removed after this. */
const UNUSED_CLIENT_TTL = 86_400_000;

export const SCOPES = {
  read: 'See your websites and all their analytics: visitors, sources, pages, goals, funnels, customers and revenue',
  write: 'Make changes: add, edit and delete websites and funnels, rename or delete goals, record goals and payments',
} as const;
export type Scope = keyof typeof SCOPES;
const ALL_SCOPES = Object.keys(SCOPES) as Scope[];

export const mcpResource = (c: Context<AppEnv>) => `${new URL(c.req.url).origin}/mcp`;

/** Where agents find out how to sign in, sent with every 401 from /mcp. */
export const resourceMetadataUrl = (c: Context<AppEnv>) => `${new URL(c.req.url).origin}/.well-known/oauth-protected-resource/mcp`;

function parseScope(raw: string | null | undefined): Scope[] {
  const asked = (raw ?? '').split(/\s+/).filter((s): s is Scope => (ALL_SCOPES as string[]).includes(s));
  // Clients that ask for nothing we know (or nothing at all) get full access, which the owner can narrow on the consent page.
  return asked.length ? [...new Set(asked)] : ALL_SCOPES;
}

const hash = (env: Env, token: string) => hmacHex(env.SESSION_SECRET, token);

// ---------- discovery

export function protectedResourceMetadata(c: Context<AppEnv>) {
  return c.json({
    resource: mcpResource(c),
    authorization_servers: [new URL(c.req.url).origin],
    scopes_supported: ALL_SCOPES,
    bearer_methods_supported: ['header'],
    resource_name: 'Minilytics',
  });
}

export function authorizationServerMetadata(c: Context<AppEnv>) {
  const origin = new URL(c.req.url).origin;
  return c.json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    scopes_supported: ALL_SCOPES,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
  });
}

// ---------- dynamic client registration (RFC 7591)

interface Client {
  id: string;
  name: string;
  redirect_uris: string;
  secret_hash: string | null;
  created_at: number;
  approved_at: number | null;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** https anywhere, http only on this machine (local agents), or an app's own scheme (cursor://, vscode://). */
export function validRedirectUri(uri: unknown): uri is string {
  if (typeof uri !== 'string' || uri.length > 2000) return false;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (u.protocol === 'https:') return true;
  if (u.protocol === 'http:') return LOOPBACK.has(u.hostname);
  return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol) && !['javascript:', 'data:', 'file:', 'blob:', 'about:', 'vbscript:'].includes(u.protocol);
}

/** Exact match, except that a loopback redirect may use any port (RFC 8252: local apps pick a free port at runtime). */
export function redirectMatches(registered: string[], uri: string): boolean {
  if (registered.includes(uri)) return true;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' || !LOOPBACK.has(u.hostname)) return false;
  return registered.some((r) => {
    try {
      const v = new URL(r);
      return v.protocol === 'http:' && v.hostname === u.hostname && v.pathname === u.pathname && v.search === u.search;
    } catch {
      return false;
    }
  });
}

export async function register(c: Context<AppEnv>) {
  if (!c.env.SESSION_SECRET) return oauthError(c, 'server_error', 'Set SESSION_SECRET (see README).', 500);
  const b = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!b) return oauthError(c, 'invalid_client_metadata', 'Send the client metadata as JSON.');
  const uris = b.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every(validRedirectUri)) {
    return oauthError(c, 'invalid_redirect_uri', 'redirect_uris must be https URLs, http://localhost URLs or app URLs (at most 10).');
  }
  const method = typeof b.token_endpoint_auth_method === 'string' ? b.token_endpoint_auth_method : 'client_secret_basic';
  if (!['none', 'client_secret_post', 'client_secret_basic'].includes(method)) {
    return oauthError(c, 'invalid_client_metadata', `Unsupported token_endpoint_auth_method ${method}.`);
  }
  const grantTypes = Array.isArray(b.grant_types) ? b.grant_types : ['authorization_code', 'refresh_token'];
  if (!grantTypes.every((g) => g === 'authorization_code' || g === 'refresh_token')) {
    return oauthError(c, 'invalid_client_metadata', 'Only the authorization_code and refresh_token grant types are supported.');
  }
  const name = (typeof b.client_name === 'string' && b.client_name.trim() ? b.client_name.trim() : 'Unnamed app').slice(0, 100);
  const id = 'mlc_' + randomId(16);
  const secret = method === 'none' ? null : 'mls_' + randomId(24);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO oauth_clients (id, name, redirect_uris, secret_hash, created_at) VALUES (?, ?, ?, ?, ?)').bind(
      id,
      name,
      JSON.stringify(uris),
      secret ? await hash(c.env, secret) : null,
      now,
    ),
    // Anyone can register, so don't keep apps nobody approved.
    c.env.DB.prepare('DELETE FROM oauth_clients WHERE approved_at IS NULL AND created_at < ?').bind(now - UNUSED_CLIENT_TTL),
  ]);
  c.header('Cache-Control', 'no-store');
  return c.json(
    {
      client_id: id,
      client_id_issued_at: Math.floor(now / 1000),
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_name: name,
      redirect_uris: uris,
      token_endpoint_auth_method: method,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
    201,
  );
}

// ---------- authorization (the owner approves the agent)

interface AuthRequest {
  client: Client;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  scope: Scope[];
  resource: string | null;
}

type Parsed = { ok: true; req: AuthRequest } | { ok: false; page: string } | { ok: false; redirect: string };

const PARAMS = ['response_type', 'client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource'] as const;

function resourceOk(c: Context<AppEnv>, resource: string | null | undefined) {
  if (!resource) return true;
  const want = mcpResource(c);
  const r = resource.replace(/\/+$/, '');
  return r === want || r === new URL(want).origin;
}

/** Check an authorization request. Bad client or redirect: show an error here. Anything else goes back to the app. */
async function parseAuthRequest(c: Context<AppEnv>, p: Record<string, string | undefined>): Promise<Parsed> {
  const client = p.client_id
    ? await c.env.DB.prepare('SELECT * FROM oauth_clients WHERE id = ?').bind(p.client_id).first<Client>()
    : null;
  if (!client) return { ok: false, page: 'This app isn’t registered (or its registration expired). Start connecting again from the app.' };
  const registered = JSON.parse(client.redirect_uris) as string[];
  const redirectUri = p.redirect_uri ?? (registered.length === 1 ? registered[0] : '');
  if (!redirectUri || !redirectMatches(registered, redirectUri)) {
    return { ok: false, page: 'The app sent an unexpected return address, so it wasn’t sent back. Start connecting again from the app.' };
  }
  const back = (error: string, description: string) => {
    const u = new URL(redirectUri);
    u.searchParams.set('error', error);
    u.searchParams.set('error_description', description);
    if (p.state) u.searchParams.set('state', p.state);
    u.searchParams.set('iss', new URL(c.req.url).origin);
    return { ok: false as const, redirect: u.toString() };
  };
  if (p.response_type !== 'code') return back('unsupported_response_type', 'Only response_type=code is supported.');
  if (!p.code_challenge || p.code_challenge_method !== 'S256' || !/^[\w-]{43}$/.test(p.code_challenge)) {
    return back('invalid_request', 'PKCE is required: send code_challenge with code_challenge_method=S256.');
  }
  if (!resourceOk(c, p.resource)) return back('invalid_target', `The only resource here is ${mcpResource(c)}.`);
  return {
    ok: true,
    req: {
      client,
      redirectUri,
      state: p.state ?? null,
      codeChallenge: p.code_challenge,
      scope: parseScope(p.scope),
      resource: p.resource ?? null,
    },
  };
}

const CONSENT_TTL = 30 * 60_000;
const consentValue = (subject: string, clientId: string, expires: number) => `consent|${subject}|${clientId}|${expires}`;

export async function authorizePage(c: Context<AppEnv>) {
  if (!c.env.SESSION_SECRET) return htmlPage(c, 'Not set up', '<p>Set SESSION_SECRET first (see the README).</p>', 500);
  const q = c.req.query();
  const parsed = await parseAuthRequest(c, q);
  if (!parsed.ok) return 'redirect' in parsed ? c.redirect(parsed.redirect) : htmlPage(c, 'Can’t connect', `<p>${esc(parsed.page)}</p>`, 400);

  const user = await currentUser(c);
  if (!user) {
    // Sign in first, then come straight back here.
    const here = '/oauth/authorize?' + new URLSearchParams(PARAMS.flatMap((k) => (q[k] ? [[k, q[k]]] : []))).toString();
    return c.redirect(isHosted(c.env) ? `/api/auth/google?next=${encodeURIComponent(here)}` : `/?next=${encodeURIComponent(here)}`);
  }
  const { req } = parsed;
  const expires = Date.now() + CONSENT_TTL;
  const csrf = await signToken(c.env.SESSION_SECRET, consentValue(subjectOf(c.env, user), req.client.id, expires));
  const hidden = PARAMS.filter((k) => q[k])
    .map((k) => `<input type="hidden" name="${k}" value="${esc(q[k])}">`)
    .join('');
  const who = user.email ? ` as <b>${esc(user.email)}</b>` : '';
  const target = new URL(req.redirectUri);
  const returnTo = target.protocol === 'https:' || target.protocol === 'http:' ? target.host : `${target.protocol}//${target.host}`;
  const body = `
    <h1>Connect <span class="name">${esc(req.client.name)}</span>?</h1>
    <p class="muted">It wants to use your Minilytics account${who}.</p>
    <form method="post" action="/oauth/authorize">
      ${hidden}
      <input type="hidden" name="csrf" value="${esc(csrf)}">
      <input type="hidden" name="expires" value="${expires}">
      <ul class="perms">
        <li><span class="tick">✓</span> ${esc(SCOPES.read)}</li>
        ${
          req.scope.includes('write')
            ? `<li><label><input type="checkbox" name="allow_write" value="1" checked> ${esc(SCOPES.write)}</label></li>`
            : ''
        }
      </ul>
      <p class="small muted">You'll go back to <b>${esc(returnTo)}</b>. The app chose its own name, so only approve it if you just started connecting it. You can disconnect it any time from your websites page → AI agents.</p>
      <div class="actions">
        <button class="btn" name="decision" value="deny">Cancel</button>
        <button class="btn btn-dark" name="decision" value="approve" autofocus>Approve</button>
      </div>
    </form>`;
  return htmlPage(c, `Connect ${req.client.name}`, body);
}

export async function authorizeDecision(c: Context<AppEnv>) {
  if (!c.env.SESSION_SECRET) return htmlPage(c, 'Not set up', '<p>Set SESSION_SECRET first (see the README).</p>', 500);
  const form = (await c.req.parseBody()) as Record<string, string | undefined>;
  const parsed = await parseAuthRequest(c, form);
  if (!parsed.ok) return 'redirect' in parsed ? c.redirect(parsed.redirect) : htmlPage(c, 'Can’t connect', `<p>${esc(parsed.page)}</p>`, 400);
  const { req } = parsed;
  const user = await currentUser(c);
  const expires = Number(form.expires);
  const csrfOk =
    !!user &&
    expires > Date.now() &&
    (await verifyToken(c.env.SESSION_SECRET, form.csrf)) === consentValue(subjectOf(c.env, user), req.client.id, expires);
  if (!user || !csrfOk) return htmlPage(c, 'Expired', '<p>This approval page expired. Start connecting again from the app.</p>', 400);

  const back = new URL(req.redirectUri);
  if (req.state) back.searchParams.set('state', req.state);
  back.searchParams.set('iss', new URL(c.req.url).origin);
  if (form.decision !== 'approve') {
    back.searchParams.set('error', 'access_denied');
    back.searchParams.set('error_description', 'The owner declined.');
    return c.redirect(back.toString());
  }

  // Reading always comes with access; changes only when asked for and left ticked.
  const scope: Scope[] = req.scope.includes('write') && form.allow_write === '1' ? ['read', 'write'] : ['read'];
  const grantId = randomId(12);
  const code = 'mlo_' + randomId(24);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO oauth_grants (id, client_id, subject, scope, resource, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
      grantId,
      req.client.id,
      subjectOf(c.env, user),
      scope.join(' '),
      req.resource,
      now,
    ),
    c.env.DB.prepare(
      "INSERT INTO oauth_tokens (hash, kind, grant_id, expires_at, redirect_uri, code_challenge) VALUES (?, 'code', ?, ?, ?, ?)",
    ).bind(await hash(c.env, code), grantId, now + CODE_TTL, req.redirectUri, req.codeChallenge),
    c.env.DB.prepare('UPDATE oauth_clients SET approved_at = ? WHERE id = ?').bind(now, req.client.id),
  ]);
  back.searchParams.set('code', code);
  return c.redirect(back.toString());
}

// ---------- token endpoint

function oauthError(c: Context<AppEnv>, error: string, description: string, status: 400 | 401 | 500 = 400) {
  c.header('Cache-Control', 'no-store');
  return c.json({ error, error_description: description }, status);
}

async function readForm(c: Context<AppEnv>): Promise<Record<string, string | undefined>> {
  if ((c.req.header('content-type') ?? '').includes('application/json')) {
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, typeof v === 'string' ? v : undefined]));
  }
  return (await c.req.parseBody().catch(() => ({}))) as Record<string, string | undefined>;
}

/** The calling app, checked against its secret when it has one. */
async function authenticateClient(c: Context<AppEnv>, form: Record<string, string | undefined>): Promise<Client | null> {
  let id = form.client_id;
  let secret = form.client_secret;
  const basic = c.req.header('authorization')?.match(/^Basic\s+(.+)$/i)?.[1];
  if (basic) {
    try {
      const [u, p] = atob(basic).split(':');
      id = decodeURIComponent(u);
      secret = decodeURIComponent(p ?? '');
    } catch {
      return null;
    }
  }
  if (!id) return null;
  const client = await c.env.DB.prepare('SELECT * FROM oauth_clients WHERE id = ?').bind(id).first<Client>();
  if (!client) return null;
  if (client.secret_hash && (!secret || !passwordsMatch(await hash(c.env, secret), client.secret_hash))) return null;
  return client;
}

interface Grant {
  id: string;
  client_id: string;
  subject: string;
  scope: string;
  resource: string | null;
}

async function issueTokens(c: Context<AppEnv>, grant: Grant) {
  const access = 'mla_' + randomId(24);
  const refresh = 'mlr_' + randomId(24);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO oauth_tokens (hash, kind, grant_id, expires_at) VALUES (?, 'access', ?, ?)").bind(
      await hash(c.env, access),
      grant.id,
      now + ACCESS_TTL,
    ),
    c.env.DB.prepare("INSERT INTO oauth_tokens (hash, kind, grant_id, expires_at) VALUES (?, 'refresh', ?, ?)").bind(
      await hash(c.env, refresh),
      grant.id,
      now + REFRESH_TTL,
    ),
    c.env.DB.prepare('UPDATE oauth_grants SET last_used_at = ? WHERE id = ?').bind(now, grant.id),
    // Housekeeping: expired tokens, and approvals with nothing left to use.
    c.env.DB.prepare('DELETE FROM oauth_tokens WHERE expires_at < ?').bind(now),
    c.env.DB.prepare('DELETE FROM oauth_grants WHERE created_at < ? AND id NOT IN (SELECT grant_id FROM oauth_tokens)').bind(now - CODE_TTL),
  ]);
  c.header('Cache-Control', 'no-store');
  return c.json({ access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL / 1000, refresh_token: refresh, scope: grant.scope });
}

/** Take a code or refresh token out of the store: each one works once. */
async function consume(env: Env, token: string | undefined, kind: 'code' | 'refresh') {
  if (!token) return null;
  return env.DB.prepare('DELETE FROM oauth_tokens WHERE hash = ? AND kind = ? RETURNING *')
    .bind(await hash(env, token), kind)
    .first<{ grant_id: string; expires_at: number; redirect_uri: string | null; code_challenge: string | null }>();
}

export async function token(c: Context<AppEnv>) {
  if (!c.env.SESSION_SECRET) return oauthError(c, 'server_error', 'Set SESSION_SECRET (see README).', 500);
  const form = await readForm(c);
  const client = await authenticateClient(c, form);
  if (!client) return oauthError(c, 'invalid_client', 'Unknown client, or wrong client secret.', 401);

  const row =
    form.grant_type === 'authorization_code'
      ? await consume(c.env, form.code, 'code')
      : form.grant_type === 'refresh_token'
        ? await consume(c.env, form.refresh_token, 'refresh')
        : undefined;
  if (row === undefined) return oauthError(c, 'unsupported_grant_type', 'Use authorization_code or refresh_token.');
  const invalid = (why: string) => oauthError(c, 'invalid_grant', why);
  if (!row || row.expires_at < Date.now()) return invalid('The code or refresh token is invalid, used or expired.');
  const grant = await c.env.DB.prepare('SELECT * FROM oauth_grants WHERE id = ? AND client_id = ?').bind(row.grant_id, client.id).first<Grant>();
  if (!grant) return invalid('The code or refresh token was issued to another client, or access was revoked.');

  if (form.grant_type === 'authorization_code') {
    if (form.redirect_uri && form.redirect_uri !== row.redirect_uri) return invalid('redirect_uri does not match the authorization request.');
    const verifier = form.code_verifier ?? '';
    if (!/^[\w.~-]{43,128}$/.test(verifier) || (await sha256Base64Url(verifier)) !== row.code_challenge) {
      return invalid('PKCE verification failed.');
    }
    if (!resourceOk(c, form.resource)) return oauthError(c, 'invalid_target', `The only resource here is ${mcpResource(c)}.`);
  }
  // The owner may have lost access since (account deleted, switched between self-hosted and hosted).
  if (!(await userForSubject(c.env, grant.subject))) {
    await revokeGrant(c.env.DB, grant.id);
    return invalid('The account behind this access no longer exists.');
  }
  return issueTokens(c, grant);
}

async function revokeGrant(db: D1Database, grantId: string) {
  await db.batch([
    db.prepare('DELETE FROM oauth_tokens WHERE grant_id = ?').bind(grantId),
    db.prepare('DELETE FROM oauth_grants WHERE id = ?').bind(grantId),
  ]);
}

/** RFC 7009: revoking either token disconnects the agent. Always 200, so tokens can't be probed. */
export async function revoke(c: Context<AppEnv>) {
  if (!c.env.SESSION_SECRET) return c.body(null, 200);
  const form = await readForm(c);
  if (form.token) {
    const row = await c.env.DB.prepare("SELECT grant_id FROM oauth_tokens WHERE hash = ? AND kind IN ('access', 'refresh')")
      .bind(await hash(c.env, form.token))
      .first<{ grant_id: string }>();
    if (row) await revokeGrant(c.env.DB, row.grant_id);
  }
  return c.body(null, 200);
}

// ---------- using a token

export interface AgentAuth {
  user: User;
  scopes: Set<Scope>;
  grantId: string;
  clientName: string;
}

/** The agent behind `Authorization: Bearer <access token>`, or null. */
export async function bearerAuth(c: Context<AppEnv>): Promise<AgentAuth | null> {
  const t = c.req.header('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!t || !c.env.SESSION_SECRET) return null;
  const row = await c.env.DB.prepare(
    `SELECT t.expires_at, g.id, g.subject, g.scope, g.last_used_at, cl.name
     FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id JOIN oauth_clients cl ON cl.id = g.client_id
     WHERE t.hash = ? AND t.kind = 'access'`,
  )
    .bind(await hash(c.env, t))
    .first<{ expires_at: number; id: string; subject: string; scope: string; last_used_at: number | null; name: string }>();
  if (!row || row.expires_at < Date.now()) return null;
  const user = await userForSubject(c.env, row.subject);
  if (!user) return null;
  const now = Date.now();
  if (!row.last_used_at || now - row.last_used_at > 5 * 60_000) {
    c.executionCtx.waitUntil(c.env.DB.prepare('UPDATE oauth_grants SET last_used_at = ? WHERE id = ?').bind(now, row.id).run().catch(() => {}));
  }
  return { user, scopes: new Set(parseScope(row.scope)), grantId: row.id, clientName: row.name };
}

// ---------- the owner's list of connected agents (dashboard)

export async function listGrants(c: Context<AppEnv>) {
  const now = Date.now();
  const rows = await c.env.DB.prepare(
    `SELECT g.id, g.scope, g.created_at, g.last_used_at, cl.name, cl.redirect_uris
     FROM oauth_grants g JOIN oauth_clients cl ON cl.id = g.client_id
     WHERE g.subject = ? AND EXISTS (SELECT 1 FROM oauth_tokens t WHERE t.grant_id = g.id AND t.kind != 'code' AND t.expires_at > ?)
     ORDER BY COALESCE(g.last_used_at, g.created_at) DESC`,
  )
    .bind(subjectOf(c.env, c.get('user')), now)
    .all<{ id: string; scope: string; created_at: number; last_used_at: number | null; name: string; redirect_uris: string }>();
  return c.json(
    rows.results.map((r) => ({
      id: r.id,
      name: r.name,
      scopes: r.scope.split(' ').filter(Boolean),
      created_at: r.created_at,
      last_used_at: r.last_used_at,
    })),
  );
}

export async function deleteGrant(c: Context<AppEnv>) {
  const g = await c.env.DB.prepare('SELECT id FROM oauth_grants WHERE id = ? AND subject = ?')
    .bind(c.req.param('gid'), subjectOf(c.env, c.get('user')))
    .first<{ id: string }>();
  if (!g) return c.json({ error: 'not found' }, 404);
  await revokeGrant(c.env.DB, g.id);
  return c.json({ ok: true });
}

// ---------- the consent / error page (server-rendered, so it works before the dashboard app loads)

const esc = (s: string | null | undefined) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

function htmlPage(c: Context<AppEnv>, title: string, body: string, status: 200 | 400 | 500 = 200) {
  c.header('Cache-Control', 'no-store');
  c.header('X-Frame-Options', 'DENY');
  c.header('Content-Security-Policy', "frame-ancestors 'none'");
  c.header('X-Robots-Tag', 'noindex');
  c.header('Referrer-Policy', 'no-referrer');
  return c.html(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Minilytics</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
  :root { --paper: #f8f6f3; --card: #fff; --ink: #1c1917; --muted: #78716c; --line: #e7e5e4; --soft: #f5f5f4; --accent: #2f7fd6; }
  @media (prefers-color-scheme: dark) {
    :root { --paper: #0f0e0d; --card: #1a1817; --ink: #f5f5f4; --muted: #a8a29e; --line: #33302d; --soft: #2a2725; --accent: #5aa0ea; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px;
         background: var(--paper); color: var(--ink); font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  .card { width: 100%; max-width: 440px; background: var(--card); border: 1px solid var(--line); border-radius: 20px; padding: 32px; }
  .logo { display: flex; align-items: center; gap: 8px; font-weight: 600; }
  .logo img { width: 24px; height: 24px; }
  h1 { font-size: 22px; line-height: 1.3; margin: 24px 0 4px; letter-spacing: -0.01em; }
  .name { overflow-wrap: anywhere; }
  .muted { color: var(--muted); margin: 0; }
  .small { font-size: 13px; margin-top: 16px; }
  .perms { list-style: none; padding: 0; margin: 20px 0 0; display: grid; gap: 8px; }
  .perms li { background: var(--soft); border-radius: 12px; padding: 10px 12px; font-size: 14px; }
  .perms label { display: flex; gap: 8px; align-items: flex-start; cursor: pointer; }
  .perms input { margin-top: 3px; accent-color: var(--accent); }
  .tick { color: var(--accent); font-weight: 600; margin-right: 4px; }
  .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 24px; }
  .btn { font: inherit; font-weight: 500; border-radius: 12px; padding: 8px 16px; border: 1px solid var(--line); background: var(--card); color: var(--ink); cursor: pointer; }
  .btn:hover { background: var(--soft); }
  .btn-dark { background: var(--ink); color: var(--card); border-color: var(--ink); }
  .btn-dark:hover { background: var(--ink); opacity: 0.9; }
  b { font-weight: 600; overflow-wrap: anywhere; }
</style>
</head>
<body>
<main class="card">
  <div class="logo"><img src="/favicon.svg" alt="">Minilytics</div>
  ${body}
</main>
</body>
</html>`,
    status,
  );
}
