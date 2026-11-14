// End-to-end test of hosted (SaaS) mode against `wrangler dev` started with the Google/billing vars, e.g.:
//   npx wrangler dev --port 8788 --var GOOGLE_CLIENT_ID:test --var GOOGLE_CLIENT_SECRET:test \
//     --var ADMIN_EMAILS:owner@example.com --var PLAN_PRODUCT_ID:pdt_plan --var PLAN_SPOTS:5 --var 'PLAN_PRICE:$29' --var PLAN_INTERVAL:lifetime \
//     --var PLAN_CHECKOUT_URL:https://checkout.dodopayments.com/buy/pdt_plan?quantity=1 --var BILLING_WEBHOOK_SECRET:whsec_dGVzdC1iaWxsaW5nLXNlY3JldA==
// Users are created directly in the local DB and their session cookies signed with the local SESSION_SECRET.
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

const BASE = process.env.BASE ?? 'http://localhost:8788';
const SESSION_SECRET = process.env.SESSION_SECRET ?? 'any-long-random-string';
const BILLING_KEY = Buffer.from('test-billing-secret');
const assert = (cond, msg) => {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('ok -', msg);
};
const sql = (q) => execSync(`npx wrangler d1 execute minilytics --local --command ${JSON.stringify(q)}`, { stdio: 'ignore' });
const cookieFor = (userId) => {
  const value = `u:${userId}.${Date.now() + 86_400_000}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64').replace(/=+$/, '');
  return `ml_auth=${encodeURIComponent(`${value}.${sig}`)}`;
};
async function call(path, { cookie = '', ...opts } = {}) {
  const res = await fetch(BASE + path, { redirect: 'manual', ...opts, headers: { 'content-type': 'application/json', cookie, ...(opts.headers ?? {}) } });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, location: res.headers.get('location') };
}
async function billing(payload) {
  const body = JSON.stringify(payload);
  const id = 'msg_' + crypto.randomUUID();
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = crypto.createHmac('sha256', BILLING_KEY).update(`${id}.${ts}.${body}`).digest('base64');
  return fetch(BASE + '/api/billing/webhook', { method: 'POST', headers: { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` }, body });
}

// Clean slate for the test accounts
const run = crypto.randomUUID().slice(0, 6);
const alice = `alice_${run}`, bob = `bob_${run}`, owner = `owner_${run}`;
sql(`DELETE FROM users WHERE email IN ('owner@example.com') OR id LIKE 'alice_%' OR id LIKE 'bob_%' OR id LIKE 'owner_%'`);
const now = Date.now();
sql(`INSERT INTO users (id, email, name, created_at) VALUES ('${alice}', 'alice-${run}@example.com', 'Alice', ${now}), ('${bob}', 'bob-${run}@example.com', 'Bob', ${now}), ('${owner}', 'owner@example.com', 'Owner', ${now})`);
const A = cookieFor(alice), B = cookieFor(bob), O = cookieFor(owner);

let r = await call('/api/auth/me');
assert(r.body.hosted === true && r.body.loggedIn === false, 'hosted mode, logged out');
r = await call('/api/public/plan');
assert(r.body.hosted && r.body.checkout && r.body.spots > 0, `plan info (${r.body.price} ${r.body.interval}, ${r.body.spotsLeft} of ${r.body.spots} left${r.body.nextPrice ? ', then ' + r.body.nextPrice : ''})`);
const spotsBefore = r.body.spotsLeft;
r = await call('/api/auth/google');
assert(r.status === 302 && r.location.startsWith('https://accounts.google.com/') && r.location.includes('client_id=test'), 'Google sign-in redirect');
r = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: 'change-me' }) });
assert(r.status === 400, 'password login disabled in hosted mode');

r = await call('/api/auth/me', { cookie: A });
assert(r.body.user?.id === alice && r.body.user.paid === false, 'Alice signed in, not paid');
r = await call('/api/sites', { cookie: A, method: 'POST', body: JSON.stringify({ domain: 'alice-site.com' }) });
assert(r.status === 402, 'unpaid users cannot add sites');
r = await call('/api/billing/checkout', { cookie: A });
assert(r.status === 302 && r.location.includes(`metadata_user_id=${alice}`) && r.location.includes('redirect_url='), 'checkout redirect carries the account');

const payment = (user, product, pid) => ({
  type: 'payment.succeeded',
  data: { payment_id: pid, product_cart: [{ product_id: product, quantity: 1 }], subscription_id: 'sub_' + pid, customer: { customer_id: 'cus_' + pid, email: 'x@example.com' }, metadata: { user_id: user } },
});
assert((await billing(payment(alice, 'pdt_other', 'pay_other_' + run))).ok, 'other product webhook accepted');
assert((await call('/api/auth/me', { cookie: A })).body.user.paid === false, '…but other products don\'t unlock the plan');
await billing(payment(alice, 'pdt_plan', 'pay_a_' + run));
assert((await call('/api/auth/me', { cookie: A })).body.user.paid === true, 'plan payment unlocks Alice');
assert((await call('/api/public/plan')).body.spotsLeft === spotsBefore - 1, 'one founding spot taken');

r = await call('/api/sites', { cookie: A, method: 'POST', body: JSON.stringify({ domain: 'alice-site.com' }) });
assert(r.status === 200, 'paid user adds a site');
const aliceSite = r.body.id;

// Bob pays (matched by email, no metadata) and must not see Alice's site
await billing({ type: 'subscription.active', data: { product_id: 'pdt_plan', status: 'active', subscription_id: 'sub_b', next_billing_date: new Date(now + 30 * 86_400_000).toISOString(), customer: { email: `bob-${run}@example.com` }, metadata: {} } });
assert((await call('/api/auth/me', { cookie: B })).body.user.paid === true, 'Bob unlocked by email match');
assert((await call(`/api/sites/${aliceSite}`, { cookie: B })).status === 404, "Bob can't open Alice's site");
assert(!(await call('/api/sites', { cookie: B })).body.some((s) => s.id === aliceSite), "Bob's list doesn't include Alice's site");
assert((await call('/api/sites', { cookie: A })).body.map((s) => s.id).join() === aliceSite, 'Alice sees only her site');

// Owner (ADMIN_EMAILS) never pays and sees the pre-existing (ownerless) sites, not customers' sites
const ownerMe = (await call('/api/auth/me', { cookie: O })).body.user;
assert(ownerMe.admin && ownerMe.paid, 'owner is admin and free');
const ownerSites = (await call('/api/sites', { cookie: O })).body;
assert(!ownerSites.some((s) => s.id === aliceSite), "owner doesn't see customers' sites");

// Tracking stops when the plan ends
const ev = (body) => fetch(BASE + '/api/event', { method: 'POST', headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/129 Safari/537.36' }, body: JSON.stringify({ w: aliceSite, u: 'https://alice-site.com/', t: 'pageview', vid: crypto.randomUUID(), sid: crypto.randomUUID(), ...body }) });
await ev({});
const visitorsWhilePaid = (await call(`/api/sites/${aliceSite}/overview?period=today`, { cookie: A })).body.current.visitors;
assert(visitorsWhilePaid === 1, 'events recorded while paid');
await billing({ type: 'subscription.expired', data: { product_id: 'pdt_plan', subscription_id: 'sub_pay_a_' + run, customer: { email: 'x@example.com' }, metadata: { user_id: alice } } });
assert((await call('/api/auth/me', { cookie: A })).body.user.paid === false, 'expired subscription removes access');
await ev({});
r = await call(`/api/sites/${aliceSite}/overview?period=today`, { cookie: A });
assert(r.status === 200 && r.body.current.visitors === 1, 'events ignored after the plan ends (data still viewable)');

// Refund of Bob's plan payment
await billing(payment(bob, 'pdt_plan', 'pay_b_' + run));
await billing({ type: 'refund.succeeded', data: { payment_id: 'pay_b_' + run, refund_id: 'ref_' + run, is_partial: false } });
assert((await call('/api/auth/me', { cookie: B })).body.user.paid === false, 'full refund removes access');

// One-time (lifetime) payment: no subscription id means access never expires
await billing({ type: 'payment.succeeded', data: { payment_id: 'pay_life_' + run, product_cart: [{ product_id: 'pdt_plan', quantity: 1 }], customer: { email: 'x@example.com' }, metadata: { user_id: bob } } });
const bobLife = (await call('/api/auth/me', { cookie: B })).body.user;
assert(bobLife.paid === true && bobLife.plan_until === null, 'one-time payment = lifetime access (no end date)');

// Bad signature
r = await fetch(BASE + '/api/billing/webhook', { method: 'POST', headers: { 'webhook-id': 'x', 'webhook-timestamp': String(Math.floor(Date.now() / 1000)), 'webhook-signature': 'v1,bad' }, body: '{}' });
assert(r.status === 401, 'billing webhook rejects bad signatures');

// Cleanup
await call(`/api/sites/${aliceSite}`, { cookie: A, method: 'DELETE' });
sql(`DELETE FROM users WHERE id IN ('${alice}', '${bob}', '${owner}')`);
console.log('\nAll hosted-mode tests passed');
