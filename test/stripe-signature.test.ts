import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyStripeWebhook } from '../src/worker/lib/crypto';

describe('Stripe webhook signatures', () => {
  const secret = 'whsec_stripe-endpoint-secret';
  const now = 1_800_000_000_000;
  const timestamp = now / 1000;
  const body = '{"type":"payment_intent.succeeded","name":"订单"}';
  const signature = (ts = timestamp, payload = body, key = secret) =>
    `t=${ts},v1=${createHmac('sha256', key).update(`${ts}.${payload}`).digest('hex')}`;

  it('accepts an exact UTF-8 payload and a current signature among rotated signatures', async () => {
    expect(await verifyStripeWebhook(secret, signature(), body, now)).toBe(true);
    expect(await verifyStripeWebhook(secret, `${signature()},v1=${'0'.repeat(64)}`, body, now)).toBe(true);
    expect(await verifyStripeWebhook(secret, `v1=${'0'.repeat(64)}, ${signature()}`, body, now)).toBe(true);
  });

  it('rejects modified payloads, the wrong secret, and unsupported signature versions', async () => {
    expect(await verifyStripeWebhook(secret, signature(), body + ' ', now)).toBe(false);
    expect(await verifyStripeWebhook('whsec_wrong', signature(), body, now)).toBe(false);
    expect(await verifyStripeWebhook(secret, signature().replace('v1=', 'v0='), body, now)).toBe(false);
  });

  it('enforces both replay and future timestamp boundaries', async () => {
    for (const delta of [-300, 300]) {
      expect(await verifyStripeWebhook(secret, signature(timestamp + delta), body, now)).toBe(true);
    }
    for (const delta of [-301, 301]) {
      expect(await verifyStripeWebhook(secret, signature(timestamp + delta), body, now)).toBe(false);
    }
  });

  it('rejects absent, ambiguous and malformed timestamp/signature headers', async () => {
    for (const header of [null, '', 'v1=abc', signature() + `,t=${timestamp}`, 't=NaN,v1=abc', `t=${timestamp},v1=xyz`]) {
      expect(await verifyStripeWebhook(secret, header, body, now)).toBe(false);
    }
  });
});
