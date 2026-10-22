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
  bangumiId: integer('bangumi_id'),
  title: text('title').notNull(),
  status: text('status', { enum: ['watching', 'watched', 'wish', 'paused'] })
    .notNull()
    .default('wish'),
  totalEps: integer('total_eps').notNull().default(0),
  watchedEps: integer('watched_eps').notNull().default(0),
  score: integer('score'),
  nextAirAt: text('next_air_at'),
  coverKey: text('cover_key'),
  updatedAt: text('updated_at').notNull(),
});

export const media = sqliteTable('media', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  filename: text('filename').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull().default(0),
  width: integer('width'),
  height: integer('height'),
  createdAt: text('created_at').notNull(),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
