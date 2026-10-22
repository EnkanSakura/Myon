import { expect, test } from '@playwright/test';

test('七页封面、翻页与深浅色切换', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.p1 h1')).toContainText('灯下的一格');
  await expect(page.locator('#aboutBody h2').first()).toContainText('关于');

  await page.locator('.pager button').nth(1).click();
  await expect(page.locator('#pageSticker')).toContainText('PAGE 02');

  const before = await page.locator('html').getAttribute('data-theme');
  await page.locator('.theme-btn').click();
  await expect(page.locator('html')).not.toHaveAttribute(
    'data-theme',
    before ?? 'light',
  );
});
