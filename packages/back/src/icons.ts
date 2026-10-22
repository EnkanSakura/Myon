import { isIconifyIconName, type SiteIcon } from '@myon/shared';
import sanitizeHtml from 'sanitize-html';

/**
 * 联系方式图标走 Iconify（icones.js.org）：设置里只存 `前缀:图标名`，
 * 前台渲染时由这里取回 SVG 并按白名单过滤，页面不加载外部脚本。
 */

const ICONIFY_API = 'https://api.iconify.design';
const FETCH_TIMEOUT_MS = 2500;
const MAX_SVG_LENGTH = 20_000;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 128;
export const MAX_ICONS = 12;

/**
 * SVG 白名单：只保留 Iconify 输出会用到的图形标签与几何属性。
 * sanitize-html 会把属性名转小写，下面再把几个 SVG 区分大小写的属性名修回来。
 */
const allowedTags = [
  'svg',
  'defs',
  'title',
  'path',
  'g',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'use',
];

const allowedAttributes = {
  '*': [
    'id',
    'aria-hidden',
    'role',
    'xmlns',
    'viewBox',
    'viewbox',
    'width',
    'height',
    'fill',
    'fill-rule',
    'fill-opacity',
    'stroke',
    'stroke-width',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-miterlimit',
    'stroke-dasharray',
    'stroke-opacity',
    'opacity',
    'transform',
    'd',
    'cx',
    'cy',
    'r',
    'rx',
    'ry',
    'x',
    'y',
    'x1',
    'y1',
    'x2',
    'y2',
    'points',
    'offset',
    'stop-color',
    'stop-opacity',
    'gradientUnits',
    'gradientunits',
    'gradientTransform',
    'gradienttransform',
    'preserveAspectRatio',
    'preserveaspectratio',
    'clip-path',
    'clipPathUnits',
    'clippathunits',
    'mask',
    'maskUnits',
    'maskunits',
    'maskContentUnits',
    'maskcontentunits',
    'href',
    'xlink:href',
  ],
};

/** 被 sanitize-html 转小写、但 SVG 里区分大小写的属性 / 标签名。 */
const CAMEL_ATTRIBUTES: Record<string, string> = {
  viewbox: 'viewBox',
  preserveaspectratio: 'preserveAspectRatio',
  gradientunits: 'gradientUnits',
  gradienttransform: 'gradientTransform',
  clippathunits: 'clipPathUnits',
  maskunits: 'maskUnits',
  maskcontentunits: 'maskContentUnits',
};

/** 过滤 Iconify 返回的 SVG；不是合法 svg 时返回 null。 */
export function sanitizeIconSvg(value: string): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > MAX_SVG_LENGTH) return null;

  let cleaned = sanitizeHtml(text, {
    allowedTags,
    allowedAttributes,
    // 只放行站内引用的 #id；外链与 javascript: 一律去掉
    allowedSchemes: [],
    allowedSchemesAppliedToAttributes: ['href', 'xlink:href'],
  });

  for (const [lower, proper] of Object.entries(CAMEL_ATTRIBUTES)) {
    cleaned = cleaned.replace(new RegExp(`\\b${lower}=`, 'g'), `${proper}=`);
  }

  // href 只允许页面内 #id 引用；协议相对地址（//host）也一并去掉
  cleaned = cleaned.replace(/\s(?:xlink:)?href="(?!#)[^"]*"/g, '');

  // 必须真的是一个带 viewBox 的 svg，避免把残缺片段渲染进页面
  if (!/^<svg[\s>]/i.test(cleaned) || !/viewBox=/.test(cleaned)) return null;
  return cleaned;
}

interface CacheEntry {
  svg: string | null;
  at: number;
}

const cache = new Map<string, CacheEntry>();

function readCache(name: string): string | null | undefined {
  const entry = cache.get(name);
  if (!entry) return undefined;
  const ttl = entry.svg === null ? MISS_TTL_MS : CACHE_TTL_MS;
  return Date.now() - entry.at < ttl ? entry.svg : undefined;
}

function writeCache(name: string, svg: string | null): void {
  cache.delete(name);
  cache.set(name, { svg, at: Date.now() });
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** 取一个 Iconify 图标的内联 SVG；名称非法或上游取不到时返回 null。 */
export async function resolveIconSvg(rawName: string): Promise<string | null> {
  if (!isIconifyIconName(rawName)) return null;
  const name = rawName.trim().toLowerCase();

  const cached = readCache(name);
  if (cached !== undefined) return cached;

  const separator = name.indexOf(':');
  const prefix = name.slice(0, separator);
  const iconName = name.slice(separator + 1);

  let svg: string | null = null;
  try {
    const res = await fetch(
      `${ICONIFY_API}/${encodeURIComponent(prefix)}/${encodeURIComponent(iconName)}.svg`,
      {
        headers: { accept: 'image/svg+xml' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    if (res.ok) {
      const contentType = res.headers.get('content-type') ?? '';
      const body = await res.text();
      if (contentType.includes('svg') && body.length <= MAX_SVG_LENGTH) {
        svg = sanitizeIconSvg(body);
      }
    }
  } catch (error) {
    console.error('iconify request failed', name, error);
    svg = null;
  }

  writeCache(name, svg);
  return svg;
}

/** 批量取图标（前台首页一次要 1～6 个），去重并限制数量。 */
export async function resolveIconSvgs(names: string[]): Promise<SiteIcon[]> {
  const unique = [
    ...new Set(
      names
        .filter((name): name is string => isIconifyIconName(name))
        .map((name) => name.trim().toLowerCase()),
    ),
  ].slice(0, MAX_ICONS);

  const resolved = await Promise.all(
    unique.map(async (name) => ({ name, svg: await resolveIconSvg(name) })),
  );

  return resolved.filter((icon): icon is SiteIcon => icon.svg !== null);
}
