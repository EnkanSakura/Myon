-- 首页封面配置的默认值。已存在的值不会被覆盖，升级后不改变现有站点。

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('home_kicker_primary', 'CH.01 封面'),
  ('home_kicker_volume', 'VOL. 2026'),
  ('home_title', '灯下的一格'),
  ('home_lead', '写字、看番、存图、做点小工具。' || char(10) || '一个人的二次元生活志，自己画、自己印，一共七页。'),
  ('home_stats', '[{"label":"最后更新","value":"01:12","unit":"","accent":false},{"label":"在追","value":"3","unit":"部","accent":true},{"label":"展柜","value":"57","unit":"件","accent":false}]'),
  ('home_links', '[{"label":"写邮件","value":"hi@myon.studio","href":"mailto:hi@myon.studio"},{"label":"GitHub","value":"@myon","href":"#"},{"label":"Bangumi","value":"@myon","href":"#"},{"label":"RSS","value":"订阅","href":"/articles"}]'),
  ('home_cover_image', '/assets/cabinet.jpg'),
  ('home_cover_badge', '全七页 / ALL 7'),
  ('home_cover_note', 'LIGHT ON · 只开一盏灯'),
  ('home_cover_caption', 'PANEL 01 · 封面');
