import type { Context } from 'hono';
import { currentUser, isHosted, subjectOf, userFromSubject } from './auth';
import type { AppEnv } from './env';
import { pkceChallenge, randomId, safeEqual, sha256Hex } from './lib/crypto';
import { ACCESS_TTL_MS, createToken, REFRESH_TTL_MS } from './tokens';

/**
 * A small OAuth 2.1 authorization server, so AI apps (Claude.ai and ChatGPT connectors, Claude Code, Cursor…) can
 * connect to /mcp by URL alone: they discover these endpoints, register themselves, send the owner to a consent
 * page, and get a read-only token. Public clients only, PKCE (S256) required, codes are single use.
 */

const CODE_TTL_MS = 10 * 60_000;
export const SCOPE = 'read';

const origin = (c: Context<AppEnv>) => new URL(c.req.url).origin;

// ---------- discovery

/** RFC 9728: where /mcp's tokens come from. */
export function protectedResourceMetadata(c: Context<AppEnv>) {
  const o = origin(c);
  return c.json({
    resource: `${o}/mcp`,
    authorization_servers: [o],
    bearer_methods_supported: ['header'],
    scopes_supported: [SCOPE],
    resource_name: 'Minilytics',
    resource_documentation: 'https://github.com/surendrapandar/minilytics#use-it-from-ai-assistants-mcp',
  });
}

/** RFC 8414 (also served as OpenID discovery, which some clients try first). */
export function authServerMetadata(c: Context<AppEnv>) {
  const o = origin(c);
  return c.json({
    issuer: o,
    authorization_endpoint: `${o}/oauth/authorize`,
    token_endpoint: `${o}/oauth/token`,
    registration_endpoint: `${o}/oauth/register`,
    revocation_endpoint: `${o}/oauth/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [SCOPE],
  });
}

// ---------- dynamic client registration (RFC 7591)

/** https anywhere, plain http only on this machine, or an app's own scheme (cursor://, vscode://). */
export function allowedRedirect(uri: string): boolean {
  if (uri.length > 500) return false;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (u.protocol === 'https:') return true;
  if (u.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol) && !['javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:'].includes(u.protocol);
}

const oauthError = (c: Context<AppEnv>, error: string, description: string, status: 400 | 401 = 400) =>
  c.json({ error, error_description: description }, status);

export async function registerClient(c: Context<AppEnv>) {
  const b = await c.req.json<{ client_name?: unknown; redirect_uris?: unknown }>().catch(() => null);
  if (!b) return oauthError(c, 'invalid_client_metadata', 'Expected a JSON body.');
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.filter((u): u is string => typeof u === 'string') : [];
  if (!uris.length || uris.length > 10) return oauthError(c, 'invalid_redirect_uri', 'Give 1 to 10 redirect_uris.');
  const bad = uris.find((u) => !allowedRedirect(u));
  if (bad) return oauthError(c, 'invalid_redirect_uri', `Redirect URI not allowed: ${bad}`);
  const name = (typeof b.client_name === 'string' && b.client_name.trim() ? b.client_name.trim() : new URL(uris[0]).host || 'AI app').slice(0, 100);
  const id = 'mlc_' + randomId(16);
  const now = Date.now();
  await c.env.DB.prepare('INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, name, JSON.stringify(uris), now)
    .run();
  return c.json(
    {
      client_id: id,
      client_id_issued_at: Math.floor(now / 1000),
      client_name: name,
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: SCOPE,
    },
    201,
  );
}

interface Client {
  id: string;
  name: string;
  redirect_uris: string;
}

const getClient = (c: Context<AppEnv>, id: string | undefined) =>
  id ? c.env.DB.prepare('SELECT * FROM oauth_clients WHERE id = ?').bind(id).first<Client>() : Promise.resolve(null);

// ---------- consent page

interface AuthRequest {
  client: Client;
  redirectUri: string;
  challenge: string;
  state: string | undefined;
}

/** Checks an authorize request. Errors about the app itself can't be sent back to it, so they're shown on the page. */
async function readAuthRequest(c: Context<AppEnv>, q: Record<string, string | undefined>): Promise<AuthRequest | { page: string } | { redirect: string }> {
  const client = await getClient(c, q.client_id);
  if (!client) return { page: 'This app is not registered with Minilytics. Try connecting it again from the app.' };
  const registered: string[] = JSON.parse(client.redirect_uris);
  const redirectUri = q.redirect_uri ?? (registered.length === 1 ? registered[0] : '');
  if (!registered.includes(redirectUri)) return { page: "The app's redirect address doesn't match what it registered." };
  const back = (error: string, description: string) => ({ redirect: withParams(redirectUri, { error, error_description: description, state: q.state, iss: origin(c) }) });
  if (q.response_type !== 'code') return back('unsupported_response_type', 'Only response_type=code is supported.');
  if (!q.code_challenge || q.code_challenge_method !== 'S256') return back('invalid_request', 'PKCE with code_challenge_method=S256 is required.');
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(q.code_challenge)) return back('invalid_request', 'Malformed code_challenge.');
  return { client, redirectUri, challenge: q.code_challenge, state: q.state };
}

function withParams(uri: string, params: Record<string, string | undefined>) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

export async function authorizePage(c: Context<AppEnv>) {
  c.header('Cache-Control', 'no-store');
  const req = await readAuthRequest(c, c.req.query());
  if ('page' in req) return c.html(page('Can’t connect', `<p>${esc(req.page)}</p>`), 400);
  if ('redirect' in req) return c.redirect(req.redirect);

  const self = new URL(c.req.url);
  const next = self.pathname + self.search;
  const user = await currentUser(c);
  const appName = `<strong>${esc(req.client.name)}</strong>`;
  const host = esc(redirectHost(req.redirectUri));

  if (!user) {
    const signIn = isHosted(c.env) ? `/api/auth/google?next=${encodeURIComponent(next)}` : `/?next=${encodeURIComponent(next)}`;
    return c.html(
      page(
        'Sign in to continue',
        `<p>${appName} wants read-only access to your Minilytics analytics.</p>
         <p>Sign in first, then you'll come back here to approve it.</p>
         <a class="btn dark" href="${esc(signIn)}">${isHosted(c.env) ? 'Continue with Google' : 'Sign in'}</a>`,
      ),
    );
  }
  if (isHosted(c.env) && !user.paid) {
    return c.html(page('Plan needed', `<p>Connecting AI apps needs an active Minilytics plan.</p><a class="btn dark" href="/billing">Choose a plan</a>`), 402);
  }

  const hidden = Object.entries(c.req.query())
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('');
  return c.html(
    page(
      'Connect to Minilytics',
      `<p>${appName} wants to <strong>read</strong> your analytics${user.email ? ` as <strong>${esc(user.email)}</strong>` : ''}:</p>
       <ul>
         <li>Visitors, pages, sources, countries, devices and goals</li>
         <li>Revenue, payments and customer journeys</li>
         <li>Live visitors and funnels</li>
       </ul>
       <p class="muted">It can't change settings, add or delete anything. You can disconnect it any time from the dashboard (“Connect AI”).</p>
       <p class="muted">After approving you'll be sent to <strong>${host}</strong>.</p>
       <form method="post" action="/oauth/authorize">${hidden}
         <div class="row">
           <button class="btn" name="decision" value="deny">Cancel</button>
           <button class="btn dark" name="decision" value="allow" autofocus>Allow access</button>
         </div>
       </form>`,
    ),
  );
}

export async function authorizeSubmit(c: Context<AppEnv>) {
  c.header('Cache-Control', 'no-store');
  // The login cookie is SameSite=Lax, so other sites can't post here as the user; refuse foreign Origins as well.
  const from = c.req.header('origin');
  if (from && from !== origin(c)) return c.html(page('Can’t connect', '<p>This request came from another website.</p>'), 403);
  const form = (await c.req.parseBody()) as Record<string, string | undefined>;
  const req = await readAuthRequest(c, form);
  if ('page' in req) return c.html(page('Can’t connect', `<p>${esc(req.page)}</p>`), 400);
  if ('redirect' in req) return c.redirect(req.redirect);
  const user = await currentUser(c);
  if (!user) {
    const { decision: _d, ...params } = form;
    return c.redirect(`/oauth/authorize?${new URLSearchParams(params as Record<string, string>)}`);
  }
  if (form.decision !== 'allow') {
    return c.redirect(withParams(req.redirectUri, { error: 'access_denied', error_description: 'The owner cancelled.', state: req.state, iss: origin(c) }));
  }
  if (isHosted(c.env) && !user.paid) return c.redirect('/billing');

  const code = randomId(24);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM oauth_codes WHERE expires_at < ?').bind(now),
    c.env.DB.prepare('INSERT INTO oauth_codes (hash, client_id, subject, redirect_uri, code_challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
      await sha256Hex(code),
      req.client.id,
      subjectOf(c.env, user),
      req.redirectUri,
      req.challenge,
      now + CODE_TTL_MS,
    ),
  ]);
  return c.redirect(withParams(req.redirectUri, { code, state: req.state, iss: origin(c) }));
}

// ---------- token endpoint

async function readForm(c: Context<AppEnv>): Promise<Record<string, string | undefined>> {
  if ((c.req.header('content-type') ?? '').includes('application/json')) {
    return ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, string | undefined>;
  }
  return (await c.req.parseBody().catch(() => ({}))) as Record<string, string | undefined>;
}

export async function token(c: Context<AppEnv>) {
  c.header('Cache-Control', 'no-store');
  c.header('Pragma', 'no-cache');
  const f = await readForm(c);
  const now = Date.now();

  if (f.grant_type === 'authorization_code') {
    if (!f.code || !f.code_verifier) return oauthError(c, 'invalid_request', 'code and code_verifier are required.');
    // Deleting while reading makes the code single-use even if it's sent twice at once.
    const row = await c.env.DB.prepare('DELETE FROM oauth_codes WHERE hash = ? RETURNING *')
      .bind(await sha256Hex(f.code))
      .first<{ client_id: string; subject: string; redirect_uri: string; code_challenge: string; expires_at: number }>();
    if (!row || row.expires_at < now) return oauthError(c, 'invalid_grant', 'The code is invalid or expired.');
    if (f.client_id && f.client_id !== row.client_id) return oauthError(c, 'invalid_grant', 'The code was issued to another app.');
    if (f.redirect_uri && f.redirect_uri !== row.redirect_uri) return oauthError(c, 'invalid_grant', 'redirect_uri does not match.');
    if (!safeEqual(await pkceChallenge(f.code_verifier), row.code_challenge)) return oauthError(c, 'invalid_grant', 'PKCE check failed.');
    const client = await getClient(c, row.client_id);
    return issue(c, row.subject, randomId(8), row.client_id, client?.name ?? 'AI app');
  }

  if (f.grant_type === 'refresh_token') {
    if (!f.refresh_token) return oauthError(c, 'invalid_request', 'refresh_token is required.');
    // Refresh tokens rotate: the old one stops working the moment a new pair is issued.
    const row = await c.env.DB.prepare(`DELETE FROM api_tokens WHERE hash = ? AND kind = 'refresh' RETURNING *`)
      .bind(await sha256Hex(f.refresh_token))
      .first<{ subject: string; grant_id: string; client_id: string; name: string; expires_at: number }>();
    if (!row || row.expires_at < now) return oauthError(c, 'invalid_grant', 'The refresh token is invalid or expired.');
    if (f.client_id && f.client_id !== row.client_id) return oauthError(c, 'invalid_grant', 'The token was issued to another app.');
    if (!(await userFromSubject(c.env, row.subject))) return oauthError(c, 'invalid_grant', 'The account no longer exists.');
    return issue(c, row.subject, row.grant_id, row.client_id, row.name);
  }

  return oauthError(c, 'unsupported_grant_type', 'Use authorization_code or refresh_token.');
}

async function issue(c: Context<AppEnv>, subject: string, grantId: string, clientId: string, name: string) {
  const now = Date.now();
  // Old access tokens of this connection, and anything long expired, aren't needed any more.
  await c.env.DB.prepare(`DELETE FROM api_tokens WHERE subject = ? AND expires_at IS NOT NULL AND expires_at < ?`).bind(subject, now).run();
  const t = { subject, grantId, clientId, name };
  const access = await createToken(c.env, { ...t, kind: 'access', ttlMs: ACCESS_TTL_MS });
  const refresh = await createToken(c.env, { ...t, kind: 'refresh', ttlMs: REFRESH_TTL_MS });
  return c.json({ access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_MS / 1000, refresh_token: refresh, scope: SCOPE });
}

/** RFC 7009: an app disconnecting itself. Revoking either token ends the whole connection. */
export async function revoke(c: Context<AppEnv>) {
  const f = await readForm(c);
  if (f.token) {
    const row = await c.env.DB.prepare(`SELECT grant_id, subject FROM api_tokens WHERE hash = ? AND kind IN ('access', 'refresh')`)
      .bind(await sha256Hex(f.token))
      .first<{ grant_id: string; subject: string }>();
    if (row) await c.env.DB.prepare('DELETE FROM api_tokens WHERE subject = ? AND grant_id = ?').bind(row.subject, row.grant_id).run();
  }
  return c.body(null, 200);
}

// ---------- HTML

function redirectHost(uri: string) {
  try {
    const u = new URL(uri);
    return u.host || u.protocol.replace(/:$/, '');
  } catch {
    return uri;
  }
}

export function esc(s: string) {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} · Minilytics</title><link rel="icon" href="/favicon.svg">
<style>
  :root{color-scheme:light dark}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f5f5f4;color:#1c1917;font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
  .card{background:#fff;border:1px solid #e7e5e4;border-radius:20px;box-shadow:0 1px 2px rgba(0,0,0,.04);max-width:440px;width:100%;padding:32px}
  .logo{display:flex;align-items:center;gap:8px;font-weight:600}
  .logo img{width:24px;height:24px}
  h1{font-size:22px;margin:24px 0 8px}
  ul{padding-left:20px;margin:8px 0 16px}
  .muted{color:#78716c;font-size:13px}
  .row{display:flex;gap:8px;justify-content:flex-end;margin-top:24px}
  .btn{display:inline-flex;align-items:center;justify-content:center;border:1px solid #d6d3d1;background:#fff;color:inherit;border-radius:12px;padding:9px 16px;font:inherit;font-weight:500;cursor:pointer;text-decoration:none}
  .btn.dark{background:#1c1917;border-color:#1c1917;color:#fff}
  a.btn{margin-top:16px}
  @media (prefers-color-scheme:dark){body{background:#0c0a09;color:#f5f5f4}.card{background:#1c1917;border-color:#292524}.btn{background:#1c1917;border-color:#44403c}.btn.dark{background:#f5f5f4;color:#1c1917;border-color:#f5f5f4}.muted{color:#a8a29e}}
</style></head><body><main class="card"><div class="logo"><img src="/favicon.svg" alt="">Minilytics</div><h1>${esc(title)}</h1>${body}</main></body></html>`;
}

