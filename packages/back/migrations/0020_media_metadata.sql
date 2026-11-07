-- 媒体库元数据：分类（可自定义）、图片元数据、别名。
-- 图片文件仍只存 R2；R2 key / URL 里不包含分类信息，分类与别名只存在这三张表。

CREATE TABLE IF NOT EXISTS media_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS media_categories_name_idx
  ON media_categories (name);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  category_id TEXT REFERENCES media_categories (id) ON DELETE SET NULL,
  uploaded_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS media_category_idx ON media (category_id);
CREATE INDEX IF NOT EXISTS media_uploaded_idx ON media (uploaded_at);

CREATE TABLE IF NOT EXISTS media_aliases (
  media_id TEXT NOT NULL REFERENCES media (id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  PRIMARY KEY (media_id, alias)
);

CREATE INDEX IF NOT EXISTS media_alias_idx ON media_aliases (alias);

-- 预置默认分类：各编辑器入口按 id 自动归类；可改名、可删除（删除后图片回到未分类）。
INSERT INTO media_categories (id, name, position, created_at)
VALUES
  ('cat_posts', '文章', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('cat_moments', '动态', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('cat_gallery', '展柜', 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('cat_about', '关于', 3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT (id) DO NOTHING;
