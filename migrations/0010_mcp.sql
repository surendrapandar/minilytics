-- Read-only access for AI assistants over MCP (/mcp).
-- Every token is stored as a SHA-256 hash; the raw value is only shown once.
CREATE TABLE api_tokens (
  hash TEXT PRIMARY KEY,
  -- 'personal' (made in the dashboard, never expires) | 'access' / 'refresh' (issued to an OAuth app)
  kind TEXT NOT NULL,
  -- Who it acts as, same format as the login cookie: 'admin' (self-hosted) or 'u:<user id>' (hosted).
  subject TEXT NOT NULL,
  -- One connection: a personal token, or an OAuth app's access + refresh tokens. Revoking deletes the whole grant.
  grant_id TEXT NOT NULL,
  -- Token label or OAuth app name, shown in the dashboard.
  name TEXT NOT NULL,
  client_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  last_used_at INTEGER
);
CREATE INDEX api_tokens_subject ON api_tokens (subject, grant_id);

-- Apps that registered themselves (OAuth dynamic client registration), e.g. Claude or ChatGPT connectors.
CREATE TABLE oauth_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL, -- JSON array
  created_at INTEGER NOT NULL
);

-- One-time authorization codes (10 minutes), PKCE S256 only.
CREATE TABLE oauth_codes (
  hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
