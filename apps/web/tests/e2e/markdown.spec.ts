import { expect, test } from '@playwright/test';

// Markdown 渲染回归：服务端（marked + sanitize-html）负责文章正文与首页「关于」卡，
// 客户端迷你渲染器只负责后台关于页的本地预览。三处都要覆盖到。
//
// 清理策略：文章用例自己创建 published 文章，finally 里按 id 删除；
// 首页与后台预览用例只读或路由 mock，不改本地 D1。
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'dev-admin-token';
const ADMIN_HEADERS = { 'x-admin-token': ADMIN_TOKEN };

const MARKDOWN = [
  '# E2E Markdown 格式',
  '',
  '正文里的 ~~删除线~~ 应该渲染成 del。',
  '',
  '1. 有序一',
  '2. 有序二',
  '',
  '- [ ] 待办',
  '- [x] 已完成',
  '',
  '```c++',
  'int main() { return 0; }',
  '```',
  '',
  '| 左 | 中 | 右 |',
  '| :- | :-: | -: |',
  '| A | B | C |',
  '',
  '#### 四级标题',
].join('\n');

test.describe('Markdown 渲染', () => {
  test('文章正文渲染 GFM 格式（删除线 / 有序列表 / 表格对齐 / 任务列表 / 代码卡片 / h4）', async ({
    page,
    request,
  }) => {
    const slug = `e2e-markdown-${Date.now().toString(36)}`;
    let id: string | undefined;

    try {
      const created = await request.post('/api/v1/admin/posts', {
        headers: ADMIN_HEADERS,
        data: {
          slug,
          title: 'E2E Markdown 格式',
          excerpt: '',
          bodyMd: MARKDOWN,
          status: 'published',
          category: '随笔',
          publishedAt: new Date().toISOString(),
        },
      });
      expect(created.status()).toBe(201);
      const createdBody = (await created.json()) as { item: { id: string } };
      id = createdBody.item.id;

      await page.goto(`/articles/${slug}`);
      const body = page.locator('article.body');
      await expect(body.locator('del')).toHaveText('删除线');

      // 全局 reset 把 ul/ol 的 list-style 置为 none，正文必须单独恢复有序列表编号。
      const delDecoration = await body
        .locator('del')
        .evaluate((el) => getComputedStyle(el).textDecorationLine);
      expect(delDecoration).toContain('line-through');

      const ol = body.locator('ol');
      await expect(ol).toHaveCount(1);
      expect(
        await ol.evaluate((el) => getComputedStyle(el).listStyleType),
      ).toBe('decimal');

      // GFM 表格对齐靠 th/td 上的 align 属性，CSS 必须让 [align] 生效。
      const centerCell = body.locator('th[align="center"]');
      await expect(centerCell).toHaveText('中');
      expect(
        await centerCell.evaluate((el) => getComputedStyle(el).textAlign),
      ).toBe('center');

      // 任务列表：复选框换成展示方块，li 不再显示列表方点。
      const taskItems = body.locator('li.task');
      await expect(taskItems).toHaveCount(2);
      await expect(body.locator('.task-box')).toHaveCount(2);
      await expect(body.locator('.task-box.is-done')).toHaveCount(1);
      const boxBorder = await body
        .locator('.task-box')
        .first()
        .evaluate((el) => getComputedStyle(el).borderLeftWidth);
      expect(boxBorder).toBe('2px');

      // 语言带符号的围栏（c++）也要被包成设计稿的代码卡片。
      await expect(body.locator('.code .fname')).toHaveText('c++');

      const h4 = body.locator('h4');
      await expect(h4).toHaveText('四级标题');
      expect(await h4.evaluate((el) => getComputedStyle(el).fontWeight)).toBe(
        '900',
      );
    } finally {
      if (id)
        await request
          .delete(`/api/v1/admin/posts/${id}`, { headers: ADMIN_HEADERS })
          .catch(() => undefined);
    }
  });

  test('首页关于卡由服务端渲染，禁用 JS 也能拿到结构化 HTML', async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    try {
      await page.goto('/');
      const about = page.locator('#aboutBody');
      // 不能依赖客户端 markdown.js 二次渲染：关掉 JS 后这里仍然必须是真元素。
      await expect(about.locator('h1, h2').first()).toContainText('关于');
      await expect(about.locator('li').first()).toHaveCount(1);
      await expect(about.locator('p').first()).toHaveCount(1);
    } finally {
      await context.close();
    }
  });

  test('后台关于页本地预览支持删除线等格式', async ({ page }) => {
    await page.route('**/api/v1/about', async (route) => {
      await route.fulfill({
        json: {
          key: 'about',
          markdown: MARKDOWN,
          html: '',
          updatedAt: null,
        },
      });
    });

    await page.goto('/admin/about');
    await expect(page.locator('#mdInput')).toHaveValue(/# E2E Markdown 格式/);

    const preview = page.locator('#mdPreview');
    await expect(preview.locator('del')).toHaveText('删除线');
    await expect(preview.locator('ol > li')).toHaveCount(2);
    await expect(preview.locator('pre code')).toContainText('int main');
    await expect(preview.locator('th[align="center"]')).toHaveText('中');
    await expect(preview.locator('li.task')).toHaveCount(2);
    await expect(preview.locator('.task-box.is-done')).toHaveCount(1);
  });
});
