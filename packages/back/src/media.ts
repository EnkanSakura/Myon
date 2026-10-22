import type { MediaItem } from '@myon/shared';
import { desc, eq, sql } from 'drizzle-orm';
import { getDb } from './db/client';
import { media as mediaTable } from './db/schema';
import type { AppBindings } from './types';

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/svg+xml',
]);

export type MediaErrorCode = 'unsupported_type' | 'too_large' | 'empty_file';

export class MediaError extends Error {
  code: MediaErrorCode;
  constructor(code: MediaErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

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

/** 上传图片到 R2 并登记到 media 表。 */
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
  await env.MEDIA.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });

  const record: MediaItem = {
    id: crypto.randomUUID(),
    key,
    filename: file.name || key,
    mime: file.type,
    size: file.size,
    width: null,
    height: null,
    createdAt: new Date().toISOString(),
  };

  await getDb(env.DB).insert(mediaTable).values(record);
  return record;
}

export async function listMedia(
  env: AppBindings,
  limit: number,
  offset: number,
): Promise<{ items: MediaItem[]; total: number }> {
  const db = getDb(env.DB);
  const items = await db
    .select()
    .from(mediaTable)
    .orderBy(desc(mediaTable.createdAt))
    .limit(limit)
    .offset(offset);
  const countRows = await db
    .select({ total: sql<number>`count(*)` })
    .from(mediaTable);
  return { items, total: countRows[0]?.total ?? 0 };
}

export async function deleteMedia(
  env: AppBindings,
  id: string,
): Promise<boolean> {
  const db = getDb(env.DB);
  const row = await db
    .select()
    .from(mediaTable)
    .where(eq(mediaTable.id, id))
    .get();
  if (!row) return false;

  await env.MEDIA.delete(row.key);
  await db.delete(mediaTable).where(eq(mediaTable.id, id));
  return true;
}
