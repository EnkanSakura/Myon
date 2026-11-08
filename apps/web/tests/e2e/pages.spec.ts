import { expect, test } from '@playwright/test';

/** 内容图片记录 → 前台 URL：老数据没有尺寸记录时按默认 720，orig 不带转换参数（对齐 lib/media.ts）。 */
function contentSrc(item: {
  mediaKey: string | null;
  mediaSize?: string | null;
}): string {
  const key = item.mediaKey ?? '';
  const base = /^(?:https?:)?\/\//.test(key)
    ? key
    : key.startsWith('/assets/')
      ? `/media/${key.slice('/assets/'.length)}`
      : key.startsWith('/')
        ? key
        : `/media/${key}`;
  const size = item.mediaSize ?? '720';
  if (!base.startsWith('/media/') || size === 'orig') return base;
  return `${base}?size=${size}&q=80`;
}

// 前台房间、工具页与九个后台页面的路由覆盖（首页标题来自站点设置，单独断言）。
const routes = [
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
  test('/ 正常渲染', async ({ page, request }) => {
    const res = await request.get('/api/v1/site');
    expect(res.status()).toBe(200);
    const { settings } = (await res.json()) as {
      settings: { home: { title: string } };
    };
    const nav = await page.goto('/');
    expect(nav?.status()).toBe(200);
    await expect(page.locator('h1').first()).toContainText(settings.home.title);
    await expect(page.locator('a[href$=".html"]')).toHaveCount(0);
  });

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

test.describe('图片转换地址', () => {
  // 只断言 URL 参数：本地种子图 480×360，720/1600 都会回退原图，像素不可靠。
  test('动态配图按记录尺寸取图，老数据默认 720', async ({ page, request }) => {
    await page.goto('/moments');
    const srcs = await page
      .locator('.stream .frame.f-photo img')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('src') ?? ''),
      );
    expect(srcs.length).toBeGreaterThan(0);

    // 后台 CRUD 用例会并行增删动态，按集合核对而不是绑定瞬时条数。
    const body = (await (
      await request.get('/api/v1/moments?limit=12')
    ).json()) as {
      items: { mediaKey: string | null; mediaSize?: string | null }[];
    };
    const expected = new Set(
      body.items.filter((item) => item.mediaKey).map(contentSrc),
    );
    for (const src of srcs) expect(expected.has(src)).toBe(true);
    // 种子里有没记录尺寸档位的旧动态，必须落到默认 720。
    expect(srcs.some((src) => src.endsWith('?size=720&q=80'))).toBe(true);
  });

  test('展柜网格与灯箱使用同一张转换图', async ({ page, request }) => {
    await page.goto('/gallery');
    const srcs = await page
      .locator('.gal-grid .ex .frame img')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('src') ?? ''),
      );
    expect(srcs.length).toBeGreaterThan(0);

    const body = (await (
      await request.get('/api/v1/gallery?limit=24')
    ).json()) as {
      items: { mediaKey: string | null; mediaSize?: string | null }[];
    };
    const expected = new Set(
      body.items.filter((item) => item.mediaKey).map(contentSrc),
    );
    for (const src of srcs) expect(expected.has(src)).toBe(true);
    expect(srcs.some((src) => src.endsWith('?size=720&q=80'))).toBe(true);

    // 去滤镜后照片按原色显示：网格图默认与 hover 状态都不叠 grayscale。
    const gridImg = page.locator('.gal-grid .ex .frame img').first();
    expect(await gridImg.evaluate((el) => getComputedStyle(el).filter)).toBe(
      'none',
    );
    await gridImg.hover();
    expect(await gridImg.evaluate((el) => getComputedStyle(el).filter)).toBe(
      'none',
    );

    // 灯箱不单独拼地址：点开有图的展品后直接沿用卡片 img 的 src。
    const card = page
      .locator('.gal-grid .ex')
      .filter({ has: page.locator('img') })
      .first();
    const cardSrc = await card.locator('img').getAttribute('src');
    expect(cardSrc).toBeTruthy();
    // 深色模式下遮罩也必须变暗，不能因为 --ink 翻成纸白色而发白。
    await page.evaluate(() =>
      document.documentElement.setAttribute('data-theme', 'dark'),
    );
    await card.locator('.ex-open').click();
    await expect(page.locator('.lb')).toBeVisible();
    await expect(page.locator('#lbImg')).toHaveAttribute('src', cardSrc ?? '');
    const backdrop = await page.locator('.lb').evaluate((element) => {
      const style = getComputedStyle(element, '::backdrop');
      return { color: style.backgroundColor, filter: style.backdropFilter };
    });
    expect(backdrop.color).toBe('rgba(0, 0, 0, 0.72)');
    expect(backdrop.filter).toBe('none');
  });
});
