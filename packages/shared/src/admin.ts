import { z } from 'zod';
import { bangumiSubjectTypes } from './bangumi';

/**
 * 后台写接口的入参校验与分页类型。前台只读，不依赖这一层。
 *
 * 注意：POST 用带默认值的 schema，PATCH 必须用**没有默认值**的基础 schema 派生。
 * zod 的 `.default()` 在 `.partial()` 之后仍会补值，会让只改一个字段的 PATCH
 * 把其他字段重置成默认值。
 */

// ---------------------------------------------------------------------------
// 文章
// ---------------------------------------------------------------------------

const postFields = {
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/, 'slug 只能是小写字母、数字和连字符'),
  title: z.string().min(1).max(200),
  excerpt: z.string().max(400),
  bodyMd: z.string().max(200000),
  status: z.enum(['draft', 'published', 'archived']),
  category: z.string().min(1).max(40),
  coverKey: z.string().max(300).nullable().optional(),
  readingMinutes: z.number().int().min(1).max(999).optional(),
  publishedAt: z.string().max(40).nullable().optional(),
};

export const postInputSchema = z.object({
  ...postFields,
  excerpt: postFields.excerpt.default(''),
  bodyMd: postFields.bodyMd.default(''),
  status: postFields.status.default('draft'),
  category: postFields.category.default('随笔'),
});
export const postPatchSchema = z.object(postFields).partial();
export type PostInput = z.infer<typeof postInputSchema>;

// ---------------------------------------------------------------------------
// 动态
// ---------------------------------------------------------------------------

const momentFields = {
  body: z.string().min(1).max(2000),
  category: z.string().min(1).max(40),
  tag: z.string().max(40).nullable().optional(),
  visibility: z.enum(['public', 'private']),
  pinned: z.boolean(),
  mediaKey: z.string().max(300).nullable().optional(),
};

export const momentInputSchema = z.object({
  ...momentFields,
  category: momentFields.category.default('日常'),
  visibility: momentFields.visibility.default('public'),
  pinned: momentFields.pinned.default(false),
});
export const momentPatchSchema = z.object(momentFields).partial();
export type MomentInput = z.infer<typeof momentInputSchema>;

// ---------------------------------------------------------------------------
// 展柜
// ---------------------------------------------------------------------------

const galleryFields = {
  no: z.string().min(1).max(20),
  name: z.string().min(1).max(120),
  category: z.string().min(1).max(40),
  era: z.string().max(40).nullable().optional(),
  note: z.string().max(400).nullable().optional(),
  mediaKey: z.string().max(300).nullable().optional(),
  displayed: z.boolean(),
  position: z.number().int().min(0).max(9999),
};

export const galleryInputSchema = z.object({
  ...galleryFields,
  displayed: galleryFields.displayed.default(true),
  position: galleryFields.position.default(0),
});
export const galleryPatchSchema = z.object(galleryFields).partial();
export type GalleryInput = z.infer<typeof galleryInputSchema>;

// ---------------------------------------------------------------------------
// 追番
// ---------------------------------------------------------------------------

const bangumiFields = {
  subjectType: z.enum(bangumiSubjectTypes),
  bangumiId: z.number().int().positive().nullable().optional(),
  title: z.string().min(1).max(200),
  status: z.enum(['watching', 'watched', 'wish', 'paused']),
  totalEps: z.number().int().min(0).max(9999),
  watchedEps: z.number().int().min(0).max(9999),
  score: z.number().int().min(0).max(10).nullable().optional(),
  comment: z.string().max(500).nullable().optional(),
  nextAirAt: z.string().max(40).nullable().optional(),
  coverKey: z.string().max(300).nullable().optional(),
};

export const bangumiInputSchema = z.object({
  ...bangumiFields,
  subjectType: bangumiFields.subjectType.default('anime'),
  status: bangumiFields.status.default('wish'),
  totalEps: bangumiFields.totalEps.default(0),
  watchedEps: bangumiFields.watchedEps.default(0),
});
export const bangumiPatchSchema = z.object(bangumiFields).partial();
export type BangumiInput = z.infer<typeof bangumiInputSchema>;

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/** 分页返回：`total` 是筛选后的总数，供“更早的”按钮判断还有没有下一页。 */
export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface MediaItem {
  id: string;
  key: string;
  filename: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  createdAt: string;
}

/** 关于页 / README 的写入入参。 */
export const aboutPatchSchema = z.object({
  markdown: z.string().max(200000),
});
