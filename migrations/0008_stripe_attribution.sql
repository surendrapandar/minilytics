-- Stripe uses PaymentIntent ids for money and Checkout only for durable attribution.
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
  checkout_id TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (site_id, object_id)
);

-- Upstream's former Checkout handler used raw PaymentIntent ids for one-time payments.
-- Preserve those rows and their attribution while making later deliveries idempotent.
UPDATE payments SET id = 'stripe:' || site_id || ':' || id
  WHERE provider = 'stripe' AND kind = 'payment' AND id GLOB 'pi_*';

INSERT INTO stripe_context (site_id, object_id, visitor_id, session_id, customer_id, email, name, subscription_id, checkout_id, created_at)
  SELECT site_id, substr(id, length('stripe:' || site_id || ':') + 1), visitor_id, session_id,
    customer_id, email, name, subscription_id, checkout_id, ts
  FROM payments WHERE provider = 'stripe' AND kind = 'payment' AND id GLOB 'stripe:*:pi_*';
