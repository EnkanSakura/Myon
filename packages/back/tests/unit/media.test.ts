import type {
  KVNamespace,
  R2Bucket,
  R2Object,
} from '@cloudflare/workers-types';
import { describe, expect, it } from 'vitest';
import {
  decodeMediaId,
  encodeMediaId,
  MAX_UPLOAD_BYTES,
  type MediaError,
  readMediaCount,
  storeMedia,
} from '../../src/media';
import type { AppBindings } from '../../src/types';

/** 够用的 R2 桩：readMediaCount 只需要 list；KV 用于数量缓存。 */
function createMediaEnv(keys: string[] = []) {
  const objects = keys.map(
    (key) =>
      ({
        key,
        size: 100,
        uploaded: new Date('2026-10-20T00:00:00.000Z'),
        httpMetadata: { contentType: 'image/png' },
      }) as unknown as R2Object,
  );
  const kvData = new Map<string, string>();

  const bucket = {
    list: async () => ({ objects, truncated: false }),
  };
  const settings = {
    get: async (key: string, type?: string) => {
      const raw = kvData.get(key);
      if (raw === undefined) return null;
      return type === 'json' ? JSON.parse(raw) : raw;
    },
    put: async (key: string, value: string) => {
      kvData.set(key, value);
    },
    delete: async (key: string) => {
      kvData.delete(key);
    },
  };

  return {
    env: {
      MEDIA: bucket as unknown as R2Bucket,
      SETTINGS: settings as unknown as KVNamespace,
    } as unknown as AppBindings,
    kvData,
  };
}

describe('media id encoding', () => {
  it('round-trips keys through a URL-safe id', () => {
    const key = 'uploads/202610/鬼之根付.webp';
    const id = encodeMediaId(key);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeMediaId(id)).toBe(key);
  });

  it('returns null for malformed ids', () => {
    expect(decodeMediaId('***')).toBeNull();
  });
});

describe('storeMedia validation', () => {
  it('rejects empty, unsupported and oversized files before touching R2 / D1', async () => {
    const env = {} as AppBindings;
    await expect(
      storeMedia(env, new File([], 'empty.webp', { type: 'image/webp' })),
    ).rejects.toMatchObject({
      code: 'empty_file',
    } satisfies Partial<MediaError>);
    await expect(
      storeMedia(env, new File(['x'], 'note.txt', { type: 'text/plain' })),
    ).rejects.toMatchObject({
      code: 'unsupported_type',
    } satisfies Partial<MediaError>);
    await expect(
      storeMedia(env, new File(['x'], 'photo.jpg', { type: 'image/jpeg' })),
    ).rejects.toMatchObject({
      code: 'unsupported_type',
    } satisfies Partial<MediaError>);
    await expect(
      storeMedia(env, new File(['x'], 'anim.gif', { type: 'image/gif' })),
    ).rejects.toMatchObject({
      code: 'unsupported_type',
    } satisfies Partial<MediaError>);

    const huge = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    await expect(
      storeMedia(env, new File([huge], 'huge.webp', { type: 'image/webp' })),
    ).rejects.toMatchObject({
      code: 'too_large',
    } satisfies Partial<MediaError>);
  });
});

describe('readMediaCount', () => {
  it('caches the R2 object count in KV', async () => {
    const { env, kvData } = createMediaEnv(['a.png', 'b.png']);

    expect(await readMediaCount(env)).toBe(2);
    expect(kvData.get('media:count')).toBe('2');

    kvData.set('media:count', '7');
    expect(await readMediaCount(env)).toBe(7);
  });
});
