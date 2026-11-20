-- AI crawler hits, sent by the site's server (crawlers don't run the JS tracker).
-- crawler = display name (ChatGPT, OpenAI, Google…), category = answers | indexing | training.
CREATE TABLE crawler_hits (
  site_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  crawler TEXT NOT NULL,
  category TEXT NOT NULL,
  path TEXT NOT NULL
);
CREATE INDEX crawler_hits_site_time ON crawler_hits (site_id, category, ts);
