-- Dodo sends every payment in an account to every webhook, so a Dodo account selling several products
-- reaches every site connected to it. Which products belong to which site is learned automatically.

-- Which product a payment was for.
ALTER TABLE payments ADD COLUMN product_id TEXT;

-- Products known to belong to a site: its pages link to their checkout, a buyer carried the site's
-- visitor id, or a buyer landed on the site's return page.
CREATE TABLE dodo_products (
  product_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  PRIMARY KEY (product_id, site_id)
);

-- Payments that can't be placed yet (an unknown product, and several sites share the account).
-- They're counted as soon as the product is linked to this site, and never shown on the wrong one.
CREATE TABLE pending_payments (
  site_id TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  product_id TEXT,
  ts INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (site_id, payment_id)
);

-- Which site a visitor id belongs to, for payments that carry one.
CREATE INDEX visitors_id ON visitors (id);

-- Learn from the checkout links visitors already clicked.
INSERT OR IGNORE INTO dodo_products (product_id, site_id)
  SELECT DISTINCT rtrim(substr(name, instr(name, '/buy/') + 5), '/'), site_id FROM events
  WHERE type = 'outbound' AND name LIKE '%dodopayments.com/buy/pdt%';
