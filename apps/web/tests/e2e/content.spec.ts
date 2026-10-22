import { expect, test } from '@playwright/test';

// 列表页数据来自 D1：校验渲染数量、分类筛选与交互仍然可用。
test.describe('文章目次', () => {
  test('渲染真实文章并按分类筛选', async ({ page }) => {
    await page.goto('/articles');
    const rows = page.locator('#list .r');
    const total = await rows.count();
    expect(total).toBeGreaterThan(0);

    await expect(rows.first()).toHaveAttribute('href', /^\/articles\//);

    const tab = page.locator('.tab').nth(1);
    const tag = await tab.getAttribute('data-tag');
    expect(tag).toBeTruthy();
    await tab.click();

    const visible = page.locator('#list .r:visible');
    const count = await visible.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      await expect(visible.nth(i)).toHaveAttribute('data-tag', tag as string);
    }
    await expect(page.locator('#shownCount')).toHaveText(String(count));
  });
});

test.describe('动态流', () => {
  test('渲染动态并可按分类筛选', async ({ page }) => {
    await page.goto('/moments');
    await expect(page.locator('.moment').first()).toBeVisible();
    const total = await page.locator('.moment').count();
    expect(total).toBeGreaterThan(0);

    await page.locator('.tabs .tag[data-tag="技术"]').click();
    const visible = await page.locator('.moment:visible').count();
    expect(visible).toBeGreaterThan(0);
    expect(visible).toBeLessThanOrEqual(total);
  });
});

test.describe('展柜', () => {
  test('渲染藏品，分类筛选与灯箱可用', async ({ page }) => {
    await page.goto('/gallery');
    expect(await page.locator('.ex').count()).toBeGreaterThan(0);

    const tab = page.locator('.tab').nth(1);
    const category = await tab.getAttribute('data-cat');
    expect(category).toBeTruthy();
    await tab.click();

    const visible = page.locator('.ex:visible');
    const count = await visible.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      await expect(visible.nth(i)).toHaveAttribute(
        'data-cat',
        category as string,
      );
    }

    await visible.first().locator('.ex-open').click();
    await expect(page.locator('.lb')).toBeVisible();
    await page.locator('.lb-close').click();
    await expect(page.locator('.lb')).toBeHidden();
  });
});

test.describe('追番', () => {
  test('渲染在追记录与统计', async ({ page }) => {
    await page.goto('/bangumi');
    expect(await page.locator('.program').count()).toBeGreaterThan(0);
    await expect(page.locator('.program').first()).toBeVisible();
  });
});

test.describe('统计接口', () => {
  test('/api/v1/stats 返回内容数量', async ({ request }) => {
    const res = await request.get('/api/v1/stats');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      posts: { published: number };
      moments: { total: number };
      gallery: { total: number; displayed: number };
      bangumi: { total: number; watching: number };
    };
    expect(body.posts.published).toBeGreaterThan(0);
    expect(body.moments.total).toBeGreaterThan(0);
    expect(body.gallery.total).toBeGreaterThanOrEqual(body.gallery.displayed);
    expect(body.bangumi.watching).toBeLessThanOrEqual(body.bangumi.total);
  });
});
