// End-to-end test of the MCP server and its OAuth flow against a running self-hosted `wrangler dev`
// (default http://localhost:8787). Usage: BASE=http://localhost:8787 ADMIN_PASSWORD=change-me node scripts/smoke-mcp.mjs
import crypto from 'node:crypto';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'change-me';
let cookie = '';
const assert = (cond, msg) => {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('ok -', msg);
};

async function call(path, opts = {}) {
  const res = await fetch(BASE + path, { redirect: 'manual', ...opts, headers: { 'content-type': 'application/json', cookie, ...(opts.headers ?? {}) } });
  const set = res.headers.get('set-cookie');
  if (set && set.startsWith('ml_auth=')) cookie = set.split(';')[0];
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}

let rpcId = 0;
async function mcp(token, method, params) {
  const res = await fetch(BASE + '/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}
const tool = async (token, name, args = {}) => {
  const r = await mcp(token, 'tools/call', { name, arguments: args });
  const res = r.body.result;
  return { isError: !!res.isError, data: res.isError ? res.content[0].text : JSON.parse(res.content[0].text) };
};

// ---- discovery and auth challenge
const noAuth = await fetch(BASE + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
assert(noAuth.status === 401, '/mcp needs a token');
assert(/resource_metadata=".*\/.well-known\/oauth-protected-resource"/.test(noAuth.headers.get('www-authenticate') ?? ''), '401 points to protected resource metadata');
const prm = (await call('/.well-known/oauth-protected-resource')).body;
assert(prm.resource === `${BASE}/mcp` && prm.authorization_servers[0] === BASE, 'protected resource metadata');
const asm = (await call('/.well-known/oauth-authorization-server')).body;
assert(asm.code_challenge_methods_supported.includes('S256') && asm.registration_endpoint, 'authorization server metadata');
assert((await mcp('mlp_bogus', 'tools/list')).status === 401, 'unknown token rejected');

// ---- personal token
assert((await call('/api/tokens')).status === 401, 'token API needs login');
assert((await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: PASSWORD }) })).status === 200, 'login');
const pat = (await call('/api/tokens', { method: 'POST', body: JSON.stringify({ name: 'smoke' }) })).body;
assert(pat.token.startsWith('mlp_'), 'personal token created');

const init = await mcp(pat.token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } });
assert(init.body.result.serverInfo.name === 'minilytics', 'initialize');
const tools = (await mcp(pat.token, 'tools/list')).body.result.tools;
assert(tools.length >= 9, `tools/list (${tools.length} tools)`);

const { data: list } = await tool(pat.token, 'list_sites');
assert(Array.isArray(list.sites), `list_sites (${list.sites.length} sites)`);
if (list.sites.length) {
  const s = list.sites[0];
  const ov = await tool(pat.token, 'get_overview', { site: s.domain, period: '30d' });
  assert(!ov.isError && typeof ov.data.current.visitors === 'number' && ov.data.series.length > 0, `get_overview by domain (${s.domain}: ${ov.data.current.visitors} visitors)`);
  const bd = await tool(pat.token, 'get_breakdown', { site: s.id, dimension: 'source', sort: 'revenue', limit: 5 });
  assert(!bd.isError && bd.data.rows.length <= 5, 'get_breakdown sorted by revenue');
  for (const name of ['get_realtime', 'list_customers', 'list_visitors', 'list_funnels']) {
    const r = await tool(pat.token, name, { site: s.id, period: '90d' });
    assert(!r.isError, name);
  }
  const vis = await tool(pat.token, 'list_visitors', { site: s.id, period: 'all', limit: 1 });
  if (vis.data.visitors[0]) assert(!(await tool(pat.token, 'get_visitor', { site: s.id, visitor_id: vis.data.visitors[0].visitor_id })).isError, 'get_visitor');
  const f = await tool(pat.token, 'get_funnel', { site: s.id, steps: [{ type: 'page', value: '/*' }, { type: 'goal', value: 'signup' }] });
  assert(!f.isError && f.data.steps.length === 2, 'ad-hoc funnel');
  const custom = await tool(pat.token, 'get_overview', { site: s.id, period: 'custom', from: '2025-01-01', to: '2025-01-31', filters: { country: 'US' } });
  assert(!custom.isError, 'custom range with filters');
}
assert((await tool(pat.token, 'get_overview', { site: 'not-my-site.com' })).isError, 'unknown site is a tool error');

// ---- OAuth: register, consent, code + PKCE, refresh, revoke
const reg = await call('/oauth/register', { method: 'POST', body: JSON.stringify({ client_name: 'Smoke App', redirect_uris: ['http://localhost:9999/cb'] }) });
assert(reg.status === 201 && reg.body.client_id, 'dynamic client registration');
assert((await call('/oauth/register', { method: 'POST', body: JSON.stringify({ redirect_uris: ['http://evil.com/cb'] }) })).status === 400, 'non-loopback http redirect rejected');
const verifier = crypto.randomBytes(32).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
const q = new URLSearchParams({ response_type: 'code', client_id: reg.body.client_id, redirect_uri: 'http://localhost:9999/cb', code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', scope: 'read' });
const consent = await call(`/oauth/authorize?${q}`);
assert(consent.status === 200 && consent.body.includes('Smoke App') && consent.body.includes('Allow access'), 'consent page');
const badRedirect = await call(`/oauth/authorize?${new URLSearchParams({ ...Object.fromEntries(q), redirect_uri: 'https://evil.com/' })}`);
assert(badRedirect.status === 400, 'unregistered redirect_uri refused on the page');
const savedCookie = cookie;
cookie = '';
const loggedOut = await call(`/oauth/authorize?${q}`);
assert(loggedOut.body.includes('Sign in') && loggedOut.body.includes('next='), 'logged-out consent asks to sign in');
cookie = savedCookie;
const form = new URLSearchParams({ ...Object.fromEntries(q), decision: 'allow' });
const foreign = await call('/oauth/authorize', { method: 'POST', body: form.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.com' } });
assert(foreign.status === 403, 'consent from another origin refused');
const allowed = await call('/oauth/authorize', { method: 'POST', body: form.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE } });
const loc = new URL(allowed.headers.get('location'));
assert(allowed.status === 302 && loc.searchParams.get('state') === 'xyz' && loc.searchParams.get('code'), 'approve redirects back with code + state');
const code = loc.searchParams.get('code');

const tokenReq = (params) => fetch(BASE + '/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) }).then(async (r) => ({ status: r.status, body: await r.json() }));
const wrongPkce = await tokenReq({ grant_type: 'authorization_code', code, code_verifier: 'x'.repeat(43), client_id: reg.body.client_id, redirect_uri: 'http://localhost:9999/cb' });
assert(wrongPkce.status === 400, 'wrong PKCE verifier rejected (and burns the code)');

// The failed attempt used the code up, so authorize again.
const again = await call('/oauth/authorize', { method: 'POST', body: form.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
const code2 = new URL(again.headers.get('location')).searchParams.get('code');
const tok = await tokenReq({ grant_type: 'authorization_code', code: code2, code_verifier: verifier, client_id: reg.body.client_id, redirect_uri: 'http://localhost:9999/cb' });
assert(tok.status === 200 && tok.body.access_token.startsWith('mla_') && tok.body.refresh_token, 'code exchanged for tokens');
assert((await tokenReq({ grant_type: 'authorization_code', code: code2, code_verifier: verifier })).status === 400, 'code is single-use');
assert(!(await tool(tok.body.access_token, 'list_sites')).isError, 'OAuth access token works on /mcp');
assert((await mcp(tok.body.refresh_token, 'tools/list')).status === 401, 'refresh token cannot call /mcp');

const ref = await tokenReq({ grant_type: 'refresh_token', refresh_token: tok.body.refresh_token, client_id: reg.body.client_id });
assert(ref.status === 200 && ref.body.refresh_token !== tok.body.refresh_token, 'refresh rotates tokens');
assert((await tokenReq({ grant_type: 'refresh_token', refresh_token: tok.body.refresh_token })).status === 400, 'old refresh token stops working');

const grants = (await call('/api/tokens')).body;
const app = grants.find((g) => g.type === 'app' && g.name === 'Smoke App');
assert(app && grants.some((g) => g.type === 'token' && g.name === 'smoke'), 'dashboard lists the app and the token');
await call(`/api/tokens/${app.id}`, { method: 'DELETE' });
assert((await mcp(ref.body.access_token, 'tools/list')).status === 401, 'disconnecting the app revokes its tokens');
await call(`/api/tokens/${pat.id}`, { method: 'DELETE' });
assert((await mcp(pat.token, 'tools/list')).status === 401, 'revoked personal token stops working');

console.log('\nAll MCP smoke checks passed.');
