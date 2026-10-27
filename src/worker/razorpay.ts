import type { Context } from 'hono';
import { getSite, type AppEnv, type Site } from './env';
import { verifyRazorpaySignature } from './lib/crypto';
import { recordPayment, type PaymentInput } from './payments';

type Entity = Record<string, any>;

/** Events that mean money arrived. One payment can fire several of them (payment.captured + order.paid, …). */
const PAYMENT_EVENTS = new Set(['payment.captured', 'order.paid', 'payment_link.paid', 'subscription.charged']);

/** Razorpay fills this in when checkout didn't collect an email. */
const PLACEHOLDER_EMAILS = new Set(['void@razorpay.com']);

export type RazorpayEvent =
  | {
      type: 'payment';
      payment: PaymentInput;
      /** Payment link / subscription plan ids, matched against the site's filter list. */
      filterIds: string[];
      /** notes.ml_site_id, when the checkout says which Minilytics site it belongs to. */
      siteTag: string | null;
    }
  | { type: 'refund'; refundId: string; paymentId: string; amount: number; currency: string; ts: number };

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
const entity = (payload: Entity | undefined, key: string): Entity | null => {
  const e = payload?.[key]?.entity;
  return e && typeof e === 'object' ? e : null;
};
// Razorpay sends empty notes as [] rather than {}.
const notesOf = (e: Entity | null): Entity => (e?.notes && typeof e.notes === 'object' && !Array.isArray(e.notes) ? e.notes : {});
const pick = (notes: Entity, keys: string[]) => {
  for (const k of keys) if (str(notes[k])) return notes[k] as string;
  return null;
};
const secondsToMs = (s: unknown) => (typeof s === 'number' && s > 0 ? s * 1000 : null);

/** Turn a Razorpay webhook body into a payment or refund, or null for events that don't move money. */
export function parseRazorpayEvent(event: Entity, siteCurrency: string, now = Date.now()): RazorpayEvent | null {
  const payload = (event?.payload ?? {}) as Entity;

  if (event?.event === 'refund.processed') {
    const r = entity(payload, 'refund');
    if (!r || !str(r.id) || !str(r.payment_id)) return null;
    return {
      type: 'refund',
      refundId: r.id,
      paymentId: r.payment_id,
      amount: Number(r.amount) || 0,
      currency: String(r.currency ?? siteCurrency).toUpperCase(),
      ts: secondsToMs(r.created_at) ?? secondsToMs(event.created_at) ?? now,
    };
  }

  if (!PAYMENT_EVENTS.has(event?.event)) return null;
  const pay = entity(payload, 'payment');
  if (!pay || !str(pay.id) || (pay.status && pay.status !== 'captured')) return null;
  const order = entity(payload, 'order');
  const link = entity(payload, 'payment_link');
  const sub = entity(payload, 'subscription');

  // The visitor ids can be on any of these, depending on how the checkout was created. The payment's own notes win.
  const notes = { ...notesOf(order), ...notesOf(link), ...notesOf(sub), ...notesOf(pay) };

  let amount = Number(pay.amount) || 0;
  let currency = String(pay.currency ?? siteCurrency).toUpperCase();
  // International payments carry the settled INR amount in base_amount.
  if (currency !== siteCurrency && str(pay.base_currency)?.toUpperCase() === siteCurrency && Number(pay.base_amount)) {
    amount = Number(pay.base_amount);
    currency = siteCurrency;
  }

  const email = str(pay.email)?.toLowerCase() ?? str(link?.customer?.email)?.toLowerCase() ?? null;
  return {
    type: 'payment',
    payment: {
      id: pay.id,
      provider: 'razorpay',
      ts: secondsToMs(pay.created_at) ?? secondsToMs(event.created_at) ?? now,
      amount,
      kind: 'payment',
      currency,
      visitorId: pick(notes, ['ml_visitor_id', 'visitor_id', 'minilytics_visitor_id']),
      sessionId: pick(notes, ['ml_session_id', 'session_id', 'minilytics_session_id']),
      customerId: str(pay.customer_id) ?? str(sub?.customer_id),
      email: email && !PLACEHOLDER_EMAILS.has(email) ? email : null,
      name: str(link?.customer?.name) ?? pick(notes, ['ml_name', 'name']),
      subscriptionId: str(sub?.id),
    },
    filterIds: [str(link?.id), str(sub?.plan_id)].filter((x): x is string => !!x),
    siteTag: pick(notes, ['ml_site_id']),
  };
}

/** Does this payment belong to this site? Matters when one Razorpay account sells several products. */
export function razorpayAccepts(site: Pick<Site, 'id' | 'razorpay_filter_ids'>, e: Extract<RazorpayEvent, { type: 'payment' }>): boolean {
  if (e.siteTag) return e.siteTag === site.id;
  const allowed = (site.razorpay_filter_ids ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!allowed.length) return true;
  return e.filterIds.some((id) => allowed.includes(id));
}

/** Razorpay webhook: POST /api/webhooks/razorpay/:siteId */
export async function handleRazorpayWebhook(c: Context<AppEnv>) {
  const site = await getSite(c.env.DB, c.req.param('siteId')!);
  if (!site) return c.json({ error: 'unknown site' }, 404);
  if (!site.razorpay_webhook_secret) return c.json({ error: 'webhook secret not configured for this site' }, 400);

  const body = await c.req.text();
  if (!(await verifyRazorpaySignature(site.razorpay_webhook_secret, c.req.header('x-razorpay-signature') ?? null, body))) {
    return c.json({ error: 'invalid signature' }, 401);
  }
  let event: Entity;
  try {
    event = JSON.parse(body);
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }

  const parsed = parseRazorpayEvent(event, site.currency);
  // Every other event type is acknowledged so Razorpay doesn't retry it.
  if (!parsed) return c.json({ ok: true });
  const db = c.env.DB;

  if (parsed.type === 'refund') {
    const original = await db
      .prepare('SELECT * FROM payments WHERE id = ? AND site_id = ?')
      .bind(parsed.paymentId, site.id)
      .first<{ visitor_id: string | null; session_id: string | null; currency: string; amount: number; customer_id: string | null; email: string | null; name: string | null }>();
    // A refund of a payment this site never recorded (another product, or before tracking) isn't this site's.
    if (!original) return c.json({ ok: true, ignored: 'unknown payment' });
    await db
      .prepare(
        `INSERT OR IGNORE INTO payments (id, site_id, provider, ts, amount, kind, currency, visitor_id, session_id, customer_id, email, name)
         VALUES (?, ?, 'razorpay', ?, ?, 'refund', ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        parsed.refundId,
        site.id,
        parsed.ts,
        // A refund comes in the buyer's currency. If the payment was stored converted (international), its amount
        // can't be mixed in, so count the stored amount: exact for full refunds, an overstatement for partial ones.
        -Math.abs((parsed.currency === original.currency && parsed.amount) || original.amount),
        original.currency,
        original.visitor_id,
        original.session_id,
        original.customer_id,
        original.email,
        original.name,
      )
      .run();
    return c.json({ ok: true });
  }

  if (!razorpayAccepts(site, parsed)) return c.json({ ok: true, ignored: 'other product' });

  // One payment fires several events (payment.captured, then order.paid / payment_link.paid). recordPayment
  // merges them into one row and fills in the visitor if a later event carries the notes the first lacked.
  await recordPayment(db, site, parsed.payment);
  return c.json({ ok: true });
}
