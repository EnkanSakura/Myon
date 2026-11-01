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

/** 导出图片的长边上限：超过这个值的 size 参数按上限处理。 */
const MAX_TRANSFORM_EDGE = 3840;
/** 默认输出质量（WebP）。 */
const DEFAULT_QUALITY = 80;
/** 回退原图时的短缓存：等账户开通 Images / 绑定就绪后能尽快换到转换图。 */
const FALLBACK_CACHE = 'public, max-age=300';
/** 正常产物（原图 / 转换图）的缓存：媒体 key 带 UUID，内容不会原地变化。 */
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

function contentTypeOf(key: string, declared?: string): string {
  if (declared) return declared;
  const extension = key.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

/** 原图响应；`cache` 用来区分正常产物与转换失败时的短缓存回退。 */
function originalResponse(
  object: R2ObjectBody,
  key: string,
  cache = IMMUTABLE_CACHE,
): Response {
  return new Response(object.body as unknown as BodyInit, {
    headers: {
      'content-type': contentTypeOf(key, object.httpMetadata?.contentType),
      'cache-control': cache,
      etag: object.httpEtag,
    },
  });
}

/** 已经读过 R2 body 之后的原图回退：用内存里的字节重建响应。 */
function bytesResponse(
  bytes: ArrayBuffer,
  object: R2ObjectBody,
  key: string,
  cache = IMMUTABLE_CACHE,
): Response {
  return new Response(bytes, {
    headers: {
      'content-type': contentTypeOf(key, object.httpMetadata?.contentType),
      'cache-control': cache,
      etag: object.httpEtag,
    },
  });
}

/** 解析 `size` 参数：数字（长边像素）或 `orig`。不合法时返回 null。 */
function parseSize(raw: string | null): number | 'orig' | null {
  if (!raw) return null;
  if (raw === 'orig') return 'orig';
  if (!/^\d{1,4}$/.test(raw)) return null;
  const size = Number.parseInt(raw, 10);
  if (size < 1) return null;
  return Math.min(size, MAX_TRANSFORM_EDGE);
}

/** 解析 `q` 参数：1–100，缺省 80。 */
function parseQuality(raw: string | null): number {
  if (!raw || !/^\d{1,3}$/.test(raw)) return DEFAULT_QUALITY;
  const quality = Number.parseInt(raw, 10);
  if (quality < 1 || quality > 100) return DEFAULT_QUALITY;
  return quality;
}

/** 把 ArrayBuffer 转成一次性的图片字节流（info 与 transform 各要一份）。 */
function bytesStream(bytes: ArrayBuffer): ReadableStream<Uint8Array> {
  return new Response(bytes).body as ReadableStream<Uint8Array>;
}

/**
 * 图片转换：/media/<key>?size=720（长边像素）或 ?size=orig。
 * 用 Cloudflare Images 绑定（env.IMAGES）在 Worker 内生成低分辨率 WebP；
 * 账户未开通、本地开发不支持或转换失败时回退原图，不返回破图。
 * 不带 size 参数时保持原有行为，直接返回 R2 原图（媒体库复制链接用的就是原图）。
 */
async function transformedResponse(
  object: R2ObjectBody,
  key: string,
  size: number,
  quality: number,
): Promise<Response> {
  const images = binding.IMAGES;
  if (!images) return originalResponse(object, key, FALLBACK_CACHE);

  let bytes: ArrayBuffer;
  try {
    bytes = await object.arrayBuffer();
  } catch (error) {
    console.error('media read failed', key, error);
    return originalResponse(object, key, FALLBACK_CACHE);
  }

  try {
    const info = await images.info(bytesStream(bytes));
    // SVG 没有像素尺寸（本地占位图由扩展名判断；SVG 也不值得转栅格）。
    if (!('width' in info) || !('height' in info)) {
      return bytesResponse(bytes, object, key);
    }
    const longEdge = Math.max(info.width, info.height);
    if (longEdge <= size) {
      // 原图本来就比目标小，不放大，也不消耗转换次数。
      return bytesResponse(bytes, object, key);
    }
    const scale = size / longEdge;
    const width = Math.max(1, Math.round(info.width * scale));
    const height = Math.max(1, Math.round(info.height * scale));
    const result = await images
      .input(bytesStream(bytes))
      .transform({ width, height })
      .output({ format: 'image/webp', quality });
    return result.response({
      headers: {
        'cache-control': IMMUTABLE_CACHE,
        'x-image-size': `w=${width},h=${height},q=${quality}`,
      },
    });
  } catch (error) {
    console.error('media image transform failed', key, size, error);
    return bytesResponse(bytes, object, key, FALLBACK_CACHE);
  }
}

/**
 * 媒体文件出口：只从 R2 读。
 * 仓库里不存图片资源，所有图片（包括首页封面、展柜、动态配图）都通过后台
 * 上传到 R2，再用 /media/<key> 访问。
 */
export const GET: APIRoute = async ({ params, url }) => {
  const key = params.key ?? '';
  if (!key || key.includes('..')) {
    return new Response('Not found', { status: 404 });
  }

  const object = await binding.MEDIA.get(key);
  if (!object) {
    return new Response('Not found', { status: 404 });
  }

  const size = parseSize(url.searchParams.get('size'));
  if (size === null || size === 'orig') {
    return originalResponse(object, key);
  }

  return transformedResponse(
    object,
    key,
    size,
    parseQuality(url.searchParams.get('q')),
  );
};
