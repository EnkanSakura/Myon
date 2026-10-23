import { z } from 'zod';
import type { BangumiStatus, BangumiSubjectType } from './bangumi';

/** 全站共用的纯类型与校验，不依赖 Cloudflare 运行时。 */

export * from './admin';
export * from './bangumi';
export * from './icons';
export * from './settings';
export * from './tools';

export const postStatusSchema = z.enum(['draft', 'published', 'archived']);
export type PostStatus = z.infer<typeof postStatusSchema>;

export const aboutKey = 'about' as const;

/**
 * API 版本。`/api/v1/*` 一旦发布就当作契约：
 * 破坏性变更新增 v2，v1 按旧结构继续服务（原生 App 无法强制用户升级）。
 * 基础设施探针 `/api/health` 不受版本影响，长期保持不版本化。
 */
export const API_VERSION = 'v1' as const;
export const apiBasePath = `/api/${API_VERSION}`;

export interface PostListItem {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  /** 分类，例如「技术」「随笔」。 */
  category: string;
  publishedAt: string | null;
  readingMinutes: number;
  coverKey: string | null;
}

/** 文章正文里的二级标题，用于目录锚点。 */
export interface TocEntry {
  id: string;
  label: string;
}

export interface PostDetailResponse extends PostListItem {
  bodyMd: string;
  status: PostStatus;
  updatedAt: string | null;
  /** 渲染后的正文 HTML，已做白名单过滤。 */
  html: string;
  toc: TocEntry[];
}

export interface MomentListItem {
  id: string;
  body: string;
  /** 分类，例如「日常」「技术」。 */
  category: string;
  tag: string | null;
  pinned: boolean;
  mediaKey: string | null;
  createdAt: string;
}

export interface CategoryCount {
  name: string;
  count: number;
}

/** 文章与动态各自用到的分类及数量。 */
export interface CategoriesResponse {
  posts: CategoryCount[];
  moments: CategoryCount[];
}

/** 展柜里的一件藏品；`mediaKey` 用媒体地址约定换算成图片 URL。 */
export interface GalleryItem {
  id: string;
  no: string;
  name: string;
  category: string;
  era: string | null;
  note: string | null;
  mediaKey: string | null;
  displayed: boolean;
  position: number;
  createdAt: string;
}

/** 站点统计：后台总览与前台页头共用，只读。 */
export interface SiteStats {
  /** 全站内容的最后更新时间（文章/动态/展柜取最大），ISO 字符串。 */
  lastUpdated: string | null;
  posts: { published: number; draft: number; words: number };
  moments: { total: number };
  gallery: { total: number; displayed: number; categories: CategoryCount[] };
  bangumi: {
    total: number;
    watching: number;
    byType: Record<BangumiSubjectType, { total: number; watching: number }>;
    byStatus: Record<BangumiStatus, number>;
  };
  /** 媒体库文件数（实时统计 R2 对象）。 */
  media: { total: number };
  /** 站内工具数量：后台侧栏计数用。 */
  tools: { total: number; enabled: number };
  categories: CategoriesResponse;
}

export interface AboutResponse {
  key: string;
  markdown: string;
  html: string;
  updatedAt: string | null;
}
