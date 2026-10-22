-- 联系方式去掉说明文字，前台改为图标 + 标签。
-- 只迁移仍是旧默认值的配置；用户自定义的内容由前台 normalizeLinks 丢弃 value。

UPDATE settings
SET value = '[{"label":"写邮件","href":"mailto:hi@myon.studio"},{"label":"GitHub","href":"#"},{"label":"Bangumi","href":"#"},{"label":"RSS","href":"/articles"}]'
WHERE key = 'home_links'
  AND value = '[{"label":"写邮件","value":"hi@myon.studio","href":"mailto:hi@myon.studio"},{"label":"GitHub","value":"@myon","href":"#"},{"label":"Bangumi","value":"@myon","href":"#"},{"label":"RSS","value":"订阅","href":"/articles"}]';
