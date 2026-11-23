import type { Site } from './env';
import { currencyDecimals } from '../shared/currency';

/**
 * Exchange rates for converting payments into the site's currency. Buyers can pay in their own currency
 * (Dodo's adaptive pricing, Stripe's multi-currency prices), and adding €4.56 to $5 as "$9.56" is wrong.
 * Rates are the day's ECB reference rate (frankfurter), falling back to open.er-api.com for currencies the
 * ECB doesn't publish. Only currency codes and a date are sent.
 */
async function fetchRate(base: string, quote: string, day: string): Promise<number | null> {
  try {
    const r = await fetch(`https://api.frankfurter.dev/v1/${day}?from=${base}&to=${quote}`);
    if (r.ok) {
      const j = (await r.json()) as { rates?: Record<string, number> };
      const rate = j.rates?.[quote];
      if (rate && rate > 0) return rate;
    }
  } catch {
    /* try the fallback */
  }
  try {
    const r = await fetch(`https://open.er-api.com/v6/latest/${base}`);
    if (r.ok) {
      const j = (await r.json()) as { result?: string; rates?: Record<string, number> };
      const rate = j.result === 'success' ? j.rates?.[quote] : undefined;
      if (rate && rate > 0) return rate;
    }
  } catch {
    /* no rate */
  }
  return null;
}

export async function getRate(db: D1Database, base: string, quote: string, ts: number): Promise<number | null> {
  base = base.toUpperCase();
  quote = quote.toUpperCase();
  if (base === quote) return 1;
  // Never ask for a future day (the payment's timestamp can be slightly ahead of the rate provider's clock).
  const day = new Date(Math.min(ts, Date.now())).toISOString().slice(0, 10);
  const cached = await db
    .prepare('SELECT rate FROM fx_rates WHERE day = ? AND base = ? AND quote = ?')
    .bind(day, base, quote)
    .first<{ rate: number }>();
  if (cached) return cached.rate;
  const rate = await fetchRate(base, quote, day);
  if (rate) await db.prepare('INSERT OR REPLACE INTO fx_rates (day, base, quote, rate) VALUES (?, ?, ?, ?)').bind(day, base, quote, rate).run();
  return rate;
}

/** Converts minor units between currencies with different decimals (e.g. JPY has none, USD has 2). */
export function convertMinor(amount: number, from: string, to: string, rate: number): number {
  const major = amount / 10 ** currencyDecimals(from);
  return Math.round(major * rate * 10 ** currencyDecimals(to));
}

export interface SiteMoney {
  amount: number;
  currency: string;
  originalAmount: number | null;
  originalCurrency: string | null;
}

/**
 * The amount in the site's currency, with the original kept when it was converted. When no rate is available
 * the amount stays in its own currency and convertForeignPayments() retries later.
 */
export async function toSiteMoney(db: D1Database, site: Site, amount: number, currency: string, ts: number): Promise<SiteMoney> {
  const cur = currency.toUpperCase();
  const target = site.currency.toUpperCase();
  if (cur === target) return { amount, currency: cur, originalAmount: null, originalCurrency: null };
  const rate = await getRate(db, cur, target, ts);
  if (!rate) return { amount, currency: cur, originalAmount: null, originalCurrency: null };
  return { amount: convertMinor(amount, cur, target, rate), currency: target, originalAmount: amount, originalCurrency: cur };
}

/** Converts payments still stored in another currency (recorded before conversion existed, or while rates were down). */
export async function convertForeignPayments(db: D1Database, site: Site) {
  const rows = await db
    .prepare('SELECT id, ts, amount, currency, original_amount, original_currency FROM payments WHERE site_id = ? AND currency != ? LIMIT 200')
    .bind(site.id, site.currency.toUpperCase())
    .all<{ id: string; ts: number; amount: number; currency: string; original_amount: number | null; original_currency: string | null }>();
  let converted = 0;
  for (const r of rows.results) {
    // After a change of site currency, convert from what the buyer paid rather than from an earlier conversion.
    const fromAmount = r.original_amount ?? r.amount;
    const fromCurrency = r.original_currency ?? r.currency;
    const m = await toSiteMoney(db, site, fromAmount, fromCurrency, r.ts);
    if (m.currency !== site.currency.toUpperCase()) continue;
    await db
      .prepare('UPDATE payments SET amount = ?, currency = ?, original_amount = ?, original_currency = ? WHERE site_id = ? AND id = ?')
      .bind(m.amount, m.currency, m.originalAmount, m.originalCurrency, site.id, r.id)
      .run();
    converted++;
  }
  return converted;
}
