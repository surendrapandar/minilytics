import { describe, expect, it, vi } from 'vitest';
import type { Site } from '../src/worker/env';
import { convertMinor, toSiteMoney } from '../src/worker/fx';
import { refundMoney } from '../src/worker/payments';

/** A D1 stand-in whose fx_rates cache already holds the rates, so no network is used. */
function ratesDb(rates: Record<string, number>) {
  return {
    prepare() {
      return {
        bind(_day: string, base: string, quote: string) {
          return { first: async () => (rates[`${base}${quote}`] ? { rate: rates[`${base}${quote}`] } : null), run: async () => ({}) };
        },
      };
    },
  } as unknown as D1Database;
}

const site = { id: 's', currency: 'USD' } as Site;
const db = ratesDb({ EURUSD: 1.0864, JPYUSD: 0.0066 });

describe('currency conversion', () => {
  it('converts minor units, including currencies without decimals', () => {
    expect(convertMinor(456, 'EUR', 'USD', 1.0864)).toBe(495); // €4.56 → $4.95
    expect(convertMinor(1500, 'JPY', 'USD', 0.0066)).toBe(990); // ¥1500 → $9.90
    expect(convertMinor(1000, 'USD', 'JPY', 151.5)).toBe(1515); // $10 → ¥1515
  });

  it('stores a foreign payment in the site currency and keeps the original', async () => {
    expect(await toSiteMoney(db, site, 456, 'eur', Date.now())).toEqual({ amount: 495, currency: 'USD', originalAmount: 456, originalCurrency: 'EUR' });
    expect(await toSiteMoney(db, site, 500, 'usd', Date.now())).toEqual({ amount: 500, currency: 'USD', originalAmount: null, originalCurrency: null });
  });

  it('leaves the amount in its own currency when no rate is known (retried later)', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    expect(await toSiteMoney(db, site, 999, 'XYZ', Date.now())).toMatchObject({ amount: 999, currency: 'XYZ', originalAmount: null });
    vi.unstubAllGlobals();
  });

  it("refunds at the payment's rate so a full refund nets to zero", async () => {
    const original = { amount: 495, currency: 'USD', original_amount: 456, original_currency: 'EUR' };
    expect((await refundMoney(ratesDb({}), site, original, 456, 'EUR', Date.now())).amount).toBe(495);
    expect((await refundMoney(ratesDb({}), site, original, 228, 'eur', Date.now())).amount).toBe(248);
    expect((await refundMoney(ratesDb({}), site, original, 0, null, Date.now())).amount).toBe(495);
  });
});
