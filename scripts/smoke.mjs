// End-to-end smoke test against a running `wrangler dev` (default http://localhost:8787).
import crypto from 'node:crypto';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'change-me';
const EMAIL = process.env.ADMIN_EMAIL ?? 'you@example.com';
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
assert((await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'someone@else.com', password: PASSWORD }) })).status === 401, 'wrong email rejected');
assert((await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: ` ${EMAIL.toUpperCase()} `, password: PASSWORD }) })).status === 200, 'login');
assert((await call('/api/auth/me')).body.user?.email === EMAIL, 'menu shows the login email');

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

// --- Polar (own site, so Polar checkout clicks don't affect Dodo timing matches) ---
for (const old of (await call('/api/sites')).body) if (old.domain === 'polar-smoke.com') await call(`/api/sites/${old.id}`, { method: 'DELETE' });
const polarSite = (await call('/api/sites', { method: 'POST', body: JSON.stringify({ domain: 'polar-smoke.com', name: 'Polar Smoke' }) })).body;
const polarSecretBytes = crypto.randomBytes(24);
const polarSecret = 'whsec_' + polarSecretBytes.toString('base64');
await call(`/api/sites/${polarSite.id}`, { method: 'PATCH', body: JSON.stringify({ polar_webhook_secret: polarSecret }) });
async function polar(payload, sign = true) {
  const body = JSON.stringify(payload);
  const id = 'msg_' + crypto.randomUUID();
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = crypto.createHmac('sha256', polarSecretBytes).update(`${id}.${ts}.${body}`).digest('base64');
  return fetch(`${BASE}/api/webhooks/polar/${polarSite.id}`, {
    method: 'POST',
    headers: { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': sign ? `v1,${sig}` : 'v1,bad' },
    body,
  });
}
const polarVid = crypto.randomUUID(), polarSid = crypto.randomUUID();
await event(polarSite.id, { t: 'pageview', u: 'https://polar-smoke.com/?utm_campaign=polar-launch', r: 'https://t.co/xyz', vid: polarVid, sid: polarSid });
const polarOrder = {
  type: 'order.paid', timestamp: new Date().toISOString(),
  data: {
    id: '11111111-1111-4111-8111-111111111111',
    created_at: new Date().toISOString(),
    total_amount: 2900, currency: 'usd', billing_reason: 'purchase',
    checkout_id: '22222222-2222-4222-8222-222222222222',
    customer_id: '33333333-3333-4333-8333-333333333333',
    customer: { id: '33333333-3333-4333-8333-333333333333', email: 'polar@acme.com', name: 'Polar Jane', metadata: {} },
    metadata: { ml_visitor_id: polarVid, ml_session_id: polarSid },
  },
};
assert((await polar(polarOrder, false)).status === 401, 'Polar bad webhook signature rejected');
assert((await polar(polarOrder)).status === 200, 'Polar webhook accepted');
assert((await polar(polarOrder)).status === 200, 'Polar duplicate webhook is fine');
await polar({
  type: 'order.paid', timestamp: new Date().toISOString(),
  data: {
    ...polarOrder.data, id: '44444444-4444-4444-8444-444444444444', billing_reason: 'subscription_cycle',
    subscription_id: '55555555-5555-4555-8555-555555555555', metadata: {},
  },
});
await polar({
  type: 'refund.created', timestamp: new Date().toISOString(),
  data: { id: '66666666-6666-4666-8666-666666666666', status: 'succeeded', amount: 2900, currency: 'usd', order_id: polarOrder.data.id, customer_id: polarOrder.data.customer_id },
});
const polarCust = (await call(`/api/sites/${polarSite.id}/customers?period=today`)).body;
const polarPay = polarCust.find((c) => c.id === polarOrder.data.id);
assert(polarPay && polarPay.visitor_id === polarVid && polarPay.source === 'X', 'Polar metadata payment credited to X');
assert(polarCust.some((c) => c.id === '44444444-4444-4444-8444-444444444444' && c.renewal === 1 && c.visitor_id === polarVid), 'Polar renewal linked by customer id');

const polarVid2 = crypto.randomUUID(), polarSid2 = crypto.randomUUID();
const polarCheckoutId = '77777777-7777-4777-8777-777777777777';
await event(polarSite.id, { t: 'pageview', u: 'https://polar-smoke.com/', r: 'https://www.reddit.com/', vid: polarVid2, sid: polarSid2 });
await polar({
  type: 'order.paid', timestamp: new Date().toISOString(),
  data: {
    id: '88888888-8888-4888-8888-888888888888', created_at: new Date().toISOString(),
    total_amount: 1900, currency: 'usd', billing_reason: 'purchase', checkout_id: polarCheckoutId,
    customer: { id: '99999999-9999-4999-8999-999999999999', email: 'p2@example.com', name: 'P2', metadata: {} },
    metadata: {},
  },
});
let polarUnlinked = (await call(`/api/sites/${polarSite.id}/customers?period=today`)).body.find((c) => c.id === '88888888-8888-4888-8888-888888888888');
assert(polarUnlinked && !polarUnlinked.visitor_id, 'Polar payment without metadata starts unlinked');
await event(polarSite.id, { t: 'pageview', u: `https://polar-smoke.com/checkout/complete?checkout_id=${polarCheckoutId}`, r: 'https://buy.polar.sh/', vid: polarVid2, sid: polarSid2 });
polarUnlinked = (await call(`/api/sites/${polarSite.id}/customers?period=today`)).body.find((c) => c.id === '88888888-8888-4888-8888-888888888888');
assert(polarUnlinked.visitor_id === polarVid2 && polarUnlinked.source === 'Reddit' && polarUnlinked.matched_by === 'return_page', 'Polar checkout_id return page links it');

const polarVid3 = crypto.randomUUID(), polarSid3 = crypto.randomUUID();
const polarCheckoutId2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
await event(polarSite.id, { t: 'pageview', u: `https://polar-smoke.com/checkout/complete?checkout_id=${polarCheckoutId2}`, r: 'https://chatgpt.com/', vid: polarVid3, sid: polarSid3 });
await polar({
  type: 'order.paid', timestamp: new Date().toISOString(),
  data: {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', created_at: new Date().toISOString(),
    total_amount: 1500, currency: 'usd', checkout_id: polarCheckoutId2,
    customer: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', email: 'p3@example.com', name: 'P3', metadata: {} },
    metadata: {},
  },
});
const polarBefore = (await call(`/api/sites/${polarSite.id}/customers?period=today`)).body.find((c) => c.id === 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
assert(polarBefore.visitor_id === polarVid3 && polarBefore.source === 'ChatGPT', 'Polar checkout_id seen before webhook still links');

const polarVid4 = crypto.randomUUID(), polarSid4 = crypto.randomUUID();
await event(polarSite.id, { t: 'pageview', u: 'https://polar-smoke.com/?ref=polar-article', r: '', vid: polarVid4, sid: polarSid4 });
await event(polarSite.id, { t: 'outbound', u: 'https://polar-smoke.com/', n: 'https://buy.polar.sh/polar_cl_abc', vid: polarVid4, sid: polarSid4 });
await polar({
  type: 'order.paid', timestamp: new Date().toISOString(),
  data: {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', created_at: new Date().toISOString(),
    total_amount: 990, currency: 'usd',
    customer: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', email: 'p4@example.com', name: 'P4', metadata: {} },
    metadata: {},
  },
});
const polarTiming = (await call(`/api/sites/${polarSite.id}/customers?period=today`)).body.find((c) => c.id === 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
assert(polarTiming.visitor_id === polarVid4 && polarTiming.matched_by === 'timing' && polarTiming.ref === 'polar-article', 'Polar timing match credits the polar-article ref');

// Polar checkout-link reference_id (the only custom metadata Polar stores from a static link)
const polarVid5 = crypto.randomUUID(), polarSid5 = crypto.randomUUID();
await event(polarSite.id, { t: 'pageview', u: 'https://polar-smoke.com/?ref=checkout-link', r: '', vid: polarVid5, sid: polarSid5 });
await polar({
  type: 'order.paid', timestamp: new Date().toISOString(),
  data: {
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', created_at: new Date().toISOString(),
    total_amount: 500, currency: 'usd',
    customer: { id: '12121212-1212-4121-8121-121212121212', email: 'p5@example.com', name: 'P5', metadata: {} },
    metadata: { reference_id: polarVid5 },
  },
});
const polarRef = (await call(`/api/sites/${polarSite.id}/customers?period=today`)).body.find((c) => c.id === 'ffffffff-ffff-4fff-8fff-ffffffffffff');
assert(polarRef.visitor_id === polarVid5 && polarRef.matched_by === 'metadata', 'Polar reference_id on a checkout link is treated as the visitor');

// Email fallback (identify) works for Polar the same as Dodo
const polarVid6 = crypto.randomUUID(), polarSid6 = crypto.randomUUID();
await event(polarSite.id, { t: 'pageview', u: 'https://polar-smoke.com/', r: 'https://www.linkedin.com/', vid: polarVid6, sid: polarSid6 });
await event(polarSite.id, { t: 'identify', u: 'https://polar-smoke.com/', p: { email: 'polar-id@example.com', name: 'P6' }, vid: polarVid6, sid: polarSid6 });
await polar({
  type: 'order.paid', timestamp: new Date().toISOString(),
  data: {
    id: '13131313-1313-4131-8131-131313131313', created_at: new Date().toISOString(),
    total_amount: 700, currency: 'usd',
    customer: { id: '14141414-1414-4141-8141-141414141414', email: 'polar-id@example.com', name: 'P6', metadata: {} },
    metadata: {},
  },
});
const polarEmail = (await call(`/api/sites/${polarSite.id}/customers?period=today`)).body.find((c) => c.id === '13131313-1313-4131-8131-131313131313');
assert(polarEmail.visitor_id === polarVid6 && polarEmail.matched_by === 'email' && polarEmail.source === 'LinkedIn', 'Polar email fallback after identify()');

await call(`/api/sites/${polarSite.id}`, { method: 'DELETE' });

for (const p of ['today', 'yesterday', '24h', '48h', '7d', '30d', '90d', '12m', 'all']) {
  const res = await call(`/api/sites/${site.id}/overview?period=${p}`);
  assert(res.status === 200 && res.body.series.length > 0, `period ${p} (${res.body.series.length} buckets, ${res.body.range.granularity})`);
}
for (const g of ['hour', 'day', 'week', 'month']) {
  const res = await call(`/api/sites/${site.id}/overview?period=30d&granularity=${g}`);
  assert(res.status === 200, `granularity ${g} -> ${res.body.range.granularity}`);
}

const rt = (await call(`/api/sites/${site.id}/realtime`)).body;
assert(rt.visitors.some((v) => v.visitor_id === vid) && rt.feed.some((f) => f.type === 'payment'), `live view: ${rt.visitors.length} online, ${rt.feed.length} recent events`);

await call(`/api/sites/${site.id}`, { method: 'DELETE' });
assert((await call(`/api/sites/${site.id}`)).status === 404, 'site deleted');
console.log('\nAll smoke tests passed');
