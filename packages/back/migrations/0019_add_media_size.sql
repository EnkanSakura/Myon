-- 文章正文图片按 Markdown 里的 URL 参数转换，不需要列；动态配图与展柜藏品
-- 各加一个尺寸档位（480/720/1080/1440/orig，见 @myon/shared 的 mediaImageSizes）。
-- 旧记录为空：前台按默认 720 显示，编辑保存后写入具体档位。
ALTER TABLE moments ADD COLUMN media_size TEXT;

ALTER TABLE gallery_items ADD COLUMN media_size TEXT;
