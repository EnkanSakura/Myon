import type { MediaItem } from '@myon/shared';
import type { AppBindings } from './types';

/**
 * 媒体库以 R2 为唯一数据源：对象列表、大小、类型都直接来自桶本身，
 * 上传的文件名写在对象 customMetadata 里，D1 不再保留 media 表。
 */

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export const ALLOWED_MIME = new Set([
  'image/webp',
  'image/avif',
  'image/svg+xml',
]);

/** R2 列表一次最多返回 1000 个对象；后台媒体库是低频页面，扫描上限留足余量。 */
const MAX_LIST_OBJECTS = 20000;
/** 媒体数量的缓存时间：首页 /stats 每次渲染都会读，避免每次扫桶。 */
const MEDIA_COUNT_TTL_SECONDS = 300;
const MEDIA_COUNT_KV_KEY = 'media:count';

export type MediaErrorCode = 'unsupported_type' | 'too_large' | 'empty_file';

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

function filenameOf(key: string, customMetadata?: Record<string, string>) {
  const stored = customMetadata?.filename;
  if (stored) {
    try {
      return decodeURIComponent(stored);
    } catch {
      return stored;
    }
  }
  return key.split('/').pop() ?? key;
}

function mimeOf(object: R2Object): string {
  const declared = object.httpMetadata?.contentType;
  if (declared) return declared;
  const extension = object.key.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_MIME[extension] ?? 'application/octet-stream';
}

function toMediaItem(object: R2Object): MediaItem {
  return {
    id: encodeMediaId(object.key),
    key: object.key,
    filename: filenameOf(object.key, object.customMetadata),
    mime: mimeOf(object),
    size: object.size,
    width: null,
    height: null,
    createdAt: object.uploaded.toISOString(),
  };
}

/** 上传图片到 R2；文件名、上传时间写进 customMetadata，供媒体库回读。 */
export async function storeMedia(
  env: AppBindings,
  file: File,
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

  const key = keyFor(file.name || 'image');
  const uploadedAt = new Date().toISOString();
  await env.MEDIA.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
    customMetadata: {
      filename: encodeURIComponent(file.name || key),
      uploadedAt,
    },
  });
  await invalidateMediaCount(env);

  return {
    id: encodeMediaId(key),
    key,
    filename: file.name || key,
    mime: file.type,
    size: file.size,
    width: null,
    height: null,
    createdAt: uploadedAt,
  };
}

/** 列出 R2 里的全部对象（按上传时间倒序由调用方排序）。 */
async function listAllObjects(env: AppBindings): Promise<R2Object[]> {
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

  return objects;
}

/** 后台媒体库分页：按最近上传 → 名称排序后切片。 */
export async function listMedia(
  env: AppBindings,
  limit: number,
  offset: number,
): Promise<{ items: MediaItem[]; total: number }> {
  const objects = await listAllObjects(env);
  const items = objects.map(toMediaItem).sort((a, b) => {
    const byTime = b.createdAt.localeCompare(a.createdAt);
    return byTime === 0 ? a.key.localeCompare(b.key) : byTime;
  });
  return { items: items.slice(offset, offset + limit), total: items.length };
}

export async function deleteMedia(
  env: AppBindings,
  id: string,
): Promise<boolean> {
  const key = decodeMediaId(id);
  if (!key) return false;

  const existing = await env.MEDIA.head(key);
  if (!existing) return false;

  await env.MEDIA.delete(key);
  await invalidateMediaCount(env);
  return true;
}

/** 清掉媒体数量缓存；下一次 /stats 会重新扫桶。 */
async function invalidateMediaCount(env: AppBindings): Promise<void> {
  try {
    await env.SETTINGS.delete(MEDIA_COUNT_KV_KEY);
  } catch (error) {
    // 缓存失败不影响上传/删除本身。
    console.error('media count cache invalidate failed', error);
  }
}

/** 媒体总数：优先读 KV 缓存，缺失时扫 R2 后回填。 */
export async function readMediaCount(env: AppBindings): Promise<number> {
  try {
    const cached = await env.SETTINGS.get(MEDIA_COUNT_KV_KEY);
    if (cached !== null && Number.isInteger(Number(cached))) {
      return Math.max(0, Number(cached));
    }
  } catch (error) {
    console.error('media count cache read failed', error);
  }

  const total = (await listAllObjects(env)).length;
  try {
    await env.SETTINGS.put(MEDIA_COUNT_KV_KEY, String(total), {
      expirationTtl: MEDIA_COUNT_TTL_SECONDS,
    });
  } catch (error) {
    console.error('media count cache write failed', error);
  }
  return total;
}
