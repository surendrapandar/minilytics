import { currencyDecimals } from '../../shared/currency';

/** A charge as the payment provider reports it, in minor units (negative for refunds). */
export interface Money {
  amount: number;
  currency: string;
  /** Tax included in `amount`, same currency. */
  tax?: number | null;
  /** What the provider paid out for it, when known (Dodo settles in USD, EUR or GBP); used when the charge currency has no rate. */
  settlementAmount?: number | null;
  settlementCurrency?: string | null;
}

/** Units of `to` per unit of `from` on `day` (YYYY-MM-DD), or null when unknown. */
export type RateFn = (from: string, to: string, day: string) => Promise<number | null>;

export const dayOf = (ts: number) => new Date(ts).toISOString().slice(0, 10);

/**
 * Revenue (tax included, like a provider's gross volume) in the site's currency, in its minor units: what
 * the customer was charged, converted at the day's rate. The provider's settlement is used only when the
 * charge currency has no rate; it can be smaller, since it leaves out any FX fee the customer paid. Null
 * when neither has a rate: such a payment must not be counted at face value in another currency.
 */
export async function toSiteCurrency(m: Money, siteCurrency: string, day: string, rate: RateFn): Promise<number | null> {
  if (!m.amount) return 0;
  const sign = Math.sign(m.amount);
  const to = siteCurrency.toUpperCase();
  const convert = async (amount: number, currency: string) => {
    const from = currency.toUpperCase();
    const r = from === to ? 1 : await rate(from, to, day);
    return r == null ? null : Math.round((Math.abs(amount) / 10 ** currencyDecimals(from)) * r * 10 ** currencyDecimals(to));
  };

  let value = await convert(m.amount, m.currency);
  if (value == null && m.settlementAmount && m.settlementCurrency) value = await convert(m.settlementAmount, m.settlementCurrency);
  return value == null ? null : sign * value;
}

/**
 * Daily ECB reference rates from Frankfurter (free, no key; a weekend or holiday gets the previous working
 * day's rate), cached in D1 so each pair and day is fetched once.
 */
export function frankfurterRates(db: D1Database, fetchFn: typeof fetch = fetch): RateFn {
  const memo = new Map<string, Promise<number | null>>();
  return (from, to, day) => {
    const key = `${day}|${from}|${to}`;
    let hit = memo.get(key);
    if (!hit) {
      hit = (async () => {
        const row = await db.prepare('SELECT rate FROM fx_rates WHERE day = ? AND base = ? AND quote = ?').bind(day, from, to).first<{ rate: number }>();
        if (row) return row.rate;
        try {
          const res = await fetchFn(`https://api.frankfurter.dev/v1/${day}?base=${from}&symbols=${to}`);
          if (!res.ok) return null;
          const j = (await res.json()) as { date?: string; rates?: Record<string, number> };
          const r = j.rates?.[to];
          if (typeof r !== 'number' || !(r > 0)) return null;
          // Today's rate isn't published until the afternoon; Frankfurter then answers with an earlier day's.
          // Use it for now, but only keep it once the day is over.
          if (j.date !== day && day >= dayOf(Date.now())) return r;
          await db.prepare('INSERT OR IGNORE INTO fx_rates (day, base, quote, rate) VALUES (?, ?, ?, ?)').bind(day, from, to, r).run();
          return r;
        } catch {
          return null;
        }
      })();
      memo.set(key, hit);
    }
    return hit;
  };
}
