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
