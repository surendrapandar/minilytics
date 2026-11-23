-- Payments in another currency than the site's are converted on arrival; what the buyer actually paid is kept here.
ALTER TABLE payments ADD COLUMN original_amount INTEGER;
ALTER TABLE payments ADD COLUMN original_currency TEXT;

-- Daily exchange rates, cached so each currency pair is fetched once per day.
CREATE TABLE fx_rates (
  day TEXT NOT NULL,   -- YYYY-MM-DD
  base TEXT NOT NULL,  -- e.g. EUR
  quote TEXT NOT NULL, -- e.g. USD
  rate REAL NOT NULL,  -- 1 base = rate quote
  PRIMARY KEY (day, base, quote)
);
