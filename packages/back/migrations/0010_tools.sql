-- 站内工具改为 D1 管理：前台 /tools 与后台 /admin/tools 读同一张表。
-- 只保留工具本身的信息（名称、说明、类型、关键词、链接、启停、排序），
-- 设计稿里的「本月调用 / 平均耗时」没有真实来源，已整体移除。

CREATE TABLE IF NOT EXISTS tools (
  id TEXT PRIMARY KEY,
  tool_key TEXT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT '',
  keywords TEXT NOT NULL DEFAULT '',
  href TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tools_enabled_position ON tools (enabled, position);

INSERT OR IGNORE INTO tools
  (id, tool_key, name, description, kind, keywords, href, enabled, position, created_at, updated_at)
VALUES
  ('tool_ts', 'ts', '时间戳转换',
   '把 Unix 时间戳换成可读的日期时间，按所选时区算。输入即换算，结果点一下就能复制。',
   'UNIX TIME · 浏览器内换算', '时间戳 unix timestamp 秒 毫秒 时区 日期', NULL, 1, 1,
   '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z'),
  ('tool_img', 'img', '图片压缩',
   '选一张图，在浏览器里压成 WebP 或 AVIF；压缩结果直接写进 R2，原图不经过别人的服务器。',
   'IMAGE · 浏览器内压缩', '图片 压缩 webp avif r2 图片压缩', NULL, 1, 2,
   '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z'),
  ('tool_md', 'md', 'Markdown 预览',
   '左边写 Markdown，右边即时出预览。写动态和长文之前，先在这里过一眼。',
   'MARKDOWN · 即时预览', 'markdown md 预览 写作 文章', NULL, 1, 3,
   '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z'),
  ('tool_color', 'color', '配色生成',
   '从一个源色里取五色，深浅按固定比例递进。做封面、调 CSS 时用。',
   'COLOR · 五格色板', '配色 颜色 color 调色 色板', NULL, 1, 4,
   '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z'),
  ('tool_bgm', 'bgm', '追番时刻表',
   '本季每周的放送时间，按天排好。和 05 追番页共用同一份 Bangumi 缓存。',
   'SCHEDULE · 本周放送', '追番 时刻表 新番 日历 bangumi', '/bangumi', 1, 5,
   '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z'),
  ('tool_json', 'json', 'JSON 格式化',
   '粘贴一段 JSON，立刻拿到缩进后的版本。解析失败会把出错的行写出来。',
   'JSON · 格式化', 'json 格式化 美化 校验 开发', NULL, 1, 6,
   '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z'),
  ('tool_redirect', 'redirect', '旧域名跳转',
   '旧域名的链接 301 到新域名，路径和查询参数原样保留。',
   'REDIRECT · 301', '域名 跳转 301 重定向 旧链接', NULL, 1, 7,
   '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z'),
  ('tool_short', 'short', '短链接',
   '把长链接压成一段短码，跳转记录存在 D1，同一条链接复用一个码。',
   'SHORT URL · 短码', '短链接 短网址 short url 分享', NULL, 1, 8,
   '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z');
