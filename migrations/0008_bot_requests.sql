-- Server-reported bot requests are separate from human sessions and events.
CREATE TABLE bot_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  bot TEXT NOT NULL,
  category TEXT NOT NULL,
  hostname TEXT NOT NULL,
  path TEXT NOT NULL
);
CREATE INDEX bot_requests_site_ts ON bot_requests(site_id, ts);
