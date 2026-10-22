import {
  aboutKey,
  isIconifyIconName,
  paginationSchema,
  toPublicSiteSettings,
} from '@myon/shared';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../db/client';
import {
  bangumiShows,
  galleryItems,
  media,
  moments,
  posts,
  siteContent,
} from '../db/schema';
import { MAX_ICONS, resolveIconSvgs } from '../icons';
import { renderArticle, renderMarkdown } from '../markdown';
import { readSiteSettings, sanitizeFooterHtml } from '../site';
import type { AppBindings } from '../types';
import admin from './v1/admin';

/**
 * v1 契约。挂载在 `apiBasePath`（/api/v1）下。
 *
 * 这里的路径和响应结构一旦发布就当作契约：破坏性改动请新增 v2 并在
 * `app.ts` 里同时挂载，不要就地改 v1 —— 手机端 App 无法强制用户升级，
 * 旧版本可能长期在线上。
 */
const v1 = new Hono<{ Bindings: AppBindings }>();

/** 文章与动态的分类统计，/categories 与 /stats 共用。 */
async function readCategoryCounts(client: ReturnType<typeof getDb>) {
  const postRows = await client
    .select({ name: posts.category, count: sql<number>`count(*)` })
    .from(posts)
    .where(eq(posts.status, 'published'))
    .groupBy(posts.category)
    .orderBy(desc(sql`count(*)`));
  const momentRows = await client
    .select({ name: moments.category, count: sql<number>`count(*)` })
    .from(moments)
    .where(eq(moments.visibility, 'public'))
    .groupBy(moments.category)
    .orderBy(desc(sql`count(*)`));

  return { posts: postRows, moments: momentRows };
}

v1.get('/posts', async (c) => {
  const db = getDb(c.env.DB);
  const category = c.req.query('category');
  const { limit, offset } = paginationSchema.parse(c.req.query());
  const published = eq(posts.status, 'published');
  const where = category
    ? and(published, eq(posts.category, category))
    : published;

  const rows = await db
    .select({
      id: posts.id,
      slug: posts.slug,
      title: posts.title,
      excerpt: posts.excerpt,
      category: posts.category,
      publishedAt: posts.publishedAt,
      readingMinutes: posts.readingMinutes,
      coverKey: posts.coverKey,
    })
    .from(posts)
    .where(where)
    .orderBy(desc(posts.publishedAt))
    .limit(limit)
    .offset(offset);
  const totalRows = await db
    .select({ total: sql<number>`count(*)` })
    .from(posts)
    .where(where);

  return c.json({
    items: rows,
    total: totalRows[0]?.total ?? 0,
    limit,
    offset,
  });
});

v1.get('/posts/:slug', async (c) => {
  const db = getDb(c.env.DB);
  const row = await db
    .select()
    .from(posts)
    .where(eq(posts.slug, c.req.param('slug')))
    .get();

  if (row?.status !== 'published') {
    return c.json({ error: 'not_found' }, 404);
  }

  const { html, toc } = renderArticle(row.bodyMd);

  return c.json({
    ...row,
    html,
    toc,
  });
});

v1.get('/about', async (c) => {
  const db = getDb(c.env.DB);
  const row = await db
    .select()
    .from(siteContent)
    .where(eq(siteContent.key, aboutKey))
    .get();

  if (!row) {
    return c.json({ key: 'about', markdown: '', html: '', updatedAt: null });
  }

  return c.json({
    key: row.key,
    markdown: row.markdown,
    html: renderMarkdown(row.markdown),
    updatedAt: row.updatedAt,
  });
});

/** 前台需要的站点配置：主题色与页脚文案，后台可改。 */
v1.get('/site', async (c) => {
  const settings = await readSiteSettings(c.env.DB);
  const publicSettings = toPublicSiteSettings(settings);
  publicSettings.footerTech = sanitizeFooterHtml(publicSettings.footerTech);
  publicSettings.footerIcp = sanitizeFooterHtml(publicSettings.footerIcp);
  return c.json({ settings: publicSettings });
});

/** 联系方式用到的 Iconify 图标：批量取回并过滤成可内联的 SVG。 */
v1.get('/icons', async (c) => {
  const names = (c.req.query('names') ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  if (names.length === 0) return c.json({ icons: [] });
  if (names.length > MAX_ICONS) return c.json({ error: 'too_many_icons' }, 400);
  if (!names.every((name) => isIconifyIconName(name)))
    return c.json({ error: 'invalid_icon_name' }, 400);

  const icons = await resolveIconSvgs(names);
  return c.json({ icons }, 200, { 'Cache-Control': 'public, max-age=3600' });
});

v1.get('/moments', async (c) => {
  const db = getDb(c.env.DB);
  const category = c.req.query('category');
  const { limit, offset } = paginationSchema.parse(c.req.query());
  const isPublic = eq(moments.visibility, 'public');
  const where = category
    ? and(isPublic, eq(moments.category, category))
    : isPublic;

  const rows = await db
    .select({
      id: moments.id,
      body: moments.body,
      category: moments.category,
      tag: moments.tag,
      pinned: moments.pinned,
      mediaKey: moments.mediaKey,
      createdAt: moments.createdAt,
    })
    .from(moments)
    .where(where)
    .orderBy(desc(moments.pinned), desc(moments.createdAt))
    .limit(limit)
    .offset(offset);
  const totalRows = await db
    .select({ total: sql<number>`count(*)` })
    .from(moments)
    .where(where);

  return c.json({
    items: rows,
    total: totalRows[0]?.total ?? 0,
    limit,
    offset,
  });
});

v1.get('/categories', async (c) => {
  const counts = await readCategoryCounts(getDb(c.env.DB));
  return c.json(counts);
});

v1.get('/gallery', async (c) => {
  const db = getDb(c.env.DB);
  const { limit, offset } = paginationSchema.parse(c.req.query());
  const where = eq(galleryItems.displayed, true);

  const rows = await db
    .select()
    .from(galleryItems)
    .where(where)
    .orderBy(asc(galleryItems.position), desc(galleryItems.createdAt))
    .limit(limit)
    .offset(offset);
  const totalRows = await db
    .select({ total: sql<number>`count(*)` })
    .from(galleryItems)
    .where(where);

  return c.json({
    items: rows,
    total: totalRows[0]?.total ?? 0,
    limit,
    offset,
  });
});

v1.get('/bangumi', async (c) => {
  const db = getDb(c.env.DB);
  const { limit, offset } = paginationSchema.parse(c.req.query());

  const rows = await db
    .select()
    .from(bangumiShows)
    .orderBy(
      sql`case when status = 'watching' then 0 else 1 end`,
      asc(bangumiShows.nextAirAt),
    )
    .limit(limit)
    .offset(offset);
  const totalRows = await db
    .select({ total: sql<number>`count(*)` })
    .from(bangumiShows);

  return c.json({
    items: rows,
    total: totalRows[0]?.total ?? 0,
    limit,
    offset,
  });
});

/** 站点统计：后台总览与前台页头共用，不含任何正文。 */
v1.get('/stats', async (c) => {
  const db = getDb(c.env.DB);

  const postAgg = await db
    .select({
      published: sql<number>`coalesce(sum(case when status = 'published' then 1 else 0 end), 0)`,
      draft: sql<number>`coalesce(sum(case when status = 'draft' then 1 else 0 end), 0)`,
      words: sql<number>`coalesce(sum(case when status = 'published' then length(body_md) else 0 end), 0)`,
    })
    .from(posts);
  const momentAgg = await db
    .select({ total: sql<number>`count(*)` })
    .from(moments)
    .where(eq(moments.visibility, 'public'));
  const galleryAgg = await db
    .select({
      total: sql<number>`count(*)`,
      displayed: sql<number>`coalesce(sum(case when displayed = 1 then 1 else 0 end), 0)`,
    })
    .from(galleryItems);
  const bangumiAgg = await db
    .select({
      total: sql<number>`count(*)`,
      watching: sql<number>`coalesce(sum(case when status = 'watching' then 1 else 0 end), 0)`,
    })
    .from(bangumiShows);
  const galleryCats = await db
    .select({ name: galleryItems.category, count: sql<number>`count(*)` })
    .from(galleryItems)
    .where(eq(galleryItems.displayed, true))
    .groupBy(galleryItems.category)
    .orderBy(desc(sql`count(*)`));
  const mediaAgg = await db
    .select({ total: sql<number>`count(*)` })
    .from(media);

  const lastPostAt = await db
    .select({ at: sql<string | null>`max(updated_at)` })
    .from(posts)
    .where(eq(posts.status, 'published'));
  const lastMomentAt = await db
    .select({ at: sql<string | null>`max(created_at)` })
    .from(moments)
    .where(eq(moments.visibility, 'public'));
  const lastGalleryAt = await db
    .select({ at: sql<string | null>`max(created_at)` })
    .from(galleryItems)
    .where(eq(galleryItems.displayed, true));
  const lastUpdated =
    [lastPostAt[0]?.at, lastMomentAt[0]?.at, lastGalleryAt[0]?.at]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;

  return c.json({
    lastUpdated,
    posts: {
      published: postAgg[0]?.published ?? 0,
      draft: postAgg[0]?.draft ?? 0,
      words: postAgg[0]?.words ?? 0,
    },
    moments: { total: momentAgg[0]?.total ?? 0 },
    gallery: {
      total: galleryAgg[0]?.total ?? 0,
      displayed: galleryAgg[0]?.displayed ?? 0,
      categories: galleryCats,
    },
    bangumi: {
      total: bangumiAgg[0]?.total ?? 0,
      watching: bangumiAgg[0]?.watching ?? 0,
    },
    media: { total: mediaAgg[0]?.total ?? 0 },
    categories: await readCategoryCounts(db),
  });
});

v1.route('/admin', admin);

export default v1;
