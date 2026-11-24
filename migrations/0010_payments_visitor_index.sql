-- Look up a visitor's payments directly. Without this, queries that join payments by visitor
-- (revenue by page, visitor and realtime lists) scanned every payment of the site per visitor row,
-- so D1 rows read grew with pageviews × payments and exhausted the free daily read limit.
CREATE INDEX payments_visitor ON payments (site_id, visitor_id, ts);
