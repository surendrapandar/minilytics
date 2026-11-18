-- Bots, crawlers and AI agents, counted per hour, bot and page: never one row per hit, so heavy crawling
-- doesn't fill the database. People are stored in sessions/events; bots only here.
CREATE TABLE bot_hits (
  site_id TEXT NOT NULL,
  hour INTEGER NOT NULL,               -- start of the hour (UTC, ms)
  bot TEXT NOT NULL,                   -- GPTBot, ClaudeBot, Googlebot, curl…
  path TEXT NOT NULL,
  operator TEXT NOT NULL,              -- OpenAI, Anthropic, Google… ('' for scripts and unknown bots)
  category TEXT NOT NULL,              -- AI training, AI search, AI assistant, AI agent, Search engine…
  hits INTEGER NOT NULL DEFAULT 0,
  verified INTEGER NOT NULL DEFAULT 0, -- proven to come from the operator (its published IPs or a signature)
  spoofed INTEGER NOT NULL DEFAULT 0,  -- claimed to be a bot whose operator publishes its IPs, from another IP
  errors INTEGER NOT NULL DEFAULT 0,   -- answered with a 4xx/5xx (when the site's server reports the status)
  blocked INTEGER NOT NULL DEFAULT 0,  -- times the site's snippet cut the bot off for flooding (429, reported once a minute)
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (site_id, hour, bot, path)
) WITHOUT ROWID;

-- When the site's server last reported bots (POST /api/v1/hits), to show that setup as connected.
ALTER TABLE sites ADD COLUMN bot_feed_at INTEGER;

-- Server snippets look their site up by API key on every report.
CREATE INDEX sites_api_key ON sites (api_key);
