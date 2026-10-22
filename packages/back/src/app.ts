import { API_VERSION, apiBasePath } from '@myon/shared';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import v1 from './routes/v1';
import type { AppBindings } from './types';

/**
 * 组合根：只放跨版本的中间件、基础设施探针和版本挂载。
 * 业务路由按版本放在 `routes/` 下，新增 v2 时在这里多挂一道即可。
 */
const app = new Hono<{ Bindings: AppBindings }>();

app.use('*', secureHeaders());

/**
 * 基础设施探针，刻意不版本化：监控、部署 smoke test、CI 都依赖它保持稳定，
 * 而且它不返回任何业务数据，不存在契约兼容问题。
 */
app.get('/api/health', async (c) => {
  const row = await c.env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
  return c.json({
    ok: row?.ok === 1,
    service: 'myon-blog',
    apiVersion: API_VERSION,
    environment: c.env.ENVIRONMENT,
    time: new Date().toISOString(),
  });
});

app.route(apiBasePath, v1);

app.notFound((c) => c.json({ error: 'not_found' }, 404));

app.onError((err, c) => {
  console.error('API error', err);
  return c.json({ error: 'internal_error' }, 500);
});

export default app;
