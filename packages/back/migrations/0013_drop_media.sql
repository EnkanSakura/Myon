-- 媒体库只以 R2 为唯一数据源：对象列表、上传时间与文件名都从 R2 读，
-- 不再在 D1 维护 media 表。此迁移删除历史登记表。
DROP TABLE IF EXISTS media;
