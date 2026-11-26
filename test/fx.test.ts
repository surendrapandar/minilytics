import { describe, expect, it } from 'vitest';
import { toSiteCurrency } from '../src/worker/lib/fx';

/** Rates as of 2026-11-24 (ECB, via Frankfurter); any other pair is unknown. */
const RATES: Record<string, number> = { 'EUR>USD': 1.0963, 'GBP>USD': 1.3125, 'JPY>USD': 0.0066, 'CAD>USD': 0.698, 'HKD>USD': 0.1275 };
const rate = async (from: string, to: string) => RATES[`${from}>${to}`] ?? null;
const DAY = '2026-11-24';

describe('revenue in the site currency, tax included', () => {
  it('keeps a USD payment settled in USD as is', async () => {
    expect(await toSiteCurrency({ amount: 599, currency: 'USD', tax: 0, settlementAmount: 599, settlementCurrency: 'USD' }, 'USD', DAY, rate)).toBe(599);
  });

  it('keeps tax in, as the provider\'s gross volume does', async () => {
    // $10.00 incl. $1.80 tax -> $10.00
    expect(await toSiteCurrency({ amount: 1000, currency: 'USD', tax: 180 }, 'USD', DAY, rate)).toBe(1000);
  });

  it("converts what the customer was charged, not Dodo's smaller settlement", async () => {
    // CA$9.90 incl. CA$1.02 tax, settled $6.71 (after the customer's FX fee) -> 9.90 x 0.698 = $6.91, as Dodo's gross volume
    expect(await toSiteCurrency({ amount: 990, currency: 'CAD', tax: 102, settlementAmount: 671, settlementCurrency: 'USD' }, 'USD', DAY, rate)).toBe(691);
  });

  it("falls back to Dodo's settlement when the charge currency has no rate", async () => {
    // RSD 556.92 has no ECB rate; settled $4.99
    expect(await toSiteCurrency({ amount: 55692, currency: 'RSD', tax: 0, settlementAmount: 499, settlementCurrency: 'USD' }, 'USD', DAY, rate)).toBe(499);
  });

  it('converts a payment settled in another currency at that day’s rate', async () => {
    // €10.00 incl. €1.80 VAT, settled €10.00 -> €10.00 x 1.0963 = $10.96
    expect(await toSiteCurrency({ amount: 1000, currency: 'EUR', tax: 180, settlementAmount: 1000, settlementCurrency: 'EUR' }, 'USD', DAY, rate)).toBe(1096);
  });

  it('converts a charge in any currency, never counting it at face value', async () => {
    // HK$73.32 settled £6.86 -> 73.32 x 0.1275 = $9.35 (not $73.32)
    expect(await toSiteCurrency({ amount: 7332, currency: 'HKD', tax: 0, settlementAmount: 686, settlementCurrency: 'GBP' }, 'USD', DAY, rate)).toBe(935);
  });

  it('respects currencies without minor units', async () => {
    // ¥1,500 x 0.0066 = $9.90
    expect(await toSiteCurrency({ amount: 1500, currency: 'JPY' }, 'USD', DAY, rate)).toBe(990);
  });

  it('keeps refunds negative', async () => {
    // -€5.00 -> -$5.48
    expect(await toSiteCurrency({ amount: -500, currency: 'EUR' }, 'USD', DAY, rate)).toBe(-548);
  });

  it('is null when no rate is known, so the payment is never counted at face value', async () => {
    expect(await toSiteCurrency({ amount: 55692, currency: 'RSD' }, 'USD', DAY, rate)).toBeNull();
  });

  it('is zero for a free order', async () => {
    expect(await toSiteCurrency({ amount: 0, currency: 'EUR', tax: 0 }, 'USD', DAY, rate)).toBe(0);
  });
});
