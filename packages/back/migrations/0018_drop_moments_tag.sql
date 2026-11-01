-- 动态不再保留「标签」字段：分类已覆盖原有用途，前后台与公开接口同步移除。
-- 0001_init 里创建的 tag 列属于已应用迁移，不改动；这里只新增删除列的迁移，
-- 已有数据的 tag 值随列一起丢弃。
ALTER TABLE moments DROP COLUMN tag;
