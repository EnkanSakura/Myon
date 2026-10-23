-- Bangumi 收藏扩展到书籍 / 音乐 / 游戏 / 三次元：记录条目类型。
-- 旧数据都是动画，默认值即为 anime。
ALTER TABLE bangumi_shows ADD COLUMN subject_type TEXT NOT NULL DEFAULT 'anime';

CREATE INDEX IF NOT EXISTS idx_bangumi_subject_type ON bangumi_shows (subject_type);
