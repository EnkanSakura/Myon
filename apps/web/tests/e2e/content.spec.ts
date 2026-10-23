import { expect, test } from '@playwright/test';

// 列表页数据来自 D1：校验渲染数量、分类筛选与交互仍然可用。
test.describe('文章目次', () => {
  test('渲染真实文章并按分类筛选', async ({ page }) => {
    await page.goto('/articles');
    const rows = page.locator('#list .r');
    const total = await rows.count();
    expect(total).toBeGreaterThan(0);

    await expect(rows.first()).toHaveAttribute('href', /^\/articles\//);

    const tab = page.locator('.filterbar-tab').nth(1);
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

    await page.locator('.filterbar-tab[data-tag="技术"]').click();
    const visible = await page.locator('.moment:visible').count();
    expect(visible).toBeGreaterThan(0);
    expect(visible).toBeLessThanOrEqual(total);
  });
});

test.describe('展柜', () => {
  test('渲染藏品，分类筛选与灯箱可用', async ({ page }) => {
    await page.goto('/gallery');
    expect(await page.locator('.ex').count()).toBeGreaterThan(0);
    // 展品上的固定 sticker / 展签 / NEW 已删除，展签只在 hover 时浮出。
    expect(
      await page.locator('.ex .sticker, .ex .ex-meta, .ex .cap').count(),
    ).toBe(0);

    const tab = page.locator('.filterbar-tab').nth(1);
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

    const noteFigure = page.locator('.ex:has(.ex-note)').first();
    if ((await noteFigure.count()) > 0) {
      const note = noteFigure.locator('.ex-note');
      await expect(note).toHaveCSS('opacity', '0');
      await noteFigure.hover();
      await expect(note).toHaveCSS('opacity', '1');
      await expect(note.locator('.ex-note-k')).toHaveText(/^[A-Z]-\d{3} \//);
      await expect(note.locator('.ex-note-name')).not.toBeEmpty();
    }

    await visible.first().locator('.ex-open').click();
    await expect(page.locator('.lb')).toBeVisible();
    await page.locator('.lb-close').click();
    await expect(page.locator('.lb')).toBeHidden();
  });
});

test.describe('追番', () => {
  test('渲染总览、分类筛选与记录', async ({ page }) => {
    await page.goto('/bangumi');
    await expect(page.locator('h1').first()).toContainText('追番');
    expect(await page.locator('.record').count()).toBeGreaterThan(0);
    await expect(page.locator('.record').first()).toBeVisible();

    await page.locator('.filterbar-tab', { hasText: '动画' }).click();
    await expect(page).toHaveURL(/type=anime/);
    await expect(page.locator('.filterbar-tab.is-on')).toContainText('动画');
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
