import { expect, test } from '@playwright/test';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'dev-admin-token';
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('媒体库把 PNG 在前端转成 WebP 再上传', async ({ page }) => {
  await page.addInitScript((token) => {
    localStorage.setItem('myon-admin-token', token);
  }, ADMIN_TOKEN);
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
    item: { id: string; key: string; mime: string; filename: string };
  };

  try {
    expect(body.item.mime).toBe('image/webp');
    expect(body.item.filename).toMatch(/\.webp$/);
    expect(body.item.key).toMatch(/\.webp$/);
  } finally {
    await page.request.delete(`/api/v1/admin/media/${body.item.id}`, {
      headers: { 'x-admin-token': ADMIN_TOKEN },
    });
  }
});

test('GIF 先经 Worker 代理换成 animated WebP 再上传', async ({ page }) => {
  await page.addInitScript((token) => {
    localStorage.setItem('myon-admin-token', token);
  }, ADMIN_TOKEN);
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

// 媒体库网格缩略图走低清预览（size=360&q=70），复制链接仍给原图地址。
test('媒体库网格缩略图用低清预览，不拉原图', async ({ page }) => {
  await page.addInitScript((token) => {
    localStorage.setItem('myon-admin-token', token);
  }, ADMIN_TOKEN);
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
          },
        ],
        total: 1,
        limit: 30,
        offset: 0,
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
