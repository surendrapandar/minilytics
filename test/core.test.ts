import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { classify } from '../src/shared/sources';
import { parseTiers, planInfo } from '../src/worker/billing';
import { belongsTo, normalizePath } from '../src/worker/collect';
import type { Env } from '../src/worker/env';
import { verifyRazorpaySignature, verifyStandardWebhook, verifyStripeWebhook } from '../src/worker/lib/crypto';
import { parseRazorpayEvent, razorpayAccepts } from '../src/worker/razorpay';
import { bucketLabels, resolveRange, startOfDay, tzOffset } from '../src/worker/lib/time';
import { isBot, parseUA } from '../src/worker/lib/ua';

describe('classify', () => {
  it('maps t.co to X / social', () => {
    expect(classify({ referrerDomain: 't.co' })).toMatchObject({ source: 'X', channel: 'Organic Social' });
  });
  it('maps Google to organic search', () => {
    expect(classify({ referrerDomain: 'google.co.in' })).toMatchObject({ source: 'Google', channel: 'Organic Search' });
  });
  it('recognises AI assistants, including utm_source=chatgpt.com', () => {
    expect(classify({ referrerDomain: null, utmSource: 'chatgpt.com' })).toMatchObject({ source: 'ChatGPT', channel: 'AI' });
  });
  it('lets ref/utm tags win over the referrer', () => {
    expect(classify({ referrerDomain: 'google.com', ref: 'producthunt' })).toMatchObject({ source: 'Product Hunt' });
    expect(classify({ referrerDomain: null, ref: 'my-newsletter-42' })).toMatchObject({ source: 'my-newsletter-42', channel: 'Referral' });
  });
  it('detects paid and email by medium', () => {
    expect(classify({ referrerDomain: 'google.com', utmMedium: 'cpc' }).channel).toBe('Paid');
    expect(classify({ referrerDomain: null, utmSource: 'buttondown', utmMedium: 'email' }).channel).toBe('Email');
  });
  it('falls back to Direct', () => {
    expect(classify({ referrerDomain: null })).toMatchObject({ source: 'Direct/None', channel: 'Direct' });
  });
  it('does not confuse mail.google.com with Google search', () => {
    expect(classify({ referrerDomain: 'mail.google.com' })).toMatchObject({ source: 'Gmail', channel: 'Email' });
  });
});

describe('user agents', () => {
  it('parses common browsers', () => {
    expect(parseUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toEqual({ browser: 'Mobile Safari', os: 'iOS', device: 'Mobile' });
    expect(parseUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0')).toEqual({ browser: 'Edge', os: 'Windows', device: 'Desktop' });
    expect(parseUA('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36').browser).toBe('Chrome');
  });
  it('flags bots', () => {
    expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true);
    expect(isBot('Mozilla/5.0 HeadlessChrome/120')).toBe(true);
    expect(isBot('')).toBe(true);
    expect(isBot('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/129 Safari/537.36')).toBe(false);
  });
});

describe('domains and paths', () => {
  it('accepts subdomains only', () => {
    expect(belongsTo('app.shipkit.dev', 'shipkit.dev')).toBe(true);
    expect(belongsTo('www.shipkit.dev', 'shipkit.dev')).toBe(true);
    expect(belongsTo('evilshipkit.dev', 'shipkit.dev')).toBe(false);
  });
  it('normalises paths', () => {
    expect(normalizePath('/pricing/')).toBe('/pricing');
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('/caf%C3%A9')).toBe('/café');
  });
});

describe('time ranges', () => {
  const now = Date.UTC(2026, 9, 23, 12, 0); // 23 Oct 2026 12:00 UTC
  it('computes timezone offsets', () => {
    expect(tzOffset('Asia/Kolkata', now)).toBe(330 * 60_000);
    expect(tzOffset('UTC', now)).toBe(0);
  });
  it('starts "today" at local midnight', () => {
    const r = resolveRange({ period: 'today' }, 'Asia/Kolkata', 0, now);
    expect(r.from).toBe(Date.UTC(2026, 9, 22, 18, 30));
    expect(r.granularity).toBe('hour');
  });
  it('last 30 days covers 30 local days', () => {
    const r = resolveRange({ period: '30d' }, 'UTC', 0, now);
    expect(r.from).toBe(startOfDay(now, 'UTC') - 29 * 86_400_000);
    expect(bucketLabels(r, 0)).toHaveLength(30);
  });
  it('custom ranges include the whole last day', () => {
    const r = resolveRange({ period: 'custom', from: '2026-10-01', to: '2026-10-07' }, 'UTC', 0, now);
    expect(r.to - r.from).toBe(7 * 86_400_000);
  });
  it('weekly buckets start on Monday', () => {
    const r = resolveRange({ period: '30d', granularity: 'week' }, 'UTC', 0, now);
    for (const l of bucketLabels(r, 0)) expect(new Date(l + 'T00:00:00Z').getUTCDay()).toBe(1);
  });
});

describe('Standard Webhooks (Dodo)', () => {
  const key = Buffer.from('super-secret-key-bytes');
  const secret = 'whsec_' + key.toString('base64');
  const body = '{"type":"payment.succeeded"}';
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', key).update(`msg_1.${ts}.${body}`).digest('base64');
  it('accepts a valid signature (also among several)', async () => {
    expect(await verifyStandardWebhook(secret, { id: 'msg_1', timestamp: ts, signature: `v1,${sig}` }, body)).toBe(true);
    expect(await verifyStandardWebhook(secret, { id: 'msg_1', timestamp: ts, signature: `v1,old v1,${sig}` }, body)).toBe(true);
  });
  it('rejects tampering and stale timestamps', async () => {
    expect(await verifyStandardWebhook(secret, { id: 'msg_1', timestamp: ts, signature: `v1,${sig}` }, body + ' ')).toBe(false);
    expect(await verifyStandardWebhook(secret, { id: 'msg_1', timestamp: String(Number(ts) - 3600), signature: `v1,${sig}` }, body)).toBe(false);
  });
});

describe('Stripe webhooks', () => {
  const secret = 'whsec_test_secret';
  const body = '{"type":"checkout.session.completed"}';
  const t = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  it('accepts a valid signature (also among several)', async () => {
    expect(await verifyStripeWebhook(secret, `t=${t},v1=${sig}`, body)).toBe(true);
    expect(await verifyStripeWebhook(secret, `t=${t},v1=deadbeef,v1=${sig},v0=old`, body)).toBe(true);
  });
  it('rejects tampering, a wrong secret and stale timestamps', async () => {
    expect(await verifyStripeWebhook(secret, `t=${t},v1=${sig}`, body + ' ')).toBe(false);
    expect(await verifyStripeWebhook('whsec_other', `t=${t},v1=${sig}`, body)).toBe(false);
    expect(await verifyStripeWebhook(secret, `t=${Number(t) - 3600},v1=${sig}`, body)).toBe(false);
    expect(await verifyStripeWebhook(secret, null, body)).toBe(false);
  });
});

describe('price tiers', () => {
  const TIERS = '$29:5, $49:pdt_49:5, $100';
  const env = (paid: number) =>
    ({
      GOOGLE_CLIENT_ID: 'x',
      GOOGLE_CLIENT_SECRET: 'x',
      PLAN_TIERS: TIERS,
      DB: { prepare: () => ({ first: async () => ({ n: paid }) }) },
    }) as unknown as Env;

  it('parses tiers with optional product ids and spots', () => {
    expect(parseTiers(TIERS)).toEqual([
      { price: '$29', productId: null, spots: 5 },
      { price: '$49', productId: 'pdt_49', spots: 5 },
      { price: '$100', productId: null, spots: 0 },
    ]);
  });
  it('sells the next tier once the first sells out, and shows what sold', async () => {
    expect(await planInfo(env(7))).toMatchObject({
      price: '$49', spots: 5, spotsLeft: 3, nextPrice: '$100', soldOut: [{ price: '$29', spots: 5 }],
    });
  });
  it('keeps selling the last buyable tier when the next price has no product yet', async () => {
    expect(await planInfo(env(12))).toMatchObject({ price: '$49', spotsLeft: null, nextPrice: '$100' });
  });
});

describe('Razorpay webhooks', () => {
  const secret = 'rzp-webhook-secret';
  const body = '{"event":"payment.captured"}';
  const sig = createHmac('sha256', secret).update(body).digest('hex');

  it('verifies the hex HMAC signature', async () => {
    expect(await verifyRazorpaySignature(secret, sig, body)).toBe(true);
    expect(await verifyRazorpaySignature(secret, sig.toUpperCase(), body)).toBe(true);
    expect(await verifyRazorpaySignature(secret, sig, body + ' ')).toBe(false);
    expect(await verifyRazorpaySignature('other', sig, body)).toBe(false);
    expect(await verifyRazorpaySignature(secret, null, body)).toBe(false);
  });

  const captured = (extra: Record<string, any> = {}, payment: Record<string, any> = {}) => ({
    event: 'payment.captured',
    created_at: 1761500000,
    payload: {
      payment: {
        entity: {
          id: 'pay_Abc123XYZ', amount: 49900, currency: 'INR', status: 'captured', created_at: 1761499990,
          email: 'Jane@Acme.com', customer_id: 'cust_1', notes: [], ...payment,
        },
      },
      ...extra,
    },
  });

  it('reads a captured payment in paise, with visitor ids from order notes', () => {
    const e = parseRazorpayEvent(
      captured({ order: { entity: { id: 'order_1', notes: { ml_visitor_id: 'v1', ml_session_id: 's1' } } } }),
      'INR',
    );
    expect(e).toMatchObject({
      type: 'payment',
      payment: { id: 'pay_Abc123XYZ', provider: 'razorpay', amount: 49900, currency: 'INR', ts: 1761499990000,
                 visitorId: 'v1', sessionId: 's1', email: 'jane@acme.com', customerId: 'cust_1' },
    });
  });

  it('lets payment notes win and drops the placeholder email', () => {
    const e = parseRazorpayEvent(
      captured({ order: { entity: { notes: { ml_visitor_id: 'from-order' } } } }, { email: 'void@razorpay.com', notes: { ml_visitor_id: 'from-pay' } }),
      'INR',
    );
    expect(e?.type === 'payment' && e.payment).toMatchObject({ visitorId: 'from-pay', email: null });
  });

  it('uses the settled INR amount for international payments', () => {
    const e = parseRazorpayEvent(captured({}, { amount: 600, currency: 'USD', base_amount: 49900, base_currency: 'INR' }), 'INR');
    expect(e?.type === 'payment' && e.payment).toMatchObject({ amount: 49900, currency: 'INR' });
  });

  it('reads payment links and subscriptions, with ids for filtering', () => {
    const link = parseRazorpayEvent(
      { event: 'payment_link.paid', payload: { payment: captured().payload.payment,
        payment_link: { entity: { id: 'plink_9', notes: { ml_visitor_id: 'v9' }, customer: { name: 'Jane' } } } } },
      'INR',
    );
    expect(link).toMatchObject({ filterIds: ['plink_9'], payment: { visitorId: 'v9', name: 'Jane' } });
    const sub = parseRazorpayEvent(
      { event: 'subscription.charged', payload: { payment: captured().payload.payment,
        subscription: { entity: { id: 'sub_7', plan_id: 'plan_3', customer_id: 'cust_2' } } } },
      'INR',
    );
    expect(sub).toMatchObject({ filterIds: ['plan_3'], payment: { subscriptionId: 'sub_7', customerId: 'cust_1' } });
  });

  it('reads refunds and ignores events that move no money', () => {
    expect(
      parseRazorpayEvent({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_1', amount: 100, currency: 'INR', created_at: 1 } } } }, 'INR'),
    ).toEqual({ type: 'refund', refundId: 'rfnd_1', paymentId: 'pay_1', amount: 100, currency: 'INR', ts: 1000 });
    expect(parseRazorpayEvent({ event: 'payment.failed', payload: captured().payload }, 'INR')).toBeNull();
    expect(parseRazorpayEvent(captured({}, { status: 'authorized' }), 'INR')).toBeNull();
  });

  it('filters payments by site tag or link/plan ids', () => {
    const e = parseRazorpayEvent(
      { event: 'payment_link.paid', payload: { payment: captured().payload.payment, payment_link: { entity: { id: 'plink_9' } } } },
      'INR',
    );
    if (e?.type !== 'payment') throw new Error('expected payment');
    expect(razorpayAccepts({ id: 'site1', razorpay_filter_ids: null }, e)).toBe(true);
    expect(razorpayAccepts({ id: 'site1', razorpay_filter_ids: 'plink_9,plan_3' }, e)).toBe(true);
    expect(razorpayAccepts({ id: 'site1', razorpay_filter_ids: 'plink_other' }, e)).toBe(false);
    expect(razorpayAccepts({ id: 'site1', razorpay_filter_ids: 'plink_other' }, { ...e, siteTag: 'site1' })).toBe(true);
    expect(razorpayAccepts({ id: 'site1', razorpay_filter_ids: null }, { ...e, siteTag: 'site2' })).toBe(false);
  });
});
