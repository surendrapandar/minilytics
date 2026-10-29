// Run against wrangler dev, or an explicitly selected deployment using BASE and ADMIN_PASSWORD.
import { createHmac, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const base = process.env.BASE ?? 'http://localhost:8787';
const password = process.env.ADMIN_PASSWORD ?? 'change-me';
const secret = `whsec_${randomUUID()}`;
const suffix = randomUUID().replaceAll('-', '');
const ids = [];
let cookie = '';
const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/129.0 Safari/537.36';

async function call(path, method = 'GET', body, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { cookie, 'content-type': 'application/json', 'user-agent': ua, ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function json(path, method = 'GET', body) {
  const res = await call(path, method, body);
  assert.equal(res.status, 200, `${method} ${path}: ${JSON.stringify(res.body)}`);
  return res.body;
}
const check = (message) => console.log('ok -', message);
const objectId = (prefix) => `${prefix}_${suffix}_${randomUUID().slice(0, 8)}`;
async function site(currency = 'USD') {
  const s = await json('/api/sites', 'POST', { name: 'Stripe smoke', domain: 'stripe-smoke.example.com', timezone: 'UTC', currency });
  ids.push(s.id);
  await json(`/api/sites/${s.id}`, 'PATCH', { stripe_webhook_secret: secret });
  return s;
}
async function visitor(s) {
  const vid = randomUUID(), sid = randomUUID();
  const res = await call('/api/event', 'POST', { w: s.id, t: 'pageview', u: `https://${s.domain}/pricing`, r: 'https://www.google.com/', vid, sid });
  assert.equal(res.status, 202);
  return { vid, sid, metadata: { ml_visitor_id: vid, ml_session_id: sid } };
}
function pi(id, customer, metadata = {}, amount = 4900, currency = 'usd') {
  return { id, object: 'payment_intent', status: 'succeeded', amount_received: amount, amount, currency, customer, metadata, created: Math.floor(Date.now() / 1000), receipt_email: null };
}
function checkout(intent, customer, metadata = {}, extra = {}) {
  return { id: objectId('cs'), object: 'checkout.session', mode: 'payment', status: 'complete', payment_status: 'paid', amount_total: 4900, currency: 'usd', payment_intent: intent, customer, metadata, customer_details: { email: 'stripe-smoke@example.com', name: 'Stripe Smoke' }, ...extra };
}
async function webhook(s, type, object, opts = {}) {
  const body = opts.raw ?? JSON.stringify({ id: objectId('evt'), object: 'event', type, created: Math.floor(Date.now() / 1000), data: { object } });
  const ts = Math.floor(Date.now() / 1000) + (opts.offset ?? 0);
  const sig = createHmac('sha256', opts.secret ?? secret).update(`${ts}.${body}`).digest('hex');
  return call(`/api/webhooks/stripe/${s.id}`, 'POST', body, { 'stripe-signature': `t=${ts},v1=${sig}` });
}
async function send(s, type, object) {
  const res = await webhook(s, type, object);
  assert.equal(res.status, 200, `${type}: ${JSON.stringify(res.body)}`);
}
async function overview(s) { return (await json(`/api/sites/${s.id}/overview?period=all`)).current; }
async function customers(s) { return json(`/api/sites/${s.id}/customers?period=all`); }
async function profile(s, v) { return json(`/api/sites/${s.id}/visitors/${v.vid}`); }

try {
  await json('/api/auth/login', 'POST', { password });
  const s = await site();
  const v = await visitor(s);
  const customer = objectId('cus'), intent = objectId('pi');
  const payment = pi(intent, customer, v.metadata);

  assert.equal((await webhook(s, 'payment_intent.succeeded', payment, { secret: 'whsec_wrong' })).status, 401);
  assert.equal((await webhook(s, 'payment_intent.succeeded', payment, { offset: -301 })).status, 401);
  assert.equal((await webhook(s, 'payment_intent.succeeded', payment, { raw: '{' })).status, 400);
  assert.equal((await webhook(s, 'payment_intent.succeeded', { ...payment, amount_received: '4900' })).status, 400);
  check('invalid signatures, expired deliveries and malformed signed payloads rejected');

  const masked = await json(`/api/sites/${s.id}`);
  assert.equal(masked.stripe_webhook_secret, '••••••••');
  await json(`/api/sites/${s.id}`, 'PATCH', { stripe_webhook_secret: masked.stripe_webhook_secret });
  await send(s, 'checkout.session.completed', checkout(intent, customer, v.metadata));
  await send(s, 'invoice.paid', { id: objectId('in'), amount_paid: 4900, payment_intent: intent, customer });
  assert.equal((await overview(s)).revenue, 0);
  await Promise.all(Array.from({ length: 3 }, () => send(s, 'payment_intent.succeeded', payment)));
  await send(s, 'checkout.session.async_payment_succeeded', checkout(intent, customer, v.metadata));
  let kpis = await overview(s);
  assert.equal(kpis.revenue, 4900);
  assert.equal(kpis.payments, 1);
  let rows = await customers(s);
  assert.equal(rows[0].visitor_id, v.vid);
  assert.equal(rows[0].source, 'Google');
  check('Checkout/invoice notifications do not double-count; concurrent PaymentIntent deliveries count once');

  const renewal = objectId('pi');
  await send(s, 'payment_intent.succeeded', pi(renewal, customer));
  rows = await customers(s);
  assert.equal(rows.find((p) => p.id.endsWith(renewal)).visitor_id, v.vid);
  assert.equal(rows.find((p) => p.id.endsWith(renewal)).renewal, 1);
  assert.equal((await overview(s)).revenue, 9800);
  check('subscription repeat charges retain visitor attribution and renewal flag');

  const refundId = objectId('re');
  const refund = { id: refundId, object: 'refund', status: 'pending', payment_intent: intent, amount: 1000, currency: 'usd', created: Math.floor(Date.now() / 1000) };
  await send(s, 'refund.created', refund);
  assert.equal((await overview(s)).revenue, 9800);
  await send(s, 'refund.updated', { ...refund, status: 'succeeded' });
  await send(s, 'refund.created', { ...refund, status: 'succeeded' });
  await send(s, 'refund.created', { ...refund, id: objectId('re'), amount: 500, status: 'succeeded' });
  await send(s, 'refund.updated', { ...refund, status: 'failed' });
  assert.equal((await overview(s)).revenue, 8300);
  const details = await profile(s, v);
  assert.equal(details.payments.filter((p) => p.kind === 'refund').length, 2);
  assert.ok(details.payments.filter((p) => p.kind === 'refund').every((p) => p.visitor_id === v.vid));
  check('pending refunds ignored; successful partial refunds deduplicated and attributed');

  const lateSite = await site();
  const lateV = await visitor(lateSite);
  const lateCustomer = objectId('cus'), lateIntent = objectId('pi');
  await send(lateSite, 'refund.created', { ...refund, id: objectId('re'), payment_intent: lateIntent, status: 'succeeded' });
  await send(lateSite, 'payment_intent.succeeded', pi(lateIntent, lateCustomer));
  assert.equal((await customers(lateSite))[0].visitor_id, null);
  await send(lateSite, 'checkout.session.completed', checkout(lateIntent, lateCustomer, lateV.metadata));
  assert.equal((await customers(lateSite))[0].visitor_id, lateV.vid);
  assert.equal((await overview(lateSite)).revenue, 3900);
  assert.equal((await profile(lateSite, lateV)).payments.filter((p) => p.kind === 'refund').length, 1);
  const otherV = await visitor(lateSite);
  await send(lateSite, 'checkout.session.completed', checkout(lateIntent, lateCustomer, otherV.metadata));
  assert.equal((await customers(lateSite))[0].visitor_id, lateV.vid);
  check('refund-before-payment and late Checkout reconcile without overwriting attributed history');

  const trialSite = await site();
  const trialV = await visitor(trialSite);
  const trialCustomer = objectId('cus');
  await send(trialSite, 'checkout.session.completed', checkout(null, trialCustomer, {}, { mode: 'subscription', payment_status: 'no_payment_required', subscription: objectId('sub'), amount_total: 0, client_reference_id: trialV.vid }));
  assert.equal((await overview(trialSite)).customers, 0);
  await send(trialSite, 'payment_intent.succeeded', pi(objectId('pi'), trialCustomer));
  assert.equal((await customers(trialSite))[0].visitor_id, trialV.vid);
  assert.equal((await overview(trialSite)).revenue, 4900);
  check('trial/Payment Link customer context attributes the first later charge without counting trial revenue');

  const linkSite = await site();
  const linkV = await visitor(linkSite);
  const linkIntent = objectId('pi'), linkCustomer = objectId('cus');
  await send(linkSite, 'checkout.session.completed', checkout(linkIntent, linkCustomer, {}, { client_reference_id: `ml_${linkV.vid}__${linkV.sid}` }));
  await send(linkSite, 'payment_intent.succeeded', pi(linkIntent, linkCustomer));
  assert.equal((await customers(linkSite))[0].visitor_id, linkV.vid);
  assert.equal((await customers(linkSite))[0].session_id, linkV.sid);
  check('upstream encoded Payment Link reference preserves visitor and session attribution');

  const returnSite = await site();
  const returnV = await visitor(returnSite);
  const returnIntent = objectId('pi');
  const returnCheckout = checkout(returnIntent, null, {}, { id: objectId('cs_test'), customer_details: null });
  await call('/api/event', 'POST', { w: returnSite.id, t: 'pageview', u: `https://${returnSite.domain}/thanks?session_id=${returnCheckout.id}`, vid: returnV.vid, sid: returnV.sid });
  await send(returnSite, 'payment_intent.succeeded', pi(returnIntent, null));
  await send(returnSite, 'checkout.session.completed', returnCheckout);
  assert.equal((await customers(returnSite))[0].visitor_id, returnV.vid);
  check('upstream Checkout return-page claim reconciles when Checkout arrives after the payment');

  const afterSite = await site();
  const afterV = await visitor(afterSite);
  const afterIntent = objectId('pi');
  const afterCheckout = checkout(afterIntent, null, {}, { id: objectId('cs_test'), customer_details: null });
  await send(afterSite, 'checkout.session.completed', afterCheckout);
  await send(afterSite, 'payment_intent.succeeded', pi(afterIntent, null));
  await send(afterSite, 'refund.created', { ...refund, id: objectId('re'), payment_intent: afterIntent, status: 'succeeded' });
  await call('/api/event', 'POST', { w: afterSite.id, t: 'pageview', u: `https://${afterSite.domain}/thanks?session_id=${afterCheckout.id}`, vid: afterV.vid, sid: afterV.sid });
  assert.equal((await customers(afterSite))[0].visitor_id, afterV.vid);
  assert.equal((await profile(afterSite, afterV)).payments.filter(p => p.kind === 'refund').length, 1);
  check('return page arriving after payment and refund links both to the original visitor');

  const isolated = await site();
  const isolatedV = await visitor(isolated);
  await send(isolated, 'payment_intent.succeeded', pi(intent, customer, isolatedV.metadata));
  assert.equal((await overview(isolated)).revenue, 4900);
  assert.equal((await customers(isolated))[0].visitor_id, isolatedV.vid);
  check('the same Stripe transaction ID remains isolated across sites');

  const delayedSite = await site();
  const delayedV = await visitor(delayedSite);
  const delayedIntent = objectId('pi'), delayedCustomer = objectId('cus');
  await send(delayedSite, 'checkout.session.completed', checkout(delayedIntent, delayedCustomer, delayedV.metadata, { payment_status: 'unpaid' }));
  await send(delayedSite, 'payment_intent.payment_failed', { ...pi(delayedIntent, delayedCustomer), status: 'requires_payment_method' });
  await send(delayedSite, 'payment_intent.succeeded', pi(objectId('pi'), null, {}, 0));
  assert.equal((await overview(delayedSite)).customers, 0);
  await send(delayedSite, 'payment_intent.succeeded', pi(delayedIntent, delayedCustomer));
  await send(delayedSite, 'checkout.session.async_payment_succeeded', checkout(delayedIntent, delayedCustomer, delayedV.metadata));
  assert.equal((await overview(delayedSite)).revenue, 4900);
  assert.equal((await customers(delayedSite))[0].visitor_id, delayedV.vid);
  check('unpaid Checkout, failed payments and zero totals do not create revenue; delayed success counts once');

  const concurrentSite = await site();
  const concurrentV = await visitor(concurrentSite);
  const concurrentIntent = objectId('pi'), concurrentCustomer = objectId('cus');
  await Promise.all([
    send(concurrentSite, 'payment_intent.succeeded', pi(concurrentIntent, concurrentCustomer)),
    send(concurrentSite, 'checkout.session.completed', checkout(concurrentIntent, concurrentCustomer, concurrentV.metadata)),
    send(concurrentSite, 'refund.created', { ...refund, id: objectId('re'), payment_intent: concurrentIntent, status: 'succeeded' }),
  ]);
  assert.equal((await overview(concurrentSite)).revenue, 3900);
  assert.equal((await customers(concurrentSite))[0].visitor_id, concurrentV.vid);
  assert.equal((await profile(concurrentSite, concurrentV)).payments.filter((p) => p.kind === 'refund').length, 1);
  check('concurrent Checkout, payment and refund converge on one attributed net payment');

  const rotated = `whsec_${randomUUID()}`;
  await json(`/api/sites/${s.id}`, 'PATCH', { stripe_webhook_secret: rotated });
  assert.equal((await webhook(s, 'payment_intent.succeeded', payment)).status, 401);
  assert.equal((await webhook(s, 'payment_intent.succeeded', payment, { secret: rotated })).status, 200);
  check('secret rotation rejects old signatures immediately and accepts the new secret');

  for (const [currency, amount, expected] of [['JPY', 500, 500], ['ISK', 50000, 500], ['UGX', 50000, 500]]) {
    const currencySite = await site(currency);
    await send(currencySite, 'payment_intent.succeeded', pi(objectId('pi'), null, {}, amount, currency.toLowerCase()));
    assert.equal((await overview(currencySite)).revenue, expected);
  }
  check('zero-decimal currencies and Stripe ISK/UGX amount conventions are normalized');

  await json(`/api/sites/${s.id}`, 'PATCH', { stripe_webhook_secret: '' });
  assert.equal((await webhook(s, 'payment_intent.succeeded', payment)).status, 400);
  check('clearing the secret immediately disables Stripe deliveries');
} finally {
  for (const id of ids) await json(`/api/sites/${id}`, 'DELETE');
  if (ids.length) check('temporary sites and payment data removed');
}
console.log('\nAll Stripe smoke tests passed');
