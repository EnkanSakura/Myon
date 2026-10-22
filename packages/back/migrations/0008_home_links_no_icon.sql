-- 联系方式只用自由编辑的图标 HTML；默认配置去掉内置图标键。

UPDATE settings
SET value = '[{"label":"写邮件","href":"mailto:hi@myon.studio"},{"label":"GitHub","href":"#"},{"label":"Bangumi","href":"#"},{"label":"RSS","href":"/articles"}]'
WHERE key = 'home_links'
  AND value = '[{"label":"写邮件","href":"mailto:hi@myon.studio","icon":"mail"},{"label":"GitHub","href":"#","icon":"code"},{"label":"Bangumi","href":"#","icon":"play"},{"label":"RSS","href":"/articles","icon":"rss"}]';
