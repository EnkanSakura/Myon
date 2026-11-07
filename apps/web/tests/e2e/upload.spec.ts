import { expect, type Page, test } from '@playwright/test';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'dev-admin-token';
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/* ---------------- 媒体库分类 / 别名 的确定性 mock ----------------
   媒体库的分类、别名、筛选、分页全部由服务端完成（D1 元数据），这里用一个内存
   媒体库顶住列表 / 元数据修改 / 分类 CRUD，断言请求参数与 UI 渲染，不写本地 D1/R2。 */
interface MockCategory {
  id: string;
  name: string;
  position: number;
}

interface MockMediaItem {
  id: string;
  key: string;
  filename: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  createdAt: string;
  categoryId: string | null;
  categoryName: string | null;
  aliases: string[];
}

const BASE_CATEGORIES: MockCategory[] = [
  { id: 'cat_posts', name: '文章', position: 0 },
  { id: 'cat_moments', name: '动态', position: 1 },
  { id: 'cat_gallery', name: '展柜', position: 2 },
];

function createMediaItems(): MockMediaItem[] {
  const cat = (id: string) =>
    BASE_CATEGORIES.find((item) => item.id === id) ?? null;
  const posts = cat('cat_posts');
  const gallery = cat('cat_gallery');
  return [
    {
      id: 'media-e2e-article',
      key: 'uploads/202601/e2e-article.webp',
      filename: 'e2e-article.webp',
      mime: 'image/webp',
      size: 2048,
      width: 640,
      height: 480,
      createdAt: '2026-01-03T00:00:00.000Z',
      categoryId: posts ? posts.id : null,
      categoryName: posts ? posts.name : null,
      aliases: ['封面图', '头图'],
    },
    {
      id: 'media-e2e-gallery',
      key: 'uploads/202601/e2e-gallery.webp',
      filename: 'e2e-gallery.webp',
      mime: 'image/webp',
      size: 4096,
      width: 800,
      height: 600,
      createdAt: '2026-01-02T00:00:00.000Z',
      categoryId: gallery ? gallery.id : null,
      categoryName: gallery ? gallery.name : null,
      aliases: [],
    },
    {
      id: 'media-e2e-legacy',
      key: 'uploads/202512/legacy.webp',
      filename: 'legacy.webp',
      mime: 'image/webp',
      size: 1024,
      width: 480,
      height: 360,
      createdAt: '2026-01-01T00:00:00.000Z',
      categoryId: null,
      categoryName: null,
      aliases: ['旧图'],
    },
  ];
}

interface MockMediaApi {
  items: MockMediaItem[];
  categories: MockCategory[];
  /** 列表请求的查询参数，按发生顺序 */
  listRequests: URLSearchParams[];
  /** 分类 CRUD 请求记录 */
  categoryRequests: Array<{ method: string; path: string; body: unknown }>;
}

/** GET 列表按 category/q 过滤（模拟服务端），PATCH 元数据 / 分类 CRUD 更新内存数据。 */
async function mockMediaApi(page: Page): Promise<MockMediaApi> {
  const categories = BASE_CATEGORIES.map((item) => ({ ...item }));
  const items = createMediaItems();
  const listRequests: URLSearchParams[] = [];
  const categoryRequests: Array<{
    method: string;
    path: string;
    body: unknown;
  }> = [];

  const countCategories = (list: MockMediaItem[]) => {
    const counts: Record<string, number> = {};
    let uncategorized = 0;
    for (const item of list) {
      if (item.categoryId)
        counts[item.categoryId] = (counts[item.categoryId] ?? 0) + 1;
      else uncategorized += 1;
    }
    return { counts, uncategorized };
  };

  // 1) 媒体列表
  await page.route('**/api/v1/admin/media?*', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    const params = new URL(route.request().url()).searchParams;
    listRequests.push(params);
    const q = (params.get('q') ?? '').trim().toLowerCase();
    const category = params.get('category');
    const matched = items.filter(
      (item) =>
        !q ||
        item.filename.toLowerCase().includes(q) ||
        item.key.toLowerCase().includes(q) ||
        item.aliases.some((alias) => alias.toLowerCase().includes(q)),
    );
    const { counts, uncategorized } = countCategories(matched);
    const filtered = category
      ? matched.filter((item) =>
          category === 'uncategorized'
            ? item.categoryId === null
            : item.categoryId === category,
        )
      : matched;
    await route.fulfill({
      json: {
        items: filtered,
        total: filtered.length,
        limit: 30,
        offset: 0,
        categories: categories.map((cat) => ({
          ...cat,
          count: counts[cat.id] ?? 0,
        })),
        uncategorizedCount: uncategorized,
      },
    });
  });

  // 2) 单张媒体的分类 / 别名
  await page.route('**/api/v1/admin/media/*', async (route) => {
    const url = new URL(route.request().url());
    if (
      route.request().method() !== 'PATCH' ||
      url.pathname.endsWith('/media/categories')
    ) {
      await route.fallback();
      return;
    }
    const id = url.pathname.split('/').pop();
    const body = route.request().postDataJSON() as {
      categoryId?: string | null;
      aliases?: string[];
    };
    const item = items.find((entry) => entry.id === id);
    if (!item) {
      await route.fulfill({ status: 404, json: { error: 'not_found' } });
      return;
    }
    if (body.categoryId !== undefined) {
      const cat = body.categoryId
        ? categories.find((entry) => entry.id === body.categoryId)
        : null;
      if (body.categoryId && !cat) {
        await route.fulfill({
          status: 400,
          json: { error: 'invalid_category', message: '分类不存在' },
        });
        return;
      }
      item.categoryId = cat ? cat.id : null;
      item.categoryName = cat ? cat.name : null;
    }
    if (Array.isArray(body.aliases)) item.aliases = body.aliases;
    await route.fulfill({ json: { item: { ...item } } });
  });

  // 3) 分类 CRUD（最后注册，优先匹配 /media/categories 请求）
  await page.route('**/api/v1/admin/media/categories**', async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;
    const body =
      method === 'GET' || method === 'DELETE'
        ? undefined
        : (request.postDataJSON() as Record<string, unknown>);
    categoryRequests.push({ method, path, body });
    const id = path.split('/').pop();

    if (method === 'GET') {
      await route.fulfill({
        json: { items: categories.map((cat) => ({ ...cat })) },
      });
      return;
    }
    if (method === 'POST') {
      const name = String(body?.name ?? '').trim();
      if (categories.some((cat) => cat.name === name)) {
        await route.fulfill({
          status: 409,
          json: { error: 'name_taken', message: '已有同名分类' },
        });
        return;
      }
      const created: MockCategory = {
        id: `cat_e2e_${categories.length + 1}`,
        name,
        position: categories.length,
      };
      categories.push(created);
      await route.fulfill({ status: 201, json: { item: { ...created } } });
      return;
    }
    if (method === 'PATCH') {
      const cat = categories.find((entry) => entry.id === id);
      if (!cat) {
        await route.fulfill({ status: 404, json: { error: 'not_found' } });
        return;
      }
      if (typeof body?.name === 'string') {
        const name = body.name.trim();
        if (
          categories.some((entry) => entry.name === name && entry.id !== cat.id)
        ) {
          await route.fulfill({
            status: 409,
            json: { error: 'name_taken', message: '已有同名分类' },
          });
          return;
        }
        cat.name = name;
      }
      if (typeof body?.position === 'number') cat.position = body.position;
      await route.fulfill({ json: { item: { ...cat } } });
      return;
    }
    if (method === 'DELETE') {
      const index = categories.findIndex((entry) => entry.id === id);
      if (index < 0) {
        await route.fulfill({ status: 404, json: { error: 'not_found' } });
        return;
      }
      const [removed] = categories.splice(index, 1);
      for (const item of items) {
        if (item.categoryId === removed.id) {
          item.categoryId = null;
          item.categoryName = null;
        }
      }
      await route.fulfill({ json: { ok: true } });
      return;
    }
    await route.fallback();
  });

  return { items, categories, listRequests, categoryRequests };
}

function addToken(page: Page) {
  return page.addInitScript((token) => {
    localStorage.setItem('myon-admin-token', token);
  }, ADMIN_TOKEN);
}

test('媒体库把 PNG 在前端转成 WebP 再上传', async ({ page }) => {
  await addToken(page);
  await page.goto('/admin/media', { waitUntil: 'networkidle' });

  const uploadResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/admin/media') &&
      response.request().method() === 'POST',
  );
  await page.setInputFiles('#fileInput', {
    name: 'e2e-convert.png',
    mimeType: 'image/png',
    buffer: PNG_1X1,
  });
  const response = await uploadResponse;
  expect(response.status()).toBe(201);
  const body = (await response.json()) as {
    item: {
      id: string;
      key: string;
      mime: string;
      filename: string;
      categoryId: string | null;
    };
  };

  try {
    expect(body.item.mime).toBe('image/webp');
    expect(body.item.filename).toMatch(/\.webp$/);
    expect(body.item.key).toMatch(/^uploads\/\d{6}\//);
    expect(body.item.categoryId).toBeNull();
  } finally {
    await page.request.delete(`/api/v1/admin/media/${body.item.id}`, {
      headers: { 'x-admin-token': ADMIN_TOKEN },
    });
  }
});

test('GIF 先经 Worker 代理换成 animated WebP 再上传', async ({ page }) => {
  await addToken(page);
  await page.route('**/api/v1/admin/media/gif-webp', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/webp',
      body: Buffer.from(
        'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJQBOgCHwAP7+4AAAAA==',
        'base64',
      ),
    });
  });
  await page.goto('/admin/media', { waitUntil: 'networkidle' });

  const uploadResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/admin/media') &&
      response.request().method() === 'POST',
  );
  await page.setInputFiles('#fileInput', {
    name: 'e2e-anim.gif',
    mimeType: 'image/gif',
    buffer: Buffer.from('GIF89a', 'ascii'),
  });
  const response = await uploadResponse;
  expect(response.status()).toBe(201);
  const body = (await response.json()) as {
    item: { id: string; key: string; mime: string; filename: string };
  };

  try {
    expect(body.item.mime).toBe('image/webp');
    expect(body.item.filename).toMatch(/\.webp$/);
  } finally {
    await page.request.delete(`/api/v1/admin/media/${body.item.id}`, {
      headers: { 'x-admin-token': ADMIN_TOKEN },
    });
  }
});

// 上传前在页头选择分类：响应 item 的 categoryId / categoryName 跟着走，R2 key 仍不含分类。
test('上传时选择分类，item 分类字段与 key 前缀正确', async ({ page }) => {
  await addToken(page);
  await page.goto('/admin/media', { waitUntil: 'networkidle' });

  // 分类下拉的选项由列表接口回填，等 combo.js 替身同步后再选
  await expect(
    page.locator('#uploadCategory option[value="cat_posts"]'),
  ).toHaveCount(1);
  await page.locator('#uploadCategory-combo').click();
  await page
    .locator('#uploadCategory-list .combo-item[data-value="cat_posts"]')
    .click();
  await expect(page.locator('#uploadCategory')).toHaveValue('cat_posts');

  const uploadResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/admin/media') &&
      response.request().method() === 'POST',
  );
  await page.setInputFiles('#fileInput', {
    name: 'e2e-category.png',
    mimeType: 'image/png',
    buffer: PNG_1X1,
  });
  const response = await uploadResponse;
  expect(response.status()).toBe(201);
  const body = (await response.json()) as {
    item: {
      id: string;
      key: string;
      categoryId: string | null;
      categoryName: string | null;
      aliases: string[];
    };
  };

  try {
    expect(body.item.categoryId).toBe('cat_posts');
    expect(body.item.categoryName).toBe('文章');
    expect(body.item.key).toMatch(/^uploads\/\d{6}\//);
    expect(body.item.aliases).toEqual([]);
  } finally {
    await page.request.delete(`/api/v1/admin/media/${body.item.id}`, {
      headers: { 'x-admin-token': ADMIN_TOKEN },
    });
  }
});

// 媒体库网格缩略图走低清预览（size=360&q=70），复制链接仍给原图地址。
test('媒体库网格缩略图用低清预览，不拉原图', async ({ page }) => {
  await addToken(page);
  await page.route('**/api/v1/admin/media?*', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      json: {
        items: [
          {
            id: 'media-e2e-thumb',
            key: 'cabinet.jpg',
            filename: 'cabinet.jpg',
            mime: 'image/jpeg',
            size: 7804,
            width: 480,
            height: 360,
            createdAt: '2026-01-02T00:00:00.000Z',
            categoryId: null,
            categoryName: null,
            aliases: ['封面'],
          },
        ],
        total: 1,
        limit: 30,
        offset: 0,
        categories: [],
        uncategorizedCount: 1,
      },
    });
  });

  await page.goto('/admin/media', { waitUntil: 'networkidle' });
  const thumb = page.locator('#mediaGrid .mcard img').first();
  await expect(thumb).toHaveAttribute(
    'src',
    '/media/cabinet.jpg?size=360&q=70',
  );
  // 复制链接仍取原图地址（data-key 是不带转换参数的媒体 key）
  await expect(page.locator('#mediaGrid .mcard').first()).toHaveAttribute(
    'data-key',
    'cabinet.jpg',
  );
  // 未分类用中性 badge
  await expect(page.locator('#mediaGrid .mcard .mcat').first()).toHaveText(
    '未分类',
  );
});

// 分类 chips：动态渲染（全部 + 分类 + 未分类），点击后请求带 category=<id>。
test('分类 chips 走服务端筛选并显示分类与别名', async ({ page }) => {
  await addToken(page);
  const api = await mockMediaApi(page);
  await page.goto('/admin/media', { waitUntil: 'networkidle' });

  await expect(page.locator('#mediaGrid .mcard')).toHaveCount(3);
  await expect(page.locator('#catChips .chip')).toHaveCount(5);
  await expect(
    page.locator('#catChips [data-category="cat_posts"]'),
  ).toContainText('文章');
  await expect(
    page.locator('#catChips [data-category="cat_posts"]'),
  ).toContainText('1');
  await expect(
    page.locator('#catChips [data-category="uncategorized"]'),
  ).toContainText('未分类');

  await page.locator('#catChips [data-category="cat_posts"]').click();
  await expect
    .poll(() =>
      api.listRequests.some((params) => params.get('category') === 'cat_posts'),
    )
    .toBe(true);
  await expect(
    page.locator('#catChips [data-category="cat_posts"]'),
  ).toHaveClass(/is-on/);
  await expect(page.locator('#mediaGrid .mcard')).toHaveCount(1);
  const card = page.locator('#mediaGrid .mcard').first();
  await expect(card).toHaveAttribute('data-category-id', 'cat_posts');
  await expect(card.locator('.mcat')).toHaveText('文章');
  await expect(card.locator('.malias')).toHaveText(['封面图', '头图']);
});

// 卡片「分类/别名」按钮：改分类 + 别名，PATCH 后卡片立即更新。
test('分类/别名弹窗 PATCH body 正确且卡片更新', async ({ page }) => {
  await addToken(page);
  await mockMediaApi(page);
  await page.goto('/admin/media', { waitUntil: 'networkidle' });

  const card = page.locator(
    '#mediaGrid .mcard[data-key="uploads/202601/e2e-article.webp"]',
  );
  await card.hover();
  await card.locator('[data-act="meta"]').click();
  await expect(page.locator('#metaDlg')).toHaveAttribute('open', '');
  await expect(page.locator('#metaAliases')).toHaveValue('封面图、头图');

  // 对话框里的原生 select 由 combo.js 增强；先触发一次 resize 让替身完成布局
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.locator('#metaCategory-combo').click();
  await page
    .locator('#metaCategory-list .combo-item[data-value="cat_gallery"]')
    .click();
  await expect(page.locator('#metaCategory')).toHaveValue('cat_gallery');
  await page.locator('#metaAliases').fill('封面图、头图、文章头图');

  const patchResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().includes('/api/v1/admin/media/'),
  );
  await page.locator('#metaSave').click();
  const response = await patchResponse;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toEqual({
    categoryId: 'cat_gallery',
    aliases: ['封面图', '头图', '文章头图'],
  });
  await expect(page.locator('#metaDlg')).not.toHaveAttribute('open', '');

  const updated = page.locator(
    '#mediaGrid .mcard[data-key="uploads/202601/e2e-article.webp"]',
  );
  await expect(updated).toHaveAttribute('data-category-id', 'cat_gallery');
  await expect(updated.locator('.mcat')).toHaveText('展柜');
  await expect(updated.locator('.malias')).toHaveText([
    '封面图',
    '头图',
    '文章头图',
  ]);
});

// 搜索走服务端全库检索：别名也能命中，请求带 q 参数。
test('搜索按别名命中，请求带 q 参数', async ({ page }) => {
  await addToken(page);
  const api = await mockMediaApi(page);
  await page.goto('/admin/media', { waitUntil: 'networkidle' });
  await expect(page.locator('#mediaGrid .mcard')).toHaveCount(3);

  await page.locator('#q').fill('头图');
  await expect
    .poll(() => api.listRequests.some((params) => params.get('q') === '头图'))
    .toBe(true);
  await expect(page.locator('#mediaGrid .mcard')).toHaveCount(1);
  await expect(page.locator('#mediaGrid .mcard').first()).toHaveAttribute(
    'data-key',
    'uploads/202601/e2e-article.webp',
  );
  await expect(page.locator('#fbCount')).toContainText('全库筛选：1 个');
});

// 分类管理弹窗：新增 / 改名 / 排序 / 删除，全部走 mock 的分类接口。
test('管理分类弹窗可以新增 / 改名 / 排序 / 删除', async ({ page }) => {
  await addToken(page);
  const api = await mockMediaApi(page);
  await page.goto('/admin/media', { waitUntil: 'networkidle' });
  await expect(page.locator('#mediaGrid .mcard')).toHaveCount(3);

  await page.locator('#btnCats').click();
  await expect(page.locator('#catDlg')).toHaveAttribute('open', '');
  const rows = page.locator('#catList .cat-row');
  await expect(rows).toHaveCount(3);

  // 新增：重名报错（服务端 message 展示在错误位）
  await page.locator('#catName').fill('动态');
  await page.locator('#catAdd').click();
  await expect(page.locator('#catErr')).toBeVisible();
  await expect(page.locator('#catErr')).toContainText('同名');
  // 新名字可以添加
  await page.locator('#catName').fill('相册');
  await page.locator('#catAdd').click();
  await expect(rows).toHaveCount(4);
  expect(
    api.categoryRequests.some(
      (entry) =>
        entry.method === 'POST' &&
        (entry.body as { name?: string } | undefined)?.name === '相册',
    ),
  ).toBe(true);

  // 改名：第一行改成「文章集」
  await rows.first().locator('.cat-name').fill('文章集');
  await rows.first().locator('[data-act="rename"]').click();
  await expect
    .poll(() =>
      api.categoryRequests.some(
        (entry) =>
          entry.method === 'PATCH' &&
          (entry.body as { name?: string } | undefined)?.name === '文章集',
      ),
    )
    .toBe(true);

  // 排序：第一行下移 → 至少发出两次 position PATCH
  const positionPatches = () =>
    api.categoryRequests.filter(
      (entry) =>
        entry.method === 'PATCH' &&
        typeof (entry.body as { position?: number } | undefined)?.position ===
          'number',
    ).length;
  const beforeMove = positionPatches();
  await rows.first().locator('[data-act="down"]').click();
  await expect.poll(positionPatches).toBeGreaterThanOrEqual(beforeMove + 2);
  await expect(rows.first().locator('.cat-name')).toHaveValue('动态');

  // 删除：确认弹窗 → DELETE，行数减少
  await rows.last().locator('[data-act="del"]').click();
  await expect(page.locator('#catDelDlg')).toHaveAttribute('open', '');
  await expect(page.locator('#catDelText')).toContainText('未分类');
  await page.locator('#catDelOk').click();
  await expect(rows).toHaveCount(3);
  expect(api.categoryRequests.some((entry) => entry.method === 'DELETE')).toBe(
    true,
  );
});

test('媒体转换接口：size=240 生成 WebP，size=orig 返回原图', async ({
  request,
}) => {
  const key = 'cabinet.jpg';

  // 原图基线：不带参数直接返回 R2 里的 JPEG
  const original = await request.get(`/media/${key}`);
  expect(original.status()).toBe(200);
  const originalType = original.headers()['content-type'] ?? '';
  expect(originalType).toContain('image/jpeg');
  expect(original.headers()['x-image-size']).toBeUndefined();

  // 小于原图长边：真正走 Cloudflare Images 转换，返回低清 WebP
  const scaled = await request.get(`/media/${key}?size=240&q=70`);
  expect(scaled.status()).toBe(200);
  expect(scaled.headers()['content-type']).toBe('image/webp');
  expect(scaled.headers()['x-image-size']).toMatch(/^w=\d+/);
  // 长边 240 的 4:3 图：240×180
  expect(scaled.headers()['x-image-size']).toBe('w=240,h=180,q=70');
  // 转换产物是不可变缓存
  expect(scaled.headers()['cache-control']).toContain('immutable');

  // size=orig：保持原图（与不带参数同一份内容、同一 content-type，且没有转换头）
  const originalSized = await request.get(`/media/${key}?size=orig`);
  expect(originalSized.status()).toBe(200);
  expect(originalSized.headers()['content-type']).toBe(originalType);
  expect(originalSized.headers()['x-image-size']).toBeUndefined();
});
