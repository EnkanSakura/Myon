/** Bangumi 封面代理：只放行 Bangumi 自己的图片域名，避免变成开放代理。 */
const BANGUMI_COVER_HOSTS = ['bgm.tv', 'bangumi.tv'];

/** 上游封面大小上限；超过时拒绝，避免 Worker 内存被异常图片拖垮。 */
export const MAX_BANGUMI_COVER_BYTES = 8 * 1024 * 1024;

/** 封面 URL 内容寻址，可以放心让浏览器与边缘缓存保留一年。 */
export const BANGUMI_COVER_CACHE_SECONDS = 365 * 24 * 60 * 60;

export function isBangumiCoverHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return BANGUMI_COVER_HOSTS.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

/** 校验并规范化封面源 URL；非 http(s) 或非 Bangumi 域名返回 null。 */
export function normalizeBangumiCoverUrl(
  raw: string | null | undefined,
): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!isBangumiCoverHost(url.hostname)) return null;
  return url.toString();
}

/** 上游可能返回 image/*，也可能没有 Content-Type；其他类型一律拒绝。 */
export function isBangumiCoverContentType(
  contentType: string | null | undefined,
): boolean {
  if (!contentType) return true;
  return /^(?:image\/|application\/octet-stream)/i.test(contentType);
}
