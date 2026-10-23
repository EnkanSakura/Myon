import { handle } from '@astrojs/cloudflare/handler';
import { syncBangumi } from '@myon/back/bangumi';
import { recordPageView, shouldTrackRequest } from '@myon/back/traffic';
import type { AppBindings } from '@myon/back/types';

/**
 * 自定义 Worker 入口：Astro 的默认入口只导出 fetch，这里补上 Cron 的 scheduled，
 * 并在每次前台 HTML 请求时顺手记一次访问量（D1 page_views，后台总览用）。
 */
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
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
