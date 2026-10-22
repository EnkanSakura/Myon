-- 联系方式图标改为 Iconify 名称（如 ri:rss-fill），前台由 /api/v1/icons 取 SVG。

-- 旧的图标库 CSS 地址不再使用
DELETE FROM settings WHERE key = 'icon_library_url';

-- 兼容上一版把 Iconify 名称填进 iconHtml 的数据：搬到 icon；
-- 其余 iconHtml / 旧说明 value / 非 Iconify 的旧 icon（mail、rss 等）一并清掉。
UPDATE settings
SET value = (
  SELECT json_group_array(
    json_remove(
      CASE
        WHEN json_extract(entry.value, '$.iconHtml') GLOB '[a-z0-9-]*:[a-z0-9-]*'
          THEN json_set(entry.value, '$.icon', json_extract(entry.value, '$.iconHtml'))
        WHEN json_extract(entry.value, '$.icon') GLOB '[a-z0-9-]*:[a-z0-9-]*'
          THEN entry.value
        ELSE json_remove(entry.value, '$.icon')
      END,
      '$.iconHtml',
      '$.value'
    )
  )
  FROM (
    SELECT value FROM json_each(settings.value) AS source ORDER BY key
  ) AS entry
)
WHERE key = 'home_links';
