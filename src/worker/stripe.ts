import type { Context } from 'hono';
import { matchesStripeMetadata } from '../shared/stripe-scope';
import type { AppEnv, Site } from './env';
import { verifyStripeWebhook } from './lib/crypto';
import { currencyDecimals, recordPayment } from './payments';

type JsonObject = Record<string, unknown>;

interface AttributionContext {
  visitor_id: string | null;
  session_id: string | null;
  customer_id: string | null;
  email: string | null;
  name: string | null;
  subscription_id: string | null;
  checkout_id: string | null;
}

interface StripeEvent {
  type: string;
  created: number;
  object: JsonObject;
}

class InvalidPayload extends Error {}

function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidPayload();
  return value as JsonObject;
}

function text(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new InvalidPayload();
  return value;
}

function id(value: unknown, prefix: string): string | null {
  const expanded = value !== null && typeof value === 'object';
  const result = text(expanded ? object(value).id : value);
  if (expanded && !result) throw new InvalidPayload();
  if (result !== null && (!result.startsWith(`${prefix}_`) || !/^[A-Za-z0-9_]+$/.test(result.slice(prefix.length + 1)))) throw new InvalidPayload();
  return result;
}

function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new InvalidPayload();
  return value;
}

function timestamp(value: unknown): number {
  const seconds = integer(value);
  if (!Number.isSafeInteger(seconds * 1000)) throw new InvalidPayload();
  return seconds * 1000;
}

function currency(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z]{3}$/i.test(value)) throw new InvalidPayload();
  return value.toUpperCase();
}

// Stripe charge exponents differ from Intl for MGA as well as legacy ISK/UGX.
// HUF/TWD payout restrictions do not change their two-decimal charge amounts.
const stripeDecimals: Record<string, number> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, JPY: 0, KMF: 0, KRW: 0, MGA: 0,
  PYG: 0, RWF: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, JOD: 3, KWD: 3, OMR: 3, TND: 3,
};

/** Analytics stores Intl minor units, not Stripe's legacy ISK/UGX hundredths. */
export function stripeAmount(amount: number, code: string): number {
  const exponent = currencyDecimals(code) - (stripeDecimals[code] ?? 2);
  const result = exponent < 0 ? amount / 10 ** -exponent : amount * 10 ** exponent;
  if (!Number.isSafeInteger(result)) throw new InvalidPayload();
  return result;
}

function paymentId(siteId: string, rawId: string): string {
  return `stripe:${siteId}:${rawId}`;
}

function metadata(value: unknown): Pick<AttributionContext, 'visitor_id' | 'session_id'> {
  const meta = value === undefined || value === null ? {} : object(value);
  return { visitor_id: text(meta.ml_visitor_id), session_id: text(meta.ml_session_id) };
}

function context(data: JsonObject, checkout: boolean): AttributionContext {
  const meta = metadata(data.metadata);
  const details = data.customer_details == null ? {} : object(data.customer_details);
  const reference = checkout ? text(data.client_reference_id) : null;
  const tagged = reference ? /^ml_([\w-]+?)__([\w-]+)$/.exec(reference) : null;
  return {
    visitor_id: meta.visitor_id ?? tagged?.[1] ?? reference,
    session_id: meta.session_id ?? (meta.visitor_id === null || meta.visitor_id === tagged?.[1] ? tagged?.[2] ?? null : null),
    customer_id: id(data.customer, 'cus'),
    email: checkout ? text(details.email) ?? text(data.customer_email) : text(data.receipt_email),
    name: checkout ? text(details.name) : null,
    subscription_id: checkout ? id(data.subscription, 'sub') : null,
    checkout_id: checkout ? id(data.id, 'cs') : null,
  };
}

async function saveContext(db: D1Database, siteId: string, intent: string | null, value: AttributionContext, ts: number) {
  const keys = [intent, value.customer_id].filter((key): key is string => key !== null);
  if (!keys.length) return;
  await db.batch(keys.map((key) => db.prepare(
    `INSERT INTO stripe_context (site_id, object_id, visitor_id, session_id, customer_id, email, name, subscription_id, checkout_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (site_id, object_id) DO UPDATE SET
       visitor_id = COALESCE(stripe_context.visitor_id, excluded.visitor_id),
       session_id = CASE WHEN stripe_context.visitor_id IS NULL OR stripe_context.visitor_id = excluded.visitor_id
         THEN COALESCE(stripe_context.session_id, excluded.session_id) ELSE stripe_context.session_id END,
       customer_id = COALESCE(stripe_context.customer_id, excluded.customer_id),
       email = COALESCE(stripe_context.email, excluded.email),
       name = COALESCE(stripe_context.name, excluded.name),
       subscription_id = COALESCE(stripe_context.subscription_id, excluded.subscription_id),
       checkout_id = COALESCE(stripe_context.checkout_id, excluded.checkout_id)`,
  ).bind(siteId, key, value.visitor_id, value.session_id, value.customer_id, value.email, value.name, value.subscription_id, key === intent ? value.checkout_id : null, ts)));
}

async function savedContext(db: D1Database, siteId: string, intent: string, customer: string | null): Promise<AttributionContext | null> {
  // An individual checkout's metadata is stronger than reusable customer context.
  return db.prepare(
    `SELECT COALESCE(pi.visitor_id, cu.visitor_id) AS visitor_id,
       CASE WHEN pi.visitor_id IS NOT NULL THEN pi.session_id ELSE cu.session_id END AS session_id,
       COALESCE(pi.customer_id, cu.customer_id) AS customer_id,
       COALESCE(pi.email, cu.email) AS email, COALESCE(pi.name, cu.name) AS name,
       COALESCE(pi.subscription_id, cu.subscription_id) AS subscription_id, pi.checkout_id
     FROM (SELECT 1) AS seed
     LEFT JOIN stripe_context pi ON pi.site_id = ? AND pi.object_id = ?
     LEFT JOIN stripe_context cu ON cu.site_id = ? AND cu.object_id = ?`,
  ).bind(siteId, intent, siteId, customer).first<AttributionContext>();
}

/** Fill gaps only; a later Checkout must never rewrite previously attributed history. */
async function reconcile(db: D1Database, siteId: string, intent: string | null, customer: string | null) {
  const originalId = intent ? paymentId(siteId, intent) : null;
  await db.batch([
    db.prepare(
      `WITH context AS (
         SELECT p.id, COALESCE(pi.visitor_id, cu.visitor_id, claim.visitor_id) AS visitor_id,
           CASE WHEN pi.visitor_id IS NOT NULL OR cu.visitor_id IS NOT NULL THEN 'metadata'
             WHEN claim.visitor_id IS NOT NULL THEN 'return_page' END AS matched_by,
           CASE WHEN pi.visitor_id IS NOT NULL THEN pi.session_id ELSE cu.session_id END AS session_id,
           COALESCE(pi.customer_id, cu.customer_id) AS customer_id,
           COALESCE(pi.email, cu.email) AS email, COALESCE(pi.name, cu.name) AS name,
           COALESCE(pi.subscription_id, cu.subscription_id) AS subscription_id, pi.checkout_id
         FROM payments p
         LEFT JOIN stripe_context pi ON pi.site_id = p.site_id AND pi.object_id = SUBSTR(p.id, LENGTH('stripe:' || p.site_id || ':') + 1)
         LEFT JOIN stripe_context cu ON cu.site_id = p.site_id AND cu.object_id = COALESCE(p.customer_id, pi.customer_id)
         LEFT JOIN payment_claims claim ON claim.site_id = p.site_id AND claim.payment_id = COALESCE(p.checkout_id, pi.checkout_id)
         WHERE p.site_id = ? AND p.provider = 'stripe' AND p.kind = 'payment'
           AND (p.id = ? OR p.customer_id = ?)
       )
       UPDATE payments AS p SET
         visitor_id = COALESCE(p.visitor_id, ctx.visitor_id),
         session_id = COALESCE(p.session_id,
           (SELECT s.id FROM sessions s WHERE s.site_id = p.site_id
             AND s.visitor_id = COALESCE(p.visitor_id, ctx.visitor_id) AND s.started_at <= p.ts + 60000
             ORDER BY (s.channel != 'Direct') DESC, s.started_at DESC LIMIT 1),
           CASE WHEN p.visitor_id IS NULL OR p.visitor_id = ctx.visitor_id THEN ctx.session_id END),
         matched_by = CASE WHEN p.visitor_id IS NULL AND ctx.visitor_id IS NOT NULL THEN ctx.matched_by ELSE p.matched_by END,
         customer_id = COALESCE(p.customer_id, ctx.customer_id),
         email = COALESCE(p.email, ctx.email), name = COALESCE(p.name, ctx.name),
         subscription_id = COALESCE(p.subscription_id, ctx.subscription_id),
         checkout_id = COALESCE(p.checkout_id, ctx.checkout_id)
       FROM context ctx WHERE p.id = ctx.id`,
    ).bind(siteId, originalId, customer),
    // Refund attribution is the original payment's exact credit, not a new visit at refund time.
    db.prepare(
      `UPDATE payments AS r SET
         visitor_id = COALESCE(r.visitor_id, p.visitor_id),
         session_id = COALESCE(r.session_id, p.session_id),
         matched_by = COALESCE(r.matched_by, p.matched_by),
         customer_id = COALESCE(r.customer_id, p.customer_id), email = COALESCE(r.email, p.email),
         name = COALESCE(r.name, p.name), subscription_id = COALESCE(r.subscription_id, p.subscription_id)
       FROM payments p WHERE r.site_id = ? AND r.provider = 'stripe' AND r.kind = 'refund'
         AND p.site_id = r.site_id AND p.provider = 'stripe' AND p.kind = 'payment'
         AND r.original_payment_id = p.id AND (p.id = ? OR p.customer_id = ?)`,
    ).bind(siteId, originalId, customer),
    db.prepare(
      `INSERT INTO visitors (site_id, id, first_seen, email, name)
       SELECT site_id, visitor_id, MIN(ts), MAX(email), MAX(name) FROM payments
       WHERE site_id = ? AND provider = 'stripe' AND kind = 'payment' AND visitor_id IS NOT NULL
         AND (id = ? OR customer_id = ?) AND (email IS NOT NULL OR name IS NOT NULL)
       GROUP BY site_id, visitor_id
       ON CONFLICT (site_id, id) DO UPDATE SET
         email = COALESCE(visitors.email, excluded.email), name = COALESCE(visitors.name, excluded.name)`,
    ).bind(siteId, originalId, customer),
  ]);
}

/** Both delivery paths retry promotion so refund/payment races converge without guessing ownership. */
async function promotePendingRefunds(db: D1Database, siteId: string, intent: string) {
  await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO payments
         (id, site_id, provider, ts, amount, kind, currency, visitor_id, session_id,
          customer_id, email, name, renewal, matched_by, subscription_id, original_payment_id)
       SELECT 'stripe:' || pending.site_id || ':' || pending.refund_id, pending.site_id,
         'stripe', pending.ts, -pending.amount, 'refund', pending.currency,
         original.visitor_id, original.session_id, original.customer_id, original.email,
         original.name, 0, original.matched_by, original.subscription_id, original.id
       FROM stripe_pending_refunds pending
       JOIN payments original ON original.site_id = pending.site_id
         AND original.id = 'stripe:' || pending.site_id || ':' || pending.payment_intent_id
         AND original.provider = 'stripe' AND original.kind = 'payment'
         AND original.currency = pending.currency
       WHERE pending.site_id = ? AND pending.payment_intent_id = ?`,
    ).bind(siteId, intent),
    db.prepare(
      `DELETE FROM stripe_pending_refunds
       WHERE site_id = ? AND payment_intent_id = ? AND EXISTS (
         SELECT 1 FROM payments recorded
         WHERE recorded.site_id = stripe_pending_refunds.site_id
           AND recorded.id = 'stripe:' || stripe_pending_refunds.site_id || ':' || stripe_pending_refunds.refund_id
           AND recorded.provider = 'stripe' AND recorded.kind = 'refund'
           AND recorded.original_payment_id = 'stripe:' || stripe_pending_refunds.site_id || ':' || stripe_pending_refunds.payment_intent_id
           AND recorded.currency = stripe_pending_refunds.currency
       )`,
    ).bind(siteId, intent),
  ]);
}

async function checkout(db: D1Database, site: Site, event: StripeEvent) {
  const data = event.object;
  if (data.object !== 'checkout.session' || !id(data.id, 'cs')) throw new InvalidPayload();
  if (data.mode === 'setup') return;
  if (data.mode !== 'payment' && data.mode !== 'subscription') throw new InvalidPayload();
  if (!['paid', 'unpaid', 'no_payment_required'].includes(String(data.payment_status))) throw new InvalidPayload();
  const intent = id(data.payment_intent, 'pi');
  const value = context(data, true);
  await saveContext(db, site.id, intent, value, event.created);
  await reconcile(db, site.id, intent, value.customer_id);
}

async function payment(db: D1Database, site: Site, event: StripeEvent) {
  const data = event.object;
  const intent = id(data.id, 'pi');
  if (data.object !== 'payment_intent' || !intent || data.status !== 'succeeded') throw new InvalidPayload();
  const code = currency(data.currency);
  const amount = stripeAmount(integer(data.amount_received), code);
  const value = context(data, false);
  await saveContext(db, site.id, intent, value, event.created);
  // A zero-value intent can carry attribution, but is not a paying customer.
  if (amount > 0) {
    const saved = await savedContext(db, site.id, intent, value.customer_id);
    await recordPayment(db, site, {
      id: paymentId(site.id, intent), provider: 'stripe', kind: 'payment', ts: event.created,
      amount, currency: code,
      visitorId: value.visitor_id ?? saved?.visitor_id,
      sessionId: value.session_id ?? saved?.session_id,
      customerId: value.customer_id ?? saved?.customer_id,
      email: value.email ?? saved?.email, name: saved?.name, subscriptionId: saved?.subscription_id,
      checkoutId: saved?.checkout_id,
    });
  }
  // Re-read durable context after insertion to cover concurrent/out-of-order Checkout.
  await reconcile(db, site.id, intent, value.customer_id);
  // Also drain refunds staged under an earlier rule; changing the rule does not rewrite history.
  await promotePendingRefunds(db, site.id, intent);
}

async function refund(db: D1Database, site: Site, event: StripeEvent) {
  const data = event.object;
  const refundId = id(data.id, 're');
  if (data.object !== 'refund' || !refundId) throw new InvalidPayload();
  if (!['pending', 'requires_action', 'succeeded', 'failed', 'canceled'].includes(String(data.status))) throw new InvalidPayload();
  const intent = id(data.payment_intent, 'pi');
  const code = currency(data.currency);
  const amount = stripeAmount(integer(data.amount), code);
  // Legacy charges with no PaymentIntent are deliberately outside this integration.
  if (data.status !== 'succeeded' || !intent || amount === 0) return;
  const refundTs = data.created === undefined ? event.created : timestamp(data.created);
  if (site.stripe_metadata_key !== null || site.stripe_metadata_value !== null) {
    // Persist first: if the payment arrives concurrently, either delivery's promotion sees both rows.
    await db.prepare(
      `INSERT OR IGNORE INTO stripe_pending_refunds
         (site_id, refund_id, payment_intent_id, ts, amount, currency) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(site.id, refundId, intent, refundTs, amount, code).run();
    await promotePendingRefunds(db, site.id, intent);
    await reconcile(db, site.id, intent, null);
    return;
  }
  const namespacedId = paymentId(site.id, refundId);
  // No refund metadata/customer guesses: only the original payment supplies its credit.
  await recordPayment(db, site, {
    id: namespacedId, provider: 'stripe', kind: 'refund', ts: refundTs, amount: -amount, currency: code,
  });
  await db.prepare('UPDATE payments SET original_payment_id = ? WHERE site_id = ? AND id = ? AND original_payment_id IS NULL')
    .bind(paymentId(site.id, intent), site.id, namespacedId).run();
  await reconcile(db, site.id, intent, null);
  await promotePendingRefunds(db, site.id, intent);
}

const supportedEvents: Record<string, true> = {
  'payment_intent.succeeded': true,
  'checkout.session.completed': true,
  'checkout.session.async_payment_succeeded': true,
  'refund.created': true,
  'refund.updated': true,
};

/** POST /api/webhooks/stripe/:siteId; only a signing secret, never Stripe API credentials. */
export async function handleStripeWebhook(c: Context<AppEnv>) {
  const db = c.env.DB;
  // Do not use getSite's isolate cache: clearing/rotating a secret must apply immediately.
  const site = await db.prepare('SELECT * FROM sites WHERE id = ?').bind(c.req.param('siteId')!).first<Site>();
  if (!site) return c.json({ error: 'unknown site' }, 404);
  if (!site.stripe_webhook_secret) return c.json({ error: 'webhook secret not configured for this site' }, 400);
  const body = await c.req.text();
  if (!await verifyStripeWebhook(site.stripe_webhook_secret, c.req.header('stripe-signature') ?? null, body)) {
    return c.json({ error: 'invalid signature' }, 401);
  }
  try {
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { throw new InvalidPayload(); }
    const envelope = object(parsed);
    const type = text(envelope.type);
    if (!type) throw new InvalidPayload();
    if (!Object.hasOwn(supportedEvents, type)) return c.json({ ok: true });
    const event: StripeEvent = {
      type, created: timestamp(envelope.created), object: object(object(envelope.data).object),
    };
    if (type === 'payment_intent.succeeded' || type.startsWith('checkout.session.')) {
      const meta = event.object.metadata == null ? {} : object(event.object.metadata);
      const taggedSite = text(meta.ml_site_id);
      if ((taggedSite !== null && taggedSite !== site.id)
        || !matchesStripeMetadata(meta, site.stripe_metadata_key, site.stripe_metadata_value)) {
        return c.json({ ok: true, ignored: true });
      }
    }
    if (event.object.created !== undefined) timestamp(event.object.created);
    if (type === 'payment_intent.succeeded') await payment(db, site, event);
    else if (type.startsWith('checkout.session.')) await checkout(db, site, event);
    else await refund(db, site, event);
    return c.json({ ok: true });
  } catch (error) {
    if (error instanceof InvalidPayload) return c.json({ error: 'invalid Stripe event payload' }, 400);
    // Database failures must remain retryable non-2xx responses from the worker.
    throw error;
  }
}
