-- Polar (polar.sh) webhook secret, one per website, same idea as Dodo's and Stripe's.
ALTER TABLE sites ADD COLUMN polar_webhook_secret TEXT;

-- payments.checkout_id comes from 0006_stripe. Polar success URLs carry ?checkout_id=<uuid>, and a later
-- pageview of the return URL looks the payment up by it.
CREATE INDEX IF NOT EXISTS payments_checkout ON payments (site_id, checkout_id);
