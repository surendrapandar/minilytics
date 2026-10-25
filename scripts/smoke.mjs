// End-to-end smoke test against a running `wrangler dev` (default http://localhost:8787).
import crypto from 'node:crypto';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'change-me';
let cookie = '';
const assert = (cond, msg) => {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('ok -', msg);
};

async function call(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'content-type': 'application/json', cookie, ...(opts.headers ?? {}) },
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const event = (siteId, payload) =>
  fetch(BASE + '/api/event', { method: 'POST', headers: { 'content-type': 'text/plain', 'user-agent': ua }, body: JSON.stringify({ w: siteId, ...payload }) });

assert((await call('/api/sites')).status === 401, 'dashboard API needs login');
assert((await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: 'nope' }) })).status === 401, 'wrong password rejected');
assert((await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: PASSWORD }) })).status === 200, 'login');

// Remove leftovers from an interrupted earlier run (payment ids would collide).
for (const old of (await call('/api/sites')).body) if (old.domain === 'smoke-test.com') await call(`/api/sites/${old.id}`, { method: 'DELETE' });

const site = (await call('/api/sites', { method: 'POST', body: JSON.stringify({ domain: 'https://www.smoke-test.com/', name: 'Smoke', timezone: 'Asia/Kolkata' }) })).body;
assert(site.domain === 'smoke-test.com', 'domain is normalised');

const vid = crypto.randomUUID(), sid = crypto.randomUUID();
let r = await event(site.id, { t: 'pageview', u: 'https://smoke-test.com/?utm_campaign=launch-tweet', r: 'https://t.co/abc', vid, sid, sw: 1440 });
assert(r.status === 202, 'pageview accepted');
r = await event(site.id, { t: 'pageview', u: 'https://evil.com/', r: '', vid, sid });
assert(r.status === 403, 'other domains rejected');
r = await fetch(BASE + '/api/event', { method: 'POST', headers: { 'user-agent': 'Googlebot/2.1' }, body: JSON.stringify({ w: site.id, t: 'pageview', u: 'https://smoke-test.com/', vid, sid }) });
assert(r.status === 202, 'bots silently dropped');
await event(site.id, { t: 'pageview', u: 'https://app.smoke-test.com/pricing/', r: 'https://smoke-test.com/', vid, sid });
await event(site.id, { t: 'goal', u: 'https://app.smoke-test.com/pricing', n: 'checkout_click', p: { plan: 'pro' }, vid, sid });
await event(site.id, { t: 'outbound', u: 'https://app.smoke-test.com/pricing', n: 'https://checkout.dodopayments.com/buy/pdt_1', vid, sid });
await event(site.id, { t: 'ping', u: 'https://app.smoke-test.com/pricing', d: 42000, vid, sid });
await event(site.id, { t: 'identify', u: 'https://app.smoke-test.com/pricing', p: { email: 'Jane@Acme.com', name: 'Jane Doe' }, vid, sid });

// A second, bouncing visitor from Google
await event(site.id, { t: 'pageview', u: 'https://smoke-test.com/blog/seo-article', r: 'https://www.google.com/', vid: crypto.randomUUID(), sid: crypto.randomUUID() });

// Dodo webhook, signed the Standard Webhooks way
const secretBytes = crypto.randomBytes(24);
const secret = 'whsec_' + secretBytes.toString('base64');
await call(`/api/sites/${site.id}`, { method: 'PATCH', body: JSON.stringify({ dodo_webhook_secret: secret }) });
async function dodo(payload, sign = true) {
  const body = JSON.stringify(payload);
  const id = 'msg_' + crypto.randomUUID();
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = crypto.createHmac('sha256', secretBytes).update(`${id}.${ts}.${body}`).digest('base64');
  return fetch(`${BASE}/api/webhooks/dodo/${site.id}`, {
    method: 'POST',
    headers: { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': sign ? `v1,${sig}` : 'v1,bad' },
    body,
  });
}
const pay = {
  business_id: 'bus_1', type: 'payment.succeeded', timestamp: new Date().toISOString(),
  data: {
    payload_type: 'Payment', payment_id: 'pay_smoke_1', total_amount: 4900, currency: 'USD', settlement_amount: 4900, settlement_currency: 'USD',
    created_at: new Date().toISOString(), customer: { customer_id: 'cus_1', email: 'jane@acme.com', name: 'Jane Doe' },
    metadata: { ml_visitor_id: vid, ml_session_id: sid },
  },
};
assert((await dodo(pay, false)).status === 401, 'bad webhook signature rejected');
assert((await dodo(pay)).status === 200, 'webhook accepted');
assert((await dodo(pay)).status === 200, 'duplicate webhook is fine');
// Renewal with no metadata gets linked through the customer id
await dodo({ ...pay, data: { ...pay.data, payment_id: 'pay_smoke_2', total_amount: 4900, metadata: {} } });
await dodo({ business_id: 'bus_1', type: 'refund.succeeded', timestamp: new Date().toISOString(), data: { payment_id: 'pay_smoke_2', refund_id: 'ref_1', amount: 4900, currency: 'USD', customer: { customer_id: 'cus_1' } } });

const o = (await call(`/api/sites/${site.id}/overview?period=today`)).body;
assert(o.current.visitors === 2, `2 visitors (got ${o.current.visitors})`);
assert(o.current.pageviews === 3, `3 pageviews (got ${o.current.pageviews})`);
assert(o.current.revenue === 4900, `net revenue 49.00 after refund (got ${o.current.revenue})`);
assert(o.current.customers === 1, 'one customer (renewal not double counted)');
assert(Math.abs(o.current.bounceRate - 0.5) < 1e-9, 'bounce rate 50%');
assert(o.current.avgDuration === 21000, `avg session time 21s (got ${o.current.avgDuration})`);
assert(o.online === 2, 'two online');

const src = (await call(`/api/sites/${site.id}/breakdown?period=today&dim=source`)).body;
const x = src.find((s) => s.label === 'X');
assert(x && x.revenue === 4900 && x.customers === 1, 'revenue credited to X');
assert(src.some((s) => s.label === 'Google' && s.revenue === 0), 'Google visit, no revenue');
const camp = (await call(`/api/sites/${site.id}/breakdown?period=today&dim=campaign`)).body;
assert(camp.some((c) => c.label === 'launch-tweet' && c.revenue === 4900), 'campaign "launch-tweet" made the money');
const pages = (await call(`/api/sites/${site.id}/breakdown?period=today&dim=page`)).body;
assert(pages.some((p) => p.label === '/pricing'), 'trailing slash normalised (/pricing)');
const goals = (await call(`/api/sites/${site.id}/breakdown?period=today&dim=goal`)).body;
assert(goals[0]?.label === 'checkout_click' && goals[0].revenue === 4900, 'goal with revenue');
const host = (await call(`/api/sites/${site.id}/breakdown?period=today&dim=hostname`)).body;
assert(host.length === 1 && host[0].label === 'smoke-test.com', 'session hostname is the entry host');

const filtered = (await call(`/api/sites/${site.id}/overview?period=today&filters=${encodeURIComponent(JSON.stringify({ source: 'Google' }))}`)).body;
assert(filtered.current.visitors === 1 && filtered.current.revenue === 0, 'filter by referrer');
const byPage = (await call(`/api/sites/${site.id}/overview?period=today&filters=${encodeURIComponent(JSON.stringify({ page: '/pricing' }))}`)).body;
assert(byPage.current.visitors === 1, 'filter by visited page');

const cust = (await call(`/api/sites/${site.id}/customers?period=today`)).body;
assert(cust.length === 2 && cust.some((c) => c.renewal === 1), 'journey lists payment + renewal');
const prof = (await call(`/api/sites/${site.id}/visitors/${vid}`)).body;
assert(prof.visitor.email === 'jane@acme.com' && prof.events.length === 4 && prof.payments.length === 3, 'visitor profile');

const f = (await call(`/api/sites/${site.id}/funnels`, { method: 'POST', body: JSON.stringify({ name: 'Buy', steps: [{ type: 'page', value: '/' }, { type: 'page', value: '/pric*' }, { type: 'goal', value: 'checkout_click' }] }) })).body;
const fs = (await call(`/api/sites/${site.id}/funnels/${f.id}/stats?period=today`)).body;
assert(fs.map((s) => s.visitors).join(',') === '1,1,1', `funnel 1,1,1 (got ${fs.map((s) => s.visitors)})`);

const apiPay = await fetch(BASE + '/api/v1/payments', { method: 'POST', headers: { authorization: `Bearer ${site.api_key}`, 'content-type': 'application/json' }, body: JSON.stringify({ transaction_id: 't1', amount: 10.5, visitor_id: vid }) });
assert((await apiPay.json()).attributed === true, 'generic payments API attributes');

// --- Payments that arrive with EMPTY metadata (like Dodo payment links can) ---
// 1. Return page: webhook first, then the buyer lands on /thanks?payment_id=...
const vid2 = crypto.randomUUID(), sid2 = crypto.randomUUID();
await event(site.id, { t: 'pageview', u: 'https://smoke-test.com/', r: 'https://chatgpt.com/', vid: vid2, sid: sid2 });
await dodo({ ...pay, data: { ...pay.data, payment_id: 'pay_return_1', metadata: {}, customer: { customer_id: 'cus_2', email: 'k@example.com', name: 'K B' } } });
let c1 = (await call(`/api/sites/${site.id}/customers?period=today`)).body.find((c) => c.id === 'pay_return_1');
assert(c1 && !c1.visitor_id, 'payment without metadata starts unlinked');
await event(site.id, { t: 'pageview', u: 'https://smoke-test.com/thanks?payment_id=pay_return_1&status=succeeded', r: 'https://checkout.dodopayments.com/', vid: vid2, sid: sid2 });
c1 = (await call(`/api/sites/${site.id}/customers?period=today`)).body.find((c) => c.id === 'pay_return_1');
assert(c1.visitor_id === vid2 && c1.source === 'ChatGPT' && c1.matched_by === 'return_page', 'return page links it and credits ChatGPT');

// 2. Return page seen BEFORE the webhook arrives
const vid3 = crypto.randomUUID(), sid3 = crypto.randomUUID();
await event(site.id, { t: 'pageview', u: 'https://smoke-test.com/thanks?subscription_id=sub_abc123&status=active', r: 'https://www.reddit.com/', vid: vid3, sid: sid3 });
await dodo({ ...pay, data: { ...pay.data, payment_id: 'pay_sub_1', subscription_id: 'sub_abc123', metadata: {}, customer: { customer_id: 'cus_3', email: 's@example.com', name: 'S' } } });
const c2 = (await call(`/api/sites/${site.id}/customers?period=today`)).body.find((c) => c.id === 'pay_sub_1');
assert(c2.visitor_id === vid3 && c2.source === 'Reddit', 'subscription return page seen before webhook still links');

// 3. Timing: exactly one visitor clicked a Dodo checkout link shortly before the payment
const vid4 = crypto.randomUUID(), sid4 = crypto.randomUUID();
await event(site.id, { t: 'pageview', u: 'https://smoke-test.com/?ref=medium-article', r: '', vid: vid4, sid: sid4 });
await event(site.id, { t: 'outbound', u: 'https://smoke-test.com/', n: 'https://checkout.dodopayments.com/buy/pdt_x', vid: vid4, sid: sid4 });
await dodo({ ...pay, data: { ...pay.data, payment_id: 'pay_timing_1', metadata: {}, customer: { customer_id: 'cus_4', email: 't@example.com', name: 'T' } } });
const c3 = (await call(`/api/sites/${site.id}/customers?period=today`)).body.find((c) => c.id === 'pay_timing_1');
assert(c3.visitor_id === vid4 && c3.matched_by === 'timing' && c3.ref === 'medium-article', 'timing match credits the medium-article ref');

// 3b. Several people clicked Buy; only the buyer came back right after paying (the real-world case)
const clicker = async (id) => {
  const v = crypto.randomUUID(), s = crypto.randomUUID();
  await event(site.id, { t: 'pageview', u: 'https://smoke-test.com/', r: id === 'buyer' ? 'https://chatgpt.com/' : '', vid: v, sid: s });
  await event(site.id, { t: 'goal', u: 'https://smoke-test.com/', n: 'checkout_click', vid: v, sid: s });
  await event(site.id, { t: 'outbound', u: 'https://smoke-test.com/', n: 'https://checkout.dodopayments.com/buy/pdt_x', vid: v, sid: s });
  return { v, s };
};
await clicker('a'); await clicker('b');
const buyer = await clicker('buyer');
await event(site.id, { t: 'pageview', u: 'https://smoke-test.com/thanks', r: 'https://checkout.dodopayments.com/', vid: buyer.v, sid: buyer.s });
await dodo({ ...pay, data: { ...pay.data, payment_id: 'pay_timing_2', created_at: new Date().toISOString(), metadata: {}, customer: { customer_id: 'cus_5', email: 'kb@example.com', name: 'KB' } } });
const c4 = (await call(`/api/sites/${site.id}/customers?period=today`)).body.find((c) => c.id === 'pay_timing_2');
assert(c4.visitor_id === buyer.v && c4.source === 'ChatGPT', 'with 3 checkout clickers, the one who came back after paying gets it');

// 3c. Two clickers who both came back: too close to call, stays unlinked with a reason
const d1 = await clicker('d'), d2 = await clicker('e');
await event(site.id, { t: 'pageview', u: 'https://smoke-test.com/thanks', r: '', vid: d1.v, sid: d1.s });
await event(site.id, { t: 'pageview', u: 'https://smoke-test.com/thanks', r: '', vid: d2.v, sid: d2.s });
await dodo({ ...pay, data: { ...pay.data, payment_id: 'pay_ambiguous', created_at: new Date().toISOString(), metadata: {}, customer: { customer_id: 'cus_6', email: 'amb@example.com', name: 'Amb' } } });
const c5 = (await call(`/api/sites/${site.id}/customers?period=today`)).body.find((c) => c.id === 'pay_ambiguous');
assert(!c5.visitor_id, 'ambiguous timing is not guessed');

// 4. Rematch button works and reports why
const rm = (await call(`/api/sites/${site.id}/rematch`, { method: 'POST' })).body;
assert(rm.checked === 1 && rm.matched === 0 && /too close to call/.test(rm.details[0].reason), `rematch explains: "${rm.details?.[0]?.reason}"`);

for (const p of ['today', 'yesterday', '24h', '48h', '7d', '30d', '90d', '12m', 'all']) {
  const res = await call(`/api/sites/${site.id}/overview?period=${p}`);
  assert(res.status === 200 && res.body.series.length > 0, `period ${p} (${res.body.series.length} buckets, ${res.body.range.granularity})`);
}
for (const g of ['hour', 'day', 'week', 'month']) {
  const res = await call(`/api/sites/${site.id}/overview?period=30d&granularity=${g}`);
  assert(res.status === 200, `granularity ${g} -> ${res.body.range.granularity}`);
}

// identify() is fill-only: a later call can't rewrite the identity that is already stored
await event(site.id, { t: 'identify', u: 'https://app.smoke-test.com/pricing', p: { email: 'attacker@evil.com', name: 'Mallory' }, vid, sid });
const identified = (await call(`/api/sites/${site.id}/visitors/${vid}`)).body.visitor;
assert(identified.email === 'jane@acme.com' && identified.name === 'Jane Doe', 'second identify() does not overwrite email or name');

await call(`/api/sites/${site.id}`, { method: 'DELETE' });
assert((await call(`/api/sites/${site.id}`)).status === 404, 'site deleted');

// --- Auth hardening ---
const login = (headers = {}, password = PASSWORD) =>
  call('/api/auth/login', { method: 'POST', headers, body: JSON.stringify({ password }) });

// Parallel guesses can't all slip under the lockout (a fake client IP keeps the real bucket clean).
const ip = { 'cf-connecting-ip': `203.0.113.${1 + Math.floor(Math.random() * 250)}` };
const burst = await Promise.all(Array.from({ length: 25 }, () => login(ip, 'wrong-' + crypto.randomUUID())));
const locked = burst.filter((b) => b.status === 429).length;
assert(locked >= 10, `parallel wrong passwords get locked out (${locked}/25 answered 429)`);
assert((await login(ip)).status === 429, 'correct password is refused while the IP is locked out');

// Logging out ends the session on the server: replaying the old cookie no longer works.
assert((await login()).status === 200, 'login again');
const oldCookie = cookie;
assert((await call('/api/sites')).status === 200, 'session works');
await call('/api/auth/logout', { method: 'POST' });
cookie = oldCookie;
assert((await call('/api/sites')).status === 401, 'cookie is revoked after logout');

// Log out everywhere ends every other session too.
await login();
const laptop = cookie;
await login();
assert((await call('/api/auth/logout-all', { method: 'POST' })).status === 200, 'logout-all');
cookie = laptop;
assert((await call('/api/sites')).status === 401, 'other sessions are revoked by logout-all');
assert((await call('/api/auth/logout-all', { method: 'POST' })).status === 401, 'logout-all needs a login');

console.log('\nAll smoke tests passed');
