import {
  defaultSiteSettings,
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
