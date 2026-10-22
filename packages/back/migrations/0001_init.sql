-- 0001_init.sql — Myon D1 初始结构
CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  body_md TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  published_at TEXT,
  updated_at TEXT NOT NULL,
  reading_minutes INTEGER NOT NULL DEFAULT 1,
  cover_key TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_posts_status_published ON posts (status, published_at DESC);

CREATE TABLE site_content (
  key TEXT PRIMARY KEY,
  markdown TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE moments (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  tag TEXT,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  pinned INTEGER NOT NULL DEFAULT 0,
  media_key TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_moments_created ON moments (created_at DESC);

CREATE TABLE gallery_items (
  id TEXT PRIMARY KEY,
  no TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  era TEXT,
  note TEXT,
  media_key TEXT,
  displayed INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_gallery_category ON gallery_items (category, position);

CREATE TABLE bangumi_shows (
  id TEXT PRIMARY KEY,
  bangumi_id INTEGER,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'wish' CHECK (status IN ('watching', 'watched', 'wish', 'paused')),
  total_eps INTEGER NOT NULL DEFAULT 0,
  watched_eps INTEGER NOT NULL DEFAULT 0,
  score INTEGER,
  next_air_at TEXT,
  cover_key TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_bangumi_status ON bangumi_shows (status, next_air_at);

CREATE TABLE media (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_media_created ON media (created_at DESC);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
