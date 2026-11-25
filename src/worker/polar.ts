import type { Context } from 'hono';
import { POLAR_API_VERSION, polarCheckoutId, polarId } from '../shared/polar';
import { getSite, type AppEnv, type Site } from './env';
import { verifyStandardWebhook } from './lib/crypto';
import { creditedSessionSql, recordPayment } from './payments';

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const date = (value: unknown) => Date.parse(text(value) ?? '');
const trackingId = (value: unknown) => typeof value === 'string' && /^[\w-]{8,64}$/.test(value) ? value : null;

function readOrder(value: unknown) {
  const order = object(value);
  if (!order) return null;
  const id = polarId(order.id);
  const currency = text(order.currency)?.toUpperCase();
  const amount = order.net_amount;
  const createdAt = date(order.created_at);
  if (!id || !currency || !/^[A-Z]{3}$/.test(currency) || typeof amount !== 'number' || !Number.isSafeInteger(amount) || !Number.isFinite(createdAt)) return null;

  const subscription = object(order.subscription);
  const checkoutId = polarCheckoutId(order.checkout_id);
  const subscriptionCheckoutId = polarCheckoutId(subscription?.checkout_id);
  const refund = order.refunded_amount;
  const customer = object(order.customer);
  return {
    id: `polar:order:${id}`,
    currency,
    amount,
    createdAt,
    modifiedAt: date(order.modified_at),
    paid: order.paid === true,
    refundTotal: typeof refund === 'number' && Number.isSafeInteger(refund) ? Math.max(0, Math.min(refund, amount)) : 0,
    productId: polarId(order.product_id),
    checkoutId,
    customerId: polarId(order.customer_id),
    subscriptionId: polarId(order.subscription_id),
    renewal: order.billing_reason === 'subscription_cycle' ||
      (order.billing_reason == null && !!subscriptionCheckoutId && checkoutId !== subscriptionCheckoutId),
    email: text(customer?.email)?.slice(0, 320).toLowerCase() ?? null,
    name: text(customer?.name)?.slice(0, 255) ?? null,
    metadata: [object(order.metadata), object(subscription?.metadata)],
  };
}

type PolarOrder = NonNullable<ReturnType<typeof readOrder>>;

async function polarAttribution(db: D1Database, site: Site, order: PolarOrder) {
  for (const meta of order.metadata) {
    if (!meta) continue;
    const reference = text(meta.reference_id)?.match(/^ml_polar_([\w-]{8,64}?)__([\w-]{8,64}?)__([\w-]{8,64})$/);
    const fromSite = reference?.[1] === site.id;
    const visitorId = trackingId(meta.ml_visitor_id) ?? (fromSite ? reference[2] : null);
    if (!visitorId) continue;
    const visitor = await db.prepare('SELECT 1 FROM visitors WHERE site_id = ? AND id = ?').bind(site.id, visitorId).first();
    if (!visitor) continue;
    const sessionId = trackingId(meta.ml_session_id) ?? (fromSite ? reference[3] : null);
    if (!sessionId) return { visitorId };
    const session = await db.prepare('SELECT 1 FROM sessions WHERE site_id = ? AND id = ? AND visitor_id = ?')
      .bind(site.id, sessionId, visitorId).first();
    return { visitorId, sessionId: session ? sessionId : null };
  }
  return {};
}

async function storeOrder(db: D1Database, site: Site, order: PolarOrder,
  delivery: { paidAt?: number; refundedAt?: number; fromWebhook?: boolean }) {
  if (!order.paid || order.amount <= 0) return false;
  const products = site.polar_product_ids?.split(',');
  if (products?.length && (!order.productId || !products.includes(order.productId))) return false;

  const related: D1PreparedStatement[] = [];
  if (order.createdAt < site.created_at) {
    related.push(db.prepare(`UPDATE sites SET created_at = MIN(created_at, ?)
      WHERE id = (SELECT site_id FROM payments WHERE id = ? AND site_id = ?)`)
      .bind(order.createdAt, order.id, site.id));
  }
  if (order.checkoutId) {
    // Catch a success-page visit that arrived while recordPayment was calculating attribution.
    related.push(db.prepare(`
      UPDATE payments AS p SET visitor_id = c.visitor_id, matched_by = 'return_page',
        session_id = (${creditedSessionSql('p.site_id', 'c.visitor_id', 'p.ts + 60000')})
      FROM payment_claims c
      WHERE p.id = ? AND p.site_id = ? AND p.visitor_id IS NULL AND c.site_id = p.site_id AND c.payment_id = p.checkout_id
    `).bind(order.id, site.id));
  }
  if (order.refundTotal && delivery.refundedAt !== undefined) {
    related.push(db.prepare(`
      INSERT INTO polar_refunds (order_id, amount, ts, from_webhook)
      SELECT id, ?, ?, ? FROM payments WHERE id = ? AND site_id = ?
      ON CONFLICT (order_id, amount) DO UPDATE SET
        ts = CASE WHEN excluded.from_webhook > polar_refunds.from_webhook THEN excluded.ts
                  ELSE MIN(polar_refunds.ts, excluded.ts) END,
        from_webhook = excluded.from_webhook
      WHERE excluded.from_webhook >= polar_refunds.from_webhook
    `).bind(order.refundTotal, delivery.refundedAt, delivery.fromWebhook ? 1 : 0, order.id, site.id));
  }

  // Store the difference between successive snapshots. Re-evaluating them in the payment
  // batch makes concurrent, retried and out-of-order deliveries safe. Refunds use the order's FX rate.
  related.push(db.prepare(`
    WITH checkpoints AS (
      SELECT amount, ts, LAG(amount, 1, 0) OVER (ORDER BY amount) AS previous
      FROM polar_refunds WHERE order_id = ?
    )
    INSERT INTO payments (id, site_id, provider, ts, amount, kind, currency, visitor_id, session_id,
                          customer_id, email, name, matched_by, subscription_id, checkout_id, product_id, original_amount, original_currency)
    SELECT p.id || ':refund:' || r.amount, p.site_id, 'polar', r.ts,
           ROUND(r.previous * 1.0 * p.amount / COALESCE(p.original_amount, p.amount)) -
           ROUND(r.amount * 1.0 * p.amount / COALESCE(p.original_amount, p.amount)),
           'refund', p.currency, p.visitor_id, p.session_id, p.customer_id, p.email, p.name, p.matched_by,
           p.subscription_id, p.checkout_id, p.product_id,
           CASE WHEN p.original_amount IS NOT NULL THEN r.previous - r.amount END, p.original_currency
    FROM payments p CROSS JOIN checkpoints r WHERE p.id = ? AND p.site_id = ?
    ON CONFLICT (id) DO UPDATE SET ts = excluded.ts, amount = excluded.amount, currency = excluded.currency,
      original_amount = excluded.original_amount, original_currency = excluded.original_currency,
      visitor_id = excluded.visitor_id, session_id = excluded.session_id, matched_by = excluded.matched_by,
      checkout_id = excluded.checkout_id
  `).bind(order.id, order.id, site.id));

  await recordPayment(db, site, {
    id: order.id,
    provider: 'polar',
    kind: 'payment',
    ts: delivery.paidAt ?? order.createdAt,
    settled: delivery.paidAt !== undefined,
    amount: order.amount,
    currency: order.currency,
    productId: order.productId,
    checkoutId: order.checkoutId,
    customerId: order.customerId,
    subscriptionId: order.subscriptionId,
    renewal: order.renewal,
    email: order.email,
    name: order.name,
    ...await polarAttribution(db, site, order),
  }, ...related);
  return true;
}

export async function handlePolarWebhook(c: Context<AppEnv>) {
  const site = await getSite(c.env.DB, c.req.param('siteId') ?? '');
  if (!site) return c.json({ error: 'site not found' }, 404);
  if (!site.polar_webhook_secret) return c.json({ error: 'webhook secret not configured for this site' }, 400);
  const raw = await c.req.text();
  const headers = {
    id: c.req.header('webhook-id') ?? null,
    timestamp: c.req.header('webhook-timestamp') ?? null,
    signature: c.req.header('webhook-signature') ?? null,
  };
  const now = Date.now();
  const secret = site.polar_webhook_secret;
  if (!await verifyStandardWebhook(secret, headers, raw, now) && !await verifyStandardWebhook(secret, headers, raw, now, true)) {
    return c.json({ error: 'invalid signature' }, 401);
  }

  let event: Record<string, unknown> | null;
  try {
    event = object(JSON.parse(raw));
  } catch {
    return c.json({ error: 'invalid webhook payload' }, 400);
  }
  if (event?.type !== 'order.paid' && event?.type !== 'order.refunded') return c.json({ ok: true });
  const order = readOrder(event.data);
  const timestamp = date(event.timestamp);
  if (!order || !Number.isFinite(timestamp)) return c.json({ error: 'invalid Polar order' }, 400);
  await storeOrder(c.env.DB, site, order, event.type === 'order.refunded'
    ? { refundedAt: timestamp, fromWebhook: true }
    : { paidAt: timestamp });
  return c.json({ ok: true });
}

/** Import one page at a time to stay within Workers and D1 subrequest limits. The token is never stored. */
export async function handlePolarImport(c: Context<AppEnv>) {
  const site = c.get('site');
  const body = await c.req.json<{ token?: unknown; page?: unknown; sandbox?: unknown }>().catch(() => null);
  const token = text(body?.token);
  const page = body?.page ?? 1;
  if (!token || token.length > 1024 || /\s/.test(token) || typeof page !== 'number' || !Number.isSafeInteger(page) || page < 1) {
    return c.json({ error: 'A Polar access token and a valid page number are required.' }, 400);
  }
  const url = new URL('/v1/orders/', body?.sandbox === true ? 'https://sandbox-api.polar.sh' : 'https://api.polar.sh');
  url.search = new URLSearchParams({ page: String(page), limit: '5', sorting: 'created_at' }).toString();
  for (const status of ['paid', 'partially_refunded', 'refunded']) url.searchParams.append('status', status);
  for (const id of site.polar_product_ids?.split(',') ?? []) url.searchParams.append('product_id', id);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'Polar-Version': POLAR_API_VERSION, Accept: 'application/json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (response?.status === 401 || response?.status === 403) {
    return c.json({ error: 'Polar rejected the access token. Check the environment and the orders:read scope.' }, 400);
  }
  if (!response?.ok) return c.json({ error: 'Could not read orders from Polar. Try again in a moment.' }, 502);
  const data = await response.json<{ items?: unknown; pagination?: { max_page?: unknown } }>().catch(() => null);
  const lastPage = data?.pagination?.max_page;
  if (!Array.isArray(data?.items) || data.items.length > 5 || typeof lastPage !== 'number' || !Number.isSafeInteger(lastPage)) {
    return c.json({ error: 'Polar returned an invalid orders page.' }, 502);
  }
  let processed = 0;
  for (const entry of data.items) {
    const order = readOrder(entry);
    if (!order) return c.json({ error: 'Polar returned an invalid order.' }, 502);
    const refundDate = Number.isFinite(order.modifiedAt) ? order.modifiedAt : order.createdAt;
    if (await storeOrder(c.env.DB, site, order, { refundedAt: refundDate })) processed++;
  }
  return c.json({ processed, nextPage: page < lastPage ? page + 1 : null });
}
