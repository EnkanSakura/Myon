import { z } from 'zod';

/**
 * 媒体图片尺寸档位：数字是「长边像素上限」，`orig` 表示保持原图。
 *
 * 前台 /media/<key>?size=… 由 Worker 用 Cloudflare Images 生成低分辨率 WebP，
 * 转换失败时自动回退原图；老内容没有尺寸记录时按 defaultMediaImageSize 显示。
 */
export const mediaImageSizes = ['480', '720', '1080', '1440', 'orig'] as const;
export type MediaImageSize = (typeof mediaImageSizes)[number];
export const mediaImageSizeSchema = z.enum(mediaImageSizes);

/** 内容图片（文章正文 / 动态配图 / 展柜藏品）的默认尺寸：长边 720px。 */
export const defaultMediaImageSize: MediaImageSize = '720';

/** 内容图片导出质量（WebP）；后台缩略图用更低质量，由前端各自决定。 */
export const mediaImageQuality = 80;

/** 尺寸档位对应的长边像素；`orig` 返回 null（不转换）。 */
export function mediaImageEdge(size: MediaImageSize): number | null {
  return size === 'orig' ? null : Number(size);
}
