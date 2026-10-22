import { expect, test } from '@playwright/test';

// 单测直接调 app.request，绕过了 Astro catch-all 的转发层；
// 这里跑真实 Worker 运行时，确认 /api/v1/* 在前端路由下也通。
test.describe('API 版本化', () => {
  test('health 保持不版本化，并报告当前 API 版本', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { ok: boolean; apiVersion: string };
    expect(body.ok).toBe(true);
    expect(body.apiVersion).toBe('v1');
  });

  test('内容接口在 /api/v1 下可用', async ({ request }) => {
    const posts = await request.get('/api/v1/posts');
    expect(posts.status()).toBe(200);
    expect(await posts.json()).toHaveProperty('items');

    const about = await request.get('/api/v1/about');
    expect(about.status()).toBe(200);
    expect(await about.json()).toMatchObject({ key: 'about' });
  });

  test('图标接口校验 Iconify 名称', async ({ request }) => {
    const empty = await request.get('/api/v1/icons');
    expect(empty.status()).toBe(200);
    expect(await empty.json()).toEqual({ icons: [] });

    const invalid = await request.get(
      `/api/v1/icons?names=${encodeURIComponent('<i class="x"></i>')}`,
    );
    expect(invalid.status()).toBe(400);
    expect(await invalid.json()).toEqual({ error: 'invalid_icon_name' });
  });

  test('旧的未版本化内容接口已下线', async ({ request }) => {
    const res = await request.get('/api/about');
    expect(res.status()).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});
