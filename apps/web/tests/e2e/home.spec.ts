import { expect, test } from '@playwright/test';

test('七页封面、翻页与深浅色切换', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.p1 .copy h1')).toContainText('灯下的一格');
  // 关于卡由服务端渲染；内容来自 D1（可能是任意真实文案），这里只校验有结构化内容。
  expect(await page.locator('#aboutBody > *').count()).toBeGreaterThan(0);

  await page.locator('.pager button').nth(1).click();
  await expect(page.locator('#pageSticker')).toContainText('PAGE 02');

  const before = await page.locator('html').getAttribute('data-theme');
  await page.locator('.theme-btn').click();
  await expect(page.locator('html')).not.toHaveAttribute(
    'data-theme',
    before ?? 'light',
  );
});

test('尾页后记文案来自后台设置', async ({ page }) => {
  await page.goto('/');
  const end = page.locator('.p7');
  await expect(end.locator('h2')).toContainText('谢谢翻完');
  await expect(end.locator('.after')).toContainText('如果哪一件你也喜欢');
  await expect(end.locator('.letter')).toContainText('第七页');
  await expect(end.locator('.thank')).toContainText('Myon');
});

test('第 2 页最近文章来自 D1', async ({ page }) => {
  await page.goto('/');
  const rows = page.locator('.p2 .rows .r');
  expect(await rows.count()).toBeGreaterThan(0);
  for (let i = 0; i < (await rows.count()); i += 1) {
    await expect(rows.nth(i)).toHaveAttribute('href', /^\/articles\/[^/]+$/);
  }
  await expect(page.locator('.p2 .rows-empty')).toHaveCount(0);
});
