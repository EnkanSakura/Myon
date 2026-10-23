import { expect, test } from '@playwright/test';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'dev-admin-token';

/**
 * 后台共享组件的回归守卫（见 design-spec.md §9.1）：
 * 开关 .switch / 空状态 .empty / 分页 .pager / 提示条 .notice / 筛选栏 .filterbar
 * 在 admin.css 里各只有一套实现，页面与脚本不得再出现旧的逐页类名。
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
// 注意 .list-state / .m-loading / .gal-loading 属于 loading 态，不在共享组件范围内。
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
  // 筛选栏：统一之前的分页私有实现与令牌条
  '.bar',
  '.bar-note',
  '.tabs2',
  '.tab2',
  '.ftabs',
  '.ftab',
  '.cats',
  '.cat-btns',
  '.list-tools',
  '.list-search',
  '.gal-toolbar',
  '.gal-sort',
  '.tk-bar',
  '.tk-input',
  '.syncbar',
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

  test('开关只有一套：工具页与总览共用 .switch', async ({ page }) => {
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

    // 总览的维护模式开关也是同一套类名
    await page.goto('/admin');
    await expect(page.locator('.lamp .switch').first()).toBeVisible();
  });

  test('后台追番只读：没有行内编辑控件', async ({ page }) => {
    await page.goto('/admin/bangumi');
    await expect(page.locator('#watchList .wrow').first()).toBeVisible();
    expect(
      await page
        .locator(
          '#watchList input, #watchList select, #watchList textarea, #watchList button',
        )
        .count(),
    ).toBe(0);
    await expect(page.locator('#cfmDlg')).toHaveCount(0);
    await expect(page.locator('.notice')).toContainText('只读');
  });

  test('空状态、分页、提示条在媒体库是同一套结构', async ({ page }) => {
    await page.goto('/admin/media');
    await expect(page.locator('.notice.notice--info').first()).toBeVisible();
    await expect(page.locator('.empty').first()).toBeVisible();
    await expect(page.locator('.pager')).toBeVisible();
    await expect(page.locator('.pager-info')).toContainText('每页');
    await expect(page.locator('.pager-btn').first()).toBeVisible();
  });

  test('五页的筛选栏都是 .filterbar，顺序统一', async ({ page }) => {
    const routes = [
      '/admin/articles',
      '/admin/media',
      '/admin/moments',
      '/admin/gallery',
      '/admin/bangumi',
    ];
    for (const route of routes) {
      await page.goto(route);
      const filterbar = page.locator('.filterbar').first();
      await expect(filterbar, `${route} 缺 .filterbar`).toBeVisible();
      await expect(
        filterbar.locator('.fb-chips'),
        `${route} 缺 chips`,
      ).toBeVisible();
      await expect(
        filterbar.locator('.fb-count'),
        `${route} 缺计数`,
      ).toBeVisible();
      await expect(
        filterbar.locator('.fb-clear'),
        `${route} 缺清除`,
      ).toBeVisible();

      const order = await filterbar.evaluate((node) =>
        Array.from(node.children).map((child) => {
          const className =
            typeof child.className === 'string' ? child.className : '';
          if (className.includes('fb-chips')) return 'chips';
          if (className.includes('fb-toggle')) return 'toggle';
          if (className.includes('fb-search')) return 'search';
          if (className.includes('fb-sort')) return 'sort';
          if (className.includes('fb-count')) return 'count';
          if (className.includes('fb-clear')) return 'clear';
          return 'other';
        }),
      );
      const index = (name: string) => (order as string[]).indexOf(name);
      expect(index('chips'), `${route} chips 不在最前`).toBeLessThan(
        index('count'),
      );
      expect(index('count'), `${route} 计数不在清除前`).toBeLessThan(
        index('clear'),
      );
      for (const name of ['search', 'sort']) {
        if (index(name) >= 0) {
          expect(index(name), `${route} ${name} 顺序不对`).toBeGreaterThan(
            index('chips'),
          );
          expect(index(name), `${route} ${name} 顺序不对`).toBeLessThan(
            index('count'),
          );
        }
      }
    }
  });

  test('管理令牌集中在顶栏弹窗，不再散落在各页', async ({ page }) => {
    await page.goto('/admin/settings');
    const open = page.locator('#adminTokenOpen');
    await expect(open).toBeVisible();
    await expect(page.locator('#adminTokenState')).toHaveText('未填写');

    // 各页原有的令牌输入/令牌条都不在了
    await expect(page.locator('#tokenInput')).toHaveCount(0);
    await expect(page.locator('#adminToken')).toHaveCount(0);

    await open.click();
    await expect(page.locator('#adminTokenDlg')).toBeVisible();
    await page.locator('#adminTokenInput').fill(ADMIN_TOKEN);
    await Promise.all([
      page.waitForEvent('load'),
      page.locator('#adminTokenSave').click(),
    ]);

    const stored = await page.evaluate(() =>
      localStorage.getItem('myon-admin-token'),
    );
    expect(stored).toBe(ADMIN_TOKEN);
    await expect(page.locator('#adminTokenState')).toHaveText('已连接');

    // 清除后回到未填写，并且依旧不依赖页面内的输入框
    await page.locator('#adminTokenOpen').click();
    await Promise.all([
      page.waitForEvent('load'),
      page.locator('#adminTokenClear').click(),
    ]);
    expect(
      await page.evaluate(() => localStorage.getItem('myon-admin-token')),
    ).toBeNull();
    await expect(page.locator('#adminTokenState')).toHaveText('未填写');
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
