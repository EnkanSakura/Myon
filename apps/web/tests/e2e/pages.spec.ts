import { expect, test } from '@playwright/test';

// 前台房间、工具页与九个后台页面的路由覆盖。
const routes = [
  { path: '/', heading: '灯下的一格' },
  { path: '/articles', heading: '文章' },
  { path: '/moments', heading: '动态' },
  { path: '/gallery', heading: '展柜' },
  { path: '/bangumi', heading: '追番' },
  { path: '/tools', heading: '工具' },
  { path: '/tools/timestamp', heading: '时间戳转换' },
  { path: '/admin', heading: '总览' },
  { path: '/admin/articles', heading: '文章' },
  { path: '/admin/moments', heading: '动态' },
  { path: '/admin/gallery', heading: '展柜' },
  { path: '/admin/bangumi', heading: '追番' },
  { path: '/admin/media', heading: '媒体库' },
  { path: '/admin/tools', heading: '工具' },
  { path: '/admin/settings', heading: '设置' },
  { path: '/admin/about', heading: '关于' },
];

test.describe('页面路由', () => {
  for (const route of routes) {
    test(`${route.path} 正常渲染`, async ({ page }) => {
      const res = await page.goto(route.path);
      expect(res?.status()).toBe(200);
      await expect(page.locator('h1').first()).toContainText(route.heading);
      // 迁移后不应再有指向设计稿 .html 的链接
      await expect(page.locator('a[href$=".html"]')).toHaveCount(0);
    });
  }
});

test.describe('文章详情', () => {
  test('正文与目录来自 D1', async ({ page }) => {
    const res = await page.goto('/articles/cloudflare-workers-blog');
    expect(res?.status()).toBe(200);
    await expect(page.locator('.art-head h1')).toContainText(
      'Cloudflare Workers',
    );

    const headings = page.locator('.body h2[id]');
    await expect(headings.first()).toBeVisible();
    await expect(page.locator('.toc a')).toHaveCount(await headings.count());
  });

  test('不存在的文章返回 404', async ({ page }) => {
    const res = await page.goto('/articles/no-such-post');
    expect(res?.status()).toBe(404);
    await expect(page.locator('h1')).toContainText('这篇还没写下');
  });
});
