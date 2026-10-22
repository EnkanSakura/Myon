import { type APIRequestContext, expect, test } from '@playwright/test';

// 后台写接口的 e2e：鉴权 + 文章/动态 CRUD + 媒体上传/删除 + Bangumi 手动同步，
// 外加四个前台列表的 ?page= 宽松分页冒烟。
//
// 环境依赖：`apps/web/.dev.vars` 里配置了 ADMIN_TOKEN（本地默认 dev-admin-token）。
// `pnpm dev` 会加载它；如果没配置，后台接口会返回 503 而不是 401，本文件的鉴权用例会失败。
// 需要换令牌时用环境变量 ADMIN_TOKEN 覆盖。
//
// 清理策略：每个用例自己创建数据，并在 finally 里按 id 删除，失败路径也清；
// 删除接口对不存在的记录是幂等的（媒体删除返回 404 也忽略），所以重复运行不会留下测试数据。
// 这里只走 HTTP 层：后台页面的 UI 交互由对应页面用例覆盖，避免和它们抢同一批 DOM。
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'dev-admin-token';
const ADMIN_HEADERS = { 'x-admin-token': ADMIN_TOKEN };

// 1x1 透明 PNG：用 Buffer 直接构造，避免测试依赖仓库里的图片素材。
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

interface PostItem {
  id: string;
  slug: string;
  title: string;
  status: string;
  publishedAt: string | null;
}

interface MomentItem {
  id: string;
  body: string;
  pinned: boolean;
}

interface MediaItem {
  id: string;
  key: string;
  mime: string;
  size: number;
}

interface BangumiSyncResult {
  ok: boolean;
  synced: number;
  reason?: string;
}

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 清理失败不掩盖原始断言失败：只确保后续用例不再看到这行数据。 */
async function deleteQuietly(
  request: APIRequestContext,
  path: string,
): Promise<void> {
  await request.delete(path, { headers: ADMIN_HEADERS }).catch(() => undefined);
}

test.describe('后台接口鉴权', () => {
  test('不带 token 访问 /api/v1/admin/posts 返回 401', async ({ request }) => {
    const res = await request.get('/api/v1/admin/posts');
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });
});

test.describe('后台文章 CRUD', () => {
  test('新建草稿 → 列表可见 → 发布 → 删除后 404', async ({ request }) => {
    const slug = `e2e-draft-${uniqueSuffix()}`;
    let id: string | undefined;
    let deleted = false;

    try {
      const created = await request.post('/api/v1/admin/posts', {
        headers: ADMIN_HEADERS,
        data: {
          slug,
          title: `E2E 测试草稿 ${slug}`,
          excerpt: '由 e2e 用例创建，用例结束会删除。',
          bodyMd: '# e2e\n\n临时内容。',
          status: 'draft',
          category: '随笔',
        },
      });
      expect(created.status()).toBe(201);
      const createdBody = (await created.json()) as { item: PostItem };
      id = createdBody.item.id;
      expect(createdBody.item.slug).toBe(slug);
      expect(createdBody.item.status).toBe('draft');

      const listed = await request.get('/api/v1/admin/posts?limit=100', {
        headers: ADMIN_HEADERS,
      });
      expect(listed.status()).toBe(200);
      const listedBody = (await listed.json()) as Paginated<PostItem>;
      expect(Array.isArray(listedBody.items)).toBe(true);
      expect(listedBody.total).toBeGreaterThan(0);
      expect(listedBody.items.some((item) => item.id === id)).toBe(true);

      const patched = await request.patch(`/api/v1/admin/posts/${id}`, {
        headers: ADMIN_HEADERS,
        data: { status: 'published' },
      });
      expect(patched.status()).toBe(200);
      const patchedBody = (await patched.json()) as { item: PostItem };
      expect(patchedBody.item.status).toBe('published');
      expect(patchedBody.item.publishedAt).toBeTruthy();

      const removed = await request.delete(`/api/v1/admin/posts/${id}`, {
        headers: ADMIN_HEADERS,
      });
      expect(removed.status()).toBe(200);
      expect(await removed.json()).toEqual({ ok: true });
      deleted = true;

      // 删掉之后再查应 404，列表里也不应再出现
      const missing = await request.get(`/api/v1/admin/posts/${id}`, {
        headers: ADMIN_HEADERS,
      });
      expect(missing.status()).toBe(404);

      const after = await request.get('/api/v1/admin/posts?limit=100', {
        headers: ADMIN_HEADERS,
      });
      const afterBody = (await after.json()) as Paginated<PostItem>;
      expect(afterBody.items.some((item) => item.id === id)).toBe(false);
    } finally {
      if (id && !deleted)
        await deleteQuietly(request, `/api/v1/admin/posts/${id}`);
    }
  });
});

test.describe('后台动态 CRUD', () => {
  test('新建动态 → 置顶 → 删除', async ({ request }) => {
    const marker = uniqueSuffix();
    let id: string | undefined;
    let deleted = false;

    try {
      const created = await request.post('/api/v1/admin/moments', {
        headers: ADMIN_HEADERS,
        data: { body: `E2E 临时动态 ${marker}`, category: '碎念' },
      });
      expect(created.status()).toBe(201);
      const createdBody = (await created.json()) as { item: MomentItem };
      id = createdBody.item.id;
      expect(createdBody.item.body).toContain(marker);
      expect(createdBody.item.pinned).toBe(false);

      const patched = await request.patch(`/api/v1/admin/moments/${id}`, {
        headers: ADMIN_HEADERS,
        data: { pinned: true },
      });
      expect(patched.status()).toBe(200);
      const patchedBody = (await patched.json()) as { item: MomentItem };
      expect(patchedBody.item.pinned).toBe(true);

      const removed = await request.delete(`/api/v1/admin/moments/${id}`, {
        headers: ADMIN_HEADERS,
      });
      expect(removed.status()).toBe(200);
      expect(await removed.json()).toEqual({ ok: true });
      deleted = true;

      const after = await request.get('/api/v1/admin/moments?limit=100', {
        headers: ADMIN_HEADERS,
      });
      expect(after.status()).toBe(200);
      const afterBody = (await after.json()) as Paginated<MomentItem>;
      expect(afterBody.items.some((item) => item.id === id)).toBe(false);
    } finally {
      if (id && !deleted)
        await deleteQuietly(request, `/api/v1/admin/moments/${id}`);
    }
  });
});

test.describe('后台媒体上传', () => {
  test('上传 1x1 PNG → /media/<key> 可访问 → 删除后 404', async ({
    request,
  }) => {
    const filename = `e2e-pixel-${uniqueSuffix()}.png`;
    let id: string | undefined;
    let key: string | undefined;
    let deleted = false;

    try {
      const uploaded = await request.post('/api/v1/admin/media', {
        headers: ADMIN_HEADERS,
        multipart: {
          file: { name: filename, mimeType: 'image/png', buffer: PNG_1PX },
        },
      });
      expect(uploaded.status()).toBe(201);
      const uploadedBody = (await uploaded.json()) as { item: MediaItem };
      id = uploadedBody.item.id;
      key = uploadedBody.item.key;
      expect(uploadedBody.item.mime).toBe('image/png');
      expect(uploadedBody.item.size).toBe(PNG_1PX.byteLength);
      expect(key).toMatch(/^uploads\//);

      const fetched = await request.get(`/media/${key}`);
      expect(fetched.status()).toBe(200);
      expect(fetched.headers()['content-type']).toContain('image/png');

      const removed = await request.delete(`/api/v1/admin/media/${id}`, {
        headers: ADMIN_HEADERS,
      });
      expect(removed.status()).toBe(200);
      expect(await removed.json()).toEqual({ ok: true });
      deleted = true;

      // R2 里的对象随记录一起删掉，出口应回到 404
      const gone = await request.get(`/media/${key}`);
      expect(gone.status()).toBe(404);
    } finally {
      if (id && !deleted)
        await deleteQuietly(request, `/api/v1/admin/media/${id}`);
    }
  });
});

test.describe('后台 Bangumi 同步', () => {
  test('手动同步返回 ok 或 not_configured', async ({ request }) => {
    const res = await request.post('/api/v1/admin/bangumi/sync', {
      headers: ADMIN_HEADERS,
    });
    // 本地没配 BANGUMI_ACCESS_TOKEN 时是 200 + {ok:true,synced:0,reason:'not_configured'}；
    // 配了但上游失败时是 502 + {ok:false,reason:'bgm_*'}，两种都不该让用例挂。
    expect([200, 502]).toContain(res.status());
    const body = (await res.json()) as BangumiSyncResult;
    expect(typeof body.ok).toBe('boolean');
    if (body.ok) {
      expect(body.synced).toBeGreaterThanOrEqual(0);
      if (body.reason !== undefined) expect(body.reason).toBe('not_configured');
    } else {
      expect(body.reason).toBeTruthy();
    }
  });
});

test.describe('后台展柜读取', () => {
  test('后台列表包含未陈列项，公开列表总量不超过后台', async ({ request }) => {
    const adminRes = await request.get('/api/v1/admin/gallery', {
      headers: ADMIN_HEADERS,
    });
    expect(adminRes.status()).toBe(200);
    const adminBody = (await adminRes.json()) as Paginated<unknown>;
    expect(Array.isArray(adminBody.items)).toBe(true);
    expect(typeof adminBody.total).toBe('number');

    const publicRes = await request.get('/api/v1/gallery');
    expect(publicRes.status()).toBe(200);
    const publicBody = (await publicRes.json()) as Paginated<unknown>;
    expect(Array.isArray(publicBody.items)).toBe(true);
    expect(publicBody.total).toBeLessThanOrEqual(adminBody.total);
  });
});

// 前台分页由另一处实现，断言保持宽松：只确认 ?page= 被接受、页面 200、页头还在。
// 不比较条目数量，也不假设第 2 页一定有内容。
const PAGED_ROUTES = [
  { path: '/articles?page=2', heading: '文章' },
  { path: '/moments?page=2', heading: '动态' },
  { path: '/gallery?page=2', heading: '展柜' },
  { path: '/bangumi?page=2', heading: '追番' },
];

test.describe('前台列表分页', () => {
  for (const route of PAGED_ROUTES) {
    test(`${route.path} 返回 200 并保留页头`, async ({ page }) => {
      const res = await page.goto(route.path);
      expect(res?.status()).toBe(200);
      await expect(page.locator('h1').first()).toContainText(route.heading);
      expect(page.url()).toContain('page=2');
    });
  }
});
