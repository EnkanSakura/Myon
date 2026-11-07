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

// ---------------------------------------------------------------------------
// 媒体库分类 / 别名
// ---------------------------------------------------------------------------

/**
 * 媒体分类：后台可自定义的分类/相册，存在 D1 的 media_categories 表。
 *
 * 分类与 R2 key / URL 无关：R2 只存文件，分类、别名等元数据都在 D1，
 * 所以改名、移动分类都不会改变图片地址。
 */
export interface MediaCategory {
  id: string;
  name: string;
  /** 分类在筛选栏里的顺序，越小越靠前。 */
  position: number;
}

export interface MediaCategoryWithCount extends MediaCategory {
  count: number;
}

/** 列表筛选里代表「未分类」（D1 里 category_id 为 NULL）的保留值。 */
export const mediaUncategorizedId = 'uncategorized';

/** 迁移里预置的默认分类 id；各编辑器上传时按入口映射到它们。 */
export const mediaDefaultCategoryIds = {
  posts: 'cat_posts',
  moments: 'cat_moments',
  gallery: 'cat_gallery',
  about: 'cat_about',
} as const;
export type MediaDefaultCategoryKey = keyof typeof mediaDefaultCategoryIds;

export const mediaCategoryNameMaxLength = 24;

/** 别名：每张图最多 8 个、每个 30 字；空串丢弃、保存时去重。 */
export const mediaAliasMaxCount = 8;
export const mediaAliasMaxLength = 30;
export const mediaAliasesSchema = z
  .array(z.string())
  .transform((items) => {
    const seen = new Set<string>();
    const aliases: string[] = [];
    for (const raw of items) {
      const alias = raw.trim();
      if (!alias || seen.has(alias)) continue;
      seen.add(alias);
      aliases.push(alias);
    }
    return aliases;
  })
  .refine((aliases) => aliases.length <= mediaAliasMaxCount, {
    message: `别名最多 ${mediaAliasMaxCount} 个`,
  })
  .refine(
    (aliases) => aliases.every((alias) => alias.length <= mediaAliasMaxLength),
    { message: `每个别名最多 ${mediaAliasMaxLength} 字` },
  );
