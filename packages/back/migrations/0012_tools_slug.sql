-- 工具改为独立页面：前台通过 /tools/<slug> 访问，slug 由后台维护。
-- 旧行按内置 tool_key 回填固定 slug；没有 tool_key 的自定义工具生成随机占位 slug，
-- 由维护者在后台改成可读的地址。

ALTER TABLE tools ADD COLUMN slug TEXT NOT NULL DEFAULT '';

UPDATE tools
SET slug = CASE tool_key
  WHEN 'ts' THEN 'timestamp'
  WHEN 'img' THEN 'image'
  WHEN 'md' THEN 'markdown'
  WHEN 'color' THEN 'color'
  WHEN 'bgm' THEN 'schedule'
  WHEN 'json' THEN 'json'
  WHEN 'redirect' THEN 'redirect'
  WHEN 'short' THEN 'short'
  ELSE 'tool-' || substr(lower(hex(randomblob(4))), 1, 8)
END
WHERE slug = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_tools_slug ON tools (slug);
