-- A null pair preserves account-wide ingestion; configured rules compare metadata exactly.
ALTER TABLE sites ADD COLUMN stripe_metadata_key TEXT;
ALTER TABLE sites ADD COLUMN stripe_metadata_value TEXT;

-- Refunds are not revenue until the original PaymentIntent has passed the site's rule.
CREATE TABLE stripe_pending_refunds (
  site_id TEXT NOT NULL,
  refund_id TEXT NOT NULL,
  payment_intent_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  PRIMARY KEY (site_id, refund_id)
);
CREATE INDEX stripe_pending_refunds_payment ON stripe_pending_refunds (site_id, payment_intent_id);
