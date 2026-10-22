import { handle } from '@astrojs/cloudflare/handler';
import { syncBangumi } from '@myon/back/bangumi';
import type { AppBindings } from '@myon/back/types';

/**
 * 自定义 Worker 入口：Astro 的默认入口只导出 fetch，这里补上 Cron 的 scheduled。
 * scheduled 只做一件事：每 6 小时同步一次 Bangumi 收藏（未配置令牌时直接跳过）。
 */
export default {
  fetch: handle,
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
