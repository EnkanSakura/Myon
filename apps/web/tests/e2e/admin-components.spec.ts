import { expect, test } from '@playwright/test';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'dev-admin-token';

/**
 * 后台四类共享组件的回归守卫（见 design-spec.md §9.1）：
 * 开关 .switch / 空状态 .empty / 分页 .pager / 提示条 .notice 在 admin.css 里各只有一套实现，
 * 页面与脚本不得再出现旧的逐页类名，也不得退化回多套结构。
 */
const ADMIN_ROUTES = [
  '/admin',
  '/admin/articles',
  '/admin/moments',
  '/admin/gallery',
  '/admin/bangumi',
  '/admin/media',
  '/admin/settings',
  '/admin/tools',
  '/admin/about',
];

// 旧类名清单：命中任意一个都说明又有人另造了一套。
// 注意 .list-state / .m-loading / .gal-loading 属于 loading 态，不在四类组件范围内。
const LEGACY_SELECTORS = [
  '.tsw',
  '.sw-track',
  '.sw-knob',
  '.sw',
  '.pager2',
  '.pg-info',
  '.pg-btns',
  '.pg-nums',
  '.pg-gap',
  '.pg-btn',
  '.list-banner',
  '.auth-banner',
  '.am-banner',
  '.set-banner',
  '.tbanner',
  '.tbl-empty',
  '.m-empty',
  '.gal-state',
  '.row-empty',
  '.empty-notes',
];

test.describe('后台共享组件', () => {
  test('九个后台页都不再出现旧的逐页类名', async ({ page }) => {
    for (const route of ADMIN_ROUTES) {
      await page.goto(route);
      const legacyCount = await page.evaluate(
        (selectors) =>
          selectors.reduce(
            (sum, selector) => sum + document.querySelectorAll(selector).length,
            0,
          ),
        LEGACY_SELECTORS,
      );
      expect(legacyCount, `${route} 仍有旧组件类名`).toBe(0);
    }
  });

  test('开关只有一套：工具页、设置页与总览共用 .switch', async ({ page }) => {
    // 工具列表来自 D1，需要先注入管理令牌才会渲染出行
    await page.addInitScript((token) => {
      localStorage.setItem('myon-admin-token', token);
    }, ADMIN_TOKEN);
    await page.goto('/admin/tools');
    const switches = page.locator('.switch');
    await expect(switches.first()).toBeVisible();
    expect(await switches.count()).toBeGreaterThan(0);

    const first = switches.first();
    await expect(first).toHaveAttribute('role', 'switch');
    await expect(first).toHaveAttribute('aria-checked', 'true');
    // 不在用例里点开关，避免改本地 D1 的工具启停状态

    // 设置页与总览的开关也必须是同一套类名
    await page.goto('/admin/settings');
    await expect(page.locator('.switch').first()).toBeVisible();
    await page.goto('/admin');
    await expect(page.locator('.lamp .switch').first()).toBeVisible();
  });

  test('空状态、分页、提示条在媒体库是同一套结构', async ({ page }) => {
    await page.goto('/admin/media');
    await expect(page.locator('.notice.notice--info').first()).toBeVisible();
    await expect(page.locator('.empty').first()).toBeVisible();
    await expect(page.locator('.pager')).toBeVisible();
    await expect(page.locator('.pager-info')).toContainText('每页');
    await expect(page.locator('.pager-btn').first()).toBeVisible();
  });

  test('六个有异步数据的后台页都有 .notice，四个分页页都有 .pager', async ({
    page,
  }) => {
    const withNotice = [
      '/admin/articles',
      '/admin/moments',
      '/admin/gallery',
      '/admin/bangumi',
      '/admin/media',
      '/admin/settings',
    ];
    for (const route of withNotice) {
      await page.goto(route);
      const notice = page.locator('.notice').first();
      await expect(notice, `${route} 缺 .notice`).toBeVisible();
    }

    const withPager = [
      '/admin/articles',
      '/admin/moments',
      '/admin/gallery',
      '/admin/media',
    ];
    for (const route of withPager) {
      await page.goto(route);
      // 无数据 / 未填令牌时分页整条是 hidden 的，这里只要求结构存在且是同一套类名
      const pager = page.locator('.pager').first();
      await expect(pager, `${route} 缺 .pager`).toBeAttached();
    }
  });
});
