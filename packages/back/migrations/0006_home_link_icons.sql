-- 默认联系方式补上显式图标；用户自定义过的数据不动。

UPDATE settings
SET value = '[{"label":"写邮件","href":"mailto:hi@myon.studio","icon":"mail"},{"label":"GitHub","href":"#","icon":"code"},{"label":"Bangumi","href":"#","icon":"play"},{"label":"RSS","href":"/articles","icon":"rss"}]'
WHERE key = 'home_links'
  AND value = '[{"label":"写邮件","href":"mailto:hi@myon.studio"},{"label":"GitHub","href":"#"},{"label":"Bangumi","href":"#"},{"label":"RSS","href":"/articles"}]';
