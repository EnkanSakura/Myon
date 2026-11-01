import {
  defaultMediaImageSize,
  type MediaImageSize,
  mediaImageEdge,
  mediaImageQuality,
} from '@myon/shared';

/**
 * 媒体 key → 前台 URL。
 * 统一走 /media/<key>：媒体只从 R2 读取，仓库里不再存图片。
 * 兼容旧设置里的 /assets/<key>：自动改写到 /media/<key>。
 */
export function mediaUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  if (/^(https?:)?\/\//.test(key)) return key;
  if (key.startsWith('/assets/'))
    return `/media/${key.slice('/assets/'.length)}`;
  if (key.startsWith('/')) return key;
  return `/media/${key.replace(/^\/+/, '')}`;
}

/** 站内媒体地址追加转换参数：原地址已带查询串时用 & 连接。 */
function withImageParams(url: string, edge: number, quality: number): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}size=${edge}&q=${quality}`;
}

/**
 * 固定长边的图片地址：首页封面、第 2 页装饰图这类需要指定长边的图位。
 * 只对站内 /media/ 地址追加 ?size=<edge>&q=<quality>，外链与空值原样返回。
 */
export function mediaImageUrl(
  key: string | null | undefined,
  edge: number,
  quality = mediaImageQuality,
): string | null {
  const url = mediaUrl(key);
  if (!url?.startsWith('/media/')) return url;
  return withImageParams(url, edge, quality);
}

/**
 * 内容图片地址：文章正文、动态配图、展柜藏品按记录里的尺寸档位取图。
 * size 为 'orig' 时不带转换参数；老数据 null / undefined 按默认 720 输出。
 * 同样只处理站内 /media/ 地址，外链原样返回。
 */
export function contentImageUrl(
  key: string | null | undefined,
  size: MediaImageSize | null | undefined = defaultMediaImageSize,
  quality = mediaImageQuality,
): string | null {
  const url = mediaUrl(key);
  if (!url?.startsWith('/media/')) return url;
  const edge = mediaImageEdge(size ?? defaultMediaImageSize);
  if (edge == null) return url;
  return withImageParams(url, edge, quality);
}
