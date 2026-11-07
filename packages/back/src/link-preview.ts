import type { AppBindings } from './types';

/**
 * 外部网站卡片的元数据抓取。
 *
 * - 只允许 http/https，禁止带账号密码、非 80/443 端口与私网/回环地址；
 * - 手动跟随最多 3 次重定向，每一跳都重新校验目标；
 * - 整体 5 秒超时，只接受 HTML，最多读取 512KB；
 * - 结果缓存到 Workers KV 7 天；抓取失败由前端降级成普通链接卡片。
 */

export interface LinkPreviewItem {
  /** 最终地址（跟随重定向后）。 */
  url: string;
  title: string;
  description: string;
  siteName: string;
  icon: string | null;
  host: string;
}

export type LinkPreviewResult =
  | { ok: true; item: LinkPreviewItem }
  | { ok: false; reason: 'invalid_url' | 'fetch_failed' };

const CACHE_PREFIX = 'link-preview:v1:';
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 7;
const FETCH_TIMEOUT_MS = 5000;
const MAX_HTML_CHARS = 512 * 1024;
const MAX_REDIRECTS = 3;
const USER_AGENT = 'MyonLinkPreview/1.0 (+https://myon.top)';

/** 私网 / 回环 / 特殊用途地址：避免把 Worker 当成内网探测器。 */
function isBlockedHost(hostname: string): boolean {
  let host = hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!host) return true;
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.home.arpa')
  ) {
    return true;
  }
  // 直接禁止 IPv6 字面量：正常网站卡片用域名，收紧后能覆盖大部分 SSRF 面。
  if (host.includes(':')) return true;

  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return true;
  const [a = 0, b = 0] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** 校验并规范化外部链接；不合法返回 null。 */
export function normalizePreviewUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    if (url.port && url.port !== '80' && url.port !== '443') return null;
    if (isBlockedHost(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

export function isAllowedPreviewUrl(raw: string): boolean {
  return normalizePreviewUrl(raw) !== null;
}

function getAttribute(tag: string, name: string): string {
  const match = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'i',
  ).exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_match, dec: string) =>
      String.fromCodePoint(Number(dec)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function cleanText(value: string, max: number): string {
  return decodeEntities(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** 解析 HTML 里的 title / description / site name / icon。 */
export function parseLinkPreviewHtml(
  html: string,
  finalUrl: URL,
): Omit<LinkPreviewItem, 'url'> {
  const metas: Record<string, string> = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (getAttribute(tag, 'property') || getAttribute(tag, 'name'))
      .trim()
      .toLowerCase();
    const content = getAttribute(tag, 'content');
    if (key && content && !(key in metas)) metas[key] = content;
  }

  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '';
  const hostname = finalUrl.hostname.replace(/^www\./i, '') || finalUrl.host;
  const siteName = cleanText(metas['og:site_name'] ?? '', 60) || hostname;
  const title = cleanText(
    metas['og:title'] ?? metas['twitter:title'] ?? titleTag,
    200,
  );
  const description = cleanText(
    metas['og:description'] ??
      metas['twitter:description'] ??
      metas['description'] ??
      '',
    300,
  );

  let icon: string | null = null;
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/icon/i.test(getAttribute(tag, 'rel'))) continue;
    const href = getAttribute(tag, 'href');
    if (!href) continue;
    try {
      const resolved = new URL(href, finalUrl);
      if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
        icon = resolved.toString();
        break;
      }
    } catch {
      // 忽略坏 href，继续找下一个 icon。
    }
  }
  if (!icon) icon = `${finalUrl.origin}/favicon.ico`;

  return {
    title: title || hostname,
    description,
    siteName,
    icon,
    host: hostname,
  };
}

/** 手动跟随重定向，逐跳校验；失败返回 null。 */
async function fetchHtml(
  startUrl: URL,
): Promise<{ html: string; finalUrl: URL } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let current = startUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await fetch(current.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': USER_AGENT,
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) return null;
        const next = normalizePreviewUrl(new URL(location, current).toString());
        if (!next) return null;
        current = next;
        continue;
      }
      if (!response.ok) return null;

      const contentType = (
        response.headers.get('content-type') ?? ''
      ).toLowerCase();
      if (
        !contentType.includes('text/html') &&
        !contentType.includes('application/xhtml+xml')
      ) {
        return null;
      }
      const declared = Number(response.headers.get('content-length') ?? 0);
      if (declared > MAX_HTML_CHARS) return null;

      const html = await response.text();
      return { html: html.slice(0, MAX_HTML_CHARS), finalUrl: current };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function cacheKeyFor(url: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(url),
  );
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `${CACHE_PREFIX}${hex}`;
}

export async function fetchLinkPreview(
  env: AppBindings,
  rawUrl: string,
): Promise<LinkPreviewResult> {
  const url = normalizePreviewUrl(rawUrl);
  if (!url) return { ok: false, reason: 'invalid_url' };

  const cacheKey = await cacheKeyFor(url.toString());
  try {
    const cached = await env.SETTINGS.get(cacheKey, 'json');
    if (cached) return { ok: true, item: cached as LinkPreviewItem };
  } catch {
    // 缓存读失败不影响抓取。
  }

  const fetched = await fetchHtml(url);
  if (!fetched) return { ok: false, reason: 'fetch_failed' };

  const item: LinkPreviewItem = {
    url: fetched.finalUrl.toString(),
    ...parseLinkPreviewHtml(fetched.html, fetched.finalUrl),
  };
  try {
    await env.SETTINGS.put(cacheKey, JSON.stringify(item), {
      expirationTtl: CACHE_TTL_SECONDS,
    });
  } catch {
    // 缓存写失败不影响本次返回。
  }
  return { ok: true, item };
}
