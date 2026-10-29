-- Hosted (SaaS) mode: people sign in with Google and pay for a plan. Self-hosted installs don't use these.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_sub TEXT UNIQUE,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  avatar TEXT,
  created_at INTEGER NOT NULL,
  -- Billing: 'none' until they pay, then 'active'; 'cancelled' / 'expired' when a subscription ends.
  plan_status TEXT NOT NULL DEFAULT 'none',
  -- When access ends (subscriptions). NULL with plan_status 'active' means paid for life (one-time payment).
  plan_until INTEGER,
  dodo_customer_id TEXT,
  dodo_subscription_id TEXT,
  dodo_payment_id TEXT, -- last plan payment, to recognise its refund
  paid_at INTEGER
);

-- Which account owns a site. NULL = created before accounts existed (belongs to the admin).
ALTER TABLE sites ADD COLUMN owner_id TEXT;
CREATE INDEX sites_owner ON sites (owner_id);

-- Optional: only count payments for these Dodo product ids (comma-separated) on this site.
-- Needed when one Dodo account sells several products (each webhook receives every payment).
ALTER TABLE sites ADD COLUMN dodo_product_ids TEXT;
