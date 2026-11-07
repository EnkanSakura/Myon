import type { MediaCategory, MediaItem } from '@myon/shared';
import { mediaDefaultCategoryIds, mediaUncategorizedId } from '@myon/shared';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  like,
  or,
  sql,
} from 'drizzle-orm';
import { getDb } from './db/client';
import { media, mediaAliases, mediaCategories } from './db/schema';
import type { AppBindings } from './types';

/**
 * 媒体库：文件本身只存 R2，元数据（分类 / 别名 / 文件名等）存 D1。
 *
 * - R2 key 不带分类信息（`uploads/<yyyymm>/<uuid>-<name>`），改分类/别名不改变图片地址。
 * - 分类可自定义（media_categories），图片与分类单归属；未分类用 category_id = NULL。
 * - 别名存 media_aliases，搜索时与文件名、R2 key 一起匹配。
 * - 老 R2 对象没有 D1 行：后台列表请求时做一次 R2 ↔ D1 对齐（补录 / 清理孤儿行）。
 */

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export const ALLOWED_MIME = new Set([
  'image/webp',
  'image/avif',
  'image/svg+xml',
]);

/** R2 列表一次最多返回 1000 个对象；后台媒体库是低频页面，扫描上限留足余量。 */
const MAX_LIST_OBJECTS = 20000;
/** D1 单条语句最多 100 个绑定参数：media 一行 11 列，按 8 行一批插入。 */
const MEDIA_INSERT_CHUNK = 8;
const ALIAS_INSERT_CHUNK = 25;
const ID_DELETE_CHUNK = 90;

/** 媒体数量的缓存时间：首页 /stats 每次渲染都会读，避免每次扫桶。 */
const MEDIA_COUNT_TTL_SECONDS = 300;
const MEDIA_COUNT_KV_KEY = 'media:count';

const META_FILENAME = 'filename';
const META_UPLOADED_AT = 'uploadedAt';

export type MediaErrorCode =
  | 'unsupported_type'
  | 'too_large'
  | 'empty_file'
  | 'invalid_category'
  | 'name_taken';

export class MediaError extends Error {
  code: MediaErrorCode;
  constructor(code: MediaErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const EXTENSION_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
};

function safeName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^\.+/, '')
    .replace(/^-+|-+$/g, '');
  return (cleaned || 'file').slice(-60);
}

/** R2 key 只带上传年月，不带分类信息；换分类时图片 URL 不变。 */
function keyFor(filename: string): string {
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return `uploads/${stamp}/${crypto.randomUUID()}-${safeName(filename)}`;
}

/** R2 对象 key 是唯一身份；后台接口用 base64url 包一层，避免路径里的斜杠。 */
export function encodeMediaId(key: string): string {
  const bytes = new TextEncoder().encode(key);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function decodeMediaId(id: string): string | null {
  try {
    const base64 = id.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function storedFilename(key: string, customMetadata?: Record<string, string>) {
  const stored = customMetadata?.[META_FILENAME];
  if (stored) {
    try {
      return decodeURIComponent(stored);
    } catch {
      return stored;
    }
  }
  return key.split('/').pop() ?? key;
}

function mimeOfObject(object: R2Object): string {
  const declared = object.httpMetadata?.contentType;
  if (declared) return declared;
  const extension = object.key.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_MIME[extension] ?? 'application/octet-stream';
}

/** 老对象按 key 第一段推断分类：gallery/、moments/、about/、posts/。 */
function inferCategoryId(key: string, known: Set<string>): string | null {
  const first = key.split('/')[0] ?? '';
  const mapping: Record<string, string> = {
    posts: mediaDefaultCategoryIds.posts,
    moments: mediaDefaultCategoryIds.moments,
    gallery: mediaDefaultCategoryIds.gallery,
    about: mediaDefaultCategoryIds.about,
  };
  const id = mapping[first] ?? null;
  return id && known.has(id) ? id : null;
}

function toMediaItem(row: {
  id: string;
  r2Key: string;
  filename: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  uploadedAt: string;
  categoryId: string | null;
  categoryName: string | null;
  aliases: string[];
}): MediaItem {
  return {
    id: row.id,
    key: row.r2Key,
    filename: row.filename,
    mime: row.mime,
    size: row.size,
    width: row.width,
    height: row.height,
    createdAt: row.uploadedAt,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    aliases: row.aliases,
  };
}

// ---------------------------------------------------------------------------
// 分类
// ---------------------------------------------------------------------------

export async function listMediaCategories(
  env: AppBindings,
): Promise<MediaCategory[]> {
  const rows = await getDb(env.DB)
    .select({
      id: mediaCategories.id,
      name: mediaCategories.name,
      position: mediaCategories.position,
    })
    .from(mediaCategories)
    .orderBy(asc(mediaCategories.position), asc(mediaCategories.id))
    .all();
  return rows;
}

async function categoryIdSet(env: AppBindings): Promise<Set<string>> {
  const rows = await listMediaCategories(env);
  return new Set(rows.map((row) => row.id));
}

export async function createMediaCategory(
  env: AppBindings,
  name: string,
): Promise<MediaCategory> {
  const db = getDb(env.DB);
  const taken = await db
    .select({ id: mediaCategories.id })
    .from(mediaCategories)
    .where(eq(mediaCategories.name, name))
    .get();
  if (taken) throw new MediaError('name_taken', '已有同名分类');

  const max = await db
    .select({
      value: sql<number>`coalesce(max(${mediaCategories.position}), -1)`,
    })
    .from(mediaCategories)
    .get();
  const position = (max?.value ?? -1) + 1;
  const item: MediaCategory = {
    id: `cat_${crypto.randomUUID()}`,
    name,
    position,
  };
  await db.insert(mediaCategories).values({
    ...item,
    createdAt: new Date().toISOString(),
  });
  return item;
}

export async function updateMediaCategory(
  env: AppBindings,
  id: string,
  patch: { name?: string; position?: number },
): Promise<MediaCategory | null> {
  const db = getDb(env.DB);
  const current = await db
    .select()
    .from(mediaCategories)
    .where(eq(mediaCategories.id, id))
    .get();
  if (!current) return null;

  if (patch.name !== undefined && patch.name !== current.name) {
    const taken = await db
      .select({ id: mediaCategories.id })
      .from(mediaCategories)
      .where(eq(mediaCategories.name, patch.name))
      .get();
    if (taken && taken.id !== id) {
      throw new MediaError('name_taken', '已有同名分类');
    }
  }

  await db
    .update(mediaCategories)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.position !== undefined ? { position: patch.position } : {}),
    })
    .where(eq(mediaCategories.id, id));

  return {
    id,
    name: patch.name ?? current.name,
    position: patch.position ?? current.position,
  };
}

/** 删除分类：图片先退回未分类，再删分类行（显式处理，不依赖 FK 开关）。 */
export async function deleteMediaCategory(
  env: AppBindings,
  id: string,
): Promise<boolean> {
  const db = getDb(env.DB);
  const current = await db
    .select({ id: mediaCategories.id })
    .from(mediaCategories)
    .where(eq(mediaCategories.id, id))
    .get();
  if (!current) return false;

  await db
    .update(media)
    .set({ categoryId: null, updatedAt: new Date().toISOString() })
    .where(eq(media.categoryId, id));
  await db.delete(mediaCategories).where(eq(mediaCategories.id, id));
  return true;
}

// ---------------------------------------------------------------------------
// 媒体列表 / 对齐
// ---------------------------------------------------------------------------

type R2ListResult = { objects: R2Object[]; complete: boolean };

async function listAllObjects(env: AppBindings): Promise<R2ListResult> {
  const objects: R2Object[] = [];
  let cursor: string | undefined;

  do {
    const page = await env.MEDIA.list({
      include: ['customMetadata', 'httpMetadata'],
      cursor,
      limit: 1000,
    });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && objects.length < MAX_LIST_OBJECTS);

  return { objects, complete: !cursor };
}

/**
 * R2 ↔ D1 对齐：
 * - R2 有对象、D1 没行 → 补录（分类按 key 前缀推断，未知归未分类）；
 * - D1 有行、R2 对象不存在 → 删行（别名级联清理）；
 * - R2 扫描被上限截断时不做删除，避免误删未扫描到的对象。
 */
async function reconcileMedia(env: AppBindings): Promise<void> {
  const db = getDb(env.DB);
  const [listed, knownCategories, rows] = await Promise.all([
    listAllObjects(env),
    categoryIdSet(env),
    db.select({ id: media.id, r2Key: media.r2Key }).from(media).all(),
  ]);

  const byKey = new Map(rows.map((row) => [row.r2Key, row.id]));
  const objectKeys = new Set(listed.objects.map((object) => object.key));
  const now = new Date().toISOString();

  const missing = listed.objects.filter((object) => !byKey.has(object.key));
  for (let i = 0; i < missing.length; i += MEDIA_INSERT_CHUNK) {
    const chunk = missing.slice(i, i + MEDIA_INSERT_CHUNK).map((object) => {
      const uploadedAt =
        object.customMetadata?.[META_UPLOADED_AT] ??
        object.uploaded.toISOString();
      return {
        id: encodeMediaId(object.key),
        r2Key: object.key,
        filename: storedFilename(object.key, object.customMetadata),
        mime: mimeOfObject(object),
        size: object.size,
        width: null,
        height: null,
        categoryId: inferCategoryId(object.key, knownCategories),
        uploadedAt,
        createdAt: uploadedAt,
        updatedAt: now,
      };
    });
    await db.insert(media).values(chunk).onConflictDoNothing();
  }

  if (!listed.complete) return;
  const orphanIds = rows
    .filter((row) => !objectKeys.has(row.r2Key))
    .map((row) => row.id);
  for (let i = 0; i < orphanIds.length; i += ID_DELETE_CHUNK) {
    await db
      .delete(media)
      .where(inArray(media.id, orphanIds.slice(i, i + ID_DELETE_CHUNK)));
  }
}

export type MediaSort = 'added' | 'size' | 'name';

export interface MediaListOptions {
  limit: number;
  offset: number;
  category?: string;
  q?: string;
  sort?: MediaSort;
}

export interface MediaListResult {
  items: MediaItem[];
  total: number;
  /** 关键词过滤后、分类过滤前的各分类数量；未分类用 uncategorizedCount 单独给。 */
  categories: Array<MediaCategory & { count: number }>;
  uncategorizedCount: number;
}

function itemCondition(q?: string) {
  const keyword = q?.trim();
  if (!keyword) return undefined;
  const pattern = `%${keyword}%`;
  return or(
    like(media.filename, pattern),
    like(media.r2Key, pattern),
    sql`exists (select 1 from ${mediaAliases} where ${mediaAliases.mediaId} = ${media.id} and ${mediaAliases.alias} like ${pattern})`,
  );
}

async function aliasesFor(
  env: AppBindings,
  mediaIds: string[],
): Promise<Map<string, string[]>> {
  const grouped = new Map<string, string[]>();
  if (mediaIds.length === 0) return grouped;

  const db = getDb(env.DB);
  for (let i = 0; i < mediaIds.length; i += ID_DELETE_CHUNK) {
    const rows = await db
      .select({ mediaId: mediaAliases.mediaId, alias: mediaAliases.alias })
      .from(mediaAliases)
      .where(
        inArray(mediaAliases.mediaId, mediaIds.slice(i, i + ID_DELETE_CHUNK)),
      )
      .all();
    for (const row of rows) {
      const list = grouped.get(row.mediaId) ?? [];
      list.push(row.alias);
      grouped.set(row.mediaId, list);
    }
  }
  return grouped;
}

/** 后台媒体库：全库分类/关键词筛选 + 排序 + 分页。 */
export async function listMedia(
  env: AppBindings,
  options: MediaListOptions,
): Promise<MediaListResult> {
  await reconcileMedia(env);

  const db = getDb(env.DB);
  const keyword = options.q?.trim();
  const conditions = [];
  const queryCondition = itemCondition(keyword);
  if (queryCondition) conditions.push(queryCondition);

  const categoryCondition =
    options.category && options.category !== mediaUncategorizedId
      ? eq(media.categoryId, options.category)
      : options.category === mediaUncategorizedId
        ? isNull(media.categoryId)
        : undefined;
  const where = conditions.length
    ? and(
        ...(categoryCondition
          ? [...conditions, categoryCondition]
          : conditions),
      )
    : categoryCondition;

  const totalRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(media)
    .where(where)
    .get();

  const orderBy =
    options.sort === 'size'
      ? [desc(media.size), asc(media.id)]
      : options.sort === 'name'
        ? [asc(media.filename), asc(media.id)]
        : [desc(media.uploadedAt), asc(media.id)];

  const rows = await db
    .select({
      id: media.id,
      r2Key: media.r2Key,
      filename: media.filename,
      mime: media.mime,
      size: media.size,
      width: media.width,
      height: media.height,
      uploadedAt: media.uploadedAt,
      categoryId: media.categoryId,
      categoryName: mediaCategories.name,
    })
    .from(media)
    .leftJoin(mediaCategories, eq(media.categoryId, mediaCategories.id))
    .where(where)
    .orderBy(...orderBy)
    .limit(options.limit)
    .offset(options.offset)
    .all();

  const aliases = await aliasesFor(
    env,
    rows.map((row) => row.id),
  );

  // 分类计数：只应用关键词，不应用分类过滤（用于 chips 显示各分类数量）。
  const countWhere = queryCondition ?? undefined;
  const countRows = await db
    .select({
      categoryId: media.categoryId,
      count: sql<number>`count(*)`,
    })
    .from(media)
    .where(countWhere)
    .groupBy(media.categoryId)
    .all();
  const countByCategory = new Map<string, number>();
  let uncategorizedCount = 0;
  for (const row of countRows) {
    if (row.categoryId) countByCategory.set(row.categoryId, row.count);
    else uncategorizedCount = row.count;
  }
  const categories = (await listMediaCategories(env)).map((category) => ({
    ...category,
    count: countByCategory.get(category.id) ?? 0,
  }));

  return {
    items: rows.map((row) =>
      toMediaItem({ ...row, aliases: aliases.get(row.id) ?? [] }),
    ),
    total: totalRow?.count ?? 0,
    categories,
    uncategorizedCount,
  };
}

// ---------------------------------------------------------------------------
// 上传 / 修改 / 删除
// ---------------------------------------------------------------------------

export async function storeMedia(
  env: AppBindings,
  file: File,
  categoryId?: string | null,
): Promise<MediaItem> {
  if (!file || file.size === 0) {
    throw new MediaError('empty_file', '文件为空');
  }
  if (!ALLOWED_MIME.has(file.type)) {
    throw new MediaError(
      'unsupported_type',
      `不支持的图片类型：${file.type || '未知'}`,
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new MediaError('too_large', '图片超过 8MB');
  }

  const db = getDb(env.DB);
  // 上传时分类可能刚好被删掉：不报错，直接落未分类（选择器不会因此失败）。
  let category: string | null = null;
  let categoryName: string | null = null;
  if (categoryId) {
    const exists = await db
      .select({ id: mediaCategories.id, name: mediaCategories.name })
      .from(mediaCategories)
      .where(eq(mediaCategories.id, categoryId))
      .get();
    if (exists) {
      category = exists.id;
      categoryName = exists.name;
    }
  }

  const key = keyFor(file.name || 'image');
  const uploadedAt = new Date().toISOString();
  await env.MEDIA.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
    customMetadata: {
      [META_FILENAME]: encodeURIComponent(file.name || key),
      [META_UPLOADED_AT]: uploadedAt,
    },
  });

  try {
    await db.insert(media).values({
      id: encodeMediaId(key),
      r2Key: key,
      filename: file.name || key,
      mime: file.type,
      size: file.size,
      width: null,
      height: null,
      categoryId: category,
      uploadedAt,
      createdAt: uploadedAt,
      updatedAt: uploadedAt,
    });
  } catch (error) {
    // D1 写入失败时别留下无主文件。
    await env.MEDIA.delete(key).catch(() => undefined);
    throw error;
  }
  await invalidateMediaCount(env);

  return toMediaItem({
    id: encodeMediaId(key),
    r2Key: key,
    filename: file.name || key,
    mime: file.type,
    size: file.size,
    width: null,
    height: null,
    uploadedAt,
    categoryId: category,
    categoryName,
    aliases: [],
  });
}

async function getItem(
  env: AppBindings,
  id: string,
): Promise<MediaItem | null> {
  const row = await getDb(env.DB)
    .select({
      id: media.id,
      r2Key: media.r2Key,
      filename: media.filename,
      mime: media.mime,
      size: media.size,
      width: media.width,
      height: media.height,
      uploadedAt: media.uploadedAt,
      categoryId: media.categoryId,
      categoryName: mediaCategories.name,
    })
    .from(media)
    .leftJoin(mediaCategories, eq(media.categoryId, mediaCategories.id))
    .where(eq(media.id, id))
    .get();
  if (!row) return null;
  const aliases = await aliasesFor(env, [row.id]);
  return toMediaItem({ ...row, aliases: aliases.get(row.id) ?? [] });
}

export async function updateMediaMeta(
  env: AppBindings,
  id: string,
  patch: { categoryId?: string | null; aliases?: string[] },
): Promise<MediaItem | null> {
  const db = getDb(env.DB);
  const current = await db
    .select({ id: media.id })
    .from(media)
    .where(eq(media.id, id))
    .get();
  if (!current) return null;

  let categoryId: string | null | undefined;
  if (patch.categoryId !== undefined) {
    categoryId = patch.categoryId;
    if (categoryId) {
      const exists = await db
        .select({ id: mediaCategories.id })
        .from(mediaCategories)
        .where(eq(mediaCategories.id, categoryId))
        .get();
      if (!exists) {
        throw new MediaError('invalid_category', '分类不存在');
      }
    }
  }

  await db
    .update(media)
    .set({
      ...(categoryId !== undefined ? { categoryId } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(media.id, id));

  if (patch.aliases) {
    await db.delete(mediaAliases).where(eq(mediaAliases.mediaId, id));
    for (let i = 0; i < patch.aliases.length; i += ALIAS_INSERT_CHUNK) {
      await db
        .insert(mediaAliases)
        .values(
          patch.aliases
            .slice(i, i + ALIAS_INSERT_CHUNK)
            .map((alias) => ({ mediaId: id, alias })),
        );
    }
  }

  return getItem(env, id);
}

export async function deleteMedia(
  env: AppBindings,
  id: string,
): Promise<boolean> {
  const db = getDb(env.DB);
  const current = await db
    .select({ id: media.id, r2Key: media.r2Key })
    .from(media)
    .where(eq(media.id, id))
    .get();
  if (!current) return false;

  // 先删 R2：失败就直接报错、保留 D1 行；R2 成功后 D1 即使失败，
  // 下一次列表对齐也会把孤儿行清掉。
  await env.MEDIA.delete(current.r2Key);
  await db.delete(mediaAliases).where(eq(mediaAliases.mediaId, id));
  await db.delete(media).where(eq(media.id, id));
  await invalidateMediaCount(env);
  return true;
}

// ---------------------------------------------------------------------------
// 数量缓存（保持 R2 口径）
// ---------------------------------------------------------------------------

async function invalidateMediaCount(env: AppBindings): Promise<void> {
  try {
    await env.SETTINGS.delete(MEDIA_COUNT_KV_KEY);
  } catch (error) {
    // 缓存失败不影响上传/删除本身。
    console.error('media count cache invalidate failed', error);
  }
}

export async function readMediaCount(env: AppBindings): Promise<number> {
  try {
    const cached = await env.SETTINGS.get(MEDIA_COUNT_KV_KEY);
    if (cached !== null && Number.isInteger(Number(cached))) {
      return Math.max(0, Number(cached));
    }
  } catch (error) {
    console.error('media count cache read failed', error);
  }

  const { objects } = await listAllObjects(env);
  const total = objects.length;
  try {
    await env.SETTINGS.put(MEDIA_COUNT_KV_KEY, String(total), {
      expirationTtl: MEDIA_COUNT_TTL_SECONDS,
    });
  } catch (error) {
    console.error('media count cache write failed', error);
  }
  return total;
}
