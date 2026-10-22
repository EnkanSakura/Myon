-- 文章与动态增加分类；顺带写入站点设置（主题色、页脚）的默认值。
-- 设置项以 INSERT OR IGNORE 写入，已存在的值不会被覆盖。

ALTER TABLE posts ADD COLUMN category TEXT NOT NULL DEFAULT '随笔';
ALTER TABLE moments ADD COLUMN category TEXT NOT NULL DEFAULT '日常';

CREATE INDEX IF NOT EXISTS idx_posts_category ON posts (category);
CREATE INDEX IF NOT EXISTS idx_moments_category ON moments (category);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('site_author', 'Myon'),
  ('site_email', 'hi@myon.studio'),
  ('theme_color', '#EC88C2'),
  ('footer_copyright', '© 2026 MYON'),
  ('footer_tech', 'Astro · Cloudflare Workers · D1 · R2'),
  ('footer_icp', '京ICP备 2026000000 号'),
  ('footer_rss', '/rss.xml'),
  ('footer_email', 'hi@myon.studio');
