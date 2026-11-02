import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { isHosted } from './auth';
import { forgetAllSites, type AppEnv, type Env } from './env';
import { verifyStandardWebhook } from './lib/crypto';

const DAY = 86_400_000;
// A few days of slack after a renewal date, so a late renewal webhook never cuts anyone off.
const GRACE_MS = 3 * DAY;

type Tier = { price: string; productId: string | null; spots: number };

/**
 * PLAN_TIERS="$29:5, $49:pdt_b:5, $100" — each tier sells its spots, then the next one starts. A tier
 * without a product id can't be bought: a sold-out tier, or a coming price that is only announced.
 */
export function parseTiers(raw: string | undefined): Tier[] {
  return (raw ?? '')
    .split(',')
    .map((t) => t.trim().split(':').map((x) => x.trim()))
    .filter(([price]) => price)
    .map(([price, ...rest]) => ({
      price,
      productId: rest.find((x) => /^pdt_[\w-]+$/.test(x)) ?? null,
      spots: Number(rest.find((x) => /^\d+$/.test(x))) || 0,
    }));
}

/** Lifetime buyers so far: they fill the spots of each price tier. Monthly subscribers don't. */
async function paidCount(env: Env) {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM users WHERE plan = 'lifetime'`).first<{ n: number }>();
  return r?.n ?? 0;
}

/** The tier on sale now, how many of its spots are left, the price after it, and the tiers already sold out. */
async function currentTier(env: Env) {
  const tiers = parseTiers(env.PLAN_TIERS);
  if (!tiers.some((t) => t.productId)) return null;
  let before = await paidCount(env);
  const soldOut: { price: string; spots: number }[] = [];
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    const next = tiers[i + 1];
    // Uncapped tiers never sell out. A capped tier stays on sale past its spots when the next price can't be bought yet.
    if (!t.spots || before < t.spots || !next?.productId) {
      if (!t.productId) break;
      const capped = !!t.spots && before < t.spots;
      return {
        tier: t,
        spots: capped ? t.spots : 0,
        spotsLeft: capped ? t.spots - before : null,
        nextPrice: next?.price ?? null,
        soldOut,
      };
    }
    soldOut.push({ price: t.price, spots: t.spots });
    before -= t.spots;
  }
  return null;
}

/** Public plan info for the landing/pricing page. */
export async function planInfo(env: Env) {
  const hosted = isHosted(env);
  const monthly = hosted && env.MONTHLY_PRODUCT_ID ? { price: env.MONTHLY_PRICE || '$9' } : null;
  const base = { hosted, interval: env.PLAN_INTERVAL || 'lifetime', supportEmail: env.SUPPORT_EMAIL || null, monthly };
  const cur = hosted ? await currentTier(env) : null;
  if (cur) {
    const { tier, spots, spotsLeft, nextPrice, soldOut } = cur;
    return { ...base, price: tier.price, spots, spotsLeft, nextPrice, soldOut, checkout: true };
  }
  const spots = Number(env.PLAN_SPOTS) || 0;
  const taken = hosted && spots ? await paidCount(env) : 0;
  return {
    ...base,
    price: env.PLAN_PRICE || '$29',
    spots,
    spotsLeft: spots ? Math.max(0, spots - taken) : null,
    nextPrice: env.PLAN_NEXT_PRICE || null,
    soldOut: [],
    checkout: !!env.PLAN_CHECKOUT_URL,
  };
}

/** Payment link of the monthly plan or the tier on sale now, else PLAN_CHECKOUT_URL. Test-mode links keep their test host. */
async function checkoutUrl(env: Env, plan: string | undefined) {
  const origin = env.PLAN_CHECKOUT_URL ? new URL(env.PLAN_CHECKOUT_URL).origin : 'https://checkout.dodopayments.com';
  if (plan === 'monthly' && env.MONTHLY_PRODUCT_ID) return new URL(`${origin}/buy/${env.MONTHLY_PRODUCT_ID}?quantity=1`);
  const cur = await currentTier(env);
  if (!cur) return env.PLAN_CHECKOUT_URL ? new URL(env.PLAN_CHECKOUT_URL) : null;
  return new URL(`${origin}/buy/${cur.tier.productId}?quantity=1`);
}

/** GET /api/billing/checkout[?plan=monthly]: send the signed-in user to the Dodo payment link, tagged with their account. */
export async function checkout(c: Context<AppEnv>) {
  const user = c.get('user');
  const url = await checkoutUrl(c.env, c.req.query('plan'));
  if (!url) return c.json({ error: 'Billing is not configured yet' }, 503);
  url.searchParams.set('metadata_user_id', user.id);
  if (user.email) {
    url.searchParams.set('email', user.email);
    url.searchParams.set('metadata_user_email', user.email);
  }
  // If this site tracks itself with Minilytics, credit the purchase to the visit that led to it.
  // (The checkout link is a server redirect, so the tracker can't tag it in the browser.)
  const vid = getCookie(c, 'ml_vid');
  const sid = getCookie(c, 'ml_sid');
  if (vid) url.searchParams.set('metadata_ml_visitor_id', vid);
  if (sid) url.searchParams.set('metadata_ml_session_id', sid);
  // Dodo adds ?payment_id=… here; the tracker on that page links the payment to the visitor even without metadata.
  url.searchParams.set('redirect_url', `${new URL(c.req.url).origin}/billing?paid=1`);
  return c.redirect(url.toString());
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

/** POST /api/billing/webhook: Dodo events for your own plan product turn access on and off. */
export async function billingWebhook(c: Context<AppEnv>) {
  if (!c.env.BILLING_WEBHOOK_SECRET) return c.json({ error: 'BILLING_WEBHOOK_SECRET is not set' }, 503);
  const body = await c.req.text();
  const ok = await verifyStandardWebhook(
    c.env.BILLING_WEBHOOK_SECRET,
    {
      id: c.req.header('webhook-id') ?? null,
      timestamp: c.req.header('webhook-timestamp') ?? null,
      signature: c.req.header('webhook-signature') ?? null,
    },
    body,
  );
  if (!ok) return c.json({ error: 'invalid signature' }, 401);

  const event = JSON.parse(body) as { type: string; data: Record<string, any> };
  const d = event.data ?? {};
  const productIds: string[] = [
    ...(Array.isArray(d.product_cart) ? d.product_cart.map((p: any) => p?.product_id) : []),
    d.product_id,
  ].filter(Boolean);
  // Refunds don't say which product they were for, so they're matched by the plan payment they refund.
  if (event.type === 'refund.succeeded') {
    if (!d.is_partial && str(d.payment_id)) {
      await c.env.DB.prepare(`UPDATE users SET plan_status = 'refunded', plan_until = ? WHERE dodo_payment_id = ?`)
        .bind(Date.now(), d.payment_id)
        .run();
      forgetAllSites();
    }
    return c.json({ ok: true });
  }
  // The same Dodo account may sell other products (your apps); only the plan products (every tier) matter here.
  const planIds = [c.env.PLAN_PRODUCT_ID, c.env.MONTHLY_PRODUCT_ID, ...parseTiers(c.env.PLAN_TIERS).map((t) => t.productId)].filter(
    Boolean,
  ) as string[];
  if (planIds.length && !productIds.some((id) => planIds.includes(id))) return c.json({ ok: true, ignored: 'other product' });

  const meta = { ...(d.customer?.metadata ?? {}), ...(d.metadata ?? {}) } as Record<string, unknown>;
  const email = (str(d.customer?.email) ?? str(meta.user_email))?.toLowerCase() ?? null;
  const user = await c.env.DB.prepare('SELECT id FROM users WHERE id = ? OR (email IS NOT NULL AND email = ?) LIMIT 1')
    .bind(str(meta.user_id) ?? '', email ?? '')
    .first<{ id: string }>();
  if (!user) return c.json({ ok: true, ignored: 'no matching account' });

  const now = Date.now();
  const nextBilling = Date.parse(d.next_billing_date ?? '');
  const until = Number.isFinite(nextBilling) ? nextBilling + GRACE_MS : null;
  const subId = str(d.subscription_id);
  const customerId = str(d.customer?.customer_id);

  let sql: string | null = null;
  let params: unknown[] = [];
  // A lifetime buyer who still has (or later cancels) a monthly subscription keeps lifetime access: subscription
  // events leave them alone. A refunded lifetime buyer can subscribe monthly like anyone else.
  const notLifetime = `NOT (plan IS 'lifetime' AND plan_status = 'active')`;
  switch (event.type) {
    case 'payment.succeeded':
      if (!subId) {
        // One-time payment = lifetime access (plan_until NULL), also for someone upgrading from monthly.
        sql = `UPDATE users SET plan = 'lifetime', plan_status = 'active', paid_at = COALESCE(paid_at, ?), plan_until = NULL,
                 dodo_customer_id = COALESCE(?, dodo_customer_id), dodo_payment_id = ?
               WHERE id = ?`;
        params = [now, customerId, str(d.payment_id), user.id];
      } else {
        // Subscription payments get a month until the subscription webhook says otherwise.
        sql = `UPDATE users SET plan = 'monthly', plan_status = 'active', paid_at = COALESCE(paid_at, ?),
                 plan_until = MAX(COALESCE(plan_until, 0), ?),
                 dodo_customer_id = COALESCE(?, dodo_customer_id), dodo_subscription_id = ?, dodo_payment_id = ?
               WHERE id = ? AND ${notLifetime}`;
        params = [now, now + 31 * DAY + GRACE_MS, customerId, subId, str(d.payment_id), user.id];
      }
      break;
    case 'subscription.active':
    case 'subscription.renewed':
    case 'subscription.updated':
    case 'subscription.plan_changed':
    case 'subscription.unpaused':
      if (d.status && d.status !== 'active') break;
      sql = `UPDATE users SET plan = 'monthly', plan_status = 'active', paid_at = COALESCE(paid_at, ?), plan_until = COALESCE(?, plan_until),
               dodo_customer_id = COALESCE(?, dodo_customer_id), dodo_subscription_id = COALESCE(?, dodo_subscription_id)
             WHERE id = ? AND ${notLifetime}`;
      params = [now, until, customerId, subId, user.id];
      break;
    case 'subscription.cancelled':
      // Cancelled subscriptions keep access until the end of the period they paid for.
      sql = `UPDATE users SET plan_status = 'cancelled', plan_until = COALESCE(?, plan_until, ?) WHERE id = ? AND ${notLifetime}`;
      params = [until, now, user.id];
      break;
    case 'subscription.expired':
    case 'subscription.failed':
    case 'subscription.on_hold':
    case 'subscription.paused':
      sql = `UPDATE users SET plan_status = ?, plan_until = ? WHERE id = ? AND ${notLifetime}`;
      params = [event.type.split('.')[1], now, user.id];
      break;
  }
  if (sql) {
    await c.env.DB.prepare(sql).bind(...params).run();
    forgetAllSites();
  }
  return c.json({ ok: true });
}
