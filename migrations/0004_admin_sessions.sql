-- Dashboard logins. A login cookie only works while its row exists here, so logging out
-- (or "log out everywhere") really ends the session instead of just clearing the browser's copy.
CREATE TABLE admin_sessions (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX admin_sessions_expires ON admin_sessions (expires_at);
