import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';

type Json = Record<string, any>;
const base = process.env.BASE ?? 'http://localhost:8787';
const secret = `whsec_${randomUUID()}`;
const sites: string[] = [];
let cookie = '';

/** Exercise signed HTTP delivery against real Worker persistence, not provider mocks. */
async function request(path: string, method = 'GET', data?: unknown, extra: Record<string, string> = {}) {
  const response = await fetch(base + path, { method,
    headers: { cookie, 'content-type': 'application/json', ...extra },
    body: data === undefined ? undefined : typeof data === 'string' ? data : JSON.stringify(data),
  });
  const session = response.headers.get('set-cookie');
  if (session) cookie = session.split(';')[0];
  return { status: response.status, data: await response.json() as Json };
}

/** Create isolated smoke sites that are removed even if a check fails. */
async function createSite(value: string) {
  const response = await request('/api/sites', 'POST', { name: 'Scope smoke', domain: 'scope-smoke.example.com', currency: 'USD',
    stripe_metadata_key: 'product', stripe_metadata_value: value });
  assert.equal(response.status, 200);
  sites.push(response.data.id);
  const configured = await request(`/api/sites/${response.data.id}`, 'PATCH', { stripe_webhook_secret: secret });
  assert.equal(configured.status, 200);
  return response.data.id as string;
}

/** Deliver real HMAC-signed fixtures without contacting Stripe or charging money. */
async function send(site: string, type: string, object: Json) {
  const ts = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id: `evt_${randomUUID().replaceAll('-', '')}`, type, created: ts, data: { object } });
  const signature = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  const response = await request(`/api/webhooks/stripe/${site}`, 'POST', body, { 'stripe-signature': `t=${ts},v1=${signature}` });
  assert.equal(response.status, 200, JSON.stringify(response.data));
}

/** Compare money and payment counts at the dashboard boundary. */
async function total(site: string, revenue: number, payments: number) {
  const response = await request(`/api/sites/${site}/overview?period=all`);
  assert.equal(response.status, 200);
  assert.equal(response.data.current.revenue, revenue);
  assert.equal(response.data.current.payments, payments);
}

const customer = 'cus_shared';
const payment = { id: 'pi_alpha', object: 'payment_intent', status: 'succeeded', amount_received: 1000, currency: 'usd', customer, metadata: { product: 'alpha' } };
const refund = { id: 're_alpha', object: 'refund', status: 'succeeded', payment_intent: 'pi_alpha', amount: 200, currency: 'usd' };
const checkout = { id: 'cs_alpha', object: 'checkout.session', mode: 'payment', payment_status: 'paid', payment_intent: 'pi_alpha', customer,
  metadata: { product: 'alpha', ml_visitor_id: 'alpha_visitor', ml_session_id: 'alpha_session' }, customer_details: { email: 'scope@example.test' } };

try {
  const login = await request('/api/auth/login', 'POST', { password: process.env.ADMIN_PASSWORD ?? 'change-me' });
  assert.equal(login.status, 200);
  const alpha = await createSite('alpha');
  const beta = await createSite('beta');
  for (const patch of [{ stripe_metadata_key: 'product' }, { stripe_metadata_key: 'bad[key]', stripe_metadata_value: 'alpha' }, { stripe_metadata_key: 5, stripe_metadata_value: 'alpha' }]) {
    assert.equal((await request(`/api/sites/${alpha}`, 'PATCH', patch)).status, 400);
  }
  assert.equal((await request(`/api/sites/${alpha}`)).data.stripe_metadata_value, 'alpha');
  await send(alpha, 'checkout.session.completed', { ...checkout, metadata: { product: 'beta', ml_visitor_id: 'wrong_visitor' } });
  await send(alpha, 'payment_intent.succeeded', { ...payment, metadata: { product: 'beta' } });
  await send(alpha, 'payment_intent.succeeded', { ...payment, metadata: {} });
  await send(alpha, 'refund.created', refund);
  await total(alpha, 0, 0);
  await send(alpha, 'checkout.session.completed', checkout);
  await send(alpha, 'payment_intent.succeeded', { ...payment, metadata: {} });
  await total(alpha, 0, 0);
  await Promise.all([send(alpha, 'payment_intent.succeeded', payment), send(alpha, 'payment_intent.succeeded', payment), send(alpha, 'refund.updated', refund)]);
  await total(alpha, 800, 1);
  const customers = await request(`/api/sites/${alpha}/customers?period=all`);
  assert.equal(customers.data[0].visitor_id, 'alpha_visitor');
  await send(alpha, 'payment_intent.succeeded', { ...payment, id: 'pi_other_product', metadata: { product: 'beta' } });
  await send(alpha, 'payment_intent.succeeded', { ...payment, id: 'pi_unmarked_renewal', metadata: {} });
  await total(alpha, 800, 1);
  for (const [type, object] of [['payment_intent.succeeded', payment], ['checkout.session.completed', checkout], ['refund.created', refund]] as const) await send(beta, type, object);
  await total(beta, 0, 0);
  await send(beta, 'payment_intent.succeeded', { ...payment, metadata: { product: 'beta' } });
  await total(beta, 800, 1);
  console.log('ok - exact metadata isolation, rejected context, shared customer, missing markers, early refunds and concurrent deduplication');

  await send(alpha, 'refund.created', { ...refund, id: 're_mismatch', currency: 'eur' });
  await send(alpha, 'refund.updated', { ...refund, id: 're_pending', status: 'pending' });
  await total(alpha, 800, 1);
  const empty = { stripe_metadata_key: null, stripe_metadata_value: null };
  assert.equal((await request(`/api/sites/${alpha}`, 'PATCH', empty)).status, 200);
  await send(alpha, 'payment_intent.succeeded', { ...payment, id: 'pi_unfiltered', metadata: {} });
  await total(alpha, 1800, 2);
  assert.equal((await request(`/api/sites/${alpha}`, 'PATCH', { stripe_metadata_key: 'product', stripe_metadata_value: 'changed' })).status, 200);
  await send(alpha, 'payment_intent.succeeded', { ...payment, id: 'pi_after_change' });
  await send(alpha, 'refund.created', { ...refund, id: 're_after_change', amount: 100 });
  await total(alpha, 1700, 2);
  console.log('ok - currency-safe refunds, disabled filter compatibility and prospective rule updates');
} finally {
  for (const site of sites) assert.equal((await request(`/api/sites/${site}`, 'DELETE')).status, 200);
}
console.log('All Stripe scope HTTP smoke checks passed; temporary sites removed.');
