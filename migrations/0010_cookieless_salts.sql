-- Cookieless mode: one random salt per UTC day. A visitor is a hash of salt + site + IP + user agent, and the salt
-- is deleted once its day is over, so the hashes can no longer be linked to an IP (the raw IP is never stored).
CREATE TABLE salts (
  day TEXT PRIMARY KEY,
  salt TEXT NOT NULL
);
