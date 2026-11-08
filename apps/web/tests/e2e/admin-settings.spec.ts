import { expect, type Page, test } from '@playwright/test';

// 后台设置页只编辑 KV 里的运行时配置（站点 / 首页图片与联系方式 / 外观 / 页脚 / 后记）。
// 首页固定文案（标题/导语/页头标签说明/数据块/封面贴纸便签/尾页标题导语）
// 已迁到 @myon/shared 的 i18n 与 site.config.json，设置页不再出现这些输入框。
//
// 这里用固定 fixture 把后台设置的读写接口拦在内存里：保存回读都能测到，
// 又不会污染本地 KV（其他 e2e 用例共用同一份站点设置）。
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'dev-admin-token';

/** 首页联系方式默认 fixture：4 条，字段与 @myon/shared 的 HomeLink 一致。 */
const LINKS_FIXTURE = [
  { label: '写邮件', href: 'mailto:hi@myon.studio' },
  { label: 'GitHub', href: 'https://github.com/Myon' },
  { label: 'Bangumi', href: 'https://bgm.tv/' },
  { label: 'RSS', href: '/rss.xml' },
];

/** 与 @myon/shared 的 defaultSiteSettings 对齐的最小 fixture（只放设置页会读的键）。 */
const SETTINGS_FIXTURE: Record<string, string> = {
  site_name: 'Myon',
  site_subtitle: '同人志',
  site_description: '一个人的二次元生活志',
  site_author: 'Myon',
  theme_color: '#EC88C2',
  footer_tech: 'Astro · Cloudflare Workers · D1 · R2',
  footer_icp: '京ICP备 2026000000 号',
  footer_rss: '/rss.xml',
  footer_email: 'hi@myon.studio',
  home_links: JSON.stringify(LINKS_FIXTURE),
  home_cover_image: '/media/cabinet.jpg',
  home_p2_figure_a: '',
  home_p2_figure_b: '',
  home_afterword_body:
    '这一册做到第七页的时候，窗外刚好天亮了。\n下一册想多放一点动画截图和旅行速写。',
  home_afterword_sign: '—— Myon，于 10 月的某个凌晨',
  home_afterword_next: 'NEXT ISSUE · ？',
  maintenance_enabled: 'false',
};

/** 已从 KV / 设置页移除的键：保存时不应再被提交。 */
const REMOVED_KEYS = [
  'home_title',
  'home_lead',
  'home_page_labels',
  'home_page_notes',
  'home_cover_badge',
  'home_cover_note',
  'home_stats',
  'home_end_title',
  'home_end_lead',
  'site_email',
  'footer_copyright',
  'default_theme',
  'comments_enabled',
];

interface MockedSettings {
  readSettings: () => Record<string, string>;
}

/** 用内存 fixture 顶住设置接口，返回当前保存值。 */
async function openMockedSettings(page: Page): Promise<MockedSettings> {
  let settings = { ...SETTINGS_FIXTURE };

  await page.route('**/api/v1/admin/settings', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({ json: { settings } });
      return;
    }
    if (method === 'PUT') {
      settings = {
        ...settings,
        ...(route.request().postDataJSON() as Record<string, string>),
      };
      await route.fulfill({ json: { settings } });
      return;
    }
    await route.continue();
  });
  await page.addInitScript((token) => {
    localStorage.setItem('myon-admin-token', token);
  }, ADMIN_TOKEN);

  await page.goto('/admin/settings');
  await expect(page.locator('#siteName')).toHaveValue(
    SETTINGS_FIXTURE.site_name as string,
  );
  return { readSettings: () => settings };
}

// 媒体选择器 mock 用的一条图：选中后应该填 /media/<key>
const PICK_MEDIA_ITEM = {
  id: 'media-e2e-pick',
  key: 'uploads/202601/e2e-pick.webp',
  filename: 'e2e-pick.webp',
  mime: 'image/webp',
  size: 3072,
  width: 640,
  height: 480,
  createdAt: '2026-01-03T00:00:00.000Z',
};

/** 「媒体库」按钮打开共享媒体选择器后会按需请求媒体列表，这里只 mock 列表接口。 */
async function mockMediaList(page: Page) {
  await page.route('**/api/v1/admin/media**', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      json: {
        items: [PICK_MEDIA_ITEM],
        total: 1,
        limit: 100,
        offset: 0,
      },
    });
  });
}

test.describe('后台设置 · 运行时配置页', () => {
  test('已移除的字段不再出现，剩下的运行时配置可以保存并回读', async ({
    page,
  }) => {
    const { readSettings } = await openMockedSettings(page);

    // 已静态化的首页文案 / 旧死配置都不在页面里了（联系方式编辑器是保留的）
    for (const selector of [
      // 首页固定文案与数据块行编辑器
      '#homeTitle',
      '#homeLead',
      '#homePageLabels',
      '#homePageNotes',
      '#homeStatsRows',
      '#homeStatsAdd',
      '#homeCoverBadge',
      '#homeCoverNote',
      '#homeEndTitle',
      '#homeEndLead',
      '.page-labels',
      '.page-notes',
      // 历史死配置
      '#siteEmail',
      '#footerCopyright',
      '#swComments',
      '#themeSeg',
      '#deployState',
      '#feedPreview',
      '#btnPurge',
      '#btnExport',
      '#btnRebuild',
      '.sp--danger',
      '.sp--token',
      '.page-note',
    ]) {
      await expect(
        page.locator(selector),
        `${selector} 应该被删除`,
      ).toHaveCount(0);
    }

    // 保留的分区：基本信息 / 首页（图片 + 联系方式）/ 外观 / 页脚 / 后记
    await expect(page.locator('#cat-site')).toHaveText('站点');
    await expect(page.locator('#cat-home')).toHaveText('首页');
    await expect(page.locator('#cat-theme')).toHaveText('外观');
    await expect(page.locator('#cat-footer')).toHaveText('页脚');
    await expect(page.locator('#cat-end')).toHaveText('尾页 / 后记');
    await expect(page.locator('#homeCoverImage')).toHaveValue(
      SETTINGS_FIXTURE.home_cover_image as string,
    );
    // 联系方式行编辑器已恢复：默认 4 行 + 添加按钮
    await expect(page.locator('#homeLinksRows .row')).toHaveCount(4);
    await expect(page.locator('#homeLinksAdd')).toBeVisible();
    await expect(page.locator('#homeLinksCount')).toHaveText('4 / 6');

    // 站点 / 外观 / 页脚 / 后记：改完保存，接口只收到改动过的键
    const subtitle = `副标题 ${Date.now()}`;
    const sign = '—— E2E 落款';
    await page.locator('#siteSubtitle').fill(subtitle);
    await page.locator('#themeColorText').fill('#3366FF');
    await page.locator('#footerRss').fill('/feed.xml');
    await page.locator('#footerEmail').fill('e2e@myon.studio');
    await page
      .locator('#homeAfterwordBody')
      .fill('第一段后记。\n\n第二段后记。');
    await page.locator('#homeAfterwordSign').fill(sign);
    await page.locator('#homeAfterwordNext').fill('NEXT ISSUE · 测试');
    await expect(page.locator('#saveState')).toContainText('有未保存的修改');

    await page.locator('#saveBtn').click();
    await expect(page.locator('#saveState')).toContainText('最后保存');

    const saved = readSettings();
    expect(saved.site_subtitle).toBe(subtitle);
    expect(saved.theme_color).toBe('#3366FF');
    expect(saved.footer_rss).toBe('/feed.xml');
    expect(saved.footer_email).toBe('e2e@myon.studio');
    expect(saved.home_afterword_body).toBe('第一段后记。\n\n第二段后记。');
    expect(saved.home_afterword_sign).toBe(sign);
    expect(saved.home_afterword_next).toBe('NEXT ISSUE · 测试');
    // 已移除的键不会被提交
    for (const key of REMOVED_KEYS) {
      expect(saved[key], `${key} 不应再被提交`).toBeUndefined();
    }

    // 重新加载后仍能读到服务端保存的值
    await page.reload();
    await expect(page.locator('#siteSubtitle')).toHaveValue(subtitle);
    await expect(page.locator('#themeColorText')).toHaveValue('#3366FF');
    await expect(page.locator('#homeAfterwordSign')).toHaveValue(sign);
  });
});

test.describe('后台设置 · 第 2 页装饰图', () => {
  test('两个装饰图输入框随设置一起保存', async ({ page }) => {
    const { readSettings } = await openMockedSettings(page);

    const figureA = page.locator('#homeFigureA');
    const figureB = page.locator('#homeFigureB');
    await expect(figureA).toHaveAttribute('name', 'home_p2_figure_a');
    await expect(figureB).toHaveAttribute('name', 'home_p2_figure_b');

    // 留空是允许的（前台沿用封面图）；填了站内路径就随设置保存
    await figureA.fill('/media/p2-figure-a.webp');
    await figureB.fill('https://example.com/p2-figure-b.webp');
    await page.locator('#saveBtn').click();
    await expect(page.locator('#saveState')).toContainText('最后保存');

    const saved = readSettings();
    expect(saved.home_p2_figure_a).toBe('/media/p2-figure-a.webp');
    expect(saved.home_p2_figure_b).toBe('https://example.com/p2-figure-b.webp');
  });
});

test.describe('后台设置 · 首页联系方式', () => {
  test('默认 4 行，编辑 / 排序 / 添加 / 删除后保存并回读', async ({ page }) => {
    const { readSettings } = await openMockedSettings(page);
    const rows = page.locator('#homeLinksRows .row');
    await expect(rows).toHaveCount(4);
    await expect(page.locator('#homeLinksCount')).toHaveText('4 / 6');
    // 每行都有拖拽把手（也可以继续用 ↑ ↓ 排序）
    await expect(page.locator('#homeLinksRows .row-grip')).toHaveCount(4);

    // 编辑第一行：标签 / 链接 / 图标
    const first = rows.first();
    await first.locator('[data-key="label"]').fill('邮件联系');
    await first.locator('[data-key="href"]').fill('mailto:hello@myon.studio');
    await first.locator('[data-key="icon"]').fill('ri:mail-fill');
    await expect(page.locator('#saveState')).toContainText('有未保存的修改');

    // 把第一行下移一位：顺序变成 [GitHub, 邮件联系, Bangumi, RSS]
    await first.locator('[data-move="down"]').click();
    await expect(rows.first().locator('[data-key="label"]')).toHaveValue(
      'GitHub',
    );
    await expect(rows.nth(1).locator('[data-key="label"]')).toHaveValue(
      '邮件联系',
    );

    // 添加一行并填写，再删掉：计数与空态/按钮跟随行数
    await page.locator('#homeLinksAdd').click();
    await expect(rows).toHaveCount(5);
    await expect(page.locator('#homeLinksCount')).toHaveText('5 / 6');
    const added = rows.last();
    await added.locator('[data-key="label"]').fill('临时链接');
    await added.locator('[data-key="href"]').fill('/about');
    await added.locator('.row-del').click();
    await expect(rows).toHaveCount(4);
    await expect(page.locator('#homeLinksCount')).toHaveText('4 / 6');

    await page.locator('#saveBtn').click();
    await expect(page.locator('#saveState')).toContainText('最后保存');

    const saved = JSON.parse(readSettings().home_links ?? '[]') as {
      label: string;
      href: string;
      icon?: string;
    }[];
    expect(saved).toEqual([
      { label: 'GitHub', href: 'https://github.com/Myon' },
      {
        label: '邮件联系',
        href: 'mailto:hello@myon.studio',
        icon: 'ri:mail-fill',
      },
      { label: 'Bangumi', href: 'https://bgm.tv/' },
      { label: 'RSS', href: '/rss.xml' },
    ]);

    // 重新加载后从接口回读同一份顺序
    await page.reload();
    await expect(rows).toHaveCount(4);
    await expect(rows.first().locator('[data-key="label"]')).toHaveValue(
      'GitHub',
    );
    await expect(rows.nth(1).locator('[data-key="label"]')).toHaveValue(
      '邮件联系',
    );
    await expect(rows.nth(1).locator('[data-key="icon"]')).toHaveValue(
      'ri:mail-fill',
    );
  });

  test('非法链接 / 图标报错，最多 6 条后禁用添加', async ({ page }) => {
    const { readSettings } = await openMockedSettings(page);
    const rows = page.locator('#homeLinksRows .row');
    const original = readSettings().home_links;

    // 非法链接：前后端同样的协议白名单，保存前就被拦下
    await rows.first().locator('[data-key="href"]').fill('not-a-link');
    await page.locator('#saveBtn').click();
    await expect(page.locator('#homeLinksErr')).toBeVisible();
    await expect(page.locator('#homeLinksErr')).toContainText('http(s)://');
    await expect(rows.first()).toHaveClass(/is-invalid/);
    expect(readSettings().home_links).toBe(original);

    // 链接改对、图标非法
    await rows
      .first()
      .locator('[data-key="href"]')
      .fill('https://example.com/');
    await rows.first().locator('[data-key="icon"]').fill('not an icon');
    await page.locator('#saveBtn').click();
    await expect(page.locator('#homeLinksErr')).toBeVisible();
    await expect(page.locator('#homeLinksErr')).toContainText('Iconify');
    expect(readSettings().home_links).toBe(original);

    // 图标改对后保存成功
    await rows.first().locator('[data-key="label"]').fill('官网');
    await rows.first().locator('[data-key="icon"]').fill('ri:links-line');
    await page.locator('#saveBtn').click();
    await expect(page.locator('#saveState')).toContainText('最后保存');
    const saved = JSON.parse(readSettings().home_links ?? '[]') as {
      label: string;
      href: string;
      icon?: string;
    }[];
    expect(saved[0]).toEqual({
      label: '官网',
      href: 'https://example.com/',
      icon: 'ri:links-line',
    });

    // 上限 6 条：加满后按钮禁用、计数到 6 / 6
    await page.locator('#homeLinksAdd').click();
    await expect(page.locator('#homeLinksCount')).toHaveText('5 / 6');
    await page.locator('#homeLinksAdd').click();
    await expect(rows).toHaveCount(6);
    await expect(page.locator('#homeLinksCount')).toHaveText('6 / 6');
    await expect(page.locator('#homeLinksAdd')).toBeDisabled();
  });
});

test.describe('后台设置 · 图片路径媒体选择器', () => {
  test('点文件夹图标选图后填入 /media/<key> 并关闭选择器', async ({ page }) => {
    await openMockedSettings(page);
    await mockMediaList(page);
    await expect(page.locator('#saveBtn')).toBeEnabled();

    // 文件夹图标按钮在输入框前面、同一行，复用共享媒体选择器
    const picker = page.locator('[data-media-pick="homeCoverImage"]');
    await expect(picker.locator('svg')).toHaveCount(1);
    await expect(picker).toHaveAttribute('aria-label', /媒体库/);
    const order = await page
      .locator('.path-row')
      .first()
      .evaluate((row) =>
        Array.from(row.children).map((child) => child.tagName),
      );
    expect(order.slice(0, 2)).toEqual(['BUTTON', 'INPUT']);

    await picker.click();
    await expect(page.locator('#mediaPickerDlg')).toHaveAttribute('open', '');
    // 设置页只选图片路径，不传尺寸档位：尺寸栏整条隐藏，行为与改版前一致
    await expect(page.locator('#mpSize')).toBeHidden();
    await expect(page.locator('#mpSize .mp-size-btn')).toHaveCount(0);
    // 选择器默认「上传新图」，切到现有图片才加载媒体库
    await page.locator('#mpTabExisting').click();
    await expect(page.locator('#mpGrid .mp-item')).toHaveCount(1);

    await page.locator('#mpGrid .mp-item').first().click();
    await expect(page.locator('#homeCoverImage')).toHaveValue(
      '/media/uploads/202601/e2e-pick.webp',
    );
    await expect(page.locator('#mediaPickerDlg')).not.toHaveAttribute(
      'open',
      '',
    );

    // 另外两个图片路径输入框也各有一个文件夹图标按钮
    await expect(page.locator('[data-media-pick="homeFigureA"]')).toHaveCount(
      1,
    );
    await expect(page.locator('[data-media-pick="homeFigureB"]')).toHaveCount(
      1,
    );
  });

  test('未填写管理令牌时页面只读，文件夹按钮仍可点击并提示需要令牌', async ({
    page,
  }) => {
    // 不注入令牌：设置页进入只读态，但选图按钮不能被一起禁用
    await page.goto('/admin/settings');
    const picker = page.locator('[data-media-pick="homeCoverImage"]');
    await expect(picker).toBeEnabled();
    await expect(page.locator('#saveBtn')).toBeDisabled();
    await expect(page.locator('#setBanner')).toBeVisible();
    await expect(page.locator('#setTokenBtn')).toBeVisible();
    // 只读态下带 [data-setting] 的控件一起禁用
    await expect(page.locator('#homeCoverImage')).toBeDisabled();
    await expect(page.locator('#footerTech')).toBeDisabled();
    await expect(page.locator('#themeColorText')).toBeDisabled();
    await expect(page.locator('#homeLinksAdd')).toBeDisabled();

    await picker.click();
    await expect(page.locator('#mediaPickerDlg')).toHaveAttribute('open', '');
    await expect(page.locator('#mpNotice')).toBeVisible();
  });

  test('同源图片 URL 去域名，外站图片 URL 保持原样', async ({ page }) => {
    await openMockedSettings(page);
    await expect(page.locator('#saveBtn')).toBeEnabled();

    const origin = await page.evaluate(() => window.location.origin);

    // 同源完整 URL：只保留 path + query + hash
    const figureA = page.locator('#homeFigureA');
    await figureA.fill(`${origin}/media/a/b.webp`);
    await figureA.blur();
    await expect(figureA).toHaveValue('/media/a/b.webp');

    // 外站图片 URL 不在站内媒体库，原样保留
    const figureB = page.locator('#homeFigureB');
    await figureB.fill('https://example.com/photo.jpg');
    await figureB.blur();
    await expect(figureB).toHaveValue('https://example.com/photo.jpg');
  });
});

test.describe('后台总览 · 维护模式', () => {
  test('开关写入真实设置并同步侧栏状态', async ({ page }) => {
    let settings: Record<string, string> = { maintenance_enabled: 'false' };
    await page.route('**/api/v1/admin/settings', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: { settings } });
        return;
      }
      if (route.request().method() === 'PUT') {
        settings = {
          ...settings,
          ...(route.request().postDataJSON() as Record<string, string>),
        };
        await route.fulfill({ json: { settings } });
        return;
      }
      await route.continue();
    });
    await page.addInitScript((token) => {
      localStorage.setItem('myon-admin-token', token);
    }, ADMIN_TOKEN);

    await page.goto('/admin');
    const toggle = page.locator('#maintSwitch');
    await expect(toggle).toBeVisible();

    // 初始状态来自站点设置；点一下切到相反状态
    const initialOpen = await toggle.getAttribute('aria-checked');
    const next = initialOpen === 'true' ? 'false' : 'true';
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', next);
    expect(settings.maintenance_enabled).toBe(
      next === 'true' ? 'false' : 'true',
    );
    if (next === 'true') {
      await expect(page.locator('#sideLampText')).toHaveText('营业中');
    } else {
      await expect(page.locator('#sideLampText')).toHaveText('维护中');
    }

    // 再切回来，证明状态与接口真实联动，而不是前端假开关
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', initialOpen ?? 'true');
    expect(settings.maintenance_enabled).toBe(
      initialOpen === 'true' ? 'false' : 'true',
    );
  });
});

test.describe('后台关于页 · 服务端 Markdown', () => {
  test('读取与保存都走接口，不再用 localStorage', async ({ page }) => {
    let markdown = '# 关于 Myon\n\n初始内容。';
    let updatedAt = '2026-10-20T01:12:00.000Z';

    await page.route('**/api/v1/about', async (route) => {
      await route.fulfill({
        json: { key: 'about', markdown, html: '', updatedAt },
      });
    });
    await page.route('**/api/v1/admin/about', async (route) => {
      const body = route.request().postDataJSON() as { markdown: string };
      markdown = body.markdown;
      updatedAt = new Date().toISOString();
      await route.fulfill({
        json: {
          item: { key: 'about', markdown, html: '', updatedAt },
        },
      });
    });
    await page.addInitScript((token) => {
      localStorage.setItem('myon-admin-token', token);
    }, ADMIN_TOKEN);

    await page.goto('/admin/about');
    await expect(page.locator('#mdInput')).toHaveValue(
      '# 关于 Myon\n\n初始内容。',
    );
    await expect(page.locator('#saveState')).toContainText('已读取');
    expect(
      await page.evaluate(() => localStorage.getItem('myon-about')),
    ).toBeNull();

    await page.locator('#mdInput').fill('# 改过的关于\n\n新的正文。');
    await expect(page.locator('#saveState')).toContainText('有未保存的修改');
    await page.locator('#saveBtn').click();

    await expect(page.locator('#saveState')).toContainText('已保存');
    expect(markdown).toBe('# 改过的关于\n\n新的正文。');
    await expect(page.locator('#sourceTag')).toContainText('服务端');
  });
});
