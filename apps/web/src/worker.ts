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
 * 公开入口统一走 www.myon.top（2026-11 起）。
 * apex 只保留后台与健康检查：后台因此始终直连 Cloudflare，不经过第三方边缘；
 * 其余 apex 请求一律 301 到规范域名，避免根域 CNAME 被 flatten 后失效。
 */
const CANONICAL_HOST = 'www.myon.top';
const APEX_HOST = 'myon.top';

/** 后台页面与写接口只允许出现在 Cloudflare 直连的 apex 上。 */
function isAdminPath(pathname: string): boolean {
  return (
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname === '/api/v1/admin' ||
    pathname.startsWith('/api/v1/admin/')
  );
}

/** 规范域名重定向：GET/HEAD 用 301（可被浏览器缓存），其他方法用 308 保留方法。 */
function redirectToHost(
  request: Request,
  url: URL,
  targetHost: string,
): Response {
  const location = `https://${targetHost}${url.pathname}${url.search}`;
  const status =
    request.method === 'GET' || request.method === 'HEAD' ? 301 : 308;
  return new Response(null, {
    status,
    headers: {
      location,
      'cache-control': 'public, max-age=300',
    },
  });
}

/** 公开 HTML 允许边缘短缓存并在后台刷新：缓存过期时先返回旧页面，避免所有人等冷渲染。 */
function withHtmlCacheHeader(
  request: Request,
  pathname: string,
  response: Response,
): Response {
  const contentType = response.headers.get('content-type') ?? '';
  const cacheable =
    request.method === 'GET' &&
    response.status === 200 &&
    contentType.includes('text/html') &&
    !isAdminPath(pathname) &&
    !pathname.startsWith('/api/') &&
    !response.headers.has('set-cookie');
  if (!cacheable) return response;

  const headers = new Headers(response.headers);
  headers.set(
    'cache-control',
    'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

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
    const host = url.hostname.toLowerCase();
    const pathname = url.pathname;

    // www 是规范域名；apex 只保留后台页面、后台接口与健康检查，其余 301 到 www。
    if (
      host === APEX_HOST &&
      pathname !== '/api/health' &&
      !isAdminPath(pathname)
    ) {
      return redirectToHost(request, url, CANONICAL_HOST);
    }
    // 后台只允许走 Cloudflare 直连的 apex：www 上的后台路径回跳 apex，避免第三方边缘承载后台。
    if (host === CANONICAL_HOST && isAdminPath(pathname)) {
      return redirectToHost(request, url, APEX_HOST);
    }

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

    const response = await handle(request, env, ctx);
    return withHtmlCacheHeader(request, pathname, response);
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
