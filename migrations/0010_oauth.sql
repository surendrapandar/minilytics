-- OAuth for AI agents (MCP clients). An agent registers itself, the owner approves it once, and it gets
-- short-lived access tokens plus a refresh token. Tokens are stored as hashes only.

-- Apps that registered themselves (dynamic client registration), e.g. Claude, Cursor, ChatGPT.
CREATE TABLE oauth_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL, -- JSON array
  secret_hash TEXT,            -- NULL for public clients (PKCE only)
  created_at INTEGER NOT NULL,
  approved_at INTEGER          -- set once an owner approves it; never-approved apps are cleaned up after a day
);

-- One approval by an owner. Revoking it ends every token issued under it.
CREATE TABLE oauth_grants (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  subject TEXT NOT NULL, -- 'admin' (self-hosted) or 'u:<user id>' (hosted)
  scope TEXT NOT NULL,
  resource TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX oauth_grants_subject ON oauth_grants (subject);
CREATE INDEX oauth_grants_client ON oauth_grants (client_id);

-- Authorization codes (single use, 10 minutes) and access / refresh tokens.
CREATE TABLE oauth_tokens (
  hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL, -- 'code' | 'access' | 'refresh'
  grant_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  -- Codes only: what the token request must repeat.
  redirect_uri TEXT,
  code_challenge TEXT
);
CREATE INDEX oauth_tokens_grant ON oauth_tokens (grant_id);
CREATE INDEX oauth_tokens_expiry ON oauth_tokens (expires_at);
