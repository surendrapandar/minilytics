-- Polar (polar.sh) webhook secret, one per website, same idea as Dodo's.
ALTER TABLE sites ADD COLUMN polar_webhook_secret TEXT;

-- Polar success URLs carry ?checkout_id=<uuid>. Stored on the payment so a
-- later pageview of the return URL can link the order to the visitor.
ALTER TABLE payments ADD COLUMN checkout_id TEXT;
CREATE INDEX IF NOT EXISTS payments_checkout ON payments (site_id, checkout_id);
