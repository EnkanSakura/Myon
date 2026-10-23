-- 站点设置迁到 Workers KV（绑定 SETTINGS），D1 只保留内容数据。
-- Deploy workflow 会在应用本迁移前，把这里的设置导入 KV（见 docs/DEPLOY.md §2.3）。
DROP TABLE IF EXISTS settings;
