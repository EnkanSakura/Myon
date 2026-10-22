import { env } from 'cloudflare:workers';
import app from '@myon/back';
import type { AppBindings } from '@myon/back/types';
import type { PublicSiteSettings } from '@myon/shared';
import { defaultSiteSettings, toPublicSiteSettings } from '@myon/shared';

/**
 * 读取前台需要的站点设置（主题色 + 页脚）。
 * 走进程内的 /api/v1/site，和原生 App 用的是同一份契约；失败时退回默认值，
 * 保证页面不会因为配置读不出来而白屏。
 */
export async function loadPublicSiteSettings(): Promise<PublicSiteSettings> {
  try {
    const res = await app.request(
      '/api/v1/site',
      {},
      env as unknown as AppBindings,
    );
    if (res.ok) {
      const body = (await res.json()) as { settings: PublicSiteSettings };
      return body.settings;
    }
    console.error('site settings request failed', res.status);
  } catch (error) {
    console.error('site settings request threw', error);
  }

  return toPublicSiteSettings(defaultSiteSettings);
}
