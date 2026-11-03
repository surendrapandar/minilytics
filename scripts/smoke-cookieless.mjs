// End-to-end check of cookieless mode against a running `wrangler dev` (default http://localhost:8787).
const BASE = process.env.BASE ?? 'http://localhost:8787';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'change-me';
let cookie = '';
const assert = (cond, msg) => {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('ok -', msg);
};

async function call(path, opts = {}) {
  const res = await fetch(BASE + path, { ...opts, headers: { 'content-type': 'application/json', cookie, ...(opts.headers ?? {}) } });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
// The Vercel proxy headers let us pick the visitor's IP (clientIp trusts them when present).
async function event(siteId, ip, payload) {
  const res = await fetch(BASE + '/api/event', {
    method: 'POST',
    headers: { 'content-type': 'text/plain', 'user-agent': ua, 'x-vercel-ip-country': 'FR', 'x-real-ip': ip },
    body: JSON.stringify({ w: siteId, ...payload }),
  });
  const text = await res.text();
  return { status: res.status, set: res.headers.get('set-cookie'), body: text ? JSON.parse(text) : null };
}

assert((await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: PASSWORD }) })).status === 200, 'login');
for (const old of (await call('/api/sites')).body) if (old.domain === 'cookieless-test.com') await call(`/api/sites/${old.id}`, { method: 'DELETE' });
const site = (await call('/api/sites', { method: 'POST', body: JSON.stringify({ domain: 'cookieless-test.com', name: 'Cookieless' }) })).body;

const u = 'https://cookieless-test.com';
const a1 = await event(site.id, '1.1.1.1', { t: 'pageview', ck: 1, u: `${u}/?utm_source=newsletter`, r: '' });
assert(a1.status === 202 && /^c[0-9a-f]{31}$/.test(a1.body?.vid) && a1.body?.sid, `server derives the ids (${a1.body?.vid})`);
assert(!a1.set, 'no cookie is set');

const a2 = await event(site.id, '1.1.1.1', { t: 'pageview', ck: 1, u: `${u}/pricing`, r: '' });
assert(a2.body.vid === a1.body.vid && a2.body.sid === a1.body.sid, 'same visitor and session on the next page');

const forged = await event(site.id, '1.1.1.1', { t: 'pageview', ck: 1, u: `${u}/about`, r: '', vid: 'forged-visitor', sid: 'forged-session' });
assert(forged.body.vid === a1.body.vid && forged.body.sid === a1.body.sid, 'ids sent by the client are ignored');

const goal = await event(site.id, '1.1.1.1', { t: 'goal', ck: 1, u: `${u}/pricing`, n: 'signup' });
assert(goal.body.sid === a1.body.sid, 'goal lands in the same session');

const b = await event(site.id, '2.2.2.2', { t: 'pageview', ck: 1, u: `${u}/`, r: 'https://www.google.com/' });
assert(b.body.vid !== a1.body.vid, 'another IP is another visitor');

assert((await event(site.id, '3.3.3.3', { t: 'pageview', u: `${u}/`, r: '' })).status === 400, 'cookie mode still requires ids');

const o = (await call(`/api/sites/${site.id}/overview?period=today`)).body;
assert(o.current.visitors === 2, `2 visitors (got ${o.current.visitors})`);
const sources = (await call(`/api/sites/${site.id}/breakdown?period=today&dim=source`)).body;
console.log('  sources:', JSON.stringify(sources).slice(0, 200));

await call(`/api/sites/${site.id}`, { method: 'DELETE' });
console.log('\nCookieless smoke test passed');
