import {
  aboutKey,
  type BangumiStatus,
  type BangumiSubjectType,
  bangumiSubjectTypes,
  isIconifyIconName,
  paginationSchema,
  toPublicSiteSettings,
} from '@myon/shared';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { isBangumiSubjectType } from '../bangumi';
import { getDb } from '../db/client';
import {
  bangumiShows,
  galleryItems,
  moments,
  posts,
  siteContent,
  tools,
} from '../db/schema';
import { MAX_ICONS, resolveIconSvgs } from '../icons';
import {
  BANGUMI_COVER_CACHE_SECONDS,
  isBangumiCoverContentType,
  MAX_BANGUMI_COVER_BYTES,
  normalizeBangumiCoverUrl,
} from '../image';
import { renderArticle, renderMarkdown } from '../markdown';
import { readMediaCount } from '../media';
import { readSiteSettings, sanitizeFooterHtml } from '../site';
import { readTraffic } from '../traffic';
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
  const settings = await readSiteSettings(c.env.SETTINGS);
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

/** 前台工具页：只返回启用中的工具，按后台排序。 */
v1.get('/tools', async (c) => {
  const db = getDb(c.env.DB);
  const items = await db
    .select()
    .from(tools)
    .where(eq(tools.enabled, true))
    .orderBy(asc(tools.position), asc(tools.id));
  return c.json({ items });
});

/** 后台总览用：最近 30 天访问量（只读、不缓存）。 */
v1.get('/traffic', async (c) => {
  const traffic = await readTraffic(c.env.DB);
  return c.json(traffic, 200, { 'Cache-Control': 'no-store' });
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

/**
 * Bangumi 封面代理：浏览器只访问本站，不直接连 lain.bgm.tv。
 * 命中 Cloudflare 边缘缓存时直接返回；未命中才回源，回源后缓存一年。
 */
v1.get('/bangumi/cover', async (c) => {
  const target = normalizeBangumiCoverUrl(c.req.query('src'));
  if (!target) {
    return c.json({ error: 'invalid_cover_url' }, 400);
  }

  const cache =
    typeof caches !== 'undefined'
      ? ((caches as unknown as { default?: Cache }).default ?? null)
      : null;
  const cacheKey = new Request(c.req.url, { method: 'GET' });
  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) {
        // Cache API 返回的 Response 头是不可变的，而 secureHeaders() 中间件会在
        // 响应上补安全头；直接原样返回会抛 "Can't modify immutable headers"
        // （接口变成 500，还会带着一年的缓存头被边缘缓存），这里复制成可变响应。
        return new Response(hit.body, {
          status: hit.status,
          statusText: hit.statusText,
          headers: new Headers(hit.headers),
        });
      }
    } catch (error) {
      console.error('[bangumi-cover] cache read failed', error);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const upstream = await fetch(target, {
      headers: {
        accept: 'image/avif,image/webp,image/png,image/jpeg,image/*',
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        referer: 'https://bgm.tv/',
      },
      signal: controller.signal,
    });
    if (!upstream.ok) {
      return c.json({ error: `cover_upstream_${upstream.status}` }, 502);
    }

    const declaredLength = Number(upstream.headers.get('content-length') ?? 0);
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_BANGUMI_COVER_BYTES
    ) {
      return c.json({ error: 'cover_too_large' }, 413);
    }

    const contentType = upstream.headers.get('content-type');
    if (!isBangumiCoverContentType(contentType)) {
      return c.json({ error: 'invalid_cover_content_type' }, 502);
    }

    const body = await upstream.arrayBuffer();
    if (body.byteLength > MAX_BANGUMI_COVER_BYTES) {
      return c.json({ error: 'cover_too_large' }, 413);
    }

    const response = new Response(body, {
      status: 200,
      headers: {
        'content-type': contentType || 'image/jpeg',
        'cache-control': `public, max-age=${BANGUMI_COVER_CACHE_SECONDS}, immutable`,
        'access-control-allow-origin': '*',
      },
    });

    if (cache) {
      try {
        await cache.put(cacheKey, response.clone());
      } catch (error) {
        // 缓存写入失败不影响本次返回，下次请求会重新回源。
        console.error('[bangumi-cover] cache write failed', error);
      }
    }
    return response;
  } catch (error) {
    console.error('[bangumi-cover] upstream fetch failed', target, error);
    return c.json({ error: 'cover_fetch_failed' }, 502);
  } finally {
    clearTimeout(timer);
  }
});

v1.get('/bangumi', async (c) => {
  const db = getDb(c.env.DB);
  const { limit, offset } = paginationSchema.parse(c.req.query());

  // ?type= 非法时明确报错，避免把「筛选失败」误当成「没有收藏」。
  const type = c.req.query('type');
  if (type && !isBangumiSubjectType(type)) {
    return c.json({ error: 'invalid_subject_type' }, 400);
  }
  const where = type ? eq(bangumiShows.subjectType, type) : undefined;

  // 默认仍按「在追优先 + 下次放送」排序；?sort=recent 改成最近更新优先。
  const orderBy =
    c.req.query('sort') === 'recent'
      ? [desc(bangumiShows.updatedAt), asc(bangumiShows.title)]
      : [
          sql`case when status = 'watching' then 0 else 1 end`,
          asc(bangumiShows.nextAirAt),
        ];

  const rows = await db
    .select()
    .from(bangumiShows)
    .where(where)
    .orderBy(...orderBy)
    .limit(limit)
    .offset(offset);
  const totalRows = await db
    .select({ total: sql<number>`count(*)` })
    .from(bangumiShows)
    .where(where);

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
      subjectType: bangumiShows.subjectType,
      status: bangumiShows.status,
      count: sql<number>`count(*)`,
    })
    .from(bangumiShows)
    .groupBy(bangumiShows.subjectType, bangumiShows.status);
  const galleryCats = await db
    .select({ name: galleryItems.category, count: sql<number>`count(*)` })
    .from(galleryItems)
    .where(eq(galleryItems.displayed, true))
    .groupBy(galleryItems.category)
    .orderBy(desc(sql`count(*)`));
  const toolAgg = await db
    .select({
      total: sql<number>`count(*)`,
      enabled: sql<number>`coalesce(sum(case when enabled = 1 then 1 else 0 end), 0)`,
    })
    .from(tools);
  const mediaTotal = await readMediaCount(c.env);

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

  // 追番统计是全量聚合：按「类型 × 状态」扫一遍，不再只算第一页。
  const bangumiByType = Object.fromEntries(
    bangumiSubjectTypes.map((subjectType) => [
      subjectType,
      { total: 0, watching: 0 },
    ]),
  ) as Record<BangumiSubjectType, { total: number; watching: number }>;
  const bangumiByStatus: Record<BangumiStatus, number> = {
    watching: 0,
    watched: 0,
    wish: 0,
    paused: 0,
  };
  let bangumiTotal = 0;
  let bangumiWatching = 0;
  for (const row of bangumiAgg) {
    const count = Number(row.count) || 0;
    bangumiTotal += count;
    if (row.status === 'watching') bangumiWatching += count;
    const typeSummary = bangumiByType[row.subjectType as BangumiSubjectType];
    if (typeSummary) {
      typeSummary.total += count;
      if (row.status === 'watching') typeSummary.watching += count;
    }
    if (row.status in bangumiByStatus) {
      bangumiByStatus[row.status as BangumiStatus] += count;
    }
  }

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
      total: bangumiTotal,
      watching: bangumiWatching,
      byType: bangumiByType,
      byStatus: bangumiByStatus,
    },
    media: { total: mediaTotal },
    tools: {
      total: toolAgg[0]?.total ?? 0,
      enabled: toolAgg[0]?.enabled ?? 0,
    },
    categories: await readCategoryCounts(db),
  });
});

v1.route('/admin', admin);

export default v1;
