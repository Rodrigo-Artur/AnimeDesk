PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('anime','manga')),
  title TEXT NOT NULL,
  title_english TEXT,
  mal_id INTEGER,
  cover_url TEXT,
  synopsis TEXT,
  total_episodes INTEGER,
  total_chapters INTEGER,
  score REAL,
  year INTEGER,
  genres_json TEXT NOT NULL DEFAULT '[]',
  studios_json TEXT NOT NULL DEFAULT '[]',
  airing_status TEXT,
  cached_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(type, mal_id)
);

CREATE TABLE IF NOT EXISTS external_media_ids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  external_title TEXT,
  confidence REAL,
  verified INTEGER NOT NULL DEFAULT 0,
  UNIQUE(provider, external_id)
);

CREATE TABLE IF NOT EXISTS library_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id INTEGER NOT NULL UNIQUE REFERENCES media(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  score REAL,
  notes TEXT,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  episode INTEGER,
  chapter INTEGER,
  release_at TEXT NOT NULL,
  release_type TEXT,
  provider TEXT NOT NULL,
  UNIQUE(media_id, episode, chapter, release_at, provider)
);

CREATE TABLE IF NOT EXISTS watch_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  episode INTEGER,
  chapter INTEGER,
  provider TEXT,
  watched_at TEXT NOT NULL,
  source_event_id TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  release_id INTEGER REFERENCES releases(id) ON DELETE CASCADE,
  notify_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0
);


CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
