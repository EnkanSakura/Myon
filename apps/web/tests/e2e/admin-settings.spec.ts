import {
  type APIRequestContext,
  expect,
  type Locator,
  type Page,
  test,
} from '@playwright/test';

// 后台设置页的数据块 / 联系方式排序：顺序就是 home_stats / home_links 数组顺序，
// 可以用行首把手拖拽，也可以用每行的 ↑ ↓。
//
// 这里用真实设置做底稿，但把后台设置的读写接口拦在内存里：
// 排序交互与保存后的回填都能测到，又不会污染本地 D1（其他 e2e 用例共用同一份设置）。
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'dev-admin-token';
const ADMIN_HEADERS = { 'x-admin-token': ADMIN_TOKEN };

interface HomeToggleRow {
  label: string;
}

interface MockedSettings {
  statsBefore: { preset: string }[];
  linksBefore: HomeToggleRow[];
  readSettings: () => Record<string, string>;
  statRows: ReturnType<Page['locator']>;
  linkRows: ReturnType<Page['locator']>;
}

async function openMockedSettings(
  page: Page,
  request: APIRequestContext,
): Promise<MockedSettings> {
  const res = await request.get('/api/v1/admin/settings', {
    headers: ADMIN_HEADERS,
  });
  expect(res.status()).toBe(200);
  const original = (await res.json()) as {
    settings: Record<string, string>;
  };
  let settings = { ...original.settings };

  const statsBefore = JSON.parse(settings.home_stats ?? '[]') as {
    preset: string;
  }[];
  const linksBefore = JSON.parse(
    settings.home_links ?? '[]',
  ) as HomeToggleRow[];

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
  const statRows = page.locator('#homeStatsRows .row');
  const linkRows = page.locator('#homeLinksRows .row');
  await expect(statRows).toHaveCount(statsBefore.length);
  await expect(linkRows).toHaveCount(linksBefore.length);

  return {
    statsBefore,
    linksBefore,
    readSettings: () => settings,
    statRows,
    linkRows,
  };
}

/** 用鼠标把把手拖到目标行顶部（placeAfter=false）或底部（placeAfter=true）。 */
async function dragRowByHandle(
  page: Page,
  handle: Locator,
  target: Locator,
  placeAfter: boolean,
) {
  await handle.scrollIntoViewIfNeeded();
  const sourceBox = await handle.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error('拖拽元素不在视口内');

  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBox.x + 30,
    placeAfter ? targetBox.y + targetBox.height - 4 : targetBox.y + 4,
    { steps: 10 },
  );
  await page.mouse.up();
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

test.describe('后台设置 · 清理后的页面', () => {
  test('已删除的字段与面板不再出现，尾页/后记可以保存', async ({
    page,
    request,
  }) => {
    const { readSettings } = await openMockedSettings(page, request);

    // 站点邮箱、默认主题、评论、版权、订阅镜像、部署、危险区与令牌区都已删除
    for (const selector of [
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

    // 尾页 / 后记字段随设置一起保存并回读
    const title = `谢谢翻完 ${Date.now()}`;
    const sign = '—— E2E 落款';
    await page.locator('#homeEndTitle').fill(title);
    await page.locator('#homeEndLead').fill('这一段是结尾导语。');
    await page
      .locator('#homeAfterwordBody')
      .fill('第一段后记。\n\n第二段后记。');
    await page.locator('#homeAfterwordSign').fill(sign);
    await page.locator('#homeAfterwordNext').fill('NEXT ISSUE · 测试');

    await page.locator('#saveBtn').click();
    await expect(page.locator('#saveState')).toContainText('最后保存');

    const saved = readSettings();
    expect(saved.home_end_title).toBe(title);
    expect(saved.home_end_lead).toBe('这一段是结尾导语。');
    expect(saved.home_afterword_body).toBe('第一段后记。\n\n第二段后记。');
    expect(saved.home_afterword_sign).toBe(sign);
    expect(saved.home_afterword_next).toBe('NEXT ISSUE · 测试');

    // 重新加载后仍能读到服务端保存的值
    await page.reload();
    await expect(page.locator('#homeEndTitle')).toHaveValue(title);
    await expect(page.locator('#homeAfterwordSign')).toHaveValue(sign);
  });
});

test.describe('后台设置 · 第 2 页装饰图', () => {
  test('两个装饰图输入框随设置一起保存', async ({ page, request }) => {
    const { readSettings } = await openMockedSettings(page, request);

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

test.describe('后台设置 · 页头说明', () => {
  test('第 2–6 页各一段，保存时写回 5 项 JSON', async ({ page, request }) => {
    const { readSettings } = await openMockedSettings(page, request);

    // 5 个输入与第 2–6 页一一对应
    const notes = page.locator('#homePageNotes .page-note-input');
    await expect(notes).toHaveCount(5);
    for (const id of [
      'homeNoteP2',
      'homeNoteP3',
      'homeNoteP4',
      'homeNoteP5',
      'homeNoteP6',
    ]) {
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }
    await expect(page.locator('label[for="homeNoteP2"]')).toHaveText(
      '第 2 页 / PAGE 02 · 文章',
    );
    await expect(page.locator('label[for="homeNoteP3"]')).toHaveText(
      '第 3 页 / PAGE 03 · 动态',
    );
    await expect(page.locator('label[for="homeNoteP4"]')).toHaveText(
      '第 4 页 / PAGE 04 · 展柜',
    );
    await expect(page.locator('label[for="homeNoteP5"]')).toHaveText(
      '第 5 页 / PAGE 05 · 追番',
    );
    await expect(page.locator('label[for="homeNoteP6"]')).toHaveText(
      '第 6 页 / PAGE 06 · 工具',
    );
    // 默认第 3 页有文案，其它页为空
    await expect(page.locator('#homeNoteP3')).not.toHaveValue('');
    await expect(page.locator('#homeNoteP2')).toHaveValue('');

    const note = `第 2 页说明 ${Date.now()}`;
    await page.locator('#homeNoteP2').fill(note);
    await page.locator('#homeNoteP6').fill('工具页说明');
    await page.locator('#saveBtn').click();
    await expect(page.locator('#saveState')).toContainText('最后保存');

    const saved = JSON.parse(
      readSettings().home_page_notes ?? '[]',
    ) as string[];
    expect(saved).toHaveLength(5);
    // 顺序对应第 2/3/4/5/6 页：index 0 是第 2 页，index 4 是第 6 页
    expect(saved[0]).toBe(note);
    expect(saved[4]).toBe('工具页说明');
    // 未改动的第 3 页仍是默认文案
    expect(saved[1]).not.toBe('');
  });
});

test.describe('后台设置 · 图片路径媒体选择器', () => {
  test('点文件夹图标选图后填入 /media/<key> 并关闭选择器', async ({
    page,
    request,
  }) => {
    await openMockedSettings(page, request);
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

  test('未填写管理令牌时文件夹按钮仍可点击并提示需要令牌', async ({ page }) => {
    // 不注入令牌：设置页进入只读态，但选图按钮不能被一起禁用
    await page.goto('/admin/settings');
    const picker = page.locator('[data-media-pick="homeCoverImage"]');
    await expect(picker).toBeEnabled();
    await expect(page.locator('#saveBtn')).toBeDisabled();
    // 只读态下带 [data-setting] 的控件（含新增的页头说明 textarea）一起禁用
    await expect(page.locator('#homePageNotes .page-note-input')).toHaveCount(
      5,
    );
    await expect(page.locator('#homeNoteP2')).toBeDisabled();
    await expect(page.locator('#homeNoteP6')).toBeDisabled();

    await picker.click();
    await expect(page.locator('#mediaPickerDlg')).toHaveAttribute('open', '');
    await expect(page.locator('#mpNotice')).toBeVisible();
  });

  test('同源图片 URL 去域名，外站图片 URL 保持原样', async ({
    page,
    request,
  }) => {
    await openMockedSettings(page, request);
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

test.describe('后台设置 · 行排序', () => {
  test('数据块和联系方式可以用 ↑ ↓ 调整顺序并在保存后生效', async ({
    page,
    request,
  }) => {
    const { statsBefore, linksBefore, readSettings, statRows, linkRows } =
      await openMockedSettings(page, request);
    test.skip(
      statsBefore.length < 2 || linksBefore.length < 2,
      '需要至少两个数据块和两条联系方式才能测试排序',
    );

    const linkLabel = (index: number) =>
      linkRows.nth(index).locator('[data-key="label"]');
    const statPreset = (index: number) =>
      statRows.nth(index).locator('[data-key="preset"]');

    // 刚到边界时，第一行的 ↑ 与最后一行的 ↓ 不可用
    await expect(linkRows.first().locator('[data-move="up"]')).toBeDisabled();
    await expect(linkRows.last().locator('[data-move="down"]')).toBeDisabled();
    await expect(page.locator('#saveState')).toContainText('已读取');

    // 联系方式：把第一条往下移，页面应标记为有未保存修改
    const expectedLinks = [...linksBefore];
    const firstLink = expectedLinks.shift();
    expectedLinks.splice(1, 0, firstLink as HomeToggleRow);
    await linkRows.first().locator('[data-move="down"]').click();
    await expect(linkLabel(0)).toHaveValue(expectedLinks[0]?.label as string);
    await expect(linkLabel(1)).toHaveValue(expectedLinks[1]?.label as string);
    await expect(page.locator('#saveState')).toContainText('有未保存的修改');

    // 数据块：把最后一条往上移
    const expectedStats = [...statsBefore];
    const lastStat = expectedStats.pop();
    expectedStats.splice(
      expectedStats.length - 1,
      0,
      lastStat as { preset: string },
    );
    await statRows.last().locator('[data-move="up"]').click();
    await expect(statPreset(0)).toHaveValue(expectedStats[0]?.preset as string);
    await expect(statPreset(1)).toHaveValue(expectedStats[1]?.preset as string);

    await page.locator('#saveBtn').click();
    await expect(page.locator('#saveState')).toContainText('最后保存');

    // 保存时写回接口的顺序就是 DOM 顺序
    const savedLinks = (
      JSON.parse(readSettings().home_links ?? '[]') as HomeToggleRow[]
    ).map((link) => link.label);
    expect(savedLinks).toEqual(expectedLinks.map((link) => link.label));
    const savedStats = JSON.parse(readSettings().home_stats ?? '[]') as {
      preset: string;
    }[];
    expect(savedStats.map((stat) => stat.preset)).toEqual(
      expectedStats.map((stat) => stat.preset),
    );

    // 重新加载后顺序保持
    await page.reload();
    await expect(linkRows).toHaveCount(linksBefore.length);
    await expect(statRows).toHaveCount(statsBefore.length);
    for (let index = 0; index < expectedLinks.length; index += 1) {
      await expect(linkLabel(index)).toHaveValue(
        expectedLinks[index]?.label as string,
      );
    }
    for (let index = 0; index < expectedStats.length; index += 1) {
      await expect(statPreset(index)).toHaveValue(
        expectedStats[index]?.preset as string,
      );
    }
  });

  test('行首把手可以拖拽调整顺序并在保存后生效', async ({ page, request }) => {
    // 拖拽要求源和目标同时可见，用一个足够高的视口避免 Playwright 中途滚动
    await page.setViewportSize({ width: 1280, height: 1600 });
    const { statsBefore, linksBefore, readSettings, statRows, linkRows } =
      await openMockedSettings(page, request);
    test.skip(
      linksBefore.length < 3 || statsBefore.length < 2,
      '需要至少三个联系方式与两个数据块才能测试拖拽',
    );

    const linkLabel = (index: number) =>
      linkRows.nth(index).locator('[data-key="label"]');
    const statPreset = (index: number) =>
      statRows.nth(index).locator('[data-key="preset"]');

    // 每一行都有拖拽把手
    await expect(page.locator('#homeLinksRows .row-grip')).toHaveCount(
      linksBefore.length,
    );
    await expect(page.locator('#homeStatsRows .row-grip')).toHaveCount(
      statsBefore.length,
    );

    // 拖第一条到第三条上方 → [B, A, C, ...]
    const first = linksBefore[0] as HomeToggleRow;
    const second = linksBefore[1] as HomeToggleRow;
    const third = linksBefore[2] as HomeToggleRow;
    const expectedLinks = [second, first, third, ...linksBefore.slice(3)];
    await page.locator('#homeLinksRows').scrollIntoViewIfNeeded();
    await dragRowByHandle(
      page,
      linkRows.first().locator('.row-grip'),
      linkRows.nth(2),
      false,
    );
    for (let index = 0; index < expectedLinks.length; index += 1) {
      await expect(linkLabel(index)).toHaveValue(
        expectedLinks[index]?.label as string,
      );
    }
    await expect(linkRows.first()).not.toHaveClass(/is-dragging/);
    await expect(page.locator('#saveState')).toContainText('有未保存的修改');

    // 拖最后一个数据块到第一条上方 → [C, A, B]
    const lastStat = statsBefore[statsBefore.length - 1] as {
      preset: string;
    };
    const expectedStats = [lastStat, ...statsBefore.slice(0, -1)];
    await page.locator('#homeStatsRows').scrollIntoViewIfNeeded();
    await dragRowByHandle(
      page,
      statRows.last().locator('.row-grip'),
      statRows.first(),
      false,
    );
    for (let index = 0; index < expectedStats.length; index += 1) {
      await expect(statPreset(index)).toHaveValue(
        expectedStats[index]?.preset as string,
      );
    }

    await page.locator('#saveBtn').click();
    await expect(page.locator('#saveState')).toContainText('最后保存');

    // 写回接口的顺序与拖拽后的 DOM 顺序一致
    const savedLinks = (
      JSON.parse(readSettings().home_links ?? '[]') as HomeToggleRow[]
    ).map((link) => link.label);
    expect(savedLinks).toEqual(expectedLinks.map((link) => link.label));
    const savedStats = JSON.parse(readSettings().home_stats ?? '[]') as {
      preset: string;
    }[];
    expect(savedStats.map((stat) => stat.preset)).toEqual(
      expectedStats.map((stat) => stat.preset),
    );

    // 重新加载后顺序保持
    await page.reload();
    await expect(linkRows).toHaveCount(linksBefore.length);
    for (let index = 0; index < expectedLinks.length; index += 1) {
      await expect(linkLabel(index)).toHaveValue(
        expectedLinks[index]?.label as string,
      );
    }
    for (let index = 0; index < expectedStats.length; index += 1) {
      await expect(statPreset(index)).toHaveValue(
        expectedStats[index]?.preset as string,
      );
    }
  });
});
