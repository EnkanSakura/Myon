import {
  bangumiInputSchema,
  bangumiPatchSchema,
  galleryInputSchema,
  galleryPatchSchema,
  momentInputSchema,
  momentPatchSchema,
  paginationSchema,
  postInputSchema,
  postPatchSchema,
  siteSettingsPatchSchema,
} from '@myon/shared';
import { desc, eq, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { requireAdmin } from '../../auth';
import { syncBangumi } from '../../bangumi';
import { getDb } from '../../db/client';
import { bangumiShows, galleryItems, moments, posts } from '../../db/schema';
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
  const settings = await readSiteSettings(c.env.DB);
  return c.json({ settings });
});

admin.put('/settings', async (c) => {
  const payload = await readJson(c);
  if (payload === undefined) return c.json({ error: 'invalid_json' }, 400);

  const parsed = siteSettingsPatchSchema.safeParse(payload);
  if (!parsed.success) return validationError(c, parsed.error);

  const settings = await writeSiteSettings(c.env.DB, parsed.data);
  return c.json({ settings });
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

admin.get('/bangumi', async (c) => {
  const db = getDb(c.env.DB);
  const items = await db
    .select()
    .from(bangumiShows)
    .orderBy(bangumiShows.title);
  return c.json({ items });
});

admin.post('/bangumi', async (c) => {
  const payload = await readJson(c);
  if (payload === undefined) return c.json({ error: 'invalid_json' }, 400);

  const parsed = bangumiInputSchema.safeParse(payload);
  if (!parsed.success) return validationError(c, parsed.error);
  const input = parsed.data;

  const item = {
    id: input.bangumiId ? `bg_${input.bangumiId}` : `bg_${crypto.randomUUID()}`,
    bangumiId: input.bangumiId ?? null,
    title: input.title,
    status: input.status,
    totalEps: input.totalEps,
    watchedEps: input.watchedEps,
    score: input.score ?? null,
    nextAirAt: input.nextAirAt ?? null,
    coverKey: input.coverKey ?? null,
    updatedAt: new Date().toISOString(),
  };

  await getDb(c.env.DB).insert(bangumiShows).values(item);
  return c.json({ item }, 201);
});

admin.patch('/bangumi/:id', async (c) => {
  const payload = await readJson(c);
  if (payload === undefined) return c.json({ error: 'invalid_json' }, 400);

  const parsed = bangumiPatchSchema.safeParse(payload);
  if (!parsed.success) return validationError(c, parsed.error);

  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const current = await db
    .select()
    .from(bangumiShows)
    .where(eq(bangumiShows.id, id))
    .get();
  if (!current) return c.json({ error: 'not_found' }, 404);
  if (Object.keys(parsed.data).length === 0) return c.json({ item: current });

  const next = {
    ...current,
    ...parsed.data,
    updatedAt: new Date().toISOString(),
  };
  await db
    .update(bangumiShows)
    .set({ ...parsed.data, updatedAt: next.updatedAt })
    .where(eq(bangumiShows.id, id));
  return c.json({ item: next });
});

admin.delete('/bangumi/:id', async (c) => {
  const db = getDb(c.env.DB);
  await db.delete(bangumiShows).where(eq(bangumiShows.id, c.req.param('id')));
  return c.json({ ok: true });
});

/** 手动触发一次 Bangumi 同步；未配置令牌时返回 skipped。 */
admin.post('/bangumi/sync', async (c) => {
  const result = await syncBangumi(c.env);
  return c.json(result, result.ok ? 200 : 502);
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

export default admin;
