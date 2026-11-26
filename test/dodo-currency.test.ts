import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/worker/index';
import { d1, schemaDb } from './helpers/sqlite-d1';

/**
 * Revenue is stored tax included in the site's currency, so totals never add EUR, GBP or HKD
 * minor units into a USD sum. Regression for a USD site showing a HK$73.32 payment (settled £6.86) as
 * $73.32 and EUR/GBP payments at face value.
 */

const key = Buffer.from('dodo-test-key');
const secret = 'whsec_' + key.toString('base64');
const ctx = { waitUntil() {}, passThroughOnException() {} } as any;

/** Days Frankfurter has rates for; any other day is "unavailable". */
let rateDays = new Set(['2026-11-24']);

/** ECB rates as Frankfurter serves them, for the days in `rateDays`. */
function stubRates() {
  rateDays = new Set(['2026-11-24']);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const m = String(url).match(/frankfurter\.dev\/v1\/(\d{4}-\d{2}-\d{2})\?base=(\w+)&symbols=(\w+)/);
      const rates: Record<string, number> = { 'EUR>USD': 1.0963, 'GBP>USD': 1.3125, 'HKD>USD': 0.1275 };
      const r = m && rateDays.has(m[1]) ? rates[`${m[2]}>${m[3]}`] : undefined;
      return r ? new Response(JSON.stringify({ base: m![2], rates: { [m![3]]: r } })) : new Response('{}', { status: 404 });
    }),
  );
}

let n = 0;
function setup() {
  const db = schemaDb();
  const site = `site${String(++n).padStart(5, '0')}`;
  db.prepare("INSERT INTO sites (id, name, domain, currency, api_key, dodo_webhook_secret, created_at) VALUES (?, 'Shop', 'shop.example', 'USD', ?, ?, 0)").run(site, `key_${site}`, secret);
  const env = { DB: d1(db), ASSETS: { fetch: async () => new Response('') } } as any;
  const send = async (type: string, data: Record<string, unknown>) => {
    const body = JSON.stringify({ type, timestamp: '2026-11-24T12:00:00Z', data });
    const id = `msg_${Math.random().toString(36).slice(2)}`;
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
    const res = await app.fetch(
      new Request(`https://analytics.example/api/webhooks/dodo/${site}`, {
        method: 'POST',
        headers: { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}`, 'Content-Type': 'application/json' },
        body,
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
  };
  const row = (id: string) =>
    db.prepare('SELECT amount, currency, orig_amount, orig_currency, fx_pending, kind FROM payments WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  const api = async (body: Record<string, unknown>) => {
    const res = await app.fetch(
      new Request('https://analytics.example/api/v1/payments', {
        method: 'POST',
        headers: { Authorization: `Bearer key_${site}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
  };
  return { send, row, api, site };
}

const paid = (id: string, fields: Record<string, unknown>) => ({
  payment_id: id,
  created_at: '2026-11-24T12:00:00Z',
  customer: { customer_id: 'cus_1', email: 'a@b.c', name: 'A' },
  product_cart: [],
  ...fields,
});

beforeEach(stubRates);
afterEach(() => vi.unstubAllGlobals());

describe('a Dodo payment is stored as revenue in the site currency, tax included', () => {
  it('converts a EUR payment settled in EUR at the day’s rate, tax included', async () => {
    const { send, row } = setup();
    // €10.00 incl. €1.80 VAT -> €10.00 x 1.0963 = $10.96
    await send('payment.succeeded', paid('pay_eur', { total_amount: 1000, currency: 'EUR', tax: 180, settlement_amount: 1000, settlement_currency: 'EUR' }));
    expect(row('pay_eur')).toEqual({ amount: 1096, currency: 'USD', orig_amount: 1000, orig_currency: 'EUR', fx_pending: 0, kind: 'payment' });
  });

  it('converts the HKD charge, not its face value (HKD charged, settled in GBP)', async () => {
    const { send, row } = setup();
    // HK$73.32 x 0.1275 -> $9.35, not $73.32
    await send('payment.succeeded', paid('pay_hkd', { total_amount: 7332, currency: 'HKD', tax: 0, settlement_amount: 686, settlement_currency: 'GBP' }));
    expect(row('pay_hkd')).toMatchObject({ amount: 935, currency: 'USD', orig_amount: 7332, orig_currency: 'HKD' });
  });

  it('does not record a free order as a purchase', async () => {
    const { send, row } = setup();
    await send('payment.succeeded', paid('pay_free', { total_amount: 0, currency: 'EUR', tax: 0, settlement_amount: 0, settlement_currency: 'EUR' }));
    expect(row('pay_free')).toBeUndefined();
  });

  it('marks a payment as pending conversion instead of counting it at face value when no rate is known', async () => {
    const { send, row } = setup();
    await send('payment.succeeded', paid('pay_norate', { created_at: '2026-11-25T12:00:00Z', total_amount: 1000, currency: 'EUR', tax: 0, settlement_amount: 1000, settlement_currency: 'EUR' }));
    expect(row('pay_norate')).toMatchObject({ amount: 0, currency: 'USD', orig_amount: 1000, orig_currency: 'EUR', fx_pending: 1 });
  });

  it('subtracts a partial refund at the same rate as its payment', async () => {
    const { send, row } = setup();
    await send('payment.succeeded', paid('pay_r', { total_amount: 1000, currency: 'EUR', tax: 180, settlement_amount: 1000, settlement_currency: 'EUR' }));
    // half of €10.00 refunded -> half of $10.96
    await send('refund.succeeded', { refund_id: 'ref_1', payment_id: 'pay_r', amount: 500, currency: 'EUR', created_at: '2026-11-25T09:00:00Z' });
    expect(row('ref_1')).toMatchObject({ kind: 'refund', amount: -548, currency: 'USD', orig_amount: -500, orig_currency: 'EUR' });
  });

  it('converts a pending payment later exactly as on arrival', async () => {
    const { send, row } = setup();
    // No rate yet for 2026-11-25: €10.00 incl. €1.80 VAT, settled £8.00 GBP, waits.
    await send('payment.succeeded', paid('pay_wait', { created_at: '2026-11-25T12:00:00Z', total_amount: 1000, currency: 'EUR', tax: 180, settlement_amount: 800, settlement_currency: 'GBP' }));
    expect(row('pay_wait')).toMatchObject({ amount: 0, fx_pending: 1 });
    // The rate arrives; the next webhook converts it: €10.00 x 1.0963 = $10.96
    rateDays.add('2026-11-25');
    await send('payment.succeeded', paid('pay_next', { total_amount: 599, currency: 'USD', tax: 0, settlement_amount: 599, settlement_currency: 'USD' }));
    expect(row('pay_wait')).toMatchObject({ amount: 1096, currency: 'USD', fx_pending: 0 });
  });
});

describe('the payments API', () => {
  it('converts its pending payments on a later call', async () => {
    const { api, row, site } = setup();
    await api({ transaction_id: 'txn_wait', amount: 10, currency: 'EUR', timestamp: '2026-11-25T12:00:00Z' });
    rateDays.add('2026-11-25');
    await api({ transaction_id: 'txn_next', amount: 5, currency: 'USD' });
    // €10.00 x 1.0963 = $10.96
    expect(row(`${site}:txn_wait`)).toMatchObject({ amount: 1096, currency: 'USD', fx_pending: 0 });
  });

  it('refunds a payment by its own rate, whatever the refund day', async () => {
    const { api, row, site } = setup();
    await api({ transaction_id: 't1', amount: 10, currency: 'EUR', timestamp: '2026-11-24T12:00:00Z' });
    // Refunded on a day with no rate: still exactly the payment's $10.96, not pending and not re-rated.
    await api({ transaction_id: 't1', amount: 10, currency: 'EUR', refunded: true, timestamp: '2026-11-26T12:00:00Z' });
    expect(row(`${site}:t1`)).toMatchObject({ amount: 1096 });
    expect(row(`${site}:t1:refund`)).toMatchObject({ kind: 'refund', amount: -1096, fx_pending: 0 });
  });

  it('gives up on a payment that still has no rate after a week, so it stops blocking the queue', async () => {
    const { api, row, site } = setup();
    await api({ transaction_id: 'rsd', amount: 556.92, currency: 'RSD', timestamp: '2026-11-10T12:00:00Z' });
    await api({ transaction_id: 'next', amount: 5, currency: 'USD' });
    expect(row(`${site}:rsd`)).toMatchObject({ amount: 0, fx_pending: 2 });
  });
});

describe('a refund of a payment still waiting for its rate', () => {
  it('converts at the payment’s rate, so a full refund cancels it', async () => {
    const { send, row } = setup();
    await send('payment.succeeded', paid('pay_pw', { created_at: '2026-11-25T12:00:00Z', total_amount: 1000, currency: 'EUR', tax: 180, settlement_amount: 800, settlement_currency: 'GBP' }));
    await send('refund.succeeded', { refund_id: 'ref_pw', payment_id: 'pay_pw', amount: 1000, currency: 'EUR', created_at: '2026-11-26T09:00:00Z' });
    rateDays.add('2026-11-25');
    await send('payment.succeeded', paid('pay_tick', { total_amount: 599, currency: 'USD', tax: 0, settlement_amount: 599, settlement_currency: 'USD' }));
    expect(row('pay_pw')).toMatchObject({ amount: 1096, fx_pending: 0 });
    expect(row('ref_pw')).toMatchObject({ amount: -1096, fx_pending: 0 });
  });
});
