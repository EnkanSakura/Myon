import { expect, type Locator, test } from '@playwright/test';

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

// 扩展语法：公式 / GitHub 提醒框 / 剧透 / 图片网格 / GitHub 卡片。
// 反斜杠用 charCode 拼出来，避免测试文件里的 LaTeX 转义在多层字符串里丢失。
const BS = String.fromCharCode(92);
const TEX_BLOCK = `${BS}int_0^1 x^2${BS},dx = ${BS}frac{1}{3}`;
const EXTENDED_MARKDOWN = [
  '# E2E 扩展 Markdown',
  '',
  '## 公式与提醒框',
  '',
  '行内公式 $E=mc^2$，块级公式：',
  '',
  '$$',
  TEX_BLOCK,
  '$$',
  '',
  '> [!NOTE]',
  '> 提醒内容 **加粗**',
  '',
  '> [!WARNING]',
  '> 小心烫手',
  '',
  '## 剧透与网格',
  '',
  '剧透：内容 :spoiler[被隐藏了 **哈哈**]！',
  '',
  '::github{repo="CuteLeaf/Firefly"}',
  '',
  '[grid]',
  '![示例图片一](/media/gallery/k6-print.jpg)',
  '![示例图片二](/media/moments/w3-museum.jpg)',
  '![示例图片三](/media/gallery/k7-demon.jpg)',
  '[/grid]',
  '',
  '```',
  '> [!NOTE]',
  '::github{repo="a/b"}',
  '```',
].join('\n');

async function assertExtendedPreview(root: Locator) {
  await expect(root.locator('.alert')).toHaveCount(2);
  await expect(root.locator('.alert--warning')).toHaveCount(1);
  await expect(root.locator('.alert-label').first()).toHaveText('注意');
  await expect(root.locator('.alert-body strong')).toHaveText('加粗');

  const spoiler = root.locator('.spoiler').first();
  await expect(spoiler).toContainText('被隐藏了');

  await expect(root.locator('.image-grid--3 .image-grid-item')).toHaveCount(3);
  await expect(root.locator('.image-grid-item figcaption')).toHaveText([
    '示例图片一',
    '示例图片二',
    '示例图片三',
  ]);

  const card = root.locator('.repo-card');
  await expect(card).toHaveCount(1);
  await expect(card).toHaveAttribute('repo', 'CuteLeaf/Firefly');
  await expect(card).toHaveAttribute(
    'href',
    'https://github.com/CuteLeaf/Firefly',
  );

  await expect(root.locator('.math-inline .katex')).toHaveCount(1);
  await expect(root.locator('.math-block .katex-display')).toHaveCount(1);
  await expect(root.locator('.katex-error')).toHaveCount(0);

  // 围栏代码里的扩展语法必须是字面量（文章模式外层另有 .code 卡片）
  await expect(root.locator('pre').first()).toContainText(
    '::github{repo="a/b"}',
  );
}

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
      // 关于内容来自 D1（可能是任意真实文案），只校验服务端输出有结构化子节点。
      expect(await about.locator(':scope > *').count()).toBeGreaterThan(0);
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

  test('文章正文渲染扩展语法（公式 / 提醒框 / 剧透 / 网格 / GitHub 卡片）', async ({
    page,
    request,
  }) => {
    const slug = `e2e-markdown-ext-${Date.now().toString(36)}`;
    let id: string | undefined;

    try {
      const created = await request.post('/api/v1/admin/posts', {
        headers: ADMIN_HEADERS,
        data: {
          slug,
          title: 'E2E 扩展 Markdown',
          excerpt: '',
          bodyMd: EXTENDED_MARKDOWN,
          status: 'published',
          category: '随笔',
          publishedAt: new Date().toISOString(),
        },
      });
      expect(created.status()).toBe(201);
      id = ((await created.json()) as { item: { id: string } }).item.id;

      await page.goto(`/articles/${slug}`);
      const body = page.locator('article.body');
      await assertExtendedPreview(body);

      // 剧透由 site.js 接管点击展开
      const spoiler = body.locator('.spoiler').first();
      await spoiler.click();
      await expect(spoiler).toHaveClass(/is-open/);

      // h2 编号与目录不受扩展组件影响
      await expect(body.locator('h2 .n')).toHaveText(['01', '02']);
      await expect(page.locator('.toc a')).toHaveText([
        '01公式与提醒框',
        '02剧透与网格',
      ]);
    } finally {
      if (id)
        await request
          .delete(`/api/v1/admin/posts/${id}`, { headers: ADMIN_HEADERS })
          .catch(() => undefined);
    }
  });

  test('后台关于页预览支持扩展语法（客户端渲染 + KaTeX 本地加载）', async ({
    page,
  }) => {
    await page.route('**/api/v1/about', async (route) => {
      await route.fulfill({
        json: {
          key: 'about',
          markdown: EXTENDED_MARKDOWN,
          html: '',
          updatedAt: null,
        },
      });
    });

    await page.goto('/admin/about');
    const preview = page.locator('#mdPreview');
    await assertExtendedPreview(preview);
  });
});
