-- 首页配置模型调整：主标签改为七页逐页配置、数据块改为统计预设、去掉图注。
-- 只清理旧的配置键，并把仍是旧默认值的数据块换成新预设格式。

DELETE FROM settings WHERE key IN ('home_kicker_primary', 'home_kicker_volume', 'home_cover_caption');

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('home_page_labels', '["CH.01 封面","CH.02 目次","CH.03 四格","CH.04 收藏","CH.05 放送","CH.06 部室","CH.07 后记"]');

UPDATE settings
SET value = '[{"preset":"latest_update","accent":false},{"preset":"bangumi_watching","accent":true},{"preset":"gallery","accent":false}]'
WHERE key = 'home_stats'
  AND value = '[{"label":"最后更新","value":"01:12","unit":"","accent":false},{"label":"在追","value":"3","unit":"部","accent":true},{"label":"展柜","value":"57","unit":"件","accent":false}]';
