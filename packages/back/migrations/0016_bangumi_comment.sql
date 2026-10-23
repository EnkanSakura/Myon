-- Bangumi 收藏增加“我的简评”；评分已存在 score 字段。
ALTER TABLE bangumi_shows ADD COLUMN comment TEXT;
