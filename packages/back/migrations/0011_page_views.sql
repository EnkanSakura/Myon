-- 页面访问明细：Worker 入口在渲染前台 HTML 时写入，后台总览聚合最近 30 天。
-- 只记录 day / 访客指纹 / 路径，不落 IP 原文；指纹是 IP + UA 的 SHA-256 截断，仅用于当天 UV 去重。

CREATE TABLE IF NOT EXISTS page_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  visitor TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_page_views_day ON page_views (day);
CREATE INDEX IF NOT EXISTS idx_page_views_day_visitor ON page_views (day, visitor);
