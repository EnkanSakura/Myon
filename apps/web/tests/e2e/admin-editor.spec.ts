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
          json: { items: [], total: 0, limit: 20, offset: 0 },
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

    await page.goto('/admin/articles');
    await page.locator('#btnNew').click();
    await expect(page.locator('#postDlg')).toHaveAttribute('open', '');
    await expect(page.locator('#postDlg .md-split')).toBeVisible();
    await expect(page.locator('#postDlg .md-toolbar .md-tool')).not.toHaveCount(
      0,
    );

    await page.locator('#fTitle').fill('E2E 文章');
    await page.locator('#fSlug').fill('e2e-markdown');
    await page.locator('#fBody').fill(ARTICLE_MARKDOWN);

    // 预览：h2 编号、删除线、代码卡片、图片都按前台文章正文的结构渲染
    const preview = page.locator('#fPreview');
    await expect(preview.locator('h2 .n')).toHaveText('01');
    await expect(preview.locator('del')).toHaveText('删除线');
    await expect(preview.locator('.code .fname')).toHaveText('ts');
    await expect(preview.locator('img')).toHaveCount(1);

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
    await expect(page.locator('.md-toolbar .md-tool')).toHaveCount(14);

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
