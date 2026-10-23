import { handle } from '@astrojs/cloudflare/handler';
import { syncBangumi } from '@myon/back/bangumi';
import {
  readSiteSettings,
  renderMaintenancePage,
  shouldServeMaintenance,
} from '@myon/back/site';
import { recordPageView, shouldTrackRequest } from '@myon/back/traffic';
import type { AppBindings } from '@myon/back/types';
import { toPublicSiteSettings } from '@myon/shared';

/**
 * 自定义 Worker 入口：Astro 的默认入口只导出 fetch，这里补上 Cron 的 scheduled，
 * 在维护模式开启时先返回维护页，其余前台 HTML 请求顺带记一次访问量。
 */
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const accept = request.headers.get('accept') ?? '';

    // 先按「维护模式开启」判断这是不是会被拦的前台页面：API / 静态资源
    // / 后台不读 KV。命中后才读设置，确认开关是否真的打开。
    const maintenanceCandidate =
      request.method === 'GET' &&
      shouldServeMaintenance(url.pathname, accept, true);
    if (maintenanceCandidate) {
      const settings = await readSiteSettings(env.SETTINGS);
      if (settings.maintenance_enabled === 'true') {
        // 维护页不算一次页面访问：直接返回，不记录 page_views。
        return new Response(
          renderMaintenancePage(toPublicSiteSettings(settings)),
          {
            status: 503,
            headers: {
              'content-type': 'text/html; charset=utf-8',
              'cache-control': 'no-store',
              'retry-after': '600',
              'x-robots-tag': 'noindex',
            },
          },
        );
      }
    }

    if (shouldTrackRequest(request)) {
      ctx.waitUntil(
        recordPageView(env.DB, request).catch((error) => {
          console.error('page view record failed', error);
        }),
      );
    }
    return handle(request, env, ctx);
  },
  async scheduled(
    _controller: { cron?: string },
    env: Env,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ) {
    ctx.waitUntil(
      syncBangumi(env as unknown as AppBindings)
        .then((result) => {
          console.log('bangumi sync', JSON.stringify(result));
        })
        .catch((error) => {
          console.error('bangumi sync failed', error);
        }),
    );
  },
};
