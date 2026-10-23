-- 记录 Bangumi 原图 URL，前台通过站内代理按需加载封面。
ALTER TABLE bangumi_shows ADD COLUMN cover_source TEXT;
