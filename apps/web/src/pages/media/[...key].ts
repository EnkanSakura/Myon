import { env } from 'cloudflare:workers';
import type { AppBindings } from '@myon/back/types';
import type { APIRoute } from 'astro';

const binding = env as unknown as AppBindings;

/** R2 对象没写 Content-Type 时按扩展名补一个（本地种子图片就是这种情况）。 */
const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
};

function contentTypeOf(key: string, declared?: string): string {
  if (declared) return declared;
  const extension = key.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

/**
 * 媒体文件出口：只从 R2 读。
 * 仓库里不存图片资源，所有图片（包括首页封面、展柜、动态配图）都通过后台
 * 上传到 R2，再用 /media/<key> 访问。
 */
export const GET: APIRoute = async ({ params }) => {
  const key = params.key ?? '';
  if (!key || key.includes('..')) {
    return new Response('Not found', { status: 404 });
  }

  const object = await binding.MEDIA.get(key);
  if (!object) {
    return new Response('Not found', { status: 404 });
  }

  return new Response(object.body as unknown as BodyInit, {
    headers: {
      'content-type': contentTypeOf(key, object.httpMetadata?.contentType),
      'cache-control': 'public, max-age=31536000, immutable',
      etag: object.httpEtag,
    },
  });
};
