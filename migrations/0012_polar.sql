ALTER TABLE sites ADD COLUMN polar_webhook_secret TEXT;
ALTER TABLE sites ADD COLUMN polar_product_ids TEXT;

CREATE INDEX payments_polar_checkout ON payments (site_id, checkout_id) WHERE provider = 'polar';

-- Polar reports a cumulative refunded amount on the order. Keep the checkpoints so
-- each partial refund can be reported on its own date, even if delivered out of order.
CREATE TABLE polar_refunds (
  order_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  ts INTEGER NOT NULL,
  from_webhook INTEGER NOT NULL,
  PRIMARY KEY (order_id, amount)
);
