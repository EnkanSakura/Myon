-- 旧站工具整体移除：D1 tools 表重置为从旧站（Rin）移植过来的三个工具。
-- 旧的 ts / img / md / color / bgm / json / redirect / short 面板都已删除，
-- 这里直接清空后重建，避免旧工具在 /tools 列表里残留。
-- 漫画下载因 Champion Cross 限制数据中心 IP 访问，先默认停用（enabled = 0）；
-- 本地 seed.sql 里会启用它，供 e2e 与本地调试使用。

DELETE FROM tools;

INSERT INTO tools
  (id, slug, tool_key, name, description, kind, keywords, href, enabled, position, created_at, updated_at)
VALUES
  ('tool_x_downloader', 'x-downloader', 'x-downloader', 'X 视频 / GIF 下载器',
   '解析 X 推文中的视频、GIF 与图片，支持直链下载或服务器中转。',
   'X · 媒体解析', 'x twitter 推文 视频 gif 图片 下载 解析', NULL, 1, 1,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('tool_lc_calculator', 'lc-calculator', 'lc-calculator', 'LC 计算器',
   '电容、电感与谐振频率互相换算，也能按目标频率匹配电容。',
   'LC · 谐振换算', 'lc 电感 电容 谐振 频率 计算 单位换算', NULL, 1, 2,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('tool_comic_downloader', 'comic-downloader', 'comic-downloader', '漫画下载',
   'Champion Cross 漫画打包下载（ZIP），仅支持当前可免费阅读的章节。',
   'COMIC · 多平台打包', '漫画 comic championcross 下载 zip 打包', NULL, 0, 3,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
