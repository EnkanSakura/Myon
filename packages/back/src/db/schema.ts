import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const posts = sqliteTable('posts', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  excerpt: text('excerpt').notNull().default(''),
  bodyMd: text('body_md').notNull(),
  status: text('status', { enum: ['draft', 'published', 'archived'] })
    .notNull()
    .default('draft'),
  category: text('category').notNull().default('随笔'),
  publishedAt: text('published_at'),
  updatedAt: text('updated_at').notNull(),
  readingMinutes: integer('reading_minutes').notNull().default(1),
  coverKey: text('cover_key'),
  createdAt: text('created_at').notNull(),
});

export const siteContent = sqliteTable('site_content', {
  key: text('key').primaryKey(),
  markdown: text('markdown').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const moments = sqliteTable('moments', {
  id: text('id').primaryKey(),
  body: text('body').notNull(),
  category: text('category').notNull().default('日常'),
  tag: text('tag'),
  visibility: text('visibility', { enum: ['public', 'private'] })
    .notNull()
    .default('public'),
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
  mediaKey: text('media_key'),
  createdAt: text('created_at').notNull(),
});

export const galleryItems = sqliteTable('gallery_items', {
  id: text('id').primaryKey(),
  no: text('no').notNull().unique(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  era: text('era'),
  note: text('note'),
  mediaKey: text('media_key'),
  displayed: integer('displayed', { mode: 'boolean' }).notNull().default(false),
  position: integer('position').notNull().default(0),
  createdAt: text('created_at').notNull(),
});

export const bangumiShows = sqliteTable('bangumi_shows', {
  id: text('id').primaryKey(),
  /** 1 书籍 / 2 动画 / 3 音乐 / 4 游戏 / 6 三次元，本站用英文枚举。 */
  subjectType: text('subject_type').notNull().default('anime'),
  bangumiId: integer('bangumi_id'),
  title: text('title').notNull(),
  status: text('status', { enum: ['watching', 'watched', 'wish', 'paused'] })
    .notNull()
    .default('wish'),
  totalEps: integer('total_eps').notNull().default(0),
  watchedEps: integer('watched_eps').notNull().default(0),
  score: integer('score'),
  /** 我在 Bangumi 写的简评。 */
  comment: text('comment'),
  nextAirAt: text('next_air_at'),
  coverKey: text('cover_key'),
  updatedAt: text('updated_at').notNull(),
});

/** 站内工具：前台 /tools 与后台 /admin/tools 共用。 */
export const tools = sqliteTable('tools', {
  id: text('id').primaryKey(),
  /** 前台工具页地址：/tools/<slug>。 */
  slug: text('slug').notNull().unique(),
  /** 内置工作台 key（ts/img/md/...）；自定义链接工具为 NULL。 */
  toolKey: text('tool_key'),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  kind: text('kind').notNull().default(''),
  keywords: text('keywords').notNull().default(''),
  /** 自定义工具的目标地址；内置工具为 NULL。 */
  href: text('href'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  position: integer('position').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/** 页面访问明细：Worker 入口按天写入，后台总览聚合最近 30 天。 */
export const pageViews = sqliteTable('page_views', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** YYYY-MM-DD（Asia/Shanghai，UTC+8）。 */
  day: text('day').notNull(),
  /** 当天有效的访客指纹（IP + UA 的 SHA-256 截断），只用于去重 UV。 */
  visitor: text('visitor').notNull(),
  path: text('path').notNull().default(''),
  createdAt: text('created_at').notNull(),
});
