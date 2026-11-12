// End-to-end test of the MCP server and its OAuth, against a running `wrangler dev` (default http://localhost:8787).
// Plays an AI agent: discovers the server, registers, gets the owner's approval, then uses every tool.
import crypto from 'node:crypto';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'change-me';
const REDIRECT = 'http://localhost:9999/callback';
const assert = (cond, msg) => {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('ok -', msg);
};
let cookie = '';

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const form = (o) => new URLSearchParams(o).toString();

async function http(path, { headers = {}, ...opts } = {}) {
  const res = await fetch(BASE + path, { redirect: 'manual', ...opts, headers: { cookie, ...headers } });
  const set = res.headers.get('set-cookie');
  if (set && set.startsWith('ml_auth=')) cookie = set.split(';')[0];
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, headers: res.headers, body };
}

// ---- discovery
let r = await http('/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"initialize"}' });
assert(r.status === 401, 'MCP needs a token');
const wwwAuth = r.headers.get('www-authenticate') ?? '';
const prmUrl = /resource_metadata="([^"]+)"/.exec(wwwAuth)?.[1];
assert(prmUrl?.endsWith('/.well-known/oauth-protected-resource/mcp'), '401 points at the resource metadata');
const prm = (await http(new URL(prmUrl).pathname)).body;
assert(prm.resource === `${BASE}/mcp` && prm.authorization_servers[0] === BASE, 'protected resource metadata');
const asm = (await http('/.well-known/oauth-authorization-server')).body;
assert(asm.code_challenge_methods_supported.includes('S256') && asm.registration_endpoint, 'authorization server metadata');
r = await http('/oauth/token', { method: 'OPTIONS', headers: { origin: 'https://inspector.example', 'access-control-request-method': 'POST' } });
assert(r.headers.get('access-control-allow-origin') === '*', 'CORS for browser-based clients');

// ---- registration
r = await http('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://evil.com/cb'] }) });
assert(r.status === 400 && r.body.error === 'invalid_redirect_uri', 'remote http redirect rejected');
r = await http('/oauth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ client_name: 'Smoke Agent', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' }),
});
assert(r.status === 201 && r.body.client_id && !r.body.client_secret, 'public client registered');
const clientId = r.body.client_id;

// ---- authorization
function authUrl(extra = {}) {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(8));
  const q = { response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state, scope: 'read write', resource: `${BASE}/mcp`, ...extra };
  return { url: '/oauth/authorize?' + form(q), verifier, state, q };
}

let a = authUrl();
r = await http(a.url);
assert(r.status === 302 && r.headers.get('location').startsWith('/?next=%2Foauth%2Fauthorize'), 'signed out: sent to sign in, then back');

assert((await http('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) })).status === 200, 'owner signs in');

r = await http(authUrl({ client_id: 'mlc_nope' }).url);
assert(r.status === 400 && r.body.includes('isn’t registered'), 'unknown client gets an error page, no redirect');
r = await http(authUrl({ redirect_uri: 'https://evil.com/cb' }).url);
assert(r.status === 400 && !r.headers.get('location'), 'unregistered redirect_uri is never followed');
r = await http(authUrl({ code_challenge_method: 'plain' }).url);
assert(r.status === 302 && new URL(r.headers.get('location')).searchParams.get('error') === 'invalid_request', 'PKCE S256 required');

async function approve(a, allowWrite) {
  const page = await http(a.url);
  assert(page.status === 200 && page.body.includes('Smoke Agent') && page.headers.get('x-frame-options') === 'DENY', 'consent page shown, not frameable');
  const csrf = /name="csrf" value="([^"]+)"/.exec(page.body)[1];
  const expires = /name="expires" value="([^"]+)"/.exec(page.body)[1];
  const fields = { ...a.q, csrf, expires, decision: 'approve', ...(allowWrite ? { allow_write: '1' } : {}) };
  const res = await http('/oauth/authorize', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form(fields) });
  const loc = new URL(res.headers.get('location'));
  assert(res.status === 302 && loc.origin + loc.pathname === REDIRECT && loc.searchParams.get('state') === a.state, 'approved: back to the agent with state');
  return loc.searchParams.get('code');
}

// Forged approval without the CSRF token
r = await http('/oauth/authorize', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ ...a.q, decision: 'approve' }) });
assert(r.status === 400, 'approval without the consent token is refused');

const tokenReq = (body) => http('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form(body) });

let code = await approve(a, true);
r = await tokenReq({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: 'wrong'.repeat(10) });
assert(r.status === 400 && r.body.error === 'invalid_grant', 'wrong PKCE verifier rejected (and the code is burnt)');
a = authUrl();
code = await approve(a, true);
r = await tokenReq({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: a.verifier, resource: `${BASE}/mcp` });
assert(r.status === 200 && r.body.access_token && r.body.refresh_token && r.body.scope === 'read write', 'code exchanged for tokens');
let tokens = r.body;
r = await tokenReq({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: a.verifier });
assert(r.status === 400 && r.body.error === 'invalid_grant', 'codes work once');

// ---- MCP
let rpcId = 0;
async function rpc(method, params, token = tokens.access_token) {
  const res = await http('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  return res;
}
async function tool(name, args = {}, token) {
  const res = await rpc('tools/call', { name, arguments: args }, token);
  const result = res.body.result;
  if (!result) throw new Error(`${name}: ${JSON.stringify(res.body)}`);
  const text = result.content[0].text;
  return { isError: result.isError, text, data: result.isError ? null : JSON.parse(text) };
}

r = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } });
assert(r.body.result.protocolVersion === '2025-06-18' && r.body.result.capabilities.tools && r.body.result.instructions, 'initialize');
r = await http('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens.access_token}` }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
assert(r.status === 202, 'notifications get 202');
r = await rpc('tools/list');
const allTools = r.body.result.tools.map((t) => t.name);
assert(allTools.length >= 25 && allTools.includes('delete_site'), `tools/list (${allTools.length} tools)`);
assert((await rpc('nope/method')).body.error.code === -32601, 'unknown method');

// Leftovers from an interrupted run
for (const s of (await tool('list_sites')).data.sites) if (s.domain === 'mcp-smoke.com') await tool('delete_site', { site: s.id, confirm_domain: s.domain });

let t = await tool('create_site', { domain: 'https://www.mcp-smoke.com/', name: 'MCP Smoke', timezone: 'Europe/Berlin', currency: 'EUR' });
assert(!t.isError && t.data.domain === 'mcp-smoke.com' && t.data.setup.script_tag.includes(t.data.id) && t.data.setup.api_key, 'create_site');
const siteId = t.data.id;
assert((await tool('get_site', { site: 'mcp-smoke.com' })).data.id === siteId, 'sites can be named by domain');
t = await tool('update_site', { site: siteId, name: 'Renamed', timezone: 'Mars/Base' });
assert(t.isError && t.text === 'Unknown timezone', 'tool errors are readable');
t = await tool('update_site', { site: siteId, name: 'Renamed', stripe_webhook_secret: 'whsec_x' });
assert(t.data.name === 'Renamed' && t.data.stripe_webhook_secret === '••••••••' && !('api_key' in t.data), 'update_site masks secrets');
assert((await tool('get_site', { site: 'nope.com' })).isError, 'unknown site is an error');

// Some traffic: a visitor from X who views pricing, completes a goal and pays
const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const vid = crypto.randomUUID(), sid = crypto.randomUUID();
const event = (p) => fetch(BASE + '/api/event', { method: 'POST', headers: { 'content-type': 'text/plain', 'user-agent': ua, 'x-forwarded-for': '203.0.113.9' }, body: JSON.stringify({ w: siteId, vid, sid, ...p }) });
assert((await event({ t: 'pageview', u: 'https://mcp-smoke.com/?utm_campaign=launch', r: 'https://t.co/x' })).status === 202, 'pageview recorded');
await event({ t: 'pageview', u: 'https://mcp-smoke.com/pricing' });
await event({ t: 'goal', u: 'https://mcp-smoke.com/pricing', n: 'checkout_click' });

t = await tool('record_goal', { site: siteId, visitor_id: vid, name: 'signup', props: { plan: 'pro' } });
assert(t.data.ok, 'record_goal');
assert((await tool('record_goal', { site: siteId, visitor_id: 'ghost', name: 'signup' })).text === 'visitor not found', 'record_goal needs a real visitor');
t = await tool('record_payment', { site: siteId, transaction_id: 'tx_1', amount: 49.5, visitor_id: vid, email: 'a@b.co' });
assert(t.data.ok && t.data.attributed, 'record_payment (attributed to the visit)');

t = await tool('get_overview', { site: siteId, period: 'today' });
assert(t.data.current.visitors === 1 && t.data.current.revenue === 49.5 && t.data.currency === 'EUR' && t.data.series.length > 0, 'get_overview, revenue in major units');
assert(typeof t.data.range.from === 'string' && 'avgDurationSeconds' in t.data.current, 'times as ISO, durations in seconds');
t = await tool('get_overview', { site: siteId, period: 'today', filters: { source: 'Nope' } });
assert(t.data.current.visitors === 0, 'filters narrow the overview');
t = await tool('get_breakdown', { site: siteId, dimension: 'source', period: 'today' });
assert(t.data.rows[0].label === 'X' && t.data.rows[0].revenue === 49.5 && t.data.rows[0].referrer_domain === 't.co', 'get_breakdown by source with revenue');
t = await tool('get_breakdown', { site: siteId, dimension: 'campaign', period: 'today' });
assert(t.data.rows[0].label === 'launch', 'get_breakdown by campaign');
t = await tool('get_breakdown', { site: siteId, dimension: 'page', period: 'today', limit: 1 });
assert(t.data.rows.length === 1 && 'pageviews' in t.data.rows[0], 'get_breakdown pages with limit');
t = await tool('list_goals', { site: siteId, period: 'today' });
const signup = t.data.goals.find((g) => g.name === 'signup');
assert(signup && signup.completions === 1 && signup.conversion_rate === 1 && signup.revenue === 49.5, 'list_goals with conversion and revenue');

t = await tool('create_funnel', { site: siteId, name: 'Buy', steps: [{ type: 'page', value: '/' }, { type: 'page', value: '/pric*' }, { type: 'goal', value: 'signup' }] });
const funnelId = t.data.id;
assert(funnelId && t.data.steps.length === 3, 'create_funnel');
assert((await tool('create_funnel', { site: siteId, name: 'x', steps: [{ type: 'page', value: '/' }] })).isError, 'funnels need 2 steps');
t = await tool('get_funnel_stats', { site: siteId, funnel_id: funnelId, period: 'today' });
assert(t.data.steps.map((s) => s.visitors).join() === '1,1,1' && t.data.overall_conversion === 1, 'get_funnel_stats');
t = await tool('rename_goal', { site: siteId, name: 'signup', new_name: 'account_created' });
assert(t.data.renamed_completions === 1 && t.data.updated_funnels[0] === 'Buy', 'rename_goal updates completions and funnels');
t = await tool('list_funnels', { site: siteId });
assert(t.data.funnels[0].steps[2].value === 'account_created', 'list_funnels shows the renamed step');
t = await tool('update_funnel', { site: siteId, funnel_id: funnelId, name: 'Purchase', steps: [{ type: 'page', value: '/' }, { type: 'goal', value: 'checkout_click' }] });
assert(t.data.name === 'Purchase' && t.data.steps.length === 2, 'update_funnel');
t = await tool('delete_goal', { site: siteId, name: 'checkout_click' });
assert(t.data.deleted_completions === 1 && t.data.funnels_still_using_it[0] === 'Purchase', 'delete_goal reports funnels still using it');
t = await tool('list_goals', { site: siteId, period: 'today' });
assert(t.data.goals.map((g) => g.name).join() === 'account_created', 'goal is gone');

t = await tool('list_visitors', { site: siteId, period: 'today' });
assert(t.data.visitors[0].visitor_id === vid && t.data.visitors[0].spent === 49.5, 'list_visitors');
t = await tool('get_visitor', { site: siteId, visitor_id: vid });
assert(t.data.sessions.length === 1 && t.data.payments[0].amount === 49.5 && t.data.events.some((e) => e.props?.plan === 'pro'), 'get_visitor with parsed props');
t = await tool('list_customers', { site: siteId, period: 'today', search: 'a@b' });
assert(t.data.customers.length === 1 && t.data.customers[0].source === 'X', 'list_customers with search');
t = await tool('get_realtime', { site: siteId });
assert(t.data.online_now === 1 && t.data.feed.length >= 3, 'get_realtime');
assert(Array.isArray((await tool('get_visitor_map', { site: siteId })).data.cities), 'get_visitor_map');
assert(Array.isArray((await tool('list_pending_payments', { site: siteId })).data.products), 'list_pending_payments');
assert((await tool('assign_dodo_product', { site: siteId, product_id: 'pdt_smoke' })).data.ok, 'assign_dodo_product');
assert(typeof (await tool('rematch_payments', { site: siteId })).data.checked === 'number', 'rematch_payments');
t = await tool('list_sites', { period: '7d', include_series: true });
const listed = t.data.sites.find((s) => s.id === siteId);
assert(listed && listed.revenue === 49.5 && listed.series.length === 28, 'list_sites with totals and series');
assert((await tool('get_account')).data.scopes.join() === 'read,write', 'get_account');
const oldKey = (await tool('get_site', { site: siteId })).data.setup.api_key;
assert((await tool('rotate_api_key', { site: siteId })).data.api_key !== oldKey, 'rotate_api_key');
assert((await tool('delete_funnel', { site: siteId, funnel_id: funnelId })).data.deleted, 'delete_funnel');

// ---- refresh rotation
r = await tokenReq({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId });
assert(r.status === 200 && r.body.access_token !== tokens.access_token, 'refresh token gives new tokens');
const old = tokens;
tokens = r.body;
r = await tokenReq({ grant_type: 'refresh_token', refresh_token: old.refresh_token, client_id: clientId });
assert(r.status === 400, 'refresh tokens rotate (old one is spent)');
assert((await tool('get_account')).data, 'new access token works');

// ---- read-only connection
a = authUrl();
code = await approve(a, false);
const ro = (await tokenReq({ grant_type: 'authorization_code', code, client_id: clientId, code_verifier: a.verifier })).body;
assert(ro.scope === 'read', 'owner can grant read-only');
const roTools = (await rpc('tools/list', {}, ro.access_token)).body.result.tools.map((x) => x.name);
assert(!roTools.includes('delete_site') && roTools.includes('get_overview'), 'read-only connection lists only read tools');
t = await tool('delete_site', { site: siteId, confirm_domain: 'mcp-smoke.com' }, ro.access_token);
assert(t.isError && t.text.includes('"write" access'), 'read-only connection cannot change things');

// ---- the dashboard's agent list, and disconnecting
r = await http('/api/oauth/grants');
assert(r.status === 200 && r.body.filter((g) => g.name === 'Smoke Agent').length >= 2, 'dashboard lists connected agents');
const roGrant = r.body.find((g) => g.scopes.join() === 'read');
assert((await http(`/api/oauth/grants/${roGrant.id}`, { method: 'DELETE' })).status === 200, 'owner disconnects an agent');
assert((await rpc('tools/list', {}, ro.access_token)).status === 401, 'disconnected agent is locked out');

// ---- destructive tools need confirmation
t = await tool('delete_site', { site: siteId, confirm_domain: 'other.com' });
assert(t.isError && t.text.includes('confirm_domain'), 'delete_site needs the domain to confirm');
t = await tool('delete_site', { site: siteId, confirm_domain: 'mcp-smoke.com' });
assert(t.data.ok, 'delete_site');
assert((await tool('get_site', { site: siteId })).isError, 'site is gone');

// ---- RFC 7009 revocation by the agent itself
assert((await http('/oauth/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ token: tokens.refresh_token }) })).status === 200, 'agent revokes');
assert((await rpc('tools/list')).status === 401, 'revoked token is dead');

console.log('\nAll MCP checks passed.');
