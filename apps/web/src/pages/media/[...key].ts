import { env } from 'cloudflare:workers';
import type { AppBindings } from '@myon/back/types';
import type { APIRoute } from 'astro';

const binding = env as unknown as AppBindings;

/**
 * 媒体文件出口：优先从 R2 读，读不到再回退到随仓库发布的 assets。
 * 这样新上传的图片立刻可用，种子数据里的旧图片也不需要先搬到 R2。
 */
export const GET: APIRoute = async ({ params, request }) => {
  const key = params.key ?? '';
  if (!key || key.includes('..')) {
    return new Response('Not found', { status: 404 });
  }

  const object = await binding.MEDIA.get(key);
  if (object) {
    return new Response(object.body as unknown as BodyInit, {
      headers: {
        'content-type':
          object.httpMetadata?.contentType ?? 'application/octet-stream',
        'cache-control': 'public, max-age=31536000, immutable',
        etag: object.httpEtag,
      },
    });
  }

  const fallback = await binding.ASSETS?.fetch(
    new URL(`/assets/${key}`, request.url),
  );
  if (fallback?.ok && fallback.body) {
    return new Response(fallback.body as unknown as BodyInit, {
      headers: {
        'content-type':
          fallback.headers.get('content-type') ?? 'application/octet-stream',
        'cache-control': 'public, max-age=86400',
      },
    });
  }

  return new Response('Not found', { status: 404 });
};
