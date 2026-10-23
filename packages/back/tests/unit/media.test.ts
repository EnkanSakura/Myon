import type {
  KVNamespace,
  R2Bucket,
  R2Object,
} from '@cloudflare/workers-types';
import { describe, expect, it } from 'vitest';
import {
  decodeMediaId,
  deleteMedia,
  encodeMediaId,
  listMedia,
  MAX_UPLOAD_BYTES,
  type MediaError,
  readMediaCount,
  storeMedia,
} from '../../src/media';
import type { AppBindings } from '../../src/types';

/** 够用的 R2 桩：只实现媒体库用到的 list / head / get / put / delete。 */
function createMediaEnv(initial: R2Object[] = []) {
  const objects = new Map<string, R2Object>(
    initial.map((object) => [object.key, object]),
  );
  const kvData = new Map<string, string>();

  const bucket = {
    list: async () => ({
      objects: [...objects.values()],
      truncated: false,
    }),
    head: async (key: string) => objects.get(key) ?? null,
    get: async (key: string) => objects.get(key) ?? null,
    put: async (
      key: string,
      _value: ArrayBuffer,
      options?: {
        httpMetadata?: { contentType?: string };
        customMetadata?: Record<string, string>;
      },
    ) => {
      objects.set(
        key,
        makeObject(key, {
          contentType: options?.httpMetadata?.contentType,
          customMetadata: options?.customMetadata,
        }),
      );
      return { key };
    },
    delete: async (key: string) => {
      objects.delete(key);
    },
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
    objects,
    kvData,
  };
}

function makeObject(
  key: string,
  options: {
    size?: number;
    contentType?: string;
    customMetadata?: Record<string, string>;
    uploadedAt?: string;
  } = {},
): R2Object {
  return {
    key,
    size: options.size ?? 100,
    uploaded: new Date(options.uploadedAt ?? '2026-10-20T00:00:00.000Z'),
    httpMetadata: { contentType: options.contentType ?? 'image/png' },
    customMetadata: options.customMetadata,
  } as unknown as R2Object;
}

describe('media id encoding', () => {
  it('round-trips keys through a URL-safe id', () => {
    const key = 'gallery/鬼之根付.jpg';
    const id = encodeMediaId(key);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeMediaId(id)).toBe(key);
  });

  it('returns null for malformed ids', () => {
    expect(decodeMediaId('***')).toBeNull();
  });
});

describe('listMedia', () => {
  it('lists R2 objects with metadata, newest first, with paging', async () => {
    const { env } = createMediaEnv([
      makeObject('gallery/a.png', {
        size: 10,
        uploadedAt: '2026-10-18T00:00:00.000Z',
        customMetadata: { filename: encodeURIComponent('旧图.png') },
      }),
      makeObject('gallery/b.webp', {
        size: 20,
        contentType: 'image/webp',
        uploadedAt: '2026-10-20T00:00:00.000Z',
      }),
      makeObject('uploads/2026/c.jpg', {
        size: 30,
        uploadedAt: '2026-10-19T00:00:00.000Z',
      }),
    ]);

    const first = await listMedia(env, 2, 0);
    expect(first.total).toBe(3);
    expect(first.items.map((item) => item.key)).toEqual([
      'gallery/b.webp',
      'uploads/2026/c.jpg',
    ]);
    expect(first.items[0]?.mime).toBe('image/webp');
    expect(first.items[0]?.id).toBe(encodeMediaId('gallery/b.webp'));
    expect(first.items[0]?.filename).toBe('b.webp');

    const second = await listMedia(env, 2, 2);
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.filename).toBe('旧图.png');
  });
});

describe('storeMedia', () => {
  it('writes the file + custom metadata to R2 and invalidates the count cache', async () => {
    const { env, objects, kvData } = createMediaEnv();
    kvData.set('media:count', '9');

    const item = await storeMedia(
      env,
      new File([new Uint8Array([1, 2, 3])], '封面.png', {
        type: 'image/png',
      }),
    );
    expect(item.key).toMatch(/^uploads\/\d{6}\//);
    expect(item.filename).toBe('封面.png');
    expect(objects.get(item.key)?.customMetadata?.filename).toBe(
      encodeURIComponent('封面.png'),
    );
    expect(kvData.has('media:count')).toBe(false);
  });

  it('rejects empty, unsupported and oversized files', async () => {
    const { env } = createMediaEnv();
    await expect(
      storeMedia(env, new File([], 'empty.png', { type: 'image/png' })),
    ).rejects.toMatchObject({
      code: 'empty_file',
    } satisfies Partial<MediaError>);
    await expect(
      storeMedia(env, new File(['x'], 'note.txt', { type: 'text/plain' })),
    ).rejects.toMatchObject({
      code: 'unsupported_type',
    } satisfies Partial<MediaError>);

    const huge = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    await expect(
      storeMedia(env, new File([huge], 'huge.jpg', { type: 'image/jpeg' })),
    ).rejects.toMatchObject({
      code: 'too_large',
    } satisfies Partial<MediaError>);
  });
});

describe('deleteMedia', () => {
  it('deletes the R2 object by decoded id', async () => {
    const { env, objects } = createMediaEnv([
      makeObject('gallery/a.png'),
      makeObject('gallery/b.png'),
    ]);

    expect(await deleteMedia(env, encodeMediaId('gallery/a.png'))).toBe(true);
    expect(objects.has('gallery/a.png')).toBe(false);
    expect(await deleteMedia(env, encodeMediaId('gallery/missing.png'))).toBe(
      false,
    );
    expect(await deleteMedia(env, 'not-an-id')).toBe(false);
  });
});

describe('readMediaCount', () => {
  it('caches the R2 object count in KV', async () => {
    const { env, kvData } = createMediaEnv([
      makeObject('a.png'),
      makeObject('b.png'),
    ]);

    expect(await readMediaCount(env)).toBe(2);
    expect(kvData.get('media:count')).toBe('2');

    kvData.set('media:count', '7');
    expect(await readMediaCount(env)).toBe(7);
  });
});
