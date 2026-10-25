import {
  aboutKey,
  aboutPatchSchema,
  galleryInputSchema,
  galleryPatchSchema,
  momentInputSchema,
  momentPatchSchema,
  paginationSchema,
  postInputSchema,
  postPatchSchema,
  siteSettingsPatchSchema,
  toolInputSchema,
  toolPatchSchema,
} from '@myon/shared';
import { asc, desc, eq, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { requireAdmin } from '../../auth';
import { syncBangumi } from '../../bangumi';
import { getDb } from '../../db/client';
import {
  galleryItems,
  moments,
  posts,
  siteContent,
  tools,
} from '../../db/schema';
import { renderMarkdown } from '../../markdown';
import { deleteMedia, listMedia, MediaError, storeMedia } from '../../media';
import { readSiteSettings, writeSiteSettings } from '../../site';
import type { AppBindings } from '../../types';

/** 后台接口：挂在 /api/v1/admin 下，整组需要管理员身份。 */
const admin = new Hono<{ Bindings: AppBindings }>();

admin.use('*', requireAdmin);

type Ctx = Context<{ Bindings: AppBindings }>;

async function readJson(c: Ctx): Promise<unknown | undefined> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

function validationError(
  c: Ctx,
  error: { issues: Array<{ path: PropertyKey[]; message: string }> },
) {
  return c.json(
    {
      error: 'validation_failed',
      issues: error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    },
    400,
  );
}

function estimateReadingMinutes(markdown: string): number {
  const chars = markdown.replace(/\s/g, '').length;
  return Math.max(1, Math.min(999, Math.ceil(chars / 400)));
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

admin.get('/settings', async (c) => {
  const settings = await readSiteSettings(c.env.SETTINGS);
  return c.json({ settings });
});

admin.put('/settings', async (c) => {
  const payload = await readJson(c);
  if (payload === undefined) return c.json({ error: 'invalid_json' }, 400);

  const parsed = siteSettingsPatchSchema.safeParse(payload);
  if (!parsed.success) return validationError(c, parsed.error);

  const settings = await writeSiteSettings(c.env.SETTINGS, parsed.data);
  return c.json({ settings });
});

// ---------------------------------------------------------------------------
// 关于页
// ---------------------------------------------------------------------------

/** 写入 site_content 的 about 行；GET /api/v1/about 的读取逻辑不变。 */
admin.put('/about', async (c) => {
  const payload = await readJson(c);
  if (payload === undefined) return c.json({ error: 'invalid_json' }, 400);

  const parsed = aboutPatchSchema.safeParse(payload);
  if (!parsed.success) return validationError(c, parsed.error);

  const updatedAt = new Date().toISOString();
  const db = getDb(c.env.DB);
  await db
    .insert(siteContent)
    .values({ key: aboutKey, markdown: parsed.data.markdown, updatedAt })
    .onConflictDoUpdate({
      target: siteContent.key,
      set: { markdown: parsed.data.markdown, updatedAt },
    });

  return c.json({
    item: {
      key: aboutKey,
      markdown: parsed.data.markdown,
      html: renderMarkdown(parsed.data.markdown),
      updatedAt,
    },
  });
});

// ---------------------------------------------------------------------------
// 文章
// ---------------------------------------------------------------------------

admin.get('/posts', async (c) => {
  const { limit, offset } = paginationSchema.parse(c.req.query());
  const db = getDb(c.env.DB);
  const items = await db
    .select()
    .from(posts)
    .orderBy(desc(posts.updatedAt))
    .limit(limit)
    .offset(offset);
  const totalRows = await db
    .select({ total: sql<number>`count(*)` })
    .from(posts);

  return c.json({ items, total: totalRows[0]?.total ?? 0, limit, offset });
});

admin.get('/posts/:id', async (c) => {
  const db = getDb(c.env.DB);
  const item = await db
    .select()
    .from(posts)
    .where(eq(posts.id, c.req.param('id')))
    .get();
  if (!item) return c.json({ error: 'not_found' }, 404);
  return c.json({ item });
});

admin.post('/posts', async (c) => {
  const payload = await readJson(c);
  if (payload === undefined) return c.json({ error: 'invalid_json' }, 400);

  const parsed = postInputSchema.safeParse(payload);
  if (!parsed.success) return validationError(c, parsed.error);
  const input = parsed.data;

  const db = getDb(c.env.DB);
  const taken = await db
    .select({ id: posts.id })
    .from(posts)
    .where(eq(posts.slug, input.slug))
    .get();
  if (taken) return c.json({ error: 'slug_taken' }, 409);

  const now = new Date().toISOString();
  const item = {
    id: `p_${crypto.randomUUID()}`,
    slug: input.slug,
    title: input.title,
    excerpt: input.excerpt,
    bodyMd: input.bodyMd,
    status: input.status,
    category: input.category,
    coverKey: input.coverKey ?? null,
    readingMinutes:
      input.readingMinutes ?? estimateReadingMinutes(input.bodyMd),
    publishedAt:
      input.status === 'published'
        ? (input.publishedAt ?? now)
        : (input.publishedAt ?? null),
    updatedAt: now,
    createdAt: now,
  };

  await db.insert(posts).values(item);
  return c.json({ item }, 201);
});

admin.patch('/posts/:id', async (c) => {
  const payload = await readJson(c);
  if (payload === undefined) return c.json({ error: 'invalid_json' }, 400);

  const parsed = postPatchSchema.safeParse(payload);
  if (!parsed.success) return validationError(c, parsed.error);

  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const current = await db.select().from(posts).where(eq(posts.id, id)).get();
  if (!current) return c.json({ error: 'not_found' }, 404);
  if (Object.keys(parsed.data).length === 0) return c.json({ item: current });

  const now = new Date().toISOString();
  const next = { ...current, ...parsed.data, updatedAt: now };

  if (
    parsed.data.bodyMd !== undefined &&
    parsed.data.readingMinutes === undefined
  ) {
    next.readingMinutes = estimateReadingMinutes(parsed.data.bodyMd);
  }
  if (next.status === 'published' && !next.publishedAt) next.publishedAt = now;

  await db
    .update(posts)
    .set({
      slug: next.slug,
      title: next.title,
      excerpt: next.excerpt,
      bodyMd: next.bodyMd,
      status: next.status,
      category: next.category,
      coverKey: next.coverKey,
      readingMinutes: next.readingMinutes,
      publishedAt: next.publishedAt,
      updatedAt: now,
    })
    .where(eq(posts.id, id));

  return c.json({ item: next });
});

admin.delete('/posts/:id', async (c) => {
  const db = getDb(c.env.DB);
  await db.delete(posts).where(eq(posts.id, c.req.param('id')));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// 动态
// ---------------------------------------------------------------------------

admin.get('/moments', async (c) => {
  const { limit, offset } = paginationSchema.parse(c.req.query());
  const db = getDb(c.env.DB);
  const items = await db
    .select()
    .from(moments)
    .orderBy(desc(moments.pinned), desc(moments.createdAt))
    .limit(limit)
    .offset(offset);
  const totalRows = await db
    .select({ total: sql<number>`count(*)` })
    .from(moments);

  return c.json({ items, total: totalRows[0]?.total ?? 0, limit, offset });
});

admin.post('/moments', async (c) => {
  const payload = await readJson(c);
  if (payload === undefined) return c.json({ error: 'invalid_json' }, 400);

  const parsed = momentInputSchema.safeParse(payload);
  if (!parsed.success) return validationError(c, parsed.error);
  const input = parsed.data;

  const item = {
    id: `m_${crypto.randomUUID()}`,
    body: input.body,
    category: input.category,
    tag: input.tag ?? null,
    visibility: input.visibility,
    pinned: input.pinned,
    mediaKey: input.mediaKey ?? null,
    createdAt: new Date().toISOString(),
  };

  await getDb(c.env.DB).insert(moments).values(item);
  return c.json({ item }, 201);
});

admin.patch('/moments/:id', async (c) => {
  const payload = await readJson(c);
  if (payload === undefined) return c.json({ error: 'invalid_json' }, 400);

  const parsed = momentPatchSchema.safeParse(payload);
  if (!parsed.success) return validationError(c, parsed.error);

  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const current = await db
    .select()
    .from(moments)
    .where(eq(moments.id, id))
    .get();
  if (!current) return c.json({ error: 'not_found' }, 404);
  if (Object.keys(parsed.data).length === 0) return c.json({ item: current });

  const next = { ...current, ...parsed.data };
  await db.update(moments).set(parsed.data).where(eq(moments.id, id));
  return c.json({ item: next });
});

admin.delete('/moments/:id', async (c) => {
  const db = getDb(c.env.DB);
  await db.delete(moments).where(eq(moments.id, c.req.param('id')));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// 展柜
// ---------------------------------------------------------------------------

admin.get('/gallery', async (c) => {
  const { limit, offset } = paginationSchema.parse(c.req.query());
  const db = getDb(c.env.DB);
  const items = await db
    .select()
    .from(galleryItems)
    .orderBy(galleryItems.position)
    .limit(limit)
    .offset(offset);
  const totalRows = await db
    .select({ total: sql<number>`count(*)` })
    .from(galleryItems);

  return c.json({ items, total: totalRows[0]?.total ?? 0, limit, offset });
});

admin.post('/gallery', async (c) => {
  const payload = await readJson(c);
  if (payload === undefined) return c.json({ error: 'invalid_json' }, 400);

  const parsed = galleryInputSchema.safeParse(payload);
  if (!parsed.success) return validationError(c, parsed.error);
  const input = parsed.data;

  const taken = await getDb(c.env.DB)
    .select({ id: galleryItems.id })
    .from(galleryItems)
    .where(eq(galleryItems.no, input.no))
    .get();
  if (taken) return c.json({ error: 'no_taken' }, 409);

  const item = {
    id: crypto.randomUUID(),
    no: input.no,
    name: input.name,
    category: input.category,
    era: input.era ?? null,
    note: input.note ?? null,
    mediaKey: input.mediaKey ?? null,
    displayed: input.displayed,
    position: input.position,
    createdAt: new Date().toISOString(),
  };

  await getDb(c.env.DB).insert(galleryItems).values(item);
  return c.json({ item }, 201);
});

admin.patch('/gallery/:id', async (c) => {
  const payload = await readJson(c);
  if (payload === undefined) return c.json({ error: 'invalid_json' }, 400);

  const parsed = galleryPatchSchema.safeParse(payload);
  if (!parsed.success) return validationError(c, parsed.error);

  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const current = await db
    .select()
    .from(galleryItems)
    .where(eq(galleryItems.id, id))
    .get();
  if (!current) return c.json({ error: 'not_found' }, 404);
  if (Object.keys(parsed.data).length === 0) return c.json({ item: current });

  const next = { ...current, ...parsed.data };
  await db.update(galleryItems).set(parsed.data).where(eq(galleryItems.id, id));
  return c.json({ item: next });
});

admin.delete('/gallery/:id', async (c) => {
  const db = getDb(c.env.DB);
  await db.delete(galleryItems).where(eq(galleryItems.id, c.req.param('id')));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// 追番
// ---------------------------------------------------------------------------

// 后台追番只读；条目由 Bangumi 同步维护，不再提供编辑/删除 API。

/** 手动触发一次 Bangumi 同步；未配置令牌时返回 skipped。 */
/** 手动触发一次 Bangumi 同步；未配置令牌时返回 skipped。 */
admin.post('/bangumi/sync', async (c) => {
  const result = await syncBangumi(c.env);
  return c.json(result, result.ok ? 200 : 502);
});

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

admin.get('/tools', async (c) => {
  const db = getDb(c.env.DB);
  const items = await db
    .select()
    .from(tools)
    .orderBy(asc(tools.position), asc(tools.id));
  return c.json({ items, total: items.length });
});

admin.post('/tools', async (c) => {
  const payload = await readJson(c);
  if (payload === undefined) return c.json({ error: 'invalid_json' }, 400);

  const parsed = toolInputSchema.safeParse(payload);
  if (!parsed.success) return validationError(c, parsed.error);
  const input = parsed.data;

  const now = new Date().toISOString();
  const item = {
    id: `tool_${crypto.randomUUID()}`,
    slug: input.slug,
    toolKey: input.toolKey ?? null,
    name: input.name,
    description: input.description,
    kind: input.kind,
    keywords: input.keywords,
    href: input.href ?? null,
    enabled: input.enabled,
    position: input.position,
    createdAt: now,
    updatedAt: now,
  };

  const db = getDb(c.env.DB);
  const taken = await db
    .select({ id: tools.id })
    .from(tools)
    .where(eq(tools.slug, input.slug))
    .get();
  if (taken) return c.json({ error: 'slug_taken' }, 409);

  await db.insert(tools).values(item);
  return c.json({ item }, 201);
});

admin.patch('/tools/:id', async (c) => {
  const payload = await readJson(c);
  if (payload === undefined) return c.json({ error: 'invalid_json' }, 400);

  const parsed = toolPatchSchema.safeParse(payload);
  if (!parsed.success) return validationError(c, parsed.error);

  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const current = await db.select().from(tools).where(eq(tools.id, id)).get();
  if (!current) return c.json({ error: 'not_found' }, 404);
  if (Object.keys(parsed.data).length === 0) return c.json({ item: current });

  if (parsed.data.slug && parsed.data.slug !== current.slug) {
    const taken = await db
      .select({ id: tools.id })
      .from(tools)
      .where(eq(tools.slug, parsed.data.slug))
      .get();
    if (taken) return c.json({ error: 'slug_taken' }, 409);
  }

  const updatedAt = new Date().toISOString();
  await db
    .update(tools)
    .set({ ...parsed.data, updatedAt })
    .where(eq(tools.id, id));
  return c.json({ item: { ...current, ...parsed.data, updatedAt } });
});

admin.delete('/tools/:id', async (c) => {
  const db = getDb(c.env.DB);
  await db.delete(tools).where(eq(tools.id, c.req.param('id')));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// 媒体
// ---------------------------------------------------------------------------

admin.get('/media', async (c) => {
  const { limit, offset } = paginationSchema.parse(c.req.query());
  const { items, total } = await listMedia(c.env, limit, offset);
  return c.json({ items, total, limit, offset });
});

admin.post('/media', async (c) => {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: 'invalid_form' }, 400);
  }

  const file = form.get('file');
  if (!(file instanceof File)) return c.json({ error: 'file_required' }, 400);

  try {
    const item = await storeMedia(c.env, file);
    return c.json({ item }, 201);
  } catch (error) {
    if (error instanceof MediaError) {
      return c.json({ error: error.code, message: error.message }, 400);
    }
    console.error('media upload failed', error);
    return c.json({ error: 'upload_failed' }, 500);
  }
});

admin.delete('/media/:id', async (c) => {
  const removed = await deleteMedia(c.env, c.req.param('id'));
  if (!removed) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GIF → animated WebP（外部服务）
// ---------------------------------------------------------------------------

const GIF_TO_WEBP_URL = 'https://api.myon.top/img2webp';
const MAX_GIF_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_GIF_WEBP_BYTES = 8 * 1024 * 1024;
const GIF_TO_WEBP_TIMEOUT_MS = 30000;

/**
 * 浏览器把 GIF 发到这里，Worker 带 Bearer token 调外部 img2webp，
 * 再把 animated WebP 二进制返回给浏览器；secret 不下发到前端。
 */
admin.post('/media/gif-webp', async (c) => {
  const token = c.env.IMG2WEBP_TOKEN;
  if (!token) {
    return c.json({ error: 'img2webp_not_configured' }, 503);
  }

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: 'invalid_form' }, 400);
  }
  const file = form.get('file');
  if (!(file instanceof File) || file.type !== 'image/gif') {
    return c.json({ error: 'gif_required' }, 400);
  }
  if (file.size > MAX_GIF_SOURCE_BYTES) {
    return c.json({ error: 'gif_too_large' }, 413);
  }

  const upstreamForm = new FormData();
  upstreamForm.append('file', file, file.name || 'image.gif');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GIF_TO_WEBP_TIMEOUT_MS);

  try {
    const response = await fetch(GIF_TO_WEBP_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'image/webp',
      },
      body: upstreamForm,
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error('[media] img2webp failed', response.status);
      return c.json({ error: 'img2webp_failed' }, 502);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType && !/^image\/webp\b/i.test(contentType)) {
      return c.json({ error: 'img2webp_invalid_content_type' }, 502);
    }

    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_GIF_WEBP_BYTES) {
      return c.json({ error: 'gif_webp_too_large' }, 413);
    }

    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'image/webp',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[media] img2webp request failed', error);
    return c.json({ error: 'img2webp_failed' }, 502);
  } finally {
    clearTimeout(timer);
  }
});

export default admin;
