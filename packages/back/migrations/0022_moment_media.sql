-- 动态支持多图：media 存 JSON 数组 [{ "key": "...", "size": "720" }]。
-- media_key / media_size 保留并始终同步第一张，旧客户端与首页只读第一张。
-- 老记录 media 为空时由接口回退到 media_key / media_size，不需要回填。
ALTER TABLE moments ADD COLUMN media TEXT;
