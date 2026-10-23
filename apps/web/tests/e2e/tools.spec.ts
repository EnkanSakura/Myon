import { expect, test } from '@playwright/test';

// 工具页曾经是设计稿静态数据；这里保证 /tools 与 /tools/<slug> 都来自 D1。
// 工具索引与单工具页共用同一份 GET /api/v1/tools（只含启用项）。
type PublicTool = {
  slug: string;
  name: string;
  toolKey: string | null;
  href: string | null;
  enabled: boolean;
};

test.describe('工具页与真实数据', () => {
  test('/api/v1/tools 每项都带 slug', async ({ request }) => {
    const res = await request.get('/api/v1/tools');
    expect(res.status()).toBe(200);
    const { items } = (await res.json()) as { items: PublicTool[] };
    expect(items.length).toBeGreaterThan(0);

    for (const item of items) {
      expect(item.slug.length).toBeGreaterThanOrEqual(2);
      expect(item.slug.length).toBeLessThanOrEqual(40);
      expect(item.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(item.enabled).toBe(true);
    }
  });

  test('前台 /tools 列表与 API 一致，每项链接到 /tools/<slug>', async ({
    page,
    request,
  }) => {
    const res = await request.get('/api/v1/tools');
    expect(res.status()).toBe(200);
    const { items } = (await res.json()) as { items: PublicTool[] };
    expect(items.length).toBeGreaterThan(0);

    await page.goto('/tools');
    await expect(page.locator('.tool')).toHaveCount(items.length);

    for (const item of items) {
      await expect(
        page.locator(`.tool[href="/tools/${item.slug}"]`),
      ).toHaveCount(1);
    }
    for (const item of items.slice(0, 3)) {
      await expect(
        page.locator('.tool').filter({ hasText: item.name }).first(),
      ).toBeVisible();
    }

    // 设计稿里的假调用统计不应再出现
    await expect(page.locator('body')).not.toContainText('8,367');
    await expect(page.locator('body')).not.toContainText('本月调用');
  });

  test('直接访问 /tools/timestamp 打开时间戳工具', async ({ page }) => {
    const res = await page.goto('/tools/timestamp');
    expect(res?.status()).toBe(200);
    await expect(page.locator('h1').first()).toContainText('时间戳转换');
    await expect(page.locator('a[href="/tools"]').first()).toBeVisible();

    // 换算在浏览器里完成：填 0 秒应立刻得到 UTC+8 的 1970-01-01 08:00:00
    const input = page.locator('#tsInput');
    await expect(input).toBeVisible();
    await input.fill('0');
    await expect(page.locator('#resTime')).toContainText('1970-01-01 08:00:00');
  });

  test('不存在的工具返回 404 空态', async ({ page }) => {
    const res = await page.goto('/tools/no-such-tool');
    expect(res?.status()).toBe(404);
    await expect(page.locator('h1')).toContainText('工具不存在');
    await expect(page.locator('a[href="/tools"]').first()).toBeVisible();
  });

  test('后台总览不再展示设计稿假数据', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.locator('h1').first()).toContainText('总览');
    const body = page.locator('body');
    await expect(body).not.toContainText('示例数据');
    await expect(body).not.toContainText('占位数据');
    await expect(body).not.toContainText('24,318');
    await expect(body).not.toContainText('38 MB');
    await expect(body).not.toContainText('2a1f3c9');
  });

  test('traffic 接口返回真实结构', async ({ request }) => {
    const trafficRes = await request.get('/api/v1/traffic');
    expect(trafficRes.status()).toBe(200);
    const traffic = (await trafficRes.json()) as {
      days: { date: string; pv: number; uv: number }[];
      totals: { pv: number; uv: number };
      today: { date: string; pv: number; uv: number };
    };
    expect(traffic.days).toHaveLength(30);
    expect(traffic.totals.pv).toBeGreaterThanOrEqual(0);
    expect(traffic.days[29]).toEqual(traffic.today);
  });
});
