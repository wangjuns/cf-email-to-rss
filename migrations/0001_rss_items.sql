CREATE TABLE IF NOT EXISTS rss_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  link TEXT,
  pubDateMs INTEGER NOT NULL,
  description TEXT
);

CREATE INDEX IF NOT EXISTS rss_items_pubDateMs_idx ON rss_items (pubDateMs);

