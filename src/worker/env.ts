export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Dashboard login password (set with `wrangler secret put ADMIN_PASSWORD`). */
  ADMIN_PASSWORD: string;
  /** Random string used to sign the login cookie (`wrangler secret put SESSION_SECRET`). */
  SESSION_SECRET: string;

  // ---- Hosted (SaaS) mode, all optional. Setting the two Google values turns it on.
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Comma-separated emails that never pay and own the pre-existing sites. */
  ADMIN_EMAILS?: string;
  /** Dodo payment link for the plan, e.g. https://checkout.dodopayments.com/buy/pdt_xxx?quantity=1 */
  PLAN_CHECKOUT_URL?: string;
  /** Dodo product id of the plan, so other products in the same Dodo account are ignored. */
  PLAN_PRODUCT_ID?: string;
  /** Signing secret of the Dodo webhook pointed at /api/billing/webhook. */
  BILLING_WEBHOOK_SECRET?: string;
  /** Shown on the pricing page. */
  PLAN_PRICE?: string; // e.g. "$9"
  PLAN_INTERVAL?: string; // "month" | "year" | "lifetime"
  PLAN_SPOTS?: string; // spots at this price, e.g. "5"
  PLAN_NEXT_PRICE?: string; // shown as "then $49" next to the spots counter
  /** Price tiers that step up as spots sell, e.g. "$29:5, $49:pdt_b:5, $100" (a tier without a pdt_ id is
   *  sold out or only announced). Overrides the single-price PLAN_* values above (except PLAN_INTERVAL).
   *  Spots count every lifetime buyer from the start (monthly subscribers don't use them up). */
  PLAN_TIERS?: string;
  /** Optional monthly subscription offered next to the lifetime deal, e.g. pdt_xxx and "$9". */
  MONTHLY_PRODUCT_ID?: string;
  MONTHLY_PRICE?: string;
  SUPPORT_EMAIL?: string;
}

export interface Site {
  id: string;
  name: string;
  domain: string;
  timezone: string;
  currency: string;
  api_key: string;
  dodo_webhook_secret: string | null;
  created_at: number;
  owner_id?: string | null;
  dodo_product_ids?: string | null;
  stripe_webhook_secret?: string | null;
}

/** A site plus its owner's plan, used to stop recording when a hosted plan lapses. */
export type SiteWithOwner = Site & { owner_email?: string | null; owner_plan_status?: string | null; owner_plan_until?: number | null };

export type AppEnv = { Bindings: Env; Variables: { site: Site; user: import('./auth').User } };

const siteCache = new Map<string, { site: SiteWithOwner | null; at: number }>();

/** Sites change rarely; cache them per isolate so ingestion costs one fewer read per event. */
export async function getSite(db: D1Database, id: string): Promise<SiteWithOwner | null> {
  const hit = siteCache.get(id);
  if (hit && Date.now() - hit.at < 60_000) return hit.site;
  const site = await db
    .prepare(
      `SELECT s.*, u.email AS owner_email, u.plan_status AS owner_plan_status, u.plan_until AS owner_plan_until
       FROM sites s LEFT JOIN users u ON u.id = s.owner_id WHERE s.id = ?`,
    )
    .bind(id)
    .first<SiteWithOwner>();
  siteCache.set(id, { site, at: Date.now() });
  return site;
}

export function forgetSite(id: string) {
  siteCache.delete(id);
}

/** After a plan changes, owners' sites must re-check whether they may record events. */
export function forgetAllSites() {
  siteCache.clear();
}
