import { expect, test } from '@playwright/test';

// 后台 Markdown 编辑体验的 e2e：
// - 文章弹窗：共享双栏布局（编辑器 + 前台正文预览）+ 快捷工具栏 + 媒体选择器
// - 关于页：共享工具栏与图片插入
// - 动态页：列表 + 呼出对话框（配图复用媒体选择器）
//
// 这里用 route mock 顶住列表 / 保存 / 媒体接口，避免写本地 D1、R2；
// 只验证页面结构与请求 payload，真实接口行为由 admin-crud.spec / upload.spec 覆盖。
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'dev-admin-token';

// 1x1 WebP：上传链路测试用，浏览器端原样直传（不需要 Canvas 转码）。
const WEBP_1PX = Buffer.from(
  'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJQBOgCHwAP7+4AAAAA==',
  'base64',
);

const MEDIA_ITEMS = [
  {
    id: 'media-e2e-a',
    key: 'uploads/202601/e2e-a.webp',
    filename: 'e2e-a.webp',
    mime: 'image/webp',
    size: 2048,
    width: 640,
    height: 480,
    createdAt: '2026-01-02T00:00:00.000Z',
  },
  {
    id: 'media-e2e-b',
    key: 'uploads/202601/e2e-b.webp',
    filename: 'e2e-b.webp',
    mime: 'image/webp',
    size: 4096,
    width: 800,
    height: 600,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

async function mockAdminChrome(page: import('@playwright/test').Page) {
  // 顶栏令牌校验接口（admin-token.js 在存在令牌时会 GET 一次）
  await page.route('**/api/v1/admin/settings*', async (route) => {
    await route.fulfill({ json: { settings: {} } });
  });
  // 媒体库列表：工具栏 / 动态配图的图片选择器
  await page.route('**/api/v1/admin/media?*', async (route) => {
    await route.fulfill({
      json: {
        items: MEDIA_ITEMS,
        total: MEDIA_ITEMS.length,
        limit: 100,
        offset: 0,
      },
    });
  });
}

function initToken(page: import('@playwright/test').Page) {
  return page.addInitScript((token) => {
    localStorage.setItem('myon-admin-token', token);
  }, ADMIN_TOKEN);
}

const ARTICLE_MARKDOWN = [
  '## 小节标题',
  '',
  '正文里的 ~~删除线~~ 和 **加粗**。',
  '',
  '```ts',
  'const a = 1;',
  '```',
  '',
  '![图](/media/uploads/202601/e2e-a.webp)',
].join('\n');

test.describe('后台文章弹窗 · Markdown 编辑 + 预览', () => {
  test('双栏布局、前台正文预览、工具栏、图片插入与保存 payload', async ({
    page,
  }) => {
    await initToken(page);
    await mockAdminChrome(page);
    await page.route('**/api/v1/admin/posts**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          json: {
            items: [
              {
                id: 'p_e2e_a',
                slug: 'e2e-a',
                title: '技术文',
                excerpt: '',
                status: 'published',
                category: '技术',
                coverKey: null,
                readingMinutes: 1,
                publishedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
              },
              {
                id: 'p_e2e_b',
                slug: 'e2e-b',
                title: '随笔文',
                excerpt: '',
                status: 'draft',
                category: '随笔',
                coverKey: null,
                readingMinutes: 1,
                publishedAt: null,
                updatedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
              },
            ],
            total: 2,
            limit: 20,
            offset: 0,
          },
        });
        return;
      }
      await route.fulfill({
        json: {
          item: {
            id: 'p_e2e',
            slug: 'e2e-markdown',
            title: 'E2E 文章',
            excerpt: '',
            bodyMd: ARTICLE_MARKDOWN,
            status: 'draft',
            category: '随笔',
            coverKey: null,
            readingMinutes: 1,
            publishedAt: null,
            updatedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
        },
        status: 201,
      });
    });
    // 全站分类来自 /api/v1/stats 的 categories.posts（当前页之外的分类也要出现在候选里）
    await page.route('**/api/v1/stats', async (route) => {
      await route.fulfill({
        json: {
          categories: {
            posts: [
              { name: '技术', count: 3 },
              { name: '随笔', count: 2 },
              { name: '设计', count: 1 },
            ],
            moments: [],
          },
          gallery: { categories: [] },
        },
      });
    });

    await page.goto('/admin/articles');
    // 原生 select 统一替换成 MyonCombo 外观，页面 JS 仍读写原生 select.value
    await expect(page.locator('#catSel')).toHaveClass(/combo-native/);
    await expect(page.locator('#sortSel')).toHaveClass(/combo-native/);
    await page.locator('#sortSel-combo').click();
    await expect(page.locator('#sortSel-list')).toBeVisible();
    await page.locator('#sortSel-list .combo-item[data-value="title"]').click();
    await expect(page.locator('#sortSel')).toHaveValue('title');
    await expect(page.locator('#sortSel-combo')).toHaveValue('标题 A→Z');
    await page.locator('#btnNew').click();
    await expect(page.locator('#postDlg')).toHaveAttribute('open', '');
    await expect(page.locator('#postDlg .md-split')).toBeVisible();
    // 文章预览按前台文章页的「一页纸」渲染，不再复用带阴影的纸卡
    await expect(page.locator('#postDlg .art-preview')).toBeVisible();
    await expect(page.locator('#postDlg .md-paper')).toHaveCount(0);
    expect(
      await page.locator('#postDlg .art-preview').evaluate((el) => {
        const style = getComputedStyle(el);
        return { shadow: style.boxShadow, border: style.borderTopWidth };
      }),
    ).toEqual({ shadow: 'none', border: '0px' });
    await expect(page.locator('#postDlg .md-toolbar .md-tool')).not.toHaveCount(
      0,
    );

    // 状态下拉同样由 MyonCombo 接管：选项列表、值同步都走原生 select
    await expect(page.locator('#fStatus')).toHaveClass(/combo-native/);
    await expect(page.locator('#fStatus-combo')).toBeVisible();
    await page.locator('#fStatus-combo').click();
    await expect(page.locator('#fStatus-list')).toBeVisible();
    await expect(page.locator('#fStatus-list .combo-item')).toHaveText([
      '草稿',
      '已发布',
      '归档',
    ]);
    await page
      .locator('#fStatus-list .combo-item[data-value="published"]')
      .click();
    await expect(page.locator('#fStatus')).toHaveValue('published');
    await expect(page.locator('#fStatus-combo')).toHaveValue('已发布');

    await page.locator('#fTitle').fill('E2E 文章');
    await page.locator('#fSlug').fill('e2e-markdown');
    await page.locator('#fBody').fill(ARTICLE_MARKDOWN);

    // 预览：h2 编号、删除线、代码卡片、图片都按前台文章正文的结构渲染
    const preview = page.locator('#fPreview');
    await expect(preview.locator('h2 .n')).toHaveText('01');
    await expect(preview.locator('del')).toHaveText('删除线');
    await expect(preview.locator('.code .fname')).toHaveText('ts');
    await expect(preview.locator('img')).toHaveCount(1);

    // 面板全屏：编辑区 + 预览区左右并排铺满视口；Esc 只退出全屏，不能把弹窗关掉
    const mdSplit = page.locator('#postDlg .md-split');
    await expect(mdSplit.locator('.md-fs-btn')).toHaveCount(2);
    await expect(mdSplit.locator('.md-fs-btn').first()).toHaveText('全屏');
    await mdSplit.locator('.md-fs-btn').first().click();
    await expect(mdSplit).toHaveClass(/is-fullscreen/);
    await expect(mdSplit.locator('.md-fs-btn').first()).toHaveText('还原');
    await expect(mdSplit.locator('.md-fs-btn').nth(1)).toHaveText('还原');
    await expect(page.locator('body')).toHaveClass(/md-fs-open/);
    const viewport = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    const fullBox = await mdSplit.boundingBox();
    expect(fullBox?.x).toBe(0);
    expect(fullBox?.y).toBe(0);
    expect(Math.round(fullBox?.width ?? 0)).toBe(viewport.width);
    expect(Math.round(fullBox?.height ?? 0)).toBe(viewport.height);
    const panelBoxes = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll('#postDlg .md-split.is-fullscreen .md-panel'),
      ).map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      }),
    );
    expect(panelBoxes).toHaveLength(2);
    expect(panelBoxes[1]?.x ?? 0).toBeGreaterThan(
      (panelBoxes[0]?.x ?? 0) + (panelBoxes[0]?.width ?? 0),
    );
    expect(
      Math.abs((panelBoxes[0]?.y ?? 0) - (panelBoxes[1]?.y ?? 0)),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs((panelBoxes[0]?.height ?? 0) - (panelBoxes[1]?.height ?? 0)),
    ).toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
    await expect(mdSplit).not.toHaveClass(/is-fullscreen/);
    await expect(page.locator('#postDlg')).toHaveAttribute('open', '');
    await expect(page.locator('body')).not.toHaveClass(/md-fs-open/);

    // 分类与状态的下拉框外观一致（分类仍保留可输入新分类的 datalist）
    const fieldStyles = await page.evaluate(() => {
      const read = (selector: string) => {
        const el = document.querySelector(selector) as HTMLElement;
        const style = getComputedStyle(el);
        return {
          height: style.height,
          border: style.borderTopWidth,
          radius: style.borderRadius,
          paddingRight: style.paddingRight,
          backgroundImage: style.backgroundImage,
        };
      };
      return { category: read('#fCategory'), status: read('#fStatus') };
    });
    expect(fieldStyles.category.height).toBe(fieldStyles.status.height);
    expect(fieldStyles.category.border).toBe(fieldStyles.status.border);
    expect(fieldStyles.category.radius).toBe('0px');
    expect(fieldStyles.category.paddingRight).toBe(
      fieldStyles.status.paddingRight,
    );
    expect(fieldStyles.category.backgroundImage).toBe(
      fieldStyles.status.backgroundImage,
    );

    // 分类候选列表：自绘 combobox（不再使用浏览器 datalist），支持选择 / 过滤 / 新建
    await expect(page.locator('#postDlg datalist')).toHaveCount(0);
    await expect(page.locator('#catList')).toBeHidden();
    const categoryInput = page.locator('#fCategory');
    await categoryInput.fill('');
    await expect(page.locator('#catList')).toBeVisible();
    await expect(page.locator('#catList')).toHaveAttribute('role', 'listbox');
    await expect(page.locator('#catList .combo-item[data-value]')).toHaveCount(
      3,
    );
    await expect(
      page.locator('#catList .combo-item[data-value="设计"]'),
    ).toBeVisible();
    await page.locator('#catList .combo-item[data-value="技术"]').click();
    await expect(categoryInput).toHaveValue('技术');
    await expect(page.locator('#catList')).toBeHidden();

    // 键盘过滤 + Enter 选择已有分类
    await categoryInput.fill('随');
    await categoryInput.press('ArrowDown');
    await categoryInput.press('Enter');
    await expect(categoryInput).toHaveValue('随笔');

    // 直接输入新分类：出现「使用…」行，回车确认
    await categoryInput.fill('新分类');
    await categoryInput.press('ArrowDown');
    await expect(page.locator('#catList .combo-item--create')).toContainText(
      '新分类',
    );
    await categoryInput.press('Enter');
    await expect(categoryInput).toHaveValue('新分类');

    // 右侧箭头按钮可展开 / 收起，Esc 也能收起
    await page.locator('#categoryCombo .combo-toggle').click();
    await expect(page.locator('#catList')).toBeVisible();
    await page.locator('#categoryCombo .combo-toggle').click();
    await expect(page.locator('#catList')).toBeHidden();
    await page.locator('#categoryCombo .combo-toggle').click();
    await expect(page.locator('#catList')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#catList')).toBeHidden();

    // 工具栏：空选区点「加粗」插入占位文字（会派发 input，预览同步更新）
    await page.locator('#fBody').evaluate((el: HTMLTextAreaElement) => {
      el.focus();
      el.setSelectionRange(0, 0);
    });
    await page.locator('.md-tool[data-md-act="bold"]').click();
    await expect(page.locator('#fBody')).toHaveValue(/^\*\*加粗文字\*\*/);

    // 媒体选择器：现有图片里选一张，插入 Markdown 图片语法
    await page.locator('.md-tool[data-md-act="image"]').click();
    await expect(page.locator('#mediaPickerDlg')).toHaveAttribute('open', '');
    await expect(page.locator('#mpGrid .mp-item')).toHaveCount(2);
    await page.locator('#mpGrid .mp-item').first().click();
    await expect(page.locator('#mediaPickerDlg')).not.toHaveAttribute(
      'open',
      '',
    );
    await expect(page.locator('#fBody')).toHaveValue(
      /!\[e2e-a\]\(\/media\/uploads\/202601\/e2e-a\.webp\)/,
    );

    const saveRequest = page.waitForRequest(
      (request) =>
        request.url().endsWith('/api/v1/admin/posts') &&
        request.method() === 'POST',
    );
    await page.locator('#formSave').click();
    const payload = (await (await saveRequest).postDataJSON()) as {
      bodyMd: string;
      title: string;
    };
    expect(payload.title).toBe('E2E 文章');
    expect(payload.bodyMd).toContain('~~删除线~~');
    expect(payload.bodyMd).toContain(
      '![e2e-a](/media/uploads/202601/e2e-a.webp)',
    );
    await expect(page.locator('#postDlg')).not.toHaveAttribute('open', '');
  });
});

test.describe('后台关于页 · 共享编辑器', () => {
  test('工具栏插入语法，图片选择器写入 Markdown 图片', async ({ page }) => {
    await initToken(page);
    await mockAdminChrome(page);
    await page.route('**/api/v1/about', async (route) => {
      await route.fulfill({
        json: {
          key: 'about',
          markdown: '关于 Myon\n\n你好。',
          html: '',
          updatedAt: null,
        },
      });
    });

    await page.goto('/admin/about');
    await expect(page.locator('#mdInput')).toBeEnabled();
    await expect(page.locator('.md-toolbar .md-tool')).toHaveCount(20);

    await page.locator('#mdInput').evaluate((el: HTMLTextAreaElement) => {
      el.focus();
      el.setSelectionRange(0, 0);
    });
    await page.locator('.md-tool[data-md-act="h2"]').click();
    await expect(page.locator('#mdInput')).toHaveValue(/^## /);
    await expect(page.locator('#mdPreview h2')).toHaveText('关于 Myon');

    await page.locator('.md-tool[data-md-act="image"]').click();
    await expect(page.locator('#mediaPickerDlg')).toHaveAttribute('open', '');
    await page.locator('#mpGrid .mp-item').first().click();
    await expect(page.locator('#mdInput')).toHaveValue(
      /!\[e2e-a\]\(\/media\/uploads\/202601\/e2e-a\.webp\)/,
    );
    await expect(page.locator('#mdPreview img')).toHaveCount(1);
  });

  test('新增格式工具栏按钮，编辑区 / 预览区可全屏', async ({ page }) => {
    await initToken(page);
    await mockAdminChrome(page);
    await page.route('**/api/v1/about', async (route) => {
      await route.fulfill({
        json: { key: 'about', markdown: '', html: '', updatedAt: null },
      });
    });

    await page.goto('/admin/about');
    await expect(page.locator('#mdInput')).toBeEnabled();

    const input = page.locator('#mdInput');
    async function insertWith(act: string) {
      await input.fill('');
      await input.evaluate((el: HTMLTextAreaElement) => {
        el.focus();
        el.setSelectionRange(0, 0);
      });
      await page.locator(`.md-tool[data-md-act="${act}"]`).click();
    }

    await insertWith('math');
    await expect(input).toHaveValue('$E=mc^2$');
    await insertWith('mathblock');
    await expect(input).toHaveValue('$$\n\n$$\n');

    // 提醒框：按钮展开类型菜单（GitHub 的 5 种），选 WARNING 再插入
    await input.fill('');
    await input.evaluate((el: HTMLTextAreaElement) => {
      el.focus();
      el.setSelectionRange(0, 0);
    });
    await page.locator('.md-tool[data-md-act="alert"]').click();
    await expect(page.locator('.md-tool-wrap.is-open .md-menu')).toBeVisible();
    await expect(page.locator('.md-menu-item')).toHaveCount(5);
    await page.locator('.md-menu-item[data-alert-type="WARNING"]').click();
    await expect(input).toHaveValue('> [!WARNING]\n> 提醒内容\n');

    await insertWith('spoiler');
    await expect(input).toHaveValue(':spoiler[剧透内容]');
    await insertWith('grid');
    await expect(input).toHaveValue('[grid]\n\n[/grid]\n');
    await insertWith('github');
    await expect(input).toHaveValue('::github{repo="owner/repo"}\n');

    // 编辑区 + 预览区并排全屏 → Esc 退出
    const split = page.locator('.md-split');
    const editorPanel = page.locator('.md-panel').first();
    const previewPanel = page.locator('.md-panel').nth(1);
    await expect(split.locator('.md-fs-btn')).toHaveCount(2);
    await expect(editorPanel.locator('.md-fs-btn')).toHaveText('全屏');
    await editorPanel.locator('.md-fs-btn').click();
    await expect(split).toHaveClass(/is-fullscreen/);
    await expect(editorPanel.locator('.md-fs-btn')).toHaveText('还原');
    await expect(previewPanel.locator('.md-fs-btn')).toHaveText('还原');
    await expect(page.locator('body')).toHaveClass(/md-fs-open/);
    const viewport = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    const box = await split.boundingBox();
    expect(box?.x).toBe(0);
    expect(box?.y).toBe(0);
    expect(Math.round(box?.width ?? 0)).toBe(viewport.width);
    expect(Math.round(box?.height ?? 0)).toBe(viewport.height);
    const panelBoxes = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll('.md-split.is-fullscreen .md-panel'),
      ).map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          x: Math.round(rect.x),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      }),
    );
    expect(panelBoxes).toHaveLength(2);
    expect(panelBoxes[1]?.x ?? 0).toBeGreaterThan(
      (panelBoxes[0]?.x ?? 0) + (panelBoxes[0]?.width ?? 0),
    );
    await page.keyboard.press('Escape');
    await expect(split).not.toHaveClass(/is-fullscreen/);
    await expect(page.locator('body')).not.toHaveClass(/md-fs-open/);

    // 点预览区按钮同样能进入 / 退出整组全屏
    await previewPanel.locator('.md-fs-btn').click();
    await expect(split).toHaveClass(/is-fullscreen/);
    await previewPanel.locator('.md-fs-btn').click();
    await expect(split).not.toHaveClass(/is-fullscreen/);

    // 窄屏全屏：两栏改为上下堆叠
    await page.setViewportSize({ width: 390, height: 844 });
    await editorPanel.locator('.md-fs-btn').click();
    await expect(split).toHaveClass(/is-fullscreen/);
    const narrowBoxes = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll('.md-split.is-fullscreen .md-panel'),
      ).map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      }),
    );
    expect(narrowBoxes).toHaveLength(2);
    expect(narrowBoxes[1]?.y ?? 0).toBeGreaterThan(
      (narrowBoxes[0]?.y ?? 0) + (narrowBoxes[0]?.height ?? 0) - 1,
    );
    expect(
      Math.abs((narrowBoxes[0]?.x ?? 0) - (narrowBoxes[1]?.x ?? 0)),
    ).toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
    await expect(split).not.toHaveClass(/is-fullscreen/);
  });

  test('图片选择器 · 上传新图后写入 Markdown 图片', async ({ page }) => {
    await initToken(page);
    await mockAdminChrome(page);
    const uploadItem = {
      id: 'media-e2e-upload',
      key: 'uploads/202601/e2e-upload.webp',
      filename: 'e2e-upload.webp',
      mime: 'image/webp',
      size: WEBP_1PX.length,
      width: 1,
      height: 1,
      createdAt: '2026-01-03T00:00:00.000Z',
    };
    await page.route('**/api/v1/admin/media', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      await route.fulfill({ status: 201, json: { item: uploadItem } });
    });
    await page.route('**/api/v1/about', async (route) => {
      await route.fulfill({
        json: {
          key: 'about',
          markdown: '关于 Myon',
          html: '',
          updatedAt: null,
        },
      });
    });

    await page.goto('/admin/about');
    await expect(page.locator('#mdInput')).toBeEnabled();
    await page.locator('.md-tool[data-md-act="image"]').click();
    await expect(page.locator('#mediaPickerDlg')).toHaveAttribute('open', '');
    await page.locator('#mpTabUpload').click();
    await page.locator('#mpFile').setInputFiles({
      name: 'e2e-upload.webp',
      mimeType: 'image/webp',
      buffer: WEBP_1PX,
    });
    // 复用媒体库上传链路：上传成功即写入 Markdown 图片并关闭选择器。
    await expect(page.locator('#mdInput')).toHaveValue(
      /!\[e2e-upload\]\(\/media\/uploads\/202601\/e2e-upload\.webp\)/,
    );
    await expect(page.locator('#mediaPickerDlg')).not.toHaveAttribute(
      'open',
      '',
    );
  });
});

test.describe('后台动态页 · 列表 + 呼出对话框', () => {
  const moment = {
    id: 'moment-e2e',
    body: '测试动态正文',
    category: '日常',
    tag: null,
    visibility: 'public',
    pinned: false,
    mediaKey: null,
    createdAt: '2026-01-02T03:04:05.000Z',
  };

  test('只显示列表；发动态/编辑走对话框，配图走媒体选择器', async ({
    page,
  }) => {
    await initToken(page);
    await mockAdminChrome(page);
    const saved: { method: string; payload: Record<string, unknown> }[] = [];
    await page.route('**/api/v1/admin/moments**', async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        await route.fulfill({
          json: { items: [moment], total: 1, limit: 20, offset: 0 },
        });
        return;
      }
      saved.push({
        method,
        payload: route.request().postDataJSON() as Record<string, unknown>,
      });
      await route.fulfill({
        json: {
          item: {
            ...moment,
            body: '更新后的正文',
            mediaKey: MEDIA_ITEMS[0].key,
          },
        },
      });
    });

    await page.goto('/admin/moments');
    // 页面内不再有发布面板，只有列表
    await expect(page.locator('.compose')).toHaveCount(0);
    await expect(page.locator('.filterbar')).toBeVisible();
    await expect(page.locator('.note-r')).toHaveCount(1);

    // 编辑：呼出对话框并预填
    await page.locator('.note-r [data-act="edit"]').click();
    await expect(page.locator('#momentDlg')).toHaveAttribute('open', '');
    await expect(page.locator('#noteText')).toHaveValue('测试动态正文');
    // 分类候选：自绘组合框（服务端 /api/v1/categories 数据）
    await expect(page.locator('#momentDlg datalist')).toHaveCount(0);
    await page.locator('#noteCategoryToggle').click();
    await expect(page.locator('#categoryList')).toBeVisible();
    await expect(
      page.locator('#categoryList .combo-item').first(),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#categoryList')).toBeHidden();
    await page.locator('#noteText').fill('更新后的正文');
    await page.locator('#btnPickImage').click();
    await expect(page.locator('#mediaPickerDlg')).toHaveAttribute('open', '');
    await page.locator('#mpGrid .mp-item').first().click();
    await expect(page.locator('#attachBox')).toHaveClass(/is-on/);
    await page.locator('#btnPublish').click();
    await expect(page.locator('#momentDlg')).not.toHaveAttribute('open', '');
    expect(saved.at(-1)).toMatchObject({
      method: 'PATCH',
      payload: {
        body: '更新后的正文',
        category: '日常',
        mediaKey: MEDIA_ITEMS[0].key,
      },
    });

    // 发动态：同一个对话框从空状态开始
    await page.locator('#btnCompose').click();
    await expect(page.locator('#momentDlg')).toHaveAttribute('open', '');
    await expect(page.locator('#noteText')).toHaveValue('');
    await page.locator('#noteText').fill('新的一条动态');
    await page.locator('#btnPublish').click();
    await expect(page.locator('#momentDlg')).not.toHaveAttribute('open', '');
    expect(saved.at(-1)).toMatchObject({
      method: 'POST',
      payload: { body: '新的一条动态', category: '日常' },
    });
  });
});

test.describe('后台展柜 · 分类组合框', () => {
  test('新增藏品对话框用自绘候选列表，不再出现 datalist', async ({ page }) => {
    await initToken(page);
    await mockAdminChrome(page);
    await page.route('**/api/v1/admin/gallery**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          json: { items: [], total: 0, limit: 20, offset: 0 },
        });
        return;
      }
      await route.fulfill({ json: { item: {} } });
    });
    await page.route('**/api/v1/stats', async (route) => {
      await route.fulfill({
        json: {
          gallery: {
            categories: [
              { name: '手办', count: 2 },
              { name: '画集', count: 1 },
            ],
          },
          categories: { posts: [], moments: [] },
        },
      });
    });

    await page.goto('/admin/gallery');
    await expect(page.locator('#btnAdd')).toBeEnabled();
    await page.locator('#btnAdd').click();
    await expect(page.locator('#editDlg')).toHaveAttribute('open', '');
    await expect(page.locator('#editDlg datalist')).toHaveCount(0);
    await page.locator('#fCat').fill('');
    await expect(page.locator('#catList')).toBeVisible();
    await expect(page.locator('#catList .combo-item[data-value]')).toHaveCount(
      2,
    );
    await page.locator('#catList .combo-item[data-value="画集"]').click();
    await expect(page.locator('#fCat')).toHaveValue('画集');
    await expect(page.locator('#catList')).toBeHidden();
  });
});
