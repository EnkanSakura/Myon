import {
  defaultSiteSettings,
  type SiteSettingKey,
  type SiteSettings,
  siteSettingKeys,
} from '@myon/shared';
import sanitizeHtml from 'sanitize-html';
import { getDb } from './db/client';
import { settings } from './db/schema';

const keySet = new Set<string>(siteSettingKeys);

/** 读出全部站点设置；缺失的键用默认值补齐。 */
export async function readSiteSettings(db: D1Database): Promise<SiteSettings> {
  const rows = await getDb(db).select().from(settings);
  const merged: SiteSettings = { ...defaultSiteSettings };

  for (const row of rows) {
    if (keySet.has(row.key)) merged[row.key as SiteSettingKey] = row.value;
  }

  return merged;
}

/** 按 key 写入设置（upsert），返回写入后的全量设置。 */
export async function writeSiteSettings(
  db: D1Database,
  patch: Partial<SiteSettings>,
): Promise<SiteSettings> {
  const entries = Object.entries(patch).filter(
    (entry): entry is [SiteSettingKey, string] =>
      keySet.has(entry[0]) && typeof entry[1] === 'string',
  );

  if (entries.length > 0) {
    const client = getDb(db);
    for (const [key, value] of entries) {
      await client
        .insert(settings)
        .values({ key, value })
        .onConflictDoUpdate({ target: settings.key, set: { value } });
    }
  }

  return readSiteSettings(db);
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
