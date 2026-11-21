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

  test('正文保留换行，点击卡片打开详情对话框', async ({ page }) => {
    await page.goto('/moments');
    const card = page.locator('.moment').first();
    await expect(card).toBeVisible();

    const body = card.locator('.moment-body');
    await expect(body).toBeVisible();
    expect(
      await body.evaluate((node) => getComputedStyle(node).whiteSpace),
    ).toBe('pre-wrap');
    const bodyText = await body.evaluate((node) => node.textContent);
    const category = (await card.getAttribute('data-tag')) ?? '';

    await card.locator('.moment-hit').click();
    await expect(page.locator('#momentView')).toHaveAttribute('open', '');
    expect(
      await page.locator('#mvBody').evaluate((node) => node.textContent),
    ).toBe(bodyText);
    await expect(page.locator('#mvCat')).toHaveText(category);

    await page.locator('#mvClose').click();
    await expect(page.locator('#momentView')).not.toHaveAttribute('open', '');

    // 点击弹窗外的背景也能关闭（closedby="any" 或坐标兜底）
    await card.locator('.moment-hit').click();
    await expect(page.locator('#momentView')).toHaveAttribute('open', '');
    await page.mouse.click(5, 5);
    await expect(page.locator('#momentView')).not.toHaveAttribute('open', '');
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

    // 点背景关闭：closedby="any" 或坐标兜底
    await visible.first().locator('.ex-open').click();
    await expect(page.locator('.lb')).toBeVisible();
    // 不再用 overflow:hidden 锁 html，避免滚动条消失造成横向抖动
    expect(
      await page.evaluate(
        () => getComputedStyle(document.documentElement).overflowY,
      ),
    ).not.toBe('hidden');
    await page.mouse.click(5, 5);
    await expect(page.locator('.lb')).toBeHidden();
  });
});

test.describe('追番', () => {
  test('状态存档标题不被面板标签遮挡', async ({ page }) => {
    await page.goto('/bangumi');
    const tab = await page.locator('.archive .panel-tab').boundingBox();
    const title = await page.locator('#archiveTitle').boundingBox();
    if (!tab || !title) throw new Error('状态存档缺少面板标签或标题');
    expect(title.y).toBeGreaterThanOrEqual(tab.y + tab.height);
  });

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
