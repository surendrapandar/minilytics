-- payments.amount is revenue (tax included) in the site's currency, so totals never mix currencies.
-- What the customer was charged is kept alongside. A payment whose rate wasn't available yet is stored
-- with amount 0 and fx_pending = 1, and converted on a later attempt.
ALTER TABLE payments ADD COLUMN orig_amount INTEGER;
ALTER TABLE payments ADD COLUMN orig_currency TEXT;
-- Kept so a pending payment converts later exactly as it would have on arrival.
ALTER TABLE payments ADD COLUMN orig_tax INTEGER;
ALTER TABLE payments ADD COLUMN settlement_amount INTEGER;
ALTER TABLE payments ADD COLUMN settlement_currency TEXT;
-- The moment whose rate applies: the payment's own time, or for a refund its payment's.
ALTER TABLE payments ADD COLUMN fx_ts INTEGER;
ALTER TABLE payments ADD COLUMN fx_pending INTEGER NOT NULL DEFAULT 0;
CREATE INDEX payments_fx_pending ON payments (site_id) WHERE fx_pending = 1;

-- Daily exchange rates, fetched once per pair and day.
CREATE TABLE fx_rates (
  day TEXT NOT NULL,
  base TEXT NOT NULL,
  quote TEXT NOT NULL,
  rate REAL NOT NULL,
  PRIMARY KEY (day, base, quote)
);
