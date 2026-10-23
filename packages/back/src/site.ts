import {
  defaultSiteSettings,
  defaultThemeColor,
  type PublicSiteSettings,
  type SiteSettingKey,
  type SiteSettings,
  siteSettingKeys,
  siteSettingsKvKey,
} from '@myon/shared';
import sanitizeHtml from 'sanitize-html';

const keySet = new Set<string>(siteSettingKeys);
type StoredSettings = Record<string, string>;

/** 从 KV 读出用户改过的设置（只读这一层，不合并默认值）。 */
async function readStoredSettings(kv: KVNamespace): Promise<StoredSettings> {
  try {
    const raw = await kv.get(siteSettingsKvKey, 'json');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

    const stored: StoredSettings = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (keySet.has(key) && typeof value === 'string') stored[key] = value;
    }
    return stored;
  } catch (error) {
    // KV 绑定缺失或读取失败时退回默认值，保证前台不白屏。
    console.error('site settings KV read failed', error);
    return {};
  }
}

/** 读出全部站点设置；KV 里缺失的键用默认值补齐。 */
export async function readSiteSettings(kv: KVNamespace): Promise<SiteSettings> {
  const stored = await readStoredSettings(kv);
  return { ...defaultSiteSettings, ...stored } as SiteSettings;
}

/** 按 key 写入设置（KV 是整份 JSON，读改写），返回写入后的全量设置。 */
export async function writeSiteSettings(
  kv: KVNamespace,
  patch: Partial<SiteSettings>,
): Promise<SiteSettings> {
  const entries = Object.entries(patch).filter(
    (entry): entry is [SiteSettingKey, string] =>
      keySet.has(entry[0]) && typeof entry[1] === 'string',
  );

  if (entries.length > 0) {
    const stored = await readStoredSettings(kv);
    for (const [key, value] of entries) stored[key] = value;
    await kv.put(siteSettingsKvKey, JSON.stringify(stored));
  }

  return readSiteSettings(kv);
}

/** 页脚里的技术支持 / 备案号允许写链接，输出前做白名单过滤。 */
export function sanitizeFooterHtml(value: string): string {
  return sanitizeHtml(value ?? '', {
    allowedTags: ['a', 'br', 'span', 'strong', 'em'],
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', {
        target: '_blank',
        rel: 'noopener noreferrer',
      }),
    },
  });
}

/** 维护模式不拦的路径：后台、API 与静态资源，维护页自己也要能加载。 */
const MAINTENANCE_BYPASS_PATTERNS: RegExp[] = [
  /^\/admin(?:\/|$)/,
  /^\/api(?:\/|$)/,
  /^\/_astro\//,
  /^\/css\//,
  /^\/js\//,
  /^\/assets\//,
  /^\/media\//,
  /^\/favicon(?:\.ico|\.svg)?$/,
  /^\/rss\.xml$/,
];

/**
 * 维护模式是否该拦住这次请求：只拦前台 HTML 页面。
 * 纯函数，Worker 入口与单测共用；`accept` 里没有 text/html 的一律放行。
 */
export function shouldServeMaintenance(
  pathname: string,
  accept: string,
  maintenanceEnabled: boolean,
): boolean {
  if (!maintenanceEnabled) return false;
  if (!accept.includes('text/html')) return false;
  if (!pathname.startsWith('/') || pathname.startsWith('//')) return false;
  return !MAINTENANCE_BYPASS_PATTERNS.some((pattern) => pattern.test(pathname));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 维护页：不依赖前端 CSS / JS 的独立 HTML，只显示站点名、作者与「维护中」。
 * 颜色仍取站点主题色，但只接受 #RRGGBB，避免把设置内容直接写进样式。
 */
export function renderMaintenancePage(
  settings: Pick<PublicSiteSettings, 'name' | 'author' | 'themeColor'>,
): string {
  const name = escapeHtml(settings.name || 'Myon');
  const author = escapeHtml(settings.author || settings.name || 'Myon');
  const accent = /^#[0-9a-fA-F]{6}$/.test(settings.themeColor)
    ? settings.themeColor
    : defaultThemeColor;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="any">
<title>维护中 · ${name}</title>
<style>
  :root { --accent: ${accent}; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
    background: #f7f3ef;
    color: #17131a;
    font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  .card {
    width: min(520px, 100%);
    padding: 36px 32px 32px;
    background: #fff;
    border: 2px solid #17131a;
    box-shadow: 8px 8px 0 #17131a;
  }
  .bar { height: 8px; margin-bottom: 28px; background: var(--accent); border: 2px solid #17131a; }
  .label { margin: 0 0 12px; font-family: ui-monospace, "SFMono-Regular", monospace; font-size: 12px; letter-spacing: .18em; }
  h1 { margin: 0 0 16px; font-size: 40px; line-height: 1.1; }
  p { margin: 0; font-size: 15px; line-height: 1.7; }
  .author { margin-top: 24px; font-size: 12px; letter-spacing: .12em; }
</style>
</head>
<body>
  <main class="card">
    <div class="bar"></div>
    <p class="label">MAINTENANCE</p>
    <h1>维护中</h1>
    <p>${name} 正在整理中，请稍后再来。</p>
    <p class="author">${author}</p>
  </main>
</body>
</html>`;
}
