-- Owner-managed, read-only API tokens. Only the SHA-256 hash is stored; the plaintext is shown once.
CREATE TABLE agent_tokens (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  owner_admin INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_suffix TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT 'analytics:read',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);

CREATE INDEX idx_agent_tokens_owner ON agent_tokens(owner_id);
