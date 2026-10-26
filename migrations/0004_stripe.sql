-- Stripe uses PaymentIntent ids for money and Checkout only for durable attribution.
ALTER TABLE sites ADD COLUMN stripe_webhook_secret TEXT;
ALTER TABLE payments ADD COLUMN original_payment_id TEXT;
CREATE INDEX payments_original_payment ON payments (site_id, original_payment_id);

-- A refund may arrive before its original payment, so original_payment_id deliberately
-- has no foreign key. Both ids include the provider and site namespace.
-- Customer context also survives free trials with no initial PaymentIntent.
CREATE TABLE stripe_context (
  site_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  visitor_id TEXT,
  session_id TEXT,
  customer_id TEXT,
  email TEXT,
  name TEXT,
  subscription_id TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (site_id, object_id)
);
