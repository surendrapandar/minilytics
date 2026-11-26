import type { Context } from 'hono';
import { getSite, type AppEnv, type Site } from './env';
import { verifyStandardWebhook, verifyStripeWebhook } from './lib/crypto';
import { currencyDecimals } from '../shared/currency';
import { dayOf, frankfurterRates, toSiteCurrency, type Money, type RateFn } from './lib/fx';

export { currencyDecimals };

interface PaymentInput {
  id: string;
  provider: string;
  ts: number;
  amount: number; // minor units, as charged (tax included); negative for refunds
  kind: 'payment' | 'refund';
  currency: string;
  tax?: number | null; // included in amount
  settlementAmount?: number | null; // what the provider paid out, when known
  settlementCurrency?: string | null;
  refundOf?: string | null; // a refund's payment id, so it uses that payment's rate
  visitorId?: string | null;
  sessionId?: string | null;
  customerId?: string | null;
  email?: string | null;
  name?: string | null;
  subscriptionId?: string | null;
  checkoutId?: string | null;
  productId?: string | null;
  renewal?: boolean;
}

export type MatchedBy = 'metadata' | 'return_page' | 'customer' | 'email' | 'timing';

/** The visit that gets the credit: the visitor's last visit that came from somewhere (last non-direct touch). */
export function creditedSessionSql() {
  return `SELECT id FROM sessions WHERE site_id = ? AND visitor_id = ? AND started_at <= ?
          ORDER BY (channel != 'Direct') DESC, started_at DESC LIMIT 1`;
}

/**
 * Work out which visitor paid and which visit gets the credit, trying the most reliable signal first:
 *  1. metadata   ml_visitor_id passed to the checkout
 *  2. return_page  the visitor landed on your return URL with ?payment_id= (Dodo) or ?session_id= (Stripe)
 *  3. customer   the same customer paid before (renewals)
 *  4. email      the email matches a visitor you identify()'d
 *  5. timing     exactly one visitor clicked a Dodo/Stripe checkout link (or a checkout goal) shortly before the payment
 * Credit goes to the last non-direct visit, so "saw a tweet, came back directly 17 days later and paid"
 * is credited to the tweet.
 */
async function attribute(db: D1Database, site: Site, p: PaymentInput) {
  let visitorId = p.visitorId ?? null;
  let matchedBy: MatchedBy | null = visitorId ? 'metadata' : null;
  let renewal = !!p.renewal;

  if (!visitorId) {
    const claim = await db
      .prepare('SELECT visitor_id FROM payment_claims WHERE site_id = ? AND payment_id IN (?, ?, ?) ORDER BY ts LIMIT 1')
      .bind(site.id, p.id, p.subscriptionId ?? p.id, p.checkoutId ?? p.id)
      .first<{ visitor_id: string }>();
    if (claim) [visitorId, matchedBy] = [claim.visitor_id, 'return_page'];
  }

  if (p.customerId || p.email) {
    const prev = await db
      .prepare(
        `SELECT visitor_id FROM payments WHERE site_id = ? AND kind = 'payment' AND visitor_id IS NOT NULL AND id != ?
           AND ((customer_id IS NOT NULL AND customer_id = ?) OR (email IS NOT NULL AND email = ?))
         ORDER BY ts ASC LIMIT 1`,
      )
      .bind(site.id, p.id, p.customerId ?? null, p.email ?? null)
      .first<{ visitor_id: string }>();
    if (prev) {
      if (!visitorId) [visitorId, matchedBy] = [prev.visitor_id, 'customer'];
      // Same customer paid before: a subscription renewal or repeat purchase.
      if (p.kind === 'payment') renewal = true;
    }
  }
  if (!visitorId && p.email) {
    const v = await db
      .prepare('SELECT id FROM visitors WHERE site_id = ? AND email = ? ORDER BY first_seen DESC LIMIT 1')
      .bind(site.id, p.email)
      .first<{ id: string }>();
    if (v) [visitorId, matchedBy] = [v.id, 'email'];
  }
  let reason: string | null = null;
  if (!visitorId && p.kind === 'payment' && !renewal) {
    const t = await matchByTiming(db, site, p);
    if (t.visitorId) [visitorId, matchedBy] = [t.visitorId, 'timing'];
    reason = t.reason;
  }

  let sessionId: string | null = null;
  if (visitorId) {
    const s = await db.prepare(creditedSessionSql()).bind(site.id, visitorId, p.ts + 60_000).first<{ id: string }>();
    sessionId = s?.id ?? p.sessionId ?? null;
  }
  return { visitorId, sessionId, renewal, matchedBy, reason };
}

const TIMING_WINDOW_MS = 3 * 3_600_000;
const MIN = 60_000;

/**
 * Last resort when nothing identifies the buyer: look at who clicked a Dodo/Stripe checkout link (or a checkout goal)
 * in the 3 hours before the payment. The strongest sign is coming back to the site right after paying
 * (Dodo and Stripe redirect buyers to your return page); people who clicked Buy and gave up don't.
 * Only ever picks a visitor when the evidence points to exactly one person.
 */
async function matchByTiming(db: D1Database, site: Site, p: PaymentInput): Promise<{ visitorId: string | null; reason: string }> {
  const clicks = await db
    .prepare(
      `SELECT e.visitor_id, MAX(e.ts) AS last_click FROM events e
       WHERE e.site_id = ? AND e.ts BETWEEN ? AND ?
         AND ((e.type = 'outbound' AND (e.name LIKE '%dodopayments.com%' OR e.name LIKE '%buy.stripe.com%' OR e.name LIKE '%checkout.stripe.com%'))
              OR (e.type = 'goal' AND (e.name LIKE '%checkout%' OR e.name LIKE '%buy%' OR e.name LIKE '%purchase%')))
         AND NOT EXISTS (SELECT 1 FROM payments o WHERE o.site_id = e.site_id AND o.visitor_id = e.visitor_id
                         AND o.kind = 'payment' AND o.id != ? AND o.ts BETWEEN ? AND ?)
       GROUP BY e.visitor_id ORDER BY last_click DESC LIMIT 50`,
    )
    .bind(site.id, p.ts - TIMING_WINDOW_MS, p.ts + 2 * MIN, p.id, p.ts - TIMING_WINDOW_MS, p.ts + TIMING_WINDOW_MS)
    .all<{ visitor_id: string; last_click: number }>();
  const cands = clicks.results;
  if (!cands.length) return { visitorId: null, reason: 'No one clicked a checkout link in the 3 hours before this payment (was the script installed yet?)' };
  if (cands.length === 1) return { visitorId: cands[0].visitor_id, reason: 'Only checkout click before the payment' };

  // Who came back to the site shortly after the payment, after having clicked checkout?
  const placeholders = cands.map(() => '?').join(',');
  const views = await db
    .prepare(
      `SELECT visitor_id, ts FROM events
       WHERE site_id = ? AND type = 'pageview' AND ts BETWEEN ? AND ? AND visitor_id IN (${placeholders})
       LIMIT 1000`,
    )
    .bind(site.id, p.ts - MIN, p.ts + 30 * MIN, ...cands.map((c) => c.visitor_id))
    .all<{ visitor_id: string; ts: number }>();
  const lastClick = new Map(cands.map((c) => [c.visitor_id, c.last_click]));
  // A pageview after their last checkout click = they came back from the checkout.
  const returned = [...new Set(views.results.filter((v) => v.ts > (lastClick.get(v.visitor_id) ?? Infinity)).map((v) => v.visitor_id))];
  if (returned.length === 1) return { visitorId: returned[0], reason: 'Came back to the site right after paying' };

  // Nobody (or several people) came back: fall back to a single clicker in the 30 minutes before paying.
  const recent = cands.filter((c) => c.last_click >= p.ts - 30 * MIN && c.last_click <= p.ts + MIN);
  if (recent.length === 1) return { visitorId: recent[0].visitor_id, reason: 'Only checkout click in the 30 minutes before the payment' };

  return {
    visitorId: null,
    reason: `${cands.length} people clicked checkout before this payment${returned.length > 1 ? ` and ${returned.length} came back right after` : ''}; too close to call`,
  };
}

/**
 * The site-currency amount (tax included) stored in payments.amount (all revenue totals sum it), with the
 * charge kept as orig_amount/orig_currency. Pending when the day's rate isn't available yet.
 */
async function siteAmount(db: D1Database, site: Site, m: Money, ts: number, rate: RateFn = frankfurterRates(db)) {
  const amount = await toSiteCurrency(m, site.currency, dayOf(ts), rate);
  return {
    amount: amount ?? 0,
    pending: amount === null ? 1 : 0,
    origAmount: m.amount,
    origCurrency: m.currency.toUpperCase(),
    origTax: m.tax ?? null,
    settlementAmount: m.settlementAmount ?? null,
    settlementCurrency: m.settlementCurrency?.toUpperCase() ?? null,
    fxTs: ts,
  };
}

/** A refund in the site currency at its payment's rate; refunds of unconverted payments convert on their own. */
async function refundAmount(
  db: D1Database,
  site: Site,
  original: RefundOriginal,
  refund: { amount: number; currency: string; ts: number },
) {
  const charged = -Math.abs(refund.amount);
  const cur = refund.currency.toUpperCase();
  if (!original.orig_amount || original.orig_currency !== cur) return siteAmount(db, site, { amount: charged, currency: cur }, refund.ts);
  const part = Math.abs(charged) / Math.abs(original.orig_amount);
  if (!original.fx_pending) {
    const share = Math.round(part * Math.abs(original.amount));
    return { amount: -share, pending: 0, origAmount: charged, origCurrency: cur, origTax: null, settlementAmount: null, settlementCurrency: null, fxTs: original.ts };
  }
  // Its payment still waits for a rate: take the same share of its settlement (and tax, kept for the record), converted on its day.
  return siteAmount(
    db,
    site,
    {
      amount: charged,
      currency: cur,
      tax: original.orig_tax != null ? Math.round(part * original.orig_tax) : null,
      settlementAmount: original.settlement_amount != null ? -Math.round(part * original.settlement_amount) : null,
      settlementCurrency: original.settlement_currency,
    },
    original.ts,
  );
}

type RefundOriginal = {
  ts: number;
  amount: number;
  orig_amount: number | null;
  orig_currency: string | null;
  orig_tax: number | null;
  settlement_amount: number | null;
  settlement_currency: string | null;
  fx_pending: number;
};

/** A payment waiting for a rate that still has none after this long is given up on (fx_pending = 2). */
const FX_GIVE_UP_MS = 7 * 86_400_000;

/** Convert payments stored before their day's rate was available. */
export async function convertPendingPayments(db: D1Database, site: Site) {
  const rows = await db
    .prepare('SELECT id, COALESCE(fx_ts, ts) AS ts, orig_amount, orig_currency, orig_tax, settlement_amount, settlement_currency FROM payments WHERE site_id = ? AND fx_pending = 1 ORDER BY ts DESC LIMIT 20')
    .bind(site.id)
    .all<{ id: string; ts: number; orig_amount: number; orig_currency: string; orig_tax: number | null; settlement_amount: number | null; settlement_currency: string | null }>();
  const rate = frankfurterRates(db);
  for (const r of rows.results) {
    const m = await siteAmount(
      db,
      site,
      { amount: r.orig_amount, currency: r.orig_currency, tax: r.orig_tax, settlementAmount: r.settlement_amount, settlementCurrency: r.settlement_currency },
      r.ts,
      rate,
    );
    if (!m.pending) await db.prepare('UPDATE payments SET amount = ?, fx_pending = 0 WHERE id = ? AND site_id = ?').bind(m.amount, r.id, site.id).run();
    else if (Date.now() - r.ts > FX_GIVE_UP_MS) await db.prepare('UPDATE payments SET fx_pending = 2 WHERE id = ? AND site_id = ?').bind(r.id, site.id).run();
  }
}

export async function recordPayment(db: D1Database, site: Site, p: PaymentInput) {
  // A free order (100% discount) isn't a purchase: it would count as a customer with no revenue.
  if (p.kind === 'payment' && !p.amount) return { visitorId: null, sessionId: null };
  const original =
    p.kind === 'refund' && p.refundOf
      ? await db.prepare('SELECT * FROM payments WHERE id = ? AND site_id = ?').bind(p.refundOf, site.id).first<RefundOriginal>()
      : null;
  const money = original ? await refundAmount(db, site, original, { amount: p.amount, currency: p.currency, ts: p.ts }) : await siteAmount(db, site, p, p.ts);
  const { visitorId, sessionId, renewal, matchedBy } = await attribute(db, site, p);
  // Seen before (a retry, or Stripe's invoice.paid arriving before checkout.session.completed): fill in what
  // was missing, and let checkout metadata win over a weaker match.
  const better = `(payments.visitor_id IS NULL OR excluded.matched_by = 'metadata')`;
  const stmts = [
    db
      .prepare(
        `INSERT INTO payments (id, site_id, provider, ts, amount, kind, currency, visitor_id, session_id, customer_id, email, name, renewal, matched_by, subscription_id, checkout_id, product_id, orig_amount, orig_currency, fx_pending, orig_tax, settlement_amount, settlement_currency, fx_ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           visitor_id = CASE WHEN ${better} THEN COALESCE(excluded.visitor_id, payments.visitor_id) ELSE payments.visitor_id END,
           session_id = CASE WHEN ${better} THEN COALESCE(excluded.session_id, payments.session_id) ELSE payments.session_id END,
           matched_by = CASE WHEN ${better} THEN COALESCE(excluded.matched_by, payments.matched_by) ELSE payments.matched_by END,
           checkout_id = COALESCE(payments.checkout_id, excluded.checkout_id)
         WHERE payments.site_id = excluded.site_id`,
      )
      .bind(
        p.id,
        site.id,
        p.provider,
        p.ts,
        money.amount,
        p.kind,
        site.currency,
        visitorId,
        sessionId,
        p.customerId ?? null,
        p.email ?? null,
        p.name ?? null,
        renewal ? 1 : 0,
        matchedBy,
        p.subscriptionId ?? null,
        p.checkoutId ?? null,
        p.productId ?? null,
        money.origAmount,
        money.origCurrency,
        money.pending,
        money.origTax,
        money.settlementAmount,
        money.settlementCurrency,
        money.fxTs,
      ),
  ];
  // A payment tells us who an anonymous visitor really is.
  if (visitorId && p.kind === 'payment' && (p.email || p.name)) {
    stmts.push(
      db.prepare('INSERT OR IGNORE INTO visitors (site_id, id, first_seen) VALUES (?, ?, ?)').bind(site.id, visitorId, p.ts),
      db
        .prepare('UPDATE visitors SET email = COALESCE(email, ?), name = COALESCE(name, ?) WHERE site_id = ? AND id = ?')
        .bind(p.email ?? null, p.name ?? null, site.id, visitorId),
    );
  }
  await db.batch(stmts);
  return { visitorId, sessionId };
}

/** Try again to link payments that have no visitor yet (e.g. ones recorded before a fallback existed). */
export async function rematchPayments(db: D1Database, site: Site) {
  const rows = await db
    .prepare("SELECT * FROM payments WHERE site_id = ? AND kind = 'payment' AND visitor_id IS NULL ORDER BY ts LIMIT 500")
    .bind(site.id)
    .all<{ id: string; ts: number; amount: number; currency: string; customer_id: string | null; email: string | null; name: string | null; provider: string; subscription_id: string | null }>();
  let matched = 0;
  const details: { id: string; name: string | null; matched: boolean; reason: string | null }[] = [];
  for (const r of rows.results) {
    const a = await attribute(db, site, {
      id: r.id,
      provider: r.provider,
      ts: r.ts,
      amount: r.amount,
      kind: 'payment',
      currency: r.currency,
      customerId: r.customer_id,
      email: r.email,
      name: r.name,
      subscriptionId: r.subscription_id,
    });
    details.push({ id: r.id, name: r.name, matched: !!a.visitorId, reason: a.reason });
    if (!a.visitorId) continue;
    matched++;
    await db.batch([
      db
        .prepare('UPDATE payments SET visitor_id = ?, session_id = ?, matched_by = ?, renewal = ? WHERE site_id = ? AND id = ?')
        .bind(a.visitorId, a.sessionId, a.matchedBy, a.renewal ? 1 : 0, site.id, r.id),
      db.prepare('INSERT OR IGNORE INTO visitors (site_id, id, first_seen) VALUES (?, ?, ?)').bind(site.id, a.visitorId, r.ts),
      db
        .prepare('UPDATE visitors SET email = COALESCE(email, ?), name = COALESCE(name, ?) WHERE site_id = ? AND id = ?')
        .bind(r.email, r.name, site.id, a.visitorId),
    ]);
  }
  return { checked: rows.results.length, matched, details };
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

function pickMeta(meta: Record<string, unknown> | undefined, keys: string[]): string | null {
  if (!meta) return null;
  for (const k of keys) if (str(meta[k])) return meta[k] as string;
  return null;
}

const DODO_PRODUCT = /dodopayments\.com\/buy\/(pdt_[\w-]+)/;

/** The Dodo product of a checkout link (https://checkout.dodopayments.com/buy/pdt_...), if it is one. */
export function dodoProductOfLink(url: string): string | null {
  return DODO_PRODUCT.exec(url)?.[1] ?? null;
}

/**
 * Does this Dodo payment belong to this site? true = yes, false = another site's, null = can't tell yet.
 * Dodo sends every payment in the account to every webhook, so this is decided per product. `learn` is
 * set when the payment itself proves the product is this site's.
 */
async function ownsDodoPayment(db: D1Database, site: Site, products: string[], visitorId: string | null) {
  const manual = (site.dodo_product_ids ?? '').split(',').filter(Boolean);
  if (manual.length) return { owned: products.some((id) => manual.includes(id)), learn: false };

  // The buyer's visitor id is first-party to one site's domain.
  if (visitorId) {
    const r = await db.prepare('SELECT site_id FROM visitors WHERE id = ? LIMIT 10').bind(visitorId).all<{ site_id: string }>();
    const sites = r.results.map((x) => x.site_id);
    if (sites.includes(site.id)) return { owned: true, learn: true };
    if (sites.length) return { owned: false, learn: false };
  }
  if (products.length) {
    // Product ids belong to one Dodo account, so only the same owner's sites can claim them.
    const r = await db
      .prepare(
        `SELECT dp.site_id FROM dodo_products dp JOIN sites s ON s.id = dp.site_id
         WHERE dp.product_id IN (${products.map(() => '?').join(',')}) AND s.owner_id IS ?`,
      )
      .bind(...products, site.owner_id ?? null)
      .all<{ site_id: string }>();
    const sites = r.results.map((x) => x.site_id);
    if (sites.includes(site.id)) return { owned: true, learn: false };
    if (sites.length) return { owned: false, learn: false };
  }
  // A new product: it's this site's if no other site of the same owner takes Dodo payments.
  const other = await db
    .prepare('SELECT 1 FROM sites WHERE id != ? AND dodo_webhook_secret IS NOT NULL AND owner_id IS ? LIMIT 1')
    .bind(site.id, site.owner_id ?? null)
    .first();
  return { owned: other ? null : true, learn: !other };
}

/**
 * Remember that these products (or this one payment) belong to the site: count its waiting payments,
 * and drop the copies other sites were holding.
 */
export async function learnDodoProducts(db: D1Database, site: Site, products: string[], paymentId: string | null = null) {
  if (paymentId) {
    const row = await db
      .prepare('SELECT product_id FROM pending_payments WHERE site_id = ? AND payment_id = ?')
      .bind(site.id, paymentId)
      .first<{ product_id: string | null }>();
    if (!row && !products.length) return;
    if (row?.product_id) products = [...products, row.product_id];
  }
  if (!products.length && !paymentId) return;
  const ph = products.map(() => '?').join(',') || "''";
  const pending = await db
    .prepare(`SELECT payload FROM pending_payments WHERE site_id = ? AND (product_id IN (${ph}) OR payment_id = ?)`)
    .bind(site.id, ...products, paymentId ?? '')
    .all<{ payload: string }>();
  await db.batch([
    ...products.map((id) => db.prepare('INSERT OR IGNORE INTO dodo_products (product_id, site_id) VALUES (?, ?)').bind(id, site.id)),
    // Only payments this site holds too: a site that never got the payment can't drop another site's only copy.
    db
      .prepare(
        `DELETE FROM pending_payments WHERE payment_id IN
           (SELECT payment_id FROM pending_payments WHERE site_id = ? AND (product_id IN (${ph}) OR payment_id = ?))`,
      )
      .bind(site.id, ...products, paymentId ?? ''),
  ]);
  for (const row of pending.results) await recordPayment(db, site, JSON.parse(row.payload) as PaymentInput);
}

/** Dodo Payments webhook: POST /api/webhooks/dodo/:siteId */
export async function handleDodoWebhook(c: Context<AppEnv>) {
  const site = await getSite(c.env.DB, c.req.param('siteId')!);
  if (!site) return c.json({ error: 'unknown site' }, 404);
  if (!site.dodo_webhook_secret) return c.json({ error: 'webhook secret not configured for this site' }, 400);

  const body = await c.req.text();
  const ok = await verifyStandardWebhook(
    site.dodo_webhook_secret,
    {
      id: c.req.header('webhook-id') ?? null,
      timestamp: c.req.header('webhook-timestamp') ?? null,
      signature: c.req.header('webhook-signature') ?? null,
    },
    body,
  );
  if (!ok) return c.json({ error: 'invalid signature' }, 401);

  const event = JSON.parse(body) as { type: string; timestamp?: string; data: Record<string, any> };
  const data = event.data ?? {};
  const customer = (data.customer ?? {}) as Record<string, unknown>;
  const meta = { ...(customer.metadata as object), ...(data.metadata as object) } as Record<string, unknown>;
  const ts = Date.parse(data.created_at ?? event.timestamp ?? '') || Date.now();

  const products: string[] = Array.isArray(data.product_cart) ? data.product_cart.map((p: any) => p?.product_id).filter(Boolean) : [];

  if (event.type === 'payment.succeeded') {
    const amount = Number(data.total_amount) || 0;
    const currency = String(data.currency ?? site.currency);
    const payment: PaymentInput = {
      id: String(data.payment_id),
      provider: 'dodo',
      ts,
      amount,
      kind: 'payment',
      currency,
      tax: Number(data.tax) || 0,
      settlementAmount: Number(data.settlement_amount) || null,
      settlementCurrency: str(data.settlement_currency),
      visitorId: pickMeta(meta, ['ml_visitor_id', 'visitor_id', 'minilytics_visitor_id']),
      sessionId: pickMeta(meta, ['ml_session_id', 'session_id', 'minilytics_session_id']),
      customerId: str(customer.customer_id) ?? str(data.customer_id),
      email: str(customer.email)?.toLowerCase() ?? null,
      name: str(customer.name),
      subscriptionId: str(data.subscription_id) ?? (Array.isArray(data.subscription_ids) ? str(data.subscription_ids[0]) : null),
      productId: products[0] ?? null,
    };
    const { owned, learn } = await ownsDodoPayment(c.env.DB, site, products, payment.visitorId ?? null);
    if (owned === false) return c.json({ ok: true, ignored: 'another site\'s product' });
    if (owned === null) {
      await c.env.DB.prepare('INSERT OR IGNORE INTO pending_payments (site_id, payment_id, product_id, ts, payload) VALUES (?, ?, ?, ?, ?)')
        .bind(site.id, payment.id, payment.productId, ts, JSON.stringify(payment))
        .run();
      return c.json({ ok: true, pending: 'unknown product' });
    }
    await recordPayment(c.env.DB, site, payment);
    if (learn) await learnDodoProducts(c.env.DB, site, products);
  } else if (event.type === 'refund.succeeded') {
    const original = await c.env.DB.prepare('SELECT * FROM payments WHERE id = ? AND site_id = ?')
      .bind(String(data.payment_id), site.id)
      .first<RefundOriginal & { visitor_id: string | null; session_id: string | null; currency: string }>();
    // A refund of a payment this site never recorded (another product, or before tracking) isn't this site's.
    if (!original) {
      await c.env.DB.prepare('DELETE FROM pending_payments WHERE site_id = ? AND payment_id = ?').bind(site.id, String(data.payment_id)).run();
      return c.json({ ok: true, ignored: 'unknown payment' });
    }
    const m = await refundAmount(c.env.DB, site, original, {
      amount: Number(data.amount) || original.orig_amount || original.amount || 0,
      currency: String(data.currency ?? original.orig_currency ?? site.currency),
      ts,
    });
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO payments (id, site_id, provider, ts, amount, kind, currency, visitor_id, session_id, customer_id, email, name, orig_amount, orig_currency, fx_pending, orig_tax, settlement_amount, settlement_currency, fx_ts)
       VALUES (?, ?, 'dodo', ?, ?, 'refund', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        String(data.refund_id ?? `refund_${data.payment_id}`),
        site.id,
        ts,
        m.amount,
        site.currency,
        original.visitor_id ?? null,
        original.session_id ?? null,
        str(customer.customer_id),
        str(customer.email)?.toLowerCase() ?? null,
        str(customer.name),
        m.origAmount,
        m.origCurrency,
        m.pending,
        m.origTax,
        m.settlementAmount,
        m.settlementCurrency,
        m.fxTs,
      )
      .run();
  }
  await convertPendingPayments(c.env.DB, site);
  // Every other event type is acknowledged so Dodo doesn't retry it.
  return c.json({ ok: true });
}

/**
 * One Stripe account can feed several sites, and Stripe sends every event to every endpoint. Without this,
 * a payment lands on whichever site's webhook happens to arrive first. A payment is another site's when its
 * checkout is tagged for that site (metadata ml_site_id), when the buyer's visitor id was only ever seen on
 * other sites, or (renewals, which carry no visitor) when the customer has only ever paid on other sites.
 * With no evidence either way it's recorded, as before.
 */
export async function stripePaymentIsElsewhere(
  db: D1Database,
  site: Site,
  p: { taggedSite?: string | null; visitorId?: string | null; customerId?: string | null },
): Promise<boolean> {
  if (p.taggedSite) return p.taggedSite !== site.id;
  if (p.visitorId) {
    const r = await db.prepare('SELECT site_id FROM visitors WHERE id = ? LIMIT 20').bind(p.visitorId).all<{ site_id: string }>();
    const sites = r.results.map((x) => x.site_id);
    if (sites.length) return !sites.includes(site.id);
  }
  if (p.customerId) {
    const r = await db
      .prepare("SELECT DISTINCT site_id FROM payments WHERE provider = 'stripe' AND customer_id = ? LIMIT 20")
      .bind(p.customerId)
      .all<{ site_id: string }>();
    const sites = r.results.map((x) => x.site_id);
    if (sites.length) return !sites.includes(site.id);
  }
  return false;
}

type StripeOriginal = RefundOriginal & { id: string; visitor_id: string | null; session_id: string | null };

/** Stripe webhook: POST /api/webhooks/stripe/:siteId */
export async function handleStripeWebhook(c: Context<AppEnv>) {
  const site = await getSite(c.env.DB, c.req.param('siteId')!);
  if (!site) return c.json({ error: 'unknown site' }, 404);
  if (!site.stripe_webhook_secret) return c.json({ error: 'webhook secret not configured for this site' }, 400);

  const body = await c.req.text();
  if (!(await verifyStripeWebhook(site.stripe_webhook_secret, c.req.header('stripe-signature') ?? null, body))) {
    return c.json({ error: 'invalid signature' }, 401);
  }

  const event = JSON.parse(body) as { type: string; data: { object: Record<string, any> } };
  const o = event.data?.object ?? {};
  const ts = (Number(o.created) || Date.now() / 1000) * 1000;
  // Older API versions put these on the object, newer ones under `parent`.
  const subscriptionId = str(o.subscription) ?? str(o.parent?.subscription_details?.subscription);

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    if (o.payment_status !== 'paid') return c.json({ ok: true, ignored: 'not paid yet' });
    // Payment links can't carry metadata, so the script puts the visitor in client_reference_id: ml_<vid>__<sid>.
    const ref = /^ml_([\w-]+?)__([\w-]+)$/.exec(o.client_reference_id ?? '');
    const visitorId = pickMeta(o.metadata, ['ml_visitor_id', 'visitor_id']) ?? ref?.[1];
    const elsewhere = await stripePaymentIsElsewhere(c.env.DB, site, {
      taggedSite: pickMeta(o.metadata, ['ml_site_id']),
      visitorId,
      customerId: str(o.customer),
    });
    if (elsewhere) return c.json({ ok: true, ignored: 'not this site\'s payment' });
    await recordPayment(c.env.DB, site, {
      // A subscription's first invoice also arrives as invoice.paid; the same id makes them one payment.
      id: (o.mode === 'subscription' ? str(o.invoice) : str(o.payment_intent)) ?? String(o.id),
      provider: 'stripe',
      ts,
      amount: Number(o.amount_total) || 0,
      kind: 'payment',
      currency: String(o.currency ?? site.currency),
      tax: Number(o.total_details?.amount_tax) || 0,
      visitorId,
      sessionId: pickMeta(o.metadata, ['ml_session_id', 'session_id']) ?? ref?.[2],
      customerId: str(o.customer),
      email: str(o.customer_details?.email)?.toLowerCase() ?? null,
      name: str(o.customer_details?.name),
      subscriptionId,
      checkoutId: str(o.id),
    });
  } else if (event.type === 'invoice.paid') {
    // One-time Checkout payments are counted above; here only subscription invoices (first payment and renewals).
    if (!String(o.billing_reason).startsWith('subscription') || !(Number(o.amount_paid) > 0)) {
      return c.json({ ok: true, ignored: 'not a subscription payment' });
    }
    const meta = { ...(o.parent?.subscription_details?.metadata as object), ...(o.subscription_details?.metadata as object), ...(o.metadata as object) };
    if (await stripePaymentIsElsewhere(c.env.DB, site, { taggedSite: pickMeta(meta, ['ml_site_id']), customerId: str(o.customer) })) {
      return c.json({ ok: true, ignored: 'not this site\'s payment' });
    }
    await recordPayment(c.env.DB, site, {
      id: String(o.id),
      provider: 'stripe',
      ts,
      amount: Number(o.amount_paid),
      kind: 'payment',
      currency: String(o.currency ?? site.currency),
      tax: Number(o.tax) || (Array.isArray(o.total_taxes) ? o.total_taxes.reduce((t: number, x: any) => t + (Number(x?.amount) || 0), 0) : 0),
      customerId: str(o.customer),
      email: str(o.customer_email)?.toLowerCase() ?? null,
      name: str(o.customer_name),
      subscriptionId,
      renewal: o.billing_reason === 'subscription_cycle',
    });
  } else if (event.type === 'charge.refunded') {
    const original =
      (await c.env.DB.prepare('SELECT * FROM payments WHERE site_id = ? AND id IN (?, ?)')
        .bind(site.id, str(o.payment_intent) ?? '', str(o.invoice) ?? '')
        .first<StripeOriginal>()) ??
      // Newer API versions don't link a charge to its invoice; fall back to the customer's latest payment.
      (await c.env.DB.prepare("SELECT * FROM payments WHERE site_id = ? AND customer_id = ? AND kind = 'payment' ORDER BY ts DESC LIMIT 1")
        .bind(site.id, str(o.customer) ?? '')
        .first<StripeOriginal>());
    if (!original) return c.json({ ok: true, ignored: 'unknown payment' });
    // amount_refunded is the running total, so a second partial refund replaces the row.
    const m = await refundAmount(c.env.DB, site, original, { amount: Number(o.amount_refunded) || 0, currency: String(o.currency ?? site.currency), ts: Date.now() });
    await c.env.DB.prepare(
      `INSERT OR REPLACE INTO payments (id, site_id, provider, ts, amount, kind, currency, visitor_id, session_id, customer_id, email, name, orig_amount, orig_currency, fx_pending, orig_tax, settlement_amount, settlement_currency, fx_ts)
       VALUES (?, ?, 'stripe', ?, ?, 'refund', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        `${o.id}:refund`,
        site.id,
        Date.now(),
        m.amount,
        site.currency,
        original.visitor_id,
        original.session_id,
        str(o.customer),
        str(o.billing_details?.email)?.toLowerCase() ?? null,
        str(o.billing_details?.name),
        m.origAmount,
        m.origCurrency,
        m.pending,
        m.origTax,
        m.settlementAmount,
        m.settlementCurrency,
        m.fxTs,
      )
      .run();
  }
  await convertPendingPayments(c.env.DB, site);
  // Every other event type is acknowledged so Stripe doesn't retry it.
  return c.json({ ok: true });
}

async function siteFromApiKey(c: Context<AppEnv>): Promise<Site | null> {
  const key = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!key) return null;
  return c.env.DB.prepare('SELECT * FROM sites WHERE api_key = ?').bind(key).first<Site>();
}

/**
 * Generic payments API, for any provider without a built-in integration.
 * POST /api/v1/payments  Authorization: Bearer <site api key>
 * { "transaction_id": "...", "amount": 29.99, "currency": "USD", "visitor_id": "<ml_vid cookie>", "email": "..." }
 */
export async function handlePaymentApi(c: Context<AppEnv>) {
  const site = await siteFromApiKey(c);
  if (!site) return c.json({ error: 'invalid api key' }, 401);
  const b = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!b || !str(b.transaction_id) || typeof b.amount !== 'number') {
    return c.json({ error: 'transaction_id (string) and amount (number, e.g. 29.99) are required' }, 400);
  }
  const currency = (str(b.currency) ?? site.currency).toUpperCase();
  const minor = Math.round((b.amount as number) * 10 ** currencyDecimals(currency));
  const refunded = b.refunded === true;
  const res = await recordPayment(c.env.DB, site, {
    id: `${site.id}:${b.transaction_id}${refunded ? ':refund' : ''}`,
    provider: 'api',
    ts: typeof b.timestamp === 'string' ? Date.parse(b.timestamp) || Date.now() : Date.now(),
    amount: refunded ? -Math.abs(minor) : minor,
    kind: refunded ? 'refund' : 'payment',
    currency,
    refundOf: refunded ? `${site.id}:${b.transaction_id}` : null,
    visitorId: str(b.visitor_id),
    sessionId: str(b.session_id),
    customerId: str(b.customer_id),
    email: str(b.email)?.toLowerCase() ?? null,
    name: str(b.name),
    renewal: b.renewal === true,
  });
  await convertPendingPayments(c.env.DB, site);
  return c.json({ ok: true, attributed: !!res.sessionId, visitor_id: res.visitorId });
}

/**
 * Server-side goals (e.g. "signup" from your backend).
 * POST /api/v1/goals  { "visitor_id": "...", "name": "signup" }
 */
export async function handleGoalApi(c: Context<AppEnv>) {
  const site = await siteFromApiKey(c);
  if (!site) return c.json({ error: 'invalid api key' }, 401);
  const b = await c.req.json<Record<string, unknown>>().catch(() => null);
  const vid = str(b?.visitor_id);
  const name = str(b?.name)?.slice(0, 64);
  if (!vid || !name) return c.json({ error: 'visitor_id and name are required' }, 400);
  const s = await c.env.DB.prepare(
    'SELECT id, exit_page FROM sessions WHERE site_id = ? AND visitor_id = ? ORDER BY started_at DESC LIMIT 1',
  )
    .bind(site.id, vid)
    .first<{ id: string; exit_page: string }>();
  if (!s) return c.json({ error: 'visitor not found' }, 404);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE sessions SET goals = goals + 1 WHERE site_id = ? AND id = ?').bind(site.id, s.id),
    c.env.DB.prepare(
      "INSERT INTO events (site_id, session_id, visitor_id, ts, type, name, path, props) VALUES (?, ?, ?, ?, 'goal', ?, ?, ?)",
    ).bind(site.id, s.id, vid, now, name, s.exit_page, b?.props ? JSON.stringify(b.props).slice(0, 1000) : null),
  ]);
  return c.json({ ok: true });
}
