-- Browsers the site owner uses the dashboard from, as a hash of IP + user agent (the raw IP is never stored).
-- Visits from these to the owner's own sites aren't counted. owner '' covers sites with no owner (self-hosted, legacy).
CREATE TABLE owner_devices (
  owner TEXT NOT NULL,
  fp TEXT NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (owner, fp)
);
